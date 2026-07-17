"use client";
import { useEffect, useMemo, useState, useCallback } from "react";

type Concept = any;
type Brief = any;
type Assignment = any;
type Taxonomy = any;

const STATUS_COLORS: Record<string, string> = {
  draft: "var(--panel-2)",
  pushed: "#3b82f6",
  photos_ready: "#a78bfa",
  video_ready: "#f59e0b",
  assigned: "#06b6d4",
  posted: "#16a34a",
};

function statusBadge(status: string) {
  const bg = STATUS_COLORS[status] || "var(--panel-2)";
  const fg = status === "posted" ? "#fff" : "var(--text)";
  return <span className="badge" style={{ background: bg, color: fg, fontSize: 11 }}>{status}</span>;
}

export default function PipelinePage() {
  const [tab, setTab] = useState<"concepts" | "briefs" | "assign" | "va">("concepts");
  const [taxonomy, setTaxonomy] = useState<Taxonomy[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [niches, setNiches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  // Filters
  const [fType, setFType] = useState("");
  const [fSubniche, setFSubniche] = useState("");
  const [fNiche, setFNiche] = useState("");

  // Concept form
  const [showConceptForm, setShowConceptForm] = useState(false);
  const [editingConcept, setEditingConcept] = useState<Concept | null>(null);

  // Brief form
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [showBriefForm, setShowBriefForm] = useState(false);

  // Assign form
  const [assignAccount, setAssignAccount] = useState("");

  // VA view
  const [vaAccount, setVaAccount] = useState("");
  const [vaData, setVaData] = useState<any>(null);

  function loadTaxonomy() {
    fetch("/api/pipeline/taxonomy").then((r) => r.json()).then((j) => setTaxonomy(j.types || []));
  }
  function loadConcepts() {
    const params = new URLSearchParams();
    if (fType) params.set("content_type", fType);
    if (fSubniche) params.set("subniche", fSubniche);
    if (fNiche) params.set("niche", fNiche);
    fetch(`/api/pipeline/concepts?${params}`).then((r) => r.json()).then((j) => setConcepts(j.concepts || []));
  }
  function loadBriefs(conceptId?: string) {
    const params = new URLSearchParams();
    if (conceptId) params.set("concept_id", conceptId);
    fetch(`/api/pipeline/briefs?${params}`).then((r) => r.json()).then((j) => setBriefs(j.briefs || []));
  }
  function loadAccounts() {
    fetch("/api/accounts?type=our").then((r) => r.json()).then((j) => {
      const h = (j.records || []).map((a: any) => a.fields.Handle).filter(Boolean);
      setAccounts(h);
      if (h.length && !assignAccount) setAssignAccount(h[0]);
      if (h.length && !vaAccount) setVaAccount(h[0]);
    });
  }
  function loadNiches() {
    fetch("/api/niches").then((r) => r.json()).then((j) => setNiches((j.niches || []).map((n: any) => n.name)));
  }

  useEffect(() => {
    loadTaxonomy();
    loadConcepts();
    loadAccounts();
    loadNiches();
    setLoading(false);
  }, []);

  useEffect(() => { loadConcepts(); }, [fType, fSubniche, fNiche]);

  const subnichesForType = useMemo(() => {
    const t = taxonomy.find((t: any) => t.name === fType);
    return t?.subniches || [];
  }, [taxonomy, fType]);

  // ---- Concept CRUD ----
  async function saveConcept(c: Partial<Concept>) {
    if (editingConcept) {
      await fetch("/api/pipeline/concepts", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingConcept.id, ...c }),
      });
      setMsg("Concept updated ✓");
    } else {
      await fetch("/api/pipeline/concepts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      setMsg("Concept created ✓");
    }
    setEditingConcept(null);
    setShowConceptForm(false);
    loadConcepts();
  }

  async function retireConcept(id: string) {
    if (!confirm("Retire this concept? It won't show up for new assignments but existing ones stay.")) return;
    await fetch("/api/pipeline/concepts", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "retired" }),
    });
    loadConcepts();
  }

  // ---- Brief CRUD ----
  async function saveBrief(b: Partial<Brief>) {
    if (!selectedConcept) return;
    await fetch("/api/pipeline/briefs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concept_id: selectedConcept.id, ...b }),
    });
    setMsg("Brief created ✓");
    setShowBriefForm(false);
    loadBriefs(selectedConcept.id);
  }

  async function updateBriefStatus(id: string, status: string) {
    await fetch("/api/pipeline/briefs", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (selectedConcept) loadBriefs(selectedConcept.id);
  }

  async function pushToAirtable(briefId: string) {
    setMsg("Pushing to Airtable…");
    const res = await fetch("/api/pipeline/sync", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_id: briefId }),
    });
    const j = await res.json();
    if (j.error) {
      setMsg(`Error: ${j.error}`);
    } else {
      setMsg(`Pushed to Airtable ✓ (${j.action})`);
      if (selectedConcept) loadBriefs(selectedConcept.id);
    }
  }

  // ---- Assignment ----
  async function assignBrief(briefId: string, account: string) {
    const res = await fetch("/api/pipeline/assign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_id: briefId, account_handle: account }),
    });
    const j = await res.json();
    if (j.error) {
      setMsg(`⚠ ${j.error}`);
    } else {
      setMsg(`Assigned to @${account} ✓`);
      if (selectedConcept) loadBriefs(selectedConcept.id);
    }
  }

  // ---- VA view ----
  function loadVaData(account: string) {
    if (!account) return;
    fetch(`/api/pipeline/check?account_handle=${encodeURIComponent(account)}`).then((r) => r.json()).then(setVaData);
  }
  useEffect(() => { if (vaAccount) loadVaData(vaAccount); }, [vaAccount]);

  async function markPosted(assignmentId: string, reelUrl?: string) {
    const url = reelUrl || prompt("Paste the reel URL (or leave blank):");
    await fetch("/api/pipeline/assign", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assignmentId, status: "posted", reel_url: url }),
    });
    setMsg("Marked as posted ✓ (14-day cooldown activated)");
    loadVaData(vaAccount);
  }

  async function addSubniche() {
    const name = prompt("Subniche name (e.g. 'twerk', 'sensual'):");
    if (!name?.trim()) return;
    const ct = fType || "dance";
    await fetch("/api/pipeline/taxonomy", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), content_type: ct }),
    });
    loadTaxonomy();
    setMsg(`Subniche "${name}" added ✓`);
  }

  return (
    <div>
      <h1 className="h1">Content Pipeline</h1>
      <p className="sub">From inspiration → concept → brief → Airtable (photos) → video → assign → post. Videos can't repeat within 14 days. Same concept can't repeat on the same account.</p>
      {msg && <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>{msg}</p>}

      {/* Tabs */}
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        {([
          ["concepts", "🎯 Concepts"],
          ["briefs", "🎬 Briefs"],
          ["assign", "📋 Assign"],
          ["va", "📲 VA Posting"],
        ] as const).map(([k, label]) => (
          <button key={k} className={tab === k ? "" : "secondary"} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {/* ====== CONCEPTS TAB ====== */}
      {tab === "concepts" && (
        <>
          {/* Filters */}
          <div className="panel">
            <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Content type</div>
                <select value={fType} onChange={(e) => { setFType(e.target.value); setFSubniche(""); }} style={{ minWidth: 150 }}>
                  <option value="">All types</option>
                  {taxonomy.map((t: any) => <option key={t.id} value={t.name}>{t.label || t.name}</option>)}
                </select>
              </div>
              {fType && subnichesForType.length > 0 && (
                <div>
                  <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Subniche</div>
                  <select value={fSubniche} onChange={(e) => setFSubniche(e.target.value)} style={{ minWidth: 150 }}>
                    <option value="">All subniches</option>
                    {subnichesForType.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Niche</div>
                <select value={fNiche} onChange={(e) => setFNiche(e.target.value)} style={{ minWidth: 150 }}>
                  <option value="">All niches</option>
                  {niches.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button onClick={() => { setEditingConcept(null); setShowConceptForm(true); }}>+ New concept</button>
                {fType === "dance" && <button className="secondary" onClick={addSubniche}>+ Subniche</button>}
              </div>
            </div>
          </div>

          {/* Concept form */}
          {showConceptForm && (
            <ConceptForm
              concept={editingConcept}
              taxonomy={taxonomy}
              niches={niches}
              onSave={saveConcept}
              onCancel={() => { setShowConceptForm(false); setEditingConcept(null); }}
            />
          )}

          {/* Concept list */}
          {loading ? (
            <p className="muted"><span className="spinner" /> Loading…</p>
          ) : concepts.length === 0 ? (
            <p className="muted">No concepts yet. Create one from scratch or pull inspiration from the Inspiration Generator.</p>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              {concepts.map((c) => (
                <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", opacity: c.status === "retired" ? 0.5 : 1 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <b style={{ fontSize: 15 }}>{c.name}</b>
                        <span className="badge" style={{ background: "var(--accent)", color: "#fff", fontSize: 11 }}>{c.content_type}</span>
                        {c.subniche && <span className="badge" style={{ fontSize: 11 }}>{c.subniche}</span>}
                        {c.niche && <span className="badge" style={{ fontSize: 11, background: "var(--panel-2)" }}>{c.niche}</span>}
                        {c.brief_count > 0 && <span className="muted" style={{ fontSize: 12 }}>{c.brief_count} brief{c.brief_count !== 1 ? "s" : ""}</span>}
                      </div>
                      {c.description && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{c.description}</div>}
                      {c.visual_prompt && <div style={{ fontSize: 12, marginTop: 4, color: "var(--accent)" }}>✨ {c.visual_prompt}</div>}
                      {c.hook_text && <div style={{ fontSize: 12, marginTop: 2 }}>💬 {c.hook_text}</div>}
                      {c.inspiration_reel_url && (
                        <div className="row" style={{ gap: 8, marginTop: 6, fontSize: 12 }}>
                          <a href={c.inspiration_reel_url} target="_blank" rel="noreferrer" className="badge">↗ inspiration reel</a>
                          {c.inspiration_account && <span className="muted">@{c.inspiration_account}</span>}
                        </div>
                      )}
                    </div>
                    <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                      <button className="secondary" style={{ fontSize: 12 }} onClick={() => { setSelectedConcept(c); loadBriefs(c.id); setTab("briefs"); }}>View briefs →</button>
                      <button className="secondary" style={{ fontSize: 12 }} onClick={() => { setEditingConcept(c); setShowConceptForm(true); }}>Edit</button>
                      {c.status === "active" && <button className="secondary" style={{ fontSize: 12 }} onClick={() => retireConcept(c.id)}>Retire</button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ====== BRIEFS TAB ====== */}
      {tab === "briefs" && (
        <>
          <div className="panel">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                {selectedConcept ? (
                  <h2 style={{ margin: 0, fontSize: 18 }}>
                    Briefs for <b>{selectedConcept.name}</b>
                    <span className="badge" style={{ marginLeft: 8, background: "var(--accent)", color: "#fff", fontSize: 11 }}>{selectedConcept.content_type}</span>
                    {selectedConcept.subniche && <span className="badge" style={{ marginLeft: 4, fontSize: 11 }}>{selectedConcept.subniche}</span>}
                  </h2>
                ) : (
                  <h2 style={{ margin: 0, fontSize: 18 }}>All briefs</h2>
                )}
              </div>
              <div className="row" style={{ gap: 8 }}>
                {selectedConcept && <button onClick={() => setShowBriefForm(true)}>+ New brief</button>}
                <select onChange={(e) => { const c = concepts.find(x => x.id === e.target.value); setSelectedConcept(c || null); loadBriefs(e.target.value); }} value={selectedConcept?.id || ""} style={{ minWidth: 200 }}>
                  <option value="">All concepts</option>
                  {concepts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {showBriefForm && selectedConcept && (
            <BriefForm onSave={saveBrief} onCancel={() => setShowBriefForm(false)} />
          )}

          {briefs.length === 0 ? (
            <p className="muted" style={{ marginTop: 14 }}>No briefs yet. {selectedConcept ? "Create one for this concept." : "Select a concept or create a new one."}</p>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              {briefs.map((b) => (
                <div key={b.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <b>{b.title}</b>
                        {b.variant_label && <span className="badge" style={{ fontSize: 11 }}>{b.variant_label}</span>}
                        {statusBadge(b.status)}
                        {b.airtable_synced_at && <span className="muted" style={{ fontSize: 11 }}>↗ Airtable {new Date(b.airtable_synced_at).toLocaleDateString()}</span>}
                      </div>
                      {b.generation_prompt && <div style={{ fontSize: 13, marginTop: 4, maxHeight: 60, overflow: "auto" }}>{b.generation_prompt}</div>}
                      {b.reference_reel_url && <a href={b.reference_reel_url} target="_blank" rel="noreferrer" className="badge" style={{ marginTop: 4 }}>↗ reference</a>}
                      {b.notes && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{b.notes}</div>}
                    </div>
                    <div className="row" style={{ gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                      {(b.status === "draft" || b.status === "pushed") && (
                        <button style={{ fontSize: 12 }} onClick={() => pushToAirtable(b.id)}>
                          {b.airtable_record_id ? "↻ Re-sync" : "↗ Push to Airtable"}
                        </button>
                      )}
                      {b.status === "pushed" && <button className="secondary" style={{ fontSize: 12 }} onClick={() => updateBriefStatus(b.id, "photos_ready")}>📸 Photos ready</button>}
                      {b.status === "photos_ready" && <button className="secondary" style={{ fontSize: 12 }} onClick={() => updateBriefStatus(b.id, "video_ready")}>🎬 Video ready</button>}
                      {(b.status === "video_ready" || b.status === "photos_ready") && (
                        <select
                          defaultValue=""
                          onChange={(e) => { if (e.target.value) { assignBrief(b.id, e.target.value); e.target.value = ""; } }}
                          style={{ fontSize: 12 }}
                        >
                          <option value="">→ Assign to…</option>
                          {accounts.map((h) => <option key={h} value={h}>@{h}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ====== ASSIGN TAB ====== */}
      {tab === "assign" && (
        <div className="panel">
          <h2>Assign briefs to accounts</h2>
          <p className="muted" style={{ fontSize: 13 }}>Pick a concept → see its briefs → assign to an account. The system blocks same-concept repeats and 14-day video cooldowns automatically.</p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <select onChange={(e) => { const c = concepts.find(x => x.id === e.target.value); setSelectedConcept(c || null); loadBriefs(e.target.value); }} value={selectedConcept?.id || ""} style={{ minWidth: 250 }}>
              <option value="">Select a concept…</option>
              {concepts.filter(c => c.status === "active").map((c) => <option key={c.id} value={c.id}>{c.name} ({c.content_type}{c.subniche ? ` / ${c.subniche}` : ""})</option>)}
            </select>
          </div>
          {selectedConcept && (
            <>
              <p className="muted" style={{ fontSize: 12 }}>{briefs.length} brief{briefs.length !== 1 ? "s" : ""} for this concept</p>
              <div style={{ display: "grid", gap: 8 }}>
                {briefs.map((b) => (
                  <div key={b.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <b style={{ fontSize: 14 }}>{b.title}</b>
                        {b.variant_label && <span className="badge" style={{ marginLeft: 8, fontSize: 11 }}>{b.variant_label}</span>}
                        {statusBadge(b.status)}
                      </div>
                      {assignAccount && (
                        <button
                          style={{ fontSize: 12 }}
                          onClick={() => assignBrief(b.id, assignAccount)}
                          disabled={b.status === "draft" || b.status === "pushed"}
                        >
                          → Assign to @{assignAccount}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {briefs.length === 0 && <p className="muted">No briefs — create some in the Briefs tab first.</p>}
              </div>
            </>
          )}
        </div>
      )}

      {/* ====== VA POSTING TAB ====== */}
      {tab === "va" && (
        <div className="panel">
          <h2>📱 VA posting view</h2>
          <p className="muted" style={{ fontSize: 13 }}>Pick an account → see what's assigned and ready to post. When you post, the 14-day cooldown activates automatically.</p>
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <select value={vaAccount} onChange={(e) => setVaAccount(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">Select account…</option>
              {accounts.map((h) => <option key={h} value={h}>@{h}</option>)}
            </select>
          </div>

          {vaData && (
            <>
              {/* Stats */}
              <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                <span className="badge" style={{ background: "#06b6d4", color: "#fff" }}>{vaData.stats?.total_assigned || 0} assigned</span>
                <span className="badge" style={{ background: "#16a34a", color: "#fff" }}>{vaData.stats?.total_posted || 0} posted</span>
                <span className="badge" style={{ background: "#f59e0b", color: "#fff" }}>{vaData.stats?.on_cooldown_count || 0} on cooldown</span>
                <span className="badge">{vaData.stats?.posted_concepts_count || 0} concepts used</span>
              </div>

              {/* Available to post */}
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>✅ Ready to post ({vaData.available?.length || 0})</h3>
              {vaData.available?.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>Nothing assigned yet. Go to the Assign tab to assign briefs to this account.</p>
              ) : (
                <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
                  {vaData.available.map((a: any) => (
                    <div key={a.assignment_id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                        <div>
                          <b>{a.brief?.title || "Untitled"}</b>
                          {a.brief?.variant_label && <span className="badge" style={{ marginLeft: 8, fontSize: 11 }}>{a.brief.variant_label}</span>}
                          {a.brief?.reference_thumbnail && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.brief.reference_thumbnail} alt="ref" style={{ width: 60, height: 60, borderRadius: 6, objectFit: "cover", marginLeft: 8, verticalAlign: "middle" }} loading="lazy" decoding="async" />
                          )}
                          {a.brief?.generation_prompt && <div style={{ fontSize: 12, marginTop: 4, maxHeight: 40, overflow: "auto" }}>{a.brief.generation_prompt}</div>}
                          {a.brief?.reference_reel_url && <a href={a.brief.reference_reel_url} target="_blank" rel="noreferrer" className="badge" style={{ marginTop: 4 }}>↗ reference reel</a>}
                        </div>
                        <button style={{ fontSize: 12 }} onClick={() => markPosted(a.assignment_id)}>✓ Mark posted</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* On cooldown */}
              {vaData.on_cooldown?.length > 0 && (
                <>
                  <h3 style={{ fontSize: 15, marginBottom: 8 }}>⏳ On cooldown ({vaData.on_cooldown.length})</h3>
                  <div style={{ display: "grid", gap: 6, marginBottom: 20 }}>
                    {vaData.on_cooldown.map((c: any) => (
                      <div key={c.brief_id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span className="muted">Brief {c.brief_id.slice(0, 8)}…</span>
                        <span className="muted">{c.days_left} day{c.days_left !== 1 ? "s" : ""} left (until {new Date(c.cooldown_expires).toLocaleDateString()})</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Recently posted */}
              {vaData.recently_posted?.length > 0 && (
                <>
                  <h3 style={{ fontSize: 15, marginBottom: 8 }}>📊 Recently posted</h3>
                  <table>
                    <thead><tr><th>Brief</th><th>Posted</th><th>Cooldown</th><th>Reel</th></tr></thead>
                    <tbody>
                      {vaData.recently_posted.slice(0, 15).map((a: any) => (
                        <tr key={a.assignment_id}>
                          <td>{a.brief?.title || "—"}</td>
                          <td className="muted" style={{ whiteSpace: "nowrap" }}>{new Date(a.posted_at).toLocaleDateString()}</td>
                          <td>{a.on_cooldown ? <span style={{ color: "#f59e0b" }}>⏳ {new Date(a.cooldown_expires).toLocaleDateString()}</span> : <span style={{ color: "#16a34a" }}>✓ expired</span>}</td>
                          <td>{a.reel_url ? <a href={a.reel_url} target="_blank" rel="noreferrer" className="badge">open</a> : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Concept form component ----
function ConceptForm({ concept, taxonomy, niches, onSave, onCancel }: {
  concept: Concept | null;
  taxonomy: Taxonomy[];
  niches: string[];
  onSave: (c: Partial<Concept>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(concept?.name || "");
  const [contentType, setContentType] = useState(concept?.content_type || "dance");
  const [subniche, setSubniche] = useState(concept?.subniche || "");
  const [niche, setNiche] = useState(concept?.niche || "");
  const [description, setDescription] = useState(concept?.description || "");
  const [visualPrompt, setVisualPrompt] = useState(concept?.visual_prompt || "");
  const [hookText, setHookText] = useState(concept?.hook_text || "");
  const [inspirationReelUrl, setInspirationReelUrl] = useState(concept?.inspiration_reel_url || "");
  const [inspirationThumbnail, setInspirationThumbnail] = useState(concept?.inspiration_thumbnail || "");
  const [inspirationAccount, setInspirationAccount] = useState(concept?.inspiration_account || "");

  const subnichesForType = taxonomy.find((t: any) => t.name === contentType)?.subniches || [];

  return (
    <div className="panel">
      <h2>{concept ? "Edit concept" : "New concept"}</h2>
      <div style={{ display: "grid", gap: 10, maxWidth: 600 }}>
        <div>
          <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Concept name *</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. shower dance, gaze reaction" style={{ width: "100%" }} autoFocus />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Content type</div>
            <select value={contentType} onChange={(e) => { setContentType(e.target.value); setSubniche(""); }} style={{ width: "100%" }}>
              {taxonomy.map((t: any) => <option key={t.id} value={t.name}>{t.label || t.name}</option>)}
            </select>
          </div>
          {subnichesForType.length > 0 && (
            <div style={{ flex: 1 }}>
              <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Subniche</div>
              <select value={subniche} onChange={(e) => setSubniche(e.target.value)} style={{ width: "100%" }}>
                <option value="">— none —</option>
                {subnichesForType.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Niche</div>
            <select value={niche} onChange={(e) => setNiche(e.target.value)} style={{ width: "100%" }}>
              <option value="">— none —</option>
              {niches.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Description</div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ width: "100%", resize: "vertical" }} placeholder="What is this concept about?" />
        </div>
        <div>
          <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Visual prompt (for photo generation)</div>
          <textarea value={visualPrompt} onChange={(e) => setVisualPrompt(e.target.value)} rows={2} style={{ width: "100%", resize: "vertical" }} placeholder="e.g. girl in shower, steam, backlit, sensual pose" />
        </div>
        <div>
          <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Hook text (on-screen text / caption idea)</div>
          <input value={hookText} onChange={(e) => setHookText(e.target.value)} placeholder="e.g. POV: she caught you staring" style={{ width: "100%" }} />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Inspiration reel URL</div>
            <input value={inspirationReelUrl} onChange={(e) => setInspirationReelUrl(e.target.value)} placeholder="https://instagram.com/reel/…" style={{ width: "100%" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Inspiration account</div>
            <input value={inspirationAccount} onChange={(e) => setInspirationAccount(e.target.value)} placeholder="handle (no @)" style={{ width: "100%" }} />
          </div>
        </div>
        <div>
          <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Inspiration thumbnail URL (optional)</div>
          <input value={inspirationThumbnail} onChange={(e) => setInspirationThumbnail(e.target.value)} placeholder="https://…" style={{ width: "100%" }} />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button onClick={() => onSave({ name, content_type: contentType, subniche: subniche || undefined, niche: niche || undefined, description, visual_prompt: visualPrompt, hook_text: hookText, inspiration_reel_url: inspirationReelUrl, inspiration_thumbnail: inspirationThumbnail, inspiration_account: inspirationAccount })} disabled={!name.trim()}>
            {concept ? "Update concept" : "Create concept"}
          </button>
          <button className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---- Brief form component ----
function BriefForm({ onSave, onCancel }: {
  onSave: (b: Partial<Brief>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [variantLabel, setVariantLabel] = useState("");
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [referenceReelUrl, setReferenceReelUrl] = useState("");
  const [referenceThumbnail, setReferenceThumbnail] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <div className="panel">
      <h2>New brief</h2>
      <div style={{ display: "grid", gap: 10, maxWidth: 600 }}>
        <div>
          <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Title *</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Shower dance — red bikini" style={{ width: "100%" }} autoFocus />
        </div>
        <div>
          <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Variant label (e.g. "Outfit 1 — red dress")</div>
          <input value={variantLabel} onChange={(e) => setVariantLabel(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div>
          <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Generation prompt (for AI photo/video generation)</div>
          <textarea value={generationPrompt} onChange={(e) => setGenerationPrompt(e.target.value)} rows={3} style={{ width: "100%", resize: "vertical" }} placeholder="Full prompt for the AI image generator…" />
        </div>
        <div>
          <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Reference reel URL (override concept's inspiration)</div>
          <input value={referenceReelUrl} onChange={(e) => setReferenceReelUrl(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div>
          <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Notes</div>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button onClick={() => onSave({ title, variant_label: variantLabel, generation_prompt: generationPrompt, reference_reel_url: referenceReelUrl, reference_thumbnail: referenceThumbnail, notes })} disabled={!title.trim()}>
            Create brief
          </button>
          <button className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
