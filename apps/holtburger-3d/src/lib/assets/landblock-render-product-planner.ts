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
	compareDesiredLandblockRenderProducts,
	type DesiredLandblockRenderProduct,
	type LandblockRenderProduct,
	type LandblockRenderProductBuildPolicy,
	type LandblockRenderProductPriority,
} from "../world-display/landblock-render-product";
import type { OutdoorSceneRequestOptions } from "./scene-asset-request-planner";

const DEFAULT_OUTDOOR_SCENE_REQUEST_OPTIONS: OutdoorSceneRequestOptions = {
	terrainRadius: 2,
	buildingRadius: 1,
	detailRadius: 1,
	envCellRadius: 1,
};

export interface LandblockRenderProductPlanningInput {
	browserDestination: BrowserLocationSelection | null;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	buildPolicy: LandblockRenderProductBuildPolicy;
	options?: OutdoorSceneRequestOptions;
}

export function planDesiredLandblockRenderProducts(
	input: LandblockRenderProductPlanningInput,
): DesiredLandblockRenderProduct[] {
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

	return coalesceDesiredProducts([
		...interest.terrainLandblockIds.map((landblockId) =>
			createDesiredProduct(input, interest, landblockId, "outdoor"),
		),
		...interest.buildingLandblockIds.map((landblockId) =>
			createDesiredProduct(input, interest, landblockId, "outdoor"),
		),
		...interest.detailLandblockIds.map((landblockId) =>
			createDesiredProduct(input, interest, landblockId, "outdoor"),
		),
		...envCellLandblockIds.map((landblockId) =>
			createDesiredProduct(input, interest, landblockId, "outdoor-env-cells"),
		),
	]).sort(compareDesiredLandblockRenderProducts);
}

function createDesiredProduct(
	input: LandblockRenderProductPlanningInput,
	interest: NormalizedOutdoorSceneInterest,
	landblockId: number,
	product: LandblockRenderProduct,
): DesiredLandblockRenderProduct {
	return {
		landblockId,
		product,
		priority: priorityForLandblock(interest.focusLandblockId, landblockId),
		requestId: input.requestId,
		buildPolicyRevision: input.buildPolicyRevision,
		texturePagePolicyRevision: input.texturePagePolicyRevision,
		buildPolicy: input.buildPolicy,
	};
}

function coalesceDesiredProducts(
	products: readonly DesiredLandblockRenderProduct[],
): DesiredLandblockRenderProduct[] {
	const byTargetKey = new Map<string, DesiredLandblockRenderProduct>();
	for (const product of products) {
		const targetKey = `${product.landblockId}:${product.product}`;
		const existing = byTargetKey.get(targetKey);
		if (!existing) {
			byTargetKey.set(targetKey, product);
			continue;
		}
		byTargetKey.set(targetKey, {
			...existing,
			priority: chooseHigherPriority(existing.priority, product.priority),
		});
	}
	return [...byTargetKey.values()];
}

function priorityForLandblock(
	focusLandblockId: number,
	landblockId: number,
): LandblockRenderProductPriority {
	return landblockId === focusLandblockId ? "resident-now" : "prefetch";
}

function chooseHigherPriority(
	left: LandblockRenderProductPriority,
	right: LandblockRenderProductPriority,
): LandblockRenderProductPriority {
	return left === "resident-now" || right === "resident-now"
		? "resident-now"
		: "prefetch";
}
