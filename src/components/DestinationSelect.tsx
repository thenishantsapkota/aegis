import { useLiveQuery } from "dexie-react-hooks";
import { db, type Folder, type TeamFolder, type TeamRecord } from "~/lib/db";
import { useVault } from "~/lib/vault-context";

const NEW_FOLDER_COLORS = [
  "#63a7ff",
  "#55cfa1",
  "#f4bf4f",
  "#ef5466",
  "#b07cff",
  "#7ad1ff",
];

// A "destination" is where a code lives: the personal vault (optionally a
// folder) or a team. Encoded as a string so it slots into a <select>:
//   "folder:"        → personal, unfiled
//   "folder:<id>"    → personal, in a folder
//   "team:<id>"      → shared with a team
export const PERSONAL_UNFILED = "folder:";

export function destForFolder(folderId: string | null): string {
  return `folder:${folderId ?? ""}`;
}
export function destForTeam(teamId: string): string {
  return `team:${teamId}`;
}

export type ParsedDest =
  | { kind: "personal"; folderId: string | null }
  | { kind: "team"; teamId: string };

export function parseDest(dest: string): ParsedDest {
  if (dest.startsWith("team:")) {
    return { kind: "team", teamId: dest.slice("team:".length) };
  }
  const folderId = dest.startsWith("folder:")
    ? dest.slice("folder:".length) || null
    : null;
  return { kind: "personal", folderId };
}

// Folders (personal) + teams the user can WRITE to (owner/admin with the key).
export function useDestinations() {
  const { hasTeamAccess } = useVault();
  const folders =
    useLiveQuery<Folder[]>(
      () => db().folders.orderBy("sortOrder").toArray(),
      [],
    ) ?? [];
  const teams = useLiveQuery<TeamRecord[]>(() => db().teams.toArray(), []) ?? [];
  const writableTeams = teams.filter(
    (t) => t.role !== "member" && hasTeamAccess(t.id),
  );
  return { folders, writableTeams };
}

export function DestinationSelect({
  folders,
  teams,
  value,
  onChange,
  label = "Save to",
}: {
  folders: Folder[];
  teams: TeamRecord[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <optgroup label="Personal">
          <option value={PERSONAL_UNFILED}>Unfiled</option>
          {folders.map((f) => (
            <option key={f.id} value={destForFolder(f.id)}>
              {f.name}
            </option>
          ))}
        </optgroup>
        {teams.length > 0 && (
          <optgroup label="Teams (shared)">
            {teams.map((t) => (
              <option key={t.id} value={destForTeam(t.id)}>
                {t.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

const NEW_FOLDER = "__new__";

// Folder picker for a team destination. `value` is a team folder id or "" for
// unfiled. Selecting "New folder…" prompts for a name and creates it.
export function TeamFolderPicker({
  teamId,
  value,
  onChange,
}: {
  teamId: string;
  value: string;
  onChange: (folderId: string) => void;
}) {
  const { saveTeamFolder } = useVault();
  const folders =
    useLiveQuery<TeamFolder[]>(
      () => db().teamFolders.where("teamId").equals(teamId).sortBy("sortOrder"),
      [teamId],
    ) ?? [];

  async function onSelect(v: string) {
    if (v === NEW_FOLDER) {
      const name = window.prompt("New team folder name:");
      if (!name || !name.trim()) return;
      const color =
        NEW_FOLDER_COLORS[folders.length % NEW_FOLDER_COLORS.length];
      const created = await saveTeamFolder(teamId, { name: name.trim(), color });
      onChange(created.id);
      return;
    }
    onChange(v);
  }

  return (
    <div>
      <label className="label">Team folder</label>
      <select
        className="input"
        value={value}
        onChange={(e) => void onSelect(e.target.value)}
      >
        <option value="">Unfiled</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
        <option value={NEW_FOLDER}>＋ New folder…</option>
      </select>
    </div>
  );
}
