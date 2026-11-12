const PALETTE = [
  "#ff7a3d", "#ffb347", "#3ddc84", "#4cc9f0", "#b794f6",
  "#ff6b9d", "#f6e05e", "#63b3ed", "#68d391", "#fc8181",
];

export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function slugRoom(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function randomRoom(): string {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export function langFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", html: "html", py: "python",
    sql: "sql", yml: "yaml", yaml: "yaml", sh: "shell", go: "go", rs: "rust",
    java: "java", php: "php", c: "c", cpp: "cpp", cs: "csharp", dart: "dart",
  };
  return map[ext] ?? "plaintext";
}

export type TreeNode = {
  name: string;
  path: string;
  isFile: boolean;
  children: Map<string, TreeNode>;
};

export function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", isFile: false, children: new Map() };
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    let cur = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const full = parts.slice(0, i + 1).join("/");
      let next = cur.children.get(part);
      if (!next) {
        next = { name: part, path: full, isFile, children: new Map() };
        cur.children.set(part, next);
      }
      cur = next;
    });
  }
  return root;
}

export function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) =>
    a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1
  );
}

/** Private realtime topics MUST start with "room:<uuid>" (see realtime.messages policies). */
export const presenceTopic = (roomId: string) => `room:${roomId}:presence`;
export const docTopic = (roomId: string, path: string) =>
  `room:${roomId}:doc:${encodeURIComponent(path)}`;
