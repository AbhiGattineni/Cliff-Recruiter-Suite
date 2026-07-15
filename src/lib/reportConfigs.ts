// Save / load named Report Generation configurations (scope + filters).

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { ensureConfigured } from "./errors";
import { currentActor, Actor } from "./auth";

export interface ReportConfigData {
  source: "api" | "upload";
  maxRecords: number;
  search: string;
  selFilters: Record<string, string[]>;
  submittedFrom: string;
  submittedTo: string;
  createdFrom: string;
  createdTo: string;
  visibleCols?: string[];
}

export interface SavedReportConfig {
  id: string;
  name: string;
  config: ReportConfigData;
  createdAt: number | null;
  createdByName?: string;
  createdByEmail?: string;
}

export async function saveReportConfig(name: string, config: ReportConfigData): Promise<string> {
  ensureConfigured();
  const callable = httpsCallable<
    { name: string; config: ReportConfigData; by: Actor },
    { ok: boolean; id?: string }
  >(functions, "saveReportConfig");
  const res = await callable({ name, config, by: currentActor() });
  return res.data?.id ?? "";
}

export async function listReportConfigs(): Promise<SavedReportConfig[]> {
  ensureConfigured();
  const callable = httpsCallable<Record<string, never>, { ok: boolean; configs: SavedReportConfig[] }>(
    functions,
    "listReportConfigs"
  );
  const res = await callable({});
  return res.data?.configs ?? [];
}

export async function deleteReportConfig(id: string): Promise<void> {
  ensureConfigured();
  const callable = httpsCallable<{ id: string }, { ok: boolean }>(functions, "deleteReportConfig");
  await callable({ id });
}
