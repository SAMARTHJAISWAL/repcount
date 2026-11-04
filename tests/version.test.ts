import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The WASM runtime is loaded from a CDN by version string; it must match the JS
// package bundled from npm, or MediaPipe fails at load time with an opaque error.
describe("MediaPipe version pin", () => {
  it("pose.ts loads WASM for the exact version pinned in package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const pinned = pkg.dependencies["@mediapipe/tasks-vision"];
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    const source = readFileSync(new URL("../src/app/pose.ts", import.meta.url), "utf8");
    expect(source).toContain(`TASKS_VISION_VERSION = "${pinned}"`);
  });
});
