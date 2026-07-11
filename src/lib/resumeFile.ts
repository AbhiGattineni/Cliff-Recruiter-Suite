// Extract resume text from an uploaded file.
// Supported: plain text (.txt / .md) and Word (.docx) only.
// PDF and legacy .doc are intentionally rejected with a clear message.

import mammoth from "mammoth/mammoth.browser";

export const ACCEPTED_RESUME_TYPES = ".txt,.md,.docx";

export async function extractResumeText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return (await file.text()).trim();
  }

  if (name.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = (result.value || "").trim();
    if (!text) {
      throw new Error("Couldn't read any text from that .docx file. Try pasting the text instead.");
    }
    return text;
  }

  if (name.endsWith(".doc")) {
    throw new Error(
      "Legacy .doc files aren't supported. Please save the resume as .docx, or paste the text."
    );
  }
  if (name.endsWith(".pdf")) {
    throw new Error("PDF isn't supported. Please upload a .docx file, or paste the resume text.");
  }
  throw new Error("Unsupported file type. Please upload a .txt or .docx file, or paste the text.");
}
