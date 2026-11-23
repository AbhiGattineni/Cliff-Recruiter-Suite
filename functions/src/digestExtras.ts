// The digest's extra sections: leaves, timesheets, requirements, submissions.
//
// Each one is switched on or off in Preferences (appSettings/digestSections),
// and each one is built independently: a section that can't be read says so in
// the mail rather than costing the meeting brief or the other sections.
//
// Detail is written as compact lines grouped under a heading (a recruiter, a
// person, a requirement) rather than as wide tables. Email HTML has to carry an
// inline style on every element, so a table cell costs ~150 characters before
// it says anything; a line in a list costs a few. That is what lets this fit
// several times more detail into the same email.
//
// The whole block has a size budget. EmailJS rejects an oversized parameter and
// the digest falls back to plain text past ~45k characters, so if a very busy
// day overshoots, the lists are rebuilt shorter (and say "…and N more") until
// the email fits — a shorter list beats an email that arrives as raw text.

import { getFirestore } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import { listSubmissions, parseTs, SubmissionLine } from "./recruiterStats.js";
import { benchDay, BenchDay, BenchLine, loadBench, BenchLoad } from "./benchDigest.js";

export const SECTIONS_DOC = "appSettings/digestSections";

export interface DigestSections {
  leaves: boolean;
  timesheets: boolean;
  requirements: boolean;
  submissions: boolean;
  bench: boolean;
}

export interface DigestExtras {
  html: string;
  text: string;
}

export const NO_EXTRAS: DigestExtras = { html: "", text: "" };

/** All four are on unless an admin turned one off. */
export async function readSections(): Promise<DigestSections> {
  try {
    const d = ((await getFirestore().doc(SECTIONS_DOC).get()).data() ?? {}) as Record<string, unknown>;
    return {
      leaves: d.leaves !== false,
      timesheets: d.timesheets !== false,
      requirements: d.requirements !== false,
      submissions: d.submissions !== false,
      bench: d.bench !== false,
    };
  } catch {
    return { leaves: true, timesheets: true, requirements: true, submissions: true, bench: true };
  }
}

// Who is expected to fill a daily timesheet. Admins and managers are left out:
// the Team Dashboard chases recruiters, and so does this.
const TIMESHEET_ROLES = ["employee", "benchsales"];

/** Characters of HTML these sections may add before lists are shortened. */
const HTML_BUDGET = 30_000;

/** Full-length caps. Multiplied by 1, then 0.5, then 0.25 until the HTML fits the budget. */
const BASE_CAPS = {
  leaves: 30,
  timesheetPeople: 40,
  missing: 60,
  postedReqs: 25,
  openReqs: 40,
  noSubs: 25,
  submissions: 100,
  benchLines: 60,
};
type Caps = typeof BASE_CAPS;
const scaled = (f: number): Caps =>
  Object.fromEntries(Object.entries(BASE_CAPS).map(([k, v]) => [k, Math.max(3, Math.floor(v * f))])) as Caps;

// ---- Layout -----------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const H3 = `style="margin:28px 0 8px;font-size:16px;color:#0b1220"`;
const H4 = `style="margin:14px 0 4px;font-size:13px;color:#0b1220"`;
const UL = `style="margin:4px 0 0;padding-left:18px;font-size:13px;line-height:1.55;color:#1f2933"`;
const NOTE = `style="margin:6px 0 0;font-size:12px;color:#5b6577"`;
const WARN = `style="margin:0 0 8px;font-size:13px;color:#8a6100;background:#fdf3da;border:1px solid #f0dcb4;border-radius:6px;padding:8px 10px"`;
// <font color> is the shortest way to colour text that every mail client honours,
// and length matters here: it's repeated on every line of every list.
const MUTED = (t: string) => (t ? ` <font color="#5b6577">${esc(t)}</font>` : "");
const PILL = (t: string, bg = "#eef1f5", ink = "#3b4252") =>
  t ? ` <span style="background:${bg};color:${ink};border-radius:999px;padding:0 6px;font-size:11px;white-space:nowrap">${esc(t)}</span>` : "";

const ul = (items: string[]) => (items.length ? `<ul ${UL}>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");
const more = (total: number, shown: number, where = "the portal") =>
  total > shown ? `<p ${NOTE}>…and ${total - shown} more — see ${esc(where)} for the full list.</p>` : "";
const join = (parts: (string | false | null | undefined)[], sep = " · ") => parts.filter(Boolean).join(sep);

function stats(cards: [string, string][]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 4px"><tr>${cards
    .map(
      ([l, v]) => `<td style="padding:3px" valign="top"><div style="background:#f1f3f6;border:1px solid #dfe3ea;border-radius:8px;padding:7px 12px">
    <div style="font-size:19px;font-weight:700;color:#0b1220;line-height:1.1">${esc(v)}</div>
    <div style="font-size:11px;color:#5b6577;margin-top:2px;text-transform:uppercase;letter-spacing:0.03em">${esc(l)}</div></div></td>`
    )
    .join("")}</tr></table>`;
}

const failed = (title: string, e: unknown): DigestExtras => {
  const why = e instanceof Error ? e.message : String(e);
  return {
    html: `<h3 ${H3}>${esc(title)}</h3><p ${WARN}>This section couldn't be built this time — ${esc(why)}</p>`,
    text: `\n\n${title}\n(couldn't be built this time: ${why})`,
  };
};

const txtMore = (total: number, shown: number) => (total > shown ? [`   …and ${total - shown} more`] : []);

// ---- Leaves -----------------------------------------------------------------

const LEAVE_TYPE: Record<string, string> = { half: "Half day", full: "Full day", multi: "Multiple days" };

interface LeaveRow {
  uid: string;
  name: string;
  email: string;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
  reason: string;
  requestedDay: string;
  requestedAt: Date | null;
  decidedBy: string;
  decidedDay: string;
  note: string;
}

const dayCount = (l: LeaveRow) =>
  l.type === "Half day" ? 0.5 : Math.round(DateTime.fromISO(l.endDate).diff(DateTime.fromISO(l.startDate), "days").days) + 1;
const dates = (l: LeaveRow) => (l.startDate === l.endDate ? l.startDate : `${l.startDate} → ${l.endDate}`);

async function loadLeaves(dayISO: string, zone: string): Promise<LeaveRow[]> {
  // Anything ending on or after the day: who is off, what's coming up, every
  // pending request that still matters, and decisions made on the day.
  const snap = await getFirestore().collection("leaveRequests").where("endDate", ">=", dayISO).get();
  const local = (v: unknown) => {
    const d = (v as { toDate?: () => Date } | undefined)?.toDate?.();
    return d ? d.toLocaleDateString("en-CA", { timeZone: zone }) : "";
  };
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      uid: String(x.uid ?? ""),
      name: String(x.displayName || x.email || "Someone"),
      email: String(x.email ?? ""),
      type: LEAVE_TYPE[String(x.leaveType)] ?? String(x.leaveType ?? ""),
      startDate: String(x.startDate ?? ""),
      endDate: String(x.endDate ?? ""),
      status: String(x.status ?? "pending"),
      reason: String(x.reason ?? ""),
      requestedDay: local(x.requestedAt),
      requestedAt: (x.requestedAt as { toDate?: () => Date } | undefined)?.toDate?.() ?? null,
      decidedBy: String(x.decidedByName || x.decidedByEmail || ""),
      decidedDay: local(x.decidedAt),
      note: String(x.decisionNote ?? ""),
    };
  });
}

function leavesSection(all: LeaveRow[], dayISO: string, caps: Caps): DigestExtras {
  const day = DateTime.fromISO(dayISO);
  const weekAhead = day.plus({ days: 7 }).toISODate() ?? dayISO;
  const onLeave = all.filter((l) => l.status === "approved" && l.startDate <= dayISO && l.endDate >= dayISO);
  const pending = all.filter((l) => l.status === "pending").sort((a, b) => a.startDate.localeCompare(b.startDate));
  const upcoming = all
    .filter((l) => l.status === "approved" && l.startDate > dayISO && l.startDate <= weekAhead)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const decided = all.filter((l) => l.decidedDay === dayISO && l.status !== "pending");
  const requested = all.filter((l) => l.requestedDay === dayISO);

  const waiting = (l: LeaveRow) => {
    if (!l.requestedAt) return "";
    const d = Math.floor(day.endOf("day").diff(DateTime.fromJSDate(l.requestedAt), "days").days);
    return d <= 0 ? "asked today" : `waiting ${d} day${d === 1 ? "" : "s"}`;
  };
  const back = (l: LeaveRow) => {
    let d = DateTime.fromISO(l.endDate).plus({ days: 1 });
    while (d.weekday >= 6) d = d.plus({ days: 1 });
    return `back ${d.toFormat("ccc d LLL")}`;
  };
  const days = (l: LeaveRow) => `${dayCount(l)} day${dayCount(l) === 1 ? "" : "s"}`;

  const h = {
    onLeave: (l: LeaveRow) => `<b>${esc(l.name)}</b> — ${esc(l.type)}, ${esc(dates(l))}${MUTED(join([days(l), back(l), l.reason && `“${l.reason}”`, l.decidedBy && `approved by ${l.decidedBy}`]))}`,
    pending: (l: LeaveRow) => `<b>${esc(l.name)}</b> — ${esc(l.type)}, ${esc(dates(l))}${PILL(waiting(l), "#fdf3da", "#8a6100")}${MUTED(join([days(l), l.reason && `“${l.reason}”`]))}`,
    upcoming: (l: LeaveRow) => `<b>${esc(l.name)}</b> — ${esc(l.type)}, ${esc(dates(l))}${MUTED(join([days(l), l.reason && `“${l.reason}”`]))}`,
    decided: (l: LeaveRow) =>
      `<b>${esc(l.name)}</b> — ${esc(dates(l))}${l.status === "approved" ? PILL("Approved", "#e7f6ec", "#1b5e34") : PILL("Rejected", "#fdeaea", "#99201f")}${MUTED(join([l.decidedBy && `by ${l.decidedBy}`, l.note && `note: “${l.note}”`]))}`,
  };
  const block = (title: string, list: LeaveRow[], line: (l: LeaveRow) => string, empty?: string) =>
    list.length
      ? `<h4 ${H4}>${esc(title)} (${list.length})</h4>${ul(list.slice(0, caps.leaves).map(line))}${more(list.length, caps.leaves, "Timesheets → Leave")}`
      : empty
        ? `<h4 ${H4}>${esc(title)}</h4><p ${NOTE}>${esc(empty)}</p>`
        : "";

  const html = `<h3 ${H3}>🏖️ Leaves</h3>
    ${stats([["On leave", String(onLeave.length)], ["Waiting for a decision", String(pending.length)], ["Requested today", String(requested.length)], ["Decided today", String(decided.length)]])}
    ${block("On leave", onLeave, h.onLeave, "Nobody was on approved leave.")}
    ${block("Waiting for a decision", pending, h.pending, "No leave requests are waiting.")}
    ${block("Decided today", decided, h.decided)}
    ${block("Coming up in the next 7 days", upcoming, h.upcoming)}`;

  const t = (title: string, list: LeaveRow[], f: (l: LeaveRow) => string) =>
    list.length ? [`  ${title} (${list.length}):`, ...list.slice(0, caps.leaves).map((l) => `   - ${f(l)}`), ...txtMore(list.length, caps.leaves)] : [];
  const text = [
    "\n\nLEAVES",
    `On leave: ${onLeave.length} · waiting for a decision: ${pending.length} · requested today: ${requested.length} · decided today: ${decided.length}`,
    ...t("On leave", onLeave, (l) => join([`${l.name}: ${l.type}, ${dates(l)}`, days(l), back(l), l.reason && `"${l.reason}"`])),
    ...t("Waiting for a decision", pending, (l) => join([`${l.name}: ${l.type}, ${dates(l)}`, waiting(l), l.reason && `"${l.reason}"`])),
    ...t("Decided today", decided, (l) => join([`${l.name}: ${dates(l)} ${l.status.toUpperCase()}`, l.decidedBy && `by ${l.decidedBy}`, l.note && `note: "${l.note}"`])),
    ...t("Coming up in the next 7 days", upcoming, (l) => join([`${l.name}: ${l.type}, ${dates(l)}`, days(l)])),
  ].join("\n");
  return { html, text };
}

// ---- Timesheets -------------------------------------------------------------

interface SheetData {
  offDay: string;
  filled: { uid: string; name: string; hours: number; jobs: { title: string; client: string; code: string; hours: number }[]; bench: { consultant: string; vendor: string; hours: number }[]; note: string; filledBy: string }[];
  missing: string[];
  due: number;
  away: string[];
}

async function loadTimesheets(dayISO: string, leaves: LeaveRow[] | null): Promise<SheetData> {
  const db = getFirestore();
  const [entries, people, holiday] = await Promise.all([
    db.collection("timesheetEntries").where("date", "==", dayISO).get(),
    db.collection("userProfiles").where("role", "in", TIMESHEET_ROLES).get(),
    db.collection("holidays").doc(dayISO).get(),
  ]);
  const weekday = DateTime.fromISO(dayISO).weekday; // 6 = Sat, 7 = Sun
  const offDay = weekday >= 6 ? "a weekend" : holiday.exists ? `a company holiday (${String(holiday.data()?.name ?? "")})` : "";

  const filled = entries.docs
    .map((d) => {
      const x = d.data();
      const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
      return {
        uid: String(x.uid ?? ""),
        name: String(x.displayName || x.email || "Someone"),
        hours: Number(x.hours) || 0,
        jobs: arr(x.jobs).map((j) => ({ title: String(j.jobTitle ?? ""), client: String(j.client ?? ""), code: String(j.jobCode ?? ""), hours: Number(j.hours) || 0 })),
        bench: arr(x.bench).map((b) => ({ consultant: String(b.consultant ?? ""), vendor: String(b.vendor ?? ""), hours: Number(b.hours) || 0 })),
        note: String(x.workedOn ?? ""),
        filledBy: String(x.filledByName ?? ""),
      };
    })
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));

  // On a full day of approved leave you aren't expected to file. A half day still counts.
  const awayIds = new Set(
    (leaves ?? []).filter((l) => l.status === "approved" && l.type !== "Half day" && l.startDate <= dayISO && l.endDate >= dayISO).map((l) => l.uid)
  );
  const filledIds = new Set(filled.map((f) => f.uid));
  const expected = people.docs
    .map((d) => ({ uid: d.id, name: String(d.data().displayName || d.data().email || ""), active: d.data().active !== false }))
    .filter((p) => p.active && p.name);
  const away = expected.filter((p) => awayIds.has(p.uid)).map((p) => p.name);
  const missing = offDay ? [] : expected.filter((p) => !filledIds.has(p.uid) && !awayIds.has(p.uid)).map((p) => p.name).sort();
  const due = offDay ? 0 : expected.filter((p) => !awayIds.has(p.uid)).length;
  return { offDay, filled, missing, due, away };
}

function timesheetsSection(d: SheetData, caps: Caps): DigestExtras {
  const total = Math.round(d.filled.reduce((s, f) => s + f.hours, 0) * 10) / 10;
  const avg = d.filled.length ? Math.round((total / d.filled.length) * 10) / 10 : 0;
  const filledCount = d.offDay ? String(d.filled.length) : `${Math.min(d.filled.length, d.due)} of ${d.due}`;
  const h = (n: number) => `${Math.round(n * 10) / 10}h`;

  const personLine = (f: SheetData["filled"][number]) => {
    const work = [
      ...f.jobs.map((j) => `${j.title || j.code}${j.client ? ` (${j.client})` : ""} ${h(j.hours)}`),
      ...f.bench.map((b) => `bench: ${b.consultant}${b.vendor ? ` → ${b.vendor}` : ""} ${h(b.hours)}`),
    ];
    return `<b>${esc(f.name)}</b> — ${h(f.hours)}${work.length ? `: ${esc(work.join(", "))}` : ""}${MUTED(join([f.note && `“${f.note}”`, f.filledBy && `filled by ${f.filledBy}`]))}`;
  };

  const html = `<h3 ${H3}>⏱️ Timesheets</h3>
    ${d.offDay ? `<p ${NOTE}>This was ${esc(d.offDay)}, so nobody was expected to file.</p>` : ""}
    ${stats([["Filled", filledCount], ["Not filled", d.offDay ? "—" : String(d.missing.length)], ["Hours logged", String(total)], ["Average per person", `${avg}h`]])}
    ${
      d.missing.length
        ? `<h4 ${H4}>Not filled yet (${d.missing.length})</h4><p style="margin:0;font-size:13px;color:#99201f;line-height:1.6">${d.missing
            .slice(0, caps.missing)
            .map(esc)
            .join(" · ")}</p>${more(d.missing.length, caps.missing, "the Team Dashboard")}`
        : d.offDay
          ? ""
          : `<p ${NOTE}>Everyone expected filled their timesheet.</p>`
    }
    ${d.filled.length ? `<h4 ${H4}>What people logged (${d.filled.length})</h4>${ul(d.filled.slice(0, caps.timesheetPeople).map(personLine))}${more(d.filled.length, caps.timesheetPeople, "the Team Dashboard")}` : ""}
    ${d.away.length ? `<p ${NOTE}>On approved leave, not counted as missing: ${esc(d.away.join(", "))}.</p>` : ""}`;

  const text = [
    "\n\nTIMESHEETS",
    d.offDay ? `This was ${d.offDay}; nobody was expected to file.` : `Filled: ${filledCount} · hours logged: ${total} · average ${avg}h`,
    ...(d.missing.length ? [`Not filled: ${d.missing.slice(0, caps.missing).join(", ")}${d.missing.length > caps.missing ? ` …and ${d.missing.length - caps.missing} more` : ""}`] : []),
    ...(d.filled.length
      ? [
          "  What people logged:",
          ...d.filled.slice(0, caps.timesheetPeople).map(
            (f) =>
              `   - ${f.name}: ${h(f.hours)}${f.jobs.length || f.bench.length ? ` — ${[...f.jobs.map((j) => `${j.title || j.code}${j.client ? ` (${j.client})` : ""} ${h(j.hours)}`), ...f.bench.map((b) => `bench ${b.consultant} ${h(b.hours)}`)].join(", ")}` : ""}${f.note ? ` "${f.note}"` : ""}`
          ),
          ...txtMore(d.filled.length, caps.timesheetPeople),
        ]
      : []),
    ...(d.away.length ? [`On approved leave: ${d.away.join(", ")}`] : []),
  ].join("\n");
  return { html, text };
}

// ---- Requirements -----------------------------------------------------------

const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => Number(String(v ?? "").replace(/[^0-9-]/g, "")) || 0;

interface Req {
  code: string;
  title: string;
  client: string;
  location: string;
  positions: number;
  subs: number;
  clientSubs: number;
  interviews: number;
  placements: number;
  manager: string;
  payRate: string;
  remote: string;
  status: string;
  created: DateTime | null;
}

function requirementsSection(activeRows: Record<string, unknown>[], dayISO: string, activeOk: boolean, caps: Caps): DigestExtras {
  if (!activeOk) {
    return {
      html: `<h3 ${H3}>📋 Requirements</h3><p ${WARN}>The open-requirements report couldn't be read, so there's no list this time.</p>`,
      text: "\n\nREQUIREMENTS\n(the open-requirements report couldn't be read)",
    };
  }
  const reqs: Req[] = activeRows.map((r) => ({
    code: s(r.JobCode),
    title: s(r.JobTitle),
    client: s(r.Client),
    location: s(r.Location) || s(r.States),
    positions: n(r.NumberOfPositions),
    subs: n(r["#OfSubmissions"]),
    clientSubs: n(r["#OfClientSub"]),
    interviews: n(r["#OfInterviews"]),
    placements: n(r["#OfPlacements"]),
    manager: s(r.RecruitmentManager),
    payRate: s(r["PayRate/Salary"]),
    remote: s(r.RemoteJob),
    status: s(r.JobStatus),
    created: parseTs(r.JobCreated),
  }));
  const day = DateTime.fromISO(dayISO);
  const age = (r: Req) => (r.created ? Math.max(0, Math.floor(day.diff(r.created.startOf("day"), "days").days)) : null);
  const ageText = (r: Req) => {
    const a = age(r);
    return a == null ? "" : a === 0 ? "posted today" : `open ${a} day${a === 1 ? "" : "s"}`;
  };
  const isRemote = (r: Req) => /^(y|yes|true|remote)/i.test(r.remote);

  const posted = reqs.filter((r) => r.created?.toFormat("yyyy-MM-dd") === dayISO);
  // Posted today is listed above; "waiting" means open since an earlier day with nothing sent.
  const noSubs = reqs.filter((r) => r.subs === 0 && r.created?.toFormat("yyyy-MM-dd") !== dayISO).sort((a, b) => (a.created?.toMillis() ?? 0) - (b.created?.toMillis() ?? 0));
  const others = reqs
    .filter((r) => r.subs > 0 && r.created?.toFormat("yyyy-MM-dd") !== dayISO)
    .sort((a, b) => (b.created?.toMillis() ?? 0) - (a.created?.toMillis() ?? 0));
  const totals = reqs.reduce(
    (t, r) => ({ positions: t.positions + r.positions, subs: t.subs + r.subs, interviews: t.interviews + r.interviews, placements: t.placements + r.placements }),
    { positions: 0, subs: 0, interviews: 0, placements: 0 }
  );

  const funnel = (r: Req) =>
    join([`${r.subs} sub${r.subs === 1 ? "" : "s"}`, r.clientSubs ? `${r.clientSubs} to client` : "", r.interviews ? `${r.interviews} interview${r.interviews === 1 ? "" : "s"}` : "", r.placements ? `${r.placements} placed` : ""]);
  const line = (r: Req, withFunnel = true) =>
    `<b>${esc(r.title || r.code)}</b> — ${esc(r.client || "?")}${MUTED(
      join([r.code && r.title ? `[${r.code}]` : "", isRemote(r) ? "Remote" : "", r.location, r.positions ? `${r.positions} pos` : "", r.payRate && `pay ${r.payRate}`, r.manager && `mgr ${r.manager}`, ageText(r), withFunnel && funnel(r)])
    )}`;
  const txt = (r: Req, withFunnel = true) =>
    `   - ${join([`${r.title || r.code}${r.code && r.title ? ` [${r.code}]` : ""} — ${r.client || "?"}`, isRemote(r) ? "remote" : "", r.location, r.positions ? `${r.positions} pos` : "", r.payRate && `pay ${r.payRate}`, r.manager && `mgr ${r.manager}`, ageText(r), withFunnel && funnel(r)])}`;

  const html = `<h3 ${H3}>📋 Requirements</h3>
    ${stats([["Open", String(reqs.length)], ["Positions", String(totals.positions)], ["Posted today", String(posted.length)], ["Waiting for a first submission", String(noSubs.length)]])}
    <p ${NOTE}>Across open requirements: ${totals.subs} submissions · ${totals.interviews} interviews · ${totals.placements} placements.</p>
    <h4 ${H4}>Posted today (${posted.length})</h4>
    ${posted.length ? ul(posted.slice(0, caps.postedReqs).map((r) => line(r))) + more(posted.length, caps.postedReqs) : `<p ${NOTE}>No new requirements were posted.</p>`}
    ${noSubs.length ? `<h4 ${H4}>Waiting for a first submission (${noSubs.length}) — longest waiting first</h4>${ul(noSubs.slice(0, caps.noSubs).map((r) => line(r, false)))}${more(noSubs.length, caps.noSubs)}` : ""}
    ${others.length ? `<h4 ${H4}>Other open requirements (${others.length}) — newest first</h4>${ul(others.slice(0, caps.openReqs).map((r) => line(r)))}${more(others.length, caps.openReqs)}` : ""}`;

  const text = [
    "\n\nREQUIREMENTS",
    `Open: ${reqs.length} · positions: ${totals.positions} · posted today: ${posted.length} · no submissions yet: ${noSubs.length}`,
    `Across open requirements: ${totals.subs} submissions, ${totals.interviews} interviews, ${totals.placements} placements`,
    ...(posted.length ? ["  Posted today:", ...posted.slice(0, caps.postedReqs).map((r) => txt(r)), ...txtMore(posted.length, caps.postedReqs)] : ["  Posted today: none"]),
    ...(noSubs.length ? ["  Open with no submissions yet:", ...noSubs.slice(0, caps.noSubs).map((r) => txt(r, false)), ...txtMore(noSubs.length, caps.noSubs)] : []),
    ...(others.length ? ["  Other open requirements:", ...others.slice(0, caps.openReqs).map((r) => txt(r)), ...txtMore(others.length, caps.openReqs)] : []),
  ].join("\n");
  return { html, text };
}

// ---- Submissions ------------------------------------------------------------

function submissionsSection(rows: Record<string, unknown>[], dayISO: string, caps: Caps): DigestExtras {
  if (rows.length === 0) {
    return {
      html: `<h3 ${H3}>📤 Submissions</h3><p ${WARN}>The submissions report couldn't be read, so there's no list this time.</p>`,
      text: "\n\nSUBMISSIONS\n(the submissions report couldn't be read)",
    };
  }
  const list: SubmissionLine[] = listSubmissions(rows, dayISO);
  if (list.length === 0) {
    return { html: `<h3 ${H3}>📤 Submissions</h3><p ${NOTE}>No profiles were submitted.</p>`, text: "\n\nSUBMISSIONS\nNo profiles were submitted." };
  }

  const count = (key: (x: SubmissionLine) => string) => {
    const m = new Map<string, number>();
    for (const x of list) m.set(key(x) || "—", (m.get(key(x) || "—") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const byClient = count((x) => x.client);
  const byStatus = count((x) => x.status);
  const recruiters = count((x) => x.recruiter);
  const reqCount = new Set(list.map((x) => x.jobCode || x.jobTitle)).size;

  const time = (x: SubmissionLine) => x.submittedOn.toFormat("h:mm a");
  const line = (x: SubmissionLine) =>
    `<b>${esc(x.candidate)}</b> → ${esc(x.jobTitle || x.jobCode)} · ${esc(x.client || "?")} · <i>${esc(x.status || "?")}</i>${MUTED(
      join([time(x), x.jobCode && x.jobTitle ? `[${x.jobCode}]` : "", x.location, x.payRate && `rate ${x.payRate}`, x.workAuth, x.email, x.phone])
    )}`;

  // Grouped by recruiter, busiest first, within the overall cap.
  let left = caps.submissions;
  const groups: string[] = [];
  const textGroups: string[] = [];
  for (const [name, n] of recruiters) {
    if (left <= 0) break;
    const mine = list.filter((x) => (x.recruiter || "—") === name);
    const shown = mine.slice(0, left);
    left -= shown.length;
    groups.push(`<h4 ${H4}>${esc(name)} — ${n} submission${n === 1 ? "" : "s"}</h4>${ul(shown.map(line))}${shown.length < mine.length ? `<p ${NOTE}>…and ${mine.length - shown.length} more by ${esc(name)}.</p>` : ""}`);
    textGroups.push(
      `  ${name} (${n}):`,
      ...shown.map((x) => `   - ${time(x)} ${x.candidate} → ${x.jobTitle || x.jobCode} (${x.client || "?"}) — ${x.status || "?"}${join([x.location, x.payRate && `rate ${x.payRate}`, x.workAuth, x.email, x.phone]) ? ` · ${join([x.location, x.payRate && `rate ${x.payRate}`, x.workAuth, x.email, x.phone])}` : ""}`),
      ...txtMore(mine.length, shown.length)
    );
  }
  const hiddenRecruiters = recruiters.length - groups.length;

  const top = (pairs: [string, number][], k = 8) => pairs.slice(0, k).map(([name, c]) => `${name} ${c}`).join(" · ") + (pairs.length > k ? ` · +${pairs.length - k} more` : "");

  const html = `<h3 ${H3}>📤 Submissions</h3>
    ${stats([["Profiles sent", String(list.length)], ["Requirements", String(reqCount)], ["Clients", String(byClient.length)], ["Recruiters", String(recruiters.length)]])}
    <p ${NOTE}><strong>By client:</strong> ${esc(top(byClient))}<br><strong>By status:</strong> ${esc(top(byStatus))}</p>
    ${groups.join("")}
    ${hiddenRecruiters > 0 ? `<p ${NOTE}>…and ${hiddenRecruiters} more recruiter${hiddenRecruiters === 1 ? "" : "s"} — see Submissions in the portal for the full list.</p>` : ""}`;

  const text = [
    "\n\nSUBMISSIONS",
    `Profiles sent: ${list.length} · requirements: ${reqCount} · clients: ${byClient.length} · recruiters: ${recruiters.length}`,
    `By client: ${top(byClient)}`,
    `By status: ${top(byStatus)}`,
    ...textGroups,
    ...(hiddenRecruiters > 0 ? [`  …and ${hiddenRecruiters} more recruiter(s)`] : []),
  ].join("\n");
  return { html, text };
}

// ---- Bench sales -----------------------------------------------------------------

const RED = "#c62828";

function benchSection(load: BenchLoad, day: BenchDay, caps: Caps): DigestExtras {
  const people = day.people;
  const covered = people.filter((p) => p.count > 0);
  const none = people.filter((p) => p.count === 0);

  const notes = [...load.problems, ...day.warnings];
  const warnHtml = notes.map((n) => `<p ${WARN}>${esc(n)}</p>`).join("");

  // Everyone on the bench: name and today's count. Nothing today → name and 0 in red.
  const TD = `style="padding:4px 10px;border-bottom:1px solid #eef1f5;font-size:13px"`;
  const TH = `style="padding:4px 10px;font-size:11px;color:#5b6577;text-transform:uppercase;border-bottom:1px solid #dfe3ea"`;
  const rowHtml = (p: { name: string; count: number }) =>
    p.count > 0
      ? `<tr><td ${TD}><b><font color="#000000">${esc(p.name)}</font></b></td><td ${TD} align="right"><b><font color="#000000">${p.count}</font></b></td></tr>`
      : `<tr><td ${TD}><b><font color="${RED}">${esc(p.name)}</font></b></td><td ${TD} align="right"><b><font color="${RED}">0</font></b></td></tr>`;
  const table = people.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 4px;min-width:280px">
        <tr><th align="left" ${TH}>On the bench</th><th align="right" ${TH}>Submissions today</th></tr>
        ${people.map(rowHtml).join("")}</table>`
    : `<p ${NOTE}>Nobody is on the bench list.</p>`;

  // What was submitted, per consultant, within the overall cap.
  const line = (x: BenchLine) =>
    `${x.title ? esc(x.title) : "(no role)"}${x.vendor ? ` · ${esc(x.vendor)}` : ""}${x.status ? ` · <i>${esc(x.status)}</i>` : ""}${MUTED(join([x.recruiter && `by ${x.recruiter}`, x.time]))}`;
  const txtLine = (x: BenchLine) => `   - ${join([x.title || "(no role)", x.vendor, x.status, x.recruiter && `by ${x.recruiter}`, x.time])}`;
  let left = caps.benchLines;
  const groups: string[] = [];
  const textGroups: string[] = [];
  const withLines = [
    ...covered,
    ...(day.notOnBench.length ? [{ name: "Not on the bench list", count: day.notOnBench.length, lines: day.notOnBench }] : []),
  ];
  for (const p of withLines) {
    if (left <= 0) break;
    const shown = p.lines.slice(0, left);
    left -= shown.length;
    const fmt = p.name === "Not on the bench list" ? (x: BenchLine) => `<b>${esc(x.consultant)}</b> → ${line(x)}` : line;
    groups.push(`<h4 ${H4}>${esc(p.name)} — ${p.count}</h4>${ul(shown.map(fmt))}${shown.length < p.lines.length ? `<p ${NOTE}>…and ${p.lines.length - shown.length} more.</p>` : ""}`);
    textGroups.push(`  ${p.name} (${p.count}):`, ...shown.map(txtLine), ...txtMore(p.lines.length, shown.length));
  }
  const byRec = day.byRecruiter.map(([n, c]) => `${n} ${c}`).join(" · ");

  const html = `<h3 ${H3}>🪑 Bench sales</h3>${warnHtml}
    ${stats([["On the bench", String(people.length)], ["Submissions today", String(day.total)], ["Submitted", String(covered.length)], ["No submissions", String(none.length)]])}
    ${table}
    ${none.length ? `<p ${NOTE}>Names in <font color="${RED}"><b>red</b></font> had no submissions today.</p>` : ""}
    ${byRec ? `<p ${NOTE}><strong>By recruiter:</strong> ${esc(byRec)}</p>` : ""}
    ${groups.join("")}`;

  const text = [
    "\n\nBENCH SALES",
    ...notes.map((n) => `(${n})`),
    `On the bench: ${people.length} · submissions today: ${day.total} · submitted: ${covered.length} · none: ${none.length}`,
    ...people.map((p) => (p.count > 0 ? `  ${p.name}: ${p.count}` : `  ${p.name}: 0  <-- NONE`)),
    ...(byRec ? [`By recruiter: ${byRec}`] : []),
    ...(textGroups.length ? ["", "What was submitted:", ...textGroups] : []),
  ].join("\n");
  return { html, text };
}

// ---- All of it ----------------------------------------------------------------

/** Never throws. Each switched-on section either renders or explains itself. */
export async function buildExtras(
  dayISO: string,
  zone: string,
  submissionRows: Record<string, unknown>[],
  activeRows: Record<string, unknown>[],
  activeOk: boolean,
  bench: { ceipalPassword: string; staff: string[] } = { ceipalPassword: "", staff: [] }
): Promise<DigestExtras> {
  const on = await readSections();

  let benchLoad: BenchLoad | null = null;
  let benchData: BenchDay | null = null;
  let benchErr: unknown = null;
  if (on.bench) {
    try {
      benchLoad = await loadBench(bench.ceipalPassword);
      benchData = benchDay(benchLoad.bench, benchLoad.submissions, dayISO);
    } catch (e) {
      benchErr = e;
    }
  }

  // Read once; rendered up to three times at shrinking lengths below.
  let leaves: LeaveRow[] | null = null;
  let leavesErr: unknown = null;
  if (on.leaves || on.timesheets) {
    try {
      leaves = await loadLeaves(dayISO, zone);
    } catch (e) {
      leavesErr = e;
    }
  }
  let sheets: SheetData | null = null;
  let sheetsErr: unknown = null;
  if (on.timesheets) {
    try {
      sheets = await loadTimesheets(dayISO, leaves);
    } catch (e) {
      sheetsErr = e;
    }
  }

  const render = (caps: Caps): DigestExtras[] => {
    const parts: DigestExtras[] = [];
    const safe = (title: string, f: () => DigestExtras) => {
      try {
        parts.push(f());
      } catch (e) {
        parts.push(failed(title, e));
      }
    };
    if (on.leaves) safe("Leaves", () => (leaves ? leavesSection(leaves, dayISO, caps) : failed("Leaves", leavesErr)));
    if (on.timesheets) safe("Timesheets", () => (sheets ? timesheetsSection(sheets, caps) : failed("Timesheets", sheetsErr)));
    if (on.requirements) safe("Requirements", () => requirementsSection(activeRows, dayISO, activeOk, caps));
    if (on.submissions) safe("Submissions", () => submissionsSection(submissionRows, dayISO, caps));
    if (on.bench) safe("Bench sales", () => (benchLoad && benchData ? benchSection(benchLoad, benchData, caps) : failed("Bench sales", benchErr)));
    return parts;
  };

  let parts: DigestExtras[] = [];
  for (const factor of [1, 0.5, 0.25]) {
    parts = render(scaled(factor));
    if (parts.reduce((t, p) => t + p.html.length, 0) <= HTML_BUDGET) break;
  }

  if (parts.length === 0) return NO_EXTRAS;
  return {
    html: `<hr style="border:none;border-top:1px solid #dfe3ea;margin:26px 0 0">${parts.map((p) => p.html).join("")}`,
    text: parts.map((p) => p.text).join(""),
  };
}