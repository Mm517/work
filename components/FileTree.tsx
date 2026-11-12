"use client";

import { buildTree, sortedChildren, type TreeNode } from "@/lib/utils";

type Viewer = { id: string; name: string; color: string; file: string | null };

type Props = {
  paths: string[];
  active: string | null;
  members: Viewer[];
  meId: string;
  onOpen: (path: string) => void;
  onDelete: (path: string) => void;
};

function Node({
  node,
  active,
  members,
  meId,
  onOpen,
  onDelete,
}: { node: TreeNode } & Omit<Props, "paths">) {
  if (!node.isFile) {
    return (
      <details open>
        <summary>{node.name}</summary>
        <div className="children">
          {sortedChildren(node).map((c) => (
            <Node
              key={c.path}
              node={c}
              active={active}
              members={members}
              meId={meId}
              onOpen={onOpen}
              onDelete={onDelete}
            />
          ))}
        </div>
      </details>
    );
  }

  const here = members.filter((m) => m.file === node.path && m.id !== meId);
  return (
    <div
      className={`file-row ${active === node.path ? "active" : ""}`}
      onClick={() => onOpen(node.path)}
      title={node.path}
    >
      <span className="name">{node.name}</span>
      <span className="dots">
        {here.map((m) => (
          <span key={m.id} className="dot" style={{ background: m.color }} title={m.name} />
        ))}
      </span>
      <button
        className="x"
        title="حذف"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(node.path);
        }}
      >
        ✕
      </button>
    </div>
  );
}

export default function FileTree({ paths, ...rest }: Props) {
  const root = buildTree(paths);
  return (
    <div className="tree">
      {sortedChildren(root).map((c) => (
        <Node key={c.path} node={c} {...rest} />
      ))}
    </div>
  );
}
