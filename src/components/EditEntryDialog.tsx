import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { db, type EntryRecord, type EntrySecret, type Folder } from "~/lib/db";
import { useVault } from "~/lib/vault-context";

// Rename / re-folder / delete an existing entry.
// Edits go through saveEntry(), which re-encrypts the payload and triggers
// the debounced auto-sync — so the rename lands on the cloud (and other
// devices) within ~2s.

export function EditEntryDialog({
  entry,
  onClose,
}: {
  entry: EntryRecord;
  onClose: () => void;
}) {
  const { saveEntry, decryptEntry, deleteEntry } = useVault();
  const folders =
    useLiveQuery<Folder[]>(
      () => db().folders.orderBy("sortOrder").toArray(),
      [],
    ) ?? [];

  const [issuer, setIssuer] = useState(entry.issuer);
  const [account, setAccount] = useState(entry.account);
  const [folderId, setFolderId] = useState(entry.folderId ?? "");
  const [secret, setSecret] = useState<EntrySecret | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // We need the decrypted secret to re-encrypt with new metadata on save.
  useEffect(() => {
    let alive = true;
    decryptEntry(entry)
      .then((s) => {
        if (alive) setSecret(s);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Decrypt failed");
      });
    return () => {
      alive = false;
    };
  }, [entry, decryptEntry]);

  async function onSave() {
    if (!secret) return;
    setBusy(true);
    setError(null);
    try {
      await saveEntry({
        id: entry.id,
        folderId: folderId || null,
        issuer: issuer.trim(),
        account: account.trim(),
        iconHint: entry.iconHint ?? null,
        secret,
        sortOrder: entry.sortOrder,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    try {
      await deleteEntry(entry.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    issuer.trim() !== entry.issuer ||
    account.trim() !== entry.account ||
    (folderId || null) !== (entry.folderId ?? null);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card-strong w-full max-w-md rounded-t-2.5xl sm:rounded-2.5xl animate-scale-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - 1rem)",
        }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-semibold">Edit entry</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-muted hover:text-white"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="space-y-4 overflow-y-auto overscroll-contain px-5 pb-5"
          style={{ paddingBottom: "max(1.25rem, var(--safe-bottom))" }}
        >
          <div>
            <label className="label">Issuer</label>
            <input
              className="input"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="GitHub"
              autoCapitalize="words"
              autoCorrect="off"
            />
          </div>
          <div>
            <label className="label">Account</label>
            <input
              className="input"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="alice@example.com"
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="email"
            />
          </div>
          <div>
            <label className="label">Folder</label>
            <select
              className="input"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
            >
              <option value="">Unfiled</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-danger">
              <AlertTriangle size={16} className="mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost flex-1"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              className="btn-primary flex-1"
              disabled={busy || !dirty || !secret}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>

          <div className="pt-3 border-t border-white/[0.06]">
            {confirmingDelete ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-danger flex-1"
                  onClick={onDelete}
                  disabled={busy}
                >
                  <Trash2 size={16} /> Yes, delete this entry
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="btn-danger w-full"
                disabled={busy}
              >
                <Trash2 size={16} /> Delete entry
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
