import type { SceneResourceInterest } from "../scene-runtime/scene-resource-interest";
import { deriveOutdoorSceneInterest } from "../world-display/outdoor-scene-interest";
import {
	compareDesiredLandblockRenderProducts,
	type DesiredLandblockRenderProduct,
	type LandblockRenderProduct,
	type LandblockRenderProductBuildPolicy,
	type LandblockRenderProductPriority,
} from "../world-display/landblock-render-product";
import type { OutdoorSceneRequestOptions } from "./scene-asset-request-planner";

export interface LandblockRenderProductPlanningInput {
	sceneInterest: SceneResourceInterest;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	buildPolicy: LandblockRenderProductBuildPolicy;
	options?: OutdoorSceneRequestOptions;
}

export function planDesiredLandblockRenderProducts(
	input: LandblockRenderProductPlanningInput,
): DesiredLandblockRenderProduct[] {
	const location = input.sceneInterest.location;
	if (!location) {
		return [];
	}
	if (location.kind === "interior-cell") {
		return [
			createDesiredProduct(
				input,
				location.landblockId,
				location.landblockId,
				"dungeon-env-cells",
			),
		];
	}
	const options =
		input.options ?? createOptionsFromSceneInterest(input.sceneInterest);
	const envCellRadius =
		options.envCellRadius ?? options.detailRadius ?? options.terrainRadius;

	const interest = deriveOutdoorSceneInterest({
		focusLandblockId: location.landblockId,
		terrainRadius: options.terrainRadius,
		buildingRadius: options.buildingRadius,
		detailRadius: options.detailRadius,
		envCellRadius: Math.max(envCellRadius, 0),
	});
	const envCellLandblockIds =
		envCellRadius < 0 ? [] : interest.envCellLandblockIds;

	return coalesceDesiredProducts([
		...interest.terrainLandblockIds.map((landblockId) =>
			createDesiredProduct(
				input,
				interest.focusLandblockId,
				landblockId,
				"outdoor-terrain",
			),
		),
		...interest.buildingLandblockIds.map((landblockId) =>
			createDesiredProduct(
				input,
				interest.focusLandblockId,
				landblockId,
				"outdoor-buildings",
			),
		),
		...interest.detailLandblockIds.map((landblockId) =>
			createDesiredProduct(
				input,
				interest.focusLandblockId,
				landblockId,
				"outdoor-detail",
			),
		),
		...envCellLandblockIds.map((landblockId) =>
			createDesiredProduct(
				input,
				interest.focusLandblockId,
				landblockId,
				"outdoor-env-cells",
			),
		),
	]).sort(compareDesiredLandblockRenderProducts);
}

function createOptionsFromSceneInterest(
	sceneInterest: SceneResourceInterest,
): OutdoorSceneRequestOptions {
	return {
		terrainRadius: sceneInterest.lod.terrain,
		buildingRadius: sceneInterest.lod.buildings,
		detailRadius: sceneInterest.lod.detail,
		envCellRadius: sceneInterest.lod.envCells,
	};
}

function createDesiredProduct(
	input: LandblockRenderProductPlanningInput,
	focusLandblockId: number,
	landblockId: number,
	product: LandblockRenderProduct,
): DesiredLandblockRenderProduct {
	return {
		landblockId,
		product,
		priority: priorityForLandblock(focusLandblockId, landblockId),
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
