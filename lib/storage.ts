// Download a reel MP4 from Instagram's CDN and store it in Supabase Storage,
// so the file survives after Instagram deletes the original.
import { db, REELS_BUCKET } from "./db";

const SCREENSHOTS_BUCKET = "reel-screenshots";

// Store a reel-analytics screenshot (uploaded by a VA via Telegram) in the
// public "reel-screenshots" bucket and return its public URL.
export async function storeScreenshot(
  buf: Buffer,
  contentType = "image/png"
): Promise<string | null> {
  try {
    const ext = (contentType.split("/")[1] || "png").replace(/[^\w]/g, "") || "png";
    const path = `tg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await db()
      .storage.from(SCREENSHOTS_BUCKET)
      .upload(path, buf, { contentType, upsert: true });
    if (error) {
      console.error("storeScreenshot upload error:", error.message);
      return null;
    }
    const { data } = db().storage.from(SCREENSHOTS_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (e: any) {
    console.error("storeScreenshot error:", e?.message || e);
    return null;
  }
}

// Instagram thumbnail URLs (scontent.cdninstagram.com) carry a short-lived
// `oe` expiry signature — they 403 after a few days, leaving reels blank.
// Download the JPG once and re-host it in our public "reels" bucket so the
// thumbnail is permanent. Returns the durable public URL (or null on failure).
export async function storeThumbnail(
  shortcode: string,
  thumbnailUrl: string
): Promise<string | null> {
  try {
    const res = await fetch(thumbnailUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/jpeg,image/*,*/*",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return null; // guard against error placeholders
    const ext = (ct.split("/")[1] || "jpg").replace(/[^\w]/g, "") || "jpg";
    const path = `thumbs/${(shortcode || "reel").replace(/[^\w-]/g, "_")}.${ext}`;
    const { error } = await db()
      .storage.from(REELS_BUCKET)
      .upload(path, buf, { contentType: ct, upsert: true });
    if (error) {
      console.error("storeThumbnail upload error:", error.message);
      return null;
    }
    const { data } = db().storage.from(REELS_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (e: any) {
    console.error("storeThumbnail error:", e?.message || e);
    return null;
  }
}

export async function storeVideo(
  shortcode: string,
  videoUrl: string
): Promise<{ publicUrl: string; path: string } | null> {
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const path = `${(shortcode || "reel").replace(/[^\w-]/g, "_")}.mp4`;

    const { error } = await db()
      .storage.from(REELS_BUCKET)
      .upload(path, buf, { contentType: "video/mp4", upsert: true });
    if (error) {
      console.error("storeVideo upload error:", error.message);
      return null;
    }
    const { data } = db().storage.from(REELS_BUCKET).getPublicUrl(path);
    return { publicUrl: data.publicUrl, path };
  } catch (e: any) {
    console.error("storeVideo error:", e?.message || e);
    return null;
  }
}
