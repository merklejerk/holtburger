import type { StaticLandblockRenderBundleLayer } from "./static-bundle-layer";
import type { LandblockTerrainRenderArtifact } from "./terrain-render-artifact";

export type LandblockRenderLodPreset = "outdoor" | "outdoor-with-env-cells";

export type LandblockRenderPresetPriority = "resident-now" | "prefetch";

export interface DesiredLandblockRenderPreset {
	landblockId: number;
	preset: LandblockRenderLodPreset;
	priority: LandblockRenderPresetPriority;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
}

export interface LandblockRenderPresetWorkerJob {
	type: "build-landblock-render-preset";
	jobId: string;
	landblockId: number;
	preset: LandblockRenderLodPreset;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
}

export interface LandblockRenderPresetWorkerResult {
	type: "landblock-render-preset-built";
	jobId: string;
	landblockId: number;
	preset: LandblockRenderLodPreset;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	terrainArtifact: LandblockTerrainRenderArtifact | null;
	staticBundleLayers: readonly StaticLandblockRenderBundleLayer[];
	diagnostics: LandblockRenderPresetWorkerDiagnostics;
}

interface LandblockRenderPresetWorkerDiagnostics {
	status: "ready" | "partial" | "failed";
	messages: readonly string[];
}

export function createLandblockRenderPresetWorkerJob(
	desired: DesiredLandblockRenderPreset,
): LandblockRenderPresetWorkerJob {
	return {
		type: "build-landblock-render-preset",
		jobId: [
			"landblock-render-preset",
			desired.landblockId,
			desired.preset,
			desired.requestId,
		].join(":"),
		landblockId: desired.landblockId,
		preset: desired.preset,
		requestId: desired.requestId,
		buildPolicyRevision: desired.buildPolicyRevision,
		texturePagePolicyRevision: desired.texturePagePolicyRevision,
	};
}

export function compareDesiredLandblockRenderPresets(
	left: DesiredLandblockRenderPreset,
	right: DesiredLandblockRenderPreset,
): number {
	const priority = comparePresetPriority(left.priority, right.priority);
	if (priority !== 0) {
		return priority;
	}
	if (left.landblockId !== right.landblockId) {
		return left.landblockId - right.landblockId;
	}
	return comparePresetSpecificity(left.preset, right.preset);
}

export function chooseMoreDetailedLandblockPreset(
	left: LandblockRenderLodPreset,
	right: LandblockRenderLodPreset,
): LandblockRenderLodPreset {
	return presetRank(left) >= presetRank(right) ? left : right;
}

function comparePresetPriority(
	left: LandblockRenderPresetPriority,
	right: LandblockRenderPresetPriority,
): number {
	if (left === right) {
		return 0;
	}
	return left === "resident-now" ? -1 : 1;
}

function comparePresetSpecificity(
	left: LandblockRenderLodPreset,
	right: LandblockRenderLodPreset,
): number {
	return presetRank(right) - presetRank(left);
}

function presetRank(preset: LandblockRenderLodPreset): number {
	switch (preset) {
		case "outdoor":
			return 0;
		case "outdoor-with-env-cells":
			return 1;
	}
}
