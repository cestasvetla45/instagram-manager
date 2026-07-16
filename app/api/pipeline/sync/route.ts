import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pushBriefToAirtable, findByBriefId, updateAirtableRecord, pipelineConfigured } from "@/lib/airtable-pipeline";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST { brief_id } — push a brief to Airtable "Ai Reels Workflow Setup" base
export async function POST(req: NextRequest) {
  try {
    if (!pipelineConfigured()) {
      return NextResponse.json({
        error: "Airtable pipeline not configured. Set AIRTABLE_PIPELINE_TOKEN (personal access token) and AIRTABLE_PIPELINE_BASE_ID (appczNKnrkmGGSWWZ) in Railway variables.",
      }, { status: 400 });
    }

    const b = await req.json();
    const briefId = String(b.brief_id || "").trim();
    if (!briefId) return NextResponse.json({ error: "brief_id required" }, { status: 400 });

    // Fetch the brief + its concept
    const { data: brief, error: bErr } = await db()
      .from("content_briefs")
      .select("*")
      .eq("id", briefId)
      .limit(1);
    if (bErr) throw bErr;
    if (!brief?.length) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

    const { data: concept } = await db()
      .from("content_concepts")
      .select("*")
      .eq("id", brief[0].concept_id)
      .limit(1);

    const c = concept?.[0] || {};
    const br = brief[0];

    // Check if already pushed (by airtable_record_id or by Brief ID in Airtable)
    let existingRecordId = br.airtable_record_id;
    if (!existingRecordId) {
      existingRecordId = await findByBriefId(br.id);
    }

    const airtableBrief = {
      title: br.title,
      concept_name: c.name,
      content_type: c.content_type,
      subniche: c.subniche,
      niche: c.niche,
      variant_label: br.variant_label,
      generation_prompt: br.generation_prompt,
      visual_prompt: c.visual_prompt,
      hook_text: c.hook_text,
      reference_reel_url: br.reference_reel_url || c.inspiration_reel_url,
      reference_thumbnail: br.reference_thumbnail || c.inspiration_thumbnail,
      inspiration_account: c.inspiration_account,
      status: "To Generate",
      source_brief_id: br.id,
    };

    if (existingRecordId) {
      // Update existing record
      const fields: Record<string, any> = {
        "Title": airtableBrief.title,
        "Concept": airtableBrief.concept_name || "",
        "Content Type": airtableBrief.content_type || "",
        "Subniche": airtableBrief.subniche || "",
        "Niche": airtableBrief.niche || "",
        "Variant": airtableBrief.variant_label || "",
        "Generation Prompt": airtableBrief.generation_prompt || "",
        "Visual Prompt": airtableBrief.visual_prompt || "",
        "Hook Text": airtableBrief.hook_text || "",
        "Status": "To Generate",
      };
      await updateAirtableRecord(existingRecordId, fields);
      await db().from("content_briefs").update({
        airtable_record_id: existingRecordId,
        airtable_synced_at: new Date().toISOString(),
        status: "pushed",
        updated_at: new Date().toISOString(),
      }).eq("id", br.id);

      return NextResponse.json({ ok: true, record_id: existingRecordId, action: "updated" });
    }

    // Push new record
    const { recordId } = await pushBriefToAirtable(airtableBrief);

    await db().from("content_briefs").update({
      airtable_record_id: recordId,
      airtable_synced_at: new Date().toISOString(),
      status: "pushed",
      updated_at: new Date().toISOString(),
    }).eq("id", br.id);

    return NextResponse.json({ ok: true, record_id: recordId, action: "created" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// GET — check if pipeline is configured
export async function GET() {
  return NextResponse.json({
    configured: pipelineConfigured(),
    base_id: process.env.AIRTABLE_PIPELINE_BASE_ID || "appczNKnrkmGGSWWZ",
  });
}
