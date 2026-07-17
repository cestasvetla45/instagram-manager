"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  ReferenceLine, Scatter, ComposedChart,
} from "recharts";
import ConfigBanner from "../components/ConfigBanner";
import { fmt } from "../components/util";

const AXIS = { stroke: "#9a9ab0", fontSize: 11 };
const GRID = "#2a2a3d";
const TIP = { background: "#14141f", border: "1px solid #2a2a3d", borderRadius: 8, fontSize: 12 };
const COLORS = ["#e1306c", "#833ab4", "#3ad1c6", "#f1c40f", "#3498db", "#2ecc71", "#e67e22"];

function shortDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function shortDateTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function ago(iso: string) {
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type Reel = {
  fields: {
    "Reel URL": string;
    "Account Handle": string;
    Views: number;
    Likes: number;
    Comments: number;
    Shares: number;
    Saves: number;
    "Posted At": string;
    "Updated At": string;
    Thumbnail: string;
    Caption: string;
  };
};

type Snapshot = {
  fields: {
    "Account Handle": string;
    "Followers": number;
    "Total Views": number;
    "Reel Count": number;
    "Snapshot At": string;
  };
};

type Account = {
  fields: {
    Handle: string;
    Followers: number;
    "Full Name": string;
  };
};

export default function Dashboard() {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [accts, setAccts] = useState<Account[]>([]);
  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const [selectedAcct, setSelectedAcct] = useState<string>("all");

  useEffect(() => {
    Promise.all([
      fetch("/api/account-snapshots").then((r) => r.json()),
      fetch("/api/accounts?type=our").then((r) => r.json()),
      fetch("/api/reels?type=our&limit=500").then((r) => r.json()),
    ]).then(([s, a, r]) => {
      setSnaps(s.records || []);
      setAccts(a.records || []);
      setReels(r.records || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handles = useMemo(
    () => accts.map((a) => String(a.fields.Handle || "")).filter(Boolean).sort(),
    [accts]
  );

  // Date filter
  const cutoffDate = useMemo(() => {
    if (dateRange === "all") return new Date(0);
    const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
    return new Date(Date.now() - days * 86400000);
  }, [dateRange]);

  // Filter snapshots by date range and selected account
  const filteredSnaps = useMemo(() => {
    return snaps.filter((s) => {
      const at = s.fields["Snapshot At"];
      if (!at || new Date(at) < cutoffDate) return false;
      if (selectedAcct !== "all" && s.fields["Account Handle"] !== selectedAcct) return false;
      return true;
    });
  }, [snaps, cutoffDate, selectedAcct]);

  // Filter reels by date range and selected account
  const filteredReels = useMemo(() => {
    return reels.filter((r) => {
      const at = r.fields["Posted At"] || r.fields["Updated At"];
      if (!at || new Date(at) < cutoffDate) return false;
      if (selectedAcct !== "all" && r.fields["Account Handle"] !== selectedAcct) return false;
      return true;
    });
  }, [reels, cutoffDate, selectedAcct]);

  // Build chart data: views over time, one series per account + combined
  const chartData = useMemo(() => {
    const byTime: Record<string, any> = {};
    for (const s of filteredSnaps) {
      const at = s.fields["Snapshot At"];
      if (!at) continue;
      const h = String(s.fields["Account Handle"] || "");
      const key = at.substring(0, 16); // group by hour
      byTime[key] = byTime[key] || { at, label: shortDateTime(at), Combined: 0, posts: 0 };
      byTime[key][h] = Number(s.fields["Total Views"] || 0);
      byTime[key].Combined += Number(s.fields["Total Views"] || 0);
      byTime[key].Reels = Number(s.fields["Reel Count"] || 0);
    }

    // Add markers for when new reels were posted
    for (const r of filteredReels) {
      const postedAt = r.fields["Posted At"];
      if (!postedAt) continue;
      const key = postedAt.substring(0, 16);
      if (byTime[key]) {
        byTime[key].posts++;
      }
    }

    return Object.values(byTime).sort((a: any, b: any) => a.at.localeCompare(b.at));
  }, [filteredSnaps, filteredReels]);

  // Current stats per account
  const accountStats = useMemo(() => {
    const latest: Record<string, Snapshot> = {};
    for (const s of filteredSnaps) {
      const h = String(s.fields["Account Handle"] || "");
      if (!latest[h] || s.fields["Snapshot At"] > latest[h].fields["Snapshot At"]) latest[h] = s;
    }
    return handles.map((h) => {
      const s = latest[h];
      const accountReels = filteredReels.filter(
        (r) => String(r.fields["Account Handle"] || "").toLowerCase() === h.toLowerCase()
      );
      const totalViews = accountReels.reduce((sum, r) => sum + Number(r.fields.Views || 0), 0);
      const totalLikes = accountReels.reduce((sum, r) => sum + Number(r.fields.Likes || 0), 0);
      const totalComments = accountReels.reduce((sum, r) => sum + Number(r.fields.Comments || 0), 0);
      const avgViews = accountReels.length ? Math.round(totalViews / accountReels.length) : 0;
      const er = totalViews > 0 ? ((totalLikes + totalComments) / totalViews * 100).toFixed(1) : "0.0";
      const acctInfo = accts.find((a) => String(a.fields.Handle).toLowerCase() === h.toLowerCase());
      return {
        handle: h,
        fullName: acctInfo?.fields["Full Name"] || "",
        followers: Number(s?.fields["Followers"] || acctInfo?.fields["Followers"] || 0),
        totalViews,
        totalLikes,
        totalComments,
        reelCount: accountReels.length,
        avgViews,
        engagementRate: er,
        lastSync: s?.fields["Snapshot At"] || "—",
        latestReel: accountReels[0]?.fields["Posted At"] || "—",
      };
    });
  }, [filteredSnaps, filteredReels, handles, accts]);

  // Combined totals
  const totals = useMemo(() => {
    const totalViews = accountStats.reduce((s, a) => s + a.totalViews, 0);
    const totalFollowers = accountStats.reduce((s, a) => s + a.followers, 0);
    const totalReels = accountStats.reduce((s, a) => s + a.reelCount, 0);
    const totalLikes = accountStats.reduce((s, a) => s + a.totalLikes, 0);
    const totalComments = accountStats.reduce((s, a) => s + a.totalComments, 0);
    const er = totalViews > 0 ? ((totalLikes + totalComments) / totalViews * 100).toFixed(1) : "0.0";
    return { totalViews, totalFollowers, totalReels, totalLikes, totalComments, er };
  }, [accountStats]);

  if (loading) {
    return (
      <div>
        <h1 className="h1">Accounts Dashboard</h1>
        <ConfigBanner />
        <div className="panel" style={{ padding: 40, textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
          <p className="muted" style={{ marginTop: 12 }}>Loading dashboard data…</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="h1">Accounts Dashboard</h1>
      <p className="sub">Live view of your accounts — stats refreshed continuously.</p>
      <ConfigBanner />

      {/* Filter Bar */}
      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={selectedAcct}
          onChange={(e) => setSelectedAcct(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 13 }}
        >
          <option value="all">All Accounts</option>
          {handles.map((h) => (
            <option key={h} value={h}>@{h}</option>
          ))}
        </select>

        <div className="row" style={{ gap: 4 }}>
          {(["7d", "30d", "90d", "all"] as const).map((d) => (
            <button
              key={d}
              className={dateRange === d ? "" : "secondary"}
              onClick={() => setDateRange(d)}
              style={{ padding: "6px 12px", fontSize: 12, borderRadius: 6 }}
            >
              {d === "all" ? "All time" : d}
            </button>
          ))}
        </div>

        <div className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
          Last sync: {accountStats[0]?.lastSync ? ago(accountStats[0].lastSync) : "—"}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KPICard label="Total Views" value={fmt(totals.totalViews)} color="#e1306c" />
        <KPICard label="Followers" value={fmt(totals.totalFollowers)} color="#833ab4" />
        <KPICard label="Reels Posted" value={fmt(totals.totalReels)} color="#3ad1c6" />
        <KPICard label="Total Likes" value={fmt(totals.totalLikes)} color="#f1c40f" />
        <KPICard label="Total Comments" value={fmt(totals.totalComments)} color="#3498db" />
        <KPICard label="Engagement Rate" value={`${totals.er}%`} color="#2ecc71" />
      </div>

      {/* Chart: Views Over Time + Post Markers */}
      <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>📈 Views Over Time</strong>
          <span className="muted" style={{ fontSize: 11 }}>● dots = new reel posted</span>
        </div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={AXIS} />
              <YAxis tickFormatter={(v) => fmt(v)} tick={AXIS} />
              <Tooltip contentStyle={TIP} formatter={(v: any) => fmt(Number(v))} />
              <Legend />
              {selectedAcct === "all" ? (
                <Line type="monotone" dataKey="Combined" stroke="#e1306c" strokeWidth={2} dot={false} name="Combined Views" />
              ) : (
                <Line type="monotone" dataKey={selectedAcct} stroke="#e1306c" strokeWidth={2} dot={false} name={`@${selectedAcct}`} />
              )}
              <Scatter dataKey="posts" fill="#f1c40f" shape="star" name="New Posts" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="muted" style={{ textAlign: "center", padding: 40 }}>No data for this period</div>
        )}
      </div>

      {/* Account Cards Table */}
      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "12px 16px", fontWeight: 600 }}>Account</th>
              <th style={{ padding: "12px 8px", fontWeight: 600, textAlign: "right" }}>Followers</th>
              <th style={{ padding: "12px 8px", fontWeight: 600, textAlign: "right" }}>Reels</th>
              <th style={{ padding: "12px 8px", fontWeight: 600, textAlign: "right" }}>Total Views</th>
              <th style={{ padding: "12px 8px", fontWeight: 600, textAlign: "right" }}>Avg Views</th>
              <th style={{ padding: "12px 8px", fontWeight: 600, textAlign: "right" }}>Likes</th>
              <th style={{ padding: "12px 8px", fontWeight: 600, textAlign: "right" }}>ER%</th>
              <th style={{ padding: "12px 8px", fontWeight: 600 }}>Last Reel</th>
              <th style={{ padding: "12px 8px", fontWeight: 600 }}>Last Sync</th>
            </tr>
          </thead>
          <tbody>
            {accountStats.map((a, i) => {
              const color = COLORS[i % COLORS.length];
              return (
                <tr key={a.handle} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                      <span style={{ fontWeight: 600 }}>@{a.handle}</span>
                      {a.fullName && <span className="muted" style={{ fontSize: 11 }}>{a.fullName}</span>}
                    </div>
                  </td>
                  <td style={{ padding: "10px 8px", textAlign: "right" }}>{fmt(a.followers)}</td>
                  <td style={{ padding: "10px 8px", textAlign: "right" }}>{a.reelCount}</td>
                  <td style={{ padding: "10px 8px", textAlign: "right", color, fontWeight: 600 }}>{fmt(a.totalViews)}</td>
                  <td style={{ padding: "10px 8px", textAlign: "right" }}>{fmt(a.avgViews)}</td>
                  <td style={{ padding: "10px 8px", textAlign: "right" }}>{fmt(a.totalLikes)}</td>
                  <td style={{ padding: "10px 8px", textAlign: "right" }}>{a.engagementRate}%</td>
                  <td style={{ padding: "10px 8px" }} className="muted">{a.latestReel !== "—" ? shortDate(a.latestReel) : "—"}</td>
                  <td style={{ padding: "10px 8px" }} className="muted">{ago(a.lastSync)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent Reels */}
      <div className="panel" style={{ padding: 16, marginTop: 20 }}>
        <strong style={{ fontSize: 14, marginBottom: 12, display: "block" }}>🎬 Recent Reels</strong>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {filteredReels.slice(0, 12).map((r, i) => {
            const f = r.fields;
            const color = COLORS[handles.indexOf(String(f["Account Handle"])) % COLORS.length];
            return (
              <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                <a href={f["Reel URL"]} target="_blank" rel="noopener" style={{ display: "block" }}>
                  {f.Thumbnail ? (
                    <img src={typeof f.Thumbnail === "string" ? f.Thumbnail : (f.Thumbnail as any)?.[0]?.url} alt="" style={{ width: "100%", height: 120, objectFit: "cover" }} loading="lazy" />
                  ) : (
                    <div style={{ width: "100%", height: 120, background: "#222" }} />
                  )}
                </a>
                <div style={{ padding: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>@{f["Account Handle"]}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#9a9ab0" }}>
                    {fmt(f.Views)} views · {fmt(f.Likes)} likes · {f["Posted At"] ? shortDate(f["Posted At"]) : "—"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="panel" style={{ padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "#9a9ab0", textTransform: "uppercase", marginBottom: 4, letterSpacing: 0.05 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
