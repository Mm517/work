export type FileStat = { path: string; size: number };
export type Folder = {
  name: string;
  path: string;
  size: number;
  files: number;
  folders: Folder[];
  leaves: FileStat[];
};

/** Folder tree with aggregated size + file count. */
export function buildFolders(files: FileStat[]): Folder {
  const root: Folder = { name: "", path: "", size: 0, files: 0, folders: [], leaves: [] };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let cur = root;
    cur.size += f.size;
    cur.files += 1;
    parts.slice(0, -1).forEach((part, i) => {
      let next = cur.folders.find((x) => x.name === part);
      if (!next) {
        next = { name: part, path: parts.slice(0, i + 1).join("/"), size: 0, files: 0, folders: [], leaves: [] };
        cur.folders.push(next);
      }
      next.size += f.size;
      next.files += 1;
      cur = next;
    });
    cur.leaves.push(f);
  }
  const sort = (n: Folder) => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.leaves.sort((a, b) => a.path.localeCompare(b.path));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}

export function largest(files: FileStat[], n: number): FileStat[] {
  return [...files].sort((a, b) => b.size - a.size).slice(0, n);
}

export function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
