"use client";
import { useEffect, useState } from "react";

const KINDS = [
  { v: "story", label: "Stories" },
  { v: "carousel", label: "Carousels" },
  { v: "reel", label: "Reels" },
  { v: "post", label: "Posts" },
];

export default function VaultPage() {
  const [assets, setAssets] = useState<any[]>([]);
  const [niches, setNiches] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState("all");
  const [usedFilter, setUsedFilter] = useState("false");
  const [nicheFilter, setNicheFilter] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  // upload form
  const [upKind, setUpKind] = useState("carousel");
  const [upNiche, setUpNiche] = useState("");
  const [caption, setCaption] = useState("");
  const [setName, setSetName] = useState("");

  // AI caption generation
  const [example, setExample] = useState("");
  const [capBusy, setCapBusy] = useState<Record<string, boolean>>({});

  async function genCaption(a: any) {
    if (!example.trim()) { setMsg("Paste an example caption / format first (in the AI caption box)."); return; }
    setCapBusy((b) => ({ ...b, [a.id]: true }));
    try {
      const res = await fetch("/api/vault/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, example }),
      });
      const j = await res.json();
      setMsg(j.error ? `AI error: ${j.error}` : "Caption generated ✓");
      load();
    } catch (e: any) {
      setMsg(`AI request ended: ${e.message}`);
    }
    setCapBusy((b) => ({ ...b, [a.id]: false }));
  }

  function load() {
    fetch(`/api/vault?kind=${kindFilter}&used=${usedFilter}&niche=${encodeURIComponent(nicheFilter)}`).then((r) => r.json()).then((j) => { setAssets(j.assets || []); setLoading(false); });
  }
  useEffect(load, [kindFilter, usedFilter, nicheFilter]);
  useEffect(() => {
    fetch("/api/niches").then((r) => r.json()).then((j) => setNiches((j.niches || []).map((n: any) => n.name)));
  }, []);

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    setMsg(`Uploading ${files.length} file(s) as ${upKind}…`);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("file", f));
    fd.append("kind", upKind);
    if (upNiche) fd.append("niche", upNiche);
    if (caption) fd.append("caption", caption);
    if (setName) fd.append("set_name", setName);
    const res = await fetch("/api/vault", { method: "POST", body: fd });
    const j = await res.json();
    setMsg(j.error ? `Error: ${j.error}` : `Added ${j.added} to the vault.`);
    setUploading(false);
    setCaption(""); setSetName("");
    load();
  }

  async function toggleUsed(a: any) {
    await fetch("/api/vault", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, used: !a.used }),
    });
    load();
  }
  async function remove(a: any) {
    if (!confirm("Delete this asset?")) return;
    await fetch(`/api/vault?id=${a.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <h1 className="h1">Content Vault</h1>
      <p className="sub">Prepare and stage content — stories, carousels, reels, posts. Tag items used so nothing gets reposted.</p>
      {msg && <p className="muted" style={{ marginBottom: 12 }}>{msg}</p>}

      {/* Upload */}
      <div className="panel">
        <h2>Add to vault</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={upKind} onChange={(e) => setUpKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
          </select>
          <select value={upNiche} onChange={(e) => setUpNiche(e.target.value)} title="Which niche / account this content is for">
            <option value="">— niche —</option>
            {niches.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {upKind === "carousel" && (
            <input placeholder="Carousel set name (groups the images)" value={setName} onChange={(e) => setSetName(e.target.value)} style={{ minWidth: 200 }} />
          )}
          <input placeholder="Caption / notes (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <label style={{ cursor: "pointer", display: "inline-block", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 12px", fontSize: 14 }}>
            {uploading ? <><span className="spinner" /> Uploading…</> : "⤓ Upload files"}
            <input type="file" accept="image/*,video/*" multiple style={{ display: "none" }} onChange={(e) => upload(e.target.files)} />
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Images for stories/carousels/posts; video files for reels. For a carousel, give it a set name and upload its images together.</p>
      </div>

      {/* AI caption format */}
      <div className="panel">
        <h2>AI caption style</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>Paste an example caption (or a few) to set the format. Then hit <b>✨ Caption</b> on any reel video and Gemini watches it and writes one in this style.</p>
        <textarea
          placeholder={"e.g.\nwould you date a tall girl like me?? 😛 #tallgirl #shortking #heightdifference\nI get stopped on the street A LOT 😭 #fyp"}
          value={example}
          onChange={(e) => setExample(e.target.value)}
          rows={3}
          style={{ width: "100%", resize: "vertical" }}
        />
      </div>

      {/* Filters */}
      <div className="row" style={{ marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
          <option value="all">All types</option>
          {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
        </select>
        <select value={nicheFilter} onChange={(e) => setNicheFilter(e.target.value)}>
          <option value="all">All niches</option>
          {niches.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={usedFilter} onChange={(e) => setUsedFilter(e.target.value)}>
          <option value="false">Unused</option>
          <option value="true">Used</option>
          <option value="all">All</option>
        </select>
      </div>

      {loading ? (
        <p className="muted"><span className="spinner" /> Loading…</p>
      ) : assets.length === 0 ? (
        <p className="muted">Nothing here yet. Upload content above to start staging.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
          {assets.map((a) => (
            <div key={a.id} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", opacity: a.used ? 0.55 : 1 }}>
              {a.media_type === "video" ? (
                <video src={a.image_url} controls preload="metadata" style={{ width: "100%", height: 220, objectFit: "cover", display: "block", background: "#000" }} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.image_url} alt={a.caption || a.kind} style={{ width: "100%", height: 220, objectFit: "cover", display: "block" }} loading="lazy" />
              )}
              <div style={{ padding: "7px 9px" }}>
                <div className="row" style={{ gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                  <span className="badge">{a.kind}</span>
                  {a.niche ? <span className="badge" style={{ background: "var(--accent)", color: "#fff" }}>{a.niche}</span> : null}
                  {a.set_name ? <span className="badge" style={{ background: "var(--panel-2)" }}>{a.set_name}</span> : null}
                </div>
                {a.caption && <div style={{ fontSize: 12, marginBottom: 6, maxHeight: 60, overflow: "auto", whiteSpace: "pre-wrap" }}>{a.caption}</div>}
                {a.media_type === "video" && (
                  <button className="secondary" onClick={() => genCaption(a)} disabled={capBusy[a.id]} style={{ width: "100%", fontSize: 12, padding: "4px 0", marginBottom: 6 }}>
                    {capBusy[a.id] ? <><span className="spinner" /> Watching…</> : (a.caption ? "✨ Regenerate caption" : "✨ Caption")}
                  </button>
                )}
                {a.used && <div className="muted" style={{ fontSize: 11, marginBottom: 5 }}>used{a.used_at ? ` · ${new Date(a.used_at).toLocaleDateString()}` : ""}</div>}
                <div className="row" style={{ gap: 6 }}>
                  <button className={a.used ? "secondary" : ""} onClick={() => toggleUsed(a)} style={{ flex: 1, fontSize: 12, padding: "4px 0" }}>
                    {a.used ? "↺ Unused" : "✓ Used"}
                  </button>
                  <button className="secondary" onClick={() => remove(a)} style={{ fontSize: 12, padding: "4px 8px" }}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
