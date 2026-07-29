// PR-reference autolinking (PROG-121). Agents (and the owner) mention pull
// requests in action text as bare `#107` / "PR #10" without pasting a URL —
// remark-gfm only autolinks full URLs, so those refs rendered as dead text.
// This remark plugin turns `#<number>` in text nodes into links against the
// action's focus `gitUrl` (`<gitUrl>/pull/<n>`, GitHub-style; GitHub redirects
// to /issues/<n> when the number is an issue, so a mistaken kind still lands).
//
// Scope guards: only text nodes are rewritten — code spans/blocks are distinct
// mdast node types and existing links aren't descended into, so `#123` inside
// backticks or an already-linked ref stays untouched. The number is capped at
// 5 digits and must not butt against word characters, so hex colors (`#1e90ff`,
// `#123456`) and fragments don't match.

// Minimal structural mdast shape — enough for the walk without depending on
// @types/mdast (only a transitive dep of remark-gfm).
type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
};

// `#` must open the token (start / whitespace / bracket-ish punctuation before
// it) and the digits must end it (no trailing word char).
const PR_REF = /(^|[\s([{])#(\d{1,5})(?![\w#])/g;

/** Normalize a focus gitUrl to the base PRs hang off, or null if unusable. */
export function prRefBase(gitUrl: string | null | undefined): string | null {
  const trimmed = gitUrl
    ?.trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  return trimmed ? trimmed : null;
}

/** Split one text value into text/link segments. Exported for tests. */
export function splitPrRefs(value: string, base: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(PR_REF)) {
    const prefix = m[1] ?? "";
    const num = m[2] ?? "";
    const start = m.index + prefix.length;
    if (start > last) out.push({ type: "text", value: value.slice(last, start) });
    out.push({
      type: "link",
      url: `${base}/pull/${num}`,
      children: [{ type: "text", value: `#${num}` }],
    });
    last = start + num.length + 1;
  }
  if (out.length === 0) return [{ type: "text", value }];
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function walk(node: MdNode, base: string): void {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    // Don't linkify inside an existing link (or reference-style link).
    if (child.type === "link" || child.type === "linkReference") return [child];
    if (child.type === "text" && child.value !== undefined) {
      return splitPrRefs(child.value, base);
    }
    walk(child, base);
    return [child];
  });
}

/** remark plugin: `[remarkPrRefs, { base }]` in `remarkPlugins`. */
export default function remarkPrRefs(options: { base: string }) {
  return (tree: MdNode) => walk(tree, options.base);
}
