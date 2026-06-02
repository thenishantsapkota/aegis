import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { db, newId, type Folder } from "~/lib/db";

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

export function FolderManagerDialog({ onClose }: { onClose: () => void }) {
  const folders =
    useLiveQuery<Folder[]>(
      () => db().folders.orderBy("sortOrder").toArray(),
      [],
    ) ?? [];
  const [name, setName] = useState("");
  const [color, setColor] = useState(FOLDER_COLORS[0]);

  async function addFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const now = Date.now();
    await db().folders.put({
      id: newId(),
      name: name.trim(),
      color,
      sortOrder: now,
      createdAt: now,
    });
    setName("");
  }

  async function removeFolder(id: string) {
    if (!confirm("Delete this folder? Codes inside will become unfiled.")) return;
    await db().transaction("rw", [db().folders, db().entries], async () => {
      await db().folders.delete(id);
      const inFolder = await db().entries.where("folderId").equals(id).toArray();
      for (const e of inFolder) {
        await db().entries.update(e.id, { folderId: null });
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md p-5 rounded-t-2xl sm:rounded-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(1.25rem, var(--safe-bottom))" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Folders</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-bg-elev border border-border flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

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
          <button type="submit" className="btn-primary w-full">
            Add folder
          </button>
        </form>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {folders.length === 0 ? (
            <p className="text-muted text-sm text-center py-4">No folders yet.</p>
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
  );
}
