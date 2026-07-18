"use client";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts";
import ConfigBanner from "../components/ConfigBanner";
import { fmt } from "../components/util";

const AXIS = { stroke: "#9a9ab0", fontSize: 12 };
const GRID = "#2a2a3d";
const TIP = { background: "#14141f", border: "1px solid #2a2a3d", borderRadius: 8 };

export default function Growth() {
  const [snaps, setSnaps] = useState<any[]>([]);
  const [accts, setAccts] = useState<any[]>([]);
  const [scope, setScope] = useState("ALL");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/account-snapshots").then((r) => r.json()),
      fetch("/api/accounts?type=our").then((r) => r.json()),
    ]).then(([s, a]) => {
      setSnaps(s.records || []);
      setAccts(a.records || []);
      setLoading(false);
    });
  }, []);

  // Archived accounts (active === false) are excluded from the roster/combined
  // totals — they're no longer part of the active growth story.
  const handles = useMemo(
    () =>
      accts
        .filter((a) => a.fields.Active !== false)
        .map((a) => String(a.fields.Handle || ""))
        .filter(Boolean),
    [accts]
  );
  const handleSet = useMemo(() => new Set(handles.map((h) => h.toLowerCase())), [handles]);

  // Reduce to the latest snapshot per (handle, day).
  const series = useMemo(() => {
    // map: day -> handle -> {followers, views}
    const byDay: Record<string, Record<string, { followers: number; views: number; at: string }>> = {};
    for (const s of snaps) {
      const f = s.fields;
      const at = f["Snapshot At"];
      if (!at) continue;
      const h = String(f["Account Handle"] || "");
      if (!handleSet.has(h.toLowerCase())) continue;
      const day = String(at).slice(0, 10);
      byDay[day] = byDay[day] || {};
      const prev = byDay[day][h];
      if (!prev || at > prev.at) {
        byDay[day][h] = {
          followers: Number(f["Followers"] || 0),
          views: Number(f["Total Views"] || 0),
          at,
        };
      }
    }

    const days = Object.keys(byDay).sort();
    return days.map((day) => {
      const perHandle = byDay[day];
      let followers = 0;
      let views = 0;
      if (scope === "ALL") {
        for (const h of Object.keys(perHandle)) {
          followers += perHandle[h].followers;
          views += perHandle[h].views;
        }
      } else {
        followers = perHandle[scope]?.followers || 0;
        views = perHandle[scope]?.views || 0;
      }
      return { day: day.slice(5), followers, views };
    });
  }, [snaps, scope, handleSet]);

  // daily deltas (growth)
  const deltas = useMemo(() => {
    const out: any[] = [];
    for (let i = 1; i < series.length; i++) {
      out.push({
        day: series[i].day,
        "Δ Followers": series[i].followers - series[i - 1].followers,
        "Δ Views": series[i].views - series[i - 1].views,
      });
    }
    return out;
  }, [series]);

  const latest = series[series.length - 1];
  const first = series[0];
  const folGain = latest && first ? latest.followers - first.followers : 0;
  const viewGain = latest && first ? latest.views - first.views : 0;

  return (
    <div>
      <h1 className="h1">Growth</h1>
      <p className="sub">Followers and views over time. Pick one account or view all combined.</p>
      <ConfigBanner />

      <div className="row" style={{ marginBottom: 18 }}>
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ minWidth: 220 }}>
          <option value="ALL">All accounts (combined)</option>
          {handles.map((h) => (
            <option key={h} value={h}>@{h}</option>
          ))}
        </select>
      </div>

      <div className="cards">
        <div className="card"><div className="k">Followers now</div><div className="v">{fmt(latest?.followers || 0)}</div></div>
        <div className="card"><div className="k">Followers gained (tracked)</div><div className="v">{folGain >= 0 ? "+" : ""}{fmt(folGain)}</div></div>
        <div className="card"><div className="k">Total views now</div><div className="v">{fmt(latest?.views || 0)}</div></div>
        <div className="card"><div className="k">Views gained (tracked)</div><div className="v">{viewGain >= 0 ? "+" : ""}{fmt(viewGain)}</div></div>
      </div>

      {loading ? (
        <p className="muted"><span className="spinner" /> Loading…</p>
      ) : series.length === 0 ? (
        <p className="muted">No snapshots yet. Each refresh logs a daily point — once a couple of refreshes have run, growth lines appear here.</p>
      ) : (
        <>
          <div className="panel">
            <h2>Followers over time {scope !== "ALL" ? `— @${scope}` : "(combined)"}</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="day" tick={AXIS} />
                <YAxis tick={AXIS} tickFormatter={fmt} domain={["auto", "auto"]} />
                <Tooltip contentStyle={TIP} formatter={(v: any) => fmt(v)} />
                <Line type="monotone" dataKey="followers" name="Followers" stroke="#3ad1c6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="panel">
            <h2>Total views over time {scope !== "ALL" ? `— @${scope}` : "(combined)"}</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="day" tick={AXIS} />
                <YAxis tick={AXIS} tickFormatter={fmt} />
                <Tooltip contentStyle={TIP} formatter={(v: any) => fmt(v)} />
                <Line type="monotone" dataKey="views" name="Total views" stroke="#e1306c" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="panel">
            <h2>Daily growth (day-over-day change)</h2>
            {deltas.length === 0 ? (
              <p className="muted">Needs at least two days of snapshots to show daily change.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={deltas}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="day" tick={AXIS} />
                  <YAxis yAxisId="f" tick={AXIS} tickFormatter={fmt} />
                  <YAxis yAxisId="v" orientation="right" tick={AXIS} tickFormatter={fmt} />
                  <Tooltip contentStyle={TIP} formatter={(v: any) => fmt(v)} />
                  <Legend />
                  <Bar yAxisId="f" dataKey="Δ Followers" fill="#3ad1c6" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="v" dataKey="Δ Views" fill="#e1306c" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
}
