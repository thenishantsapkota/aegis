import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FolderPlus, Plus, Search } from "lucide-react";
import { db, type EntryRecord, type Folder } from "~/lib/db";
import { CodeCard } from "./CodeCard";
import { EditEntryDialog } from "./EditEntryDialog";
import { FolderManagerDialog } from "./FolderManagerDialog";
import { cn } from "~/lib/cn";

const ALL_FOLDERS = "__all__";
const UNFILED = "__unfiled__";

export function VaultView() {
  const folders =
    useLiveQuery<Folder[]>(
      () => db().folders.orderBy("sortOrder").toArray(),
      [],
    ) ?? [];
  const entries =
    useLiveQuery<EntryRecord[]>(
      () => db().entries.orderBy("sortOrder").toArray(),
      [],
    ) ?? [];

  const [activeFolder, setActiveFolder] = useState<string>(ALL_FOLDERS);
  const [search, setSearch] = useState("");
  const [showFolderManager, setShowFolderManager] = useState(false);
  const [editing, setEditing] = useState<EntryRecord | null>(null);

  const filtered = useMemo(() => {
    let list = entries;
    if (activeFolder === UNFILED) {
      list = list.filter((e) => !e.folderId);
    } else if (activeFolder !== ALL_FOLDERS) {
      list = list.filter((e) => e.folderId === activeFolder);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.issuer.toLowerCase().includes(q) ||
          e.account.toLowerCase().includes(q),
      );
    }
    return list;
  }, [entries, activeFolder, search]);

  const unfiledCount = entries.filter((e) => !e.folderId).length;
  const hasFolders = folders.length > 0;

  return (
    <div className="pt-6 animate-fade-in">
      <header className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight leading-none">
            <span className="text-gradient">Aegis</span>
          </h1>
          <p className="text-sm text-muted mt-1">Codes you carry</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost !rounded-full !px-3"
            onClick={() => setShowFolderManager(true)}
            aria-label="Folders"
          >
            <FolderPlus size={18} />
          </button>
          <Link
            to="/add"
            className="btn-primary !rounded-full !px-4"
            aria-label="Add code"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">Add</span>
          </Link>
        </div>
      </header>

      <div className="relative mb-5">
        <Search
          size={16}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          placeholder="Search issuer or account…"
          className="input pl-11"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div
        className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-2 mb-2"
        style={{ scrollbarWidth: "none" }}
      >
        <FolderChip
          active={activeFolder === ALL_FOLDERS}
          onClick={() => setActiveFolder(ALL_FOLDERS)}
          label="All"
          count={entries.length}
        />
        {hasFolders &&
          folders.map((f) => (
            <FolderChip
              key={f.id}
              active={activeFolder === f.id}
              onClick={() => setActiveFolder(f.id)}
              label={f.name}
              color={f.color}
              count={entries.filter((e) => e.folderId === f.id).length}
            />
          ))}
        {unfiledCount > 0 && (
          <FolderChip
            active={activeFolder === UNFILED}
            onClick={() => setActiveFolder(UNFILED)}
            label="Unfiled"
            count={unfiledCount}
          />
        )}
      </div>

      <div className="space-y-2.5 mt-3">
        {filtered.length === 0 ? (
          <EmptyState
            empty={entries.length === 0}
            search={search.trim() !== ""}
          />
        ) : (
          filtered.map((e) => (
            <CodeCard key={e.id} entry={e} onEdit={setEditing} />
          ))
        )}
      </div>

      {showFolderManager && (
        <FolderManagerDialog onClose={() => setShowFolderManager(false)} />
      )}
      {editing && (
        <EditEntryDialog entry={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function FolderChip({
  active,
  onClick,
  label,
  color,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "chip whitespace-nowrap shrink-0",
        active ? "chip-active" : "chip-inactive",
      )}
    >
      {color && (
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: color }}
        />
      )}
      {label}
      <span className="text-[10px] opacity-60 tabular-nums">{count}</span>
    </button>
  );
}

function EmptyState({ empty, search }: { empty: boolean; search: boolean }) {
  if (search) {
    return (
      <div className="text-center text-muted py-12 text-sm">
        No matches.
      </div>
    );
  }
  if (empty) {
    return (
      <div className="text-center py-12">
        <p className="text-muted mb-4">Your vault is empty.</p>
        <Link to="/add" className="btn-primary">
          <Plus size={18} /> Add your first code
        </Link>
      </div>
    );
  }
  return (
    <div className="text-center text-muted py-12 text-sm">
      No codes in this folder yet.
    </div>
  );
}
