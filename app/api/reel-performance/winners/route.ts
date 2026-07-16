import { NextRequest, NextResponse } from "next/server";
import { getWinnerTemplates, generateInspirationFromWinners } from "@/lib/reel-performance";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET — all winner templates, each with its instance reels.
export async function GET() {
  try {
    const templates = await getWinnerTemplates();
    return NextResponse.json({ winner_templates: templates });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// POST { template_id } — fresh inspiration suggestions matching a template.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const templateId = b.template_id || b.templateId;
    if (!templateId) {
      return NextResponse.json({ error: "template_id required" }, { status: 400 });
    }
    const result = await generateInspirationFromWinners(templateId);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
