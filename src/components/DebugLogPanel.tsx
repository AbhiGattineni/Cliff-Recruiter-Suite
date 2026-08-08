import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { DebugLogEntry, clearDebugLog, listDebugLog } from "../lib/ask";
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
  if (e.rowsLoaded != null) {
    const groupPart = e.groups != null ? ` -> ${e.groups} group(s)` : "";
    lines.push(`Rows loaded: ${e.rowsLoaded}${groupPart} -> matched: ${e.rowsMatched ?? "?"}`);
  }
  if (e.error) lines.push(`Error: ${e.error}`);
  if (e.rawPlan) lines.push(`Raw LLM plan: ${JSON.stringify(e.rawPlan)}`);
  return lines.join("\n");
}

/**
 * Floating debug-log icon — visible only to whoever can use Ask Anything,
 * since it's the same pipeline being inspected. Backed by Firestore (see the
 * "ai" function's askDebugWrite/askDebugList/askDebugClear actions), not
 * per-browser storage, so a "why did this come back empty" report from
 * anyone can be diagnosed by any admin/manager here.
 */
export default function DebugLogPanel() {
  const { profile } = useAuth();
  const canSee = profile?.role === "admin" || profile?.role === "manager";
  const isAdmin = profile?.role === "admin";
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const qc = useQueryClient();

  const logQ = useQuery({ queryKey: ["askDebugLog"], queryFn: listDebugLog, enabled: canSee && open });

  if (!canSee) return null;

  const entries = logQ.data ?? [];

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // No clipboard access — the text is still on screen to select by hand.
    }
  };

  const clear = async () => {
    await clearDebugLog();
    await qc.invalidateQueries({ queryKey: ["askDebugLog"] });
  };

  return (
    <>
      <button type="button" className="debug-fab" onClick={() => setOpen(true)} title="Ask Anything debug log">
        <span aria-hidden="true">🐞</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ask Anything — debug log"
        wide
        footer={
          <>
            <button className="btn ghost" onClick={() => void logQ.refetch()} disabled={logQ.isFetching}>
              {logQ.isFetching ? <span className="spinner dark" /> : "Refresh"}
            </button>
            {isAdmin && entries.length > 0 && (
              <button className="btn ghost" onClick={() => void clear()}>Clear log</button>
            )}
          </>
        }
      >
        <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
          Every question anyone with access has asked, with the exact plan the AI produced and how many
          rows it matched — shared here, not per-browser, so a "no results" or "wrong answer" report can be
          diagnosed by any admin or manager. Copy the entry and paste it wherever you're reporting it.
        </p>
        {logQ.isLoading && (
          <div className="center-load" style={{ minHeight: "10vh" }}>
            <div className="spinner dark" />
          </div>
        )}
        {!logQ.isLoading && entries.length === 0 && <p className="muted">Nothing logged yet — ask a question.</p>}
        <div className="debug-log-list">
          {entries.map((e) => (
            <div className="debug-log-entry" key={e.id}>
              <div className="debug-log-head">
                <span className="debug-log-q">{e.question}</span>
                <span className="muted" style={{ fontSize: "0.75rem", flexShrink: 0 }}>
                  {e.createdByName ? `${e.createdByName} · ` : ""}
                  {e.createdAt ? new Date(e.createdAt).toLocaleString() : ""}
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
