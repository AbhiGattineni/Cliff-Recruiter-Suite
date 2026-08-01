// LinkedIn profile trust scoring.
//
// A freshly-created profile with no connections, no recommendations and no work
// history is the classic fake/proxy-candidate signature. This scores the signals
// a recruiter can see (or a data provider can supply) into one verdict.
//
// Unknown signals are EXCLUDED from the score rather than counted as zero, so a
// partially-filled check never reads as "high risk" on missing data alone.

export interface LinkedinSignals {
  accountAgeMonths?: number | null; // how long the profile has existed
  connections?: number | null;
  recommendations?: number | null; // recommendations RECEIVED
  endorsements?: number | null;
  positionsCount?: number | null; // work-history entries on the profile
  hasPhoto?: boolean | null;
  hasAbout?: boolean | null; // headline + About section filled in
  recentActivity?: boolean | null; // posts/comments in the last ~6 months
}

export type SignalStatus = "good" | "weak" | "bad" | "unknown";

export interface SignalResult {
  key: keyof LinkedinSignals;
  label: string;
  status: SignalStatus;
  detail: string;
  points: number; // earned
  weight: number; // available (0 when unknown)
}

export type LinkedinVerdict = "Established" | "Plausible" | "Thin" | "High risk" | "Not checked";

export interface LinkedinAssessment {
  score: number; // 0-100 across KNOWN signals (0 when nothing is known)
  verdict: LinkedinVerdict;
  known: number; // how many signals were supplied
  signals: SignalResult[];
  redFlags: string[];
  note: string;
}

const WEIGHTS = {
  accountAgeMonths: 20,
  connections: 20,
  recommendations: 20,
  positionsCount: 15,
  endorsements: 10,
  hasPhoto: 5,
  hasAbout: 5,
  recentActivity: 5,
} as const;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean | null => (v === null || v === undefined ? null : Boolean(v));

/** Bucket a numeric signal into (points, status, detail). */
function band(
  value: number | null,
  weight: number,
  tiers: Array<{ min: number; frac: number; status: SignalStatus; detail: string }>,
  unknownDetail: string
): { points: number; weight: number; status: SignalStatus; detail: string } {
  if (value === null) return { points: 0, weight: 0, status: "unknown", detail: unknownDetail };
  for (const t of tiers) {
    if (value >= t.min) {
      return { points: Math.round(weight * t.frac), weight, status: t.status, detail: t.detail };
    }
  }
  const last = tiers[tiers.length - 1];
  return { points: 0, weight, status: "bad", detail: last.detail };
}

function flag(
  value: boolean | null,
  weight: number,
  goodDetail: string,
  badDetail: string,
  unknownDetail: string
): { points: number; weight: number; status: SignalStatus; detail: string } {
  if (value === null) return { points: 0, weight: 0, status: "unknown", detail: unknownDetail };
  return value
    ? { points: weight, weight, status: "good", detail: goodDetail }
    : { points: 0, weight, status: "bad", detail: badDetail };
}

/**
 * Score a LinkedIn profile's credibility signals.
 *
 * @param s              signals observed on the profile
 * @param resumeYears    years of experience claimed on the resume (for cross-checks)
 */
export function scoreLinkedin(s: LinkedinSignals, resumeYears?: number | null): LinkedinAssessment {
  const age = num(s.accountAgeMonths);
  const conn = num(s.connections);
  const recs = num(s.recommendations);
  const pos = num(s.positionsCount);
  const endo = num(s.endorsements);
  const photo = bool(s.hasPhoto);
  const about = bool(s.hasAbout);
  const activity = bool(s.recentActivity);

  const signals: SignalResult[] = [
    {
      key: "accountAgeMonths",
      label: "Account age",
      ...band(
        age,
        WEIGHTS.accountAgeMonths,
        [
          { min: 36, frac: 1, status: "good", detail: "3+ years old — an established profile." },
          { min: 12, frac: 0.7, status: "good", detail: "1-3 years old." },
          { min: 6, frac: 0.4, status: "weak", detail: "6-12 months old — relatively new." },
          { min: 0, frac: 0, status: "bad", detail: "Under 6 months old — created recently." },
        ],
        "Not supplied — LinkedIn doesn't show a join date publicly."
      ),
    },
    {
      key: "connections",
      label: "Connections",
      ...band(
        conn,
        WEIGHTS.connections,
        [
          { min: 500, frac: 1, status: "good", detail: "500+ connections — a real network." },
          { min: 200, frac: 0.75, status: "good", detail: "200-499 connections." },
          { min: 50, frac: 0.45, status: "weak", detail: "50-199 connections — a thin network." },
          { min: 0, frac: 0, status: "bad", detail: "Under 50 connections — barely networked." },
        ],
        "Not supplied."
      ),
    },
    {
      key: "recommendations",
      label: "Recommendations received",
      ...band(
        recs,
        WEIGHTS.recommendations,
        [
          { min: 3, frac: 1, status: "good", detail: "3+ recommendations from other people." },
          { min: 2, frac: 0.75, status: "good", detail: "2 recommendations." },
          { min: 1, frac: 0.5, status: "weak", detail: "Only 1 recommendation." },
          { min: 0, frac: 0, status: "bad", detail: "No recommendations — nobody has vouched publicly." },
        ],
        "Not supplied."
      ),
    },
    {
      key: "positionsCount",
      label: "Work history entries",
      ...band(
        pos,
        WEIGHTS.positionsCount,
        [
          { min: 3, frac: 1, status: "good", detail: "3+ roles listed." },
          { min: 2, frac: 0.7, status: "good", detail: "2 roles listed." },
          { min: 1, frac: 0.4, status: "weak", detail: "Only 1 role listed." },
          { min: 0, frac: 0, status: "bad", detail: "No work history on the profile." },
        ],
        "Not supplied."
      ),
    },
    {
      key: "endorsements",
      label: "Skill endorsements",
      ...band(
        endo,
        WEIGHTS.endorsements,
        [
          { min: 10, frac: 1, status: "good", detail: "10+ endorsements." },
          { min: 3, frac: 0.6, status: "weak", detail: "3-9 endorsements." },
          { min: 1, frac: 0.3, status: "weak", detail: "1-2 endorsements." },
          { min: 0, frac: 0, status: "bad", detail: "No endorsements." },
        ],
        "Not supplied."
      ),
    },
    {
      key: "hasPhoto",
      label: "Profile photo",
      ...flag(photo, WEIGHTS.hasPhoto, "Has a profile photo.", "No profile photo.", "Not supplied."),
    },
    {
      key: "hasAbout",
      label: "Headline & About",
      ...flag(about, WEIGHTS.hasAbout, "Headline and About are filled in.", "Headline/About is empty.", "Not supplied."),
    },
    {
      key: "recentActivity",
      label: "Recent activity",
      ...flag(
        activity,
        WEIGHTS.recentActivity,
        "Posted or commented recently.",
        "No visible activity.",
        "Not supplied."
      ),
    },
  ];

  const available = signals.reduce((sum, x) => sum + x.weight, 0);
  const earned = signals.reduce((sum, x) => sum + x.points, 0);
  const known = signals.filter((x) => x.status !== "unknown").length;
  const score = available > 0 ? Math.round((earned / available) * 100) : 0;

  // ---- Red flags ----
  const redFlags: string[] = [];
  const isNew = age !== null && age < 6;
  const noNetwork = conn !== null && conn < 50;
  const noRecs = recs !== null && recs === 0;
  const noHistory = pos !== null && pos === 0;

  if (isNew) redFlags.push("Profile was created less than 6 months ago.");
  if (noNetwork) redFlags.push("Fewer than 50 connections.");
  if (noRecs) redFlags.push("No recommendations from anyone.");
  if (noHistory) redFlags.push("No work history listed on the profile.");
  if (photo === false) redFlags.push("No profile photo.");

  // Resume claims real tenure but the profile shows none of the footprint that implies.
  const years = num(resumeYears);
  if (years !== null && years >= 3 && isNew && (noRecs || noHistory)) {
    redFlags.push(
      `Resume claims ~${years} years of experience, but the profile is new and has no supporting history.`
    );
  }

  // ---- Verdict ----
  // "A new profile with none of these is red" — the brand-new + empty signature.
  let verdict: LinkedinVerdict;
  if (known === 0) {
    verdict = "Not checked";
  } else if (isNew && known >= 2 && score < 30) {
    verdict = "High risk";
  } else if (score >= 70) {
    verdict = "Established";
  } else if (score >= 45) {
    verdict = "Plausible";
  } else {
    verdict = "Thin";
  }

  const note =
    known === 0
      ? "No signals entered yet — open the profile and fill in what you can see."
      : `Scored on ${known} of ${signals.length} signals; unknown signals are excluded rather than counted against the candidate.`;

  return { score, verdict, known, signals, redFlags, note };
}

export function verdictClass(v: LinkedinVerdict): string {
  if (v === "Established") return "green";
  if (v === "Plausible") return "amber";
  if (v === "High risk") return "red";
  if (v === "Thin") return "amber";
  return "grey";
}
