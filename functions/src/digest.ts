// The daily meeting digest: what was recorded on a given day, briefed and
// emailed.
//
// Shared by the scheduled job and the admin "send now" action, so a test send
// exercises exactly the path the 22:30 run will take — a test that proves a
// different code path proves nothing.

import { getFirestore } from "firebase-admin/firestore";
import { listMeetings, getMeeting, Meeting } from "./fireflies.js";
import { briefMeetings, BriefSource, MeetingBrief, LlmConfig } from "./llm.js";
import { sendMail, MailConfig } from "./mail.js";

/** Where the recipient list lives. Managed by admins in Preferences. */
export const SETTINGS_DOC = "appSettings/meetingDigest";

export interface DigestSettings {
  enabled: boolean;
  recipients: string[];
}

export async function readSettings(): Promise<DigestSettings> {
  const snap = await getFirestore().doc(SETTINGS_DOC).get();
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  return {
    // Absent means off. A digest that starts mailing people the moment the
    // code ships, because a default was true, is not a good surprise.
    enabled: d.enabled === true,
    recipients: Array.isArray(d.recipients)
      ? d.recipients.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [],
  };
}

/**
 * How far back to look for a day's meetings.
 *
 * Fireflies' list query is "most recent N", not "on this date", so the window
 * is applied here. 100 is comfortably more than a day's recordings and still
 * one request.
 */
const SCAN_LIMIT = 100;

/** Meetings whose start falls on `dayISO` (yyyy-MM-dd) in `zone`. */
export function onDay(meetings: Meeting[], dayISO: string, zone: string): Meeting[] {
  return meetings.filter((m) => {
    if (!m.date) return false;
    // en-CA formats as yyyy-MM-dd, which is exactly the shape being compared.
    const local = new Date(m.date).toLocaleDateString("en-CA", { timeZone: zone });
    return local === dayISO;
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function list(items: string[]): string {
  return items.map((x) => `<li>${esc(x)}</li>`).join("");
}

function section(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `<h3 style="margin:18px 0 6px;font-size:15px;color:#0b1220">${esc(title)}</h3><ul style="margin:0;padding-left:20px;color:#1f2933">${list(items)}</ul>`;
}

export interface DigestContent {
  subject: string;
  html: string;
  text: string;
  meetingCount: number;
}

/** The "nothing happened" note. Sent so silence never has to be interpreted. */
function emptyDigest(dayLabel: string): DigestContent {
  const line = `No meetings were recorded on ${dayLabel}.`;
  return {
    subject: `Meeting digest — ${dayLabel} — no meetings`,
    meetingCount: 0,
    text: `${line}\n\nThis note is sent daily so that silence means "nothing was recorded", not "the digest is broken".`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;color:#1f2933">
      <p style="font-size:15px">${esc(line)}</p>
      <p style="font-size:12px;color:#5b6577">This note is sent daily so that silence means &ldquo;nothing was recorded&rdquo;, not &ldquo;the digest is broken&rdquo;.</p>
    </div>`,
  };
}

function render(
  dayLabel: string,
  meetings: Meeting[],
  brief: MeetingBrief,
  truncated: number,
  model: string,
  zone: string
): DigestContent {
  const rows = meetings
    .map((m) => {
      const t = m.date
        ? new Date(m.date).toLocaleTimeString("en-US", {
            timeZone: zone,
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      const who = [m.organizer, ...m.participants].filter(Boolean).slice(0, 4).join(", ");
      return `<li style="margin-bottom:4px"><strong>${esc(m.title)}</strong>${
        t ? ` <span style="color:#5b6577">${esc(t)}</span>` : ""
      }${who ? `<br><span style="color:#5b6577;font-size:12px">${esc(who)}</span>` : ""}</li>`;
    })
    .join("");

  const actions = brief.actionItems
    .map((a) => `<li>${esc(a.text)}${a.owner ? ` <span style="color:#5b6577">— ${esc(a.owner)}</span>` : ""}</li>`)
    .join("");

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;color:#1f2933">
    <h2 style="margin:0 0 4px;font-size:18px;color:#0b1220">Meeting digest</h2>
    <p style="margin:0 0 16px;color:#5b6577;font-size:13px">${esc(dayLabel)} &middot; ${meetings.length} meeting${meetings.length === 1 ? "" : "s"}</p>
    ${truncated > 0 ? `<p style="background:#fdf1dc;border:1px solid #f0dcb4;border-radius:6px;padding:8px 10px;font-size:13px;color:#8a6100">${truncated} transcript${truncated === 1 ? " was" : "s were"} too long to include in full; the brief covers what fitted.</p>` : ""}
    ${brief.overview ? `<p style="font-size:15px;line-height:1.55">${esc(brief.overview)}</p>` : ""}
    ${section("Themes", brief.themes)}
    ${section("Decisions", brief.decisions)}
    ${actions ? `<h3 style="margin:18px 0 6px;font-size:15px;color:#0b1220">Action items</h3><ul style="margin:0;padding-left:20px">${actions}</ul>` : ""}
    ${section("Risks and blockers", brief.risks)}
    <h3 style="margin:22px 0 6px;font-size:15px;color:#0b1220">Meetings covered</h3>
    <ul style="margin:0;padding-left:20px">${rows}</ul>
    <p style="margin-top:22px;font-size:12px;color:#5b6577">Written by ${esc(model || "the model")} from the transcripts. It can misread a conversation — check anything you are about to act on against the transcript itself.</p>
  </div>`;

  const text = [
    `Meeting digest — ${dayLabel} — ${meetings.length} meeting(s)`,
    truncated > 0 ? `(${truncated} transcript(s) were truncated to fit.)` : "",
    "",
    brief.overview,
    "",
    brief.themes.length ? `Themes:\n${brief.themes.map((x) => `- ${x}`).join("\n")}` : "",
    brief.decisions.length ? `\nDecisions:\n${brief.decisions.map((x) => `- ${x}`).join("\n")}` : "",
    brief.actionItems.length
      ? `\nAction items:\n${brief.actionItems.map((a) => `- ${a.text}${a.owner ? ` — ${a.owner}` : ""}`).join("\n")}`
      : "",
    brief.risks.length ? `\nRisks and blockers:\n${brief.risks.map((x) => `- ${x}`).join("\n")}` : "",
    `\nMeetings covered:\n${meetings.map((m) => `- ${m.title}`).join("\n")}`,
    `\nWritten by ${model || "the model"} from the transcripts; check anything you act on against the transcript.`,
  ]
    .filter((x) => x !== "")
    .join("\n");

  return {
    subject: `Meeting digest — ${dayLabel} — ${meetings.length} meeting${meetings.length === 1 ? "" : "s"}`,
    html,
    text,
    meetingCount: meetings.length,
  };
}

export interface DigestResult {
  sent: boolean;
  reason?: string;
  meetingCount: number;
  recipients: number;
}

/**
 * Build and send the digest for one calendar day.
 *
 * Returns rather than throws for the ordinary "nothing to do" outcomes — a
 * scheduled job that throws on a quiet Sunday produces an error alert that
 * means nothing, and after enough of those nobody reads the alerts.
 */
export async function runDigest(opts: {
  dayISO: string;
  dayLabel: string;
  zone: string;
  firefliesKey: string;
  llm: LlmConfig;
  mail: MailConfig;
  /** Overrides the stored list. Used by the admin test send. */
  recipientsOverride?: string[];
}): Promise<DigestResult> {
  const settings = await readSettings();
  const recipients = opts.recipientsOverride ?? settings.recipients;

  if (!opts.recipientsOverride && !settings.enabled) {
    return { sent: false, reason: "The digest is switched off.", meetingCount: 0, recipients: 0 };
  }
  if (recipients.length === 0) {
    return { sent: false, reason: "No recipients are configured.", meetingCount: 0, recipients: 0 };
  }

  const all = await listMeetings(opts.firefliesKey, SCAN_LIMIT);
  const todays = onDay(all, opts.dayISO, opts.zone);

  if (todays.length === 0) {
    const content = emptyDigest(opts.dayLabel);
    await sendMail({ to: recipients, ...content }, opts.mail);
    return { sent: true, meetingCount: 0, recipients: recipients.length };
  }

  const sources: BriefSource[] = [];
  for (const m of todays) {
    try {
      const { sentences } = await getMeeting(opts.firefliesKey, m.id);
      sources.push({
        title: m.title,
        date: opts.dayISO,
        participants: [m.organizer, ...m.participants].filter(Boolean).join(", "),
        summary: m.summary.overview,
        transcript: sentences.map((x) => `${x.speaker}: ${x.text}`).join("\n"),
      });
    } catch {
      // One unreadable transcript should not cost the whole digest. Fall back
      // to whatever Fireflies already summarised for that meeting.
      sources.push({
        title: m.title,
        date: opts.dayISO,
        participants: [m.organizer, ...m.participants].filter(Boolean).join(", "),
        summary: m.summary.overview,
        transcript: "",
      });
    }
  }

  const { brief, truncated } = await briefMeetings(sources, opts.llm);
  const content = render(opts.dayLabel, todays, brief, truncated, opts.llm.model, opts.zone);
  await sendMail({ to: recipients, ...content }, opts.mail);

  return { sent: true, meetingCount: todays.length, recipients: recipients.length };
}
