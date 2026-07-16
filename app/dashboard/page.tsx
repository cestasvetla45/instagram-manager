"use client";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import ConfigBanner from "../components/ConfigBanner";
import { fmt } from "../components/util";

const AXIS = { stroke: "#9a9ab0", fontSize: 12 };
const GRID = "#2a2a3d";
const TIP = { background: "#14141f", border: "1px solid #2a2a3d", borderRadius: 8 };
const COLORS = ["#e1306c", "#833ab4", "#3ad1c6", "#f1c40f", "#3498db", "#2ecc71", "#e67e22"];

function shortTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function ago(iso: string) {
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Dashboard() {
  const [snaps, setSnaps] = useState<any[]>([]);
  const [accts, setAccts] = useState<any[]>([]);
  const [reels, setReels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/account-snapshots").then((r) => r.json()),
      fetch("/api/accounts?type=our").then((r) => r.json()),
      fetch("/api/reels?type=our").then((r) => r.json()),
    ]).then(([s, a, r]) => {
      setSnaps(s.records || []);
      setAccts(a.records || []);
      setReels(r.records || []);
      setLoading(false);
    });
  }, []);

  const handles = useMemo(
    () => accts.map((a) => String(a.fields.Handle || "")).filter(Boolean),
    [accts]
  );

  // total views over time, one series per account, plus combined
  const trend = useMemo(() => {
    const byTime: Record<string, any> = {};
    for (const s of snaps) {
      const at = s.fields["Snapshot At"];
      if (!at) continue;
      const h = String(s.fields["Account Handle"] || "");
      byTime[at] = byTime[at] || { at, label: shortTime(at), Combined: 0 };
      byTime[at][h] = Number(s.fields["Total Views"] || 0);
      byTime[at].Combined += Number(s.fields["Total Views"] || 0);
    }
    return Object.values(byTime).sort((a: any, b: any) => a.at.localeCompare(b.at));
  }, [snaps]);

  // current totals from the latest snapshot per account (fallback: sum reels)
  const current = useMemo(() => {
    const latest: Record<string, any> = {};
    for (const s of snaps) {
      const h = String(s.fields["Account Handle"] || "");
      if (!latest[h] || s.fields["Snapshot At"] > latest[h].fields["Snapshot At"]) latest[h] = s;
    }
    return handles.map((h) => {
      const s = latest[h];
      const fromReels = reels
        .filter((r) => String(r.fields["Account Handle"] || "").toLowerCase() === h.toLowerCase())
        .reduce((sum, r) => sum + Number(r.fields.Views || 0), 0);
      return {
        handle: h,
        views: s ? Number(s.fields["Total Views"] || 0) : fromReels,
        followers: s ? Number(s.fields["Followers"] || 0) : 0,
        reels: s ? Number(s.fields["Reel Count"] || 0) : 0,
      };
    });
  }, [snaps, handles, reels]);

  const combinedViews = current.reduce((s, c) => s + c.views, 0);

  // recently posted reels across our accounts
  const recent = useMemo(() => {
    return [...reels]
      .filter((r) => r.fields["Posted At"] || r.fields["First Seen At"])
      .sort((a, b) =>
        String(b.fields["Posted At"] || b.fields["First Seen At"] || "").localeCompare(
          String(a.fields["Posted At"] || a.fields["First Seen At"] || "")
        )
      )
      .slice(0, 15);
  }, [reels]);

  if (loading) return <div><h1 className="h1">Accounts Dashboard</h1><p className="muted"><span className="spinner" /> Loading…</p></div>;

  return (
    <div>
      <h1 className="h1">Accounts Dashboard</h1>
      <p className="sub">Live view of your accounts — total views (refreshed every 2h) and newly posted reels.</p>
      <ConfigBanner />

      <div className="cards">
        <div className="card"><div className="k">Combined views</div><div className="v">{fmt(combinedViews)}</div></div>
        {current.map((c) => (
          <div className="card" key={c.handle}>
            <div className="k">@{c.handle}</div>
            <div className="v">{fmt(c.views)}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{fmt(c.followers)} followers · {c.reels} reels</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Total views over time</h2>
        {trend.length === 0 ? (
          <p className="muted">Building — the first points appear after the 2-hourly job runs (or hit “Refresh metrics” on Our Reels).</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="label" tick={AXIS} />
              <YAxis tick={AXIS} tickFormatter={fmt} />
              <Tooltip contentStyle={TIP} formatter={(v: any) => fmt(v)} />
              <Legend />
              <Line type="monotone" dataKey="Combined" stroke="#fff" strokeWidth={2.5} dot={false} />
              {handles.map((h, i) => (
                <Line key={h} type="monotone" dataKey={h} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="panel">
        <h2>Recently posted</h2>
        {recent.length === 0 ? (
          <p className="muted">No posts detected yet. Add your accounts on Add / Scrape — new reels are picked up automatically every 2h.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Account</th><th>Posted</th><th>Detected</th><th>Views</th><th>ER</th><th></th></tr>
            </thead>
            <tbody>
              {recent.map((r) => {
                const f = r.fields;
                const posted = f["Posted At"];
                return (
                  <tr key={r.id}>
                    <td>@{f["Account Handle"] || "?"}</td>
                    <td>{posted ? <>{shortTime(posted)} <span className="muted">· {ago(posted)}</span></> : "—"}</td>
                    <td className="muted">{f["First Seen At"] ? ago(f["First Seen At"]) : "—"}</td>
                    <td>{fmt(f.Views)}</td>
                    <td>{((Number(f["Engagement Rate"] || 0)) * 100).toFixed(1)}%</td>
                    <td>{f["Reel URL"] ? <a href={f["Reel URL"]} target="_blank" rel="noreferrer" className="badge">open</a> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
