import { useState, ReactNode } from "react";

// Collapsible section used throughout the assessment views.
//
// Reveal is a CSS *animation* on display:none -> block, not a height
// transition. Two earlier attempts failed in Chrome: `grid-template-rows:
// 0fr -> 1fr` never interpolates (the track stays pinned at 0px), and a
// measured max-height transition gets stuck because closing has to start from
// `none`, which can't interpolate to a length. An animation has no start-value
// problem, and display:none keeps the body mounted so child state (the
// LinkedIn signal form) survives collapsing.

export default function Section({
  title,
  icon,
  summary,
  defaultOpen = false,
  children,
  index = 0,
}: {
  title: string;
  icon?: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  /** Position in the stack — staggers the entrance animation. */
  index?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`sec rise${open ? " open" : ""}`} style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}>
      <button
        type="button"
        className="sec-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="sec-caret"
          aria-hidden="true"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        {icon && <span className="sec-ico" aria-hidden="true">{icon}</span>}
        <span className="sec-title">{title}</span>
        {summary}
      </button>
      <div className="sec-body-wrap">
        <div className="sec-body">{children}</div>
      </div>
    </div>
  );
}
