// Plain-language explanation of the Performance Index, in English, Telugu and
// Hindi. Recruiters are scored by this number, so the rules have to be
// readable by the people being measured — not just by whoever wrote them.
//
// Keys under `metrics` match INDEX_METRICS in RecruiterPerformance.

export type Lang = "en" | "te" | "hi";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "te", label: "తెలుగు" },
  { code: "hi", label: "हिंदी" },
];

export interface MetricText {
  key: "clientPerAssigned" | "clientRate" | "progressRate" | "volume" | "coverage";
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
  col: { metric: string; weight: string; achieved: string; points: string; total: string };
  yourLine: (got: number, target: number, basis: string) => string;
}

export const GUIDE: Record<Lang, GuideText> = {
  // ---------------------------------------------------------------- English
  en: {
    title: "How your Performance Index is calculated",
    intro:
      "Your Performance Index is a single score out of 100. It adds up five things. Each one is worth a different number of points — the first one matters most.",
    outOf: (n) => `${n} points out of 100`,
    metrics: [
      {
        key: "clientPerAssigned",
        name: "Sending enough people to the client",
        plain:
          "For every requirement you worked on, we expect 2 of your candidates to reach the client or vendor.",
        example:
          "Worked on 3 requirements? We expect 6 client submissions. Reach 6 and you get all 45 points. Reach 3 and you get half.",
      },
      {
        key: "clientRate",
        name: "How many of your profiles reached the client",
        plain:
          "Out of everyone you submitted, what share actually went on to the client or vendor?",
        example: "Submitted 10 and 5 reached the client? That is half, so you get 10 of the 20 points.",
      },
      {
        key: "progressRate",
        name: "How far your candidates got",
        plain: "How many of your candidates reached an interview stage or better.",
        example: "The further your people go, the more of these 15 points you keep.",
      },
      {
        key: "volume",
        name: "How much work you did",
        plain:
          "Your number of profiles compared with the busiest recruiter in the same period.",
        example: "The busiest recruiter gets all 12 points. Half as many profiles gets you 6.",
      },
      {
        key: "coverage",
        name: "How many different requirements you covered",
        plain:
          "How many separate requirements you worked on, compared with the recruiter who covered the most.",
        example: "Working across many requirements — not just one — earns these 8 points.",
      },
    ],
    relativeNote:
      "The last two compare you with other recruiters. The first three depend only on your own work, so nobody else's month can pull them down.",
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
    col: { metric: "What is measured", weight: "Worth", achieved: "You got", points: "Points", total: "Your index" },
    yourLine: (got, target, basis) =>
      `You have ${got} client/vendor submission${got === 1 ? "" : "s"} against a target of ${target} (2 × ${basis}).`,
  },

  // ---------------------------------------------------------------- Telugu
  te: {
    title: "మీ Performance Index ఎలా లెక్కిస్తారు",
    intro:
      "Performance Index అంటే 100 కి మీకు వచ్చే ఒకే ఒక స్కోరు. ఇందులో ఐదు విషయాలు కలుస్తాయి. ప్రతి దానికీ వేరు వేరు మార్కులు ఉంటాయి — మొదటిది అన్నిటికంటే ముఖ్యం.",
    outOf: (n) => `100 కి ${n} మార్కులు`,
    metrics: [
      {
        key: "clientPerAssigned",
        name: "సరిపడా మందిని client కి పంపడం",
        plain:
          "మీరు పని చేసిన ప్రతి requirement కి, మీ candidates లో 2 మంది client కి లేదా vendor కి వెళ్ళాలి అని ఆశిస్తాం.",
        example:
          "3 requirements మీద పని చేశారా? అయితే 6 client submissions ఉండాలి. 6 చేస్తే 45 మార్కులూ వస్తాయి. 3 చేస్తే సగం వస్తాయి.",
      },
      {
        key: "clientRate",
        name: "మీ profiles లో ఎన్ని client దాకా వెళ్ళాయి",
        plain: "మీరు పంపిన మొత్తం candidates లో, ఎంత మంది నిజంగా client కి లేదా vendor కి వెళ్ళారు?",
        example: "10 మందిని పంపి 5 మంది వెళ్ళారా? అది సగం — అంటే 20 లో 10 మార్కులు.",
      },
      {
        key: "progressRate",
        name: "మీ candidates ఎంత ముందుకు వెళ్ళారు",
        plain: "మీ candidates లో ఎంత మంది interview దశకు లేదా అంతకంటే ముందుకు వెళ్ళారు.",
        example: "మీ వాళ్ళు ఎంత ముందుకు వెళ్తే, ఈ 15 మార్కుల్లో అంత ఎక్కువ మీకు దక్కుతుంది.",
      },
      {
        key: "volume",
        name: "మీరు ఎంత పని చేశారు",
        plain: "అదే సమయంలో అందరికంటే ఎక్కువ పని చేసిన recruiter తో పోల్చి, మీ profiles సంఖ్య.",
        example: "ఎక్కువ పని చేసిన recruiter కి 12 మార్కులూ వస్తాయి. వాళ్ళలో సగం చేస్తే మీకు 6.",
      },
      {
        key: "coverage",
        name: "ఎన్ని వేరు వేరు requirements చూశారు",
        plain:
          "అందరికంటే ఎక్కువ requirements చూసిన recruiter తో పోల్చి, మీరు ఎన్ని వేరు వేరు requirements మీద పని చేశారు.",
        example: "ఒకే requirement కాకుండా చాలా వాటి మీద పని చేస్తే ఈ 8 మార్కులు వస్తాయి.",
      },
    ],
    relativeNote:
      "చివరి రెండు మిమ్మల్ని ఇతర recruiters తో పోలుస్తాయి. మొదటి మూడు మీ సొంత పని మీదే ఆధారపడతాయి — వేరే వాళ్ళ వల్ల అవి తగ్గవు.",
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
    col: { metric: "దేని మీద లెక్క", weight: "విలువ", achieved: "మీకు వచ్చింది", points: "మార్కులు", total: "మీ index" },
    yourLine: (got, target, basis) =>
      `మీకు ${got} client/vendor submissions ఉన్నాయి. target ${target} (2 × ${basis}).`,
  },

  // ---------------------------------------------------------------- Hindi
  hi: {
    title: "आपका Performance Index कैसे निकाला जाता है",
    intro:
      "Performance Index 100 में से एक स्कोर है। इसमें पाँच चीज़ें जुड़ती हैं। हर एक के अलग अंक हैं — पहली सबसे ज़्यादा मायने रखती है।",
    outOf: (n) => `100 में से ${n} अंक`,
    metrics: [
      {
        key: "clientPerAssigned",
        name: "client तक पर्याप्त लोग भेजना",
        plain:
          "आपने जिस भी requirement पर काम किया, उस पर आपके 2 candidates client या vendor तक पहुँचने चाहिए।",
        example:
          "3 requirements पर काम किया? तो 6 client submissions चाहिए। 6 हुए तो पूरे 45 अंक। 3 हुए तो आधे।",
      },
      {
        key: "clientRate",
        name: "आपकी कितनी profiles client तक पहुँचीं",
        plain: "आपने जितने candidates भेजे, उनमें से कितने असल में client या vendor तक गए?",
        example: "10 भेजे और 5 पहुँचे? यह आधा है — यानी 20 में से 10 अंक।",
      },
      {
        key: "progressRate",
        name: "आपके candidates कितना आगे गए",
        plain: "आपके कितने candidates interview या उससे आगे तक पहुँचे।",
        example: "आपके लोग जितना आगे जाएँगे, इन 15 अंकों में से उतने ज़्यादा आपको मिलेंगे।",
      },
      {
        key: "volume",
        name: "आपने कितना काम किया",
        plain: "उसी अवधि में सबसे ज़्यादा काम करने वाले recruiter से तुलना करके, आपकी profiles की संख्या।",
        example: "सबसे ज़्यादा काम करने वाले को पूरे 12 अंक। उससे आधा काम किया तो 6 अंक।",
      },
      {
        key: "coverage",
        name: "कितनी अलग-अलग requirements पर काम किया",
        plain:
          "सबसे ज़्यादा requirements संभालने वाले recruiter से तुलना करके, आपने कितनी अलग requirements पर काम किया।",
        example: "सिर्फ़ एक नहीं, कई requirements पर काम करने से ये 8 अंक मिलते हैं।",
      },
    ],
    relativeNote:
      "आख़िरी दो आपकी तुलना दूसरे recruiters से करते हैं। पहले तीन सिर्फ़ आपके अपने काम पर निर्भर हैं — दूसरों की वजह से वे कम नहीं होते।",
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
    col: { metric: "किस चीज़ की गिनती", weight: "कीमत", achieved: "आपको मिला", points: "अंक", total: "आपका index" },
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
