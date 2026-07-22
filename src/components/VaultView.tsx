import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FolderPlus, Plus, Search, Users } from "lucide-react";
import {
  db,
  type EntryRecord,
  type Folder,
  type TeamEntryRecord,
  type TeamFolder,
  type TeamRecord,
} from "~/lib/db";
import { useVault } from "~/lib/vault-context";
import { CodeCard } from "./CodeCard";
import { EditEntryDialog } from "./EditEntryDialog";
import { FolderManagerDialog } from "./FolderManagerDialog";
import { cn } from "~/lib/cn";

const ALL_FOLDERS = "__all__";
const UNFILED = "__unfiled__";
const TEAM_PREFIX = "team:";

type AnyEntry = EntryRecord | TeamEntryRecord;
type RenderItem =
  | { kind: "personal"; entry: EntryRecord; folder?: Folder }
  | { kind: "team"; entry: TeamEntryRecord; team: TeamRecord; folder?: TeamFolder };

export function VaultView() {
  const { hasTeamAccess } = useVault();
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
  const teams =
    useLiveQuery<TeamRecord[]>(() => db().teams.toArray(), []) ?? [];
  const teamEntries =
    useLiveQuery<TeamEntryRecord[]>(
      () => db().teamEntries.orderBy("sortOrder").toArray(),
      [],
    ) ?? [];
  const teamFolders =
    useLiveQuery<TeamFolder[]>(
      () => db().teamFolders.orderBy("sortOrder").toArray(),
      [],
    ) ?? [];

  const [activeFolder, setActiveFolderRaw] = useState<string>(ALL_FOLDERS);
  // Sub-filter within a selected team (ALL / UNFILED / a team-folder id).
  const [activeTeamFolder, setActiveTeamFolder] = useState<string>(ALL_FOLDERS);
  const [search, setSearch] = useState("");
  const [showFolderManager, setShowFolderManager] = useState(false);
  const [editing, setEditing] = useState<AnyEntry | null>(null);

  // Switching the top-level filter resets the team sub-folder filter.
  const setActiveFolder = (v: string) => {
    setActiveFolderRaw(v);
    setActiveTeamFolder(ALL_FOLDERS);
  };

  const folderById = useMemo(
    () => new Map(folders.map((f) => [f.id, f])),
    [folders],
  );
  const teamById = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams],
  );
  const teamFolderById = useMemo(
    () => new Map(teamFolders.map((f) => [f.id, f])),
    [teamFolders],
  );

  const activeTeamId = activeFolder.startsWith(TEAM_PREFIX)
    ? activeFolder.slice(TEAM_PREFIX.length)
    : null;

  // Team labels/folder labels only add information in the mixed "All" view.
  const showLabels = activeFolder === ALL_FOLDERS;

  const items = useMemo<RenderItem[]>(() => {
    const q = search.trim().toLowerCase();
    const matches = (e: AnyEntry) =>
      !q ||
      e.issuer.toLowerCase().includes(q) ||
      e.account.toLowerCase().includes(q);

    const out: RenderItem[] = [];
    const wantTeam = activeFolder.startsWith(TEAM_PREFIX)
      ? activeFolder.slice(TEAM_PREFIX.length)
      : null;

    // Personal entries (hidden when a specific team is selected).
    if (!wantTeam) {
      let list = entries;
      if (activeFolder === UNFILED) list = list.filter((e) => !e.folderId);
      else if (activeFolder !== ALL_FOLDERS)
        list = list.filter((e) => e.folderId === activeFolder);
      for (const e of list) {
        if (!matches(e)) continue;
        out.push({
          kind: "personal",
          entry: e,
          folder:
            showLabels && e.folderId ? folderById.get(e.folderId) : undefined,
        });
      }
    }

    // Team entries appear in "All" and in their own team filter.
    if (activeFolder === ALL_FOLDERS || wantTeam) {
      for (const e of teamEntries) {
        if (wantTeam && e.teamId !== wantTeam) continue;
        const team = teamById.get(e.teamId);
        if (!team) continue;
        if (!hasTeamAccess(team.id)) continue; // key not loaded yet
        if (!matches(e)) continue;
        // Sub-folder filter, only when viewing a single team.
        if (wantTeam && activeTeamFolder === UNFILED && e.folderId) continue;
        if (
          wantTeam &&
          activeTeamFolder !== ALL_FOLDERS &&
          activeTeamFolder !== UNFILED &&
          e.folderId !== activeTeamFolder
        )
          continue;
        // Show a folder badge in the mixed "All" view or in a team's "All".
        const labelFolder =
          (showLabels || (wantTeam && activeTeamFolder === ALL_FOLDERS)) &&
          e.folderId
            ? teamFolderById.get(e.folderId)
            : undefined;
        out.push({ kind: "team", entry: e, team, folder: labelFolder });
      }
    }
    return out;
  }, [
    entries,
    teamEntries,
    activeFolder,
    activeTeamFolder,
    search,
    showLabels,
    folderById,
    teamById,
    teamFolderById,
    hasTeamAccess,
  ]);

  const unfiledCount = entries.filter((e) => !e.folderId).length;
  const hasFolders = folders.length > 0;

  const activeTeam = activeTeamId ? teamById.get(activeTeamId) : undefined;
  const canManageTeamFolders = !!activeTeam && activeTeam.role !== "member";
  const activeTeamFolders = activeTeamId
    ? teamFolders.filter((f) => f.teamId === activeTeamId)
    : [];
  const activeTeamUnfiled = activeTeamId
    ? teamEntries.filter((e) => e.teamId === activeTeamId && !e.folderId).length
    : 0;
  // The folder button manages the active team's folders when a writable team is
  // selected; otherwise it manages personal folders.
  const folderManagerTeamId = canManageTeamFolders ? activeTeamId : null;

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
          <Link
            to="/teams"
            className="btn-ghost !rounded-full !px-3"
            aria-label="Teams"
          >
            <Users size={18} />
          </Link>
          <button
            type="button"
            className="btn-ghost !rounded-full !px-3"
            onClick={() => setShowFolderManager(true)}
            aria-label={folderManagerTeamId ? "Team folders" : "Folders"}
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
        {teams.map((t) => (
          <FolderChip
            key={t.id}
            active={activeFolder === TEAM_PREFIX + t.id}
            onClick={() => setActiveFolder(TEAM_PREFIX + t.id)}
            label={t.name}
            color={t.color}
            count={teamEntries.filter((e) => e.teamId === t.id).length}
            icon={<Users size={11} />}
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

      {/* Second row: folders within the selected team. */}
      {activeTeamId && (activeTeamFolders.length > 0 || activeTeamUnfiled > 0) && (
        <div
          className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-2 mb-2"
          style={{ scrollbarWidth: "none" }}
        >
          <FolderChip
            active={activeTeamFolder === ALL_FOLDERS}
            onClick={() => setActiveTeamFolder(ALL_FOLDERS)}
            label="All"
            count={teamEntries.filter((e) => e.teamId === activeTeamId).length}
          />
          {activeTeamFolders.map((f) => (
            <FolderChip
              key={f.id}
              active={activeTeamFolder === f.id}
              onClick={() => setActiveTeamFolder(f.id)}
              label={f.name}
              color={f.color}
              count={
                teamEntries.filter(
                  (e) => e.teamId === activeTeamId && e.folderId === f.id,
                ).length
              }
            />
          ))}
          {activeTeamUnfiled > 0 && (
            <FolderChip
              active={activeTeamFolder === UNFILED}
              onClick={() => setActiveTeamFolder(UNFILED)}
              label="Unfiled"
              count={activeTeamUnfiled}
            />
          )}
        </div>
      )}

      <div className="space-y-2.5 mt-3">
        {items.length === 0 ? (
          <EmptyState
            empty={entries.length === 0 && teamEntries.length === 0}
            search={search.trim() !== ""}
          />
        ) : (
          items.map((item) =>
            item.kind === "team" ? (
              <CodeCard
                key={`t_${item.entry.id}`}
                entry={item.entry}
                onEdit={setEditing}
                teamName={showLabels ? item.team.name : undefined}
                teamColor={item.team.color}
                folderName={item.folder?.name}
                folderColor={item.folder?.color}
              />
            ) : (
              <CodeCard
                key={item.entry.id}
                entry={item.entry}
                onEdit={setEditing}
                folderName={item.folder?.name}
                folderColor={item.folder?.color}
              />
            ),
          )
        )}
      </div>

      {showFolderManager && (
        <FolderManagerDialog
          teamId={folderManagerTeamId ?? undefined}
          onClose={() => setShowFolderManager(false)}
        />
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
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
  count: number;
  icon?: React.ReactNode;
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
      {icon ? (
        <span style={{ color }}>{icon}</span>
      ) : (
        color && (
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: color }}
          />
        )
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
