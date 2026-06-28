// Shared markdown renderer (PROG-42). Wraps react-markdown with a custom `img`
// so uploaded images (`/api/images/<id>`) request a resized variant for inline
// display and link to the full image, and so every image is size-capped and
// lazy-loaded. react-markdown renders no raw HTML by default, so `![]()` is the
// only image vector — no sanitizer needed. Used by descriptions and comments.
//
// remark-gfm autolinks bare URLs (PROG-72) so a pasted Drive/Sheets link is
// clickable, not plain text; react-markdown's default urlTransform still strips
// dangerous schemes (javascript:, etc.). Long URLs wrap via `.prose-lite`'s
// overflow-wrap rather than being truncated, so the full address stays visible
// and copyable.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Inline display width (CSS still caps to the container); the link opens full.
const DISPLAY_WIDTH = 900;

function variants(src: string | undefined): { display: string; full: string } {
  if (!src) return { display: "", full: "" };
  // Our own blobs: `?w=` asks the worker for an edge-resized copy; `?raw=1` is
  // the untouched original behind the click-through.
  if (/^\/api\/images\/[^?]+$/.test(src)) {
    return { display: `${src}?w=${DISPLAY_WIDTH}`, full: `${src}?raw=1` };
  }
  return { display: src, full: src };
}

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ href, children }) {
          // Open links (markdown + autolinked URLs) in a new tab; noopener
          // noreferrer guards against reverse-tabnabbing and referrer leakage.
          return (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },
        img({ src, alt }) {
          const { display, full } = variants(typeof src === "string" ? src : undefined);
          return (
            <a href={full} target="_blank" rel="noreferrer">
              <img src={display} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />
            </a>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
