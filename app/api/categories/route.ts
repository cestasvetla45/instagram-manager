import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aggregateCategories, listNiches, slugify } from "@/lib/categories";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/categories — hub grid: every niche + aggregated profile/reel stats.
export async function GET() {
  try {
    const niches = await listNiches();
    const categories = await aggregateCategories(niches);
    // No Cache-Control here: this list mutates constantly (create/rename/delete/
    // assign profile), and a cached response would show stale counts right
    // after the very action that changed them.
    return NextResponse.json({ categories });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), categories: [] }, { status: 500 });
  }
}

// POST /api/categories  { name } — create a new category (niche).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const slug = slugify(name);
    const { data: existing } = await db().from("niches").select("id,name,slug").ilike("name", name).limit(1);
    if (existing && existing[0]) {
      return NextResponse.json({ ok: true, created: false, category: existing[0] });
    }
    const { data, error } = await db().from("niches").insert({ name, slug }).select("id,name,slug").limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, created: true, category: data?.[0] || { name, slug } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
