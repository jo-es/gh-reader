import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, useStdin, useStdout } from "ink";
import { countThreadReplies } from "./model.js";
import type {
  InlineCommentNode,
  InlineThread,
  IssueComment,
  LoadedPrComments,
  PullRequestReview
} from "./types.js";

type TabKey = "discussion" | "threads" | "reviews";
type PanelFocus = "list" | "detail";

interface SummaryRow {
  key: string;
  headline: string;
  subline: string;
}

interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  color?: "blue" | "yellow" | "cyan" | "gray" | "white";
}

interface MarkdownLine {
  prefix: string;
  spans: InlineSpan[];
  color?: "yellow" | "cyan" | "gray";
  dim?: boolean;
}

interface WrappedBodyLine {
  spans: InlineSpan[];
  color?: "yellow" | "cyan" | "gray";
  dim?: boolean;
}

interface MouseSequence {
  code: number;
  x: number;
  y: number;
  kind: "M" | "m";
}

const TAB_ORDER: TabKey[] = ["discussion", "threads", "reviews"];
const TAB_LABEL: Record<TabKey, string> = {
  discussion: "Discussion",
  threads: "Inline Threads",
  reviews: "Reviews"
};

function pickDefaultTab(data: LoadedPrComments): TabKey {
  if (data.issueComments.length > 0) {
    return "discussion";
  }
  if (data.inlineThreads.length > 0) {
    return "threads";
  }
  if (data.reviews.length > 0) {
    return "reviews";
  }
  return "discussion";
}

function shortBody(body: string, max = 90): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(no body)";
  }
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function author(login?: string | null): string {
  return login || "ghost";
}

function fmtDate(iso?: string | null): string {
  if (!iso) {
    return "unknown time";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function fmtRelativeOrAbsolute(iso?: string | null): string {
  if (!iso) {
    return "unknown time";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const deltaMs = Date.now() - date.getTime();
  if (deltaMs >= 0 && deltaMs < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.floor(deltaMs / 60000));
    return `${minutes}min ago`;
  }

  return fmtDate(iso);
}

function parseInlineSpans(input: string): InlineSpan[] {
  const token = /(\[[^\]]+\]\(([^)]+)\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  const spans: InlineSpan[] = [];
  let lastIndex = 0;
  let match = token.exec(input);

  while (match) {
    if (match.index > lastIndex) {
      spans.push({ text: input.slice(lastIndex, match.index) });
    }

    const value = match[0];
    if (value.startsWith("[") && value.endsWith(")")) {
      const linkMatch = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        spans.push({ text: linkMatch[1], color: "blue", underline: true });
        spans.push({ text: ` (${linkMatch[2]})`, dim: true });
      } else {
        spans.push({ text: value });
      }
    } else if (value.startsWith("**") && value.endsWith("**")) {
      spans.push({ text: value.slice(2, -2), bold: true });
    } else if (value.startsWith("`") && value.endsWith("`")) {
      spans.push({ text: value.slice(1, -1), color: "yellow" });
    } else if (
      (value.startsWith("*") && value.endsWith("*")) ||
      (value.startsWith("_") && value.endsWith("_"))
    ) {
      spans.push({ text: value.slice(1, -1), italic: true });
    } else {
      spans.push({ text: value });
    }

    lastIndex = match.index + value.length;
    match = token.exec(input);
  }

  if (lastIndex < input.length) {
    spans.push({ text: input.slice(lastIndex) });
  }

  return spans;
}

function markdownToLines(text: string): MarkdownLine[] {
  const sourceLines = (text || "(no body)").split(/\r?\n/);
  const output: MarkdownLine[] = [];
  let inFence = false;

  for (const sourceLine of sourceLines) {
    const trimmed = sourceLine.trim();

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      output.push({
        prefix: "",
        spans: [{ text: sourceLine }],
        color: "yellow"
      });
      continue;
    }

    if (trimmed.length === 0) {
      output.push({ prefix: "", spans: [{ text: "" }] });
      continue;
    }

    const heading = sourceLine.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      output.push({
        prefix: "",
        spans: parseInlineSpans(heading[2]),
        color: "cyan"
      });
      continue;
    }

    const quote = sourceLine.match(/^\s*>\s?(.*)$/);
    if (quote) {
      output.push({
        prefix: "> ",
        spans: parseInlineSpans(quote[1]),
        dim: true
      });
      continue;
    }

    const bullet = sourceLine.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      output.push({
        prefix: "• ",
        spans: parseInlineSpans(bullet[1])
      });
      continue;
    }

    const numbered = sourceLine.match(/^\s*(\d+)\.\s+(.*)$/);
    if (numbered) {
      output.push({
        prefix: `${numbered[1]}. `,
        spans: parseInlineSpans(numbered[2])
      });
      continue;
    }

    output.push({
      prefix: "",
      spans: parseInlineSpans(sourceLine)
    });
  }

  return output;
}

function InlineText({ spans }: { spans: InlineSpan[] }): JSX.Element {
  return (
    <>
      {spans.map((span, idx) => (
        <Text
          key={`span-${idx}`}
          bold={Boolean(span.bold)}
          italic={Boolean(span.italic)}
          underline={Boolean(span.underline)}
          dimColor={Boolean(span.dim)}
          color={span.color}
        >
          {span.text}
        </Text>
      ))}
    </>
  );
}

function lineRef(path: string | null, line: number | null, original: number | null): string {
  if (!path) {
    return "general";
  }

  const resolved = line ?? original;
  if (!resolved) {
    return path;
  }

  return `${path}:${resolved}`;
}

function countLeadingSpaces(text: string): number {
  let count = 0;
  while (count < text.length && text[count] === " ") {
    count += 1;
  }
  return count;
}

function sameInlineStyle(a: InlineSpan, b: InlineSpan): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.dim) === Boolean(b.dim) &&
    a.color === b.color
  );
}

function pushWrappedSpan(target: InlineSpan[], next: InlineSpan): void {
  if (!next.text) {
    return;
  }

  const last = target[target.length - 1];
  if (last && sameInlineStyle(last, next)) {
    last.text += next.text;
    return;
  }

  target.push({ ...next });
}

function wrapMarkdownLine(line: MarkdownLine, baseIndent: number, wrapWidth: number): WrappedBodyLine[] {
  const plainText = line.spans.map((span) => span.text).join("");
  const firstPrefix = `${" ".repeat(baseIndent)}${line.prefix}`;
  const sourceSpans: InlineSpan[] = [{ text: firstPrefix }, ...line.spans];
  const lineLeading = countLeadingSpaces(`${line.prefix}${plainText}`);
  const continuationBase = lineLeading > 0 ? lineLeading : line.prefix.length;
  const continuationIndent = " ".repeat(Math.max(0, baseIndent + continuationBase));
  const safeWidth = Math.max(24, wrapWidth);
  const continuationPrefix = continuationIndent.slice(0, Math.max(0, safeWidth - 1));
  const output: WrappedBodyLine[] = [];
  let current: WrappedBodyLine = { spans: [], color: line.color, dim: line.dim };
  let currentWidth = 0;

  const startNewLine = (): void => {
    output.push(current);
    current = { spans: [], color: line.color, dim: line.dim };
    currentWidth = 0;
    if (continuationPrefix) {
      pushWrappedSpan(current.spans, { text: continuationPrefix });
      currentWidth += continuationPrefix.length;
    }
  };

  for (const span of sourceSpans) {
    let remaining = span.text;
    const style: InlineSpan = {
      text: "",
      bold: span.bold,
      italic: span.italic,
      underline: span.underline,
      dim: span.dim,
      color: span.color
    };

    while (remaining.length > 0) {
      let room = safeWidth - currentWidth;
      if (room <= 0) {
        startNewLine();
        room = safeWidth - currentWidth;
      }

      if (remaining.length <= room) {
        pushWrappedSpan(current.spans, { ...style, text: remaining });
        currentWidth += remaining.length;
        remaining = "";
        continue;
      }

      let splitAt = remaining.slice(0, room).lastIndexOf(" ");
      if (splitAt <= 0) {
        splitAt = room;
      } else {
        splitAt += 1;
      }

      const chunk = remaining.slice(0, splitAt);
      pushWrappedSpan(current.spans, { ...style, text: chunk });
      currentWidth += chunk.length;
      remaining = remaining.slice(splitAt);
      if (remaining.length > 0) {
        startNewLine();
      }
    }
  }

  output.push(current);
  return output;
}

function countWrappedMarkdownLines(text: string, indent: number, wrapWidth: number): number {
  return markdownToLines(text).flatMap((line) => wrapMarkdownLine(line, indent, wrapWidth)).length;
}

function countWrappedPlainLines(text: string, wrapWidth: number): number {
  const safeWidth = Math.max(1, wrapWidth);
  return (text || "").split(/\r?\n/).reduce((sum, line) => {
    if (line.length === 0) {
      return sum + 1;
    }

    return sum + Math.max(1, Math.ceil(line.length / safeWidth));
  }, 0);
}

function flattenThreadContent(root: InlineCommentNode): string {
  const lines: string[] = [];

  const walk = (node: InlineCommentNode, depth: number): void => {
    const indent = " ".repeat(depth * 2);
    lines.push(`${indent}${author(node.comment.user?.login)}  ${fmtRelativeOrAbsolute(node.comment.created_at)}  id:${node.comment.id}`);
    lines.push(`${indent}${lineRef(node.comment.path, node.comment.line, node.comment.original_line)}`);

    const bodyLines = (node.comment.body || "(no body)").split(/\r?\n/);
    for (const bodyLine of bodyLines) {
      lines.push(`${indent}${bodyLine}`);
    }

    for (const child of node.children) {
      lines.push("");
      walk(child, depth + 1);
    }
  };

  walk(root, 0);
  return lines.join("\n");
}

function parseMouseSequences(chunk: string): MouseSequence[] {
  const events: MouseSequence[] = [];
  const regex = /\u001B\[<(\d+);(\d+);(\d+)([mM])/g;
  let match = regex.exec(chunk);

  while (match) {
    events.push({
      code: Number.parseInt(match[1], 10),
      x: Number.parseInt(match[2], 10),
      y: Number.parseInt(match[3], 10),
      kind: match[4] === "m" ? "m" : "M"
    });
    match = regex.exec(chunk);
  }

  return events;
}

function Body({
  text,
  indent = 0,
  maxLines,
  startLine = 0,
  wrapWidth
}: {
  text: string;
  indent?: number;
  maxLines?: number;
  startLine?: number;
  wrapWidth: number;
}): JSX.Element {
  const wrapped = markdownToLines(text).flatMap((line) => wrapMarkdownLine(line, indent, wrapWidth));
  const hasWrapped = wrapped.length > 0;
  const safeStart = hasWrapped ? clamp(startLine, 0, wrapped.length - 1) : 0;

  let clipped: WrappedBodyLine[];
  let hidden = 0;
  let padLines = 0;
  if (typeof maxLines === "number") {
    const safeMax = Math.max(1, maxLines);
    const hiddenCandidate = Math.max(0, wrapped.length - (safeStart + safeMax));
    const contentLimit = hiddenCandidate > 0 ? Math.max(0, safeMax - 1) : safeMax;
    clipped = wrapped.slice(safeStart, safeStart + contentLimit);
    hidden = hiddenCandidate;
    padLines = safeMax - clipped.length - (hidden > 0 ? 1 : 0);
  } else {
    clipped = wrapped.slice(safeStart);
    hidden = Math.max(0, wrapped.length - (safeStart + clipped.length));
  }

  return (
    <Box flexDirection="column">
      {clipped.map((line, idx) => (
        <Text
          key={`body-${idx}`}
          color={line.color}
          dimColor={Boolean(line.dim)}
          wrap="wrap"
        >
          {""}
          <InlineText spans={line.spans} />
        </Text>
      ))}
      {hidden > 0 && (
        <Text dimColor wrap="wrap">
          {`${" ".repeat(indent)}... (${hidden} more line${hidden === 1 ? "" : "s"})`}
        </Text>
      )}
      {Array.from({ length: Math.max(0, padLines) }).map((_, idx) => (
        <Text key={`body-pad-${idx}`} wrap="wrap">
          {" "}
        </Text>
      ))}
    </Box>
  );
}

function ThreadNode({
  node,
  depth,
  maxBodyLines,
  wrapWidth
}: {
  node: InlineCommentNode;
  depth: number;
  maxBodyLines: number;
  wrapWidth: number;
}): JSX.Element {
  const indent = depth * 2;
  const who = author(node.comment.user?.login);
  const when = fmtRelativeOrAbsolute(node.comment.created_at);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={depth === 0 ? "cyan" : "gray"} wrap="wrap">
        {`${" ".repeat(indent)}${who}  ${when}  id:${node.comment.id}`}
      </Text>
      <Text dimColor wrap="wrap">{`${" ".repeat(indent)}${lineRef(node.comment.path, node.comment.line, node.comment.original_line)}`}</Text>
      <Body text={node.comment.body} indent={indent} maxLines={maxBodyLines} wrapWidth={wrapWidth} />
      {node.children.map((child) => (
        <ThreadNode
          key={child.comment.id}
          node={child}
          depth={depth + 1}
          maxBodyLines={maxBodyLines}
          wrapWidth={wrapWidth}
        />
      ))}
    </Box>
  );
}

function discussionRows(comments: IssueComment[]): SummaryRow[] {
  return comments.map((comment) => ({
    key: `discussion-${comment.id}`,
    headline: `${comment.is_pr_description ? "PR Description" : "Comment"}  ${author(comment.user?.login)}  ${fmtRelativeOrAbsolute(comment.created_at)}`,
    subline: shortBody(comment.body)
  }));
}

function threadRows(threads: InlineThread[]): SummaryRow[] {
  return threads.map((thread) => {
    const root = thread.root.comment;
    const replies = countThreadReplies(thread.root);
    const at = lineRef(root.path, root.line, root.original_line);
    return {
      key: `thread-${root.id}`,
      headline: `${author(root.user?.login)}  ${fmtRelativeOrAbsolute(root.created_at)}  ${at}  ${replies} repl${replies === 1 ? "y" : "ies"}`,
      subline: shortBody(root.body)
    };
  });
}

function reviewRows(reviews: PullRequestReview[]): SummaryRow[] {
  return reviews.map((review) => ({
    key: `review-${review.id}`,
    headline: `${author(review.user?.login)}  ${review.state}  ${fmtRelativeOrAbsolute(review.submitted_at)}`,
    subline: shortBody(review.body)
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function CommentsViewer({
  data,
  onExitRequest
}: {
  data: LoadedPrComments;
  onExitRequest: () => void;
}): JSX.Element {
  const { isRawModeSupported, stdin } = useStdin();
  const { stdout } = useStdout();
  const [activeTab, setActiveTab] = useState<TabKey>(() => pickDefaultTab(data));
  const [panelFocus, setPanelFocus] = useState<PanelFocus>("list");
  const [detailOffset, setDetailOffset] = useState(0);
  const [indices, setIndices] = useState<Record<TabKey, number>>({
    discussion: 0,
    threads: 0,
    reviews: 0
  });

  const rowsByTab = useMemo(
    () => ({
      discussion: discussionRows(data.issueComments),
      threads: threadRows(data.inlineThreads),
      reviews: reviewRows(data.reviews)
    }),
    [data]
  );

  const activeRows = rowsByTab[activeTab];
  const maxIndex = Math.max(0, activeRows.length - 1);
  const activeIndex = clamp(indices[activeTab], 0, maxIndex);

  const terminalRows = stdout.rows || 24;
  const terminalCols = stdout.columns || 80;
  const detailWrapWidth = Math.max(24, terminalCols - 8);
  const listWrapWidth = Math.max(24, terminalCols - 10);
  const helpText = isRawModeSupported
    ? "Keys: Tab focus, j/k or arrows scroll, PgUp/PgDn page, h/l or 1/2/3 switch tabs, mouse wheel scroll, q quit"
    : "Non-interactive terminal detected: rendered once and exiting.";
  const threadContextText = `PR Context: #${data.pr.number} ${data.pr.title}`;

  const appWrapWidth = Math.max(16, terminalCols - 2);
  const titleText = `ghr  ${data.repo.nameWithOwner}  #${data.pr.number}  ${data.pr.title}`;
  const prText = `PR: ${data.pr.url}`;
  const inferenceText = `Inference: ${data.prInference}`;
  const countsText = `Counts: discussion ${data.issueComments.length} | inline comments ${data.reviewComments.length} | inline threads ${data.inlineThreads.length} | reviews ${data.reviews.length}`;
  const tabsText = TAB_ORDER.map((tab, index) => `${index + 1}. ${TAB_LABEL[tab]}`).join("   ");
  const topHeaderLines =
    countWrappedPlainLines(titleText, appWrapWidth) +
    countWrappedPlainLines(prText, appWrapWidth) +
    countWrappedPlainLines(inferenceText, appWrapWidth) +
    countWrappedPlainLines(countsText, appWrapWidth);
  const tabsLineCount = countWrappedPlainLines(tabsText, appWrapWidth);
  const helpLineCount = countWrappedPlainLines(helpText, appWrapWidth);

  const panelRowsAvailable = Math.max(
    10,
    terminalRows - (topHeaderLines + tabsLineCount + helpLineCount + 3)
  );
  const preferredDetailPanelHeight = Math.max(6, Math.floor(panelRowsAvailable * 0.65));
  const detailPanelHeight = clamp(
    preferredDetailPanelHeight,
    6,
    Math.max(6, panelRowsAvailable - 4)
  );
  const listPanelHeight = Math.max(4, panelRowsAvailable - detailPanelHeight);
  const detailPanelInnerHeight = Math.max(1, detailPanelHeight - 2);
  const listThreadContextLines = activeTab === "threads"
    ? countWrappedPlainLines(threadContextText, listWrapWidth)
    : 0;
  const listContentBudget = Math.max(1, listPanelHeight - 2 - 1 - listThreadContextLines);
  const listWindow = clamp(Math.max(2, Math.floor(listContentBudget / 2) + 1), 2, 8);
  const listPageStep = Math.max(1, listWindow - 1);

  const listStart = clamp(activeIndex - Math.floor(listWindow / 2), 0, Math.max(0, activeRows.length - listWindow));
  const visibleRows = useMemo(() => {
    return activeRows.slice(listStart, listStart + listWindow).map((row, idx) => {
      const absolute = listStart + idx;
      const selected = absolute === activeIndex;
      const headlineText = `${selected ? ">" : " "} [${absolute + 1}] ${row.headline}`;
      const headlineLines = wrapMarkdownLine(
        { prefix: "", spans: [{ text: headlineText }] },
        0,
        listWrapWidth
      );
      const sublineLines = wrapMarkdownLine(
        { prefix: "", spans: [{ text: `    ${row.subline}` }] },
        0,
        listWrapWidth
      );
      return {
        row,
        selected,
        headlineLines,
        sublineLines
      };
    });
  }, [activeRows, listStart, listWindow, activeIndex, listWrapWidth]);
  const renderedRows = useMemo(() => {
    if (activeRows.length === 0) {
      return [];
    }

    const output: typeof visibleRows = [];
    let remaining = listContentBudget;
    for (const item of visibleRows) {
      if (remaining <= 0) {
        break;
      }

      const headlineLines = item.headlineLines.slice(0, remaining);
      remaining -= headlineLines.length;
      const sublineLines = remaining > 0 ? item.sublineLines.slice(0, remaining) : [];
      remaining -= sublineLines.length;

      if (headlineLines.length === 0 && sublineLines.length === 0) {
        break;
      }

      output.push({
        ...item,
        headlineLines,
        sublineLines
      });
    }

    return output;
  }, [activeRows.length, listContentBudget, visibleRows]);

  let layoutCursor = 0;
  layoutCursor += topHeaderLines;
  layoutCursor += 1; // tabs marginTop
  layoutCursor += tabsLineCount;
  layoutCursor += 1; // list marginTop
  const listPanelTopRow = layoutCursor + 1;
  layoutCursor += listPanelHeight;
  const detailPanelTopRow = layoutCursor + 1;

  const selectedThread = data.inlineThreads[activeIndex];
  const selectedDiscussion = data.issueComments[activeIndex];
  const selectedReview = data.reviews[activeIndex];
  const discussionDetailHeadline = selectedDiscussion
    ? `${selectedDiscussion.is_pr_description ? "PR Description" : "Comment"}  ${author(selectedDiscussion.user?.login)}  ${fmtRelativeOrAbsolute(selectedDiscussion.created_at)}  id:${selectedDiscussion.id}`
    : "";
  const threadDetailHeadline = selectedThread ? `Thread root id: ${selectedThread.root.comment.id}` : "";
  const reviewDetailHeadline = selectedReview
    ? `${author(selectedReview.user?.login)}  ${selectedReview.state}  ${fmtRelativeOrAbsolute(selectedReview.submitted_at)}  id:${selectedReview.id}`
    : "";

  const detailContextLines = activeTab === "threads"
    ? countWrappedPlainLines(threadContextText, detailWrapWidth)
    : 0;
  let detailLinesAboveBody = 1 + detailContextLines;
  if (activeRows.length === 0) {
    detailLinesAboveBody += 1;
  } else if (activeTab === "discussion" && selectedDiscussion) {
    detailLinesAboveBody +=
      countWrappedPlainLines(discussionDetailHeadline, detailWrapWidth) +
      countWrappedPlainLines(selectedDiscussion.html_url, detailWrapWidth);
  } else if (activeTab === "threads" && selectedThread) {
    detailLinesAboveBody +=
      countWrappedPlainLines(threadDetailHeadline, detailWrapWidth) +
      countWrappedPlainLines(selectedThread.root.comment.html_url, detailWrapWidth);
  } else if (activeTab === "reviews" && selectedReview) {
    detailLinesAboveBody +=
      countWrappedPlainLines(reviewDetailHeadline, detailWrapWidth) +
      countWrappedPlainLines(selectedReview.html_url, detailWrapWidth);
  } else {
    detailLinesAboveBody += 1;
  }
  const detailBodyLines = Math.max(1, detailPanelInnerHeight - detailLinesAboveBody);
  const detailPageStep = Math.max(1, detailBodyLines - 1);

  const detailBodyText = useMemo(() => {
    if (activeTab === "discussion") {
      return selectedDiscussion?.body || "";
    }
    if (activeTab === "reviews") {
      return selectedReview?.body || "";
    }
    if (activeTab === "threads") {
      return selectedThread ? flattenThreadContent(selectedThread.root) : "";
    }
    return "";
  }, [activeTab, selectedDiscussion, selectedReview, selectedThread]);

  const detailLineCount = useMemo(() => {
    return countWrappedMarkdownLines(detailBodyText || "(no body)", 0, detailWrapWidth);
  }, [detailBodyText, detailWrapWidth]);

  const maxDetailOffset = Math.max(0, detailLineCount - detailBodyLines);

  const setTab = useCallback((tab: TabKey): void => {
    setActiveTab(tab);
    setIndices((prev) => ({
      ...prev,
      [tab]: clamp(prev[tab], 0, Math.max(0, rowsByTab[tab].length - 1))
    }));
  }, [rowsByTab]);

  const moveIndex = useCallback((delta: number): void => {
    setIndices((prev) => {
      const current = prev[activeTab];
      const next = clamp(current + delta, 0, Math.max(0, rowsByTab[activeTab].length - 1));
      if (next === current) {
        return prev;
      }
      return { ...prev, [activeTab]: next };
    });
  }, [activeTab, rowsByTab]);

  const moveDetail = useCallback((delta: number): void => {
    setDetailOffset((prev) => {
      const next = clamp(prev + delta, 0, maxDetailOffset);
      return next === prev ? prev : next;
    });
  }, [maxDetailOffset]);

  const panelFocusRef = useRef(panelFocus);
  const listPanelTopRowRef = useRef(listPanelTopRow);
  const detailPanelTopRowRef = useRef(detailPanelTopRow);
  const moveIndexRef = useRef(moveIndex);
  const moveDetailRef = useRef(moveDetail);

  useEffect(() => {
    panelFocusRef.current = panelFocus;
    listPanelTopRowRef.current = listPanelTopRow;
    detailPanelTopRowRef.current = detailPanelTopRow;
    moveIndexRef.current = moveIndex;
    moveDetailRef.current = moveDetail;
  }, [panelFocus, listPanelTopRow, detailPanelTopRow, moveIndex, moveDetail]);

  useEffect(() => {
    setDetailOffset(0);
  }, [activeTab, activeIndex]);

  useEffect(() => {
    setDetailOffset((prev) => clamp(prev, 0, maxDetailOffset));
  }, [maxDetailOffset]);

  useInput(
    (input, key) => {
      if (input === "q" || key.escape || (key.ctrl && input === "c")) {
        onExitRequest();
        return;
      }

      if (input === "1") {
        setTab("discussion");
        return;
      }
      if (input === "2") {
        setTab("threads");
        return;
      }
      if (input === "3") {
        setTab("reviews");
        return;
      }

      if (key.leftArrow || input === "h") {
        const pos = TAB_ORDER.indexOf(activeTab);
        setTab(TAB_ORDER[(pos - 1 + TAB_ORDER.length) % TAB_ORDER.length]);
        return;
      }

      if (key.rightArrow || input === "l") {
        const pos = TAB_ORDER.indexOf(activeTab);
        setTab(TAB_ORDER[(pos + 1) % TAB_ORDER.length]);
        return;
      }

      if (key.tab || input === "\t") {
        setPanelFocus((prev) => (prev === "list" ? "detail" : "list"));
        return;
      }

      if (input === "g") {
        if (panelFocus === "list") {
          moveIndex(-maxIndex);
        } else {
          setDetailOffset(0);
        }
        return;
      }

      if (input === "G") {
        if (panelFocus === "list") {
          moveIndex(maxIndex);
        } else {
          setDetailOffset(maxDetailOffset);
        }
        return;
      }

      if ((key as { pageDown?: boolean }).pageDown) {
        if (panelFocus === "list") {
          moveIndex(listPageStep);
        } else {
          moveDetail(detailPageStep);
        }
        return;
      }

      if ((key as { pageUp?: boolean }).pageUp) {
        if (panelFocus === "list") {
          moveIndex(-listPageStep);
        } else {
          moveDetail(-detailPageStep);
        }
        return;
      }

      if (key.downArrow || input === "j") {
        if (panelFocus === "list") {
          moveIndex(1);
        } else {
          moveDetail(1);
        }
        return;
      }

      if (key.upArrow || input === "k") {
        if (panelFocus === "list") {
          moveIndex(-1);
        } else {
          moveDetail(-1);
        }
      }
    },
    { isActive: Boolean(isRawModeSupported) }
  );

  useEffect(() => {
    if (!isRawModeSupported) {
      onExitRequest();
    }
  }, [isRawModeSupported, onExitRequest]);

  useEffect(() => {
    if (!isRawModeSupported || !stdin.isTTY || !stdout.isTTY) {
      return;
    }

    const enableMouse = "\u001B[?1000h\u001B[?1006h";
    const disableMouse = "\u001B[?1000l\u001B[?1006l";
    stdout.write(enableMouse);

    const onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const events = parseMouseSequences(text);
      if (events.length === 0) {
        return;
      }

      const panelAtMouseRow = (row: number): PanelFocus | null => {
        if (row >= detailPanelTopRowRef.current) {
          return "detail";
        }
        if (row >= listPanelTopRowRef.current) {
          return "list";
        }
        return null;
      };

      for (const event of events) {
        const targetPanel = panelAtMouseRow(event.y) ?? panelFocusRef.current;

        if (event.code === 64 || event.code === 65) {
          const delta = event.code === 64 ? -1 : 1;
          setPanelFocus((prev) => (prev === targetPanel ? prev : targetPanel));
          if (targetPanel === "list") {
            moveIndexRef.current(delta);
          } else {
            moveDetailRef.current(delta);
          }
          continue;
        }

        if (event.kind === "M" && event.code === 0) {
          const clickedPanel = panelAtMouseRow(event.y);
          if (clickedPanel) {
            setPanelFocus((prev) => (prev === clickedPanel ? prev : clickedPanel));
          }
        }
      }
    };

    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
      stdout.write(disableMouse);
    };
  }, [isRawModeSupported, stdin, stdout]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="green" wrap="wrap">{`ghr  ${data.repo.nameWithOwner}  #${data.pr.number}  ${data.pr.title}`}</Text>
      <Text dimColor wrap="wrap">{`PR: ${data.pr.url}`}</Text>
      <Text dimColor wrap="wrap">{`Inference: ${data.prInference}`}</Text>
      <Text wrap="wrap">{`Counts: discussion ${data.issueComments.length} | inline comments ${data.reviewComments.length} | inline threads ${data.inlineThreads.length} | reviews ${data.reviews.length}`}</Text>

      <Box marginTop={1}>
        {TAB_ORDER.map((tab) => (
          <Box key={tab} marginRight={3}>
            <Text color={activeTab === tab ? "yellow" : "gray"} wrap="wrap">
              {`${TAB_ORDER.indexOf(tab) + 1}. ${TAB_LABEL[tab]}`}
            </Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column" borderStyle="round" paddingX={1} height={listPanelHeight}>
        <Text color={panelFocus === "list" ? "yellow" : "cyan"} wrap="wrap">
          {`${TAB_LABEL[activeTab]} (${activeRows.length})${panelFocus === "list" ? "  [focus]" : ""}`}
        </Text>
        {activeTab === "threads" && (
          <Text dimColor wrap="wrap">{threadContextText}</Text>
        )}
        {activeRows.length === 0 ? (
          <Text dimColor>No entries.</Text>
        ) : (
          renderedRows.map((item) => {
            const { row, selected, headlineLines, sublineLines } = item;
            return (
              <Box key={row.key} flexDirection="column">
                {headlineLines.map((line, lineIdx) => (
                  <Text
                    key={`headline-${row.key}-${lineIdx}`}
                    color={selected ? "yellow" : "white"}
                    wrap="wrap"
                  >
                    {""}
                    <InlineText spans={line.spans} />
                  </Text>
                ))}
                {sublineLines.map((line, lineIdx) => (
                  <Text key={`subline-${row.key}-${lineIdx}`} dimColor wrap="wrap">
                    {""}
                    <InlineText spans={line.spans} />
                  </Text>
                ))}
              </Box>
            );
          })
        )}
      </Box>

      <Box flexDirection="column" borderStyle="round" paddingX={1} height={detailPanelHeight}>
        <Text color={panelFocus === "detail" ? "yellow" : "magenta"} wrap="wrap">
          {`Details: ${TAB_LABEL[activeTab]}${panelFocus === "detail" ? "  [focus]" : ""}`}
        </Text>
        {activeTab === "threads" && (
          <Text dimColor wrap="wrap">{threadContextText}</Text>
        )}
        {activeRows.length === 0 && <Text dimColor>No detail to show.</Text>}

        {activeTab === "discussion" && selectedDiscussion && (
          <Box flexDirection="column">
            <Text wrap="wrap">{discussionDetailHeadline}</Text>
            <Text dimColor wrap="wrap">{selectedDiscussion.html_url}</Text>
            <Body
              text={detailBodyText}
              startLine={detailOffset}
              maxLines={detailBodyLines}
              wrapWidth={detailWrapWidth}
            />
          </Box>
        )}

        {activeTab === "threads" && selectedThread && (
          <Box flexDirection="column">
            <Text wrap="wrap">{threadDetailHeadline}</Text>
            <Text dimColor wrap="wrap">{selectedThread.root.comment.html_url}</Text>
            <Body
              text={detailBodyText}
              startLine={detailOffset}
              maxLines={detailBodyLines}
              wrapWidth={detailWrapWidth}
            />
          </Box>
        )}

        {activeTab === "reviews" && selectedReview && (
          <Box flexDirection="column">
            <Text wrap="wrap">{reviewDetailHeadline}</Text>
            <Text dimColor wrap="wrap">{selectedReview.html_url}</Text>
            <Body
              text={detailBodyText}
              startLine={detailOffset}
              maxLines={detailBodyLines}
              wrapWidth={detailWrapWidth}
            />
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          {helpText}
        </Text>
      </Box>
    </Box>
  );
}
