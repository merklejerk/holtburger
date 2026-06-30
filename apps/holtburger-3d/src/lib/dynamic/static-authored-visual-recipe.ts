import type {
	DynamicEntityId,
	DynamicEntityRecipe,
} from "./contracts";
import { createDynamicVisualResourceId } from "./contracts";
import type { DynamicVisualRecipeResolutionPayload } from "./visual-recipe-resolver";
import type {
	LayerOwnerKey,
	StaticAuthoredDynamicPlacementRecord,
	StaticAuthoredDynamicRecipe,
	StaticLayerPeerRecordOwner,
} from "../static/contracts";
import { createLayerOwnerKeyId } from "../static/layer-owners";
import type { StaticMaterialPlanningDomain } from "../static/objects/bake/static-object-material-planner";

type DynamicPlacementRecord = StaticAuthoredDynamicPlacementRecord;

export function createStaticAuthoredDynamicRecipe(
	options: {
		readonly recipe: DynamicEntityRecipe;
		readonly targetOwnerKey: LayerOwnerKey;
	},
): StaticAuthoredDynamicRecipe {
	return {
		recipe: options.recipe,
		targetOwnerKey: options.targetOwnerKey,
	};
}

export function createStaticAuthoredDynamicRecipeResolutionPayload(
	record: DynamicPlacementRecord,
): DynamicVisualRecipeResolutionPayload {
	const entityId = createStaticAuthoredDynamicEntityId(record);
	const sourceResidence =
		record.kind === "env-cell-static-object-dynamic-placement"
			? {
					envCellId: record.placement.envCellId,
					kind: "env-cell" as const,
					landblockId: record.placement.landblockId,
				}
			: {
					kind: "outdoor-landblock" as const,
					landblockId: record.placement.sourceResidence.landblockId,
				};
	const materialPlanningDomain = createStaticAuthoredMaterialPlanningDomain(
		record.owner,
	);

	return {
		animationSelection: { kind: "setup-default" },
		baseTransform: {
			baseLocalPlacement: record.placement.localPlacement,
			sourceScale: record.placement.sourceScale,
		},
		entityId,
		materialPolicy: {
			detailRolePolicy: {
				domain: materialPlanningDomain,
				kind: "static-domain",
			},
			materialPlanningDomain,
			visualObject: {
				entityId,
				kind: "dynamic-visual-object",
				resourceId: createDynamicVisualResourceId(entityId),
			},
		},
		modelData: null,
		setupModelId: record.placement.setupModelId,
		source: {
			kind: "static-authored",
			owner: record.owner,
			placementId: createStaticAuthoredDynamicPlacementId(record),
			sourceResidence,
		},
	};
}

export function createStaticAuthoredDynamicEntityId(
	record: DynamicPlacementRecord,
): DynamicEntityId {
	return [
		record.kind === "env-cell-static-object-dynamic-placement"
			? "static-authored-env-cell"
			: "static-authored-outdoor",
		record.owner.ownerId,
		createStaticAuthoredDynamicPlacementId(record),
	].join(":");
}

export function createStaticAuthoredDynamicPlacementId(
	record: DynamicPlacementRecord,
): string {
	if (record.kind === "env-cell-static-object-dynamic-placement") {
		const placement = record.placement;
		return [
			`env-cell:${formatHex32(placement.envCellId)}`,
			`object:${placement.object.objectKind}:${placement.object.instanceId}`,
			`setup:${formatHex32(placement.setupModelId)}`,
		].join(":");
	}

	const placement = record.placement;
	return [
		`object:${placement.object.objectKind}:${placement.object.instanceId}`,
		`setup:${formatHex32(placement.setupModelId)}`,
	].join(":");
}

export function createStaticAuthoredDynamicPlacementOwner(options: {
	readonly domain: StaticLayerPeerRecordOwner["domain"];
	readonly targetOwnerKey: LayerOwnerKey;
}): StaticLayerPeerRecordOwner {
	return {
		domain: options.domain,
		key: options.targetOwnerKey,
		kind: "layer-owner",
		ownerId: createLayerOwnerKeyId(options.targetOwnerKey),
	};
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}

function createStaticAuthoredMaterialPlanningDomain(
	owner: StaticLayerPeerRecordOwner,
): Exclude<
	StaticMaterialPlanningDomain,
	"runtime-authored-dynamic-object-material"
> {
	switch (owner.domain) {
		case "outdoor-buildings":
		case "outdoor-explicit-objects":
		case "outdoor-generated-scenery":
		case "env-cell-system":
			return owner.domain;
		case "outdoor-terrain":
			throw new Error(
				"Static-authored dynamic visuals cannot be owned by terrain layers.",
			);
	}
}
