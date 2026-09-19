// Meeting transcripts, read live from Fireflies.
//
// Admin/manager only, gated here and again in the callable — a recording can
// carry pay, performance and client-commercial talk, and hiding a nav item is
// not access control.
//
// Nothing is stored: the list is fetched on demand and the full transcript only
// when a meeting is opened, so a long back-catalogue costs one small request
// and the bodies of those conversations never sit in our database.

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useAuth } from "../context/AuthContext";
import { errorDetail } from "../lib/errors";
import {
  listMeetings,
  getMeeting,
  briefMeetings,
  formatDuration,
  formatTimecode,
  MAX_BRIEF_MEETINGS,
  Meeting,
  BriefResult,
} from "../lib/meetings";
import Modal from "../components/Modal";
import Pagination, { usePagination } from "../components/Pagination";

const PAGE_LIMIT = 50;

/**
 * A failure, said twice: once for whoever hit it, and once for whoever has to
 * fix it. The second half stays collapsed — a recruiter does not need a
 * GraphQL message, and the person debugging the integration needs exactly that
 * and should not have to open a console to get it.
 */
function ErrorPanel({ err }: { err: unknown }) {
  const d = errorDetail(err);
  return (
    <div className="alert error">
      <div>{d.message}</div>
      {(d.code || d.raw) && (
        <details className="err-detail">
          <summary>Technical details</summary>
          {d.code && (
            <div>
              <span className="mono">{d.code}</span>
            </div>
          )}
          {d.raw && <pre className="mono">{d.raw}</pre>}
        </details>
      )}
    </div>
  );
}

function when(ms: number | null): string {
  if (!ms) return "—";
  return DateTime.fromMillis(ms).toFormat("dd LLL yyyy, HH:mm");
}

/** Everyone on the call, with the organiser first and de-duplicated. */
function attendees(m: Meeting): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [m.organizer, ...m.participants]) {
    const v = (p ?? "").trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** A list section that simply isn't there when the model found nothing. */
function BriefList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h3>{title}</h3>
      <ul style={{ marginTop: 0 }}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </>
  );
}

function BriefPanel({ result, onClose }: { result: BriefResult; onClose: () => void }) {
  const b = result.brief;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Brief — ${result.meetingCount} meeting${result.meetingCount === 1 ? "" : "s"}`}
      wide
    >
      {result.truncated > 0 && (
        <div className="alert warn">
          {result.truncated === 1
            ? "One transcript was too long to send in full and was cut short."
            : `${result.truncated} transcripts were too long to send in full and were cut short.`}{" "}
          The brief covers what fitted — brief fewer meetings at once for full coverage.
        </div>
      )}

      {b.overview ? (
        <p style={{ marginTop: 0 }}>{b.overview}</p>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          The model returned no overview for these meetings.
        </p>
      )}

      <BriefList title="Themes" items={b.themes} />
      <BriefList title="Decisions" items={b.decisions} />

      {b.actionItems.length > 0 && (
        <>
          <h3>Action items</h3>
          <ul style={{ marginTop: 0 }}>
            {b.actionItems.map((a, i) => (
              <li key={i}>
                {a.text}
                {a.owner && <span className="muted"> — {a.owner}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <BriefList title="Risks and blockers" items={b.risks} />

      <p className="muted" style={{ fontSize: "0.78rem", marginTop: "1.25rem", marginBottom: 0 }}>
        Written by {result.model || "the model"} from the transcripts. It can misread a
        conversation — check anything you are about to act on against the transcript itself.
      </p>
    </Modal>
  );
}

function MeetingDetail({
  id,
  isAdmin,
  onClose,
}: {
  id: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["meeting", id, isAdmin],
    queryFn: () => getMeeting(id, isAdmin),
    // The transcript of a finished meeting never changes, so once it is here
    // it can stay for the session.
    staleTime: Infinity,
  });

  return (
    <Modal open onClose={onClose} title={q.data?.meeting.title ?? "Meeting"} wide>
      {q.isLoading ? (
        <div className="center-load" style={{ minHeight: "30vh" }}>
          <div className="spinner dark" />
        </div>
      ) : q.isError ? (
        <ErrorPanel err={q.error} />
      ) : !q.data ? null : (
        <>
          <div className="kv" style={{ marginBottom: "1rem" }}>
            <div className="kv-row">
              <div className="kv-k">When</div>
              <div className="kv-v">{when(q.data.meeting.date)}</div>
            </div>
            <div className="kv-row">
              <div className="kv-k">Length</div>
              <div className="kv-v">{formatDuration(q.data.meeting.durationMins)}</div>
            </div>
            <div className="kv-row">
              <div className="kv-k">On the call</div>
              <div className="kv-v">{attendees(q.data.meeting).join(", ") || "—"}</div>
            </div>
          </div>

          {q.data.meeting.summary.overview && (
            <>
              <h3>Summary</h3>
              <p style={{ marginTop: 0 }}>{q.data.meeting.summary.overview}</p>
            </>
          )}

          {q.data.meeting.summary.actionItems.length > 0 && (
            <>
              <h3>Action items</h3>
              <ul style={{ marginTop: 0 }}>
                {q.data.meeting.summary.actionItems.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </>
          )}

          <h3>Transcript</h3>
          {q.data.sentences.length === 0 ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Fireflies has no transcript text for this meeting.
            </p>
          ) : (
            <div className="transcript">
              {q.data.sentences.map((s, i) => (
                <div className="transcript-line" key={i}>
                  <div className="transcript-who">
                    <span className="transcript-speaker">{s.speaker}</span>
                    <span className="transcript-time">{formatTimecode(s.startSec)}</span>
                  </div>
                  <p className="transcript-text">{s.text}</p>
                </div>
              ))}
            </div>
          )}

          {q.data.raw != null && (
            <details className="err-detail" style={{ marginTop: "1.25rem" }}>
              <summary>Raw Fireflies response (admin)</summary>
              <p className="muted" style={{ fontSize: "0.8rem", margin: "0.4rem 0" }}>
                What the API actually returned, before this app renamed anything. If a field above
                is blank, its real name is in here.
              </p>
              <pre className="mono">{JSON.stringify(q.data.raw, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </Modal>
  );
}

export default function Meetings() {
  const { profile, profileLoading } = useAuth();
  const canSee = profile?.role === "admin" || profile?.role === "manager";
  const isAdmin = profile?.role === "admin";
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [brief, setBrief] = useState<BriefResult | null>(null);

  const q = useQuery({
    queryKey: ["meetings"],
    queryFn: () => listMeetings(PAGE_LIMIT),
    enabled: canSee,
  });

  const rows = q.data ?? [];
  const p = usePagination(rows, 25, "meetings");

  // Selection survives paging, so the count is over everything ticked, not
  // just what is currently on screen.
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const tooMany = selectedIds.length > MAX_BRIEF_MEETINGS;

  const briefQ = useMutation({
    mutationFn: () => briefMeetings(selectedIds),
    onSuccess: setBrief,
  });

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The header box acts on the current page only — "select all" across pages
  // you have not looked at is a good way to brief the wrong meetings.
  const pageIds = p.pageItems.map((m) => m.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const togglePage = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (allOnPage) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  if (profileLoading && !profile) {
    return (
      <div className="center-load" style={{ minHeight: "30vh" }}>
        <div className="spinner dark" />
      </div>
    );
  }

  if (!canSee) {
    return (
      <div>
        <h1>Meetings</h1>
        <div className="alert info">
          Meeting transcripts are available to managers and admins — a recording can carry pay,
          performance and client-commercial discussion. Ask an admin if you need access.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Meetings</h1>

      <div className="card">
        <h2>🎙️ Recent meetings</h2>
        <div className="sub">
          Read live from Fireflies — nothing is copied into this app. Open a meeting for its
          summary, action items and the full transcript.
        </div>

        {q.isLoading ? (
          <div className="center-load" style={{ minHeight: "30vh" }}>
            <div className="spinner dark" />
          </div>
        ) : q.isError ? (
          <ErrorPanel err={q.error} />
        ) : rows.length === 0 ? (
          <div className="alert info">
            No meetings came back from Fireflies. Nothing recorded yet, or the API key doesn&#39;t
            have access to this workspace.
          </div>
        ) : (
          <>
            <div className="select-bar">
              <div>
                {selectedIds.length === 0 ? (
                  <span className="muted">Tick meetings to brief them together.</span>
                ) : (
                  <>
                    <strong>{selectedIds.length}</strong> selected
                    <button
                      className="btn ghost"
                      style={{ marginLeft: "0.6rem", padding: "0.25rem 0.7rem", fontSize: "0.8rem" }}
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
              <button
                className="btn"
                disabled={selectedIds.length === 0 || tooMany || briefQ.isPending}
                onClick={() => briefQ.mutate()}
                title={
                  tooMany
                    ? `Select at most ${MAX_BRIEF_MEETINGS}`
                    : "Summarise the selected meetings together"
                }
              >
                {briefQ.isPending ? <span className="spinner" /> : "✨"} Brief selected
              </button>
            </div>

            {tooMany && (
              <div className="alert warn">
                Up to {MAX_BRIEF_MEETINGS} meetings can be briefed at once — {selectedIds.length}{" "}
                are selected. Each one is fetched in full before the model sees it, so a larger
                batch is slow and expensive rather than impossible.
              </div>
            )}
            {briefQ.isError && <ErrorPanel err={briefQ.error} />}

            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <input
                        type="checkbox"
                        checked={allOnPage}
                        onChange={togglePage}
                        aria-label="Select every meeting on this page"
                      />
                    </th>
                    <th>Meeting</th>
                    <th>When</th>
                    <th>Length</th>
                    <th>On the call</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {p.pageItems.map((m) => {
                    const people = attendees(m);
                    return (
                      <tr
                        key={m.id}
                        style={{ cursor: "pointer" }}
                        onClick={() => setOpenId(m.id)}
                        title="Open the transcript"
                      >
                        {/* Stops the row's open-transcript click firing when the
                            intent was to tick the box. */}
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(m.id)}
                            onChange={() => toggle(m.id)}
                            aria-label={`Select ${m.title}`}
                          />
                        </td>
                        <td style={{ whiteSpace: "normal", maxWidth: 380 }}>{m.title}</td>
                        <td>{when(m.date)}</td>
                        <td>{formatDuration(m.durationMins)}</td>
                        <td style={{ whiteSpace: "normal", maxWidth: 320 }}>
                          {people.length === 0
                            ? "—"
                            : people.length <= 3
                              ? people.join(", ")
                              : `${people.slice(0, 3).join(", ")} +${people.length - 3}`}
                        </td>
                        <td>
                          {m.summary.actionItems.length > 0 ? (
                            <span className="pill amber">{m.summary.actionItems.length}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={p.page}
              pageCount={p.pageCount}
              total={p.total}
              pageSize={p.pageSize}
              onPage={p.setPage}
              onPageSize={p.setPageSize}
            />
          </>
        )}
      </div>

      {openId && (
        <MeetingDetail id={openId} isAdmin={!!isAdmin} onClose={() => setOpenId(null)} />
      )}
      {brief && <BriefPanel result={brief} onClose={() => setBrief(null)} />}
    </div>
  );
}
