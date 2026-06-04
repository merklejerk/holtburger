import {
	browserLocationToLandblockId,
	isIndoorBrowserDestination,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import { normalizeOutdoorLandblockId } from "../landblocks";
import {
	deriveOutdoorSceneInterest,
	type NormalizedOutdoorSceneInterest,
} from "../world-display/outdoor-scene-interest";
import {
	chooseMoreDetailedLandblockPreset,
	compareDesiredLandblockRenderPresets,
	type DesiredLandblockRenderPreset,
	type LandblockRenderLodPreset,
	type LandblockRenderPresetPriority,
} from "../world-display/landblock-render-preset";
import type { OutdoorSceneRequestOptions } from "./scene-asset-request-planner";

const DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS: OutdoorSceneRequestOptions = {
	terrainRadius: 2,
	buildingRadius: 1,
	detailRadius: 1,
	envCellRadius: 1,
};

export interface LandblockRenderPresetPlanningInput {
	browserDestination: BrowserLocationSelection | null;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	options?: OutdoorSceneRequestOptions;
}

export function planDesiredLandblockRenderPresets(
	input: LandblockRenderPresetPlanningInput,
): DesiredLandblockRenderPreset[] {
	if (!input.browserDestination) {
		return [];
	}
	if (isIndoorBrowserDestination(input.browserDestination)) {
		return [];
	}
	const options = input.options ?? DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS;
	const envCellRadius =
		options.envCellRadius ?? options.detailRadius ?? options.terrainRadius;

	const interest = deriveOutdoorSceneInterest({
		focusLandblockId: normalizeOutdoorLandblockId(
			browserLocationToLandblockId(input.browserDestination),
		),
		terrainRadius: options.terrainRadius,
		buildingRadius: options.buildingRadius,
		detailRadius: options.detailRadius,
		envCellRadius: Math.max(envCellRadius, 0),
	});
	const envCellLandblockIds =
		envCellRadius < 0 ? [] : interest.envCellLandblockIds;

	return coalesceDesiredPresets([
		...interest.terrainLandblockIds.map((landblockId) =>
			createDesiredPreset(input, interest, landblockId, "outdoor"),
		),
		...interest.buildingLandblockIds.map((landblockId) =>
			createDesiredPreset(input, interest, landblockId, "outdoor"),
		),
		...interest.detailLandblockIds.map((landblockId) =>
			createDesiredPreset(input, interest, landblockId, "outdoor"),
		),
		...envCellLandblockIds.map((landblockId) =>
			createDesiredPreset(
				input,
				interest,
				landblockId,
				"outdoor-with-env-cells",
			),
		),
	]).sort(compareDesiredLandblockRenderPresets);
}

function createDesiredPreset(
	input: LandblockRenderPresetPlanningInput,
	interest: NormalizedOutdoorSceneInterest,
	landblockId: number,
	preset: LandblockRenderLodPreset,
): DesiredLandblockRenderPreset {
	return {
		landblockId,
		preset,
		priority: priorityForLandblock(interest.focusLandblockId, landblockId),
		requestId: input.requestId,
		buildPolicyRevision: input.buildPolicyRevision,
		texturePagePolicyRevision: input.texturePagePolicyRevision,
	};
}

function coalesceDesiredPresets(
	presets: readonly DesiredLandblockRenderPreset[],
): DesiredLandblockRenderPreset[] {
	const byLandblockId = new Map<number, DesiredLandblockRenderPreset>();
	for (const preset of presets) {
		const existing = byLandblockId.get(preset.landblockId);
		if (!existing) {
			byLandblockId.set(preset.landblockId, preset);
			continue;
		}
		byLandblockId.set(preset.landblockId, {
			...existing,
			preset: chooseMoreDetailedLandblockPreset(existing.preset, preset.preset),
			priority: chooseHigherPriority(existing.priority, preset.priority),
		});
	}
	return [...byLandblockId.values()];
}

function priorityForLandblock(
	focusLandblockId: number,
	landblockId: number,
): LandblockRenderPresetPriority {
	return landblockId === focusLandblockId ? "resident-now" : "prefetch";
}

function chooseHigherPriority(
	left: LandblockRenderPresetPriority,
	right: LandblockRenderPresetPriority,
): LandblockRenderPresetPriority {
	return left === "resident-now" || right === "resident-now"
		? "resident-now"
		: "prefetch";
}
