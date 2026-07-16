import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { rockSolidConfigured } from "@/lib/rocksolid";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    // keep the "airtable" key so the existing ConfigBanner keeps working
    airtable: dbConfigured(),
    rocksolid: rockSolidConfigured(),
  });
}
