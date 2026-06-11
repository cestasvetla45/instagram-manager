"use client";
import { useEffect, useState } from "react";
import ConfigBanner from "../components/ConfigBanner";
import { fmt, attachUrl } from "../components/util";

function AccountTable({ type }: { type: "inspiration" | "our" }) {
  const [recs, setRecs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/accounts?type=${type}`).then((r) => r.json()).then((j) => {
      setRecs(j.records || []);
      setLoading(false);
    });
  }, [type]);

  if (loading) return <p className="muted"><span className="spinner" /> Loading…</p>;
  if (!recs.length) return <p className="muted">No accounts yet. Add them on the <b>Add / Scrape</b> page.</p>;

  return (
    <table>
      <thead>
        <tr><th></th><th>Handle</th><th>Niche</th><th>Followers</th><th>Posts</th><th>Notes</th></tr>
      </thead>
      <tbody>
        {recs.map((r) => {
          const f = r.fields;
          const pic = attachUrl(f["Profile Pic"]);
          return (
            <tr key={r.id}>
              <td style={{ width: 40 }}>
                {pic ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pic} alt="" style={{ width: 32, height: 32, borderRadius: "50%" }} />
                ) : null}
              </td>
              <td>
                <a href={f["Profile URL"] || `https://instagram.com/${f.Handle}`} target="_blank" rel="noreferrer">
                  @{f.Handle}
                </a>
                {f["Full Name"] ? <div className="muted" style={{ fontSize: 12 }}>{f["Full Name"]}</div> : null}
              </td>
              <td>{f.Niche || "—"}</td>
              <td>{fmt(f.Followers)}</td>
              <td>{fmt(f["Posts Count"])}</td>
              <td className="muted" style={{ maxWidth: 280 }}>{f["Why Saved"] || f.Notes || ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function AccountsPage() {
  return (
    <div>
      <h1 className="h1">Accounts</h1>
      <p className="sub">Accounts you watch for inspiration and your own accounts.</p>
      <ConfigBanner />
      <div className="panel">
        <h2>Inspiration accounts</h2>
        <AccountTable type="inspiration" />
      </div>
      <div className="panel">
        <h2>Our accounts</h2>
        <AccountTable type="our" />
      </div>
    </div>
  );
}
