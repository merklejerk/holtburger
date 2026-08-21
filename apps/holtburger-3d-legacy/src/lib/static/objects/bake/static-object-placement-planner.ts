import type { PreparedAssetReader } from "../../../assets/contracts";
import type {
	StaticBakeJobPayload,
	StaticObjectMaterialSlotFacts,
	StaticObjectPartMaterialSlotFacts,
	StaticScopePayload,
} from "../../contracts";
import { createStaticMaterialTextureBindingRequirement } from "../../bake/static-material-texture-policy";
import {
	createStaticDomainTexturePlacementPolicy,
	type ObjectVisualTexturePlacementIntent,
} from "../../../textures/placement";
import {
	createObjectVisualTexturePlacementIntents,
	type ObjectVisualTexturePlacementRequirement,
} from "../../../visual/object-visual-texture-placement-planner";
import { createMaterialTextureIdentityFacts } from "../../../textures/material-texture-identity";
import { createObjectVisualSourcePayload } from "./object-visual-source-payload";
import { isCurrentlyStageableStaticObjectDataUse } from "./static-object-renderability";
import {
	createObjectVisualMaterialUseKey,
	planObjectVisualMaterials,
	type ObjectVisualMaterialPlan,
} from "../../../visual/object-visual-material-planner";

export async function createStaticObjectTexturePlacementIntents(input: {
	readonly assetReader: PreparedAssetReader;
	readonly items: readonly StaticBakeJobPayload[];
	readonly planningBudget?: TextureIntentPlanningBudget;
}): Promise<readonly ObjectVisualTexturePlacementIntent[]> {
	return (await createStaticObjectTexturePlacementIntentResult(input)).intents;
}

export interface StaticObjectTexturePlacementIntentResult {
	readonly intents: readonly ObjectVisualTexturePlacementIntent[];
	readonly stageTimings: readonly StaticObjectTexturePlacementIntentStageTiming[];
}

interface StaticObjectTexturePlacementIntentStageTiming {
	readonly durationMs: number;
	readonly itemCount: number;
	readonly stage:
		| "texture-intent-static-object-partition"
		| "texture-intent-static-object-requirements"
		| "texture-intent-static-object-entry"
		| "texture-intent-aggregation";
}

export async function createStaticObjectTexturePlacementIntentResult(input: {
	readonly assetReader: PreparedAssetReader;
	readonly items: readonly StaticBakeJobPayload[];
	readonly planningBudget?: TextureIntentPlanningBudget;
}): Promise<StaticObjectTexturePlacementIntentResult> {
	const requirementsByBindingId = new Map<
		string,
		ObjectVisualTexturePlacementRequirement
	>();
	const budget = createTextureIntentPlanningBudget(input.planningBudget);
	const stageTimings: StaticObjectTexturePlacementIntentStageTiming[] = [];

	for (const item of input.items) {
		if (!hasStaticObjectTexturePlanningPayload(item.payload)) {
			continue;
		}
		const payload = createObjectVisualSourcePayload(item);
		const requirementsStartedAtMs = nowMs();
		const requirements = createStaticObjectTexturePlacementRequirements({
			item,
			payload,
		});
		stageTimings.push({
			durationMs: nowMs() - requirementsStartedAtMs,
			itemCount: requirements.length,
			stage: "texture-intent-static-object-requirements",
		});
		await budget.yieldIfNeeded();
		for (const planned of requirements) {
			const entryStartedAtMs = nowMs();
			const requirement = createStaticMaterialTextureBindingRequirement({
				dataUse: planned.dataUse,
				domain: item.task.domain,
				textureUseNamespace: "static-object-texture",
				textureUseScopeId: item.task.ownerId,
				wrapMode: planned.textureWrapMode,
			});
			if (requirementsByBindingId.has(requirement.bindingId)) {
				continue;
			}
			const identity = await createMaterialTextureIdentityFacts({
				assetReader: input.assetReader,
				dataUse: planned.dataUse,
				domain: item.task.domain,
				purpose: requirement.purpose,
				samplingPolicy: requirement.samplingPolicy,
			});
			requirementsByBindingId.set(requirement.bindingId, {
				policy: {
					affinityKey: createStaticObjectPlacementAffinityKey({
						landblockId: payload.landblock.landblockId,
						ownerId: item.task.ownerId,
						partitionBatchKey: planned.affinityKey,
					}),
					domain: payload.domain,
					kind: "static-authored",
					placementPolicy: createStaticDomainTexturePlacementPolicy(),
				},
				requirement: {
					...requirement,
					ownerIds: [],
					pageClass: identity.pageClass,
					textureKey: identity.textureKey,
				},
			});
			stageTimings.push({
				durationMs: nowMs() - entryStartedAtMs,
				itemCount: 1,
				stage: "texture-intent-static-object-entry",
			});
			await budget.yieldIfNeeded();
		}
	}

	const aggregationStartedAtMs = nowMs();
	const intents = createObjectVisualTexturePlacementIntents({
		requirements: [...requirementsByBindingId.values()],
	});
	stageTimings.push({
		durationMs: nowMs() - aggregationStartedAtMs,
		itemCount: intents.length,
		stage: "texture-intent-aggregation",
	});
	return { intents, stageTimings };
}

function createStaticObjectTexturePlacementRequirements(input: {
	readonly item: StaticBakeJobPayload;
	readonly payload: ReturnType<typeof createObjectVisualSourcePayload>;
}): readonly PlannedStaticObjectTexturePlacementRequirement[] {
	const materialPlansByUseKey = new Map(
		planObjectVisualMaterials(input.payload).materialPlans.map((plan) => [
			plan.materialUseKey,
			plan,
		]),
	);
	const requirementsByKey = new Map<
		string,
		PlannedStaticObjectTexturePlacementRequirement
	>();

	for (const slot of collectStaticObjectTextureMaterialSlots(input.payload)) {
		const plan = materialPlansByUseKey.get(createMaterialSlotUseKey(slot));
		if (!plan || plan.renderCoverage === "unsupported") {
			continue;
		}
		const textureWrapMode = resolveTextureWrapMode(
			slot.materialVariantSignature,
		);
		for (const role of plan.textureRoles) {
			if (!isCurrentlyStageableStaticObjectDataUse(role.dataUse)) {
				continue;
			}
			const key = createStaticObjectTextureRequirementKey({
				dataUse: role.dataUse,
				ownerId: input.item.task.ownerId,
				textureWrapMode,
			});
			if (requirementsByKey.has(key)) {
				continue;
			}
			requirementsByKey.set(key, {
				affinityKey: [
					createMaterialSlotUseKey(slot),
					`wrap:${textureWrapMode}`,
				].join("|"),
				dataUse: role.dataUse,
				textureWrapMode,
			});
		}
	}

	return [...requirementsByKey.values()].sort((left, right) =>
		createStaticObjectTextureRequirementKey({
			dataUse: left.dataUse,
			ownerId: input.item.task.ownerId,
			textureWrapMode: left.textureWrapMode,
		}).localeCompare(
			createStaticObjectTextureRequirementKey({
				dataUse: right.dataUse,
				ownerId: input.item.task.ownerId,
				textureWrapMode: right.textureWrapMode,
			}),
		),
	);
}

interface PlannedStaticObjectTexturePlacementRequirement {
	readonly affinityKey: string;
	readonly dataUse: ObjectVisualMaterialPlan["textureRoles"][number]["dataUse"];
	readonly textureWrapMode: "clamp" | "repeat";
}

function collectStaticObjectTextureMaterialSlots(
	payload: ReturnType<typeof createObjectVisualSourcePayload>,
): readonly StaticObjectTextureMaterialSlot[] {
	return [
		...payload.materialSlots,
		...payload.sourceAssets.flatMap((source) =>
			source.parts.flatMap((part) => part.materialSlots),
		),
	];
}

type StaticObjectTextureMaterialSlot =
	StaticObjectMaterialSlotFacts | StaticObjectPartMaterialSlotFacts;

function createMaterialSlotUseKey(
	slot: StaticObjectTextureMaterialSlot,
): string {
	return createObjectVisualMaterialUseKey(
		slot.material,
		slot.paletteOverride,
		slot.paletteViews,
	);
}

function createStaticObjectTextureRequirementKey(input: {
	readonly dataUse: PlannedStaticObjectTexturePlacementRequirement["dataUse"];
	readonly ownerId: string;
	readonly textureWrapMode: PlannedStaticObjectTexturePlacementRequirement["textureWrapMode"];
}): string {
	return JSON.stringify([input.ownerId, input.textureWrapMode, input.dataUse]);
}

function resolveTextureWrapMode(
	materialVariantSignature: string | null,
): "clamp" | "repeat" {
	return materialVariantSignature?.includes("sampler=repeat")
		? "repeat"
		: "clamp";
}

interface TextureIntentPlanningBudget {
	/** Cooperative yield hook used by replacement runners to split long planners. */
	readonly yieldToFrameBudget: () => Promise<void>;
	/** Main-thread planning slice before yielding. Defaults to one short tasklet. */
	readonly maxMsBeforeYield?: number;
}

function createTextureIntentPlanningBudget(
	budget: TextureIntentPlanningBudget | undefined,
) {
	let lastYieldAtMs = nowMs();
	return {
		async yieldIfNeeded(): Promise<void> {
			if (!budget) {
				return;
			}
			if (nowMs() - lastYieldAtMs < (budget.maxMsBeforeYield ?? 8)) {
				return;
			}
			await budget.yieldToFrameBudget();
			lastYieldAtMs = nowMs();
		},
	};
}

function hasStaticObjectTexturePlanningPayload(
	payload: StaticScopePayload,
): boolean {
	if (payload.scope.kind === "env-cell-system") {
		return (payload.scope.sourceAssets ?? []).some((source) =>
			source.parts.some((part) => part.triangles.length > 0),
		);
	}
	if (payload.scope.kind !== "outdoor-static-objects") {
		return false;
	}
	return payload.scope.sourceAssets.some((source) =>
		source.parts.some((part) => part.triangles.length > 0),
	);
}

function createStaticObjectPlacementAffinityKey(input: {
	readonly landblockId: number;
	readonly ownerId: string;
	readonly partitionBatchKey: string;
}): string {
	return [
		"static-object",
		`landblock:${formatHex32(input.landblockId)}`,
		`owner:${input.ownerId}`,
		`batch:${input.partitionBatchKey}`,
	].join("|");
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}
