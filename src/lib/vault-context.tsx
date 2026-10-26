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
  toSessionKey,
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
  // The already-decrypted secret for an entry, if this session has one. Lets
  // a remounting code row render its code on the first frame.
  peekSecret: (entry: EntryRecord | TeamEntryRecord) => EntrySecret | undefined;
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

// Stay unlocked for 1 hour after the most recent unlock (across foreground,
// background and page reloads). After that, lock and re-authenticate.
const AUTO_LOCK_MS = 60 * 60 * 1000;
const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000; // hourly background push
const AUTO_SYNC_DEBOUNCE_MS = 2_000; // 2s after a save → push

// An edit bumps updatedAt, so a changed entry never reads a stale secret.
function secretCacheKey(entry: EntryRecord | TeamEntryRecord) {
  return `${"teamId" in entry ? "t" : "p"}:${entry.id}:${entry.updatedAt}`;
}

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
  // Decrypted secrets for this unlock only, keyed by entry version. Wiped on
  // lock alongside the keys.
  const secretCacheRef = useRef<Map<string, EntrySecret>>(new Map());
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
        if (meta && (await resumeSession(meta))) return;
        if (!mounted) return;
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
    secretCacheRef.current = new Map();
    unlockExpiresAtRef.current = null;
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }
    void db().session.delete("session");
    setState((s) =>
      s.status === "unlocked"
        ? { status: "locked", email: s.email, hasBiometric: s.hasBiometric }
        : s,
    );
  }, []);

  // ---- mark unlocked until a deadline ---------------------------------------
  const armAutoLock = useCallback(
    (expiresAt: number) => {
      unlockExpiresAtRef.current = expiresAt;
      if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = setTimeout(doLock, expiresAt - Date.now());
    },
    [doLock],
  );

  // A fresh unlock opens a new one-hour window and persists the key for it,
  // so reloading the page inside the window doesn't lock the vault.
  const startUnlockWindow = useCallback(
    (key: CryptoKey) => {
      const expiresAt = Date.now() + AUTO_LOCK_MS;
      armAutoLock(expiresAt);
      void toSessionKey(key)
        .then((sessionKey) =>
          db().session.put({ id: "session", key: sessionKey, expiresAt }),
        )
        .catch((e) => console.warn("[session] persist failed:", e));
    },
    [armAutoLock],
  );

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

  // Persist a team key for this account, encrypted under the vault key, so our
  // OTHER devices pick it up via the personal vault sync.
  const cacheTeamKey = useCallback(
    async (teamId: string, key: CryptoKey) => {
      const vaultKey = keyRef.current;
      if (!vaultKey) return;
      try {
        const raw = await exportRawVaultKey(key);
        const wrapped = await encryptJSON(vaultKey, Array.from(raw));
        await db().teamKeyCache.put({ teamId, wrapped });
      } catch (e) {
        console.warn("[teams] caching team key failed:", e);
      }
    },
    [],
  );

  // Load every team key we can into memory. Preferred source is the vault-key
  // cache (works on any device of this account); falls back to unwrapping the
  // RSA grant with our identity, then caches that so our other devices get it.
  // Returns how many keys were newly seeded into the cache from an RSA grant —
  // the caller should push if >0 so the cache reaches the account's devices.
  const hydrateTeams = useCallback(async (): Promise<number> => {
    const vaultKey = keyRef.current;
    const pk = privateKeyRef.current;
    const teams = await db().teams.toArray();
    const cache = await db().teamKeyCache.toArray();
    const cacheById = new Map(cache.map((c) => [c.teamId, c]));
    const map = new Map<string, CryptoKey>();
    let seeded = 0;
    for (const t of teams) {
      let key: CryptoKey | null = null;
      const cached = cacheById.get(t.id);
      if (cached && vaultKey) {
        try {
          const arr = await decryptJSON<number[]>(vaultKey, cached.wrapped);
          key = await importRawVaultKey(new Uint8Array(arr));
        } catch (e) {
          console.warn("[teams] cache unwrap failed:", e);
        }
      }
      if (!key && pk) {
        key = await unwrapTeamKeyFor(t, pk);
        if (key) {
          await cacheTeamKey(t.id, key); // seed the cache for other devices
          seeded++;
        }
      }
      if (key) map.set(t.id, key);
    }
    teamKeysRef.current = map;
    return seeded;
  }, [cacheTeamKey]);

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
          if (res.applied) {
            metaRef.current = res.meta;
            // The cloud is authoritative for the shared team identity. If the
            // pull brought one down, adopt its private key and re-derive team
            // keys — otherwise a second device using this account would be
            // stuck on its own keypair and unable to unwrap team grants.
            if (res.meta.identity) {
              try {
                privateKeyRef.current = await unwrapPrivateKey(
                  res.meta.identity,
                  vk,
                );
                await hydrateTeams();
              } catch (e) {
                console.warn("[teams] adopting cloud identity failed:", e);
              }
            } else if (metaRef.current?.identity) {
              // Cloud vault predates identity sync but we have a local identity.
              // Upload it (we just pulled, so local == cloud + our identity) so
              // the other devices on this account converge on the same keypair.
              try {
                const pushed = await pushLocalVault(vk);
                metaRef.current = pushed;
              } catch (e) {
                console.warn("[teams] uploading identity to cloud failed:", e);
              }
            }
          }
        } catch (e) {
          console.warn("[sync] personal pull on login failed:", e);
        }
      }
      // Publish the (possibly just-adopted) public key so teammates can grant us.
      const pubIdentity = metaRef.current?.identity;
      if (pubIdentity) {
        try {
          await publishPublicKey(pubIdentity);
        } catch (e) {
          console.warn("[teams] publishPublicKey failed:", e);
        }
      }
      try {
        await syncMyTeams();
        const seeded = await hydrateTeams();
        // If we just derived team keys from RSA grants, push so the vault-key
        // cache reaches the account's other devices.
        if (seeded > 0 && vk) {
          try {
            const pushed = await pushLocalVault(vk);
            metaRef.current = pushed;
          } catch (e) {
            console.warn("[teams] propagating team key cache failed:", e);
          }
        }
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

  // Resume an unlock session persisted by a previous page load, if it is still
  // inside its window and the key still matches this vault.
  const resumeSession = useCallback(
    async (meta: VaultMeta): Promise<boolean> => {
      try {
        const session = await db().session.get("session");
        if (!session) return false;
        const valid =
          session.expiresAt > Date.now() &&
          (await verifyKeyCheck(session.key, meta.keyCheck));
        if (!valid) {
          await db().session.delete("session");
          return false;
        }
        keyRef.current = session.key;
        armAutoLock(session.expiresAt);
        await afterUnlock(session.key);
        setState(unlockedState(metaRef.current));
        return true;
      } catch (e) {
        console.warn("[session] resume failed:", e);
        return false;
      }
    },
    [armAutoLock, afterUnlock],
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
      startUnlockWindow(key);
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
      startUnlockWindow(vaultKey);
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
      startUnlockWindow(key);
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
        "Biometric unlock returned a key that doesn't match this vault. The binding may be stale. Disable and re-enable biometric.",
      );
    }
    keyRef.current = key;
    startUnlockWindow(key);
    await afterUnlock(key);
    setState(unlockedState(metaRef.current));
    return true;
  }, [startUnlockWindow, afterUnlock]);

  const enableBiometric = useCallback(async () => {
    if (!keyRef.current || !metaRef.current) {
      throw new Error("Vault must be unlocked to enroll biometric.");
    }
    // A key resumed after a reload is non-extractable, so it can't be wrapped.
    if (!keyRef.current.extractable) {
      throw new Error(
        "Lock the vault and unlock it with your password, then turn this on.",
      );
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
    secretCacheRef.current = new Map();
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
    const cacheKey = secretCacheKey(entry);
    const cached = secretCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const secret = await decryptJSON<EntrySecret>(keyRef.current, entry.payload);
    secretCacheRef.current.set(cacheKey, secret);
    return secret;
  }, []);

  const peekSecret = useCallback<VaultCtx["peekSecret"]>(
    (entry) => secretCacheRef.current.get(secretCacheKey(entry)),
    [],
  );

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
      throw new Error("Sign in to cloud sync first. Teams require an account.");
    }
    // Publishing must succeed here (teammates need our key).
    await publishPublicKey(identity);
    // Also persist the identity into the synced personal vault so every other
    // device on this account adopts the SAME keypair (otherwise each device
    // makes its own and can't unwrap the others' team grants).
    try {
      const updated = await pushLocalVault(keyRef.current);
      metaRef.current = updated;
    } catch (e) {
      console.warn("[teams] pushing identity to cloud failed:", e);
    }
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

  const setTeamKey = useCallback<VaultCtx["setTeamKey"]>(
    (teamId, key) => {
      teamKeysRef.current.set(teamId, key);
      // Cache it and push so this account's other devices get the key too.
      void (async () => {
        await cacheTeamKey(teamId, key);
        await backgroundPush();
      })();
    },
    [cacheTeamKey, backgroundPush],
  );

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
      const cacheKey = secretCacheKey(entry);
      const cached = secretCacheRef.current.get(cacheKey);
      if (cached) return cached;
      const secret = await decryptJSON<EntrySecret>(key, entry.payload);
      secretCacheRef.current.set(cacheKey, secret);
      return secret;
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
      peekSecret,
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
      peekSecret,
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
