/**
 * Thin wrapper around MediaPipe's PoseLandmarker. The only module that imports it.
 *
 * The WASM runtime is fetched from jsDelivr at the exact version pinned in
 * package.json, and the model from Google's MediaPipe model bucket. Both are static
 * downloads; inference runs locally and no frames are sent anywhere.
 */
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "../core/landmarks";

/** Must match the version of @mediapipe/tasks-vision in package.json. */
export const TASKS_VISION_VERSION = "1.2.2";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

export interface PoseDetector {
  readonly delegate: "GPU" | "CPU";
  detect(frame: TexImageSource, timestampMs: number): Landmark[] | null;
  close(): void;
}

async function create(delegate: "GPU" | "CPU"): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
}

/** Load the model, preferring the GPU delegate and falling back to CPU (WASM SIMD). */
export async function loadPoseDetector(): Promise<PoseDetector> {
  let landmarker: PoseLandmarker;
  let delegate: "GPU" | "CPU" = "GPU";
  try {
    landmarker = await create("GPU");
  } catch (gpuError) {
    console.warn("RepCount: GPU delegate unavailable, falling back to CPU.", gpuError);
    delegate = "CPU";
    landmarker = await create("CPU");
  }

  let lastTs = -1;
  return {
    delegate,
    detect(frame, timestampMs) {
      // VIDEO mode requires strictly increasing timestamps.
      const ts = Math.max(Math.round(timestampMs), lastTs + 1);
      lastTs = ts;
      const result = landmarker.detectForVideo(frame, ts);
      return result.landmarks[0] ?? null;
    },
    close() {
      landmarker.close();
    },
  };
}
