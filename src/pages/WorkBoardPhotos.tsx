// Photos on a Work Board ticket: upload, drag-and-drop, paste a screenshot,
// thumbnails, and a full-size viewer.
//
// On an existing ticket, photos upload the moment they're added. On a new
// ticket there's no ID to file them under yet, so they wait in `pending` and
// WorkBoard uploads them right after the ticket is created.

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { friendlyError } from "../lib/errors";
import {
  IssueAttachment,
  PHOTO_ACCEPT,
  deleteAttachment,
  photoProblem,
  subscribeAttachments,
  uploadAttachment,
} from "../lib/board";

type Viewing = { url: string; name: string; meta: string } | null;

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function WorkBoardPhotos({
  issueId,
  actor,
  canModerate,
  nameOf,
  pending,
  onPendingChange,
}: {
  issueId: string | null;
  actor: string;
  canModerate: boolean;
  nameOf: (email: string) => string;
  pending: File[];
  onPendingChange: (files: File[]) => void;
}) {
  const [photos, setPhotos] = useState<IssueAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const me = actor.toLowerCase();

  useEffect(() => {
    if (!issueId) return;
    return subscribeAttachments(issueId, setPhotos, (e) => setErr(friendlyError(e)));
  }, [issueId]);

  // Previews for photos that aren't uploaded yet.
  const pendingUrls = useMemo(() => pending.map((f) => URL.createObjectURL(f)), [pending]);
  useEffect(() => () => pendingUrls.forEach((u) => URL.revokeObjectURL(u)), [pendingUrls]);

  const add = async (files: File[]) => {
    const ok: File[] = [];
    const problems: string[] = [];
    for (const f of files) {
      const p = photoProblem(f);
      if (p) problems.push(p);
      else ok.push(f);
    }
    setErr(problems.length ? problems.join(" ") : null);
    if (!ok.length) return;

    if (!issueId) {
      onPendingChange([...pending, ...ok]);
      return;
    }
    setUploading((n) => n + ok.length);
    for (const f of ok) {
      try {
        await uploadAttachment(issueId, f, actor);
      } catch (e) {
        setErr(friendlyError(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  // ⌘/Ctrl + V with a screenshot on the clipboard attaches it. Text pastes are left alone.
  const addRef = useRef(add);
  addRef.current = add;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      const named = files.map((f, i) =>
        f.name && f.name !== "image.png" ? f : new File([f], `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}${i ? `-${i}` : ""}.png`, { type: f.type })
      );
      void addRef.current(named);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void add(Array.from(e.dataTransfer.files));
  };

  const remove = async (a: IssueAttachment) => {
    if (!issueId || !window.confirm(`Remove "${a.name}" from this ticket?`)) return;
    try {
      await deleteAttachment(issueId, a, actor);
    } catch (e) {
      setErr(friendlyError(e));
    }
  };

  // One list for the viewer, whether photos are saved or still pending.
  const items = issueId
    ? photos.map((a) => ({
        key: a.id,
        url: a.url,
        name: a.name,
        meta: `${nameOf(a.uploadedBy.toLowerCase())} · ${a.createdAt ? a.createdAt.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "just now"} · ${kb(a.size)}`,
        canRemove: a.uploadedBy.toLowerCase() === me || canModerate,
        onRemove: () => remove(a),
      }))
    : pending.map((f, i) => ({
        key: `p${i}-${f.name}`,
        url: pendingUrls[i],
        name: f.name,
        meta: `Uploads when you create the ticket · ${kb(f.size)}`,
        canRemove: true,
        onRemove: () => onPendingChange(pending.filter((_, j) => j !== i)),
      }));

  const viewing: Viewing = viewIndex != null && items[viewIndex] ? items[viewIndex] : null;

  return (
    <div className="field" style={{ marginTop: "0.9rem" }}>
      <label>
        Photos {items.length > 0 && <span className="muted" style={{ fontWeight: 400 }}>({items.length})</span>}
      </label>

      {err && <div className="alert error" style={{ margin: "0 0 0.5rem" }}>{err}</div>}

      <div
        className={`wb-drop${dragOver ? " over" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {items.length > 0 && (
          <div className="wb-thumbs">
            {items.map((it, i) => (
              <figure key={it.key} className="wb-thumb">
                <button type="button" className="wb-thumb-img" onClick={() => setViewIndex(i)} title={`${it.name} — click to view`}>
                  <img src={it.url} alt={it.name} loading="lazy" />
                </button>
                <figcaption title={it.name}>{it.name}</figcaption>
                {it.canRemove && (
                  <button type="button" className="wb-thumb-x" onClick={it.onRemove} aria-label={`Remove ${it.name}`} title="Remove">×</button>
                )}
              </figure>
            ))}
            {uploading > 0 && (
              <div className="wb-thumb wb-thumb-loading"><span className="spinner dark" /></div>
            )}
          </div>
        )}

        <div className="wb-drop-hint">
          <button type="button" className="btn ghost" style={{ padding: "0.35rem 0.8rem" }} onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
            {uploading > 0 && items.length === 0 ? <span className="spinner dark" /> : "📷"} Add photos
          </button>
          <span className="muted">or drag them here, or paste a screenshot (⌘ + V). PNG, JPG, GIF, WebP — up to 10 MB each.</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            void add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {viewing && viewIndex != null && (
        <Lightbox
          item={viewing}
          index={viewIndex}
          total={items.length}
          onPrev={() => setViewIndex((i) => (i == null ? i : (i - 1 + items.length) % items.length))}
          onNext={() => setViewIndex((i) => (i == null ? i : (i + 1) % items.length))}
          onClose={() => setViewIndex(null)}
        />
      )}
    </div>
  );
}

function Lightbox({
  item,
  index,
  total,
  onPrev,
  onNext,
  onClose,
}: {
  item: { url: string; name: string; meta: string };
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const handlers = useRef({ onPrev, onNext, onClose });
  handlers.current = { onPrev, onNext, onClose };
  useEffect(() => {
    // Capture phase, so Escape closes the photo and not the whole ticket behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); handlers.current.onClose(); }
      else if (e.key === "ArrowLeft") handlers.current.onPrev();
      else if (e.key === "ArrowRight") handlers.current.onNext();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="wb-lightbox" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button type="button" className="wb-lb-close" onClick={onClose} aria-label="Close">×</button>
      {total > 1 && <button type="button" className="wb-lb-nav prev" onClick={onPrev} aria-label="Previous photo">‹</button>}
      <img src={item.url} alt={item.name} />
      {total > 1 && <button type="button" className="wb-lb-nav next" onClick={onNext} aria-label="Next photo">›</button>}
      <div className="wb-lb-caption">
        <strong>{item.name}</strong> <span>{item.meta}</span>
        {total > 1 && <span> · {index + 1} of {total}</span>}
        {" · "}
        <a href={item.url} target="_blank" rel="noreferrer">Open original ↗</a>
      </div>
    </div>
  );
}