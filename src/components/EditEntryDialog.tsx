import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Trash2, Users, X } from "lucide-react";
import {
  type EntryRecord,
  type EntrySecret,
  type TeamEntryRecord,
} from "~/lib/db";
import { useVault } from "~/lib/vault-context";
import {
  DestinationSelect,
  destForFolder,
  destForTeam,
  parseDest,
  TeamFolderPicker,
  useDestinations,
} from "./DestinationSelect";

// Rename / re-file / move / delete an existing entry (personal or team).
// Editing in place re-encrypts and syncs. Changing the destination across the
// personal/team boundary (or between teams) MOVES the code: it's re-created in
// the target vault with a fresh id, then removed from the source.

type AnyEntry = EntryRecord | TeamEntryRecord;

function isTeamEntry(e: AnyEntry): e is TeamEntryRecord {
  return "teamId" in e;
}

export function EditEntryDialog({
  entry,
  onClose,
}: {
  entry: AnyEntry;
  onClose: () => void;
}) {
  const {
    saveEntry,
    decryptEntry,
    deleteEntry,
    saveTeamEntry,
    decryptTeamEntry,
    deleteTeamEntry,
  } = useVault();
  const { folders, writableTeams } = useDestinations();
  const isTeam = isTeamEntry(entry);

  const initialDest = isTeamEntry(entry)
    ? destForTeam(entry.teamId)
    : destForFolder(entry.folderId);
  const initialTeamFolderId = isTeamEntry(entry) ? (entry.folderId ?? "") : "";

  const [issuer, setIssuer] = useState(entry.issuer);
  const [account, setAccount] = useState(entry.account);
  const [dest, setDest] = useState(initialDest);
  const [teamFolderId, setTeamFolderId] = useState(initialTeamFolderId);
  const [secret, setSecret] = useState<EntrySecret | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // We need the decrypted secret to re-encrypt with new metadata / new vault.
  useEffect(() => {
    let alive = true;
    const p = isTeamEntry(entry)
      ? decryptTeamEntry(entry)
      : decryptEntry(entry);
    p.then((s) => {
      if (alive) setSecret(s);
    }).catch((e) => {
      if (alive) setError(e instanceof Error ? e.message : "Decrypt failed");
    });
    return () => {
      alive = false;
    };
  }, [entry, decryptEntry, decryptTeamEntry]);

  const target = parseDest(dest);
  // A "move" crosses the personal/team boundary or switches teams. Staying
  // personal (even changing folder) or staying in the same team is in-place.
  const isMove = isTeamEntry(entry)
    ? target.kind !== "team" || target.teamId !== entry.teamId
    : target.kind === "team";

  async function onSave() {
    if (!secret) return;
    setBusy(true);
    setError(null);
    try {
      if (!isMove) {
        // In-place edit.
        if (target.kind === "team") {
          await saveTeamEntry(target.teamId, {
            id: entry.id,
            folderId: teamFolderId || null,
            issuer: issuer.trim(),
            account: account.trim(),
            iconHint: entry.iconHint ?? null,
            secret,
            sortOrder: entry.sortOrder,
          });
        } else {
          await saveEntry({
            id: entry.id,
            folderId: target.folderId,
            issuer: issuer.trim(),
            account: account.trim(),
            iconHint: entry.iconHint ?? null,
            secret,
            sortOrder: entry.sortOrder,
          });
        }
      } else {
        // Move: create in the target vault (fresh id), then delete the source.
        if (target.kind === "team") {
          await saveTeamEntry(target.teamId, {
            folderId: teamFolderId || null,
            issuer: issuer.trim(),
            account: account.trim(),
            iconHint: entry.iconHint ?? null,
            secret,
          });
        } else {
          await saveEntry(
            {
              folderId: target.folderId,
              issuer: issuer.trim(),
              account: account.trim(),
              iconHint: entry.iconHint ?? null,
              secret,
            },
            { immediateSync: true },
          );
        }
        if (isTeamEntry(entry)) {
          await deleteTeamEntry(entry.teamId, entry.id);
        } else {
          await deleteEntry(entry.id);
        }
      }
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
      if (isTeamEntry(entry)) {
        await deleteTeamEntry(entry.teamId, entry.id);
      } else {
        await deleteEntry(entry.id);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  // Folder change within the SAME team (not a move) still counts as an edit.
  const sameTeam =
    target.kind === "team" &&
    isTeamEntry(entry) &&
    target.teamId === entry.teamId;
  const folderChanged =
    target.kind === "team" &&
    teamFolderId !== (sameTeam ? initialTeamFolderId : "");
  const dirty =
    issuer.trim() !== entry.issuer ||
    account.trim() !== entry.account ||
    dest !== initialDest ||
    folderChanged;

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
          <h2 className="text-lg font-semibold inline-flex items-center gap-2">
            {isTeam && <Users size={16} className="text-accent" />}
            {isTeam ? "Edit shared code" : "Edit entry"}
          </h2>
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

          <DestinationSelect
            folders={folders}
            teams={writableTeams}
            value={dest}
            onChange={(v) => {
              setDest(v);
              const t = parseDest(v);
              setTeamFolderId(
                t.kind === "team" &&
                  isTeamEntry(entry) &&
                  t.teamId === entry.teamId
                  ? initialTeamFolderId
                  : "",
              );
            }}
            label="Location"
          />

          {target.kind === "team" && (
            <TeamFolderPicker
              teamId={target.teamId}
              value={teamFolderId}
              onChange={setTeamFolderId}
            />
          )}

          {isMove && (
            <div className="flex items-start gap-2 text-xs text-accent">
              <ArrowRightLeft size={14} className="mt-0.5 shrink-0" />
              <span>
                {target.kind === "team"
                  ? "This will move the code into the team and share it with all members (encrypted with the team key)."
                  : "This will move the code out of the team and back into your personal vault."}
              </span>
            </div>
          )}

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
              {busy ? "Saving…" : isMove ? "Move" : "Save"}
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
