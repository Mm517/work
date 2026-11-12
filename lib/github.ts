import { gitBlobSha } from "@/lib/gitsha";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kitchenly-work",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { message?: string }).message ?? msg;
    } catch {}
    throw new GitHubError(res.status, msg);
  }
  return (await res.json()) as T;
}

export type Repo = { full_name: string; default_branch: string; private: boolean };

export const listRepos = (token: string) =>
  gh<Repo[]>(token, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");

export const getRepo = (token: string, repo: string) => gh<Repo>(token, `/repos/${repo}`);

export type TreeEntry = { path: string; type: "blob" | "tree" | "commit"; sha: string; size?: number };

export async function getTree(token: string, repo: string, branch: string) {
  const r = await gh<{ sha: string; tree: TreeEntry[]; truncated: boolean }>(
    token,
    `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );
  return { entries: r.tree, truncated: r.truncated };
}

export async function lastCommit(token: string, repo: string, branch: string, path: string) {
  const r = await gh<
    { commit: { author: { name: string; date: string } | null }; author: { login: string } | null }[]
  >(token, `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&per_page=1`);
  const c = r[0];
  if (!c) return null;
  return { author: c.author?.login ?? c.commit.author?.name ?? "?", date: c.commit.author?.date ?? null };
}

export type Change = { path: string; status: "new" | "modified" };

/** Which workspace files differ from the repo's tree at that branch (adds + edits only; never deletes). */
export function diffAgainstTree(files: { path: string; content: string }[], entries: TreeEntry[]): Change[] {
  const sha = new Map(entries.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  const out: Change[] = [];
  for (const f of files) {
    const cur = sha.get(f.path);
    if (cur === undefined) out.push({ path: f.path, status: "new" });
    else if (cur !== gitBlobSha(f.content)) out.push({ path: f.path, status: "modified" });
  }
  return out;
}

export async function pushChanges(opts: {
  token: string;
  repo: string;
  baseBranch: string;
  newBranch: string;
  message: string;
  files: { path: string; content: string }[];
  openPr: boolean;
  prTitle: string;
  prBody: string;
}) {
  const { token, repo, baseBranch, newBranch } = opts;
  const ref = await gh<{ object: { sha: string } }>(token, `/repos/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  const baseCommit = ref.object.sha;
  const commit = await gh<{ tree: { sha: string } }>(token, `/repos/${repo}/git/commits/${baseCommit}`);

  const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
  for (const f of opts.files) {
    const blob = await gh<{ sha: string }>(token, `/repos/${repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: f.content, encoding: "utf-8" }),
    });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await gh<{ sha: string }>(token, `/repos/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: commit.tree.sha, tree }),
  });
  const newCommit = await gh<{ sha: string; html_url: string }>(token, `/repos/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: opts.message, tree: newTree.sha, parents: [baseCommit] }),
  });
  await gh(token, `/repos/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: newCommit.sha }),
  });

  let prUrl: string | null = null;
  if (opts.openPr) {
    const pr = await gh<{ html_url: string }>(token, `/repos/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: opts.prTitle, head: newBranch, base: baseBranch, body: opts.prBody }),
    });
    prUrl = pr.html_url;
  }
  return { commitUrl: newCommit.html_url, prUrl };
}
