import manifestJson from "./manifest.json" with { type: "json" };
import { loadManifest } from "../manifest.js";
import type { SourceSpec } from "../driver.js";

// The shipped manifest, validated at module load. Adding a source or a state
// is an edit to manifest.json only — proven by the mock-state test.
export const SOURCES: SourceSpec[] = loadManifest(manifestJson);
