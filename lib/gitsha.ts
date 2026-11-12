import { createHash } from "node:crypto";

/** The SHA-1 git assigns to a blob: sha1("blob <bytes>\0" + content). Lets us diff without downloading files. */
export function gitBlobSha(content: string): string {
  const body = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}
