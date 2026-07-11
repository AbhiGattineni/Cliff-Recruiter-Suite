// Client wrapper for listing saved resume assessments (Resume Reports tab).

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";
import { ResumeAssessment, ProviderId } from "./resume";

export interface ResumeReport extends ResumeAssessment {
  id: string;
  provider: ProviderId;
  model: string;
  jobDescriptionPreview?: string;
  createdAt: number | null; // epoch ms
}

interface ListResponse {
  ok: boolean;
  reports: ResumeReport[];
}

export async function listResumeReports(limit = 200): Promise<ResumeReport[]> {
  ensureConfigured();
  const callable = httpsCallable<{ limit: number }, ListResponse>(functions, "listResumeReports");
  const res = await callable({ limit });
  return res.data?.reports ?? [];
}
