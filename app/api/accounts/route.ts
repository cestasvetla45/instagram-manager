import { NextRequest, NextResponse } from "next/server";
import { db, TABLES, accountToFields } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/accounts?type=inspiration|our
export async function GET(req: NextRequest) {
  try {
    const isOur = req.nextUrl.searchParams.get("type") === "our";
    const table = isOur ? TABLES.ourAccounts : TABLES.inspirationAccounts;
    const { data, error } = await db()
      .from(table)
      .select("*")
      .order("followers", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return NextResponse.json({ records: (data || []).map(accountToFields) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), records: [] }, { status: 500 });
  }
}
