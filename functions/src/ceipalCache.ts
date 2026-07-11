// Firestore-backed cache for the fetched Ceipal report rows.
//
// A full Ceipal pull can exceed the function timeout, so we cache the rows and
// serve reads from the cache. Rows are chunked across sub-docs to stay under the
// 1 MB Firestore document limit.

import { getFirestore, FieldValue } from "firebase-admin/firestore";

const ROWS_PER_CHUNK = 100; // job_duration rows are wide (70 cols) — keep chunks small
const BATCH_LIMIT = 300;

export interface CachedReport {
  rows: unknown[];
  totalAvailable: number;
  fetchedAt: number; // epoch ms (0 if unknown)
}

function baseDoc(report: string) {
  return getFirestore().collection("ceipalCache").doc(report);
}

/** Replace the cached rows for a report. */
export async function writeCache(report: string, rows: unknown[], totalAvailable: number): Promise<void> {
  const db = getFirestore();
  const base = baseDoc(report);
  const chunks = base.collection("chunks");

  // Clear existing chunks.
  const existing = await chunks.get();
  let batch = db.batch();
  let ops = 0;
  for (const d of existing.docs) {
    batch.delete(d.ref);
    if (++ops >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops) await batch.commit();

  // Write new chunks.
  const chunkCount = Math.ceil(rows.length / ROWS_PER_CHUNK);
  batch = db.batch();
  ops = 0;
  for (let i = 0; i < chunkCount; i++) {
    batch.set(chunks.doc(String(i)), { rows: rows.slice(i * ROWS_PER_CHUNK, (i + 1) * ROWS_PER_CHUNK) });
    if (++ops >= BATCH_LIMIT) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops) await batch.commit();

  await base.set({
    fetchedAt: FieldValue.serverTimestamp(),
    fetchedAtMs: Date.now(),
    recordCount: rows.length,
    totalAvailable,
    chunkCount,
  });
}

export interface CacheMeta {
  recordCount: number;
  totalAvailable: number;
  fetchedAt: number;
  chunkCount: number;
}

/** Read just the cache metadata (no rows) — cheap freshness check. */
export async function readCacheMeta(report: string): Promise<CacheMeta | null> {
  const meta = await baseDoc(report).get();
  if (!meta.exists) return null;
  const m = meta.data() as { recordCount?: number; totalAvailable?: number; fetchedAtMs?: number; chunkCount?: number };
  return {
    recordCount: m.recordCount ?? 0,
    totalAvailable: m.totalAvailable ?? 0,
    fetchedAt: m.fetchedAtMs ?? 0,
    chunkCount: m.chunkCount ?? 0,
  };
}

/** Read the cached rows for a report, or null if nothing is cached. */
export async function readCache(report: string): Promise<CachedReport | null> {
  const base = baseDoc(report);
  const meta = await base.get();
  if (!meta.exists) return null;
  const m = meta.data() as { chunkCount?: number; totalAvailable?: number; fetchedAtMs?: number };
  const chunkCount = m.chunkCount ?? 0;

  const snap = await base.collection("chunks").get();
  const byId = new Map<number, unknown[]>();
  snap.docs.forEach((d) => byId.set(Number(d.id), (d.data().rows as unknown[]) ?? []));

  const rows: unknown[] = [];
  for (let i = 0; i < chunkCount; i++) rows.push(...(byId.get(i) ?? []));
  return { rows, totalAvailable: m.totalAvailable ?? rows.length, fetchedAt: m.fetchedAtMs ?? 0 };
}

/** Build the report envelope the client expects from cached rows. */
export function cacheEnvelope(c: CachedReport) {
  return {
    result: c.rows,
    record_count: c.rows.length,
    total_available: c.totalAvailable,
    cachedAt: c.fetchedAt,
    cached: true,
  };
}
