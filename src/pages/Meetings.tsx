// Meeting transcripts, read live from Fireflies.
//
// Admin/manager only, gated here and again in the callable — a recording can
// carry pay, performance and client-commercial talk, and hiding a nav item is
// not access control.
//
// Nothing is stored: the list is fetched on demand and the full transcript only
// when a meeting is opened, so a long back-catalogue costs one small request
// and the bodies of those conversations never sit in our database.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useAuth } from "../context/AuthContext";
import { friendlyError } from "../lib/errors";
import {
  listMeetings,
  getMeeting,
  formatDuration,
  formatTimecode,
  Meeting,
} from "../lib/meetings";
import Modal from "../components/Modal";
import Pagination, { usePagination } from "../components/Pagination";

const PAGE_LIMIT = 50;

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

function MeetingDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["meeting", id],
    queryFn: () => getMeeting(id),
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
        <div className="alert error">{friendlyError(q.error)}</div>
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
        </>
      )}
    </Modal>
  );
}

export default function Meetings() {
  const { profile, profileLoading } = useAuth();
  const canSee = profile?.role === "admin" || profile?.role === "manager";
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["meetings"],
    queryFn: () => listMeetings(PAGE_LIMIT),
    enabled: canSee,
  });

  const rows = q.data ?? [];
  const p = usePagination(rows, 25, "meetings");

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
          <div className="alert error">{friendlyError(q.error)}</div>
        ) : rows.length === 0 ? (
          <div className="alert info">
            No meetings came back from Fireflies. Nothing recorded yet, or the API key doesn&#39;t
            have access to this workspace.
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
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

      {openId && <MeetingDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
