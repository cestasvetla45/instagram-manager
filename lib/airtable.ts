// ─────────────────────────────────────────────────────────────
//  Minimal Airtable REST client (no SDK dependency).
// ─────────────────────────────────────────────────────────────

const TOKEN = process.env.AIRTABLE_TOKEN || "";
// Default to the base created for this project; override via env if you fork it.
const BASE_ID = process.env.AIRTABLE_BASE_ID || "appS9dwcribegqibV";
const API = "https://api.airtable.com/v0";

export const TABLES = {
  inspirationReels: process.env.AIRTABLE_INSPIRATION_REELS || "Inspiration Reels",
  inspirationAccounts:
    process.env.AIRTABLE_INSPIRATION_ACCOUNTS || "Inspiration Accounts",
  ourAccounts: process.env.AIRTABLE_OUR_ACCOUNTS || "Our Accounts",
  ourReels: process.env.AIRTABLE_OUR_REELS || "Our Reels",
  snapshots: process.env.AIRTABLE_SNAPSHOTS || "Metric Snapshots",
  accountSnapshots: process.env.AIRTABLE_ACCOUNT_SNAPSHOTS || "Account Snapshots",
};

export function airtableConfigured(): boolean {
  return Boolean(TOKEN && BASE_ID);
}

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

function tablePath(table: string) {
  return `${API}/${BASE_ID}/${encodeURIComponent(table)}`;
}

export type AirtableRecord = { id: string; fields: Record<string, any>; createdTime?: string };

export async function listRecords(
  table: string,
  opts: { filterByFormula?: string; sort?: { field: string; direction?: "asc" | "desc" }[]; maxRecords?: number; pageSize?: number } = {}
): Promise<AirtableRecord[]> {
  if (!airtableConfigured()) throw new Error("Airtable not configured.");
  const out: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams();
    if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
    if (opts.maxRecords) params.set("maxRecords", String(opts.maxRecords));
    params.set("pageSize", String(opts.pageSize || 100));
    (opts.sort || []).forEach((s, i) => {
      params.set(`sort[${i}][field]`, s.field);
      params.set(`sort[${i}][direction]`, s.direction || "asc");
    });
    if (offset) params.set("offset", offset);
    const res = await fetch(`${tablePath(table)}?${params.toString()}`, {
      headers: headers(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Airtable list ${res.status}: ${await res.text()}`);
    const json = await res.json();
    out.push(...json.records);
    offset = json.offset;
    if (opts.maxRecords && out.length >= opts.maxRecords) break;
  } while (offset);
  return out;
}

export async function createRecords(table: string, records: { fields: Record<string, any> }[]) {
  const results: AirtableRecord[] = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const res = await fetch(tablePath(table), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ records: batch, typecast: true }),
    });
    if (!res.ok) throw new Error(`Airtable create ${res.status}: ${await res.text()}`);
    const json = await res.json();
    results.push(...json.records);
  }
  return results;
}

export async function updateRecord(table: string, id: string, fields: Record<string, any>) {
  const res = await fetch(`${tablePath(table)}/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) throw new Error(`Airtable update ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function findByUrl(table: string, urlField: string, url: string) {
  const safe = url.replace(/"/g, '\\"');
  const recs = await listRecords(table, {
    filterByFormula: `{${urlField}} = "${safe}"`,
    maxRecords: 1,
  });
  return recs[0] || null;
}

export async function findByHandle(table: string, handleField: string, handle: string) {
  const safe = handle.replace(/^@/, "").replace(/"/g, '\\"');
  const recs = await listRecords(table, {
    filterByFormula: `LOWER({${handleField}}) = "${safe.toLowerCase()}"`,
    maxRecords: 1,
  });
  return recs[0] || null;
}
