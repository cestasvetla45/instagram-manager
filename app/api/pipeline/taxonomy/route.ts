import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
// Taxonomy changes rarely — cache 5 minutes
export const revalidate = 300;

// GET — list all content types + subniches
export async function GET() {
  try {
    const { data: types, error: tErr } = await db().from("content_types").select("*").order("sort_order");
    if (tErr) throw tErr;

    const { data: subniches, error: sErr } = await db().from("subniches").select("*").order("name");
    if (sErr) throw sErr;

    // Group subniches by content_type
    const subByType: Record<string, any[]> = {};
    for (const s of subniches || []) {
      const t = s.content_type || "dance";
      if (!subByType[t]) subByType[t] = [];
      subByType[t].push(s);
    }

    return NextResponse.json({
      types: (types || []).map((t: any) => ({
        ...t,
        subniches: subByType[t.name] || [],
      })),
    }, { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), types: [] }, { status: 500 });
  }
}

// POST — add a subniche { name, content_type }
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
    const row = {
      name: String(b.name).trim(),
      content_type: String(b.content_type || "dance").trim(),
    };
    const { data, error } = await db().from("subniches").insert(row).select().single();
    if (error) {
      // unique violation — already exists
      if (String(error.code || "") === "23505") {
        return NextResponse.json({ error: "Subniche already exists" }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ subniche: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await db().from("subniches").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
