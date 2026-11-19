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
import { buildExtras, DigestExtras, NO_EXTRAS } from "./digestExtras.js";
import { fetchReport, probeTotal } from "./ceipal.js";
import { readCache, readCacheMeta, writeCache } from "./ceipalCache.js";
import {
  buildStats,
  listRecruiterNames,
  bandOf,
  pct,
  DigestStats,
  Band,
} from "./recruiterStats.js";

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

// ---- Recruiter activity ----------------------------------------------------

export interface Activity {
  stats: DigestStats;
  /** Where the submission rows came from, for the line under the table. */
  source: "live" | "cache" | "none";
  /** When those rows were pulled from Ceipal. 0 when unknown. */
  fetchedAt: number;
  /** Why there are no numbers, when there are none. */
  problem?: string;
  /**
   * Whether the open-requirements report was actually read.
   *
   * Separate from `source` because it fails separately: the submissions have a
   * Firestore cache to fall back on and this did not, so a Ceipal hiccup used
   * to leave the rest of the table intact and this one card reading a
   * confident "0". A count nobody read must not render as a number.
   */
  activeOk: boolean;
  /** The raw rows behind the numbers, so the extra sections reuse this pull instead of a second one. */
  submissionRows: Record<string, unknown>[];
  activeRows: Record<string, unknown>[];
  /** Every active recruiter in the portal, so people who sent nothing still get a "No" row. */
  staff?: string[];
}

// ---- The team roster ---------------------------------------------------------

/** Roles listed in "By recruiter": bench sales recruiters only. */
const RECRUITER_ROLES = ["benchsales"];

const nameFromEmail = (email: string) =>
  email.split("@")[0].split(/[._-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");

/** Active recruiters' names from the portal. Accounts whose "name" is really an email get one built from it. */
export async function loadStaffNames(): Promise<string[]> {
  try {
    const snap = await getFirestore().collection("userProfiles").where("role", "in", RECRUITER_ROLES).get();
    const names = snap.docs
      .filter((d) => d.data().active !== false)
      .map((d) => {
        const x = d.data();
        const dn = String(x.displayName ?? "").trim();
        return dn && !dn.includes("@") ? dn : nameFromEmail(String(x.email || dn || ""));
      })
      .filter(Boolean);
    return [...new Set(names)];
  } catch {
    return [];
  }
}

const nameTokens = (n: string) => n.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);

/** Same person? Equal names, or every word of the shorter name appears in the longer one ("Ravi Kumar" ~ "Ravi Kumar Reddy"). */
function samePerson(a: string, b: string): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (!x.length || !y.length) return false;
  if (x.join(" ") === y.join(" ")) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && short.every((t) => long.includes(t));
}

/**
 * One row per recruiter: Yes + count, or No.
 *
 * The names are everyone Ceipal has ever recorded as "Submitted by" — whatever
 * the date — plus every bench sales recruiter in the portal. The portal spelling
 * is folded into Ceipal's when they're the same person, so nobody is listed twice.
 */
function teamRows(a: Activity): { name: string; count: number }[] {
  const names: string[] = [];
  for (const n of [...listRecruiterNames(a.submissionRows), ...(a.staff ?? [])]) {
    if (!names.some((m) => samePerson(m, n))) names.push(n);
  }
  const submitters = a.stats.recruiters.filter((r) => !r.idle && r.submissions > 0);
  return names
    .map((name) => {
      const hit = submitters.find((r) => samePerson(r.name, name));
      return { name, count: hit ? hit.submissions : 0 };
    })
    .sort((p, q) => q.count - p.count || p.name.localeCompare(q.name));
}

/**
 * The day's recruiter numbers.
 *
 * Mirrors what `ceipalReport` does for the dashboard rather than inventing a
 * second policy: probe Ceipal's record count, serve the Firestore cache when it
 * has not moved, and only pay for the full pull when it has. A digest that
 * re-pulled fifty thousand submission rows twice a day for numbers the cache
 * already holds would be slower and no fresher.
 *
 * Never throws. The meeting brief is the point of this email; the activity
 * table is an addition to it, and a Ceipal outage should cost the section, not
 * the mail.
 */
/** A saved Ceipal copy older than this is pulled again rather than reused. */
const CACHE_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export async function loadActivity(ceipalPassword: string, dayISO: string): Promise<Activity> {
  const configured = !!ceipalPassword && !ceipalPassword.startsWith("PLACEHOLDER");

  let submissionRows: Record<string, unknown>[] = [];
  let source: Activity["source"] = "none";
  let fetchedAt = 0;
  let problem: string | undefined;

  try {
    const meta = await readCacheMeta("submissions");
    // A daily email must describe the day, so a saved copy from before today is
    // pulled again whatever the row-count probe says. The probe only compares
    // Ceipal's total, and a total that happens not to move — or a probe that
    // fails — once left this digest reading a four-day-old copy without a word.
    const tooOld = !!meta && meta.fetchedAt > 0 && Date.now() - meta.fetchedAt > CACHE_MAX_AGE_MS;
    let unchanged = false;
    if (meta && meta.recordCount > 0 && configured && !tooOld) {
      try {
        unchanged = (await probeTotal("submissions", ceipalPassword)) === (meta.totalAvailable || meta.recordCount);
      } catch (e) {
        // Still serve what we have, but say why — silence here is what hid the
        // stale data before.
        unchanged = true;
        problem = `Couldn't check Ceipal for new submissions (${e instanceof Error ? e.message : String(e)}), so the last saved copy was used.`;
      }
    }

    if (meta && meta.recordCount > 0 && (!configured || (unchanged && !tooOld))) {
      const cached = await readCache("submissions");
      if (cached && cached.rows.length > 0) {
        submissionRows = cached.rows as Record<string, unknown>[];
        source = "cache";
        fetchedAt = cached.fetchedAt;
      }
    }

    if (submissionRows.length === 0 && configured) {
      const data = (await fetchReport("submissions", ceipalPassword, 0)) as {
        result?: unknown[];
        total_available?: number;
      };
      const rows = Array.isArray(data.result) ? data.result : [];
      // Re-cache, so the next dashboard visitor does not pay for this again.
      await writeCache("submissions", rows, Number(data.total_available) || rows.length);
      submissionRows = rows as Record<string, unknown>[];
      source = "live";
      fetchedAt = Date.now();
    }
  } catch (e) {
    problem = `Ceipal didn't answer (${e instanceof Error ? e.message : String(e)}), so the last saved copy was used.`;
    // Anything stale beats nothing.
    try {
      const cached = await readCache("submissions");
      if (cached && cached.rows.length > 0) {
        submissionRows = cached.rows as Record<string, unknown>[];
        source = "cache";
        fetchedAt = cached.fetchedAt;
      }
    } catch {
      /* leave it empty; the section will say so */
    }
  }

  // Open requirements: a small report, read live and then cached the same way
  // the submissions are. The cache is what keeps one bad Ceipal call from
  // turning this card into a "0" — it falls back to the last good answer and
  // says how old it is, and only when there has never been one does the card
  // admit it has no number.
  let activeRows: Record<string, unknown>[] = [];
  let activeOk = false;
  if (configured) {
    try {
      const data = (await fetchReport("active_jobs", ceipalPassword, 0)) as {
        result?: unknown[];
        total_available?: number;
      };
      activeRows = (Array.isArray(data.result) ? data.result : []) as Record<string, unknown>[];
      activeOk = true;
      await writeCache("active_jobs", activeRows, Number(data.total_available) || activeRows.length);
    } catch (e) {
      if (!problem) problem = e instanceof Error ? e.message : String(e);
    }
  } else if (!problem) {
    problem = "Ceipal isn't configured for this function.";
  }

  if (!activeOk) {
    try {
      const cached = await readCache("active_jobs");
      if (cached && cached.rows.length > 0) {
        activeRows = cached.rows as Record<string, unknown>[];
        activeOk = true;
        problem = `${problem ?? "Ceipal did not answer."} Showing the last cached count instead.`;
      }
    } catch {
      /* no cache either; the card will say so */
    }
  }

  if (submissionRows.length === 0 && !activeOk) {
    return {
      stats: buildStats([], [], dayISO),
      source: "none",
      fetchedAt: 0,
      activeOk: false,
      problem: problem ?? (configured ? "Ceipal returned nothing." : "Ceipal isn't configured."),
      submissionRows: [],
      activeRows: [],
    };
  }

  return { stats: buildStats(submissionRows, activeRows, dayISO), source, fetchedAt, problem, activeOk, submissionRows, activeRows };
}

// ---- Colours ---------------------------------------------------------------
//
// Inline, opaque and hard-coded. Email clients strip <style> blocks and CSS
// variables, and several render a dark background behind light text without
// recolouring the text, so every swatch below pairs a light fill with its own
// dark ink rather than relying on inheritance.

const BAND_STYLE: Record<Band, { bg: string; border: string; ink: string }> = {
  good: { bg: "#e7f6ec", border: "#bfe3cb", ink: "#1b5e34" },
  ok: { bg: "#fdf3da", border: "#f0dcb4", ink: "#8a6100" },
  bad: { bg: "#fdeaea", border: "#f3c9c9", ink: "#99201f" },
  none: { bg: "#f1f3f6", border: "#dfe3ea", ink: "#5b6577" },
};

function statCard(label: string, value: string, band: Band = "none"): string {
  const c = BAND_STYLE[band];
  return `<td style="padding:4px" width="33%" valign="top">
    <div style="background:${c.bg};border:1px solid ${c.border};border-radius:8px;padding:10px 12px">
      <div style="font-size:22px;font-weight:700;color:${c.ink};line-height:1.1">${esc(value)}</div>
      <div style="font-size:11px;color:${c.ink};opacity:0.85;margin-top:2px;text-transform:uppercase;letter-spacing:0.03em">${esc(label)}</div>
    </div>
  </td>`;
}

const TH = `style="text-align:left;padding:6px 8px;font-size:11px;color:#5b6577;text-transform:uppercase;letter-spacing:0.03em;border-bottom:1px solid #dfe3ea"`;
const TD = `style="padding:6px 8px;font-size:13px;color:#1f2933;border-bottom:1px solid #eef1f5"`;

export function renderActivityHtml(a: Activity, dayLabel: string): string {
  const s = a.stats;

  if (a.source === "none") {
    return `<h3 style="margin:0 0 6px;font-size:15px;color:#0b1220">Recruiter activity</h3>
      <p style="font-size:13px;color:#8a6100;background:#fdf3da;border:1px solid #f0dcb4;border-radius:6px;padding:8px 10px">
        No figures this time — ${esc(a.problem ?? "the Ceipal report could not be read.")}
      </p>`;
  }

  // Every recruiter on the team gets a row, including the people who sent
  // nothing — that is the line this table exists to show. Yes rows first.
  const team = teamRows(a);
  const rows = team
    .map((r) =>
      r.count === 0
        ? `<tr><td ${TD}>${esc(r.name)}</td><td ${TD} align="right"><span style="color:#99201f;font-weight:600">No</span></td></tr>`
        : `<tr><td ${TD}><strong>${esc(r.name)}</strong></td><td ${TD} align="right"><span style="color:#1b5e34;font-weight:600">Yes</span> &mdash; <strong>${r.count}</strong></td></tr>`
    )
    .join("");

  const when =
    a.fetchedAt > 0
      ? `Ceipal data pulled ${a.source === "live" ? "just now" : `at ${new Date(a.fetchedAt).toISOString().replace("T", " ").slice(0, 16)} UTC`}`
      : "Ceipal data of unknown age";

  const warn = !a.activeOk
    ? `<p style="margin:0 0 10px;font-size:13px;color:#8a6100;background:#fdf3da;border:1px solid #f0dcb4;border-radius:6px;padding:8px 10px">
        The open-requirements count could not be read, so it shows as &mdash; rather than as a number.
        ${esc(a.problem ?? "Ceipal did not answer.")}
      </p>`
    : "";

  return `<h3 style="margin:0 0 8px;font-size:15px;color:#0b1220">Recruiter activity</h3>
  ${warn}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 6px">
    <tr>
      ${statCard("Open requirements", a.activeOk ? String(s.activeRequirements) : "—")}
      ${statCard("Submissions today", String(s.submissions))}
      ${statCard(
        a.activeOk ? "On open requirements" : "On open — unknown",
        a.activeOk ? String(s.submissionsOnActive) : "—",
        a.activeOk && s.submissions > 0 ? bandOf(pct(s.submissionsOnActive, s.submissions)) : "none"
      )}
    </tr>
  </table>

  <h4 style="margin:20px 0 6px;font-size:13px;color:#0b1220">Recruiters</h4>
  ${
    rows
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>
      <th ${TH}>Recruiter</th>
      <th ${TH} align="right">Submitted?</th>
    </tr>${rows}
  </table>`
      : `<p style="font-size:13px;color:#5b6577;margin:0">No recruiter names were found in Ceipal&rsquo;s submissions report.</p>`
  }

  <p style="margin:10px 0 0;font-size:11px;color:#5b6577">
    Every recruiter in Ceipal&rsquo;s submissions report is listed, plus the portal&rsquo;s bench sales recruiters; &ldquo;No&rdquo; means nothing was submitted on ${esc(dayLabel)}.
    ${esc(when)}.${a.problem ? ` Note: ${esc(a.problem)}` : ""}
  </p>`;
}

export function renderActivityText(a: Activity, dayLabel: string): string {
  const s = a.stats;
  if (a.source === "none") {
    return `Recruiter activity — no figures this time (${a.problem ?? "Ceipal report unreadable"}).`;
  }
  const lines = [
    `Recruiter activity — ${dayLabel}`,
    `- Open requirements: ${a.activeOk ? s.activeRequirements : "unknown (could not be read)"}`,
    `- Submissions today: ${s.submissions}${a.activeOk ? ` (${s.submissionsOnActive} on open requirements)` : ""}`,
    "",
    "Recruiters (submitted?):",
  ];
  const team = teamRows(a);
  if (team.length === 0) lines.push("  (no recruiter names found in Ceipal)");
  for (const r of team) lines.push(`  ${r.name}: ${r.count ? `Yes — ${r.count}` : "No"}`);
  if (a.problem) lines.push("", `Note: ${a.problem}`);
  return lines.join("\n");
}

export interface DigestContent {
  subject: string;
  html: string;
  text: string;
  meetingCount: number;
}

/**
 * The "no meetings" note.
 *
 * Still carries the recruiter numbers: a quiet day for calls is not a quiet day
 * for the desk, and the activity table is the half of this mail that does not
 * depend on anyone having recorded anything.
 */
function emptyDigest(dayLabel: string, activity: Activity, extras: DigestExtras = NO_EXTRAS): DigestContent {
  const line = `No meetings were recorded on ${dayLabel}.`;
  return {
    subject: `Meeting digest — ${dayLabel} — no meetings`,
    meetingCount: 0,
    text: `${renderActivityText(activity, dayLabel)}${extras.text}\n\n${line}\n\nThis note is sent daily so that silence means "nothing was recorded", not "the digest is broken".`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;color:#1f2933">
      ${renderActivityHtml(activity, dayLabel)}
      ${extras.html}
      <hr style="border:none;border-top:1px solid #dfe3ea;margin:26px 0 0">
      <p style="font-size:15px;margin-top:22px">${esc(line)}</p>
      <p style="font-size:12px;color:#5b6577">This note is sent daily so that silence means &ldquo;nothing was recorded&rdquo;, not &ldquo;the digest is broken&rdquo;.</p>
    </div>`,
  };
}

export function render(
  dayLabel: string,
  meetings: Meeting[],
  brief: MeetingBrief,
  truncated: number,
  model: string,
  zone: string,
  activity: Activity,
  extras: DigestExtras = NO_EXTRAS
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
    ${renderActivityHtml(activity, dayLabel)}
    ${extras.html}
    <hr style="border:none;border-top:1px solid #dfe3ea;margin:26px 0 0">
    <h3 style="margin:22px 0 6px;font-size:15px;color:#0b1220">What was discussed</h3>
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
    `\n${renderActivityText(activity, dayLabel)}${extras.text}`,
    "\nWhat was discussed\n",
    truncated > 0 ? `(${truncated} transcript(s) were truncated to fit.)` : "",
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

export interface BuildOpts {
  dayISO: string;
  dayLabel: string;
  zone: string;
  firefliesKey: string;
  llm: LlmConfig;
  ceipalPassword: string;
}

/**
 * Compose one day's digest, without deciding whether to send it.
 *
 * Split out so the Preferences preview renders the identical bytes the 22:30
 * job will mail. A preview that assembled the email a second way would be a
 * picture of a different email.
 */
export async function buildDigest(opts: BuildOpts): Promise<DigestContent> {
  // In parallel: they share no state, and the Ceipal pull is the slow one.
  const [activity, meetings, staff] = await Promise.all([
    loadActivity(opts.ceipalPassword, opts.dayISO),
    opts.firefliesKey
      ? listMeetings(opts.firefliesKey, SCAN_LIMIT).catch(() => [] as Meeting[])
      : Promise.resolve([] as Meeting[]),
    loadStaffNames(),
  ]);
  activity.staff = staff;

  // Leaves, timesheets, requirements and submissions. Never throws: a section
  // that can't be read says so in the mail instead of costing the whole digest.
  const extras = await buildExtras(opts.dayISO, opts.zone, activity.submissionRows, activity.activeRows, activity.activeOk, {
    ceipalPassword: opts.ceipalPassword,
    staff,
  });

  const todays = onDay(meetings, opts.dayISO, opts.zone);
  if (todays.length === 0) return emptyDigest(opts.dayLabel, activity, extras);

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

  // The AI brief is a nice-to-have. If the model can't be reached (out of
  // credits, down, a bad key), send the email anyway with Fireflies' own
  // per-meeting summaries, and say why at the top of that section.
  try {
    const { brief, truncated } = await briefMeetings(sources, opts.llm);
    return render(opts.dayLabel, todays, brief, truncated, opts.llm.model, opts.zone, activity, extras);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const short = /\b402\b|credit|subscribe/i.test(why) ? "the AI service is out of credits" : why.slice(0, 160);
    const fallback: MeetingBrief = {
      overview: `The AI summary couldn't be written today (${short}), so these are Fireflies' own summaries of each meeting.`,
      themes: sources.map((x) => `${x.title}: ${x.summary?.trim() || "no summary from Fireflies"}`),
      decisions: [],
      actionItems: [],
      risks: [],
    };
    return render(opts.dayLabel, todays, fallback, 0, "Fireflies", opts.zone, activity, extras);
  }
}

/**
 * Build and send the digest for one calendar day.
 *
 * Returns rather than throws for the ordinary "nothing to do" outcomes — a
 * scheduled job that throws on a quiet Sunday produces an error alert that
 * means nothing, and after enough of those nobody reads the alerts.
 */
export async function runDigest(
  opts: BuildOpts & {
    mail: MailConfig;
    /** Overrides the stored list. Used by the admin test send. */
    recipientsOverride?: string[];
  }
): Promise<DigestResult> {
  const settings = await readSettings();
  const recipients = opts.recipientsOverride ?? settings.recipients;

  if (!opts.recipientsOverride && !settings.enabled) {
    return { sent: false, reason: "The digest is switched off.", meetingCount: 0, recipients: 0 };
  }
  if (recipients.length === 0) {
    return { sent: false, reason: "No recipients are configured.", meetingCount: 0, recipients: 0 };
  }

  const content = await buildDigest(opts);
  await sendMail({ to: recipients, ...content }, opts.mail);

  return { sent: true, meetingCount: content.meetingCount, recipients: recipients.length };
}