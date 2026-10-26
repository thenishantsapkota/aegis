import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Crown,
  LogOut,
  Mail,
  Plus,
  RefreshCcw,
  Shield,
  Trash2,
  User as UserIcon,
  Users,
} from "lucide-react";
import { AppShell } from "~/components/AppShell";
import { useVault } from "~/lib/vault-context";
import { db, type TeamRecord, type TeamRole } from "~/lib/db";
import { isAppwriteConfigured } from "~/lib/appwrite";
import {
  acceptInvite,
  createTeam,
  inviteMember,
  leaveTeam,
  listMembers,
  removeMemberAndRotate,
  updateMemberRole,
  type TeamMember,
} from "~/lib/teams";

export const Route = createFileRoute("/teams")({
  component: TeamsRoute,
});

const TEAM_COLORS = [
  "#7c86ff",
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
];

function TeamsRoute() {
  const { state, refreshTeams } = useVault();
  const navigate = useNavigate();
  const [banner, setBanner] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (state.status === "uninitialized") navigate({ to: "/setup" });
    else if (state.status === "locked") navigate({ to: "/unlock" });
  }, [state.status, navigate]);

  // Handle an invite-accept link: /teams?teamId=..&membershipId=..&userId=..&secret=..
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const teamId = p.get("teamId");
    const membershipId = p.get("membershipId");
    const userId = p.get("userId");
    const secret = p.get("secret");
    if (teamId && membershipId && userId && secret) {
      (async () => {
        try {
          await acceptInvite({ teamId, membershipId, userId, secret });
          await refreshTeams();
          setBanner("Invitation accepted. You've joined the team.");
        } catch (e) {
          setBanner(
            e instanceof Error ? `Couldn't accept invite: ${e.message}` : "Invite failed",
          );
        } finally {
          // Strip the invite params from the URL.
          window.history.replaceState({}, "", "/teams");
        }
      })();
    }
  }, [refreshTeams]);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    setBanner(null);
    try {
      await refreshTeams();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [refreshTeams]);

  // Pull the team list once on open.
  useEffect(() => {
    if (state.status === "unlocked" && isAppwriteConfigured() && state.email) {
      void doRefresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  if (state.status !== "unlocked") {
    return (
      <div className="h-safe-screen flex items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  const cloudReady = isAppwriteConfigured() && !!state.email;

  return (
    <AppShell onRefresh={doRefresh}>
      <div className="pt-4">
        <header className="flex items-center gap-1 -mx-2 mb-6">
          <Link to="/" className="icon-btn" aria-label="Back">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-lg font-semibold flex-1">Teams</h1>
          <button
            onClick={doRefresh}
            disabled={refreshing || !cloudReady}
            className="icon-btn disabled:opacity-40"
            aria-label="Refresh"
          >
            <RefreshCcw size={16} className={refreshing ? "animate-spin" : ""} />
          </button>
        </header>

        {banner && (
          <div className="card p-3 mb-4 text-sm text-accent border-accent/30 bg-accent/5">
            {banner}
          </div>
        )}

        {!cloudReady ? (
          <div className="card p-4 text-sm text-muted border-warn/30 bg-warn/5">
            Teams require a cloud account. Shared codes are end-to-end encrypted
            with a team key that only members can unwrap. Set up cloud sync in{" "}
            <Link to="/settings" className="text-accent underline-offset-4 hover:underline">
              Settings
            </Link>{" "}
            first.
          </div>
        ) : (
          <TeamsBody />
        )}
      </div>
    </AppShell>
  );
}

function TeamsBody() {
  const teams = useLiveQuery<TeamRecord[]>(() => db().teams.toArray(), []) ?? [];

  return (
    <div className="space-y-4">
      <CreateTeamCard />
      {teams.length === 0 ? (
        <p className="text-sm text-muted text-center py-6">
          You're not on any teams yet. Create one above, or ask a teammate to
          invite you by email.
        </p>
      ) : (
        <div className="space-y-3">
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateTeamCard() {
  const { ensureIdentity, setTeamKey } = useVault();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(TEAM_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const identity = await ensureIdentity();
      const { team, teamKey } = await createTeam(name.trim(), color, identity);
      setTeamKey(team.id, teamKey);
      setName("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create team");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary w-full">
        <Plus size={18} /> Create a team
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card p-4 space-y-3">
      <div className="font-medium">New team</div>
      <input
        className="input"
        placeholder="Team name (e.g. Ops, Family)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="flex items-center gap-2">
        {TEAM_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className="w-7 h-7 rounded-full border-2 flex items-center justify-center"
            style={{
              background: c,
              borderColor: color === c ? "#fff" : "transparent",
            }}
            aria-label={`Color ${c}`}
          >
            {color === c && <Check size={14} className="text-black/70" />}
          </button>
        ))}
      </div>
      {error && <div className="text-sm text-danger">{error}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-ghost flex-1"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}

function RoleBadge({ role }: { role: TeamRole }) {
  const map = {
    owner: { icon: Crown, label: "Owner", cls: "text-amber-400" },
    admin: { icon: Shield, label: "Admin", cls: "text-accent" },
    member: { icon: UserIcon, label: "Member", cls: "text-muted" },
  } as const;
  const { icon: Icon, label, cls } = map[role];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${cls}`}>
      <Icon size={12} /> {label}
    </span>
  );
}

function TeamCard({ team }: { team: TeamRecord }) {
  const { hasTeamAccess } = useVault();
  const [expanded, setExpanded] = useState(false);
  const entryCount =
    useLiveQuery<number>(
      () => db().teamEntries.where("teamId").equals(team.id).count(),
      [team.id],
    ) ?? 0;
  const accessible = hasTeamAccess(team.id);

  return (
    <div className="card p-4">
      <button
        className="w-full flex items-center gap-3 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${team.color}22`, color: team.color }}
        >
          <Users size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{team.name}</div>
          <div className="flex items-center gap-2">
            <RoleBadge role={team.role} />
            <span className="text-[11px] text-muted">· {entryCount} codes</span>
          </div>
        </div>
        {!accessible && (
          <span className="text-[11px] text-warn mr-1">access pending</span>
        )}
        <ChevronDown
          size={18}
          className={`text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && <TeamDetail team={team} accessible={accessible} />}
    </div>
  );
}

function TeamDetail({
  team,
  accessible,
}: {
  team: TeamRecord;
  accessible: boolean;
}) {
  const { ensureIdentity, setTeamKey, refreshTeams } = useVault();
  const navigate = useNavigate();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canManage = team.role === "owner" || team.role === "admin";

  const loadMembers = useCallback(async () => {
    setError(null);
    try {
      setMembers(await listMembers(team.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load members");
    }
  }, [team.id]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function onRemove(member: TeamMember) {
    setBusy(true);
    setError(null);
    try {
      const identity = await ensureIdentity();
      const { team: updated, teamKey } = await removeMemberAndRotate(
        team,
        member,
        identity,
      );
      setTeamKey(updated.id, teamKey);
      await loadMembers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove member");
    } finally {
      setBusy(false);
    }
  }

  async function onChangeRole(member: TeamMember, role: TeamRole) {
    setBusy(true);
    setError(null);
    try {
      await updateMemberRole(team.id, member, role);
      await loadMembers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change role");
    } finally {
      setBusy(false);
    }
  }

  async function onLeave() {
    setBusy(true);
    setError(null);
    try {
      await leaveTeam(team);
      navigate({ to: "/teams" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't leave team");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-4">
      {!accessible && (
        <div className="text-xs text-warn flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          You don't have this team's key yet. An owner or admin needs to grant
          you access. Ask them to open Teams and pull to refresh, then pull
          again here.
        </div>
      )}

      {canManage && accessible && (
        <InviteRow
          teamId={team.id}
          onInvited={loadMembers}
          onReconcile={refreshTeams}
        />
      )}

      <div className="space-y-2">
        <div className="text-sm font-medium text-muted">
          Members
        </div>
        {members === null ? (
          <div className="text-sm text-muted">Loading members…</div>
        ) : (
          members.map((m) => (
            <MemberRow
              key={m.membershipId}
              member={m}
              myRole={team.role}
              busy={busy}
              onRemove={() => onRemove(m)}
              onChangeRole={(r) => onChangeRole(m, r)}
            />
          ))
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={onLeave}
        disabled={busy}
        className="btn-ghost w-full text-danger"
      >
        <LogOut size={16} /> Leave team
      </button>
    </div>
  );
}

function InviteRow({
  teamId,
  onInvited,
  onReconcile,
}: {
  teamId: string;
  onInvited: () => Promise<void>;
  onReconcile: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await inviteMember(teamId, email.trim(), role);
      setEmail("");
      setMsg(
        "Invite sent. Once they accept and open Aegis, pull to refresh here to grant their key.",
      );
      await onInvited();
      // Best-effort: if they already have an account + key, grant immediately.
      await onReconcile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={invite} className="space-y-2">
      <div className="text-sm font-medium text-muted">
        Invite by email
      </div>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          type="email"
          placeholder="teammate@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
        <select
          className="input !w-auto"
          value={role}
          onChange={(e) => setRole(e.target.value as TeamRole)}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" className="btn-primary shrink-0" disabled={busy}>
          <Mail size={16} />
        </button>
      </div>
      {msg && <div className="text-xs text-accent">{msg}</div>}
      {error && <div className="text-xs text-danger">{error}</div>}
    </form>
  );
}

function MemberRow({
  member,
  myRole,
  busy,
  onRemove,
  onChangeRole,
}: {
  member: TeamMember;
  myRole: TeamRole;
  busy: boolean;
  onRemove: () => void;
  onChangeRole: (role: TeamRole) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const iAmOwner = myRole === "owner";
  const canManageThis =
    (myRole === "owner" || myRole === "admin") && member.role !== "owner";

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-7 h-7 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[11px] font-semibold shrink-0">
        {(member.name || member.email || "?").charAt(0).toUpperCase()}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{member.email || member.name}</div>
        <div className="flex items-center gap-2">
          <RoleBadge role={member.role} />
          {!member.confirmed && (
            <span className="text-[11px] text-warn">invited</span>
          )}
          {member.confirmed && !member.hasKey && (
            <span className="text-[11px] text-muted">no key yet</span>
          )}
        </div>
      </div>

      {/* Owners can promote/demote between member/admin. */}
      {iAmOwner && member.role !== "owner" && (
        <select
          className="input !w-auto !py-1 !text-xs"
          value={member.role}
          disabled={busy}
          onChange={(e) => onChangeRole(e.target.value as TeamRole)}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      )}

      {canManageThis &&
        (confirming ? (
          <div className="flex items-center gap-1">
            <button
              onClick={onRemove}
              disabled={busy}
              className="btn-danger !px-2 !py-1 !text-xs"
            >
              Remove
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="btn-ghost !px-2 !py-1 !text-xs"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-muted hover:text-danger"
            aria-label="Remove member"
          >
            <Trash2 size={14} />
          </button>
        ))}
    </div>
  );
}
