import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Does every httpsCallable in the app reach a handler that exists?
//
// TypeScript cannot answer this. A callable's name and its `action` are plain
// strings crossing a network boundary, so a rename on one side of it compiles
// perfectly and fails at runtime, on a page nobody opens until it matters.
//
// It became worth pinning when twenty-two callables were merged into eleven:
// that collapse rewrote twenty-six call sites to pass an `action`, and a single
// typo in any of them would have been invisible until a user pressed the
// button.

const ROOT = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** callable name -> the actions it dispatches on ('' = no dispatch) */
function serverCallables(): Map<string, Set<string>> {
  const src = readFileSync(join(ROOT, "functions", "src", "index.ts"), "utf8");
  const out = new Map<string, Set<string>>();
  for (const m of src.matchAll(/^export const (\w+) = onCall\(/gm)) {
    const rest = src.slice(m.index! + m[0].length);
    const body = rest.slice(0, rest.indexOf("\n);"));
    // Two dispatch styles are in use: a switch, and a run of `if (action === )`.
    const actions = new Set<string>([
      ...[...body.matchAll(/case "([^"]+)":/g)].map((x) => x[1]),
      ...[...body.matchAll(/action === "([^"]+)"/g)].map((x) => x[1]),
    ]);
    out.set(m[1], actions);
  }
  return out;
}

interface Site {
  file: string;
  callable: string;
  actions: string[];
  dynamic: boolean;
}

function clientSites(): Site[] {
  const sites: Site[] = [];
  for (const file of walk(join(ROOT, "src"))) {
    const s = readFileSync(file, "utf8");
    const starts = [...s.matchAll(/httpsCallable</g)].map((m) => m.index!);
    starts.forEach((pos, i) => {
      // Stop at the next httpsCallable so one site cannot read another's action.
      const chunk = s.slice(pos, starts[i + 1] ?? s.length);
      const name = /functions,?\s*\n?\s*"(\w+)"/.exec(chunk);
      if (!name) return;
      sites.push({
        file: file.slice(ROOT.length + 1),
        callable: name[1],
        actions: [...chunk.matchAll(/action:\s*"([^"]+)"/g)].map((m) => m[1]),
        // e.g. `callable({ action, ... })` — the value is not a literal here.
        dynamic: /action[,:]\s*(?!")/.test(chunk),
      });
    });
  }
  return sites;
}

describe("callable wiring", () => {
  const server = serverCallables();
  const sites = clientSites();

  it("finds the call sites at all (guards the parser itself)", () => {
    expect(server.size).toBeGreaterThan(5);
    expect(sites.length).toBeGreaterThan(20);
  });

  it("every callable the client names exists on the server", () => {
    const missing = sites
      .filter((s) => !server.has(s.callable))
      .map((s) => `${s.file} -> ${s.callable}`);
    expect(missing).toEqual([]);
  });

  it("every action the client sends has a handler", () => {
    const missing: string[] = [];
    for (const s of sites) {
      const known = server.get(s.callable);
      if (!known) continue;
      for (const a of s.actions) {
        if (!known.has(a)) {
          missing.push(`${s.file} -> ${s.callable}("${a}") — handles: ${[...known].sort().join(", ")}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("no call site forgets the action a dispatching callable needs", () => {
    const silent = sites
      .filter((s) => (server.get(s.callable)?.size ?? 0) > 0 && s.actions.length === 0 && !s.dynamic)
      .map((s) => `${s.file} -> ${s.callable}`);
    expect(silent).toEqual([]);
  });
});
