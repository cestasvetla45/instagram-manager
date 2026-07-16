"use client";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend,
} from "recharts";
import ConfigBanner from "../components/ConfigBanner";
import { fmt, pct } from "../components/util";

const AXIS = { stroke: "#9a9ab0", fontSize: 12 };
const GRID = "#2a2a3d";
const TIP = { background: "#14141f", border: "1px solid #2a2a3d", borderRadius: 8 };

export default function Analytics() {
  const [our, setOur] = useState<any[]>([]);
  const [insp, setInsp] = useState<any[]>([]);
  const [snaps, setSnaps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/reels?type=our").then((r) => r.json()),
      fetch("/api/reels?type=inspiration").then((r) => r.json()),
      fetch("/api/snapshots").then((r) => r.json()),
    ]).then(([a, b, c]) => {
      setOur(a.records || []);
      setInsp(b.records || []);
      setSnaps(c.records || []);
      setLoading(false);
    });
  }, []);

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  const kpis = useMemo(() => {
    const er = mean(our.map((r) => Number(r.fields["Engagement Rate"] || 0)).filter((v) => v > 0));
    const vf = mean(our.map((r) => Number(r.fields["View/Follow Ratio"] || 0)).filter((v) => v > 0));
    const bestVf = Math.max(0, ...our.map((r) => Number(r.fields["View/Follow Ratio"] || 0)));
    return { er, vf, bestVf };
  }, [our]);

  const topOur = useMemo(
    () =>
      [...our]
        .sort((a, b) => Number(b.fields.Views || 0) - Number(a.fields.Views || 0))
        .slice(0, 12)
        .map((r) => ({
          name: (r.fields.Shortcode || r.fields["Reel URL"] || "").toString().slice(-8),
          Views: Number(r.fields.Views || 0),
        })),
    [our]
  );

  // Average views over time, per source, from snapshots.
  const viewTrend = useMemo(() => {
    const byDate: Record<string, { date: string; Our: number[]; Inspiration: number[] }> = {};
    for (const s of snaps) {
      const f = s.fields;
      const d = f["Snapshot Date"];
      if (!d) continue;
      byDate[d] = byDate[d] || { date: d, Our: [], Inspiration: [] };
      (byDate[d] as any)[f.Source === "Our" ? "Our" : "Inspiration"].push(Number(f.Views || 0));
    }
    return Object.values(byDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ date: d.date.slice(5), Our: Math.round(mean(d.Our)), Inspiration: Math.round(mean(d.Inspiration)) }));
  }, [snaps]);

  // Engagement rate + view/follow ratio over time for OUR posts.
  const healthTrend = useMemo(() => {
    const byDate: Record<string, { date: string; er: number[]; vf: number[] }> = {};
    for (const s of snaps) {
      const f = s.fields;
      if (f.Source !== "Our") continue;
      const d = f["Snapshot Date"];
      if (!d) continue;
      byDate[d] = byDate[d] || { date: d, er: [], vf: [] };
      if (f["Engagement Rate"] != null) byDate[d].er.push(Number(f["Engagement Rate"]));
      if (f["View/Follow Ratio"] != null) byDate[d].vf.push(Number(f["View/Follow Ratio"]));
    }
    return Object.values(byDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date.slice(5),
        "Engagement %": +(mean(d.er) * 100).toFixed(2),
        "Views/Follower": +mean(d.vf).toFixed(2),
      }));
  }, [snaps]);

  // Per-reel view/follow ratio (current), top reach.
  const reachByReel = useMemo(
    () =>
      [...our]
        .filter((r) => Number(r.fields["View/Follow Ratio"] || 0) > 0)
        .sort((a, b) => Number(b.fields["View/Follow Ratio"] || 0) - Number(a.fields["View/Follow Ratio"] || 0))
        .slice(0, 12)
        .map((r) => ({
          name: (r.fields.Shortcode || r.fields["Reel URL"] || "").toString().slice(-8),
          "Views/Follower": Number(r.fields["View/Follow Ratio"] || 0),
        })),
    [our]
  );

  const benchmark = useMemo(() => {
    const avgViews = (recs: any[]) => Math.round(mean(recs.map((r) => Number(r.fields.Views || 0))));
    return [
      { name: "Our reels", AvgViews: avgViews(our) },
      { name: "Inspiration", AvgViews: avgViews(insp) },
    ];
  }, [our, insp]);

  if (loading) return <div><h1 className="h1">Analytics</h1><p className="muted"><span className="spinner" /> Loading…</p></div>;

  return (
    <div>
      <h1 className="h1">Analytics</h1>
      <p className="sub">Engagement, reach (views-per-follower), and trends across your reels.</p>
      <ConfigBanner />

      <div className="cards">
        <div className="card"><div className="k">Our avg engagement</div><div className="v">{pct(kpis.er)}</div></div>
        <div className="card"><div className="k">Our avg views/follower</div><div className="v">{kpis.vf.toFixed(2)}×</div></div>
        <div className="card"><div className="k">Best reel reach</div><div className="v">{kpis.bestVf.toFixed(2)}×</div></div>
      </div>

      <div className="panel">
        <h2>Engagement rate &amp; reach over time (our posts)</h2>
        {healthTrend.length === 0 ? (
          <p className="muted">Refresh metrics a few times (or let the daily cron run) to build these trends.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={healthTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="date" tick={AXIS} />
              <YAxis yAxisId="er" tick={AXIS} tickFormatter={(v) => v + "%"} />
              <YAxis yAxisId="vf" orientation="right" tick={AXIS} tickFormatter={(v) => v + "×"} />
              <Tooltip contentStyle={TIP} />
              <Legend />
              <Line yAxisId="er" type="monotone" dataKey="Engagement %" stroke="#e1306c" strokeWidth={2} dot={false} />
              <Line yAxisId="vf" type="monotone" dataKey="Views/Follower" stroke="#3ad1c6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="panel">
        <h2>Reach by reel — views per follower (ours)</h2>
        {reachByReel.length === 0 ? <p className="muted">No data yet. Add some of your reels and make sure your account is saved so follower counts resolve.</p> : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={reachByReel}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="name" tick={AXIS} />
              <YAxis tick={AXIS} tickFormatter={(v) => v + "×"} />
              <Tooltip contentStyle={TIP} formatter={(v: any) => Number(v).toFixed(2) + "×"} />
              <Bar dataKey="Views/Follower" fill="#3ad1c6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="panel">
        <h2>Top performing reels by views (ours)</h2>
        {topOur.length === 0 ? <p className="muted">No data yet.</p> : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topOur}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="name" tick={AXIS} />
              <YAxis tick={AXIS} tickFormatter={fmt} />
              <Tooltip contentStyle={TIP} formatter={(v: any) => fmt(v)} />
              <Bar dataKey="Views" fill="#e1306c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="panel">
        <h2>Average views over time</h2>
        {viewTrend.length === 0 ? <p className="muted">Refresh metrics a few times to build a trend line.</p> : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={viewTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="date" tick={AXIS} />
              <YAxis tick={AXIS} tickFormatter={fmt} />
              <Tooltip contentStyle={TIP} formatter={(v: any) => fmt(v)} />
              <Legend />
              <Line type="monotone" dataKey="Our" stroke="#e1306c" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Inspiration" stroke="#833ab4" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="panel">
        <h2>Benchmark: our avg views vs. inspiration</h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={benchmark} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis type="number" tick={AXIS} tickFormatter={fmt} />
            <YAxis type="category" dataKey="name" tick={AXIS} width={110} />
            <Tooltip contentStyle={TIP} formatter={(v: any) => fmt(v)} />
            <Bar dataKey="AvgViews" fill="#833ab4" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
