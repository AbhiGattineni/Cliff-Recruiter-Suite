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
import { ensureConfigured } from "./errors";

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
