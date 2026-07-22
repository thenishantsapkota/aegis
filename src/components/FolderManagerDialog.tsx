import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { db, newId, type Folder, type TeamFolder } from "~/lib/db";
import { useVault } from "~/lib/vault-context";

const FOLDER_COLORS = [
  "#63a7ff",
  "#55cfa1",
  "#f4bf4f",
  "#ef5466",
  "#b07cff",
  "#7ad1ff",
  "#f783ac",
  "#94a3b8",
];

// Manages personal folders by default. Pass a `teamId` to manage that team's
// shared folders instead (which live in the encrypted team vault).
export function FolderManagerDialog({
  onClose,
  teamId,
}: {
  onClose: () => void;
  teamId?: string;
}) {
  const { saveTeamFolder, deleteTeamFolder } = useVault();
  const isTeam = !!teamId;

  const folders =
    useLiveQuery<Array<Folder | TeamFolder>>(
      () =>
        teamId
          ? db().teamFolders.where("teamId").equals(teamId).sortBy("sortOrder")
          : db().folders.orderBy("sortOrder").toArray(),
      [teamId],
    ) ?? [];

  const [name, setName] = useState("");
  const [color, setColor] = useState(FOLDER_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (teamId) {
        await saveTeamFolder(teamId, { name: name.trim(), color });
      } else {
        const now = Date.now();
        await db().folders.put({
          id: newId(),
          name: name.trim(),
          color,
          sortOrder: now,
          createdAt: now,
        });
      }
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add folder");
    } finally {
      setBusy(false);
    }
  }

  async function removeFolder(id: string) {
    if (!confirm("Delete this folder? Codes inside will become unfiled.")) return;
    setBusy(true);
    setError(null);
    try {
      if (teamId) {
        await deleteTeamFolder(teamId, id);
      } else {
        await db().transaction("rw", [db().folders, db().entries], async () => {
          await db().folders.delete(id);
          const inFolder = await db()
            .entries.where("folderId")
            .equals(id)
            .toArray();
          for (const e of inFolder) {
            await db().entries.update(e.id, { folderId: null });
          }
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete folder");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md rounded-t-2xl sm:rounded-2xl animate-fade-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - 1rem)",
        }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-semibold">
            {isTeam ? "Team folders" : "Folders"}
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-bg-elev border border-border flex items-center justify-center"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="overflow-y-auto overscroll-contain px-5 pb-5"
          style={{ paddingBottom: "max(1.25rem, var(--safe-bottom))" }}
        >
          {isTeam && (
            <p className="text-xs text-muted mb-4">
              Team folders are shared with everyone on the team.
            </p>
          )}
          <form onSubmit={addFolder} className="space-y-3 mb-5">
            <div>
              <label className="label">New folder name</label>
              <input
                type="text"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Work, Personal, Finance…"
              />
            </div>
            <div>
              <label className="label">Color</label>
              <div className="flex flex-wrap gap-2">
                {FOLDER_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setColor(c)}
                    className="w-7 h-7 rounded-full border-2 transition"
                    style={{
                      background: c,
                      borderColor: color === c ? "white" : "transparent",
                    }}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
            </div>
            {error && <div className="text-sm text-danger">{error}</div>}
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? "…" : "Add folder"}
            </button>
          </form>

          <div className="space-y-2">
            {folders.length === 0 ? (
              <p className="text-muted text-sm text-center py-4">
                No folders yet.
              </p>
            ) : (
              folders.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-bg-elev border border-border"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ background: f.color }}
                  />
                  <span className="flex-1 truncate">{f.name}</span>
                  <button
                    onClick={() => removeFolder(f.id)}
                    disabled={busy}
                    className="w-9 h-9 rounded-xl text-danger hover:bg-danger/10 flex items-center justify-center"
                    aria-label={`Delete ${f.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
