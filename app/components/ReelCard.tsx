"use client";
import { fmt, pct, attachUrl } from "./util";

export default function ReelCard({ rec }: { rec: any }) {
  const f = rec.fields || {};
  const thumb = attachUrl(f.Thumbnail);
  const url = f["Reel URL"];
  const handle = f["Author Handle"] || f["Account Handle"] || "";
  return (
    <div className="reel">
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={thumb} alt={handle} loading="lazy" />
      ) : (
        <div className="thumb placeholder">no thumbnail</div>
      )}
      <div className="body">
        <div className="handle">@{handle || "unknown"}</div>
        <div className="cap">{f.Caption || ""}</div>
        <div className="stats">
          <span><b>{fmt(f.Views)}</b> views</span>
          <span>{fmt(f.Likes)} likes</span>
          <span>{fmt(f.Comments)} cmts</span>
          <span>{pct(f["Engagement Rate"])} ER</span>
        </div>
      </div>
      <div className="actions">
        {url && (
          <a className="secondary" href={url} target="_blank" rel="noreferrer" style={{ border: "1px solid var(--border)", borderRadius: 8 }}>
            Open
          </a>
        )}
        {url && (
          <a href={`/api/download?url=${encodeURIComponent(url)}`} style={{ background: "linear-gradient(90deg,var(--accent),var(--accent-2))", color: "#fff", borderRadius: 8 }}>
            Download
          </a>
        )}
      </div>
    </div>
  );
}
