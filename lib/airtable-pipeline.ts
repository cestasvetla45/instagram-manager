// ─────────────────────────────────────────────────────────────
//  Airtable sync — pushes content briefs to the
//  "Ai Reels Workflow Setup" base for the photo generation pipeline.
//
//  The content generation guy works in Airtable. This sync layer
//  pushes briefs FROM Reel Lab → Airtable so he can pick them up
//  in the workflow he already knows.
// ─────────────────────────────────────────────────────────────

const TOKEN = process.env.AIRTABLE_PIPELINE_TOKEN || process.env.AIRTABLE_TOKEN || "";
// The "Ai Reels Workflow Setup" base (different from the legacy base)
const BASE_ID = process.env.AIRTABLE_PIPELINE_BASE_ID || "appczNKnrkmGGSWWZ";
const TABLE_NAME = process.env.AIRTABLE_PIPELINE_TABLE || "Reels to Generate";
const API = "https://api.airtable.com/v0";

export function pipelineConfigured(): boolean {
  return Boolean(TOKEN && BASE_ID && TOKEN.startsWith("pat"));
}

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

function tablePath() {
  return `${API}/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
}

export type AirtableBrief = {
  title: string;
  concept_name?: string;
  content_type?: string;
  subniche?: string;
  niche?: string;
  variant_label?: string;
  generation_prompt?: string;
  visual_prompt?: string;
  hook_text?: string;
  reference_reel_url?: string;
  reference_thumbnail?: string;
  inspiration_account?: string;
  status?: string;
  source_brief_id?: string;
};

// Push a brief to Airtable. Returns the Airtable record ID.
export async function pushBriefToAirtable(brief: AirtableBrief): Promise<{ recordId: string; raw: any }> {
  if (!pipelineConfigured()) {
    throw new Error("Airtable pipeline not configured. Set AIRTABLE_PIPELINE_TOKEN and AIRTABLE_PIPELINE_BASE_ID.");
  }

  // Map to Airtable fields. Field names match the "Ai Reels Workflow Setup" base.
  // We use typecast:true so Airtable coerces types.
  const fields: Record<string, any> = {
    "Title": brief.title,
    "Concept": brief.concept_name || "",
    "Content Type": brief.content_type || "",
    "Subniche": brief.subniche || "",
    "Niche": brief.niche || "",
    "Variant": brief.variant_label || "",
    "Generation Prompt": brief.generation_prompt || "",
    "Visual Prompt": brief.visual_prompt || "",
    "Hook Text": brief.hook_text || "",
    "Reference Reel URL": brief.reference_reel_url || "",
    "Inspiration Account": brief.inspiration_account || "",
    "Status": brief.status || "To Generate",
    "Source": "Reel Lab",
    "Brief ID": brief.source_brief_id || "",
  };

  // Thumbnail as attachment
  if (brief.reference_thumbnail) {
    fields["Reference Thumbnail"] = [{ url: brief.reference_thumbnail }];
  }

  const res = await fetch(tablePath(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Airtable push failed (${res.status}): ${txt}`);
  }

  const json = await res.json();
  const record = json.records?.[0];
  if (!record?.id) throw new Error("Airtable did not return a record ID");

  return { recordId: record.id, raw: record };
}

// Update an existing Airtable record (e.g. when brief status changes)
export async function updateAirtableRecord(recordId: string, fields: Record<string, any>): Promise<void> {
  if (!pipelineConfigured()) return;
  const res = await fetch(`${tablePath()}/${recordId}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) {
    console.error("Airtable update failed:", await res.text());
  }
}

// Find a record by Brief ID (to avoid duplicates)
export async function findByBriefId(briefId: string): Promise<string | null> {
  if (!pipelineConfigured()) return null;
  try {
    const url = `${tablePath()}?filterByFormula={Brief ID}="${briefId}"&maxRecords=1`;
    const res = await fetch(url, { headers: headers(), cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.records?.[0]?.id || null;
  } catch {
    return null;
  }
}
