// Generate a sectioned PDF for a single resume assessment.
//
// Mirrors the on-screen design: a verdict band across the top, then bordered
// section cards with tinted header bars. Blocks are measured before they're
// drawn (`keepTogether`) so a section header never orphans at a page bottom.

import { jsPDF } from "jspdf";
import { ResumeReport } from "./resumeReports";
import { normalizeAiLines, aiPercentOf } from "./resume";
import { highlightKeywords } from "./highlight";

type RGB = [number, number, number];

const BRAND: RGB = [31, 78, 120];
const INK: RGB = [31, 41, 51];
const MUTED: RGB = [107, 114, 128];
const LINE: RGB = [226, 232, 240];
const GREEN: RGB = [30, 126, 52];
const AMBER: RGB = [169, 112, 10];
const RED: RGB = [156, 0, 6];
const GREY: RGB = [148, 163, 184];
const TINT: RGB = [244, 248, 252];
const ZEBRA: RGB = [250, 251, 253];
const HL: RGB = [255, 242, 168];

const MARGIN = 44;
const HEADER_H = 64;

function ratingColor(rating: string): RGB {
  if (rating === "Strong" || rating === "Established") return GREEN;
  if (rating === "Weak" || rating === "High risk") return RED;
  return AMBER;
}
function scoreColor(score: number): RGB {
  return score >= 70 ? GREEN : score >= 45 ? AMBER : RED;
}

/**
 * Build the document without saving it. Split out from the download so tests
 * can exercise the whole layout — page breaks, section cards, chip wrapping —
 * without writing files.
 */
export function buildResumeReportPdf(r: ResumeReport): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  let y = 0;

  // ---- primitives ---------------------------------------------------------
  const newPage = () => {
    doc.addPage();
    y = MARGIN;
  };
  const ensure = (needed: number) => {
    if (y + needed > pageH - MARGIN - 22) newPage();
  };
  /** Height of `text` when wrapped to `w` at the given size. */
  const measure = (text: string, w: number, size: number, lh = 13): number => {
    doc.setFontSize(size);
    return doc.splitTextToSize(text || "-", w).length * lh;
  };
  /** Start a block that must not be split across pages. */
  const keepTogether = (needed: number) => {
    if (y + needed > pageH - MARGIN - 22) newPage();
  };

  const text = (
    s: string,
    x: number,
    opts: { size?: number; color?: RGB; bold?: boolean; w?: number; lh?: number } = {}
  ) => {
    const size = opts.size ?? 9.5;
    const lh = opts.lh ?? 13;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? INK));
    for (const line of doc.splitTextToSize(s || "-", opts.w ?? contentW)) {
      ensure(lh);
      doc.text(line, x, y);
      y += lh;
    }
  };

  const bullets = (items: string[], x: number, w: number) => {
    if (!items?.length) {
      text("None noted.", x, { color: MUTED, w });
      return;
    }
    for (const it of items) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      const lines = doc.splitTextToSize(it, w - 12);
      lines.forEach((line: string, i: number) => {
        ensure(13);
        if (i === 0) {
          doc.setTextColor(...BRAND);
          doc.text("•", x, y);
          doc.setTextColor(...INK);
        }
        doc.text(line, x + 11, y);
        y += 13;
      });
    }
  };

  /**
   * Draw a section card: tinted header bar with title + optional right-aligned
   * badge, then the body, then a border around the whole thing.
   */
  const section = (title: string, badge: string | null, badgeColor: RGB, body: () => void) => {
    keepTogether(64); // header + at least a couple of body lines
    y += 12;
    const top = y;
    const headH = 24;

    doc.setFillColor(...TINT);
    doc.rect(MARGIN, top, contentW, headH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...BRAND);
    doc.text(title, MARGIN + 10, top + 16);
    if (badge) {
      doc.setFontSize(9);
      doc.setTextColor(...badgeColor);
      doc.text(badge, MARGIN + contentW - 10 - doc.getTextWidth(badge), top + 16);
    }

    y = top + headH + 11;
    const startPage = doc.getNumberOfPages();
    body();
    y += 8;

    // Border the card — only when it didn't span a page (a split card would
    // need per-page rects, and an unboxed continuation reads fine).
    if (doc.getNumberOfPages() === startPage) {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.7);
      doc.rect(MARGIN, top, contentW, y - top);
    }
    y += 4;
  };

  // ---- header band --------------------------------------------------------
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageW, HEADER_H, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Cliff Recruiter Suite", MARGIN, 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Resume fit assessment", MARGIN, 46);
  const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "";
  if (dateStr) {
    doc.setFontSize(9);
    doc.text(dateStr, pageW - MARGIN - doc.getTextWidth(dateStr), 46);
  }
  y = HEADER_H + 26;

  // ---- candidate ----------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...INK);
  doc.text(r.candidateName || "Candidate", MARGIN, y);
  y += 16;
  const ex = r.extracted || {};
  const subtitle = [
    ex.currentTitle,
    ex.totalExperienceYears != null ? `${ex.totalExperienceYears} yrs` : null,
    ex.location,
  ]
    .filter(Boolean)
    .join("  ·  ");
  if (subtitle) text(subtitle, MARGIN, { size: 9.5, color: MUTED });
  text(
    `Generated ${r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}` +
      `${r.createdByName ? `  ·  by ${r.createdByName}` : ""}  ·  ${r.provider} / ${r.model}`,
    MARGIN,
    { size: 8.5, color: MUTED }
  );
  y += 8;

  // ---- verdict band -------------------------------------------------------
  const pf = r.portfolio;
  const li = r.linkedinCheck?.assessment;
  const tiles: Array<{ label: string; score: number | null; note: string; color: RGB }> = [
    {
      label: "Resume fit",
      score: Math.round(Number(r.fitScore) || 0),
      note: r.rating,
      color: ratingColor(r.rating),
    },
    {
      label: "GitHub portfolio",
      score: pf ? pf.portfolioScore : null,
      note: pf ? `${pf.rating} · ${pf.activityLevel}` : "Not assessed",
      color: pf ? scoreColor(pf.portfolioScore) : GREY,
    },
    {
      label: "LinkedIn",
      score: li && li.known > 0 ? li.score : null,
      note: li && li.known > 0 ? li.verdict : "Not checked",
      color: li && li.known > 0 ? ratingColor(li.verdict) : GREY,
    },
  ];
  keepTogether(76);
  const gap = 10;
  const tileW = (contentW - gap * (tiles.length - 1)) / tiles.length;
  const tileH = 64;
  tiles.forEach((t, i) => {
    const x = MARGIN + i * (tileW + gap);
    doc.setFillColor(...TINT);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.7);
    doc.rect(x, y, tileW, tileH, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(t.label, x + 9, y + 15);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    doc.setTextColor(...(t.score != null ? t.color : GREY));
    doc.text(t.score != null ? String(t.score) : "—", x + 9, y + 37);
    if (t.score != null) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text("/100", x + 9 + doc.getTextWidth(String(t.score)) * 1.35 + 3, y + 37);
      // meter
      const mW = tileW - 18;
      doc.setFillColor(230, 235, 241);
      doc.rect(x + 9, y + 43, mW, 4, "F");
      doc.setFillColor(...t.color);
      doc.rect(x + 9, y + 43, (mW * Math.max(0, Math.min(100, t.score))) / 100, 4, "F");
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...t.color);
    doc.text(doc.splitTextToSize(t.note, tileW - 18)[0], x + 9, y + 57);
  });
  y += tileH + 2;

  // ---- profile links ------------------------------------------------------
  if (r.githubUrl || r.linkedinUrl) {
    y += 12;
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    const parts = [r.githubUrl ? `GitHub: ${r.githubUrl}` : "", r.linkedinUrl ? `LinkedIn: ${r.linkedinUrl}` : ""]
      .filter(Boolean)
      .join("     ");
    doc.text(doc.splitTextToSize(parts, contentW)[0], MARGIN, y);
    y += 4;
  }

  // ---- missing profile links ---------------------------------------------
  const ml = r.missingLinks;
  if (ml && (ml.github || ml.linkedin)) {
    const which = ml.github && ml.linkedin ? "GitHub or LinkedIn" : ml.github ? "GitHub" : "LinkedIn";
    keepTogether(34);
    y += 12;
    const boxTop = y;
    const boxH = 30;
    doc.setFillColor(255, 248, 230);
    doc.setDrawColor(243, 224, 166);
    doc.setLineWidth(0.7);
    doc.rect(MARGIN, boxTop, contentW, boxH, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(138, 97, 0);
    doc.text(`No ${which} profile provided`, MARGIN + 10, boxTop + 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      doc.splitTextToSize(
        "The resume did not contain it and the recruiter confirmed it was not available, so the corresponding check could not run.",
        contentW - 20
      )[0],
      MARGIN + 10,
      boxTop + 24
    );
    y = boxTop + boxH + 4;
  }

  // ---- fit assessment -----------------------------------------------------
  section("Fit assessment", r.rating, ratingColor(r.rating), () => {
    text(r.summary, MARGIN + 10, { w: contentW - 20 });
    y += 6;

    // Two columns: strengths | gaps.
    const colW = (contentW - 20 - 16) / 2;
    const leftX = MARGIN + 10;
    const rightX = leftX + colW + 16;
    const hStrength = (r.strengths ?? []).reduce((s, t) => s + measure(t, colW - 12, 9.5), 0) || 13;
    const hGap = (r.gaps ?? []).reduce((s, t) => s + measure(t, colW - 12, 9.5), 0) || 13;
    keepTogether(Math.max(hStrength, hGap) + 24);

    const colTop = y;
    text("Strengths", leftX, { size: 8.5, bold: true, color: MUTED, w: colW });
    bullets(r.strengths ?? [], leftX, colW);
    const leftEnd = y;

    y = colTop;
    text("Gaps", rightX, { size: 8.5, bold: true, color: MUTED, w: colW });
    bullets(r.gaps ?? [], rightX, colW);
    y = Math.max(leftEnd, y);

    // Skills as chips.
    if (r.skillMatches?.length) {
      y += 8;
      keepTogether(40);
      text("Skill match against the job description", leftX, { size: 8.5, bold: true, color: MUTED });
      y += 2;
      let cx = leftX;
      const chipH = 15;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      for (const s of r.skillMatches) {
        const c = s.status === "matched" ? GREEN : s.status === "partial" ? AMBER : RED;
        const bg: RGB =
          s.status === "matched" ? [230, 244, 234] : s.status === "partial" ? [253, 241, 220] : [253, 236, 236];
        const w = doc.getTextWidth(s.skill) + 14;
        if (cx + w > MARGIN + contentW - 10) {
          cx = leftX;
          y += chipH + 4;
          ensure(chipH + 4);
        }
        doc.setFillColor(...bg);
        doc.roundedRect(cx, y - 10, w, chipH, 4, 4, "F");
        doc.setTextColor(...c);
        doc.text(s.skill, cx + 7, y);
        cx += w + 5;
      }
      y += chipH;
    }
  });

  // ---- GitHub portfolio ---------------------------------------------------
  if (pf) {
    section("GitHub portfolio vs job description", `${pf.portfolioScore}/100 · ${pf.rating}`, scoreColor(pf.portfolioScore), () => {
      text(pf.summary, MARGIN + 10, { w: contentW - 20 });
      text(`Activity: ${pf.activityLevel}`, MARGIN + 10, { size: 8.5, color: MUTED });
      if (pf.redFlags?.length) {
        y += 4;
        text("Red flags", MARGIN + 10, { size: 8.5, bold: true, color: RED });
        bullets(pf.redFlags, MARGIN + 10, contentW - 20);
      }
      if (pf.relevantRepos?.length) {
        y += 8;
        text("Relevant repositories", MARGIN + 10, { size: 8.5, bold: true, color: MUTED });
        y += 2;
        for (const [i, repo] of pf.relevantRepos.entries()) {
          const metaW = contentW - 20;
          const h = measure(repo.whyRelevant, metaW - 12, 8.5, 11) + 15;
          keepTogether(h + 4);
          if (i % 2 === 1) {
            doc.setFillColor(...ZEBRA);
            doc.rect(MARGIN + 6, y - 10, contentW - 12, h + 3, "F");
          }
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.setTextColor(...INK);
          doc.text(repo.name, MARGIN + 12, y);
          const meta = [repo.language, repo.stars > 0 ? `${repo.stars} stars` : "", repo.lastPushed]
            .filter(Boolean)
            .join("  ·  ");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(...MUTED);
          doc.text(meta, MARGIN + 12 + doc.getTextWidth(repo.name) * 1.1 + 10, y);
          y += 12;
          text(repo.whyRelevant, MARGIN + 12, { size: 8.5, color: INK, w: metaW - 12, lh: 11 });
          y += 3;
        }
      }
      if (pf.skillEvidence?.length) {
        y += 6;
        keepTogether(40);
        text("Skill evidence in public code", MARGIN + 10, { size: 8.5, bold: true, color: MUTED });
        for (const e of pf.skillEvidence) {
          ensure(12);
          const c = e.status === "evidenced" ? GREEN : e.status === "partial" ? AMBER : RED;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.5);
          doc.setTextColor(...INK);
          const label = e.note ? `${e.skill} — ${e.note}` : e.skill;
          const lines = doc.splitTextToSize(label, contentW - 100);
          lines.forEach((line: string, i: number) => {
            ensure(11);
            doc.setTextColor(...INK);
            doc.text(line, MARGIN + 12, y);
            if (i === 0) {
              doc.setFont("helvetica", "bold");
              doc.setTextColor(...c);
              doc.text(e.status, MARGIN + contentW - 12 - doc.getTextWidth(e.status), y);
              doc.setFont("helvetica", "normal");
            }
            y += 11;
          });
        }
      }
      y += 2;
      text("Based only on public GitHub activity — private and employer work is invisible here.", MARGIN + 10, {
        size: 7.5,
        color: MUTED,
        w: contentW - 20,
        lh: 10,
      });
    });
  }

  // ---- LinkedIn check -----------------------------------------------------
  if (li) {
    section("LinkedIn profile check", `${li.verdict}${li.known > 0 ? ` · ${li.score}/100` : ""}`, ratingColor(li.verdict), () => {
      if (li.redFlags?.length) {
        text("Red flags", MARGIN + 10, { size: 8.5, bold: true, color: RED });
        bullets(li.redFlags, MARGIN + 10, contentW - 20);
        y += 4;
      }
      for (const s of li.signals) {
        ensure(12);
        const c = s.status === "good" ? GREEN : s.status === "weak" ? AMBER : s.status === "bad" ? RED : GREY;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...INK);
        doc.text(s.label, MARGIN + 12, y);
        doc.setTextColor(...MUTED);
        const detail = doc.splitTextToSize(s.detail, contentW - 210)[0] ?? "";
        doc.text(detail, MARGIN + 150, y);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...c);
        doc.text(s.status, MARGIN + contentW - 12 - doc.getTextWidth(s.status), y);
        y += 12;
      }
      y += 2;
      text(li.note, MARGIN + 10, { size: 7.5, color: MUTED, w: contentW - 20, lh: 10 });
    });
  }

  // ---- AI signal ----------------------------------------------------------
  const aiPct = aiPercentOf(r);
  const aiLines = normalizeAiLines(r.aiGeneratedLines);
  const aiColor =
    aiPct != null
      ? aiPct > 65 ? RED : aiPct >= 30 ? AMBER : GREEN
      : r.aiGeneratedLikelihood === "Low" ? GREEN : r.aiGeneratedLikelihood === "High" ? RED : AMBER;

  section(
    "AI-written content signal",
    aiPct != null ? `${aiPct}%${aiLines.length ? ` · ${aiLines.length} lines` : ""}` : r.aiGeneratedLikelihood,
    aiColor,
    () => {
      if (r.aiGeneratedConfidence) text(r.aiGeneratedConfidence, MARGIN + 10, { w: contentW - 20, color: MUTED });
      const jdKeywords = (r.skillMatches ?? []).map((s) => s.skill);
      if (aiLines.length) {
        y += 4;
        if (jdKeywords.length) {
          text("Highlighted = job-description skills present in the point.", MARGIN + 10, {
            size: 7.5,
            color: MUTED,
            lh: 10,
          });
        }
        for (const line of aiLines) {
          const prefix = Number.isFinite(line.score) ? `[${Math.round(line.score)}%] ` : "";
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.5);
          const startX = MARGIN + 22;
          const maxX = MARGIN + contentW - 10;
          ensure(12);
          doc.setTextColor(...RED);
          doc.text("▸", MARGIN + 12, y);
          let x = startX;
          const tokens: { w: string; hl: boolean }[] = [];
          if (prefix) tokens.push({ w: prefix, hl: false });
          for (const seg of highlightKeywords(line.text, jdKeywords)) {
            for (const part of seg.text.split(/(\s+)/)) {
              if (part.length) tokens.push({ w: part, hl: seg.match && part.trim().length > 0 });
            }
          }
          for (const t of tokens) {
            const wWidth = doc.getTextWidth(t.w);
            if (t.w.trim().length > 0 && x + wWidth > maxX) {
              y += 11;
              ensure(11);
              x = startX;
            }
            if (t.hl) {
              doc.setFillColor(...HL);
              doc.rect(x, y - 6.5, wWidth, 9, "F");
            }
            doc.setTextColor(...(t.hl ? INK : RED));
            doc.text(t.w, x, y);
            x += wWidth;
          }
          y += 12;
        }
      } else {
        text("No specific lines were flagged as AI-generated.", MARGIN + 10, { color: MUTED, w: contentW - 20 });
      }
      y += 2;
      text("A probabilistic signal, not proof — treat it as one input alongside human review.", MARGIN + 10, {
        size: 7.5,
        color: MUTED,
        lh: 10,
      });
    }
  );

  // ---- extracted details --------------------------------------------------
  const details: Array<[string, unknown]> = [
    ["Email", ex.email],
    ["Phone", ex.phone],
    ["Experience", ex.totalExperienceYears != null ? `${ex.totalExperienceYears} yrs` : ""],
    ["Current title", ex.currentTitle],
    ["Location", ex.location],
    ["GitHub", r.githubUrl],
    ["LinkedIn", r.linkedinUrl],
  ];
  const present = details.filter(([, v]) => v != null && v !== "");
  if (present.length) {
    section("Extracted details", null, MUTED, () => {
      const colW = (contentW - 20 - 16) / 2;
      for (let i = 0; i < present.length; i += 2) {
        ensure(14);
        const rowY = y;
        [present[i], present[i + 1]].forEach((pair, col) => {
          if (!pair) return;
          const x = MARGIN + 10 + col * (colW + 16);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(...MUTED);
          doc.text(String(pair[0]), x, rowY);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.setTextColor(...INK);
          doc.text(doc.splitTextToSize(String(pair[1]), colW)[0], x, rowY + 11);
        });
        y = rowY + 24;
      }
    });
  }

  // ---- footers ------------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.7);
    doc.line(MARGIN, pageH - 32, pageW - MARGIN, pageH - 32);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text("Cliff Recruiter Suite — confidential", MARGIN, pageH - 20);
    const pn = `Page ${p} of ${pages}`;
    doc.text(pn, pageW - MARGIN - doc.getTextWidth(pn), pageH - 20);
  }

  const safeName = (r.candidateName || "candidate").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  const stamp = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "report";
  return { doc, filename: `Resume_Assessment_${safeName || "candidate"}_${stamp}.pdf` };
}

export function downloadResumeReportPdf(r: ResumeReport): void {
  const { doc, filename } = buildResumeReportPdf(r);
  doc.save(filename);
}
