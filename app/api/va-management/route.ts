import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// Today's date in ET (YYYY-MM-DD) — matches the "today" the rest of the app uses.
function etTodayStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function etDayOf(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// GET → all VAs with their account counts + today's posting stats.
export async function GET() {
  try {
    const [{ data: vas }, { data: assigns }, { data: posts }] = await Promise.all([
      db().from("va_profiles").select("*").order("created_at", { ascending: true }),
      db().from("account_assignments").select("account_handle, va_name").eq("is_active", true),
      db()
        .from("va_posts")
        .select("va_name, account_handle, post_type, posted_at, logged_at")
        .eq("post_type", "reel")
        .order("logged_at", { ascending: false })
        .limit(2000),
    ]);

    const today = etTodayStr();

    // account_handle set per VA (active assignments).
    const acctsByVa: Record<string, Set<string>> = {};
    for (const a of assigns || []) {
      const va = (a as any).va_name;
      if (!va) continue;
      (acctsByVa[va] = acctsByVa[va] || new Set()).add((a as any).account_handle);
    }

    // Accounts each VA posted for today (dedup by handle).
    const postedByVa: Record<string, Set<string>> = {};
    for (const p of posts || []) {
      if (etDayOf((p as any).posted_at || (p as any).logged_at) !== today) continue;
      const va = (p as any).va_name;
      const h = (p as any).account_handle;
      if (!va || !h) continue;
      (postedByVa[va] = postedByVa[va] || new Set()).add(h);
    }

    const rows = (vas || []).map((v: any) => {
      const assigned = acctsByVa[v.name] || new Set();
      const posted = postedByVa[v.name] || new Set();
      const postedAssigned = [...assigned].filter((h) => posted.has(h));
      return {
        ...v,
        account_count: assigned.size,
        posted_today: postedAssigned.length,
        not_posted_today: Math.max(0, assigned.size - postedAssigned.length),
      };
    });

    // TeamFlow members (tf_members, same shared Supabase) also count as VAs —
    // merge any not already in va_profiles so the page and the assign dropdown
    // show them. Run /syncmembers (bot) to materialize them into va_profiles.
    try {
      const { data: tfMembers } = await db()
        .from("tf_members")
        .select("id, name, telegram_id, status")
        .eq("status", "active");
      const existingNames = new Set(rows.map((v: any) => String(v.name || "").toLowerCase()));
      for (const m of tfMembers || []) {
        const name = String((m as any).name || "").trim();
        if (!name || existingNames.has(name.toLowerCase())) continue;
        existingNames.add(name.toLowerCase());
        const assigned = acctsByVa[name] || new Set();
        const posted = postedByVa[name] || new Set();
        const postedAssigned = [...assigned].filter((h) => posted.has(h));
        rows.push({
          id: `tf-${(m as any).id}`,
          name,
          telegram_id: (m as any).telegram_id,
          role: "va",
          max_accounts: 15,
          is_active: true,
          source: "teamflow",
          account_count: assigned.size,
          posted_today: postedAssigned.length,
          not_posted_today: Math.max(0, assigned.size - postedAssigned.length),
        });
      }
    } catch {
      // tf_members unavailable — show va_profiles only.
    }

    return NextResponse.json({ vas: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), vas: [] }, { status: 500 });
  }
}

// POST { name, telegram_id?, role?, max_accounts? } → create a VA.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const name = (b.name || "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const row: any = {
      name,
      telegram_id: b.telegram_id ? Number(b.telegram_id) : null,
      role: (b.role || "va").trim(),
      max_accounts: b.max_accounts != null ? Number(b.max_accounts) : 15,
      is_active: true,
    };
    const { data, error } = await db().from("va_profiles").insert(row).select("*").limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, va: data?.[0] || null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// PATCH { id, ...fields } → update a VA profile.
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    const id = b.id;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const patch: any = { updated_at: new Date().toISOString() };
    if (b.name != null) patch.name = String(b.name).trim();
    if (b.telegram_id !== undefined) patch.telegram_id = b.telegram_id ? Number(b.telegram_id) : null;
    if (b.role != null) patch.role = String(b.role).trim();
    if (b.max_accounts != null) patch.max_accounts = Number(b.max_accounts);
    if (b.is_active != null) patch.is_active = Boolean(b.is_active);
    const { error } = await db().from("va_profiles").update(patch).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// DELETE ?id= → deactivate a VA (soft).
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { error } = await db()
      .from("va_profiles")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
