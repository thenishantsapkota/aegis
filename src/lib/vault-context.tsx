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
  type VaultMeta,
} from "./db";
import {
  enableBiometric as createBiometricBinding,
  unlockWithBiometric as unlockBindingRaw,
  type BiometricBinding,
} from "./biometric";
import { pullRemoteVault, pushLocalVault } from "./sync";
import { isAppwriteConfigured } from "./appwrite";

type VaultState =
  | { status: "loading" }
  | { status: "uninitialized" } // no vault exists on this device
  | { status: "locked"; email: string | null; hasBiometric: boolean }
  | { status: "unlocked"; email: string | null; hasBiometric: boolean };

type VaultCtx = {
  state: VaultState;
  /** Create a brand-new vault on this device. */
  initialize: (password: string, email?: string | null) => Promise<void>;
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
  saveEntry: (input: {
    id?: string;
    folderId: string | null;
    issuer: string;
    account: string;
    iconHint?: string | null;
    secret: EntrySecret;
    sortOrder?: number;
  }) => Promise<EntryRecord>;
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
      };
      await db().meta.put(meta);
      metaRef.current = meta;
      keyRef.current = key;
      startUnlockWindow();
      setState(unlockedState(meta));
    },
    [startUnlockWindow],
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
      setState(unlockedState(meta));
      return true;
    },
    [startUnlockWindow],
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
    setState(unlockedState(meta));
    return true;
  }, [startUnlockWindow]);

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
    async (input) => {
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
      scheduleSync();
      return record;
    },
    [scheduleSync],
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

  const value = useMemo<VaultCtx>(
    () => ({
      state,
      initialize,
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
    }),
    [
      state,
      initialize,
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
