import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "./styles.css";

import { Gauge } from "./app/gauge";
import { Overlay, readTheme, type Highlight, type OverlayTheme } from "./app/overlay";
import { loadPoseDetector, type PoseDetector } from "./app/pose";
import { EXERCISES, EXERCISE_ORDER, isExerciseId, type ExerciseId } from "./core/exercises";
import type { Cue } from "./core/feedback";
import { formatDuration } from "./core/format";
import type { Landmark } from "./core/landmarks";
import type { Phase } from "./core/repCounter";
import { clearSets, loadSets, saveSets, setsToCsv, summarize, type SetRecord, type StorageLike } from "./core/session";
import { Stopwatch } from "./core/stopwatch";
import { DEFAULT_TRACKER_OPTIONS, ExerciseTracker, type ArmMode, type TrackerFrame } from "./core/tracker";

// ---------------------------------------------------------------------------
// DOM

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const ui = {
  stage: $("stage"),
  video: $<HTMLVideoElement>("video"),
  canvas: $<HTMLCanvasElement>("overlay"),
  status: $("status"),
  cue: $("cue"),
  cameraTip: $("camera-tip"),
  btnCamera: $<HTMLButtonElement>("btn-camera"),
  fileInput: $<HTMLInputElement>("file-input"),
  btnMirror: $<HTMLButtonElement>("btn-mirror"),
  btnSource: $<HTMLButtonElement>("btn-source"),
  exerciseOptions: $("exercise-options"),
  armPicker: $<HTMLFieldSetElement>("arm-picker"),
  reps: $<HTMLOutputElement>("reps"),
  repsDetail: $("reps-detail"),
  gaugeAngle: $("gauge-angle"),
  gaugeCaption: $("gauge-caption"),
  phase: $("phase"),
  timer: $("timer"),
  btnStart: $<HTMLButtonElement>("btn-start"),
  btnFinish: $<HTMLButtonElement>("btn-finish"),
  btnReset: $<HTMLButtonElement>("btn-reset"),
  btnExport: $<HTMLButtonElement>("btn-export"),
  btnClear: $<HTMLButtonElement>("btn-clear"),
  logEmpty: $("log-empty"),
  logTable: $<HTMLTableElement>("log-table"),
  logBody: $("log-body"),
  logTotal: $("log-total"),
  announcer: $("announcer"),
};

// ---------------------------------------------------------------------------
// Storage: may be unavailable (private mode, blocked site data) or throw on access.

const storage: StorageLike | null = (() => {
  try {
    const s = window.localStorage;
    const probe = "repcount.probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
})();

function readPref(key: string): string | null {
  try {
    return storage?.getItem(`repcount.pref.${key}`) ?? null;
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    storage?.setItem(`repcount.pref.${key}`, value);
  } catch {
    /* preferences are a convenience; ignore */
  }
}

// ---------------------------------------------------------------------------
// State

const PHASE_LABELS: Record<ExerciseId, Record<Phase, string>> = {
  squat: { idle: "Stand tall to begin", rest: "Standing", active: "Bottom" },
  pushup: { idle: "Get into the top position", rest: "Top", active: "Bottom" },
  curl: { idle: "Arms straight to begin", rest: "Down", active: "Up" },
  jack: { idle: "Arms down to begin", rest: "Arms down", active: "Arms up" },
};

type Source = "none" | "camera" | "file";

const state = {
  detector: null as PoseDetector | null,
  modelError: false,
  source: "none" as Source,
  stream: null as MediaStream | null,
  fileUrl: null as string | null,
  mirrored: true,
  exercise: (isExerciseId(readPref("exercise")) ? readPref("exercise") : "squat") as ExerciseId,
  armMode: "both" as ArmMode,
  running: false,
  setStartedAt: null as Date | null,
  sets: loadSets(storage),
  lastVideoTime: -1,
  lastLandmarks: null as Landmark[] | null,
  lastFrame: null as TrackerFrame | null,
  notVisibleFrames: 0,
  cue: null as (Cue & { until: number }) | null,
  /** A message (camera denied, storage failed…) that outranks the routine status for a while. */
  notice: null as { text: string; tone: "info" | "good" | "warn"; until: number } | null,
  theme: null as OverlayTheme | null,
  wakeLock: null as WakeLockSentinel | null,
};

const stopwatch = new Stopwatch();
const overlay = new Overlay(ui.canvas);
const gauge = new Gauge($("gauge"));
let tracker = makeTracker();
/** Tracks the pose while paused so the gauge and overlay stay live without counting. */
let preview = makeTracker();

function makeTracker(): ExerciseTracker {
  return new ExerciseTracker(EXERCISES[state.exercise], { ...DEFAULT_TRACKER_OPTIONS, armMode: state.armMode });
}

// ---------------------------------------------------------------------------
// Exercise picker

function buildExercisePicker(): void {
  ui.exerciseOptions.replaceChildren(
    ...EXERCISE_ORDER.map((id, i) => {
      const def = EXERCISES[id];
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "exercise";
      input.value = id;
      input.checked = id === state.exercise;
      input.setAttribute("aria-keyshortcuts", String(i + 1));
      input.addEventListener("change", () => input.checked && selectExercise(id));
      const span = document.createElement("span");
      span.textContent = def.name;
      label.append(input, span);
      return label;
    }),
  );
}

function selectExercise(id: ExerciseId): void {
  if (id === state.exercise) return;
  autoLogIfNeeded();
  state.exercise = id;
  writePref("exercise", id);
  const radio = ui.exerciseOptions.querySelector<HTMLInputElement>(`input[value="${id}"]`);
  if (radio) radio.checked = true;
  rebuildTrackers();
}

function rebuildTrackers(): void {
  resetSet();
  tracker = makeTracker();
  preview = makeTracker();
  const def = EXERCISES[state.exercise];
  ui.armPicker.hidden = def.strategy !== "per-arm";
  gauge.setThresholds(def.thresholds);
  ui.gaugeCaption.textContent = `${def.jointLabel} angle`;
  ui.cameraTip.textContent = `Tip: ${def.cameraTip}.`;
  state.cue = null;
  render();
}

for (const input of ui.armPicker.querySelectorAll<HTMLInputElement>('input[name="arm"]')) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    autoLogIfNeeded();
    state.armMode = input.value as ArmMode;
    rebuildTrackers();
  });
}

// ---------------------------------------------------------------------------
// Sources

function setStageState(s: "empty" | "live"): void {
  ui.stage.dataset.state = s;
  ui.stage.style.aspectRatio = "";
}

/** Match the stage to the video's shape so a portrait phone camera isn't letterboxed. */
ui.video.addEventListener("resize", fitStage);
ui.video.addEventListener("loadedmetadata", fitStage);
function fitStage(): void {
  const { videoWidth: w, videoHeight: h } = ui.video;
  if (ui.stage.dataset.state === "live" && w > 0 && h > 0) ui.stage.style.aspectRatio = `${w} / ${h}`;
}

function stopSource(): void {
  pause();
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
  state.fileUrl = null;
  ui.video.removeAttribute("src");
  ui.video.srcObject = null;
  ui.video.load();
  state.source = "none";
  state.lastVideoTime = -1;
  state.lastLandmarks = null;
  overlay.clear();
}

async function useCamera(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    showNotice("This browser can't access a camera here. Try uploading a video.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    stopSource();
    state.stream = stream;
    state.source = "camera";
    setMirrored(true);
    ui.video.srcObject = stream;
    await ui.video.play();
    setStageState("live");
    fitStage();
    afterSourceChange();
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    const msg =
      name === "NotAllowedError"
        ? "Camera permission was denied. You can still upload a video."
        : name === "NotFoundError" || name === "OverconstrainedError"
          ? "No camera found. Try uploading a video instead."
          : "Couldn't start the camera. Try uploading a video instead.";
    showNotice(msg);
  }
}

function useFile(file: File): void {
  if (!file.type.startsWith("video/")) {
    showNotice("That doesn't look like a video file.");
    return;
  }
  stopSource();
  state.fileUrl = URL.createObjectURL(file); // stays in memory; never uploaded
  state.source = "file";
  setMirrored(false);
  ui.video.srcObject = null;
  ui.video.src = state.fileUrl;
  ui.video.loop = false;
  ui.video.addEventListener(
    "loadeddata",
    () => {
      setStageState("live");
      fitStage();
      afterSourceChange();
    },
    { once: true },
  );
}

function afterSourceChange(): void {
  state.notice = null;
  resetSet();
  render();
  ui.btnStart.focus({ preventScroll: true });
}

function setMirrored(on: boolean): void {
  state.mirrored = on;
  ui.video.classList.toggle("is-mirrored", on);
  ui.btnMirror.setAttribute("aria-pressed", String(on));
  if (state.lastLandmarks) drawOverlay();
}

ui.btnCamera.addEventListener("click", () => void useCamera());
ui.fileInput.addEventListener("change", () => {
  const file = ui.fileInput.files?.[0];
  if (file) useFile(file);
  ui.fileInput.value = "";
});
ui.btnMirror.addEventListener("click", () => setMirrored(!state.mirrored));
ui.btnSource.addEventListener("click", () => {
  autoLogIfNeeded();
  stopSource();
  setStageState("empty");
  render();
  ui.btnCamera.focus();
});
ui.video.addEventListener("ended", () => {
  pause();
  showCue({ id: "ended", text: "End of video. Log the set or reset.", tone: "info" }, 4000);
});

// Drag and drop a video anywhere on the stage.
ui.stage.addEventListener("dragover", (e) => {
  e.preventDefault();
  ui.stage.classList.add("is-dragging");
});
ui.stage.addEventListener("dragleave", () => ui.stage.classList.remove("is-dragging"));
ui.stage.addEventListener("drop", (e) => {
  e.preventDefault();
  ui.stage.classList.remove("is-dragging");
  const file = e.dataTransfer?.files[0];
  if (file) useFile(file);
});

// ---------------------------------------------------------------------------
// Session controls

function canRun(): boolean {
  return state.detector !== null && state.source !== "none";
}

async function start(): Promise<void> {
  if (!canRun() || state.running) return;
  if (state.source === "file") {
    if (ui.video.ended) ui.video.currentTime = 0;
    try {
      await ui.video.play();
    } catch {
      return;
    }
  }
  state.running = true;
  state.setStartedAt ??= new Date();
  stopwatch.start();
  void acquireWakeLock();
  render();
}

function pause(): void {
  if (state.source === "file" && !ui.video.paused) ui.video.pause();
  if (!state.running) return;
  state.running = false;
  stopwatch.pause();
  void releaseWakeLock();
  render();
}

function toggleRunning(): void {
  if (state.running) pause();
  else void start();
}

function resetSet(): void {
  pause();
  tracker.reset();
  preview.reset();
  stopwatch.reset();
  state.setStartedAt = null;
  render();
}

function currentSetRecord(): SetRecord | null {
  const reps = tracker.reps;
  if (reps === 0) return null;
  const def = EXERCISES[state.exercise];
  const arms = tracker.armReps;
  const detail =
    def.strategy !== "per-arm"
      ? undefined
      : state.armMode === "both"
        ? `L ${arms.left ?? 0} · R ${arms.right ?? 0}`
        : `${state.armMode} arm`;
  return {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    exercise: state.exercise,
    reps,
    durationMs: Math.round(stopwatch.elapsedMs),
    startedAt: (state.setStartedAt ?? new Date()).toISOString(),
    ...(detail ? { detail } : {}),
  };
}

function finishSet(): void {
  const record = currentSetRecord();
  if (!record) return;
  state.sets = [...state.sets, record];
  persist();
  announce(`Set logged: ${record.reps} ${EXERCISES[record.exercise].name.toLowerCase()} reps.`);
  showCue({ id: "logged", text: `Set logged · ${record.reps} reps`, tone: "good" }, 2500);
  resetSet();
  renderLog();
}

/** Switching exercise or source mid-set shouldn't silently throw away counted reps. */
function autoLogIfNeeded(): void {
  if (tracker.reps > 0) finishSet();
}

function persist(): void {
  if (!saveSets(storage, state.sets) && storage) {
    showNotice("Couldn't save to this browser's storage; the log is kept for this visit only.");
  }
}

ui.btnStart.addEventListener("click", toggleRunning);
ui.btnFinish.addEventListener("click", finishSet);
ui.btnReset.addEventListener("click", resetSet);

ui.btnExport.addEventListener("click", () => {
  const blob = new Blob([setsToCsv(state.sets)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `repcount-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

ui.btnClear.addEventListener("click", () => {
  if (!window.confirm("Clear the whole session log from this browser?")) return;
  state.sets = [];
  clearSets(storage);
  renderLog();
});

// Keyboard shortcuts. Native controls keep their own keys (Space on a focused button
// activates that button; arrows move between radios).
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  const tag = t?.tagName ?? "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) {
    if (!(t instanceof HTMLInputElement && t.type === "radio" && e.key !== " ")) return;
  }
  const onActivatable = tag === "BUTTON" || tag === "SUMMARY" || tag === "A" || tag === "LABEL";
  const key = e.key.toLowerCase();
  if (key === " " && !onActivatable) {
    e.preventDefault();
    toggleRunning();
  } else if (key === "f") finishSet();
  else if (key === "r") resetSet();
  else if (key === "m") setMirrored(!state.mirrored);
  else if (/^[1-4]$/.test(key)) {
    const id = EXERCISE_ORDER[Number(key) - 1];
    if (id) selectExercise(id);
  }
});

// ---------------------------------------------------------------------------
// Wake lock: keep the screen on while counting (best effort).

async function acquireWakeLock(): Promise<void> {
  try {
    state.wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    state.wakeLock = null;
  }
}

async function releaseWakeLock(): Promise<void> {
  try {
    await state.wakeLock?.release();
  } catch {
    /* ignore */
  }
  state.wakeLock = null;
}

// ---------------------------------------------------------------------------
// Frame loop

function loop(): void {
  const v = ui.video;
  if (state.detector && state.source !== "none" && v.readyState >= 2 && v.videoWidth > 0) {
    // Only run inference on new frames (a paused file video shows a still frame).
    if (v.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = v.currentTime;
      const now = performance.now();
      const landmarks = state.detector.detect(v, now);
      state.lastLandmarks = landmarks;
      const frame = (state.running ? tracker : preview).update(landmarks, v.videoWidth, v.videoHeight, now);
      onFrame(frame);
      drawOverlay();
    }
  }
  ui.timer.textContent = formatDuration(stopwatch.elapsedMs);
  // Let an expired cue disappear even when no new frames arrive (paused video).
  const now = performance.now();
  if (state.cue && state.cue.until < now && !ui.cue.hidden) render();
  if (state.notice && state.notice.until < now) {
    state.notice = null;
    render();
  }
  requestAnimationFrame(loop);
}

function onFrame(frame: TrackerFrame): void {
  state.lastFrame = frame;

  if (state.running) {
    for (const ev of frame.events) {
      if (ev.type === "rep") {
        bumpCounter();
        announce(`${frame.reps}`);
      }
    }
  }

  state.notVisibleFrames = frame.tracking ? 0 : state.notVisibleFrames + 1;
  if (frame.cue) {
    if (frame.cue.tone === "info" && !frame.tracking) {
      // Visibility cue: only once it's persistent, so a single dropped frame doesn't flash it.
      if (state.notVisibleFrames > 8) showCue(frame.cue, 600);
    } else if (state.running) {
      showCue(frame.cue, frame.cue.id.startsWith("posture:") ? 1200 : 2200);
    }
  }
  render();
}

function drawOverlay(): void {
  const v = ui.video;
  if (!v.videoWidth) return;
  overlay.resize(v.videoWidth, v.videoHeight);
  state.theme ??= readTheme(document.documentElement);
  const def = EXERCISES[state.exercise];
  const highlights: Highlight[] = [];
  for (const ch of state.lastFrame?.channels ?? []) {
    const active = ch.zone === "active";
    if (ch.side === "both") {
      highlights.push({ triple: def.joint.left, angle: ch.angle, active });
      highlights.push({ triple: def.joint.right, angle: null, active });
    } else if (ch.side) {
      highlights.push({ triple: def.joint[ch.side], angle: ch.angle, active });
    }
  }
  overlay.draw(state.lastLandmarks, highlights, state.mirrored, state.theme);
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  state.theme = null;
});

// ---------------------------------------------------------------------------
// Rendering

function showNotice(text: string, ms = 8000): void {
  state.notice = { text, tone: "warn", until: performance.now() + ms };
  render();
}

function showStatus(text: string, tone: "info" | "good" | "warn"): void {
  ui.status.textContent = text;
  ui.status.dataset.tone = tone;
}

function showCue(cue: Cue, ms: number): void {
  const now = performance.now();
  // A fresh warning or good-rep cue replaces a lingering one; info never overrides them.
  if (state.cue && state.cue.until > now && state.cue.tone !== "info" && cue.tone === "info") return;
  const changed = state.cue?.id !== cue.id || state.cue.until < now;
  state.cue = { ...cue, until: now + ms };
  if (changed && cue.tone === "warn") announce(cue.text);
}

let announceTimer = 0;
function announce(text: string): void {
  clearTimeout(announceTimer);
  ui.announcer.textContent = "";
  announceTimer = window.setTimeout(() => (ui.announcer.textContent = text), 50);
}

function bumpCounter(): void {
  ui.reps.classList.remove("bump");
  void ui.reps.offsetWidth; // restart the CSS animation
  ui.reps.classList.add("bump");
}

function render(): void {
  const def = EXERCISES[state.exercise];
  const reps = tracker.reps;
  ui.reps.textContent = String(reps);
  const arms = tracker.armReps;
  ui.repsDetail.textContent =
    def.strategy === "per-arm" ? (state.armMode === "both" ? `L ${arms.left ?? 0} · R ${arms.right ?? 0}` : `${state.armMode} arm`) : def.name;

  const frame = state.lastFrame;
  const angle = state.source !== "none" ? (frame?.primary.angle ?? null) : null;
  gauge.setAngle(angle);
  ui.gaugeAngle.textContent = angle === null ? "–" : `${Math.round(angle)}°`;
  const phase: Phase = frame && state.source !== "none" ? frame.primary.phase : "idle";
  ui.phase.dataset.phase = phase;
  ui.phase.textContent = state.running || phase !== "idle" ? PHASE_LABELS[state.exercise][phase] : "Paused";

  // Status chip
  if (state.notice && state.notice.until > performance.now()) showStatus(state.notice.text, state.notice.tone);
  else if (state.modelError) showStatus("Couldn't load the pose model. Check your connection and reload.", "warn");
  else if (!state.detector) showStatus("Loading pose model…", "info");
  else if (state.source === "none") showStatus(`Model ready · ${state.detector.delegate}`, "good");
  else if (!state.running) showStatus("Paused · press Start to count", "info");
  else if (frame?.tracking) {
    const side = frame.primary.side;
    showStatus(side === "both" || side === null ? "Counting" : `Counting · ${side} side`, "good");
  } else showStatus("Looking for you…", "info");

  // Cue
  const now = performance.now();
  if (state.cue && state.cue.until > now && state.source !== "none") {
    ui.cue.hidden = false;
    ui.cue.textContent = state.cue.text;
    ui.cue.dataset.tone = state.cue.tone;
  } else ui.cue.hidden = true;

  // Controls
  const startLabel = ui.btnStart.querySelector(".label");
  if (startLabel) startLabel.textContent = state.running ? "Pause" : stopwatch.elapsedMs > 0 ? "Resume" : "Start";
  ui.btnStart.classList.toggle("is-running", state.running);
  ui.btnStart.disabled = !canRun();
  ui.btnFinish.disabled = reps === 0;
  ui.btnReset.disabled = reps === 0 && stopwatch.elapsedMs === 0;
  ui.stage.classList.toggle("is-running", state.running);
}

function renderLog(): void {
  const sets = state.sets;
  ui.logEmpty.hidden = sets.length > 0;
  ui.logTable.hidden = sets.length === 0;
  ui.btnExport.disabled = sets.length === 0;
  ui.btnClear.disabled = sets.length === 0;

  const rows = [...sets].reverse().map((s) => {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = EXERCISES[s.exercise].name;
    if (s.detail) {
      const small = document.createElement("small");
      small.textContent = s.detail;
      name.append(small);
    }
    const reps = cell(String(s.reps), "num reps-cell");
    const time = cell(formatDuration(s.durationMs), "num");
    const when = cell(
      new Date(s.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      "num muted",
    );
    tr.append(name, reps, time, when);
    return tr;
  });
  ui.logBody.replaceChildren(...rows);

  const total = summarize(sets);
  ui.logTotal.replaceChildren(
    cell(`${total.sets} ${total.sets === 1 ? "set" : "sets"}`, ""),
    cell(String(total.reps), "num reps-cell"),
    cell(formatDuration(total.durationMs), "num"),
    cell("", ""),
  );
}

function cell(text: string, className: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

// ---------------------------------------------------------------------------
// Boot

buildExercisePicker();
rebuildTrackers();
renderLog();
requestAnimationFrame(loop);

loadPoseDetector()
  .then((d) => {
    state.detector = d;
    render();
  })
  .catch((err: unknown) => {
    console.error("RepCount: failed to load the pose model", err);
    state.modelError = true;
    render();
  });
