import type { PreparedAssetReader } from "../../../assets/contracts";
import type { StaticBakeJobPayload } from "../../contracts";
import {
	createStaticDomainTexturePlacementPolicy,
	type ObjectVisualTexturePlacementIntent,
} from "../../../textures/placement";
import {
	createObjectVisualTexturePlacementIntents,
	type ObjectVisualTexturePlacementRequirement,
} from "../../../visual/object-visual-texture-placement-planner";
import { createMaterialTextureIdentityFacts } from "../../../textures/material-texture-identity";
import type { MaterialTextureIdentityFacts } from "../../../textures/material-texture-identity";
import { isCurrentlyStageableStaticObjectDataUse } from "../../objects/bake/static-object-renderability";
import {
	createStructuredInteriorTextureBindingRequirement,
	createStructuredInteriorMaterialPlanner,
	resolveStructuredInteriorPlanTextureWrapMode,
} from "./structured-interior-material-planner";
import { isRenderableObjectVisualMaterialPlan } from "../../objects/bake/static-object-renderability";

export interface StructuredInteriorTexturePlacementIntentResult {
	readonly intents: readonly ObjectVisualTexturePlacementIntent[];
	readonly stageTimings: readonly StructuredInteriorTexturePlacementIntentStageTiming[];
}

interface StructuredInteriorTexturePlacementIntentStageTiming {
	readonly durationMs: number;
	readonly itemCount: number;
	readonly stage: "texture-intent-chunk" | "texture-intent-aggregation";
}

export async function createStructuredInteriorTexturePlacementIntents(input: {
	readonly assetReader: PreparedAssetReader;
	readonly items: readonly StaticBakeJobPayload[];
	readonly planningBudget?: TextureIntentPlanningBudget;
}): Promise<readonly ObjectVisualTexturePlacementIntent[]> {
	return (await createStructuredInteriorTexturePlacementIntentResult(input))
		.intents;
}

export async function createStructuredInteriorTexturePlacementIntentResult(input: {
	readonly assetReader: PreparedAssetReader;
	readonly items: readonly StaticBakeJobPayload[];
	readonly planningBudget?: TextureIntentPlanningBudget;
}): Promise<StructuredInteriorTexturePlacementIntentResult> {
	const requirementsByBindingId = new Map<
		string,
		ObjectVisualTexturePlacementRequirement
	>();
	const budget = createTextureIntentPlanningBudget(input.planningBudget);
	const identityFactsByRoleKey = new Map<
		string,
		Promise<MaterialTextureIdentityFacts>
	>();
	const chunkTimings: StructuredInteriorTexturePlacementIntentStageTiming[] =
		[];

	for (const item of input.items) {
		if (
			item.task.domain !== "env-cell-system" ||
			item.payload.scope.kind !== "env-cell-system"
		) {
			continue;
		}

		const materialPlanner = createStructuredInteriorMaterialPlanner({
			payload: item.payload.scope,
			task: item.task,
		});
		for (const envCell of item.payload.scope.envCells) {
			await budget.yieldIfNeeded();
			const materialPlan = await materialPlanner.planCellMaterialsWithBudget({
				envCell,
				planningBudget: input.planningBudget,
			});
			for (const [surfaceId, plan] of materialPlan.materialPlansBySurfaceId) {
				const chunkStartedAtMs = nowMs();
				let chunkItemCount = 0;
				if (!isRenderableObjectVisualMaterialPlan(plan)) {
					continue;
				}
				const wrapMode = resolveStructuredInteriorPlanTextureWrapMode(plan);
				for (const role of plan.textureRoles) {
					if (!isCurrentlyStageableStaticObjectDataUse(role.dataUse)) {
						continue;
					}
					const requirement = createStructuredInteriorTextureBindingRequirement(
						{
							dataUse: role.dataUse,
							task: item.task,
							wrapMode,
						},
					);
					if (requirementsByBindingId.has(requirement.bindingId)) {
						continue;
					}
					await budget.yieldIfNeeded();
					const identity = await resolveCachedMaterialTextureIdentityFacts({
						cache: identityFactsByRoleKey,
						assetReader: input.assetReader,
						dataUse: role.dataUse,
						domain: item.task.domain,
						purpose: requirement.purpose,
						samplingPolicy: requirement.samplingPolicy,
					});
					requirementsByBindingId.set(requirement.bindingId, {
						policy: {
							affinityKey: createStructuredInteriorAffinityKey({
								envCellId: envCell.identity.envCellId,
								landblockId: item.task.scope.landblockId,
								ownerId: item.task.ownerId,
								surfaceId,
							}),
							domain: "env-cell-system",
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
					chunkItemCount += 1;
				}
				recordChunkTiming({
					itemCount: chunkItemCount,
					startedAtMs: chunkStartedAtMs,
					timings: chunkTimings,
				});
				await budget.yieldIfNeeded();
			}
			await budget.yieldIfNeeded();
		}
	}

	const aggregationStartedAtMs = nowMs();
	const intents = createObjectVisualTexturePlacementIntents({
		requirements: [...requirementsByBindingId.values()],
	});
	chunkTimings.push({
		durationMs: nowMs() - aggregationStartedAtMs,
		itemCount: intents.length,
		stage: "texture-intent-aggregation",
	});
	return {
		intents,
		stageTimings: chunkTimings,
	};
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

function recordChunkTiming(input: {
	readonly itemCount: number;
	readonly startedAtMs: number;
	readonly timings: StructuredInteriorTexturePlacementIntentStageTiming[];
}): void {
	if (input.itemCount === 0) {
		return;
	}
	input.timings.push({
		durationMs: nowMs() - input.startedAtMs,
		itemCount: input.itemCount,
		stage: "texture-intent-chunk",
	});
}

function resolveCachedMaterialTextureIdentityFacts(input: {
	readonly assetReader: PreparedAssetReader;
	readonly cache: Map<string, Promise<MaterialTextureIdentityFacts>>;
	readonly dataUse: Parameters<
		typeof createMaterialTextureIdentityFacts
	>[0]["dataUse"];
	readonly domain: Parameters<
		typeof createMaterialTextureIdentityFacts
	>[0]["domain"];
	readonly purpose: Parameters<
		typeof createMaterialTextureIdentityFacts
	>[0]["purpose"];
	readonly samplingPolicy: Parameters<
		typeof createMaterialTextureIdentityFacts
	>[0]["samplingPolicy"];
}): Promise<MaterialTextureIdentityFacts> {
	const key = createMaterialTextureIdentityRoleKey(input);
	const existing = input.cache.get(key);
	if (existing) {
		return existing;
	}
	const pending = createMaterialTextureIdentityFacts({
		assetReader: input.assetReader,
		dataUse: input.dataUse,
		domain: input.domain,
		purpose: input.purpose,
		samplingPolicy: input.samplingPolicy,
	});
	input.cache.set(key, pending);
	return pending;
}

function createMaterialTextureIdentityRoleKey(input: {
	readonly dataUse: Parameters<
		typeof createMaterialTextureIdentityFacts
	>[0]["dataUse"];
	readonly domain: Parameters<
		typeof createMaterialTextureIdentityFacts
	>[0]["domain"];
	readonly purpose: Parameters<
		typeof createMaterialTextureIdentityFacts
	>[0]["purpose"];
	readonly samplingPolicy: Parameters<
		typeof createMaterialTextureIdentityFacts
	>[0]["samplingPolicy"];
}): string {
	return JSON.stringify([
		input.domain,
		input.purpose,
		input.samplingPolicy ?? null,
		input.dataUse,
	]);
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function createStructuredInteriorAffinityKey(input: {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly ownerId: string;
	readonly surfaceId: number;
}): string {
	return [
		"structured-interior",
		`landblock:${formatHex32(input.landblockId)}`,
		`owner:${input.ownerId}`,
		`env-cell:${formatHex32(input.envCellId)}`,
		`surface:${formatHex32(input.surfaceId)}`,
	].join("|");
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}
