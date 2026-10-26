import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, FolderPlus, KeyRound, Plus, Search, Users } from "lucide-react";
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
type Group = {
  key: string;
  order: number;
  label?: string;
  color?: string;
  team?: boolean;
  items: RenderItem[];
};
type RenderItem =
  | { kind: "personal"; entry: EntryRecord }
  | { kind: "team"; entry: TeamEntryRecord; team: TeamRecord };

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
        out.push({ kind: "personal", entry: e });
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
        out.push({ kind: "team", entry: e, team });
      }
    }
    return out;
  }, [
    entries,
    teamEntries,
    activeFolder,
    activeTeamFolder,
    search,
    teamById,
    hasTeamAccess,
  ]);

  // Sections make folder membership explicit instead of per-row badges. A
  // heading is shown only when it says something the active filter doesn't.
  const groups = useMemo(() => {
    const byKey = new Map<string, Group>();
    const add = (key: string, order: number, make: () => Omit<Group, "key" | "order" | "items">, item: RenderItem) => {
      let g = byKey.get(key);
      if (!g) {
        g = { key, order, items: [], ...make() };
        byKey.set(key, g);
      }
      g.items.push(item);
    };
    // Order by list position: sortOrder values are timestamps, not indices.
    const teamIndex = new Map(teams.map((t, i) => [t.id, i]));
    const folderIndex = new Map(folders.map((f, i) => [f.id, i]));
    const teamFolderIndex = new Map(teamFolders.map((f, i) => [f.id, i]));
    for (const item of items) {
      if (item.kind === "personal") {
        const f = item.entry.folderId ? folderById.get(item.entry.folderId) : undefined;
        if (f) add(`f:${f.id}`, folderIndex.get(f.id) ?? 0, () => ({ label: f.name, color: f.color }), item);
        else add("unfiled", 1e5, () => ({ label: "Unfiled" }), item);
      } else {
        const t = item.team;
        const f = item.entry.folderId ? teamFolderById.get(item.entry.folderId) : undefined;
        const base = 2e6 + (teamIndex.get(t.id) ?? 0) * 1e4;
        // Inside a single team's view the team name is implied by the filter.
        const prefix = activeTeamId ? "" : `${t.name} / `;
        if (f)
          add(`t:${t.id}:${f.id}`, base + (teamFolderIndex.get(f.id) ?? 0), () => ({ label: prefix + f.name, color: f.color, team: true }), item);
        else
          add(`t:${t.id}`, base + 9999, () => ({ label: activeTeamId ? "Unfiled" : t.name, color: t.color, team: true }), item);
      }
    }
    const list = [...byKey.values()].sort((a, b) => a.order - b.order);
    const filteredToOneFolder =
      (activeFolder !== ALL_FOLDERS && !activeTeamId) ||
      (activeTeamId && activeTeamFolder !== ALL_FOLDERS);
    const showHeadings =
      !filteredToOneFolder && (list.length > 1 || list[0]?.key !== "unfiled");
    return list.map((g) => ({ ...g, label: showHeadings ? g.label : undefined }));
  }, [items, teams, folders, teamFolders, folderById, teamFolderById, activeFolder, activeTeamId, activeTeamFolder]);

  const [collapsed, toggleCollapsed] = useCollapsedGroups();
  // Searching expands every section so matches are never hidden.
  const searching = search.trim() !== "";

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

  const hasCodes = entries.length + teamEntries.length > 0;
  // The filter row only earns its space when there is something to filter by.
  const showFilters = hasFolders || teams.length > 0;

  return (
    <div>
      {/* Sticky header cancels the shell's safe-area padding so it sits under
          the status bar while scrolling instead of leaving a gap above it. */}
      <header
        className="sticky top-0 z-20 -mx-4 px-4 pb-3 bg-bg/95 backdrop-blur"
        style={{
          marginTop: "calc(-1 * max(1rem, var(--safe-top)))",
          paddingTop: "calc(max(1rem, var(--safe-top)) + 1rem)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Aegis</h1>
          <div className="flex items-center gap-1 -mr-2">
            <Link to="/teams" className="icon-btn" aria-label="Teams">
              <Users size={20} />
            </Link>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowFolderManager(true)}
              aria-label={folderManagerTeamId ? "Team folders" : "Folders"}
            >
              <FolderPlus size={20} />
            </button>
          </div>
        </div>

        {hasCodes && (
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              type="search"
              placeholder="Search"
              aria-label="Search issuer or account"
              className="w-full rounded-lg bg-white/[0.06] pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:bg-white/[0.08] focus:ring-2 focus:ring-accent/40"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        {showFilters && (
          <div
            className="flex gap-1.5 overflow-x-auto -mx-4 px-4 mt-3"
            style={{ scrollbarWidth: "none" }}
          >
            <FolderChip
              active={activeFolder === ALL_FOLDERS}
              onClick={() => setActiveFolder(ALL_FOLDERS)}
              label="All"
              count={entries.length}
            />
            {folders.map((f) => (
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
            {hasFolders && unfiledCount > 0 && (
              <FolderChip
                active={activeFolder === UNFILED}
                onClick={() => setActiveFolder(UNFILED)}
                label="Unfiled"
                count={unfiledCount}
              />
            )}
          </div>
        )}

        {/* Second row: folders within the selected team. */}
        {activeTeamId && (activeTeamFolders.length > 0 || activeTeamUnfiled > 0) && (
        <div
          className="flex gap-1.5 overflow-x-auto -mx-4 px-4 mt-2"
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

      </header>

      {items.length === 0 ? (
        <ul>
          <EmptyState
            empty={entries.length === 0 && teamEntries.length === 0}
            search={search.trim() !== ""}
          />
        </ul>
      ) : (
        groups.map((g) =>
          g.label ? (
            <GroupSection
              key={g.key}
              group={g}
              open={searching || !collapsed.has(g.key)}
              onToggle={() => toggleCollapsed(g.key)}
              onEdit={setEditing}
            />
          ) : (
            <CodeList key={g.key} items={g.items} onEdit={setEditing} />
          ),
        )
      )}

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

const COLLAPSED_KEY = "aegis.collapsedGroups";

// Which sections are collapsed, remembered per device. Storage can be blocked
// (private mode), so every access is guarded and falls back to all-expanded.
function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  return [collapsed, toggle] as const;
}

function CodeList({
  items,
  onEdit,
}: {
  items: RenderItem[];
  onEdit: (e: AnyEntry) => void;
}) {
  return (
    <ul className="divide-y divide-white/[0.06]">
      {items.map((item) => (
        <CodeCard
          key={item.kind === "team" ? `t_${item.entry.id}` : item.entry.id}
          entry={item.entry}
          onEdit={onEdit}
        />
      ))}
    </ul>
  );
}

// An accordion section: the heading toggles the list, which animates its
// height via a 0fr/1fr grid row so it works without measuring content.
function GroupSection({
  group,
  open,
  onToggle,
  onEdit,
}: {
  group: Group;
  open: boolean;
  onToggle: () => void;
  onEdit: (e: AnyEntry) => void;
}) {
  const panelId = `group-${group.key}`;
  return (
    <section className="border-b border-white/[0.06] last:border-b-0">
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full flex items-center gap-2 py-3.5 text-left text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors"
        >
          {group.team ? (
            <Users size={14} className="shrink-0" style={{ color: group.color }} />
          ) : (
            group.color && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: group.color }}
              />
            )
          )}
          <span className="min-w-0 break-words">{group.label}</span>
          <span className="text-zinc-600 tabular-nums">{group.items.length}</span>
          <ChevronDown
            size={16}
            className={cn(
              "ml-auto shrink-0 text-zinc-500 transition-transform duration-300",
              !open && "-rotate-90",
            )}
          />
        </button>
      </h2>
      <div
        id={panelId}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        {/* `inert` keeps collapsed rows out of tab order. React 18's types
            lack it, so it is passed as a plain attribute. */}
        <div
          className="overflow-hidden"
          {...(open ? {} : ({ inert: "" } as Record<string, string>))}
        >
          <div className="border-t border-white/[0.06]">
            <CodeList items={group.items} onEdit={onEdit} />
          </div>
        </div>
      </div>
    </section>
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
    return <li className="py-10 text-sm text-zinc-500">No codes match.</li>;
  }
  if (empty) {
    return (
      <li className="pt-16">
        <KeyRound size={28} className="text-zinc-600 mb-4" />
        <h2 className="text-lg font-semibold mb-1">No codes yet</h2>
        <p className="text-sm text-zinc-400 mb-6 max-w-xs">
          Scan the QR code a site shows when you turn on two-factor sign-in, or
          import from another authenticator.
        </p>
        <div className="flex gap-2">
          <Link to="/add" className="btn-primary">
            <Plus size={16} /> Add code
          </Link>
          <Link to="/import" className="btn-ghost">
            Import
          </Link>
        </div>
      </li>
    );
  }
  return (
    <li className="py-10 text-sm text-zinc-500">No codes in this folder yet.</li>
  );
}
