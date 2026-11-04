import { describe, expect, it } from "vitest";
import { escapeCsvCell, toCsv } from "../src/core/csv";
import { EXERCISES } from "../src/core/exercises";
import { PostureMonitor, cueForEvent } from "../src/core/feedback";
import {
  STORAGE_KEY,
  clearSets,
  loadSets,
  saveSets,
  setsToCsv,
  summarize,
  type SetRecord,
  type StorageLike,
} from "../src/core/session";

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

/** Behaves like localStorage in a locked-down browser: every call throws. */
const throwingStorage: StorageLike = {
  getItem() {
    throw new DOMException("denied", "SecurityError");
  },
  setItem() {
    throw new DOMException("quota", "QuotaExceededError");
  },
  removeItem() {
    throw new DOMException("denied", "SecurityError");
  },
};

const sample: SetRecord = {
  id: "a1",
  exercise: "squat",
  reps: 12,
  durationMs: 61_500,
  startedAt: "2026-11-04T09:30:00.000Z",
};

describe("CSV escaping", () => {
  it("leaves plain cells alone", () => {
    expect(escapeCsvCell("Squat")).toBe("Squat");
    expect(escapeCsvCell(12)).toBe("12");
    expect(escapeCsvCell(-3.5)).toBe("-3.5"); // numbers are never formula-guarded
  });

  it("quotes cells with commas, quotes, or line breaks and doubles inner quotes", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("two\nlines")).toBe('"two\nlines"');
    expect(escapeCsvCell("cr\rhere")).toBe('"cr\rhere"');
  });

  it("neutralises spreadsheet formulas (CSV injection)", () => {
    expect(escapeCsvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(escapeCsvCell("+1")).toBe("'+1");
    expect(escapeCsvCell("-1")).toBe("'-1");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("writes empty cells for null, undefined and non-finite numbers", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
    expect(escapeCsvCell(Number.NaN)).toBe("");
  });

  it("joins rows with CRLF and ends with one", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});

describe("session log export", () => {
  it("exports sets as CSV with readable names and durations", () => {
    const csv = setsToCsv([sample, { ...sample, id: "b", exercise: "curl", reps: 15, detail: "L 8 · R 7" }]);
    expect(csv.split("\r\n")).toEqual([
      "started_at,exercise,reps,duration_s,duration,detail",
      "2026-11-04T09:30:00.000Z,Squat,12,61.5,1:01,",
      "2026-11-04T09:30:00.000Z,Bicep curl,15,61.5,1:01,L 8 · R 7",
      "",
    ]);
  });

  it("summarises totals", () => {
    expect(summarize([sample, sample])).toEqual({ sets: 2, reps: 24, durationMs: 123_000 });
    expect(summarize([])).toEqual({ sets: 0, reps: 0, durationMs: 0 });
  });
});

describe("persistence", () => {
  it("round-trips through storage", () => {
    const s = new MemoryStorage();
    expect(saveSets(s, [sample])).toBe(true);
    expect(loadSets(s)).toEqual([sample]);
    expect(clearSets(s)).toBe(true);
    expect(loadSets(s)).toEqual([]);
  });

  it("survives corrupt JSON and drops malformed records", () => {
    const s = new MemoryStorage();
    s.setItem(STORAGE_KEY, "{not json");
    expect(loadSets(s)).toEqual([]);
    s.setItem(
      STORAGE_KEY,
      JSON.stringify([
        sample,
        { ...sample, exercise: "deadlift" },
        { ...sample, reps: -1 },
        { ...sample, reps: 2.5 },
        { ...sample, startedAt: "yesterday-ish" },
        null,
        "string",
      ]),
    );
    expect(loadSets(s)).toEqual([sample]);
    s.setItem(STORAGE_KEY, JSON.stringify({ not: "an array" }));
    expect(loadSets(s)).toEqual([]);
  });

  it("never throws when storage is unavailable or hostile", () => {
    expect(loadSets(null)).toEqual([]);
    expect(saveSets(null, [sample])).toBe(false);
    expect(loadSets(throwingStorage)).toEqual([]);
    expect(saveSets(throwingStorage, [sample])).toBe(false);
    expect(clearSets(throwingStorage)).toBe(false);
  });

  it("caps the stored history", () => {
    const s = new MemoryStorage();
    const many = Array.from({ length: 520 }, (_, i) => ({ ...sample, id: String(i) }));
    saveSets(s, many);
    const loaded = loadSets(s);
    expect(loaded).toHaveLength(500);
    expect(loaded[0]!.id).toBe("20"); // oldest dropped first
  });
});

describe("feedback", () => {
  const rule = EXERCISES.pushup.posture[0]!;

  it("maps counter events to exercise-specific cues", () => {
    const def = EXERCISES.curl;
    expect(cueForEvent(def, { type: "shallow", extreme: 80 })?.text).toBe("Curl all the way up");
    expect(cueForEvent(def, { type: "incomplete", extreme: 100 })?.text).toBe("Lower all the way down");
    expect(cueForEvent(def, { type: "rep", count: 1, extreme: 40 })?.tone).toBe("good");
    expect(cueForEvent(def, { type: "lost" })?.tone).toBe("info");
    expect(cueForEvent(def, null)).toBeNull();
  });

  it("posture monitor requires a sustained fault and resets on a good or missing frame", () => {
    const m = new PostureMonitor(rule, 3);
    expect(m.update(140)).toBeNull();
    expect(m.update(140)).toBeNull();
    expect(m.update(140)?.text).toBe(rule.message);
    expect(m.update(170)).toBeNull();
    m.update(140);
    m.update(140);
    expect(m.update(null)).toBeNull();
    expect(m.update(140)).toBeNull();
  });
});
