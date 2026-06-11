import { NextResponse } from "next/server";
import { airtableConfigured } from "@/lib/airtable";
import { rockSolidConfigured } from "@/lib/rocksolid";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    airtable: airtableConfigured(),
    rocksolid: rockSolidConfigured(),
  });
}
