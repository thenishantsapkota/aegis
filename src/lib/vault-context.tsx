import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  decryptJSON,
  deriveVaultKey,
  encryptJSON,
  exportRawVaultKey,
  importRawVaultKey,
  makeKeyCheck,
  newKdfParams,
  verifyKeyCheck,
  type EncryptedBlob,
} from "./crypto";
import {
  db,
  getMeta,
  newId,
  type EntryRecord,
  type EntrySecret,
  type TeamEntryRecord,
  type TeamFolder,
  type VaultMeta,
} from "./db";
import {
  enableBiometric as createBiometricBinding,
  unlockWithBiometric as unlockBindingRaw,
  type BiometricBinding,
} from "./biometric";
import { cloudSignUpFresh, pullRemoteVault, pushLocalVault } from "./sync";
import { isAppwriteConfigured } from "./appwrite";
import {
  createIdentity,
  unwrapPrivateKey,
  type Identity,
} from "./team-crypto";
import {
  publishPublicKey,
  pullTeamVault,
  pushTeamVault,
  reconcilePendingGrants,
  syncMyTeams,
  unwrapTeamKeyFor,
} from "./teams";

type VaultState =
  | { status: "loading" }
  | { status: "uninitialized" } // no vault exists on this device
  | { status: "locked"; email: string | null; hasBiometric: boolean }
  | { status: "unlocked"; email: string | null; hasBiometric: boolean };

type VaultCtx = {
  state: VaultState;
  /** Create a brand-new vault on this device. */
  initialize: (password: string, email?: string | null) => Promise<void>;
  /** Create a brand-new cloud account + local vault in one shot, then unlock. */
  signUpCloud: (password: string, email: string) => Promise<void>;
  /** Unlock with master password. Returns false if password is wrong. */
  unlock: (password: string) => Promise<boolean>;
  /** Unlock via biometric (Face ID / Touch ID / Windows Hello / Android fingerprint). */
  unlockWithBiometric: () => Promise<boolean>;
  /** Enroll the current device's biometric. The vault must be unlocked. */
  enableBiometric: () => Promise<void>;
  /** Forget the enrolled biometric on this device. */
  disableBiometric: () => Promise<void>;
  /** Lock the vault (wipes the in-memory key). */
  lock: () => void;
  /** Refresh state from disk (after an external mutation like cloud restore). */
  refresh: () => Promise<void>;
  /** Wipes ALL local vault data after confirmation. */
  resetLocalVault: () => Promise<void>;
  /** Encrypt + persist an entry. */
  saveEntry: (
    input: {
      id?: string;
      folderId: string | null;
      issuer: string;
      account: string;
      iconHint?: string | null;
      secret: EntrySecret;
      sortOrder?: number;
    },
    opts?: { immediateSync?: boolean },
  ) => Promise<EntryRecord>;
  /** Delete an entry by id (triggers auto-sync). */
  deleteEntry: (id: string) => Promise<void>;
  /** Push local vault to cloud using the in-memory key. */
  pushNow: () => Promise<void>;
  /** Pull cloud vault using the in-memory key. Returns true if applied. */
  pullNow: () => Promise<boolean>;
  /** Decrypt and return the secret for one entry. */
  decryptEntry: (entry: EntryRecord) => Promise<EntrySecret>;
  /** Decrypt all entries (for export). */
  decryptAll: (entries: EntryRecord[]) => Promise<Map<string, EntrySecret>>;

  // ---- Teams (shared vaults) ----
  /** Ensure this device has a published asymmetric identity (needed for teams). */
  ensureIdentity: () => Promise<Identity>;
  /** The in-memory RSA private key (null when locked or no identity). */
  getPrivateKey: () => CryptoKey | null;
  /** The in-memory AES key for a team (undefined if not granted / not loaded). */
  getTeamKey: (teamId: string) => CryptoKey | undefined;
  /** Stash a team key in memory after create/rotate. */
  setTeamKey: (teamId: string, key: CryptoKey) => void;
  /** Pull team list from cloud, unwrap keys, pull each team's codes, grant pending members. */
  refreshTeams: () => Promise<void>;
  /** True once at least one team key is loaded in memory. */
  hasTeamAccess: (teamId: string) => boolean;
  /** Encrypt + persist a team entry, then push to the team vault. */
  saveTeamEntry: (
    teamId: string,
    input: {
      id?: string;
      folderId?: string | null;
      issuer: string;
      account: string;
      iconHint?: string | null;
      secret: EntrySecret;
      sortOrder?: number;
    },
  ) => Promise<TeamEntryRecord>;
  /** Delete a team entry, then push. */
  deleteTeamEntry: (teamId: string, id: string) => Promise<void>;
  /** Decrypt a single team entry's secret. */
  decryptTeamEntry: (entry: TeamEntryRecord) => Promise<EntrySecret>;
  /** Create/rename/recolor a folder inside a team, then push. */
  saveTeamFolder: (
    teamId: string,
    input: { id?: string; name: string; color: string; sortOrder?: number },
  ) => Promise<TeamFolder>;
  /** Delete a team folder (its codes become unfiled), then push. */
  deleteTeamFolder: (teamId: string, id: string) => Promise<void>;
};

const Ctx = createContext<VaultCtx | null>(null);

// Stay unlocked for 1 hour after the most recent unlock (across foreground +
// background). After that, lock — user must re-authenticate.
const AUTO_LOCK_MS = 60 * 60 * 1000;
const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000; // hourly background push
const AUTO_SYNC_DEBOUNCE_MS = 2_000; // 2s after a save → push

function lockedState(meta: VaultMeta | null): VaultState {
  if (!meta) return { status: "uninitialized" };
  return {
    status: "locked",
    email: meta.email,
    hasBiometric: !!meta.biometric,
  };
}

function unlockedState(meta: VaultMeta | null): VaultState {
  return {
    status: "unlocked",
    email: meta?.email ?? null,
    hasBiometric: !!meta?.biometric,
  };
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VaultState>({ status: "loading" });
  const keyRef = useRef<CryptoKey | null>(null);
  const metaRef = useRef<VaultMeta | null>(null);
  // Team crypto held in memory only while unlocked.
  const privateKeyRef = useRef<CryptoKey | null>(null);
  const teamKeysRef = useRef<Map<string, CryptoKey>>(new Map());
  // Used by auto-sync — bumps on every saveEntry, debounce reads/clears it.
  const dirtyRef = useRef<number>(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wall-clock deadline at which the in-memory key must be wiped.
  const unlockExpiresAtRef = useRef<number | null>(null);
  const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- mount: load meta -----------------------------------------------------
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const meta = await getMeta();
        if (!mounted) return;
        metaRef.current = meta ?? null;
        setState(lockedState(meta ?? null));
      } catch (e) {
        console.error("Failed to load vault meta", e);
        if (mounted) setState({ status: "uninitialized" });
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // ---- shared lock helper ---------------------------------------------------
  const doLock = useCallback(() => {
    keyRef.current = null;
    privateKeyRef.current = null;
    teamKeysRef.current = new Map();
    unlockExpiresAtRef.current = null;
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }
    setState((s) =>
      s.status === "unlocked"
        ? { status: "locked", email: s.email, hasBiometric: s.hasBiometric }
        : s,
    );
  }, []);

  // ---- mark unlocked for the next hour --------------------------------------
  const startUnlockWindow = useCallback(() => {
    unlockExpiresAtRef.current = Date.now() + AUTO_LOCK_MS;
    if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
    autoLockTimerRef.current = setTimeout(doLock, AUTO_LOCK_MS);
  }, [doLock]);

  // ---- deadline check on focus/visibility ----------------------------------
  // setTimeout is throttled in background tabs (especially on mobile), so we
  // can't trust it alone. On every visibility change to "visible", verify the
  // deadline against the wall clock and lock immediately if it's passed.
  useEffect(() => {
    const check = () => {
      const exp = unlockExpiresAtRef.current;
      if (exp !== null && Date.now() >= exp && keyRef.current) {
        doLock();
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", check);
    };
  }, [doLock]);

  // ---- silent background push helper ---------------------------------------
  const backgroundPush = useCallback(async () => {
    if (!keyRef.current) return;
    const meta = metaRef.current ?? (await getMeta());
    if (!meta || !meta.userId || !isAppwriteConfigured()) return;
    try {
      const updated = await pushLocalVault(keyRef.current);
      metaRef.current = updated;
    } catch (e) {
      // Swallow — auto-sync should never throw at the user. Surface in console.
      // Common reasons: offline, conflict (handled by manual pull in Settings),
      // missing permissions on the table.
      console.warn("[autoSync] push failed:", e);
    }
  }, []);

  // ---- periodic sync while unlocked ----------------------------------------
  useEffect(() => {
    if (state.status !== "unlocked") return;
    intervalRef.current = setInterval(
      () => void backgroundPush(),
      AUTO_SYNC_INTERVAL_MS,
    );
    // Opportunistic push when the tab regains focus, if we have pending edits.
    const onVis = () => {
      if (document.visibilityState === "visible" && dirtyRef.current > 0) {
        dirtyRef.current = 0;
        void backgroundPush();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [state.status, backgroundPush]);

  // ---- team crypto helpers --------------------------------------------------

  // Ensure meta.identity exists (create + persist if missing) and load the
  // private key into memory. Local-only; publishing is separate.
  const ensureIdentityLocal = useCallback(
    async (vaultKey: CryptoKey): Promise<Identity | null> => {
      let meta = metaRef.current ?? (await getMeta()) ?? null;
      if (!meta) return null;
      if (!meta.identity) {
        const identity = await createIdentity(vaultKey);
        meta = { ...meta, identity };
        await db().meta.put(meta);
        metaRef.current = meta;
      }
      privateKeyRef.current = await unwrapPrivateKey(meta.identity!, vaultKey);
      return meta.identity;
    },
    [],
  );

  // Unwrap every locally-known team key into memory using our private key.
  const hydrateTeams = useCallback(async () => {
    const pk = privateKeyRef.current;
    if (!pk) return;
    const teams = await db().teams.toArray();
    const map = new Map<string, CryptoKey>();
    for (const t of teams) {
      const k = await unwrapTeamKeyFor(t, pk);
      if (k) map.set(t.id, k);
    }
    teamKeysRef.current = map;
  }, []);

  // Best-effort "get up to date with the cloud" pass: pull the personal vault,
  // publish our public key, sync the team list, unwrap team keys, and pull each
  // team's codes (granting pending members if we're an owner/admin). Every step
  // is guarded so it can never break the caller. Shared by the unlock path and
  // the explicit refresh button.
  const doCloudSync = useCallback(
    async (vaultKey?: CryptoKey) => {
      const meta = metaRef.current;
      if (!isAppwriteConfigured() || !meta?.userId) return;

      const vk = vaultKey ?? keyRef.current;
      if (vk) {
        try {
          const res = await pullRemoteVault(vk);
          if (res.applied) metaRef.current = res.meta;
        } catch (e) {
          console.warn("[sync] personal pull on login failed:", e);
        }
      }
      if (meta.identity) {
        try {
          await publishPublicKey(meta.identity);
        } catch (e) {
          console.warn("[teams] publishPublicKey failed:", e);
        }
      }
      try {
        await syncMyTeams();
        await hydrateTeams();
        const teams = await db().teams.toArray();
        for (const t of teams) {
          const key = teamKeysRef.current.get(t.id);
          if (!key) continue; // no access yet — waiting on an admin grant
          try {
            if (t.role === "owner" || t.role === "admin") {
              await reconcilePendingGrants(t.id, key);
            }
            await pullTeamVault(t, key);
          } catch (e) {
            console.warn(`[teams] sync failed for ${t.name}:`, e);
          }
        }
      } catch (e) {
        console.warn("[teams] team sync failed:", e);
      }
    },
    [hydrateTeams],
  );

  // Run after any successful unlock: prepare identity + team keys locally, then
  // kick off a one-shot cloud sync in the background so the device lands on the
  // latest state without blocking the unlock.
  const afterUnlock = useCallback(
    async (vaultKey: CryptoKey) => {
      try {
        await ensureIdentityLocal(vaultKey);
        await hydrateTeams();
      } catch (e) {
        // Team setup must never block a normal unlock.
        console.warn("[teams] post-unlock setup failed:", e);
      }
      void doCloudSync(vaultKey);
    },
    [ensureIdentityLocal, hydrateTeams, doCloudSync],
  );

  // ---- core actions ---------------------------------------------------------

  const initialize = useCallback(
    async (password: string, email: string | null = null) => {
      const kdf = newKdfParams();
      const key = await deriveVaultKey(password, kdf, "vault");
      const keyCheck = await makeKeyCheck(key);
      const meta: VaultMeta = {
        id: "vault",
        email,
        kdf,
        keyCheck,
        createdAt: Date.now(),
        remoteVersion: null,
        lastSyncedAt: null,
        sessionToken: null,
        userId: null,
        biometric: null,
        identity: null,
      };
      await db().meta.put(meta);
      metaRef.current = meta;
      keyRef.current = key;
      startUnlockWindow();
      await afterUnlock(key);
      setState(unlockedState(metaRef.current));
    },
    [startUnlockWindow, afterUnlock],
  );

  const signUpCloud = useCallback(
    async (password: string, email: string) => {
      const { meta, vaultKey } = await cloudSignUpFresh(password, email);
      metaRef.current = meta;
      keyRef.current = vaultKey;
      startUnlockWindow();
      await afterUnlock(vaultKey);
      setState(unlockedState(metaRef.current));
    },
    [startUnlockWindow, afterUnlock],
  );

  const unlock = useCallback(
    async (password: string) => {
      const meta = await getMeta();
      if (!meta) return false;
      metaRef.current = meta;
      const key = await deriveVaultKey(password, meta.kdf, "vault");
      const ok = await verifyKeyCheck(key, meta.keyCheck);
      if (!ok) return false;
      keyRef.current = key;
      startUnlockWindow();
      await afterUnlock(key);
      setState(unlockedState(metaRef.current));
      return true;
    },
    [startUnlockWindow, afterUnlock],
  );

  const unlockWithBiometric = useCallback(async () => {
    const meta = await getMeta();
    if (!meta || !meta.biometric) return false;
    metaRef.current = meta;
    const raw = await unlockBindingRaw(meta.biometric);
    const key = await importRawVaultKey(raw);
    const ok = await verifyKeyCheck(key, meta.keyCheck);
    if (!ok) {
      throw new Error(
        "Biometric unlock returned a key that doesn't match this vault. The binding may be stale — disable and re-enable biometric.",
      );
    }
    keyRef.current = key;
    startUnlockWindow();
    await afterUnlock(key);
    setState(unlockedState(metaRef.current));
    return true;
  }, [startUnlockWindow, afterUnlock]);

  const enableBiometric = useCallback(async () => {
    if (!keyRef.current || !metaRef.current) {
      throw new Error("Vault must be unlocked to enroll biometric.");
    }
    const raw = await exportRawVaultKey(keyRef.current);
    const binding: BiometricBinding = await createBiometricBinding({
      rawVaultKey: raw,
      userIdSeed: metaRef.current.email ?? "aegis-local-vault",
      label: metaRef.current.email ?? "Aegis vault",
    });
    const updated: VaultMeta = { ...metaRef.current, biometric: binding };
    await db().meta.put(updated);
    metaRef.current = updated;
    setState(unlockedState(updated));
  }, []);

  const disableBiometric = useCallback(async () => {
    const meta = metaRef.current ?? (await getMeta());
    if (!meta) return;
    const updated: VaultMeta = { ...meta, biometric: null };
    await db().meta.put(updated);
    metaRef.current = updated;
    setState((s) => {
      if (s.status === "unlocked") return unlockedState(updated);
      if (s.status === "locked") return lockedState(updated);
      return s;
    });
  }, []);

  const refresh = useCallback(async () => {
    const meta = await getMeta();
    metaRef.current = meta ?? null;
    if (!meta) {
      setState({ status: "uninitialized" });
      keyRef.current = null;
      return;
    }
    setState(keyRef.current ? unlockedState(meta) : lockedState(meta));
  }, []);

  const lock = useCallback(() => {
    doLock();
  }, [doLock]);

  const resetLocalVault = useCallback(async () => {
    keyRef.current = null;
    privateKeyRef.current = null;
    teamKeysRef.current = new Map();
    metaRef.current = null;
    await db().delete();
    setState({ status: "uninitialized" });
  }, []);

  // Debounced auto-push after entry edits.
  const scheduleSync = useCallback(() => {
    dirtyRef.current = Date.now();
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      dirtyRef.current = 0;
      void backgroundPush();
    }, AUTO_SYNC_DEBOUNCE_MS);
  }, [backgroundPush]);

  const saveEntry = useCallback<VaultCtx["saveEntry"]>(
    async (input, opts) => {
      if (!keyRef.current) throw new Error("Vault is locked");
      const payload: EncryptedBlob = await encryptJSON(
        keyRef.current,
        input.secret,
      );
      const now = Date.now();
      const id = input.id ?? newId();
      const existing = input.id ? await db().entries.get(input.id) : undefined;
      const record: EntryRecord = {
        id,
        folderId: input.folderId,
        issuer: input.issuer,
        account: input.account,
        iconHint: input.iconHint ?? null,
        payload,
        sortOrder: input.sortOrder ?? existing?.sortOrder ?? now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await db().entries.put(record);
      if (opts?.immediateSync) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        dirtyRef.current = 0;
        void backgroundPush();
      } else {
        scheduleSync();
      }
      return record;
    },
    [scheduleSync, backgroundPush],
  );

  const deleteEntry = useCallback<VaultCtx["deleteEntry"]>(
    async (id) => {
      await db().entries.delete(id);
      scheduleSync();
    },
    [scheduleSync],
  );

  // Push/pull use the in-memory vault key directly. The user is already
  // unlocked (by password or biometric), so we don't need another prompt.
  const pushNow = useCallback<VaultCtx["pushNow"]>(async () => {
    if (!keyRef.current) throw new Error("Vault is locked");
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      dirtyRef.current = 0;
    }
    const updated = await pushLocalVault(keyRef.current);
    metaRef.current = updated;
  }, []);

  const pullNow = useCallback<VaultCtx["pullNow"]>(async () => {
    if (!keyRef.current) throw new Error("Vault is locked");
    const res = await pullRemoteVault(keyRef.current);
    if (res.applied) metaRef.current = res.meta;
    return res.applied;
  }, []);

  const decryptEntry = useCallback<VaultCtx["decryptEntry"]>(async (entry) => {
    if (!keyRef.current) throw new Error("Vault is locked");
    return decryptJSON<EntrySecret>(keyRef.current, entry.payload);
  }, []);

  const decryptAll = useCallback<VaultCtx["decryptAll"]>(async (entries) => {
    if (!keyRef.current) throw new Error("Vault is locked");
    const out = new Map<string, EntrySecret>();
    for (const e of entries) {
      out.set(e.id, await decryptJSON<EntrySecret>(keyRef.current, e.payload));
    }
    return out;
  }, []);

  // ---- team methods ---------------------------------------------------------

  const ensureIdentity = useCallback<VaultCtx["ensureIdentity"]>(async () => {
    if (!keyRef.current) throw new Error("Vault is locked");
    const identity = await ensureIdentityLocal(keyRef.current);
    if (!identity) throw new Error("No vault on this device");
    if (!metaRef.current?.userId) {
      throw new Error("Sign in to cloud sync first — teams require an account.");
    }
    // Publishing must succeed here (teammates need our key).
    await publishPublicKey(identity);
    return identity;
  }, [ensureIdentityLocal]);

  const getPrivateKey = useCallback<VaultCtx["getPrivateKey"]>(
    () => privateKeyRef.current,
    [],
  );

  const getTeamKey = useCallback<VaultCtx["getTeamKey"]>(
    (teamId) => teamKeysRef.current.get(teamId),
    [],
  );

  const setTeamKey = useCallback<VaultCtx["setTeamKey"]>((teamId, key) => {
    teamKeysRef.current.set(teamId, key);
  }, []);

  const hasTeamAccess = useCallback<VaultCtx["hasTeamAccess"]>(
    (teamId) => teamKeysRef.current.has(teamId),
    [],
  );

  const refreshTeams = useCallback<VaultCtx["refreshTeams"]>(async () => {
    if (!isAppwriteConfigured() || !metaRef.current?.userId) return;
    if (!keyRef.current) throw new Error("Vault is locked");
    // Explicit user action: make sure our identity exists + is published (this
    // creates it on first use), then run the shared cloud-sync pass.
    await ensureIdentity();
    await doCloudSync();
  }, [ensureIdentity, doCloudSync]);

  const saveTeamEntry = useCallback<VaultCtx["saveTeamEntry"]>(
    async (teamId, input) => {
      const key = teamKeysRef.current.get(teamId);
      if (!key) {
        throw new Error(
          "You don't have this team's key yet. Ask an admin to grant access, then pull to refresh.",
        );
      }
      const payload: EncryptedBlob = await encryptJSON(key, input.secret);
      const now = Date.now();
      const id = input.id ?? newId();
      const existing = input.id
        ? await db().teamEntries.get(input.id)
        : undefined;
      const record: TeamEntryRecord = {
        id,
        teamId,
        folderId: input.folderId ?? existing?.folderId ?? null,
        issuer: input.issuer,
        account: input.account,
        iconHint: input.iconHint ?? null,
        payload,
        sortOrder: input.sortOrder ?? existing?.sortOrder ?? now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await db().teamEntries.put(record);
      const team = await db().teams.get(teamId);
      if (team) await pushTeamVault(team, key);
      return record;
    },
    [],
  );

  const saveTeamFolder = useCallback<VaultCtx["saveTeamFolder"]>(
    async (teamId, input) => {
      const key = teamKeysRef.current.get(teamId);
      if (!key) throw new Error("You don't have this team's key.");
      const now = Date.now();
      const id = input.id ?? newId();
      const existing = input.id
        ? await db().teamFolders.get(input.id)
        : undefined;
      const folder: TeamFolder = {
        id,
        teamId,
        name: input.name,
        color: input.color,
        sortOrder: input.sortOrder ?? existing?.sortOrder ?? now,
        createdAt: existing?.createdAt ?? now,
      };
      await db().teamFolders.put(folder);
      const team = await db().teams.get(teamId);
      if (team) await pushTeamVault(team, key);
      return folder;
    },
    [],
  );

  const deleteTeamFolder = useCallback<VaultCtx["deleteTeamFolder"]>(
    async (teamId, id) => {
      const key = teamKeysRef.current.get(teamId);
      if (!key) throw new Error("You don't have this team's key.");
      await db().transaction("rw", db().teamEntries, db().teamFolders, async () => {
        await db().teamFolders.delete(id);
        const inFolder = await db()
          .teamEntries.where("folderId")
          .equals(id)
          .toArray();
        for (const e of inFolder) {
          await db().teamEntries.update(e.id, { folderId: null });
        }
      });
      const team = await db().teams.get(teamId);
      if (team) await pushTeamVault(team, key);
    },
    [],
  );

  const deleteTeamEntry = useCallback<VaultCtx["deleteTeamEntry"]>(
    async (teamId, id) => {
      const key = teamKeysRef.current.get(teamId);
      if (!key) throw new Error("You don't have this team's key.");
      await db().teamEntries.delete(id);
      const team = await db().teams.get(teamId);
      if (team) await pushTeamVault(team, key);
    },
    [],
  );

  const decryptTeamEntry = useCallback<VaultCtx["decryptTeamEntry"]>(
    async (entry) => {
      const key = teamKeysRef.current.get(entry.teamId);
      if (!key) throw new Error("No key loaded for this team");
      return decryptJSON<EntrySecret>(key, entry.payload);
    },
    [],
  );

  const value = useMemo<VaultCtx>(
    () => ({
      state,
      initialize,
      signUpCloud,
      unlock,
      unlockWithBiometric,
      enableBiometric,
      disableBiometric,
      lock,
      refresh,
      resetLocalVault,
      saveEntry,
      deleteEntry,
      pushNow,
      pullNow,
      decryptEntry,
      decryptAll,
      ensureIdentity,
      getPrivateKey,
      getTeamKey,
      setTeamKey,
      refreshTeams,
      hasTeamAccess,
      saveTeamEntry,
      deleteTeamEntry,
      decryptTeamEntry,
      saveTeamFolder,
      deleteTeamFolder,
    }),
    [
      state,
      initialize,
      signUpCloud,
      unlock,
      unlockWithBiometric,
      enableBiometric,
      disableBiometric,
      lock,
      refresh,
      resetLocalVault,
      saveEntry,
      deleteEntry,
      pushNow,
      pullNow,
      decryptEntry,
      decryptAll,
      ensureIdentity,
      getPrivateKey,
      getTeamKey,
      setTeamKey,
      refreshTeams,
      hasTeamAccess,
      saveTeamEntry,
      deleteTeamEntry,
      decryptTeamEntry,
      saveTeamFolder,
      deleteTeamFolder,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVault(): VaultCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVault must be used within VaultProvider");
  return v;
}

export function useIsUnlocked(): boolean {
  return useVault().state.status === "unlocked";
}
