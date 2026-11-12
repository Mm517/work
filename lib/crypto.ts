import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM for GitHub tokens at rest. Key: GITHUB_TOKEN_ENC_KEY = 32 random bytes, base64. */
function key(): Buffer {
  const raw = process.env.GITHUB_TOKEN_ENC_KEY;
  if (!raw) throw new Error("GITHUB_TOKEN_ENC_KEY غير مضبوط");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("GITHUB_TOKEN_ENC_KEY لازم يكون 32 byte بصيغة base64");
  return k;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptToken(blob: string): string {
  const [v, iv, tag, enc] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("bad token blob");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}
