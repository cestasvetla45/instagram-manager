// One-off data hygiene: stamp niche onto reels whose author's account HAS a
// niche but the reel's own niche column is still null/blank. Paginates past
// PostgREST's 1000-row cap on both the read and the ID-chunked write.
import { sb } from './dbq';

const norm = (h: string) => String(h || '').replace(/^@/, '').trim().toLowerCase();

async function fetchAllPaged<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows: T[] = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function main() {
  console.log('Loading accounts with a niche set…');
  const accounts = await fetchAllPaged<{ handle: string; niche: string | null }>((from, to) =>
    sb.from('inspiration_accounts').select('handle, niche').range(from, to)
  );
  const handleToNiche = new Map<string, string>();
  for (const a of accounts) {
    if (a.niche && String(a.niche).trim()) handleToNiche.set(norm(a.handle), String(a.niche).trim());
  }
  console.log(`  ${handleToNiche.size} accounts have a niche set (of ${accounts.length} total).`);
  if (!handleToNiche.size) {
    console.log('Nothing to do.');
    return;
  }

  console.log('Loading reels missing a niche…');
  const reels = await fetchAllPaged<{ id: string; author_handle: string; niche: string | null }>((from, to) =>
    sb.from('inspiration_reels').select('id, author_handle, niche').range(from, to)
  );
  console.log(`  ${reels.length} reels total.`);

  // Group ids by target niche so we can batch-update per niche value.
  const idsByNiche = new Map<string, string[]>();
  let alreadyOk = 0;
  let noAccountMatch = 0;
  for (const r of reels) {
    const hasNiche = r.niche != null && String(r.niche).trim() !== '';
    if (hasNiche) { alreadyOk++; continue; }
    const targetNiche = handleToNiche.get(norm(r.author_handle));
    if (!targetNiche) { noAccountMatch++; continue; }
    const list = idsByNiche.get(targetNiche) || [];
    list.push(r.id);
    idsByNiche.set(targetNiche, list);
  }

  let updated = 0;
  const CHUNK = 200;
  for (const [niche, ids] of idsByNiche) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { data, error } = await sb.from('inspiration_reels').update({ niche }).in('id', chunk).select('id');
      if (error) { console.error(`  ERROR updating niche="${niche}" chunk:`, error.message); continue; }
      updated += data?.length || 0;
    }
    console.log(`  stamped niche="${niche}" -> ${ids.length} reel(s)`);
  }

  console.log('---');
  console.log(`Reels already had a niche:        ${alreadyOk}`);
  console.log(`Reels with no matching account:   ${noAccountMatch} (author not in an account with a niche)`);
  console.log(`Reels updated:                    ${updated}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
