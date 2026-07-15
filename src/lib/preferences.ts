// Simple client-side feature preferences (localStorage). Central place for toggles.

const AI_KEY = "prefs.useAI";

/** Whether AI/LLM features are enabled (default: on). */
export function getUseAI(): boolean {
  const v = localStorage.getItem(AI_KEY);
  return v === null ? true : v === "1";
}

export function setUseAI(on: boolean): void {
  localStorage.setItem(AI_KEY, on ? "1" : "0");
}
