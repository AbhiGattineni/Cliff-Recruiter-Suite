// Generate a formatted one/two-page PDF for a single resume assessment.

import { jsPDF } from "jspdf";
import { ResumeReport } from "./resumeReports";

const BRAND: [number, number, number] = [31, 78, 120]; // #1F4E78
const INK: [number, number, number] = [31, 41, 51];
const MUTED: [number, number, number] = [107, 114, 128];
const GREEN: [number, number, number] = [30, 126, 52];
const AMBER: [number, number, number] = [169, 112, 10];
const RED: [number, number, number] = [156, 0, 6];

function ratingColor(rating: string): [number, number, number] {
  if (rating === "Strong") return GREEN;
  if (rating === "Weak") return RED;
  return AMBER;
}

export function downloadResumeReportPdf(r: ResumeReport): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = 0;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const heading = (text: string) => {
    ensureSpace(28);
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...BRAND);
    doc.text(text, margin, y);
    y += 6;
    doc.setDrawColor(220, 226, 232);
    doc.line(margin, y, margin + contentW, y);
    y += 12;
  };

  const paragraph = (text: string, opts: { size?: number; color?: [number, number, number]; bold?: boolean } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(...(opts.color ?? INK));
    const lines = doc.splitTextToSize(text || "-", contentW);
    for (const line of lines) {
      ensureSpace(14);
      doc.text(line, margin, y);
      y += 14;
    }
  };

  const bullets = (items: string[]) => {
    if (!items || items.length === 0) {
      paragraph("None noted.", { color: MUTED });
      return;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    for (const it of items) {
      const lines = doc.splitTextToSize(it, contentW - 16);
      lines.forEach((line: string, i: number) => {
        ensureSpace(14);
        if (i === 0) doc.text("•", margin, y);
        doc.text(line, margin + 14, y);
        y += 14;
      });
    }
  };

  // ---- Header band ----
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageW, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Cliff Recruiter Suite", margin, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Resume Fit Assessment", margin, 52);
  y = 96;

  // ---- Candidate + meta ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text(r.candidateName || "Candidate", margin, y);
  y += 20;

  const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleString() : "—";
  paragraph(
    `Generated: ${dateStr}    •    Model: ${r.provider} / ${r.model}`,
    { size: 9, color: MUTED }
  );
  y += 4;

  // ---- Score + rating row ----
  ensureSpace(60);
  const score = Math.max(0, Math.min(100, Math.round(Number(r.fitScore) || 0)));
  doc.setFillColor(232, 240, 248);
  doc.roundedRect(margin, y, 120, 54, 6, 6, "F");
  doc.setTextColor(...BRAND);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text(String(score), margin + 16, y + 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Fit score / 100", margin + 16, y + 47);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...ratingColor(r.rating));
  doc.text(`Rating: ${r.rating}`, margin + 140, y + 22);
  doc.setFontSize(11);
  const aiColor = r.aiGeneratedLikelihood === "Low" ? GREEN : r.aiGeneratedLikelihood === "High" ? RED : AMBER;
  doc.setTextColor(...aiColor);
  doc.text(`AI-generated: ${r.aiGeneratedLikelihood}`, margin + 140, y + 42);
  y += 66;

  // ---- Sections ----
  heading("Summary");
  paragraph(r.summary);

  heading("Strengths");
  bullets(r.strengths || []);

  heading("Gaps");
  bullets(r.gaps || []);

  heading("Skill match");
  if (r.skillMatches && r.skillMatches.length) {
    for (const s of r.skillMatches) {
      ensureSpace(14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(`• ${s.skill}`, margin, y);
      const c = s.status === "matched" ? GREEN : s.status === "partial" ? AMBER : RED;
      doc.setTextColor(...c);
      doc.setFont("helvetica", "bold");
      doc.text(s.status, margin + contentW - 80, y);
      y += 14;
    }
  } else {
    paragraph("No skills listed.", { color: MUTED });
  }

  heading("AI-generated content signal");
  paragraph(`${r.aiGeneratedLikelihood} likelihood. ${r.aiGeneratedConfidence || ""}`);
  const aiLines = r.aiGeneratedLines ?? [];
  if (aiLines.length) {
    paragraph(`Lines that read as AI-generated (${aiLines.length}):`, { bold: true, color: RED });
    for (const line of aiLines) {
      const wrapped = doc.splitTextToSize(line, contentW - 16);
      wrapped.forEach((ln: string, i: number) => {
        ensureSpace(13);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...RED);
        if (i === 0) doc.text("▸", margin, y);
        doc.text(ln, margin + 14, y);
        y += 13;
      });
    }
  }
  paragraph("This is a probabilistic signal, not proof — treat it as one input alongside human review.", {
    size: 8,
    color: MUTED,
  });

  heading("Extracted details");
  const ex = r.extracted || {};
  const details = [
    ["Email", ex.email],
    ["Phone", ex.phone],
    ["Experience (years)", ex.totalExperienceYears],
    ["Current title", ex.currentTitle],
    ["Location", ex.location],
  ].filter(([, v]) => v != null && v !== "");
  if (details.length) {
    for (const [k, v] of details) {
      ensureSpace(14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(`${k}: `, margin, y);
      const kw = doc.getTextWidth(`${k}: `);
      doc.setFont("helvetica", "normal");
      doc.text(String(v), margin + kw, y);
      y += 14;
    }
  } else {
    paragraph("None extracted.", { color: MUTED });
  }

  // Footer page numbers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("Cliff Recruiter Suite — Confidential", margin, pageH - 24);
    doc.text(`Page ${p} of ${pages}`, pageW - margin - 60, pageH - 24);
  }

  const safeName = (r.candidateName || "candidate").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  const stamp = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "report";
  doc.save(`Resume_Assessment_${safeName || "candidate"}_${stamp}.pdf`);
}
