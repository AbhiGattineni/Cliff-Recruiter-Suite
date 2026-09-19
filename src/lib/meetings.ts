// Client side of the Fireflies meetings tab.
//
// Everything goes through the `firefliesMeetings` callable — there is no
// Firestore collection behind this. Transcripts stay in Fireflies and are
// proxied per request, so nothing here needs a rules entry and there is no
// second copy of a private conversation to secure or retain.
//
// Access is admin/manager, enforced server-side. The page checks the role too,
// but only to avoid drawing a door that would open onto an error.

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured, AppError } from "./errors";

export interface MeetingSummary {
  overview: string;
  actionItems: string[];
  keywords: string[];
}

export interface Meeting {
  id: string;
  title: string;
  /** Epoch ms, or null when Fireflies gave an unparseable date. */
  date: number | null;
  durationMins: number | null;
  organizer: string;
  participants: string[];
  url: string;
  summary: MeetingSummary;
}

export interface Sentence {
  speaker: string;
  text: string;
  startSec: number | null;
}

export async function listMeetings(limit = 25): Promise<Meeting[]> {
  ensureConfigured();
  const callable = httpsCallable<{ action: string; limit: number }, { ok: boolean; meetings: Meeting[] }>(
    functions,
    "firefliesMeetings"
  );
  const res = await callable({ action: "list", limit });
  return res.data.meetings ?? [];
}

/**
 * One meeting and its transcript.
 *
 * `raw` asks the function to return Fireflies' own object too. The server
 * honours it for admins only and ignores it otherwise, so passing it is never
 * an escalation — it just comes back absent.
 */
export async function getMeeting(
  id: string,
  raw = false
): Promise<{ meeting: Meeting; sentences: Sentence[]; raw?: unknown }> {
  ensureConfigured();
  const callable = httpsCallable<
    { action: string; id: string; raw: boolean },
    { ok: boolean; meeting: Meeting; sentences: Sentence[]; raw?: unknown }
  >(functions, "firefliesMeetings");
  const res = await callable({ action: "get", id, raw });
  return { meeting: res.data.meeting, sentences: res.data.sentences ?? [], raw: res.data.raw };
}

/** "1h 05m", "45m", or an em dash when Fireflies didn't say. */
export function formatDuration(mins: number | null): string {
  if (!mins || mins <= 0) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
}

/** Position in the recording, as mm:ss — what you'd scrub to in Fireflies. */
export function formatTimecode(startSec: number | null): string {
  if (startSec == null || startSec < 0) return "";
  const m = Math.floor(startSec / 60);
  const s = startSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Briefing
// ---------------------------------------------------------------------------

export interface MeetingBrief {
  overview: string;
  themes: string[];
  decisions: string[];
  actionItems: Array<{ text: string; owner: string }>;
  risks: string[];
}

export interface BriefResult {
  brief: MeetingBrief;
  /** How many of the selected transcripts had to be cut to fit the model. */
  truncated: number;
  meetingCount: number;
  model: string;
}

/** Matches MAX_BRIEF_MEETINGS in functions/src/index.ts. */
export const MAX_BRIEF_MEETINGS = 10;

/**
 * Brief a set of meetings.
 *
 * Only the ids go up. The function fetches the transcripts itself, so the
 * browser never holds more than the one meeting a person has opened, and the
 * text the model reads is the text Fireflies returned rather than whatever the
 * client claimed it was.
 */
export async function briefMeetings(ids: string[]): Promise<BriefResult> {
  ensureConfigured();
  const callable = httpsCallable<
    { action: string; ids: string[] },
    {
      ok: boolean;
      error?: string;
      brief: MeetingBrief;
      truncated: number;
      meetingCount: number;
      model: string;
    }
  >(functions, "ai");
  const res = await callable({ action: "briefMeetings", ids });
  // The LLM cases report a model-side failure as ok:false rather than throwing,
  // so an unhappy answer still carries its reason.
  if (!res.data.ok) throw new AppError(res.data.error || "The briefing couldn't be generated.");
  return {
    brief: res.data.brief,
    truncated: res.data.truncated ?? 0,
    meetingCount: res.data.meetingCount ?? ids.length,
    model: res.data.model ?? "",
  };
}
