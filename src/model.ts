import type { InlineCommentNode, InlineThread, ReviewComment } from "./types.js";

function compareByCreatedAtDesc(a: ReviewComment, b: ReviewComment): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

function latestTimestamp(node: InlineCommentNode): number {
  let latest = new Date(node.comment.created_at).getTime();
  for (const child of node.children) {
    latest = Math.max(latest, latestTimestamp(child));
  }
  return latest;
}

function sortTree(nodes: InlineCommentNode[]): void {
  nodes.sort((a, b) => compareByCreatedAtDesc(a.comment, b.comment));
  for (const node of nodes) {
    sortTree(node.children);
  }
}

export function buildInlineThreads(comments: ReviewComment[]): InlineThread[] {
  if (comments.length === 0) {
    return [];
  }

  const ordered = [...comments].sort(compareByCreatedAtDesc);
  const nodes = new Map<number, InlineCommentNode>();
  const roots: InlineCommentNode[] = [];

  for (const comment of ordered) {
    nodes.set(comment.id, { comment, children: [] });
  }

  for (const comment of ordered) {
    const node = nodes.get(comment.id);
    if (!node) {
      continue;
    }

    const parentId = comment.in_reply_to_id ?? null;
    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId)?.children.push(node);
      continue;
    }

    roots.push(node);
  }

  sortTree(roots);
  roots.sort((a, b) => latestTimestamp(b) - latestTimestamp(a));
  return roots.map((root) => ({ root }));
}

export function countThreadReplies(root: InlineCommentNode): number {
  let count = 0;
  const queue: InlineCommentNode[] = [...root.children];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    count += 1;
    queue.push(...current.children);
  }

  return count;
}
