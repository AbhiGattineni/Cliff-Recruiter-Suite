// The EmailJS credentials the digest sends through.
//
// Stored in Firestore rather than as a Cloud Functions secret so that an admin
// can set them, rotate them and fix a typo in them from this page, with no
// deploy in the loop. firestore.rules restricts the document to admins, both
// read and write — the private key is in it.
//
// The Cloud Function reads the same document through the Admin SDK, so what is
// saved here is what the 22:30 job will use.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { AppError, ensureConfigured } from "./errors";

const PATH = ["appSettings", "emailjs"] as const;

export interface EmailJsSettings {
  serviceId: string;
  templateId: string;
  publicKey: string;
  privateKey: string;
}

export const EMPTY_EMAILJS: EmailJsSettings = {
  serviceId: "",
  templateId: "",
  publicKey: "",
  privateKey: "",
};

/** The template variable names the Cloud Function sends. */
export const TEMPLATE_VARS = ["to_email", "subject", "message", "message_html"] as const;

export async function getEmailJsSettings(): Promise<EmailJsSettings> {
  ensureConfigured();
  const snap = await getDoc(doc(db, ...PATH));
  if (!snap.exists()) return EMPTY_EMAILJS;
  const d = snap.data() as Record<string, unknown>;
  const s = (k: keyof EmailJsSettings) => String(d[k] ?? "").trim();
  return {
    serviceId: s("serviceId"),
    templateId: s("templateId"),
    publicKey: s("publicKey"),
    privateKey: s("privateKey"),
  };
}

export async function saveEmailJsSettings(v: EmailJsSettings): Promise<void> {
  ensureConfigured();
  const trimmed: EmailJsSettings = {
    serviceId: v.serviceId.trim(),
    templateId: v.templateId.trim(),
    publicKey: v.publicKey.trim(),
    privateKey: v.privateKey.trim(),
  };
  // All four or none. A partially-filled document reads as "configured" to
  // nobody and produces an EmailJS error hours later in a log nobody is
  // watching, so the refusal happens here where someone is looking at it.
  const blanks = blankFields(trimmed);
  if (blanks.length > 0 && blanks.length < 4) {
    throw new AppError(`EmailJS needs all four values — still blank: ${blanks.join(", ")}.`);
  }
  await setDoc(doc(db, ...PATH), trimmed);
}

/** Which of the four are empty, in the order they appear on the form. */
export function blankFields(v: EmailJsSettings): (keyof EmailJsSettings)[] {
  const order: (keyof EmailJsSettings)[] = ["serviceId", "templateId", "publicKey", "privateKey"];
  return order.filter((k) => !v[k].trim());
}

export function emailJsConfigured(v: EmailJsSettings): boolean {
  return blankFields(v).length === 0;
}
