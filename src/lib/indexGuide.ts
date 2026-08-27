// Plain-language explanation of the Performance Index, in English, Telugu and
// Hindi. Recruiters are scored by this number, so the rules have to be
// readable by the people being measured — not just by whoever wrote them.
//
// Keys under `metrics` match INDEX_METRICS in RecruiterPerformance.

import { PipelineStage } from "./recruiterStats";

export type Lang = "en" | "te" | "hi";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "te", label: "తెలుగు" },
  { code: "hi", label: "हिंदी" },
];

export interface MetricText {
  key: PipelineStage | "requirementTarget";
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
        key: "offerAccepted",
        name: "An offer accepted",
        plain:
          "Your candidate was picked in the client round and took the offer. This is the job — everything else is a step towards it.",
        example:
          "The first one is worth 55 points, more than every submission tier put together. Each one after that adds 20.",
      },
      {
        key: "clientSelected",
        name: "Selected in the client round",
        plain:
          "The client or vendor picked your candidate, or an offer is out — but nothing is signed yet.",
        example: "12 points each, up to 24.",
      },
      {
        key: "clientInterview",
        name: "Interviewing with the client",
        plain: "Your candidate is in front of the client or vendor right now.",
        example: "6 points each, up to 14.",
      },
      {
        key: "clientSubmitted",
        name: "Through the vendor, on to the client",
        plain: "The vendor picked your candidate and sent them on to the client.",
        example: "3 points each, up to 12.",
      },
      {
        key: "vendorSubmitted",
        name: "Sent to the vendor",
        plain: "The first step out of the door — the profile has gone to the vendor.",
        example:
          "1 point each, up to 6. A hundred of these is still 6 points: a submission is a start, not a result.",
      },
      {
        key: "requirementTarget",
        name: "Covering the requirements you were given",
        plain: "For every requirement assigned to you, 2 of your profiles should have gone out.",
        example: "Hitting the target is 20 points. Reaching half of it gets you 10.",
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
        key: "offerAccepted",
        name: "Offer accept అయ్యింది",
        plain:
          "మీ candidate client round లో select అయ్యి offer కూడా తీసుకున్నారు. అసలు పని ఇదే — మిగతావన్నీ దీనికి దారి మాత్రమే.",
        example: "మొదటి దానికి 55 మార్కులు — submission మార్కులన్నీ కలిపినా దీనికంటే తక్కువ. తరువాత ప్రతి దానికీ 20.",
      },
      {
        key: "clientSelected",
        name: "Client round లో select అయ్యారు",
        plain: "Client లేదా vendor మీ candidate ని ఎంచుకున్నారు, లేదా offer ఇచ్చారు — కానీ ఇంకా ఏమీ ఖరారు కాలేదు.",
        example: "ఒక్కొక్క దానికి 12 మార్కులు, గరిష్ఠంగా 24.",
      },
      {
        key: "clientInterview",
        name: "Client తో interview జరుగుతోంది",
        plain: "మీ candidate ఇప్పుడు client లేదా vendor ముందు ఉన్నారు.",
        example: "ఒక్కొక్క దానికి 6 మార్కులు, గరిష్ఠంగా 14.",
      },
      {
        key: "clientSubmitted",
        name: "Vendor దాటి client కి వెళ్ళారు",
        plain: "Vendor మీ candidate ని ఎంచుకుని client కి పంపారు.",
        example: "ఒక్కొక్క దానికి 3 మార్కులు, గరిష్ఠంగా 12.",
      },
      {
        key: "vendorSubmitted",
        name: "Vendor కి పంపారు",
        plain: "మొదటి అడుగు — profile vendor కి వెళ్ళింది.",
        example: "ఒక్కొక్క దానికి 1 మార్కు, గరిష్ఠంగా 6. వంద పంపినా 6 మార్కులే — పంపడం మొదలు మాత్రమే, ఫలితం కాదు.",
      },
      {
        key: "requirementTarget",
        name: "మీకు ఇచ్చిన requirements కవర్ చేయడం",
        plain: "మీకు ఇచ్చిన ప్రతి requirement కి, మీ 2 profiles బయటకు వెళ్ళాలి.",
        example: "target చేరితే 20 మార్కులు. సగం చేరితే 10.",
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
        key: "offerAccepted",
        name: "Offer accept हुआ",
        plain:
          "आपका candidate client round में चुना गया और offer भी ले लिया। असली काम यही है — बाकी सब इसी तक पहुँचने के कदम हैं।",
        example: "पहले वाले के 55 अंक — सारे submission अंक मिलाकर भी इससे कम हैं। उसके बाद हर एक पर 20।",
      },
      {
        key: "clientSelected",
        name: "Client round में चुने गए",
        plain: "Client या vendor ने आपके candidate को चुना, या offer निकल गया — पर अभी कुछ तय नहीं हुआ।",
        example: "हर एक के 12 अंक, ज़्यादा से ज़्यादा 24।",
      },
      {
        key: "clientInterview",
        name: "Client के साथ interview चल रहा है",
        plain: "आपका candidate अभी client या vendor के सामने है।",
        example: "हर एक के 6 अंक, ज़्यादा से ज़्यादा 14।",
      },
      {
        key: "clientSubmitted",
        name: "Vendor से आगे client तक",
        plain: "Vendor ने आपके candidate को चुनकर client तक भेजा।",
        example: "हर एक के 3 अंक, ज़्यादा से ज़्यादा 12।",
      },
      {
        key: "vendorSubmitted",
        name: "Vendor को भेजा",
        plain: "पहला कदम — profile vendor तक पहुँच गई।",
        example: "हर एक का 1 अंक, ज़्यादा से ज़्यादा 6। सौ भेजने पर भी 6 ही — भेजना शुरुआत है, नतीजा नहीं।",
      },
      {
        key: "requirementTarget",
        name: "दी गई requirements को कवर करना",
        plain: "आपको दी गई हर requirement पर आपकी 2 profiles बाहर जानी चाहिए।",
        example: "target पूरा होने पर 20 अंक। आधा होने पर 10।",
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
