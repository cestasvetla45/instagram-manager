// Shared logic for saving/refreshing reels into Airtable.
import {
  TABLES,
  createRecords,
  updateRecord,
  findByUrl,
  AirtableRecord,
} from "./airtable";
import { scrapeReel, NormalizedReel } from "./rocksolid";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function engagementRate(r: NormalizedReel): number {
  if (!r.views) return 0;
  const eng = r.likes + r.comments + r.shares + r.saves;
  return Math.min(eng / r.views, 9.9999); // stored as fraction (0.05 = 5%)
}

function reelFields(r: NormalizedReel, isOur: boolean) {
  const fields: Record<string, any> = {
    "Reel URL": r.url,
    Shortcode: r.shortcode,
    [isOur ? "Account Handle" : "Author Handle"]: r.authorHandle,
    Caption: r.caption,
    Views: r.views,
    Likes: r.likes,
    Comments: r.comments,
    Shares: r.shares,
    Saves: r.saves,
    "Engagement Rate": engagementRate(r),
    "Duration (s)": r.durationSec,
    "Date Scraped": today(),
  };
  if (r.postedDate) fields["Posted Date"] = r.postedDate;
  if (r.thumbnailUrl) fields["Thumbnail"] = [{ url: r.thumbnailUrl }];
  if (r.videoUrl) fields["Video"] = [{ url: r.videoUrl }];
  return fields;
}

function snapshotFields(r: NormalizedReel, source: "Inspiration" | "Our") {
  return {
    "Snapshot ID": `${r.shortcode || r.url}-${Date.now()}`,
    "Reel URL": r.url,
    Source: source,
    Views: r.views,
    Likes: r.likes,
    Comments: r.comments,
    Shares: r.shares,
    Saves: r.saves,
    "Snapshot Date": today(),
  };
}

export async function saveReel(
  url: string,
  target: "inspiration" | "our",
  opts: { attachVideo?: boolean } = {}
): Promise<{ reel: NormalizedReel; record: AirtableRecord; created: boolean }> {
  const isOur = target === "our";
  const table = isOur ? TABLES.ourReels : TABLES.inspirationReels;
  const r = await scrapeReel(url);

  const fields = reelFields(r, isOur);
  if (opts.attachVideo === false) delete fields["Video"];

  const existing = await findByUrl(table, "Reel URL", url);
  let record: AirtableRecord;
  let created = false;
  if (existing) {
    const updated = await updateRecord(table, existing.id, fields);
    record = { id: existing.id, fields: updated.fields };
  } else {
    if (!isOur) fields["Status"] = "To Review";
    const recs = await createRecords(table, [{ fields }]);
    record = recs[0];
    created = true;
  }

  // Always log a time-series snapshot.
  await createRecords(TABLES.snapshots, [
    { fields: snapshotFields(r, isOur ? "Our" : "Inspiration") },
  ]);

  return { reel: r, record, created };
}
