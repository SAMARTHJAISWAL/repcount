/**
 * The session log: completed sets, persisted to a Storage-like object (localStorage in
 * the browser). Storage can be missing or throw (private mode, blocked site data, quota),
 * so every access is guarded and the app keeps working in memory if it fails.
 */
import { toCsv } from "./csv";
import { EXERCISES, isExerciseId, type ExerciseId } from "./exercises";
import { formatDuration } from "./format";

export interface SetRecord {
  readonly id: string;
  readonly exercise: ExerciseId;
  readonly reps: number;
  readonly durationMs: number;
  /** ISO 8601 timestamp of when the set started. */
  readonly startedAt: string;
  /** Optional breakdown, e.g. "L 8 · R 7" for curls. */
  readonly detail?: string;
}

/** The subset of the Web Storage API we use; lets tests pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = "repcount.sets.v1";
const MAX_RECORDS = 500;

function isSetRecord(value: unknown): value is SetRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    isExerciseId(r.exercise) &&
    typeof r.reps === "number" &&
    Number.isInteger(r.reps) &&
    r.reps >= 0 &&
    typeof r.durationMs === "number" &&
    Number.isFinite(r.durationMs) &&
    r.durationMs >= 0 &&
    typeof r.startedAt === "string" &&
    !Number.isNaN(Date.parse(r.startedAt)) &&
    (r.detail === undefined || typeof r.detail === "string")
  );
}

/** Read the log. Corrupt JSON or malformed entries are skipped rather than crashing the app. */
export function loadSets(storage: StorageLike | null): SetRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSetRecord) : [];
  } catch {
    return [];
  }
}

/** Write the log. Returns false if storage is unavailable or the write failed. */
export function saveSets(storage: StorageLike | null, sets: readonly SetRecord[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(sets.slice(-MAX_RECORDS)));
    return true;
  } catch {
    return false;
  }
}

export function clearSets(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export const CSV_HEADER = ["started_at", "exercise", "reps", "duration_s", "duration", "detail"] as const;

export function setsToCsv(sets: readonly SetRecord[]): string {
  return toCsv(
    CSV_HEADER,
    sets.map((s) => [
      s.startedAt,
      EXERCISES[s.exercise].name,
      s.reps,
      Math.round(s.durationMs / 100) / 10,
      formatDuration(s.durationMs),
      s.detail ?? "",
    ]),
  );
}

export interface SessionSummary {
  readonly sets: number;
  readonly reps: number;
  readonly durationMs: number;
}

export function summarize(sets: readonly SetRecord[]): SessionSummary {
  return sets.reduce<SessionSummary>(
    (acc, s) => ({ sets: acc.sets + 1, reps: acc.reps + s.reps, durationMs: acc.durationMs + s.durationMs }),
    { sets: 0, reps: 0, durationMs: 0 },
  );
}
