// A regression suite for Ask Anything's query planner (planAskQuery in
// llm.ts). Not deployed -- no onCall export here, this only runs locally via
// `npm run eval:ask`.
//
// The point: every one of these cases is a real question that came back
// wrong in production before the prompt was fixed (wrong field, a redundant
// filter that silently zeroed results, a compound question that dropped half
// of what was asked). Each fix should turn into a permanent case here, run
// against the real model, so the next prompt edit gets checked before
// someone hits the same bug live instead of after.
//
// This complements, not replaces, askEngine.test.ts on the frontend: that
// suite covers the deterministic half of the pipeline (given a plan, is the
// number right) with fast, free, offline tests. This suite covers the half
// that can only be checked by actually asking the model something -- does it
// pick the right table and field for a plain-English question.

import { planAskQuery, LlmConfig } from "./llm.js";

export interface AskPlanLike {
  table?: string;
  filters?: Array<{ field?: string; op?: string; value?: unknown }>;
  dateFrom?: string | null;
  dateTo?: string | null;
  groupBy?: string | null;
  columns?: string[];
}

export interface EvalCase {
  name: string;
  question: string;
  priorPlan?: unknown;
  /** Return a list of failure reasons; empty array = pass. */
  check: (plan: AskPlanLike) => string[];
}

const hasFilterField = (plan: AskPlanLike, field: string) => (plan.filters ?? []).some((f) => f.field === field);
const filterOp = (plan: AskPlanLike, field: string) => (plan.filters ?? []).find((f) => f.field === field)?.op;
const hasColumn = (plan: AskPlanLike, col: string) => (plan.columns ?? []).includes(col);

export const EVAL_CASES: EvalCase[] = [
  {
    name: "recruiter-name -> recruiter field, not candidate",
    question: "how many submissions did Abhishek KC do",
    check: (p) => {
      const fails: string[] = [];
      if (p.table !== "submissions") fails.push(`expected table "submissions", got "${p.table}"`);
      if (!hasFilterField(p, "recruiter")) fails.push("expected a filter on `recruiter`");
      if (hasFilterField(p, "applicantName") || hasFilterField(p, "candidateName")) {
        fails.push("filtered on the candidate field instead of/as well as recruiter");
      }
      return fails;
    },
  },
  {
    name: "name filter prefers contains over eq",
    question: "submissions by abhishek kc for cognizant in august 2026",
    check: (p) => {
      const fails: string[] = [];
      if (p.table !== "submissions") fails.push(`expected table "submissions", got "${p.table}"`);
      if (!hasFilterField(p, "recruiter")) fails.push("expected a filter on `recruiter`");
      if (filterOp(p, "recruiter") === "eq") fails.push("recruiter filter used eq instead of contains");
      if (hasFilterField(p, "client") && filterOp(p, "client") === "eq") {
        fails.push("client filter used eq instead of contains");
      }
      if (p.dateFrom !== "2026-08-01" || p.dateTo !== "2026-08-31") {
        fails.push(`expected August 2026 range, got ${p.dateFrom}..${p.dateTo}`);
      }
      return fails;
    },
  },
  {
    name: "no redundant filter duplicating dateFrom/dateTo",
    question: "submissions this month by client, showing recruiter, candidate name and status",
    check: (p) => {
      const fails: string[] = [];
      if (p.table !== "submissions") fails.push(`expected table "submissions", got "${p.table}"`);
      if (hasFilterField(p, "submittedOn")) fails.push("filters duplicate the date field that dateFrom/dateTo already covers");
      if (!p.dateFrom || !p.dateTo) fails.push("expected dateFrom/dateTo to be set for \"this month\"");
      return fails;
    },
  },
  {
    name: "compound question keeps row-level detail, not just the aggregate",
    question:
      "Requirements received per client this month along with the recruiter submitted and candidate names and statuses",
    check: (p) => {
      const fails: string[] = [];
      if (p.table !== "submissions") {
        fails.push(`expected table "submissions" (row-level) so recruiter/candidate/status survive, got "${p.table}"`);
        return fails; // other columns don't apply on the wrong table
      }
      if (p.groupBy) fails.push(`expected groupBy null for a row list, got "${p.groupBy}"`);
      for (const col of ["client", "recruiter", "applicantName", "status"]) {
        if (!hasColumn(p, col)) fails.push(`expected "${col}" in columns`);
      }
      return fails;
    },
  },
  {
    name: "sanity: recruiter-index question still routes to recruiters table",
    question: "Which recruiters are below index 40 this month",
    check: (p) => (p.table === "recruiters" ? [] : [`expected table "recruiters", got "${p.table}"`]),
  },
  {
    name: "sanity: resume-quality question still routes to resumes table",
    question: "Candidates rated Strong with a high AI-generated score",
    check: (p) => (p.table === "resumes" ? [] : [`expected table "resumes", got "${p.table}"`]),
  },
];

export interface EvalResult {
  name: string;
  question: string;
  passed: boolean;
  reasons: string[];
  plan: unknown;
}

export async function runAskEval(config: LlmConfig, cases: EvalCase[] = EVAL_CASES): Promise<EvalResult[]> {
  const today = new Date().toISOString().slice(0, 10);
  const results: EvalResult[] = [];
  for (const c of cases) {
    try {
      const { plan } = await planAskQuery(c.question, c.priorPlan ?? null, today, config);
      const reasons = c.check(plan as AskPlanLike);
      results.push({ name: c.name, question: c.question, passed: reasons.length === 0, reasons, plan });
    } catch (e) {
      results.push({
        name: c.name,
        question: c.question,
        passed: false,
        reasons: [`threw: ${e instanceof Error ? e.message : String(e)}`],
        plan: null,
      });
    }
  }
  return results;
}

// `node lib/askEval.js` — reads the same LLM config the deployed function
// would use, but from process.env (no Secret Manager binding available
// outside a Cloud Functions runtime). Same provider-preference order as
// pickLlm() in index.ts: OpenAI first if configured, else Ollama.
async function main() {
  const openaiKey = process.env.OPENAI_API_KEY || "";
  const ollamaKey = process.env.LLM_API_KEY || "";
  let config: LlmConfig;
  if (openaiKey) {
    config = { baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", apiKey: openaiKey, model: "gpt-4o-mini" };
  } else if (ollamaKey) {
    config = {
      baseUrl: process.env.LLM_BASE_URL || "https://ollama.com/v1",
      apiKey: ollamaKey,
      model: process.env.LLM_MODEL || "gpt-oss:20b",
    };
  } else {
    console.error("Set OPENAI_API_KEY or LLM_API_KEY in the environment to run this.");
    process.exit(1);
  }

  const results = await runAskEval(config);
  let failCount = 0;
  for (const r of results) {
    console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.name}`);
    if (!r.passed) {
      failCount++;
      console.log(`      Q: ${r.question}`);
      for (const reason of r.reasons) console.log(`      - ${reason}`);
      console.log(`      plan: ${JSON.stringify(r.plan)}`);
    }
  }
  console.log(`\n${results.length - failCount}/${results.length} passed`);
  if (failCount > 0) process.exit(1);
}

// Only ever invoked directly (`node lib/askEval.js`) — nothing else imports
// this module, so there's no risk of main() firing as a side effect elsewhere.
void main();
