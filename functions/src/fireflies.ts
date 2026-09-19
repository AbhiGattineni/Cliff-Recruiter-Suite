// Fireflies.ai transcript proxy.
//
// The API key is a workspace-wide credential — it reads every meeting anyone at
// Cliff has recorded — so it stays here and never reaches the browser. The
// callable that uses this module gates on role before calling in.
//
// NOTE ON THE SCHEMA: the queries below follow Fireflies' documented GraphQL
// API, but were written without a live account to check against. Fireflies has
// changed field names between versions (`summary.overview` vs `summary.short_summary`,
// `audio_url` vs `transcript_url`), so every field is read defensively: a
// missing one degrades to empty rather than throwing, and `pick()` below
// accepts several spellings. If a field comes back empty against the real
// workspace, add its actual name to the alias list rather than rewriting the
// parser.

const API_URL = process.env.FIREFLIES_API_URL || "https://api.fireflies.ai/graphql";

/** One meeting, as this app cares about it. */
export interface Meeting {
  id: string;
  title: string;
  /** Epoch ms, or null when Fireflies gave us something unparseable. */
  date: number | null;
  /** Minutes, rounded. Fireflies is inconsistent about seconds vs minutes. */
  durationMins: number | null;
  organizer: string;
  participants: string[];
  /** Link back to the meeting in Fireflies. */
  url: string;
  summary: {
    overview: string;
    actionItems: string[];
    keywords: string[];
  };
}

/** One line of speech. Only fetched when a meeting is opened. */
export interface Sentence {
  speaker: string;
  text: string;
  /** Seconds from the start of the recording. */
  startSec: number | null;
}

// ---------------------------------------------------------------------------
// Tolerant readers. Fireflies returns nulls liberally and has renamed fields
// across versions; none of that should surface as a 500 to a recruiter.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

/** First alias present and non-empty, as a trimmed string. */
function pick(src: Obj, ...names: string[]): string {
  for (const n of names) {
    const v = src[n];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/** First alias present, as a string array. Accepts a newline-joined string. */
function pickList(src: Obj, ...names: string[]): string[] {
  for (const n of names) {
    const v = src[n];
    if (Array.isArray(v)) {
      const out = v
        .map((x) => (typeof x === "string" ? x : pick(obj(x), "text", "name", "email")))
        .map((s) => s.trim())
        .filter(Boolean);
      if (out.length) return out;
    }
    // Fireflies returns action items as one newline-delimited blob on some plans.
    if (typeof v === "string" && v.trim()) {
      const out = v
        .split(/\r?\n/)
        .map((s) => s.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean);
      if (out.length) return out;
    }
  }
  return [];
}

/**
 * Fireflies dates arrive as epoch millis, epoch seconds, or an ISO string
 * depending on the field and the plan. Normalise, and return null rather than
 * an Invalid Date that would render as "NaN" three layers up.
 */
function toMillis(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    // Anything below this is seconds, not millis (1e12 ms ≈ 2001).
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return toMillis(n);
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/**
 * `duration` is minutes on some responses and seconds on others. A recruiter
 * meeting is minutes-to-hours, so treat anything over 300 as seconds — a
 * 300-minute meeting is five hours and vanishingly rare, a 300-second one is
 * five minutes and ordinary.
 */
function toMinutes(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n > 300 ? n / 60 : n);
}

async function graphql<T>(query: string, variables: Obj, apiKey: string): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let payload: { data?: unknown; errors?: Array<{ message?: string }> };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    // An HTML error page, a proxy notice, a rate-limit body — whatever it is,
    // it is not the API, and the raw text is more use than "unexpected token".
    throw new Error(
      `Fireflies returned a non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`
    );
  }

  if (payload.errors?.length) {
    // GraphQL reports auth and schema failures as a 200 with an errors array,
    // so this has to be checked before res.ok.
    throw new Error(payload.errors.map((e) => e?.message).filter(Boolean).join("; ") || "Fireflies rejected the query.");
  }
  if (!res.ok) throw new Error(`Fireflies request failed (HTTP ${res.status}).`);
  return (payload.data ?? {}) as T;
}

const LIST_QUERY = `
  query Transcripts($limit: Int, $skip: Int) {
    transcripts(limit: $limit, skip: $skip) {
      id
      title
      date
      duration
      organizer_email
      transcript_url
      participants
      summary {
        overview
        short_summary
        action_items
        keywords
      }
    }
  }
`;

const DETAIL_QUERY = `
  query Transcript($id: String!) {
    transcript(id: $id) {
      id
      title
      date
      duration
      organizer_email
      transcript_url
      participants
      summary {
        overview
        short_summary
        action_items
        keywords
      }
      sentences {
        speaker_name
        text
        start_time
      }
    }
  }
`;

function toMeeting(raw: unknown): Meeting {
  const t = obj(raw);
  const s = obj(t.summary);
  return {
    id: pick(t, "id"),
    title: pick(t, "title", "meeting_title") || "Untitled meeting",
    date: toMillis(t.date ?? t.dateString ?? t.meeting_date),
    durationMins: toMinutes(t.duration),
    organizer: pick(t, "organizer_email", "host_email", "organizer"),
    participants: pickList(t, "participants", "meeting_attendees", "attendees"),
    url: pick(t, "transcript_url", "meeting_link", "audio_url"),
    summary: {
      overview: pick(s, "overview", "short_summary", "bullet_gist", "gist"),
      actionItems: pickList(s, "action_items", "actionItems"),
      keywords: pickList(s, "keywords"),
    },
  };
}

/** Most recent meetings first. Fireflies already returns newest-first; we re-sort to be sure. */
export async function listMeetings(apiKey: string, limit: number): Promise<Meeting[]> {
  const data = await graphql<{ transcripts?: unknown[] }>(
    LIST_QUERY,
    { limit: Math.max(1, Math.min(limit, 50)), skip: 0 },
    apiKey
  );
  const rows = Array.isArray(data.transcripts) ? data.transcripts : [];
  return rows
    .map(toMeeting)
    .filter((m) => m.id)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}

/**
 * One meeting with its full transcript.
 *
 * `includeRaw` returns Fireflies' own object alongside the parsed one. It is
 * how a field that arrives under an unexpected name gets diagnosed without
 * redeploying: the page shows it to admins behind a toggle, and the real key
 * names are then visible. Off unless asked for — the raw object is large and
 * contains the same private speech as the transcript.
 */
export async function getMeeting(
  apiKey: string,
  id: string,
  includeRaw = false
): Promise<{ meeting: Meeting; sentences: Sentence[]; raw?: unknown }> {
  const data = await graphql<{ transcript?: unknown }>(DETAIL_QUERY, { id }, apiKey);
  const t = obj(data.transcript);
  if (!pick(t, "id")) throw new Error("That meeting no longer exists in Fireflies.");

  const rawSentences = Array.isArray(t.sentences) ? t.sentences : [];
  const sentences: Sentence[] = rawSentences.map((r) => {
    const x = obj(r);
    const start = Number(x.start_time ?? x.startTime);
    return {
      speaker: pick(x, "speaker_name", "speaker", "speaker_id") || "Speaker",
      text: pick(x, "text", "raw_text"),
      startSec: Number.isFinite(start) ? Math.round(start) : null,
    };
  });

  return {
    meeting: toMeeting(t),
    sentences: sentences.filter((s) => s.text),
    // The sentence list is the bulk of the payload and is already parsed above,
    // so the raw copy drops it — what matters here is the shape of the header
    // fields, not a second copy of every line.
    ...(includeRaw ? { raw: { ...t, sentences: `[${rawSentences.length} sentences omitted]` } } : {}),
  };
}
