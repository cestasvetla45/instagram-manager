import { NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";

export const runtime = "nodejs";

function etTodayStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function etDayOf(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// GET → comprehensive dashboard: VAs, per-account posting status, gaps.
export async function GET() {
  try {
    const today = etTodayStr();

    const [{ data: accts }, { data: vas }, { data: assigns }, { data: posts }, { data: slots }] =
      await Promise.all([
        db().from(TABLES.ourAccounts).select("handle, active").order("handle"),
        db().from("va_profiles").select("*").eq("is_active", true).order("name"),
        db().from("account_assignments").select("account_handle, va_name, notes").eq("is_active", true),
        db()
          .from("va_posts")
          .select("account_handle, va_name, post_type, posted_at, logged_at")
          .eq("post_type", "reel")
          .order("logged_at", { ascending: false })
          .limit(3000),
        db().from("posting_schedule").select("*").eq("is_active", true),
      ]);

    const accounts = (accts || []).filter((a: any) => a.handle);

    // handle → assigned VA (active assignment wins; first seen).
    const vaByAcct: Record<string, string> = {};
    for (const a of assigns || []) {
      const h = (a as any).account_handle;
      if (h && !vaByAcct[h]) vaByAcct[h] = (a as any).va_name;
    }

    // Reels posted today per account.
    const postedTodayByAcct: Record<string, number> = {};
    const lastPostVaByAcct: Record<string, string> = {};
    for (const p of posts || []) {
      const h = (p as any).account_handle;
      if (!h) continue;
      if (!lastPostVaByAcct[h] && (p as any).va_name) lastPostVaByAcct[h] = (p as any).va_name;
      if (etDayOf((p as any).posted_at || (p as any).logged_at) !== today) continue;
      postedTodayByAcct[h] = (postedTodayByAcct[h] || 0) + 1;
    }

    // Schedule slots grouped by account.
    const slotsByAcct: Record<string, any[]> = {};
    for (const s of slots || []) {
      const h = (s as any).account_handle;
      if (!h) continue;
      (slotsByAcct[h] = slotsByAcct[h] || []).push(s);
    }

    // Per-account status table.
    const accountStatus = accounts.map((a: any) => {
      const h = a.handle;
      const posted = postedTodayByAcct[h] || 0;
      const acctSlots = (slotsByAcct[h] || []).sort((x, y) => (x.post_time > y.post_time ? 1 : -1));
      return {
        handle: h,
        active: a.active !== false,
        va_name: vaByAcct[h] || null,
        posted_today: posted,
        posted: posted > 0,
        scheduled_times: acctSlots.map((s) => s.post_time),
        slot_count: acctSlots.length,
      };
    });

    // VAs with their assigned accounts + today's counts.
    const acctsByVa: Record<string, string[]> = {};
    for (const a of assigns || []) {
      const va = (a as any).va_name;
      const h = (a as any).account_handle;
      if (!va || !h) continue;
      (acctsByVa[va] = acctsByVa[va] || []).push(h);
    }
    const vaSummary = (vas || []).map((v: any) => {
      const handles = acctsByVa[v.name] || [];
      const postedCount = handles.filter((h) => (postedTodayByAcct[h] || 0) > 0).length;
      return {
        ...v,
        accounts: handles,
        account_count: handles.length,
        posted_today: postedCount,
        not_posted_today: Math.max(0, handles.length - postedCount),
      };
    });

    // Gaps / alerts.
    const unassignedAccounts = accountStatus.filter((a) => a.active && !a.va_name).map((a) => a.handle);
    const notPostedToday = accountStatus.filter((a) => a.active && !a.posted).map((a) => a.handle);
    const noSchedule = accountStatus.filter((a) => a.active && a.slot_count === 0).map((a) => a.handle);

    // Today's posting schedule (flattened, sorted by time).
    const todaySchedule = (slots || [])
      .map((s: any) => ({
        account_handle: s.account_handle,
        va_name: vaByAcct[s.account_handle] || null,
        slot_name: s.slot_name,
        post_time: s.post_time,
        post_type: s.post_type,
        posted: (postedTodayByAcct[s.account_handle] || 0) > 0,
      }))
      .sort((a: any, b: any) => (a.post_time > b.post_time ? 1 : -1));

    return NextResponse.json({
      today,
      totals: {
        accounts: accounts.length,
        active_accounts: accountStatus.filter((a) => a.active).length,
        vas: vaSummary.length,
        posted_today: accountStatus.filter((a) => a.active && a.posted).length,
      },
      vas: vaSummary,
      accountStatus,
      unassignedAccounts,
      notPostedToday,
      noSchedule,
      todaySchedule,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
