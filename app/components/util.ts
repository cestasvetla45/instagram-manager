export function fmt(n: number | undefined | null): string {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1) + "K";
  return String(v);
}

export function pct(frac: number | undefined | null): string {
  return ((Number(frac || 0)) * 100).toFixed(1) + "%";
}

export function attachUrl(att: any): string | null {
  if (Array.isArray(att) && att[0]) return att[0].thumbnails?.large?.url || att[0].url || null;
  return null;
}
