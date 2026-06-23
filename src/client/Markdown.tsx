// Shared markdown renderer (PROG-42). Wraps react-markdown with a custom `img`
// so uploaded images (`/api/images/<id>`) request a resized variant for inline
// display and link to the full image, and so every image is size-capped and
// lazy-loaded. react-markdown renders no raw HTML by default, so `![]()` is the
// only image vector — no sanitizer needed. Used by descriptions and comments.

import ReactMarkdown from "react-markdown";

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
      components={{
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
