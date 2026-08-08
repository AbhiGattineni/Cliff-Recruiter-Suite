import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { DebugLogEntry, useDebugLog } from "../context/DebugLogContext";
import Modal from "./Modal";

function formatEntry(e: DebugLogEntry): string {
  const lines = [`Q: ${e.question}`];
  if (e.table) lines.push(`Table: ${e.table}`);
  if (e.plan) {
    lines.push(`From: ${e.plan.dateFrom ?? "–"}   To: ${e.plan.dateTo ?? "–"}`);
    if (e.plan.groupBy) lines.push(`Group by: ${e.plan.groupBy}`);
    lines.push(
      e.plan.filters.length
        ? `Filters:\n${e.plan.filters.map((f) => `  ${f.field} ${f.op} ${JSON.stringify(f.value)}`).join("\n")}`
        : "Filters: (none)"
    );
  }
  if (e.rowsLoaded !== undefined) {
    const groupPart = e.groups !== undefined ? ` -> ${e.groups} group(s)` : "";
    lines.push(`Rows loaded: ${e.rowsLoaded}${groupPart} -> matched: ${e.rowsMatched ?? "?"}`);
  }
  if (e.error) lines.push(`Error: ${e.error}`);
  if (e.rawPlan) lines.push(`Raw LLM plan: ${JSON.stringify(e.rawPlan)}`);
  return lines.join("\n");
}

/** Floating debug-log icon — visible only to whoever can use Ask Anything, since it's the same pipeline being inspected. */
export default function DebugLogPanel() {
  const { profile } = useAuth();
  const canSee = profile?.role === "admin" || profile?.role === "manager";
  const { entries, clear } = useDebugLog();
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!canSee) return null;

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // No clipboard access — the text is still on screen to select by hand.
    }
  };

  return (
    <>
      <button type="button" className="debug-fab" onClick={() => setOpen(true)} title="Ask Anything debug log">
        <span aria-hidden="true">🐞</span>
        {entries.length > 0 && <span className="debug-fab-count">{entries.length}</span>}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ask Anything — debug log"
        wide
        footer={entries.length > 0 ? <button className="btn ghost" onClick={clear}>Clear log</button> : undefined}
      >
        <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
          Every question asked on this device, with the exact plan the AI produced and how many rows
          it matched — kept locally in this browser, nothing sent anywhere. When a question comes
          back empty or wrong, open this, copy the entry, and paste it wherever you're reporting it —
          that's enough to tell whether it picked the wrong table, an unwanted date range, or the
          filter just doesn't match how the value is spelled in your data.
        </p>
        {entries.length === 0 && <p className="muted">Nothing logged yet — ask a question.</p>}
        <div className="debug-log-list">
          {entries.map((e) => (
            <div className="debug-log-entry" key={e.id}>
              <div className="debug-log-head">
                <span className="debug-log-q">{e.question}</span>
                <span className="muted" style={{ fontSize: "0.75rem", flexShrink: 0 }}>
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
              </div>
              <pre className="debug-log-body">{formatEntry(e)}</pre>
              <button
                type="button"
                className="btn ghost"
                style={{ padding: "0.2rem 0.6rem", fontSize: "0.78rem" }}
                onClick={() => copy(formatEntry(e), e.id)}
              >
                {copiedId === e.id ? "Copied" : "Copy"}
              </button>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
