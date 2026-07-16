"use client";
import { useState } from "react";
import { fmt, pct, attachUrl } from "./util";
import { scoreColor } from "@/lib/score";
import NicheCombo from "./NicheCombo";

export default function ReelCard({
  rec,
  niches,
  onTag,
  tagging,
  onAiCategorize,
  aiBusy,
}: {
  rec: any;
  niches?: string[];
  onTag?: (reelUrl: string, niche: string) => void;
  tagging?: boolean;
  onAiCategorize?: (reelUrl: string) => void;
  aiBusy?: boolean;
}) {
  const f = rec.fields || {};
  const aiNiche = f["AI Suggested Niche"];
  const aiConf = f["AI Confidence"];
  const thumb = attachUrl(f.Thumbnail);
  const savedVideo = attachUrl(f.Video);
  const url = f["Reel URL"];
  const handle = f["Author Handle"] || f["Account Handle"] || "";
  const score = f.Score;
  const hasScore = score != null && !isNaN(Number(score));
  return (
    <div className="reel">
      <div style={{ position: "relative" }}>
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={thumb} alt={handle} loading="lazy" />
        ) : (
          <div className="thumb placeholder">no thumbnail</div>
        )}
        {hasScore && (
          <div
            title="Inspiration score (0–10)"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: scoreColor(Number(score)),
              color: "#0b0b12",
              fontWeight: 800,
              fontSize: 13,
              padding: "3px 8px",
              borderRadius: 8,
              boxShadow: "0 2px 6px rgba(0,0,0,.35)",
            }}
          >
            {Number(score).toFixed(1)}
          </div>
        )}
        {savedVideo && (
          <span
            title="Video saved in your library"
            style={{
              position: "absolute",
              bottom: 8,
              left: 8,
              background: "rgba(0,0,0,.6)",
              color: "#fff",
              fontSize: 11,
              padding: "2px 7px",
              borderRadius: 6,
            }}
          >
            ▸ saved
          </span>
        )}
      </div>
      <div className="body">
        <div className="handle">
          @{handle || "unknown"}
          {f["Content Type"] && f["Content Type"] !== "reel" ? <span className="badge" style={{ marginLeft: 8, background: "var(--panel-2)" }}>{f["Content Type"] === "photo" ? "📷 photo" : "🖼 carousel"}</span> : null}
          {f.Format ? (
            <span
              className="badge"
              title={`${f.Format === "multi" ? "Multi-person (skit / interview / duet)" : "Single-person (dance / talking / solo)"}${f["Format Source"] ? ` — from ${f["Format Source"]}` : ""}`}
              style={{ marginLeft: 8, background: "var(--panel-2)" }}
            >
              {f.Format === "multi" ? "👥 multi" : "👤 single"}
              {f["Format Source"] === "video" ? " ✓" : ""}
            </span>
          ) : null}
          {f.Niche && !onTag ? <span className="badge" style={{ marginLeft: 8 }}>{f.Niche}</span> : null}
        </div>
        {onTag && (
          <NicheTagger
            value={f.Niche || ""}
            niches={niches || []}
            tagging={!!tagging}
            onTag={(v) => onTag(f["Reel URL"], v)}
          />
        )}
        {onAiCategorize && (
          <div style={{ marginTop: 4 }}>
            {aiNiche ? (
              <div style={{ fontSize: 12, background: "var(--panel-2)", borderRadius: 6, padding: "5px 7px" }}>
                <span title={f["AI Reason"] || ""}>
                  ✨ <b>{aiNiche}</b>{f["AI Is New"] ? " (new)" : ""}{aiConf != null ? ` · ${Math.round(Number(aiConf) * 100)}%` : ""}
                </span>
                {!f.Niche && onTag && (
                  <button
                    onClick={() => onTag(f["Reel URL"], aiNiche)}
                    disabled={tagging}
                    style={{ marginLeft: 8, fontSize: 11, padding: "2px 8px" }}
                  >
                    Accept
                  </button>
                )}
                {f["AI Reason"] && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{f["AI Reason"]}</div>}
              </div>
            ) : (
              <button className="secondary" onClick={() => onAiCategorize(f["Reel URL"])} disabled={aiBusy} style={{ fontSize: 11, padding: "3px 8px" }}>
                {aiBusy ? <><span className="spinner" /> Watching…</> : "✨ Suggest niche (AI)"}
              </button>
            )}
          </div>
        )}
        <div className="cap">{f.Caption || ""}</div>
        <div className="stats">
          <span><b>{fmt(f.Views)}</b> views</span>
          <span>{fmt(f.Likes)} likes</span>
          <span>{fmt(f.Comments)} cmts</span>
          <span>{pct(f["Engagement Rate"])} ER</span>
          {f["View/Follow Ratio"] ? (
            <span><b>{Number(f["View/Follow Ratio"]).toFixed(2)}×</b> views/follower</span>
          ) : null}
        </div>
        {f["Downloaded At"] && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            at download: {fmt(f["Views At Download"])} views · {fmt(f["Likes At Download"])} likes · {fmt(f["Comments At Download"])} cmts
          </div>
        )}
      </div>
      <div className="actions">
        {url && (
          <a className="secondary" href={url} target="_blank" rel="noreferrer" style={{ border: "1px solid var(--border)", borderRadius: 8 }}>
            Open
          </a>
        )}
        {savedVideo ? (
          <a href={savedVideo} target="_blank" rel="noreferrer" style={{ background: "linear-gradient(90deg,var(--accent),var(--accent-2))", color: "#fff", borderRadius: 8 }}>
            ▸ Saved copy
          </a>
        ) : url ? (
          <a href={`/api/download?url=${encodeURIComponent(url)}`} style={{ background: "linear-gradient(90deg,var(--accent),var(--accent-2))", color: "#fff", borderRadius: 8 }}>
            Download
          </a>
        ) : null}
      </div>
    </div>
  );
}

// Per-reel niche tagger — a combobox that only fires onTag when the value is
// committed (Enter / blur / picking a suggestion), never on each keystroke, so
// the expensive tag-and-download only runs when you finish typing.
function NicheTagger({
  value,
  niches,
  tagging,
  onTag,
}: {
  value: string;
  niches: string[];
  tagging: boolean;
  onTag: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="row" style={{ gap: 6, alignItems: "center", margin: "4px 0 2px" }}>
      <NicheCombo
        value={draft}
        onChange={setDraft}
        niches={niches}
        disabled={tagging}
        placeholder="— niche (type / pick) —"
        onCommit={(v) => { if (v !== value) onTag(v); }}
        style={{ fontSize: 12, padding: "3px 6px", borderColor: value ? "var(--accent)" : "var(--border)", maxWidth: 160 }}
      />
      {tagging ? <span className="spinner" /> : value ? <span style={{ fontSize: 11, color: "var(--accent)" }}>✓ tagged</span> : null}
    </div>
  );
}
