"use client";
import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import ConfigBanner from "../components/ConfigBanner";
import Toast, { useToast } from "../components/Toast";
import { fmt } from "../components/util";

type Row = {
  id: string;
  handle: string;
  profile_url: string;
  active: boolean;
  scrape_status: string | null;
  last_scraped_at: string | null;
  followers: number;
  followers_delta_7d: number | null;
  niche: string;
  content_type: string;
  subniche: string;
  va_group: string;
  notes: string;
  reel_count: number;
  avg_views: number;
  assigned_va: string | null;
};
type Va = { id: string; name: string; is_active: boolean };

type Status = "ok" | "stale" | "inaccessible" | "archived";
const STATUS_COLOR: Record<Status, string> = {
  ok: "var(--good)",
  stale: "var(--warn)",
  inaccessible: "#e74c3c",
  archived: "var(--muted)",
};

function statusOf(r: Row): Status {
  if (!r.active || r.scrape_status === "archived") return "archived";
  if (r.scrape_status === "inaccessible") return "inaccessible";
  if (!r.last_scraped_at) return "stale";
  const ageMs = Date.now() - new Date(r.last_scraped_at).getTime();
  if (ageMs > 2 * 60 * 60 * 1000) return "stale";
  return "ok";
}

function timeAgo(iso?: string | null) {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AccountsPage() {
  const { toasts, push } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"all" | "active" | "archived">("active");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("handle");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [niches, setNiches] = useState<string[]>([]);
  const [vas, setVas] = useState<Va[]>([]);
  const [contentTypes, setContentTypes] = useState<string[]>([]);
  const [busyHandles, setBusyHandles] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ type: "our", view: "manage", status, search, sort });
    fetch(`/api/accounts?${p}`)
      .then((r) => r.json())
      .then((j) => {
        setRows(j.accounts || []);
        setSel(new Set());
      })
      .catch((e) => push(String(e?.message || e), "error"))
      .finally(() => setLoading(false));
  }, [status, search, sort, push]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/niches").then((r) => r.json()).then((j) => setNiches((j.niches || []).map((n: any) => n.name))).catch(() => {});
    fetch("/api/va-management").then((r) => r.json()).then((j) => setVas(j.vas || [])).catch(() => {});
    fetch("/api/pipeline/taxonomy").then((r) => r.json()).then((j) => setContentTypes((j.types || []).map((t: any) => t.name))).catch(() => {});
  }, []);

  const activeVas = vas.filter((v) => v.is_active);

  function setBusy(handle: string, on: boolean) {
    setBusyHandles((prev) => {
      const n = new Set(prev);
      on ? n.add(handle) : n.delete(handle);
      return n;
    });
  }

  function patchLocal(handle: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.handle === handle ? { ...r, ...patch } : r)));
  }

  async function editField(handle: string, field: string, value: string) {
    const prev = rows;
    patchLocal(handle, { [field]: value } as any);
    try {
      const j = await fetch("/api/accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, field, value }),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
    } catch (e: any) {
      setRows(prev);
      push(`Failed to update ${field}: ${e?.message || e}`, "error");
    }
  }

  async function toggleArchive(r: Row) {
    const action = statusOf(r) === "archived" ? "unarchive" : "archive";
    const prev = rows;
    patchLocal(r.handle, action === "archive" ? { active: false, scrape_status: "archived" } : { active: true, scrape_status: null });
    try {
      const j = await fetch("/api/accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: r.handle, action }),
      }).then((res) => res.json());
      if (j.error) throw new Error(j.error);
      push(`@${r.handle} ${action === "archive" ? "archived" : "unarchived"}.`, "ok");
      if (status !== "all") load();
    } catch (e: any) {
      setRows(prev);
      push(`Failed: ${e?.message || e}`, "error");
    }
  }

  async function bulkArchive(action: "archive" | "unarchive") {
    const handles = [...sel];
    if (!handles.length) return;
    const prev = rows;
    setRows((rs) =>
      rs.map((r) =>
        handles.includes(r.handle)
          ? { ...r, ...(action === "archive" ? { active: false, scrape_status: "archived" } : { active: true, scrape_status: null }) }
          : r
      )
    );
    try {
      const j = await fetch("/api/accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handles, action }),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      push(`${action === "archive" ? "Archived" : "Unarchived"} ${handles.length} account(s).`, "ok");
      setSel(new Set());
      load();
    } catch (e: any) {
      setRows(prev);
      push(`Bulk ${action} failed: ${e?.message || e}`, "error");
    }
  }

  async function forceRefresh(handle: string) {
    setBusy(handle, true);
    try {
      const j = await fetch("/api/accounts/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      push(`@${handle} refreshed — ${j.refreshed || 0} reel(s) updated${j.ingested ? `, ${j.ingested} new` : ""}.`, j.ok === false ? "error" : "ok");
      load();
    } catch (e: any) {
      push(`Refresh failed for @${handle}: ${e?.message || e}`, "error");
    } finally {
      setBusy(handle, false);
    }
  }

  async function assignVa(handle: string, vaName: string) {
    const prev = rows;
    patchLocal(handle, { assigned_va: vaName || null });
    try {
      let j;
      if (!vaName) {
        j = await fetch(`/api/va-management/assign?account_handle=${encodeURIComponent(handle)}`, { method: "DELETE" }).then((r) => r.json());
      } else {
        j = await fetch("/api/va-management/assign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account_handle: handle, va_name: vaName }),
        }).then((r) => r.json());
      }
      if (j.error) throw new Error(j.error);
      push(`@${handle} ${vaName ? `assigned to ${vaName}` : "unassigned"}.`, "ok");
    } catch (e: any) {
      setRows(prev);
      push(`Assign failed: ${e?.message || e}`, "error");
    }
  }

  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.handle));
  function toggleSel(h: string) {
    setSel((prev) => {
      const n = new Set(prev);
      n.has(h) ? n.delete(h) : n.add(h);
      return n;
    });
  }
  function toggleAllSel() {
    setSel(allSel ? new Set() : new Set(rows.map((r) => r.handle)));
  }

  return (
    <div>
      <h1 className="h1">Our Accounts</h1>
      <p className="sub">
        Management hub for the accounts you post to — assign VAs, track sync health, and edit taxonomy in one place.
        Looking for inspiration accounts? See <Link href="/inspiration-accounts" style={{ color: "var(--accent)" }}>Inspiration Accounts</Link>.
      </p>
      <ConfigBanner />

      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {(["all", "active", "archived"] as const).map((s) => (
          <button key={s} className={status === s ? "" : "secondary"} onClick={() => setStatus(s)} style={{ textTransform: "capitalize" }}>
            {s}
          </button>
        ))}
        <input placeholder="🔍 Search handle…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 200 }} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="handle">Sort: Handle</option>
          <option value="followers">Sort: Followers</option>
          <option value="reels">Sort: Reels</option>
          <option value="last_scraped">Sort: Last Synced</option>
        </select>
        <button onClick={() => setShowAdd(true)}>+ Add Account</button>
        <div style={{ marginLeft: "auto" }} className="muted">
          {rows.length} account(s)
        </div>
      </div>

      {sel.size > 0 && (
        <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span className="muted">{sel.size} selected</span>
          <button className="secondary" onClick={() => bulkArchive("archive")}>Archive Selected</button>
          <button className="secondary" onClick={() => bulkArchive("unarchive")}>Unarchive Selected</button>
          <button className="secondary" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      <div className="panel" style={{ overflowX: "auto", padding: 0 }}>
        {loading ? (
          <div style={{ padding: 24 }}>
            <span className="spinner" /> Loading…
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={th}><input type="checkbox" checked={allSel} onChange={toggleAllSel} /></th>
                <th style={th}>Status</th>
                <th style={th}>Handle</th>
                <th style={thR}>Followers</th>
                <th style={thR}>Reels</th>
                <th style={thR}>Avg Views</th>
                <th style={th}>VA</th>
                <th style={th}>Niche</th>
                <th style={th}>Content Type</th>
                <th style={th}>Subniche</th>
                <th style={th}>VA Group</th>
                <th style={th}>Last Sync</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <AccountRow
                  key={r.handle}
                  r={r}
                  niches={niches}
                  contentTypes={contentTypes}
                  vas={activeVas}
                  busy={busyHandles.has(r.handle)}
                  selected={sel.has(r.handle)}
                  onToggleSel={() => toggleSel(r.handle)}
                  onEditField={editField}
                  onToggleArchive={() => toggleArchive(r)}
                  onForceRefresh={() => forceRefresh(r.handle)}
                  onAssignVa={(v) => assignVa(r.handle, v)}
                />
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={13} style={{ padding: 24, textAlign: "center" }} className="muted">No accounts found.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && <AddOurAccountModal onClose={() => setShowAdd(false)} onDone={load} push={push} />}
      <Toast toasts={toasts} />
    </div>
  );
}

function AccountRow({
  r,
  niches,
  contentTypes,
  vas,
  busy,
  selected,
  onToggleSel,
  onEditField,
  onToggleArchive,
  onForceRefresh,
  onAssignVa,
}: {
  r: Row;
  niches: string[];
  contentTypes: string[];
  vas: Va[];
  busy: boolean;
  selected: boolean;
  onToggleSel: () => void;
  onEditField: (handle: string, field: string, value: string) => void;
  onToggleArchive: () => void;
  onForceRefresh: () => void;
  onAssignVa: (vaName: string) => void;
}) {
  const st = statusOf(r);
  return (
    <tr style={{ borderTop: "1px solid var(--border)", opacity: st === "archived" ? 0.6 : 1 }}>
      <td style={td}><input type="checkbox" checked={selected} onChange={onToggleSel} /></td>
      <td style={td}>
        <span title={st} style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: STATUS_COLOR[st], marginRight: 5 }} />
        <span className="muted" style={{ fontSize: 11 }}>{st}</span>
      </td>
      <td style={td}>
        <a href={r.profile_url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>@{r.handle}</a>
      </td>
      <td style={tdR}>
        {fmt(r.followers)}
        {r.followers_delta_7d != null && r.followers_delta_7d !== 0 && (
          <div style={{ fontSize: 11, color: r.followers_delta_7d > 0 ? "var(--good)" : "#e74c3c" }}>
            {r.followers_delta_7d > 0 ? "+" : ""}{fmt(r.followers_delta_7d)} 7d
          </div>
        )}
      </td>
      <td style={tdR}>{r.reel_count}</td>
      <td style={tdR}>{fmt(r.avg_views)}</td>
      <td style={td}>
        <select value={r.assigned_va || ""} onChange={(e) => onAssignVa(e.target.value)} style={{ fontSize: 12, padding: "4px 6px" }}>
          <option value="">—</option>
          {vas.map((v) => (
            <option key={v.id} value={v.name}>{v.name}</option>
          ))}
        </select>
      </td>
      <td style={td}><InlineEdit value={r.niche} options={niches} placeholder="niche" onCommit={(v) => onEditField(r.handle, "niche", v)} /></td>
      <td style={td}><InlineEdit value={r.content_type} options={contentTypes} placeholder="type" onCommit={(v) => onEditField(r.handle, "content_type", v)} /></td>
      <td style={td}><InlineEdit value={r.subniche} placeholder="subniche" onCommit={(v) => onEditField(r.handle, "subniche", v)} /></td>
      <td style={td}><InlineEdit value={r.va_group} placeholder="group" onCommit={(v) => onEditField(r.handle, "va_group", v)} /></td>
      <td style={td} className="muted">{timeAgo(r.last_scraped_at)}</td>
      <td style={td}>
        <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
          <button className="secondary" onClick={onForceRefresh} disabled={busy} title="Force refresh" style={{ fontSize: 11, padding: "3px 8px" }}>
            {busy ? <span className="spinner" /> : "↻"}
          </button>
          <button className="secondary" onClick={onToggleArchive} style={{ fontSize: 11, padding: "3px 8px" }}>
            {st === "archived" ? "Unarchive" : "Archive"}
          </button>
        </div>
      </td>
    </tr>
  );
}

// Click-to-edit text cell. `options` (if given) backs an HTML <datalist> so
// you can either type freely or pick a known value — same UX as NicheCombo,
// generalized for content_type/subniche/va_group too.
function InlineEdit({
  value,
  options,
  onCommit,
  placeholder,
}: {
  value: string;
  options?: string[];
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const listId = useId();

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        style={{ cursor: "pointer", borderBottom: "1px dashed var(--border)", minWidth: 30, display: "inline-block", padding: "2px 0" }}
        title="Click to edit"
      >
        {value || <span className="muted">—</span>}
      </span>
    );
  }

  function commit() {
    setEditing(false);
    if (draft.trim() !== value) onCommit(draft.trim());
  }

  return (
    <>
      <input
        autoFocus
        list={options ? listId : undefined}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        style={{ fontSize: 12, padding: "3px 6px", width: 110 }}
      />
      {options && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  );
}

function AddOurAccountModal({ onClose, onDone, push }: { onClose: () => void; onDone: () => void; push: (m: string, k?: "ok" | "error") => void }) {
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    if (!handle.trim()) return;
    setBusy(true);
    setMsg("Adding + scraping…");
    try {
      const j = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: handle.trim() }),
      }).then((r) => r.json());
      if (j.error) {
        setMsg(`Error: ${j.error}`);
      } else {
        setMsg(`✓ Added @${j.account?.handle}`);
        push(`@${j.account?.handle} added.`, "ok");
        onDone();
        setTimeout(onClose, 800);
      }
    } catch (e: any) {
      setMsg(`Error: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div className="panel" style={{ maxWidth: 420, width: "90%" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Add Our Account</h3>
        <input
          placeholder="@username"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{ width: "100%", marginBottom: 10 }}
          autoFocus
        />
        {msg && <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>{msg}</div>}
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy || !handle.trim()}>{busy ? <><span className="spinner" /> Adding…</> : "Add"}</button>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 600, whiteSpace: "nowrap" };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "8px 12px", verticalAlign: "middle" };
const tdR: React.CSSProperties = { ...td, textAlign: "right" };
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 100,
};
