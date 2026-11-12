import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken } from "@/lib/crypto";
import { gitBlobSha } from "@/lib/gitsha";
import { diffAgainstTree, REPO_RE } from "@/lib/github";
import { buildFolders, largest, fmtSize } from "@/lib/structure";
import { safeNext } from "@/lib/types";
import { docTopic, presenceTopic, slugRoom } from "@/lib/utils";
import { statusOf } from "@/hooks/usePresence";

describe("token encryption (AES-256-GCM)", () => {
  beforeAll(() => {
    process.env.GITHUB_TOKEN_ENC_KEY = randomBytes(32).toString("base64");
  });
  it("round-trips and never stores plaintext", () => {
    const blob = encryptToken("gho_secret123");
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain("gho_secret123");
    expect(decryptToken(blob)).toBe("gho_secret123");
  });
  it("uses a fresh IV each time", () => {
    expect(encryptToken("x")).not.toBe(encryptToken("x"));
  });
  it("rejects tampered ciphertext", () => {
    const parts = encryptToken("abc").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptToken(parts.join("."))).toThrow();
  });
  it("rejects a wrong key", () => {
    const blob = encryptToken("abc");
    process.env.GITHUB_TOKEN_ENC_KEY = randomBytes(32).toString("base64");
    expect(() => decryptToken(blob)).toThrow();
  });
  it("refuses a key of the wrong length", () => {
    process.env.GITHUB_TOKEN_ENC_KEY = Buffer.from("short").toString("base64");
    expect(() => encryptToken("x")).toThrow(/32/);
  });
});

describe("git blob sha / repo diff", () => {
  it("matches git's own hash (echo 'hello' | git hash-object --stdin)", () => {
    expect(gitBlobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(gitBlobSha("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
  it("counts bytes, not characters (UTF-8)", () => {
    expect(gitBlobSha("é")).not.toBe(gitBlobSha("e"));
  });
  it("reports new and modified files only", () => {
    const entries = [
      { path: "a.txt", type: "blob" as const, sha: gitBlobSha("same") },
      { path: "b.txt", type: "blob" as const, sha: gitBlobSha("old") },
      { path: "dir", type: "tree" as const, sha: "x" },
    ];
    const out = diffAgainstTree(
      [
        { path: "a.txt", content: "same" },
        { path: "b.txt", content: "new" },
        { path: "c.txt", content: "brand new" },
      ],
      entries
    );
    expect(out).toEqual([
      { path: "b.txt", status: "modified" },
      { path: "c.txt", status: "new" },
    ]);
  });
  it("validates repo names", () => {
    expect(REPO_RE.test("acme/app")).toBe(true);
    expect(REPO_RE.test("acme/app/../x")).toBe(false);
    expect(REPO_RE.test("a b/c")).toBe(false);
  });
});

describe("project structure helpers", () => {
  const files = [
    { path: "src/a.ts", size: 100 },
    { path: "src/lib/b.ts", size: 2000 },
    { path: "README.md", size: 50 },
  ];
  it("aggregates size and count per folder", () => {
    const root = buildFolders(files);
    expect(root.size).toBe(2150);
    expect(root.files).toBe(3);
    const src = root.folders.find((f) => f.name === "src")!;
    expect(src.size).toBe(2100);
    expect(src.folders[0].path).toBe("src/lib");
    expect(root.leaves.map((l) => l.path)).toEqual(["README.md"]);
  });
  it("finds the largest files", () => {
    expect(largest(files, 2).map((f) => f.path)).toEqual(["src/lib/b.ts", "src/a.ts"]);
  });
  it("formats sizes", () => {
    expect(fmtSize(10)).toBe("10 B");
    expect(fmtSize(2048)).toBe("2.0 KB");
  });
});

describe("small helpers", () => {
  it("safeNext blocks open redirects", () => {
    expect(safeNext("/w/abc")).toBe("/w/abc");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
  it("realtime topics start with room:<id> (matches topic_room_id in SQL)", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(presenceTopic(id)).toBe(`room:${id}:presence`);
    expect(docTopic(id, "src/a b.ts")).toBe(`room:${id}:doc:src%2Fa%20b.ts`);
  });
  it("slugRoom normalises", () => {
    expect(slugRoom("  My Team!! ")).toBe("my-team");
  });
  it("status priority: meeting > voice > away > online", () => {
    expect(statusOf({ meeting: true, voice: "v", idle: true })).toBe("meeting");
    expect(statusOf({ meeting: false, voice: "v", idle: true })).toBe("voice");
    expect(statusOf({ meeting: false, voice: null, idle: true })).toBe("away");
    expect(statusOf({ meeting: false, voice: null, idle: false })).toBe("online");
  });
});
