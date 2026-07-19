"use client";
import { useEffect, useMemo, useState } from "react";

// ─────────────────────────────────────────────────────────────
//  VA / Posting Management — the ADMIN command center.
//  (The /va page is the VA's own daily checklist — untouched.)
// ─────────────────────────────────────────────────────────────

type VA = {
  id: string;
  name: string;
  telegram_id: number | null;
  role: string;
  is_active: boolean;
  max_accounts: number;
  account_count?: number;
  posted_today?: number;
  not_posted_today?: number;
  accounts?: string[];
};
type Assignment = {
  id: string;
  account_handle: string;
  va_name: string;
  notes: string | null;
  assigned_at: string | null;
};
type Slot = {
  id: string;
  account_handle: string;
  slot_name: string | null;
  post_time: string;
  post_type: string;
  is_active: boolean;
};
type AccountStatus = {
  handle: string;
  active: boolean;
  va_name: string | null;
  posted_today: number;
  posted: boolean;
  scheduled_times: string[];
  slot_count: number;
};
type Dashboard = {
  today: string;
  totals: { accounts: number; active_accounts: number; vas: number; posted_today: number };
  vas: VA[];
  accountStatus: AccountStatus[];
  unassignedAccounts: string[];
  notPostedToday: string[];
  noSchedule: string[];
  todaySchedule: {
    account_handle: string;
    va_name: string | null;
    slot_name: string | null;
    post_time: string;
    post_type: string;
    posted: boolean;
  }[];
};
type PostLog = {
  id: string;
  account_handle: string | null;
  va_name: string | null;
  post_type: string;
  link: string | null;
  note: string | null;
  status: string | null;
  posted_at: string | null;
  logged_at: string | null;
};

const TABS = ["Overview", "VAs & Assignments", "Posting Schedule", "Posting Log", "Instagram Connect"] as const;
type Tab = (typeof TABS)[number];

type ConnectedAccount = {
  id: string;
  account_handle: string | null;
  ig_username: string | null;
  ig_account_id: string;
  follower_count: number;
  connected_at: string | null;
  last_synced_at: string | null;
  token_expires_at: string | null;
  is_active: boolean;
};

async function jget(url: string) {
  const r = await fetch(url);
  return r.json();
}
async function jsend(url: string, method: string, body?: any) {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

export default function VaManagementPage() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [ourAccounts, setOurAccounts] = useState<string[]>([]);
  const [vas, setVas] = useState<VA[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadCore() {
    const [acc, v, a] = await Promise.all([
      jget("/api/accounts?type=our"),
      jget("/api/va-management"),
      jget("/api/va-management/assign"),
    ]);
    // Archived accounts shouldn't be assignable/schedulable — they're retired,
    // not part of the active roster (this feeds the Assign/Schedule/Log tabs).
    const handles = (acc.records || [])
      .filter((r: any) => r.fields?.Active !== false)
      .map((r: any) => r.fields?.Handle)
      .filter(Boolean)
      .sort((x: string, y: string) => x.localeCompare(y));
    setOurAccounts(handles);
    setVas(v.vas || []);
    setAssignments(a.assignments || []);
  }

  async function loadDash() {
    const d = await jget("/api/va-management/dashboard");
    setDash(d.error ? null : d);
  }

  async function refreshAll() {
    setLoading(true);
    await Promise.all([loadCore(), loadDash()]);
    setLoading(false);
  }

  useEffect(() => {
    refreshAll();
    // Honor a deep-link tab (e.g. the OAuth callback redirects here).
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t && (TABS as readonly string[]).includes(t)) setTab(t as Tab);
    }
  }, []);

  return (
    <div>
      <h1 className="h1">VA Management</h1>
      <p className="sub">
        Admin command center — assign accounts, manage VAs, set posting schedules and track daily posting.
        This is the operations view; the <code>/va</code> page is the VA&rsquo;s own daily checklist.
      </p>

      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t}
            className={tab === t ? "" : "secondary"}
            onClick={() => setTab(t)}
            style={{ fontSize: 13 }}
          >
            {t}
          </button>
        ))}
        <button className="secondary" onClick={refreshAll} style={{ fontSize: 13, marginLeft: "auto" }}>
          ↻ Refresh
        </button>
      </div>

      {loading && !dash ? (
        <div className="panel">
          <span className="spinner" /> Loading…
        </div>
      ) : (
        <>
          {tab === "Overview" && <OverviewTab dash={dash} />}
          {tab === "VAs & Assignments" && (
            <AssignmentsTab
              vas={vas}
              assignments={assignments}
              ourAccounts={ourAccounts}
              reload={refreshAll}
            />
          )}
          {tab === "Posting Schedule" && <ScheduleTab ourAccounts={ourAccounts} />}
          {tab === "Posting Log" && <PostingLogTab vas={vas} ourAccounts={ourAccounts} />}
          {tab === "Instagram Connect" && <InstagramConnectTab />}
        </>
      )}
    </div>
  );
}

// ─────────────────────────── Tab 1: Overview ───────────────────────────
function OverviewTab({ dash }: { dash: Dashboard | null }) {
  if (!dash) return <div className="panel muted">No dashboard data. Is Supabase configured?</div>;
  const t = dash.totals;

  return (
    <div>
      <div className="grid-reels" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard label="VAs" value={t.vas} />
        <StatCard label="Active accounts" value={t.active_accounts} />
        <StatCard label="Posted today" value={`${t.posted_today}/${t.active_accounts}`} />
        <StatCard label="Unassigned" value={dash.unassignedAccounts.length} warn={dash.unassignedAccounts.length > 0} />
      </div>

      <div className="panel">
        <h2>VA Overview</h2>
        {dash.vas.length === 0 ? (
          <p className="muted">No VAs yet. Add them in the “VAs &amp; Assignments” tab.</p>
        ) : (
          <table>
            <thead>
              <tr><th>VA</th><th>Role</th><th>Accounts</th><th>Posted today</th><th>Not posted</th></tr>
            </thead>
            <tbody>
              {dash.vas.map((v) => (
                <tr key={v.id}>
                  <td><strong>{v.name}</strong></td>
                  <td className="muted">{v.role}</td>
                  <td>{v.account_count}</td>
                  <td>{(v.posted_today || 0) > 0 ? "✅ " : ""}{v.posted_today || 0}</td>
                  <td>{(v.not_posted_today || 0) > 0 ? <span style={{ color: "#e0a800" }}>⚠️ {v.not_posted_today}</span> : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Alerts</h2>
        <AlertRow icon="⚠️" show={dash.unassignedAccounts.length > 0} label={`${dash.unassignedAccounts.length} account(s) unassigned`} detail={dash.unassignedAccounts.map((h) => "@" + h).join(", ")} />
        <AlertRow icon="⚠️" show={dash.notPostedToday.length > 0} label={`${dash.notPostedToday.length} account(s) haven't posted today`} detail={dash.notPostedToday.map((h) => "@" + h).join(", ")} />
        <AlertRow icon="⚠️" show={dash.noSchedule.length > 0} label={`${dash.noSchedule.length} account(s) have no posting schedule`} detail={dash.noSchedule.map((h) => "@" + h).join(", ")} />
        {dash.unassignedAccounts.length === 0 && dash.notPostedToday.length === 0 && dash.noSchedule.length === 0 && (
          <p className="muted">🎉 All clear — everything assigned, scheduled and posted.</p>
        )}
      </div>

      <div className="panel">
        <h2>Today&rsquo;s Posting Status <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({dash.today} ET)</span></h2>
        <table>
          <thead>
            <tr><th>Account</th><th>VA</th><th>Scheduled</th><th>Posted</th></tr>
          </thead>
          <tbody>
            {dash.accountStatus.filter((a) => a.active).map((a) => (
              <tr key={a.handle} style={{ opacity: a.active ? 1 : 0.5 }}>
                <td>@{a.handle}</td>
                <td>{a.va_name ? a.va_name : <span style={{ color: "#e0a800" }}>unassigned</span>}</td>
                <td className="muted">{a.scheduled_times.length ? a.scheduled_times.join(", ") : "—"}</td>
                <td>{a.posted ? `✅ ${a.posted_today}` : "❌ not yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, warn }: { label: string; value: any; warn?: boolean }) {
  return (
    <div className="panel" style={{ margin: 0 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: warn ? "#e0a800" : "var(--text)" }}>{value}</div>
    </div>
  );
}

function AlertRow({ icon, show, label, detail }: { icon: string; show: boolean; label: string; detail: string }) {
  if (!show) return null;
  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <div>{icon} {label}</div>
      {detail && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{detail}</div>}
    </div>
  );
}

// ──────────────────── Tab 2: VAs & Assignments ────────────────────
function AssignmentsTab({
  vas,
  assignments,
  ourAccounts,
  reload,
}: {
  vas: VA[];
  assignments: Assignment[];
  ourAccounts: string[];
  reload: () => void;
}) {
  const [name, setName] = useState("");
  const [tid, setTid] = useState("");
  const [role, setRole] = useState("va");
  const [maxAcc, setMaxAcc] = useState("15");
  const [msg, setMsg] = useState("");

  const [assignHandle, setAssignHandle] = useState("");
  const [assignVa, setAssignVa] = useState("");
  const [assignNotes, setAssignNotes] = useState("");

  const activeVas = vas.filter((v) => v.is_active);
  const assignedHandles = new Set(assignments.map((a) => a.account_handle));
  const unassigned = ourAccounts.filter((h) => !assignedHandles.has(h));

  const byVa = useMemo(() => {
    const m: Record<string, Assignment[]> = {};
    for (const a of assignments) (m[a.va_name] = m[a.va_name] || []).push(a);
    return m;
  }, [assignments]);

  async function addVa() {
    if (!name.trim()) { setMsg("Name is required."); return; }
    const j = await jsend("/api/va-management", "POST", {
      name: name.trim(),
      telegram_id: tid.trim() ? Number(tid.trim()) : null,
      role,
      max_accounts: Number(maxAcc) || 15,
    });
    if (j.error) setMsg("Error: " + j.error);
    else { setMsg(`Added ${name}.`); setName(""); setTid(""); setMaxAcc("15"); reload(); }
  }

  async function saveVa(v: VA, patch: Partial<VA>) {
    await jsend("/api/va-management", "PATCH", { id: v.id, ...patch });
    reload();
  }

  async function deactivateVa(v: VA) {
    if (!confirm(`Deactivate ${v.name}?`)) return;
    await fetch(`/api/va-management?id=${v.id}`, { method: "DELETE" });
    reload();
  }

  async function assign() {
    if (!assignHandle || !assignVa) { setMsg("Pick an account and a VA."); return; }
    const j = await jsend("/api/va-management/assign", "POST", {
      account_handle: assignHandle,
      va_name: assignVa,
      notes: assignNotes.trim(),
    });
    if (j.error) setMsg("Error: " + j.error);
    else { setMsg(`Assigned @${assignHandle} → ${assignVa}.`); setAssignHandle(""); setAssignNotes(""); reload(); }
  }

  async function unassign(a: Assignment) {
    if (!confirm(`Unassign @${a.account_handle} from ${a.va_name}?`)) return;
    await fetch(`/api/va-management/assign?id=${a.id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div>
      <div className="panel">
        <h2>Add a VA</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Name (e.g. Maria)" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 160 }} />
          <input placeholder="Telegram ID (optional)" value={tid} onChange={(e) => setTid(e.target.value)} style={{ minWidth: 160 }} />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="va">VA</option>
            <option value="senior_va">Senior VA</option>
            <option value="manager">Manager</option>
          </select>
          <input placeholder="Max accounts" value={maxAcc} onChange={(e) => setMaxAcc(e.target.value)} style={{ width: 110 }} />
          <button onClick={addVa}>Add VA</button>
        </div>
        {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}
      </div>

      <div className="panel">
        <h2>Assign an account</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select value={assignHandle} onChange={(e) => setAssignHandle(e.target.value)}>
            <option value="">Select account…</option>
            <optgroup label="Unassigned">
              {unassigned.map((h) => <option key={h} value={h}>@{h}</option>)}
            </optgroup>
            <optgroup label="Reassign">
              {ourAccounts.filter((h) => assignedHandles.has(h)).map((h) => <option key={h} value={h}>@{h}</option>)}
            </optgroup>
          </select>
          <select value={assignVa} onChange={(e) => setAssignVa(e.target.value)}>
            <option value="">Select VA…</option>
            {activeVas.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
          </select>
          <input placeholder="Notes (optional)" value={assignNotes} onChange={(e) => setAssignNotes(e.target.value)} style={{ minWidth: 180 }} />
          <button onClick={assign}>Assign</button>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>{unassigned.length} account(s) currently unassigned.</p>
      </div>

      {activeVas.length === 0 ? (
        <div className="panel muted">No active VAs yet.</div>
      ) : (
        activeVas.map((v) => (
          <VaCard key={v.id} va={v} assignments={byVa[v.name] || []} onSave={saveVa} onDeactivate={deactivateVa} onUnassign={unassign} />
        ))
      )}
    </div>
  );
}

function VaCard({
  va,
  assignments,
  onSave,
  onDeactivate,
  onUnassign,
}: {
  va: VA;
  assignments: Assignment[];
  onSave: (v: VA, patch: Partial<VA>) => void;
  onDeactivate: (v: VA) => void;
  onUnassign: (a: Assignment) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(va.name);
  const [tid, setTid] = useState(va.telegram_id ? String(va.telegram_id) : "");
  const [role, setRole] = useState(va.role);
  const [maxAcc, setMaxAcc] = useState(String(va.max_accounts));

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{va.name}</span>{" "}
          <span className="badge">{va.role}</span>{" "}
          <span className="muted" style={{ fontSize: 13 }}>
            {assignments.length}/{va.max_accounts} accounts
            {va.telegram_id ? ` · TG ${va.telegram_id}` : ""}
          </span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="secondary" onClick={() => setEditing((e) => !e)} style={{ fontSize: 12, padding: "3px 8px" }}>{editing ? "Close" : "Edit"}</button>
          <button className="secondary" onClick={() => onDeactivate(va)} style={{ fontSize: 12, padding: "3px 8px" }}>Deactivate</button>
        </div>
      </div>

      {editing && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 140 }} placeholder="Name" />
          <input value={tid} onChange={(e) => setTid(e.target.value)} style={{ minWidth: 140 }} placeholder="Telegram ID" />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="va">VA</option>
            <option value="senior_va">Senior VA</option>
            <option value="manager">Manager</option>
          </select>
          <input value={maxAcc} onChange={(e) => setMaxAcc(e.target.value)} style={{ width: 110 }} placeholder="Max" />
          <button onClick={() => { onSave(va, { name: name.trim(), telegram_id: tid.trim() ? Number(tid) : null, role, max_accounts: Number(maxAcc) || 15 } as any); setEditing(false); }}>Save</button>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {assignments.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No accounts assigned.</p>
        ) : (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {assignments.map((a) => (
              <span key={a.id} className="badge" style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title={a.notes || ""}>
                @{a.account_handle}
                <span onClick={() => onUnassign(a)} style={{ cursor: "pointer", opacity: 0.6 }}>✕</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────── Tab 3: Posting Schedule ────────────────────
const POST_TYPES = ["reel", "story", "carousel"];

function ScheduleTab({ ourAccounts }: { ourAccounts: string[] }) {
  const [account, setAccount] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [allSlots, setAllSlots] = useState<Slot[]>([]);
  const [slotName, setSlotName] = useState("");
  const [postTime, setPostTime] = useState("");
  const [postType, setPostType] = useState("reel");
  const [msg, setMsg] = useState("");

  async function loadAll() {
    const j = await jget("/api/va-management/schedule");
    setAllSlots(j.slots || []);
  }
  async function loadAccount(h: string) {
    if (!h) { setSlots([]); return; }
    const j = await jget(`/api/va-management/schedule?account_handle=${encodeURIComponent(h)}`);
    setSlots(j.slots || []);
  }
  useEffect(() => { loadAll(); }, []);
  useEffect(() => { loadAccount(account); }, [account]);

  async function addSlot() {
    if (!account) { setMsg("Pick an account first."); return; }
    if (!postTime.trim()) { setMsg("Enter a time (e.g. 08:00)."); return; }
    const j = await jsend("/api/va-management/schedule", "POST", {
      account_handle: account,
      slot_name: slotName.trim(),
      post_time: postTime.trim(),
      post_type: postType,
    });
    if (j.error) setMsg("Error: " + j.error);
    else { setMsg("Slot added."); setSlotName(""); setPostTime(""); loadAccount(account); loadAll(); }
  }

  async function removeSlot(id: string) {
    await fetch(`/api/va-management/schedule?id=${id}`, { method: "DELETE" });
    loadAccount(account); loadAll();
  }

  // Grid: rows = accounts with schedules, cols = slots.
  const byAcct = useMemo(() => {
    const m: Record<string, Slot[]> = {};
    for (const s of allSlots) (m[s.account_handle] = m[s.account_handle] || []).push(s);
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.post_time > b.post_time ? 1 : -1));
    return m;
  }, [allSlots]);

  return (
    <div>
      <div className="panel">
        <h2>Manage an account&rsquo;s schedule</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Select account…</option>
            {ourAccounts.map((h) => <option key={h} value={h}>@{h}</option>)}
          </select>
        </div>

        {account && (
          <>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <input placeholder="Slot name (e.g. Prime Time)" value={slotName} onChange={(e) => setSlotName(e.target.value)} style={{ minWidth: 160 }} />
              <input placeholder="Time (08:00 ET)" value={postTime} onChange={(e) => setPostTime(e.target.value)} style={{ width: 130 }} />
              <select value={postType} onChange={(e) => setPostType(e.target.value)}>
                {POST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={addSlot}>Add slot</button>
            </div>
            {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}

            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Time</th><th>Slot</th><th>Type</th><th></th></tr></thead>
              <tbody>
                {slots.length === 0 ? (
                  <tr><td colSpan={4} className="muted">No slots for @{account} yet.</td></tr>
                ) : slots.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.post_time}</strong></td>
                    <td>{s.slot_name || "—"}</td>
                    <td className="muted">{s.post_type}</td>
                    <td><button className="secondary" onClick={() => removeSlot(s.id)} style={{ fontSize: 12, padding: "3px 8px" }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="panel">
        <h2>All schedules</h2>
        {Object.keys(byAcct).length === 0 ? (
          <p className="muted">No posting schedules configured yet.</p>
        ) : (
          <table>
            <thead><tr><th>Account</th><th>Time slots</th></tr></thead>
            <tbody>
              {Object.entries(byAcct).sort((a, b) => a[0].localeCompare(b[0])).map(([h, s]) => (
                <tr key={h}>
                  <td>@{h}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {s.map((slot) => (
                        <span key={slot.id} className="badge">{slot.post_time}{slot.slot_name ? ` · ${slot.slot_name}` : ""} ({slot.post_type})</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ──────────────────── Tab 4: Posting Log ────────────────────
function PostingLogTab({ vas, ourAccounts }: { vas: VA[]; ourAccounts: string[] }) {
  const [posts, setPosts] = useState<PostLog[]>([]);
  const [fVa, setFVa] = useState("");
  const [fAccount, setFAccount] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fDate, setFDate] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const j = await jget("/api/va/posts");
    setPosts(j.posts || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function etDay(iso: string | null) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  }

  const filtered = useMemo(() => {
    return posts.filter((p) => {
      if (fVa && (p.va_name || "") !== fVa) return false;
      if (fAccount && (p.account_handle || "") !== fAccount) return false;
      if (fStatus && (p.status || "posted") !== fStatus) return false;
      if (fDate && etDay(p.posted_at || p.logged_at) !== fDate) return false;
      return true;
    });
  }, [posts, fVa, fAccount, fStatus, fDate]);

  async function markMissed(p: PostLog) {
    // The log stores actual posts; "mark as missed" flips status via va/posts is
    // not supported, so we use the va-posts row status through a direct patch.
    await fetch("/api/va-management/log", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, status: "missed" }),
    });
    load();
  }

  function exportCsv() {
    const header = ["account", "va", "type", "status", "time", "link", "note"];
    const rows = filtered.map((p) => [
      p.account_handle || "",
      p.va_name || "",
      p.post_type || "",
      p.status || "posted",
      p.posted_at || p.logged_at || "",
      p.link || "",
      (p.note || "").replace(/[\r\n,]+/g, " "),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `posting-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Posting Log</h2>
        <button className="secondary" onClick={exportCsv} style={{ fontSize: 12 }}>Export CSV</button>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
        <select value={fVa} onChange={(e) => setFVa(e.target.value)}>
          <option value="">All VAs</option>
          {vas.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
        </select>
        <select value={fAccount} onChange={(e) => setFAccount(e.target.value)}>
          <option value="">All accounts</option>
          {ourAccounts.map((h) => <option key={h} value={h}>@{h}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="posted">posted</option>
          <option value="scheduled">scheduled</option>
          <option value="missed">missed</option>
          <option value="failed">failed</option>
        </select>
        {(fDate || fVa || fAccount || fStatus) && (
          <button className="secondary" onClick={() => { setFDate(""); setFVa(""); setFAccount(""); setFStatus(""); }} style={{ fontSize: 12 }}>Clear</button>
        )}
        <span className="muted" style={{ fontSize: 13, marginLeft: "auto", alignSelf: "center" }}>{filtered.length} row(s)</span>
      </div>

      {loading ? (
        <p className="muted"><span className="spinner" /> Loading…</p>
      ) : (
        <table>
          <thead>
            <tr><th>Account</th><th>VA</th><th>Type</th><th>Status</th><th>Time (ET)</th><th>Link</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="muted">No posts match the filters.</td></tr>
            ) : filtered.map((p) => {
              const st = p.status || "posted";
              return (
                <tr key={p.id}>
                  <td>@{p.account_handle || "?"}</td>
                  <td>{p.va_name || <span className="muted">—</span>}</td>
                  <td className="muted">{p.post_type}</td>
                  <td>
                    <span className="badge" style={{ background: st === "missed" || st === "failed" ? "#e0a800" : "var(--panel-2)", color: st === "missed" || st === "failed" ? "#000" : "var(--text)" }}>{st}</span>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{(p.posted_at || p.logged_at || "").replace("T", " ").slice(0, 16)}</td>
                  <td>{p.link ? <a href={p.link} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>open ↗</a> : <span className="muted">{p.note ? "(note)" : "—"}</span>}</td>
                  <td>{st !== "missed" && <button className="secondary" onClick={() => markMissed(p)} style={{ fontSize: 12, padding: "3px 8px" }}>Mark missed</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ──────────────────── Tab 5: Instagram Connect ────────────────────
// "Connect Instagram Account" OAuth flow — each account logs in with its
// own Instagram; we store a long-lived token and pull insights via the
// Graph API. Shows token-expiry warnings and a manual "Sync Now".
function InstagramConnectTab() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [a, s] = await Promise.all([
      jget("/api/instagram-graph/accounts"),
      jget("/api/instagram-graph/sync"),
    ]);
    setAccounts(a.accounts || []);
    setLastSynced(s.last_synced_at || null);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Surface the OAuth callback result (?ig_connected / ?ig_error).
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      const ok = p.get("ig_connected");
      const err = p.get("ig_error");
      if (ok) setMsg(`✅ Connected @${ok}.`);
      else if (err) setMsg(`⚠️ ${err}`);
      if (ok || err) {
        // Clean the query so a refresh doesn't re-show the banner.
        const clean = new URL(window.location.href);
        ["ig_connected", "ig_error", "code", "state"].forEach((k) => clean.searchParams.delete(k));
        window.history.replaceState({}, "", clean.toString());
      }
    }
  }, []);

  async function connect() {
    setMsg("");
    const j = await jget("/api/instagram-graph/connect");
    if (j.url) window.open(j.url, "_blank", "width=680,height=780");
    else setMsg("⚠️ " + (j.error || "Could not start OAuth. Is META_APP_ID set?"));
  }

  async function disconnect(a: ConnectedAccount) {
    if (!confirm(`Disconnect @${a.ig_username || a.account_handle}? Insights will stop syncing.`)) return;
    await jsend("/api/instagram-graph/disconnect", "POST", { id: a.id });
    load();
  }

  async function syncNow() {
    setSyncing(true);
    setMsg("Syncing insights…");
    const j = await jsend("/api/instagram-graph/sync", "POST", { limit: 50 });
    setSyncing(false);
    if (j.ok === false) setMsg("⚠️ " + (j.error || "Sync failed."));
    else setMsg(`✅ Synced ${j.accounts || 0} account(s) · ${j.reels || 0} reels updated.`);
    load();
  }

  function expiryBadge(iso: string | null) {
    if (!iso) return <span className="muted">—</span>;
    const days = Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
    const color = days < 1 ? "#dc3545" : days < 7 ? "#e0a800" : "var(--text)";
    const label = days < 0 ? "expired" : `${days}d left`;
    return <span style={{ color, fontWeight: days < 7 ? 700 : 400 }}>{label}</span>;
  }

  function fmt(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const active = accounts.filter((a) => a.is_active);

  return (
    <div>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>Connect Instagram Account</h2>
            <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
              Log in with an Instagram Business/Creator account to pull deep insights (reach, saves,
              shares, watch-time, demographics) automatically — no scraper cost.
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button onClick={connect}>+ Connect Instagram Account</button>
            <button className="secondary" onClick={syncNow} disabled={syncing || active.length === 0}>
              {syncing ? <><span className="spinner" /> Syncing…</> : "Sync Now"}
            </button>
          </div>
        </div>
        {msg && <p className="muted" style={{ marginTop: 10 }}>{msg}</p>}
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          {active.length} account(s) connected
          {lastSynced ? ` · last synced ${fmt(lastSynced)}` : " · never synced"}
        </p>
      </div>

      <div className="panel">
        <h2>Connected Accounts</h2>
        {loading ? (
          <p className="muted"><span className="spinner" /> Loading…</p>
        ) : active.length === 0 ? (
          <p className="muted">
            No accounts connected yet. Click <strong>“+ Connect Instagram Account”</strong> and log in with
            the Instagram account you want to track.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Account</th><th>Followers</th><th>Connected</th><th>Last synced</th><th>Token</th><th></th>
              </tr>
            </thead>
            <tbody>
              {active.map((a) => (
                <tr key={a.id}>
                  <td><strong>@{a.ig_username || a.account_handle || a.ig_account_id}</strong></td>
                  <td>{Number(a.follower_count || 0).toLocaleString()}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{fmt(a.connected_at)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{fmt(a.last_synced_at)}</td>
                  <td>{expiryBadge(a.token_expires_at)}</td>
                  <td>
                    <button className="secondary" onClick={() => disconnect(a)} style={{ fontSize: 12, padding: "3px 8px" }}>
                      Disconnect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
