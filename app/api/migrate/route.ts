import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST { sql, secret?, database_url? }
//   Runs raw SQL against the Supabase Postgres database.
//   Preferred path: a Postgres connection string (DATABASE_URL /
//   SUPABASE_DB_URL env, or `database_url` in the body). DDL over the
//   REST API isn't possible, so a direct connection is required.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const secret = body.secret || "";
    const expectedSecret = process.env.MIGRATION_SECRET || "run-pipeline-migration-now";
    if (secret !== expectedSecret) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 403 });
    }

    const sql = body.sql;
    if (!sql) {
      return NextResponse.json({ error: "sql required" }, { status: 400 });
    }

    const connStr = body.database_url || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "";
    if (!connStr) {
      return NextResponse.json(
        {
          error: "No Postgres connection string available",
          hint: "Set DATABASE_URL (or SUPABASE_DB_URL) to the Supabase pooler connection string, or pass database_url in the body. Alternatively run the SQL manually in Supabase Dashboard → SQL Editor.",
        },
        { status: 500 }
      );
    }

    const pool = new Pool({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
    try {
      const result: any = await pool.query(sql);
      const rows = Array.isArray(result) ? result.flatMap((r: any) => r?.rows || []) : result?.rows || [];
      return NextResponse.json({ ok: true, rows, method: "pg" });
    } finally {
      await pool.end();
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
