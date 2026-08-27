// Plain-language explanation of the Performance Index, in English, Telugu and
// Hindi. Recruiters are scored by this number, so the rules have to be
// readable by the people being measured — not just by whoever wrote them.
//
// Keys under `metrics` match INDEX_METRICS in RecruiterPerformance.

import { BucketKey } from "./recruiterStats";

export type Lang = "en" | "te" | "hi";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "te", label: "తెలుగు" },
  { code: "hi", label: "हिंदी" },
];

export interface MetricText {
  key: BucketKey;
  name: string;
  plain: string;
  example: string;
}

export interface GuideText {
  title: string;
  intro: string;
  outOf: (n: number) => string; // "45 out of 100"
  metrics: MetricText[];
  relativeNote: string;
  bandsTitle: string;
  bands: { label: string; range: string; tone: "green" | "amber" | "red" }[];
  rangeNote: string;
  clientNote: string;
  tableTitle: string;
  col: { metric: string; weight: string; achieved: string; points: string; cumulative: string; total: string };
  /** The requirement base behind the target, localised. */
  basis: (n: number, kind: "assigned" | "worked") => string;
  yourLine: (got: number, target: number, basis: string) => string;
}

export const GUIDE: Record<Lang, GuideText> = {
  // ---------------------------------------------------------------- English
  en: {
    title: "How your Performance Index is calculated",
    intro:
      "Your Performance Index is a single score out of 100. It adds up how far each of your candidates actually got, plus whether you covered the requirements you were given. Each one is worth a different number of points — the first one matters most.",
    outOf: (n) => `${n} points out of 100`,
    metrics: [
      {
        key: "offer",
        name: "An offer accepted",
        plain:
          "Your candidate was picked in the client round and took the offer. One is enough to fill this.",
        example: "One accepted offer earns all 20 points.",
      },
      {
        key: "client",
        name: "With the client — submitted, interviewing, or selected",
        plain:
          "Candidates the vendor sent on to the client: sitting with the client, interviewing there, or already picked.",
        example: "3 candidates at this stage earns all 20 points. 1 earns about 7.",
      },
      {
        key: "vendor",
        name: "With the vendor — submitted or interviewing",
        plain: "Candidates sent to the vendor, including those interviewing with them.",
        example: "6 candidates at this stage earns all 20 points. 3 earns 10.",
      },
      {
        key: "coverage",
        name: "Two profiles for every requirement you were given",
        plain:
          "For each requirement assigned to you, 2 of your candidates should have gone out. This is the biggest single share of the score.",
        example: "Hitting the target earns all 40 points. Reaching half of it earns 20.",
      },
    ],
    relativeNote:
      "Every part depends only on your own work — nothing compares you with another recruiter. Each candidate counts once, at the furthest stage they reached, so an accepted offer is not also counted as a submission.",
    bandsTitle: "What the number means",
    bands: [
      { label: "Doing well", range: "60 and above", tone: "green" },
      { label: "Okay", range: "35 to 59", tone: "amber" },
      { label: "Needs attention", range: "below 35", tone: "red" },
    ],
    rangeNote:
      "If you pick a date range, only work done inside that range is counted — and the target above is based on the requirements you worked on in that range, not everything you have ever been assigned.",
    clientNote:
      "A candidate counts as having reached the client when their status is a client or vendor submission, a client interview, an offer, or a placement.",
    tableTitle: "Your points, metric by metric",
    col: {
      metric: "What is measured",
      weight: "Max",
      achieved: "Candidates",
      points: "Points",
      cumulative: "Running total",
      total: "Your index",
    },
    basis: (n, kind) =>
      kind === "assigned"
        ? `${n} requirement${n === 1 ? "" : "s"} assigned to you`
        : `${n} requirement${n === 1 ? "" : "s"} you worked on in this period`,
    yourLine: (got, target, basis) =>
      `You have ${got} client/vendor submission${got === 1 ? "" : "s"} against a target of ${target} (2 × ${basis}).`,
  },

  // ---------------------------------------------------------------- Telugu
  te: {
    title: "మీ Performance Index ఎలా లెక్కిస్తారు",
    intro:
      "Performance Index అంటే 100 కి మీకు వచ్చే ఒకే ఒక స్కోరు. మీ candidates ఎంత ముందుకు వెళ్ళారో, పైగా మీకు ఇచ్చిన requirements కవర్ చేశారో — ఇవి కలుస్తాయి. ప్రతి దానికీ వేరు వేరు మార్కులు ఉంటాయి — మొదటిది అన్నిటికంటే ముఖ్యం.",
    outOf: (n) => `100 కి ${n} మార్కులు`,
    metrics: [
      {
        key: "offer",
        name: "Offer accept అయ్యింది",
        plain: "మీ candidate client round లో select అయ్యి offer తీసుకున్నారు. ఒక్కటి చాలు.",
        example: "ఒక్క offer accept అయితే 20 మార్కులూ వస్తాయి.",
      },
      {
        key: "client",
        name: "Client దగ్గర — submit, interview, లేదా select",
        plain: "Vendor client కి పంపిన candidates: client దగ్గర ఉన్నవాళ్ళు, interview జరుగుతున్నవాళ్ళు, లేదా select అయినవాళ్ళు.",
        example: "ఈ దశలో 3 మంది ఉంటే 20 మార్కులూ. ఒక్కరైతే సుమారు 7.",
      },
      {
        key: "vendor",
        name: "Vendor దగ్గర — submit లేదా interview",
        plain: "Vendor కి పంపిన candidates, వాళ్ళతో interview జరుగుతున్నవాళ్ళతో సహా.",
        example: "ఈ దశలో 6 మంది ఉంటే 20 మార్కులూ. 3 మందైతే 10.",
      },
      {
        key: "coverage",
        name: "మీకు ఇచ్చిన ప్రతి requirement కి 2 profiles",
        plain: "మీకు ఇచ్చిన ప్రతి requirement కి మీ 2 candidates బయటకు వెళ్ళాలి. స్కోరులో ఇదే అతిపెద్ద భాగం.",
        example: "target చేరితే 40 మార్కులూ. సగం చేరితే 20.",
      },
    ],
    relativeNote:
      "ఈ మూడూ మీ సొంత పని మీదే ఆధారపడతాయి. ఇక్కడ మిమ్మల్ని వేరే recruiter తో పోల్చడం లేదు — వేరే వాళ్ళ వల్ల మీ స్కోరు తగ్గదు.",
    bandsTitle: "ఈ నంబర్ అర్థం ఏంటి",
    bands: [
      { label: "బాగా చేస్తున్నారు", range: "60 అంతకంటే ఎక్కువ", tone: "green" },
      { label: "ఫర్వాలేదు", range: "35 నుంచి 59", tone: "amber" },
      { label: "దృష్టి పెట్టాలి", range: "35 కంటే తక్కువ", tone: "red" },
    ],
    rangeNote:
      "మీరు date range ఎంచుకుంటే, ఆ range లోపల చేసిన పని మాత్రమే లెక్కిస్తాం — పైన చెప్పిన target కూడా ఆ range లో మీరు పని చేసిన requirements మీదే ఆధారపడుతుంది, మీకు ఎప్పుడైనా ఇచ్చిన అన్ని requirements మీద కాదు.",
    clientNote:
      "candidate status 'Client / Vendor Submission', 'Client Interview', 'Offer', లేదా 'Placement' అయితే — ఆ candidate client దాకా వెళ్ళినట్టు లెక్క.",
    tableTitle: "మీ మార్కులు, ఒక్కొక్కటిగా",
    col: {
      metric: "దేని మీద లెక్క",
      weight: "విలువ",
      achieved: "Candidates",
      points: "మార్కులు",
      cumulative: "కూడిక మొత్తం",
      total: "మీ index",
    },
    basis: (n, kind) =>
      kind === "assigned" ? `మీకు ఇచ్చిన ${n} requirements` : `ఈ కాలంలో మీరు పని చేసిన ${n} requirements`,
    yourLine: (got, target, basis) =>
      `మీకు ${got} client/vendor submissions ఉన్నాయి. target ${target} (2 × ${basis}).`,
  },

  // ---------------------------------------------------------------- Hindi
  hi: {
    title: "आपका Performance Index कैसे निकाला जाता है",
    intro:
      "Performance Index 100 में से एक स्कोर है। इसमें आपके candidates कितना आगे गए, और आपने दी गई requirements कवर कीं या नहीं — ये जुड़ते हैं। हर एक के अलग अंक हैं — पहली सबसे ज़्यादा मायने रखती है।",
    outOf: (n) => `100 में से ${n} अंक`,
    metrics: [
      {
        key: "offer",
        name: "Offer accept हुआ",
        plain: "आपका candidate client round में चुना गया और offer ले लिया। एक ही काफ़ी है।",
        example: "एक accept हुआ offer पूरे 20 अंक देता है।",
      },
      {
        key: "client",
        name: "Client के पास — submit, interview, या select",
        plain: "वे candidates जिन्हें vendor ने client तक भेजा: client के पास हैं, interview दे रहे हैं, या चुन लिए गए हैं।",
        example: "इस चरण पर 3 candidates से पूरे 20 अंक। एक से लगभग 7।",
      },
      {
        key: "vendor",
        name: "Vendor के पास — submit या interview",
        plain: "Vendor को भेजे गए candidates, उनके साथ interview दे रहे लोगों समेत।",
        example: "इस चरण पर 6 candidates से पूरे 20 अंक। 3 से 10।",
      },
      {
        key: "coverage",
        name: "हर दी गई requirement पर 2 profiles",
        plain: "आपको दी गई हर requirement पर आपके 2 candidates बाहर जाने चाहिए। स्कोर का सबसे बड़ा हिस्सा यही है।",
        example: "target पूरा होने पर पूरे 40 अंक। आधा होने पर 20।",
      },
    ],
    relativeNote:
      "तीनों सिर्फ़ आपके अपने काम पर निर्भर हैं। यहाँ किसी दूसरे recruiter से तुलना नहीं होती — दूसरों की वजह से आपका स्कोर कम नहीं होता।",
    bandsTitle: "इस नंबर का मतलब",
    bands: [
      { label: "अच्छा कर रहे हैं", range: "60 और उससे ऊपर", tone: "green" },
      { label: "ठीक-ठाक", range: "35 से 59", tone: "amber" },
      { label: "ध्यान देने की ज़रूरत", range: "35 से नीचे", tone: "red" },
    ],
    rangeNote:
      "अगर आप date range चुनते हैं, तो सिर्फ़ उसी range में किया गया काम गिना जाता है — और ऊपर वाला target भी उसी range में आपने जिन requirements पर काम किया, उन पर आधारित होता है, आपको कभी भी दी गई सारी requirements पर नहीं।",
    clientNote:
      "जब candidate का status 'Client / Vendor Submission', 'Client Interview', 'Offer', या 'Placement' हो — तब माना जाता है कि वह client तक पहुँच गया।",
    tableTitle: "आपके अंक, एक-एक करके",
    col: {
      metric: "किस चीज़ की गिनती",
      weight: "कीमत",
      achieved: "Candidates",
      points: "अंक",
      cumulative: "जोड़ का कुल",
      total: "आपका index",
    },
    basis: (n, kind) =>
      kind === "assigned" ? `आपको दी गई ${n} requirements` : `इस अवधि में आपने जिन ${n} requirements पर काम किया`,
    yourLine: (got, target, basis) =>
      `आपके पास ${got} client/vendor submissions हैं, target ${target} (2 × ${basis}) के मुक़ाबले।`,
  },
};

const KEY = "indexGuideLang";

export function readLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "te" || v === "hi") return v;
  } catch {
    /* storage unavailable */
  }
  return "en";
}

export function writeLang(l: Lang): void {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
}
