import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET → list niches
export async function GET() {
  try {
    const { data, error } = await db()
      .from("niches")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    return NextResponse.json(
      { niches: data || [] },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=150" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), niches: [] }, { status: 500 });
  }
}

// POST { name } → create a niche
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
    const { error } = await db()
      .from("niches")
      .upsert({ name, slug }, { onConflict: "name" });
    if (error) throw error;
    return NextResponse.json({ ok: true, name });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
