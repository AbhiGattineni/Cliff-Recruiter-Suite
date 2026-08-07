// Client side of the merged `ai` Cloud Function.
//
// parseResume, matchCandidatesToJd, githubPortfolio, githubSearch and
// llmAvailability used to be five separate functions. Each `onCall` is its own
// Cloud Run service holding reserved CPU, and the project kept exceeding the
// region's allowable-CPU quota, so they now share one service and branch on
// `action`.

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export type AiAction =
  | "parseResume"
  | "matchCandidatesToJd"
  | "githubPortfolio"
  | "githubSearch"
  | "llmAvailability";

/** Invoke one action on the shared AI function. */
export async function callAi<TIn extends object, TOut>(
  action: AiAction,
  data: TIn,
  opts?: { timeout?: number }
): Promise<TOut> {
  const callable = httpsCallable<{ action: AiAction } & TIn, TOut>(functions, "ai", opts);
  const res = await callable({ action, ...data });
  return res.data;
}
