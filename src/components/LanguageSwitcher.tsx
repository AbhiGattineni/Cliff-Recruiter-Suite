import { useEffect, useRef, useState } from "react";
import { LANGS } from "../lib/indexGuide";
import { useLang } from "../context/LangContext";

// A single floating icon, fixed in the corner of every page, that sets the
// app-wide language preference. Replaces the inline pickers the Performance
// Index guide and Ask Anything summaries used to carry separately.

export default function LanguageSwitcher() {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div className="lang-fab-wrap" ref={ref}>
      {open && (
        <div className="lang-fab-menu" role="menu" aria-label="Choose language">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitemradio"
              aria-checked={l.code === lang}
              className={`lang-fab-item${l.code === lang ? " active" : ""}`}
              onClick={() => {
                setLang(l.code);
                setOpen(false);
              }}
            >
              {l.label}
              {l.code === lang && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="lang-fab"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change language"
      >
        <span aria-hidden="true">🌐</span>
        <span className="lang-fab-code">{current.code.toUpperCase()}</span>
      </button>
    </div>
  );
}
