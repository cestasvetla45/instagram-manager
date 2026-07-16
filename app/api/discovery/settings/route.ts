import { NextRequest, NextResponse } from "next/server";
import { getDiscoverySettings, saveDiscoverySettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ settings: await getDiscoverySettings() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const settings = await saveDiscoverySettings(body);
    return NextResponse.json({ ok: true, settings });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
