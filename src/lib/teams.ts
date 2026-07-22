// Team (shared) OTP vaults on top of Appwrite Teams + TablesDB.
//
// Membership, roles and email invites use Appwrite's native Teams API. On top
// of that we keep three tables:
//
//   publicKeys    (rowId = userId)   { userId, publicKeyJwk }
//       Each user publishes their RSA public key here so others can wrap a
//       team key to them. Readable by any signed-in user.
//
//   teamVaults    (rowId = teamId)   { teamId, cipherText, version, keyEpoch }
//       The team's codes, encrypted with the team's AES key. Readable by team
//       members; writable by owners/admins. `keyEpoch` bumps on key rotation.
//
//   teamKeyGrants (rowId = unique)   { teamId, userId, wrappedKey, keyEpoch }
//       Per-member copy of the team key, wrapped to that member's public key.
//       Read by the target member + owners/admins; written by owners/admins.
//
// Zero-knowledge holds throughout: the plaintext team key is only ever produced
// inside a member's browser after unwrapping a grant with their private key.

import { AppwriteException } from "appwrite";
import {
  appwrite,
  DATABASE_ID,
  ID,
  Permission,
  Query,
  Role,
  PUBLIC_KEYS_TABLE_ID,
  TEAM_VAULTS_TABLE_ID,
  TEAM_GRANTS_TABLE_ID,
} from "./appwrite";
import { decryptJSON, encryptJSON, type EncryptedBlob } from "./crypto";
import {
  db,
  type TeamEntryRecord,
  type TeamFolder,
  type TeamRecord,
  type TeamRole,
} from "./db";
import {
  generateTeamKey,
  importPublicKey,
  unwrapTeamKey,
  wrapTeamKeyFor,
  type Identity,
} from "./team-crypto";

// ---- roles ------------------------------------------------------------------
// Appwrite only lets you assign a document permission for a team-role that YOU
// currently hold (anti privilege-escalation). To keep grant/vault writes always
// assignable, every writer holds the single "owner" role; "admin" is an extra
// marker layered on top, used only for display and member management. So both
// owners and admins can assign the team/owner permissions on rows they create.
const WRITER_ROLE = "owner";

function rolesForNewMember(role: TeamRole): string[] {
  if (role === "admin") return ["owner", "admin"];
  if (role === "owner") return ["owner"];
  return ["member"];
}

function topRole(roles: string[]): TeamRole {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("owner")) return "owner";
  return "member";
}

function canWrite(role: TeamRole): boolean {
  return role === "owner" || role === "admin";
}

// ---- encrypted team blob ----------------------------------------------------
type TeamVaultBlob = {
  format: "aegis-team";
  version: 1;
  name: string;
  folders?: TeamFolder[]; // optional for back-compat with pre-folder blobs
  entries: TeamEntryRecord[];
};

function isTeamVaultBlob(o: unknown): o is TeamVaultBlob {
  return (
    typeof o === "object" &&
    o !== null &&
    (o as { format?: string }).format === "aegis-team"
  );
}

// ---- Appwrite row shapes ----------------------------------------------------
type PublicKeyRow = { $id: string; userId: string; publicKeyJwk: string };
type TeamVaultRow = {
  $id: string;
  teamId: string;
  cipherText: string;
  version: number;
  keyEpoch: number;
};
type GrantRow = {
  $id: string;
  teamId: string;
  userId: string;
  wrappedKey: string;
  keyEpoch: number;
};

function isNotFound(e: unknown): boolean {
  return e instanceof AppwriteException && e.code === 404;
}

// ---- public key registry ----------------------------------------------------

// Publish (or refresh) our public key so teammates can share team keys with us.
export async function publishPublicKey(identity: Identity): Promise<void> {
  const { account, tablesDB } = appwrite();
  const user = await account.get();
  const publicKeyJwk = JSON.stringify(identity.publicKeyJwk);
  const data = { userId: user.$id, publicKeyJwk };
  // Anyone signed in may read public keys; only we may change ours.
  const perms = [
    Permission.read(Role.users()),
    Permission.update(Role.user(user.$id)),
    Permission.delete(Role.user(user.$id)),
  ];
  // Idempotent upsert keyed on our userId. We can't rely on getRow to detect
  // existence: with Row Security enabled, Appwrite returns 404 for a row the
  // caller can't read, so a stale row would slip through to createRow. Instead
  // create first, and on a 409 conflict update in place (this also repairs the
  // row's permissions if an earlier attempt wrote them wrong).
  try {
    await tablesDB.createRow(
      DATABASE_ID,
      PUBLIC_KEYS_TABLE_ID,
      user.$id,
      data,
      perms,
    );
  } catch (e) {
    if (e instanceof AppwriteException && e.code === 409) {
      await tablesDB.updateRow(
        DATABASE_ID,
        PUBLIC_KEYS_TABLE_ID,
        user.$id,
        data,
        perms,
      );
    } else {
      throw e;
    }
  }
}

async function fetchPublicKey(userId: string): Promise<CryptoKey | null> {
  const { tablesDB } = appwrite();
  try {
    const row = (await tablesDB.getRow(
      DATABASE_ID,
      PUBLIC_KEYS_TABLE_ID,
      userId,
    )) as unknown as PublicKeyRow;
    return await importPublicKey(JSON.parse(row.publicKeyJwk) as JsonWebKey);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

// ---- grants -----------------------------------------------------------------

function grantPerms(teamId: string, targetUserId: string): string[] {
  return [
    Permission.read(Role.user(targetUserId)),
    Permission.read(Role.team(teamId, WRITER_ROLE)),
    Permission.update(Role.team(teamId, WRITER_ROLE)),
    Permission.delete(Role.team(teamId, WRITER_ROLE)),
  ];
}

async function listGrants(teamId: string): Promise<GrantRow[]> {
  const { tablesDB } = appwrite();
  const res = await tablesDB.listRows(DATABASE_ID, TEAM_GRANTS_TABLE_ID, [
    Query.equal("teamId", teamId),
  ]);
  return res.rows as unknown as GrantRow[];
}

async function myGrant(teamId: string, userId: string): Promise<GrantRow | null> {
  const { tablesDB } = appwrite();
  const res = await tablesDB.listRows(DATABASE_ID, TEAM_GRANTS_TABLE_ID, [
    Query.equal("teamId", teamId),
    Query.equal("userId", userId),
  ]);
  const rows = res.rows as unknown as GrantRow[];
  if (!rows.length) return null;
  // Highest epoch wins (after a rotation there may briefly be two).
  return rows.sort((a, b) => b.keyEpoch - a.keyEpoch)[0];
}

async function createGrant(
  teamId: string,
  targetUserId: string,
  teamKey: CryptoKey,
  targetPublicKey: CryptoKey,
  keyEpoch: number,
): Promise<void> {
  const { tablesDB } = appwrite();
  const wrappedKey = await wrapTeamKeyFor(teamKey, targetPublicKey);
  await tablesDB.createRow(
    DATABASE_ID,
    TEAM_GRANTS_TABLE_ID,
    ID.unique(),
    { teamId, userId: targetUserId, wrappedKey, keyEpoch },
    grantPerms(teamId, targetUserId),
  );
}

// ---- team vault row ---------------------------------------------------------

function teamVaultPerms(teamId: string): string[] {
  return [
    Permission.read(Role.team(teamId)),
    Permission.update(Role.team(teamId, WRITER_ROLE)),
    Permission.delete(Role.team(teamId, WRITER_ROLE)),
  ];
}

async function getTeamVaultRow(teamId: string): Promise<TeamVaultRow | null> {
  const { tablesDB } = appwrite();
  try {
    const row = await tablesDB.getRow(DATABASE_ID, TEAM_VAULTS_TABLE_ID, teamId);
    return row as unknown as TeamVaultRow;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

async function encodeBlob(
  teamKey: CryptoKey,
  name: string,
  folders: TeamFolder[],
  entries: TeamEntryRecord[],
): Promise<string> {
  const blob: TeamVaultBlob = {
    format: "aegis-team",
    version: 1,
    name,
    folders,
    entries,
  };
  const wrapped = await encryptJSON(teamKey, blob);
  return btoa(JSON.stringify(wrapped));
}

async function decodeBlob(
  teamKey: CryptoKey,
  cipherText: string,
): Promise<TeamVaultBlob> {
  const wrapped = JSON.parse(atob(cipherText)) as EncryptedBlob;
  const obj = await decryptJSON<unknown>(teamKey, wrapped);
  if (!isTeamVaultBlob(obj)) throw new Error("Team data is in an unexpected format.");
  return obj;
}

// ---- public API -------------------------------------------------------------

// Create a brand-new team. We become its owner. Returns the local record and
// the in-memory team key so the caller can start encrypting codes immediately.
export async function createTeam(
  name: string,
  color: string,
  identity: Identity,
): Promise<{ team: TeamRecord; teamKey: CryptoKey }> {
  await publishPublicKey(identity);
  const { account, teams, tablesDB } = appwrite();
  const user = await account.get();

  const created = await teams.create(ID.unique(), name, ["owner"]);
  const teamId = created.$id;

  const teamKey = await generateTeamKey();
  const epoch = 1;

  // Grant ourselves the key.
  const ownPublic = await importPublicKey(identity.publicKeyJwk);
  await createGrant(teamId, user.$id, teamKey, ownPublic, epoch);
  const wrappedForSelf = await wrapTeamKeyFor(teamKey, ownPublic);

  // Empty team vault row.
  const cipherText = await encodeBlob(teamKey, name, [], []);
  await tablesDB.createRow(
    DATABASE_ID,
    TEAM_VAULTS_TABLE_ID,
    teamId,
    { teamId, cipherText, version: 1, keyEpoch: epoch },
    teamVaultPerms(teamId),
  );

  const record: TeamRecord = {
    id: teamId,
    name,
    role: "owner",
    color,
    wrappedTeamKey: wrappedForSelf,
    remoteVersion: 1,
    lastSyncedAt: Date.now(),
    createdAt: Date.now(),
  };
  await db().teams.put(record);
  return { team: record, teamKey };
}

// Invite someone by email. Appwrite emails them an accept link; they join once
// they open it while signed into their Aegis cloud account (same email). They
// only receive the team key after an owner/admin next reconciles grants.
export async function inviteMember(
  teamId: string,
  email: string,
  role: TeamRole,
): Promise<void> {
  const { teams } = appwrite();
  const url = `${window.location.origin}/teams`;
  await teams.createMembership(
    teamId,
    rolesForNewMember(role),
    email,
    undefined,
    undefined,
    url,
  );
}

// Confirm a membership from an invite email's query params (teamId, membershipId,
// userId, secret). Called by the /teams route when those are present in the URL.
export async function acceptInvite(params: {
  teamId: string;
  membershipId: string;
  userId: string;
  secret: string;
}): Promise<void> {
  const { teams } = appwrite();
  await teams.updateMembershipStatus(
    params.teamId,
    params.membershipId,
    params.userId,
    params.secret,
  );
}

export type TeamMember = {
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  role: TeamRole;
  confirmed: boolean;
  hasKey: boolean; // has a grant for the current epoch
};

export async function listMembers(teamId: string): Promise<TeamMember[]> {
  const { teams } = appwrite();
  const res = await teams.listMemberships(teamId);
  let grants: GrantRow[] = [];
  try {
    grants = await listGrants(teamId);
  } catch {
    // Members (non-writers) can't list all grants — that's fine, they don't
    // need the hasKey column.
  }
  const granted = new Set(grants.map((g) => g.userId));
  return res.memberships.map((m) => ({
    membershipId: m.$id,
    userId: m.userId,
    email: m.userEmail,
    name: m.userName,
    role: topRole(m.roles),
    confirmed: m.confirm,
    hasKey: granted.has(m.userId),
  }));
}

// Sync the list of teams we belong to into local Dexie, pulling our own grant
// (the wrapped team key) for each. Preserves any locally cached fields.
export async function syncMyTeams(): Promise<TeamRecord[]> {
  const { account, teams } = appwrite();
  const user = await account.get();
  const res = await teams.list();

  const local = await db().teams.toArray();
  const localById = new Map(local.map((t) => [t.id, t]));
  const out: TeamRecord[] = [];

  for (const m of res.teams) {
    const membership = await currentMembershipRole(m.$id, user.$id);
    const grant = await myGrant(m.$id, user.$id);
    const prev = localById.get(m.$id);
    const record: TeamRecord = {
      id: m.$id,
      name: m.name,
      role: membership,
      color: prev?.color ?? pickColor(m.$id),
      wrappedTeamKey: grant?.wrappedKey ?? prev?.wrappedTeamKey ?? null,
      remoteVersion: prev?.remoteVersion ?? null,
      lastSyncedAt: prev?.lastSyncedAt ?? null,
      createdAt: prev?.createdAt ?? Date.now(),
    };
    await db().teams.put(record);
    out.push(record);
  }

  // Drop local teams we're no longer a member of (removed/left elsewhere).
  const remoteIds = new Set(res.teams.map((t) => t.$id));
  for (const t of local) {
    if (!remoteIds.has(t.id)) {
      await db().teams.delete(t.id);
      await db().teamEntries.where("teamId").equals(t.id).delete();
      await db().teamFolders.where("teamId").equals(t.id).delete();
    }
  }
  return out;
}

async function currentMembershipRole(
  teamId: string,
  userId: string,
): Promise<TeamRole> {
  const { teams } = appwrite();
  try {
    const res = await teams.listMemberships(teamId, [
      Query.equal("userId", userId),
    ]);
    const mine = res.memberships[0];
    return mine ? topRole(mine.roles) : "member";
  } catch {
    return "member";
  }
}

// Owner/admin: hand the team key to every confirmed member who has published a
// public key but doesn't yet have a grant. This is what makes invited members'
// access "just work" the next time an admin opens the app.
export async function reconcileGrants(
  teamId: string,
  teamKey: CryptoKey,
  keyEpoch: number,
): Promise<number> {
  const { teams } = appwrite();
  const members = await teams.listMemberships(teamId);
  const grants = await listGrants(teamId);
  const covered = new Set(
    grants.filter((g) => g.keyEpoch === keyEpoch).map((g) => g.userId),
  );

  let granted = 0;
  for (const m of members.memberships) {
    if (!m.confirm) continue; // hasn't accepted the invite yet
    if (covered.has(m.userId)) continue;
    const pub = await fetchPublicKey(m.userId);
    if (!pub) continue; // they haven't published a key yet — skip for now
    await createGrant(teamId, m.userId, teamKey, pub, keyEpoch);
    granted++;
  }
  return granted;
}

// Owner/admin convenience: grant the current team key to any pending members,
// looking up the current epoch from the team vault row.
export async function reconcilePendingGrants(
  teamId: string,
  teamKey: CryptoKey,
): Promise<number> {
  const row = await getTeamVaultRow(teamId);
  if (!row) return 0;
  return reconcileGrants(teamId, teamKey, row.keyEpoch);
}

// Push local team codes up. Owner/admin only.
export async function pushTeamVault(
  team: TeamRecord,
  teamKey: CryptoKey,
): Promise<TeamRecord> {
  if (!canWrite(team.role)) {
    throw new Error("Only team owners and admins can edit shared codes.");
  }
  const { tablesDB } = appwrite();
  const folders = await db()
    .teamFolders.where("teamId")
    .equals(team.id)
    .toArray();
  const entries = await db()
    .teamEntries.where("teamId")
    .equals(team.id)
    .toArray();
  const existing = await getTeamVaultRow(team.id);
  if (!existing) throw new Error("Team vault is missing on the server.");

  if (team.remoteVersion !== null && existing.version !== team.remoteVersion) {
    const err = new Error("Team vault changed on the server. Pull first.");
    (err as Error & { code?: string }).code = "CONFLICT";
    throw err;
  }
  const cipherText = await encodeBlob(teamKey, team.name, folders, entries);
  const updated = (await tablesDB.updateRow(
    DATABASE_ID,
    TEAM_VAULTS_TABLE_ID,
    team.id,
    { cipherText, version: existing.version + 1 },
  )) as unknown as TeamVaultRow;

  const next: TeamRecord = {
    ...team,
    remoteVersion: updated.version,
    lastSyncedAt: Date.now(),
  };
  await db().teams.put(next);
  return next;
}

// Pull team codes down and replace the local copy for this team.
export async function pullTeamVault(
  team: TeamRecord,
  teamKey: CryptoKey,
): Promise<TeamRecord> {
  const row = await getTeamVaultRow(team.id);
  if (!row) return team;
  const blob = await decodeBlob(teamKey, row.cipherText);

  await db().transaction(
    "rw",
    [db().teams, db().teamEntries, db().teamFolders],
    async () => {
      await db().teamFolders.where("teamId").equals(team.id).delete();
      await db().teamEntries.where("teamId").equals(team.id).delete();
      if (blob.folders?.length) {
        await db().teamFolders.bulkPut(
          blob.folders.map((f) => ({ ...f, teamId: team.id })),
        );
      }
      if (blob.entries.length) {
        // Guard the teamId/folderId in case an older blob omitted them.
        await db().teamEntries.bulkPut(
          blob.entries.map((e) => ({
            ...e,
            teamId: team.id,
            folderId: e.folderId ?? null,
          })),
        );
      }
      const next: TeamRecord = {
        ...team,
        name: blob.name || team.name,
        remoteVersion: row.version,
        lastSyncedAt: Date.now(),
      };
      await db().teams.put(next);
    },
  );
  return (await db().teams.get(team.id))!;
}

// Remove a member and ROTATE the team key so the removed member's cached copy
// is useless going forward. Owner/admin only. Returns the fresh team key.
export async function removeMemberAndRotate(
  team: TeamRecord,
  member: TeamMember,
  identity: Identity,
): Promise<{ team: TeamRecord; teamKey: CryptoKey }> {
  if (!canWrite(team.role)) {
    throw new Error("Only team owners and admins can remove members.");
  }
  const { account, teams, tablesDB } = appwrite();
  const me = await account.get();

  // 1. Remove their Appwrite membership (revokes their read access to the row).
  await teams.deleteMembership(team.id, member.membershipId);

  // 2. New key + new epoch.
  const row = await getTeamVaultRow(team.id);
  if (!row) throw new Error("Team vault is missing on the server.");
  const newEpoch = row.keyEpoch + 1;
  const newKey = await generateTeamKey();

  // 3. Re-encrypt the blob with the new key and bump epoch + version.
  const folders = await db()
    .teamFolders.where("teamId")
    .equals(team.id)
    .toArray();
  const entries = await db()
    .teamEntries.where("teamId")
    .equals(team.id)
    .toArray();
  const cipherText = await encodeBlob(newKey, team.name, folders, entries);
  const updated = (await tablesDB.updateRow(
    DATABASE_ID,
    TEAM_VAULTS_TABLE_ID,
    team.id,
    { cipherText, version: row.version + 1, keyEpoch: newEpoch },
  )) as unknown as TeamVaultRow;

  // 4. Delete ALL old grants, then re-grant to remaining confirmed members.
  const oldGrants = await listGrants(team.id);
  for (const g of oldGrants) {
    try {
      await tablesDB.deleteRow(DATABASE_ID, TEAM_GRANTS_TABLE_ID, g.$id);
    } catch {
      /* best effort */
    }
  }
  // Always grant ourselves first so we keep access.
  const ownPublic = await importPublicKey(identity.publicKeyJwk);
  await createGrant(team.id, me.$id, newKey, ownPublic, newEpoch);
  const wrappedForSelf = await wrapTeamKeyFor(newKey, ownPublic);
  await reconcileGrants(team.id, newKey, newEpoch);

  const next: TeamRecord = {
    ...team,
    wrappedTeamKey: wrappedForSelf,
    remoteVersion: updated.version,
    lastSyncedAt: Date.now(),
  };
  await db().teams.put(next);
  return { team: next, teamKey: newKey };
}

// Leave a team yourself. Removes your membership and your grant, and drops the
// local copy. (Does not rotate — remaining members' keys are unaffected.)
export async function leaveTeam(team: TeamRecord): Promise<void> {
  const { account, teams } = appwrite();
  const me = await account.get();
  const memberships = await teams.listMemberships(team.id, [
    Query.equal("userId", me.$id),
  ]);
  for (const m of memberships.memberships) {
    try {
      await teams.deleteMembership(team.id, m.$id);
    } catch {
      /* ignore */
    }
  }
  await db().teams.delete(team.id);
  await db().teamEntries.where("teamId").equals(team.id).delete();
  await db().teamFolders.where("teamId").equals(team.id).delete();
}

export async function updateMemberRole(
  teamId: string,
  member: TeamMember,
  role: TeamRole,
): Promise<void> {
  const { teams } = appwrite();
  await teams.updateMembership(teamId, member.membershipId, rolesForNewMember(role));
}

// Stable pastel color per team id (matches the folder-chip vibe).
const TEAM_COLORS = [
  "#7c86ff",
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
];
function pickColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return TEAM_COLORS[Math.abs(h) % TEAM_COLORS.length];
}

// Unwrap the team key for a local team record using our private key.
export async function unwrapTeamKeyFor(
  team: TeamRecord,
  privateKey: CryptoKey,
): Promise<CryptoKey | null> {
  if (!team.wrappedTeamKey) return null;
  try {
    return await unwrapTeamKey(team.wrappedTeamKey, privateKey);
  } catch {
    return null;
  }
}
