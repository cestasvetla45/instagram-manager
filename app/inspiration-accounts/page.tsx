"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReelCard from "../components/ReelCard";
import ConfigBanner from "../components/ConfigBanner";
import NicheCombo from "../components/NicheCombo";
import { fmt } from "../components/util";

type Tab = "accounts" | "reels" | "stats";
const PAGE_SIZE = 50;
const TRAYS = ["regular", "spam", "pipeline"];

function timeAgo(iso?: string | null) {
  if (!iso) return "—";
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

export default function InspirationAccountsPage() {
  const [tab, setTab] = useState<Tab>("accounts");
  const [niches, setNiches] = useState<string[]>([]);

  const loadNiches = useCallback(() => {
    fetch("/api/niches")
      .then((r) => r.json())
      .then((j) => setNiches((j.niches || []).map((n: any) => n.name)))
      .catch(() => {});
  }, []);
  useEffect(() => { loadNiches(); }, [loadNiches]);

  return (
    <div>
      <h1 className="h1">Inspiration Management</h1>
      <p className="sub">Manage inspiration accounts &amp; reels — add, remove, bulk-delete, and re-tray in one place.</p>
      <ConfigBanner />

      <div className="row" style={{ gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <button className={tab === "accounts" ? "" : "secondary"} onClick={() => setTab("accounts")}>👤 Accounts</button>
        <button className={tab === "reels" ? "" : "secondary"} onClick={() => setTab("reels")}>🎬 Reels</button>
        <button className={tab === "stats" ? "" : "secondary"} onClick={() => setTab("stats")}>📊 Stats Overview</button>
      </div>

      {tab === "accounts" && <AccountsTab niches={niches} onNichesChange={loadNiches} />}
      {tab === "reels" && <ReelsTab niches={niches} onNichesChange={loadNiches} />}
      {tab === "stats" && <StatsTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  TAB 1 — Accounts
// ─────────────────────────────────────────────────────────────
function AccountsTab({ niches, onNichesChange }: { niches: string[]; onNichesChange: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [niche, setNiche] = useState("ALL");
  const [sort, setSort] = useState("reels");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ search, niche, sort, page: String(page), limit: String(PAGE_SIZE) });
    fetch(`/api/inspiration-accounts?${p}`)
      .then((r) => r.json())
      .then((j) => {
        setRows(j.accounts || []);
        setTotal(j.total || 0);
        setSel(new Set());
      })
      .catch((e) => setMsg(String(e)))
      .finally(() => setLoading(false));
  }, [search, niche, sort, page]);

  useEffect(() => { load(); }, [load]);
  // reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, niche, sort]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.handle));

  function toggle(h: string) {
    setSel((prev) => {
      const n = new Set(prev);
      n.has(h) ? n.delete(h) : n.add(h);
      return n;
    });
  }
  function toggleAll() {
    setSel(allSel ? new Set() : new Set(rows.map((r) => r.handle)));
  }

  async function deleteOne(handle: string) {
    if (!confirm(`Delete @${handle} and ALL its reels? This cannot be undone.`)) return;
    setMsg("Deleting…");
    const r = await fetch(`/api/inspiration-accounts/${encodeURIComponent(handle)}`, { method: "DELETE" });
    const j = await r.json();
    setMsg(j.ok ? `Deleted @${handle} (${j.reels_deleted} reels).` : `Error: ${j.error}`);
    load();
  }

  async function deleteSelected() {
    const handles = [...sel];
    if (!handles.length) return;
    if (!confirm(`Delete ${handles.length} account(s) and ALL their reels? This cannot be undone.`)) return;
    setMsg("Deleting…");
    const r = await fetch(`/api/inspiration-accounts`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handles }),
    });
    const j = await r.json();
    setMsg(j.deleted != null ? `Deleted ${j.deleted} account(s) + ${j.reels_deleted} reels.` : `Error: ${j.error}`);
    load();
  }

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          placeholder="🔍 Search handle or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={niche} onChange={(e) => setNiche(e.target.value)}>
          <option value="ALL">All niches</option>
          <option value="UNTAGGED">— untagged —</option>
          {niches.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="reels">Sort: Reels</option>
          <option value="views">Sort: Total Views</option>
          <option value="followers">Sort: Followers</option>
          <option value="recent">Sort: Recently Scraped</option>
        </select>
        <button onClick={() => setShowAdd(true)}>+ Add Account</button>
        <div style={{ marginLeft: "auto" }} className="muted">{total.toLocaleString()} accounts</div>
      </div>

      {sel.size > 0 && (
        <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span className="muted">{sel.size} selected</span>
          <button onClick={deleteSelected} style={{ background: "#c0392b", color: "#fff" }}>Delete Selected</button>
          <button className="secondary" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {msg && <div className="banner" style={{ marginBottom: 10 }}>{msg}</div>}

      <div className="panel" style={{ overflowX: "auto", padding: 0 }}>
        {loading ? (
          <div style={{ padding: 24 }}><span className="spinner" /> Loading…</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={th}><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
                <th style={th}>Handle</th>
                <th style={th}>Name</th>
                <th style={thR}>Followers</th>
                <th style={th}>Niche</th>
                <th style={thR}>Reels</th>
                <th style={thR}>Avg Views</th>
                <th style={thR}>Total Views</th>
                <th style={th}>Last Scraped</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.handle} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={td}><input type="checkbox" checked={sel.has(a.handle)} onChange={() => toggle(a.handle)} /></td>
                  <td style={td}>
                    <a href={`https://instagram.com/${a.handle}`} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>@{a.handle}</a>
                    {a.is_viral && <span className="badge" style={{ marginLeft: 6, background: "#c0392b", color: "#fff" }}>🔥{a.viral_count}</span>}
                  </td>
                  <td style={td}>{a.full_name || <span className="muted">—</span>}</td>
                  <td style={tdR}>{fmt(a.followers)}</td>
                  <td style={td}>{a.niche ? <span className="badge">{a.niche}</span> : <span className="muted">—</span>}</td>
                  <td style={tdR}>{a.reel_count}</td>
                  <td style={tdR}>{fmt(a.avg_views)}</td>
                  <td style={tdR}>{fmt(a.total_views)}</td>
                  <td style={td} className="muted">{timeAgo(a.last_scraped)}</td>
                  <td style={td}>
                    <button className="secondary" onClick={() => deleteOne(a.handle)} style={{ color: "#e74c3c", borderColor: "#e74c3c", fontSize: 12, padding: "3px 10px" }}>Delete</button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={10} style={{ padding: 24, textAlign: "center" }} className="muted">No accounts found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <Pager page={page} pages={pages} onPage={setPage} />

      {showAdd && <AddAccountModal niches={niches} onNichesChange={onNichesChange} onClose={() => setShowAdd(false)} onDone={load} />}
    </div>
  );
}

function AddAccountModal({ niches, onNichesChange, onClose, onDone }: { niches: string[]; onNichesChange: () => void; onClose: () => void; onDone: () => void }) {
  const [handle, setHandle] = useState("");
  const [niche, setNiche] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    if (!handle.trim()) return;
    setBusy(true);
    setMsg("Scraping profile…");
    try {
      const r = await fetch("/api/inspiration-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: handle.trim(), niche }),
      });
      const j = await r.json();
      if (j.ok) {
        setMsg(`✓ ${j.created ? "Added" : "Updated"} @${j.account?.handle}`);
        onDone();
        setTimeout(onClose, 800);
      } else {
        setMsg(`Error: ${j.error}`);
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
        <h3 style={{ marginTop: 0 }}>Add Inspiration Account</h3>
        <input
          placeholder="@username"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{ width: "100%", marginBottom: 10 }}
          autoFocus
        />
        <div style={{ marginBottom: 12 }}>
          <NicheCombo
            value={niche}
            onChange={setNiche}
            niches={niches}
            onCreate={onNichesChange}
            placeholder="— niche (optional, type to create) —"
            style={{ width: "100%" }}
          />
        </div>
        {msg && <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>{msg}</div>}
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy || !handle.trim()}>{busy ? <><span className="spinner" /> Adding…</> : "Add"}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  TAB 2 — Reels
// ─────────────────────────────────────────────────────────────
function ReelsTab({ niches, onNichesChange }: { niches: string[]; onNichesChange: () => void }) {
  const [reels, setReels] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [handle, setHandle] = useState("");
  const [niche, setNiche] = useState("ALL");
  const [tray, setTray] = useState("ALL");
  const [viral, setViral] = useState(false);
  const [sort, setSort] = useState("views");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [moveTray, setMoveTray] = useState("");
  const [setNicheVal, setSetNicheVal] = useState("");
  const [msg, setMsg] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixRemaining, setFixRemaining] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), niche, tray, sort });
    if (search) p.set("search", search);
    if (handle) p.set("handle", handle);
    if (viral) p.set("viral", "true");
    fetch(`/api/inspiration-reels/manage?${p}`)
      .then((r) => r.json())
      .then((j) => {
        setReels(j.reels || []);
        setTotal(j.total || 0);
        setSel(new Set());
      })
      .catch((e) => setMsg(String(e)))
      .finally(() => setLoading(false));
  }, [search, handle, niche, tray, viral, sort, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, handle, niche, tray, viral, sort]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Load the count of reels with broken/expired thumbnails once.
  useEffect(() => {
    fetch("/api/inspiration-reels/fix-thumbnails")
      .then((r) => r.json())
      .then((j) => setFixRemaining(j.remaining ?? null))
      .catch(() => {});
  }, []);

  // Re-scrape fresh thumbnails and re-host them durably, a few accounts per
  // call, looping until none remain. Runs in the background; updates progress.
  async function fixThumbnails() {
    if (fixing) return;
    setFixing(true);
    setMsg("Fixing thumbnails — re-scraping fresh images and re-hosting them…");
    try {
      let guard = 0;
      while (guard++ < 200) {
        const r = await fetch("/api/inspiration-reels/fix-thumbnails", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accounts: 4 }),
        });
        const j = await r.json();
        if (j.error) { setMsg(`Error: ${j.error}`); break; }
        setFixRemaining(j.remaining);
        setMsg(`Fixed ${j.fixed} this batch (${j.stored} re-hosted). ~${j.remaining} reels left…`);
        if (j.done || j.accounts_processed === 0) { setMsg(`✓ Thumbnails fixed. ~${j.remaining} remain.`); break; }
      }
      load();
    } catch (e: any) {
      setMsg(`Fix ended: ${e?.message || e}. Reload and run again for the rest.`);
    } finally {
      setFixing(false);
    }
  }

  function toggle(url: string) {
    setSel((prev) => {
      const n = new Set(prev);
      n.has(url) ? n.delete(url) : n.add(url);
      return n;
    });
  }

  async function deleteSelected() {
    const urls = [...sel];
    if (!urls.length) return;
    if (!confirm(`Delete ${urls.length} reel(s)? This cannot be undone.`)) return;
    setMsg("Deleting…");
    const r = await fetch(`/api/inspiration-reels/manage`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reel_urls: urls }),
    });
    const j = await r.json();
    setMsg(j.deleted != null ? `Deleted ${j.deleted} reel(s).` : `Error: ${j.error}`);
    load();
  }

  async function moveSelected() {
    const urls = [...sel];
    if (!urls.length || !moveTray) return;
    setMsg("Moving…");
    const r = await fetch(`/api/inspiration-reels/manage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reel_urls: urls, tray: moveTray }),
    });
    const j = await r.json();
    setMsg(j.updated != null ? `Moved ${j.updated} reel(s) → ${moveTray}.` : `Error: ${j.error}`);
    setMoveTray("");
    load();
  }

  async function setNicheSelected() {
    const urls = [...sel];
    const niche = setNicheVal.trim();
    if (!urls.length || !niche) return;
    setMsg("Tagging…");
    const r = await fetch(`/api/inspiration-library/tag`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reel_urls: urls, niche }),
    });
    const j = await r.json();
    setMsg(j.reels_tagged != null ? `Tagged ${j.reels_tagged} reel(s) → ${niche}.` : `Error: ${j.error}`);
    setSetNicheVal("");
    onNichesChange();
    load();
  }

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input placeholder="🔍 Search caption/handle…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 200 }} />
        <input placeholder="handle" value={handle} onChange={(e) => setHandle(e.target.value)} style={{ width: 140 }} />
        <select value={niche} onChange={(e) => setNiche(e.target.value)}>
          <option value="ALL">All niches</option>
          <option value="UNTAGGED">— untagged —</option>
          {niches.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={tray} onChange={(e) => setTray(e.target.value)}>
          <option value="ALL">All trays</option>
          {TRAYS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="views">Sort: Views</option>
          <option value="recent">Sort: Recent</option>
          <option value="score">Sort: Score</option>
        </select>
        <label className="row" style={{ gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={viral} onChange={(e) => setViral(e.target.checked)} /> viral only
        </label>
        <button
          className="secondary"
          onClick={fixThumbnails}
          disabled={fixing}
          title="Re-scrape expired Instagram thumbnails and re-host them permanently"
        >
          {fixing ? <><span className="spinner" /> Fixing thumbnails…</> : `🖼 Fix Thumbnails${fixRemaining ? ` (${fixRemaining.toLocaleString()})` : ""}`}
        </button>
        <div style={{ marginLeft: "auto" }} className="muted">{total.toLocaleString()} reels</div>
      </div>

      {sel.size > 0 && (
        <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <span className="muted">{sel.size} selected</span>
          <button onClick={deleteSelected} style={{ background: "#c0392b", color: "#fff" }}>Delete Selected</button>
          <select value={moveTray} onChange={(e) => setMoveTray(e.target.value)}>
            <option value="">Move to tray…</option>
            {TRAYS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="secondary" onClick={moveSelected} disabled={!moveTray}>Move</button>
          <NicheCombo
            value={setNicheVal}
            onChange={setSetNicheVal}
            niches={niches}
            onCreate={onNichesChange}
            placeholder="Set niche… (type new)"
            style={{ width: 150 }}
          />
          <button className="secondary" onClick={setNicheSelected} disabled={!setNicheVal.trim()}>Set Niche</button>
          <button className="secondary" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {msg && <div className="banner" style={{ marginBottom: 10 }}>{msg}</div>}

      {loading ? (
        <div style={{ padding: 24 }}><span className="spinner" /> Loading…</div>
      ) : (
        <div className="grid-reels">
          {reels.map((rec) => {
            const url = rec.fields?.["Reel URL"];
            const checked = sel.has(url);
            return (
              <div key={rec.id || url} style={{ position: "relative", outline: checked ? "2px solid var(--accent)" : "none", borderRadius: 12 }}>
                <label style={{ position: "absolute", top: 10, left: 10, zIndex: 5, background: "rgba(0,0,0,.55)", borderRadius: 6, padding: "2px 5px", cursor: "pointer" }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(url)} />
                </label>
                <ReelCard rec={rec} />
              </div>
            );
          })}
          {!reels.length && <div className="muted" style={{ padding: 24 }}>No reels found.</div>}
        </div>
      )}

      <Pager page={page} pages={pages} onPage={setPage} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  TAB 3 — Stats Overview
// ─────────────────────────────────────────────────────────────
function StatsTab() {
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/inspiration-accounts/stats")
      .then((r) => r.json())
      .then(setS)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 24 }}><span className="spinner" /> Loading stats…</div>;
  if (!s || s.error) return <div className="banner">Error: {s?.error || "no data"}</div>;

  const maxNiche = Math.max(1, ...(s.niches || []).map((n: any) => n.count));

  return (
    <div>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <Stat label="Accounts" value={s.total_accounts} />
        <Stat label="Reels" value={s.total_reels} />
        <Stat label="Viral reels" value={s.total_viral} />
        <Stat label="No reels (scrape failed)" value={s.accounts_no_reels?.length || 0} />
        <Stat label="No niche" value={s.accounts_no_niche?.length || 0} />
      </div>

      <div className="cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}>
        <TopList title="Top 10 by Total Views" rows={s.top_by_views} metric={(a: any) => fmt(a.total_views) + " views"} />
        <TopList title="Top 10 by Reel Count" rows={s.top_by_reels} metric={(a: any) => a.reel_count + " reels"} />

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Niche Distribution</h3>
          {(s.niches || []).map((n: any) => (
            <div key={n.niche} style={{ marginBottom: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
                <span>{n.niche}</span><span className="muted">{n.count}</span>
              </div>
              <div style={{ height: 6, background: "var(--panel-2)", borderRadius: 4 }}>
                <div style={{ width: `${(n.count / maxNiche) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>

        <HandleList title="Accounts with no reels" handles={s.accounts_no_reels} />
        <HandleList title="Accounts with no niche" handles={s.accounts_no_niche} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel" style={{ minWidth: 150, flex: "1 1 150px" }}>
      <div style={{ fontSize: 26, fontWeight: 800 }}>{Number(value || 0).toLocaleString()}</div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    </div>
  );
}

function TopList({ title, rows, metric }: { title: string; rows: any[]; metric: (a: any) => string }) {
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {(rows || []).map((a, i) => (
        <div key={a.handle} className="row" style={{ justifyContent: "space-between", fontSize: 13, padding: "3px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
          <a href={`https://instagram.com/${a.handle}`} target="_blank" rel="noreferrer">@{a.handle}</a>
          <span className="muted">{metric(a)}</span>
        </div>
      ))}
      {!rows?.length && <div className="muted">None.</div>}
    </div>
  );
}

function HandleList({ title, handles }: { title: string; handles: string[] }) {
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>{title} <span className="muted">({handles?.length || 0})</span></h3>
      <div style={{ maxHeight: 220, overflowY: "auto", fontSize: 13, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(handles || []).map((h) => (
          <a key={h} className="badge" href={`https://instagram.com/${h}`} target="_blank" rel="noreferrer" style={{ background: "var(--panel-2)" }}>@{h}</a>
        ))}
        {!handles?.length && <span className="muted">None 🎉</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="row" style={{ gap: 8, justifyContent: "center", alignItems: "center", margin: "16px 0" }}>
      <button className="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
      <span className="muted">Page {page} / {pages}</span>
      <button className="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
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
