// Password hashing with Node's built-in scrypt (no external deps).
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(pw, salt, 32);
  return `${salt.toString("hex")}:${dk.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const dk = scryptSync(pw, Buffer.from(saltHex, "hex"), 32);
    const a = Buffer.from(hashHex, "hex");
    return a.length === dk.length && timingSafeEqual(a, dk);
  } catch {
    return false;
  }
}
