"use client";
import { useEffect, useState } from "react";

const GOOD = "var(--good)";
const WARN = "var(--warn)";
const BAD = "#e74c3c";
const MUTED = "var(--muted)";

function fmt(n: number) {
  return (n ?? 0).toLocaleString();
}

// One stat card (uses existing .card .k/.v classes; color overrides the value).
function Stat({ label, value, color, sub }: { label: string; value: any; color?: string; sub?: string }) {
  return (
    <div className="card" style={{ minWidth: 140 }}>
      <div className="k">{label}</div>
      <div className="v" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Success/fail proportion bar for an endpoint.
function RatioBar({ success, fail }: { success: number; fail: number }) {
  const total = success + fail || 1;
  const sp = (success / total) * 100;
  return (
    <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: "var(--border)", minWidth: 120 }}>
      <div style={{ width: `${sp}%`, background: GOOD }} />
      <div style={{ width: `${100 - sp}%`, background: BAD }} />
    </div>
  );
}

// Progress bar (0..100).
function Progress({ pct, color }: { pct: number; color?: string }) {
  return (
    <div style={{ height: 10, borderRadius: 999, background: "var(--border)", overflow: "hidden", margin: "6px 0" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", background: color || "var(--accent)" }} />
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", color: MUTED, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid var(--border)" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--border)", fontSize: 13 };

function timeHM(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function AdminDashboard() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAgo, setUpdatedAgo] = useState(0);

  async function load() {
    try {
      const r = await fetch("/api/admin/stats", { cache: "no-store" });
      const j = await r.json();
      if (j.error) { setErr(j.error); return; }
      setData(j);
      setErr(null);
      setUpdatedAgo(0);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  // Initial load + 10s auto-refresh.
  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  // Tick the "last updated" counter every second.
  useEffect(() => {
    const iv = setInterval(() => setUpdatedAgo((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  if (err) return <div className="panel" style={{ color: BAD }}>Failed to load admin stats: {err}</div>;
  if (!data) return <div className="row"><span className="spinner" /> <span className="muted">Loading admin dashboard…</span></div>;

  const { api, cycles, database, worker, env } = data;

  // Colour cues.
  const callsColor = api.callsLastMinute > 0 ? GOOD : BAD;
  const lastCallColor = api.lastCallSecondsAgo == null ? MUTED
    : api.lastCallSecondsAgo < 30 ? GOOD
    : api.lastCallSecondsAgo < 60 ? WARN : BAD;

  const endpoints = Object.entries(api.byEndpoint || {}) as [string, any][];
  endpoints.sort((a, b) => b[1].total - a[1].total);

  const backlogDone = database.totalAccounts
    ? Math.round((database.accountsWithReels / database.totalAccounts) * 100)
    : 0;
  const thumbPct = database.totalReels ? ((database.reelsWithThumbnails / database.totalReels) * 100) : 0;
  const videoPct = database.totalReels ? ((database.reelsWithVideo / database.totalReels) * 100) : 0;
  const nichePct = database.totalReels ? ((database.reelsWithNiche / database.totalReels) * 100) : 0;

  const envRows: { label: string; ok: boolean; note?: string }[] = [
    { label: "RockSolidAPIs Key 1", ok: env.rocksolidKey1 === "configured" },
    { label: "RockSolidAPIs Key 2", ok: env.rocksolidKey2 === "configured" },
    { label: "Gemini API Key", ok: env.geminiKey === "configured", note: env.geminiKey === "configured" ? "free tier — may be rate limited" : "needs GEMINI_API_KEY" },
    { label: "Telegram Bot", ok: env.telegramBot === "configured" },
    { label: "Graph API", ok: env.graphApi === "configured", note: env.graphApi === "configured" ? undefined : "needs INSTAGRAM_ACCESS_TOKEN" },
    { label: "Meta App ID", ok: env.metaAppId === "configured" },
  ];

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="h1">Admin Dashboard</div>
          <div className="sub" style={{ margin: 0 }}>Scraper health, API usage & system status · uptime {api.uptimeMinutes} min</div>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>Last updated: {updatedAgo}s ago · auto-refresh 10s</div>
      </div>

      {/* Section 1: Scraper Health */}
      <div className="panel">
        <h2>Scraper Health</h2>
        <div className="row">
          <Stat label="Calls / min" value={api.callsLastMinute} color={callsColor} sub={`${api.callsLast5Min} in 5 min`} />
          <Stat label="Success rate" value={api.successRate} sub={`${fmt(api.successCalls)} / ${fmt(api.totalCalls)} ok`} />
          <Stat label="Rate limited" value={fmt(api.rateLimited)} color={api.rateLimited > 0 ? WARN : GOOD} sub="429s" />
          <Stat
            label="Last call"
            value={api.lastCallSecondsAgo == null ? "—" : `${api.lastCallSecondsAgo}s ago`}
            color={lastCallColor}
          />
          <Stat label="Uptime" value={`${api.uptimeMinutes} min`} />
          <Stat label="Total calls" value={fmt(api.totalCalls)} sub={`${fmt(api.failedCalls)} failed`} />
        </div>
      </div>

      {/* Section 2: API Call Breakdown */}
      <div className="panel">
        <h2>API Call Breakdown</h2>
        {endpoints.length === 0 ? (
          <div className="muted">No API calls recorded yet (stats reset on deploy).</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Endpoint</th>
                <th style={th}>Total</th>
                <th style={th}>Success</th>
                <th style={th}>Failed</th>
                <th style={th}>Ratio</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map(([name, e]) => (
                <tr key={name}>
                  <td style={{ ...td, fontFamily: "monospace" }}>{name}</td>
                  <td style={td}>{fmt(e.total)}</td>
                  <td style={{ ...td, color: GOOD }}>{fmt(e.success)}</td>
                  <td style={{ ...td, color: e.fail > 0 ? BAD : MUTED }}>{fmt(e.fail)}</td>
                  <td style={td}><RatioBar success={e.success} fail={e.fail} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Section 3: Worker Cycle History */}
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Worker Cycle History</h2>
          <span className="badge">
            {worker.nextCycleIn == null ? `interval ${worker.intervalMinutes} min` : `Next cycle in ~${worker.nextCycleIn} min`}
          </span>
        </div>
        {(!cycles || cycles.length === 0) ? (
          <div className="muted" style={{ marginTop: 12 }}>No cycles recorded yet on this instance.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
            <thead>
              <tr>
                <th style={th}>Started</th>
                <th style={th}>Duration</th>
                <th style={th}>Accounts</th>
                <th style={th}>Reels Imported</th>
                <th style={th}>New Posts</th>
                <th style={th}>Viral Found</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...cycles].reverse().map((c: any, i: number) => (
                <tr key={i}>
                  <td style={td}>{timeHM(c.startedAt)}</td>
                  <td style={td}>{Math.round(c.durationSec / 60)}min</td>
                  <td style={td}>{fmt(c.result?.accounts || 0)}</td>
                  <td style={td}>{fmt(c.result?.reelsImported || 0)}</td>
                  <td style={td}>{fmt(c.result?.newPosts || 0)}</td>
                  <td style={td}>{fmt(c.result?.viralFound || 0)}</td>
                  <td style={td}>{c.result?.error ? <span style={{ color: BAD }}>⚠ Error</span> : <span style={{ color: GOOD }}>✅ Done</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Section 4: Database Stats */}
      <div className="panel">
        <h2>Database Stats</h2>
        <div className="row" style={{ marginBottom: 16 }}>
          <Stat label="Total accounts" value={fmt(database.totalAccounts)} />
          <Stat label="With reels" value={fmt(database.accountsWithReels)} color={GOOD} />
          <Stat label="In backlog" value={fmt(database.accountsInBacklog)} color={database.accountsInBacklog > 0 ? WARN : GOOD} />
          <Stat label="Total reels" value={fmt(database.totalReels)} />
          <Stat label="Viral reels" value={fmt(database.viralReels)} color={GOOD} />
        </div>

        <div style={{ maxWidth: 520 }}>
          <div className="muted" style={{ fontSize: 12 }}>Backlog processed — {backlogDone}% done ({fmt(database.accountsWithReels)}/{fmt(database.totalAccounts)})</div>
          <Progress pct={backlogDone} color={GOOD} />

          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Reels with thumbnails — {fmt(database.reelsWithThumbnails)} ({thumbPct.toFixed(1)}%)</div>
          <Progress pct={thumbPct} color={GOOD} />

          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Reels with video — {fmt(database.reelsWithVideo)} ({videoPct.toFixed(1)}%)</div>
          <Progress pct={videoPct} />

          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Reels with niche — {fmt(database.reelsWithNiche)} ({nichePct.toFixed(1)}%)</div>
          <Progress pct={nichePct} color={nichePct > 0 ? "var(--accent)" : BAD} />

          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Reels categorized — {fmt(database.reelsCategorized)}</div>
        </div>
      </div>

      {/* Section 5: Environment Status */}
      <div className="panel">
        <h2>Environment Status</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {envRows.map((r) => (
            <div key={r.label} className="row" style={{ justifyContent: "space-between", maxWidth: 520 }}>
              <span>
                {r.ok ? "✅" : "❌"} {r.label}
                {r.note && <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>({r.note})</span>}
              </span>
              <span className="badge" style={{ color: r.ok ? GOOD : BAD }}>{r.ok ? "configured" : "not configured"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
