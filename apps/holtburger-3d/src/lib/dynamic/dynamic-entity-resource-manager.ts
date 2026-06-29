import type {
	AssetService,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "../assets/contracts";
import { createPreparedTextureHostKey } from "../assets/preparation/prepared-texture-source";
import { createHostAssetKey, describeHostAssetKey } from "../assets/keys";
import {
	createStaticMaterialTextureSamplingPolicy,
	resolveRepeatedStaticMaterialPrimaryWrapMode,
} from "../static/bake/static-material-texture-policy";
import { createStaticMaterialTableEntry } from "../static/bake/static-material-adapter";
import type {
	MaterialTextureDataUseIdentity,
	LandblockSourceIdentity,
	StaticMaterialTableEntry,
	StaticObjectPartMaterialSlotFacts,
	StaticObjectSourceAssetFacts,
	StaticResourceIdentity,
} from "../static/contracts";
import {
	planStaticObjectMaterials,
	type StaticMaterialPlanningDomain,
	type StaticMaterialPlanningSlotFacts,
	type StaticMaterialFallbackReason,
	type StaticMaterialPlan,
} from "../static/objects/bake/static-object-material-planner";
import { resolveStaticObjectSourceClosure } from "../static/objects/static-object-source-closure";
import {
	animationPayloadDtoSchema,
	type AnimationPayloadDto,
	type GfxObjPayloadDto,
} from "../host/contracts";
import type {
	DynamicEntityAnimationResource,
	DynamicEntityId,
	DynamicEntityPresentation,
	DynamicEntityRenderPart,
	DynamicEntityResourceFailure,
	DynamicEntityResourceKey,
	DynamicEntityResourceState,
	DynamicEntityRequiredResource,
	DynamicEntitySetupAnimationResourceState,
	DynamicEntityTextureRequirement,
	DynamicEntityUnsupportedMaterialReason,
	DynamicPendingMaterialPlanningReason,
	DynamicVisualMaterialSlotIdentity,
	DynamicVisualObjectIdentity,
	DynamicVisualPartIdentity,
	DynamicVisualSource,
} from "./contracts";

export interface DynamicEntityResourceManagerOptions {
	readonly assetService: AssetService;
	readonly onResourcesChanged?: (change: DynamicEntityResourceChange) => void;
}

export type DynamicEntityResourceChange =
	| DynamicEntityVisualResourcesFailedChange
	| DynamicEntityVisualResourcesReadyChange
	| DynamicEntitySetupAnimationReadyChange
	| DynamicEntitySetupAnimationFailedChange;

interface DynamicEntitySetupAnimationReadyChange {
	readonly entityId: DynamicEntityId;
	readonly kind: "setup-animation-ready";
	readonly resources: DynamicEntityResourceState;
}

interface DynamicEntitySetupAnimationFailedChange {
	readonly entityId: DynamicEntityId;
	readonly failures: readonly DynamicEntityResourceFailure[];
	readonly kind: "setup-animation-failed";
	readonly resources: DynamicEntityResourceState;
}

interface DynamicEntityVisualResourcesReadyChange {
	readonly entityId: DynamicEntityId;
	readonly kind: "visual-resources-ready";
	readonly resources: DynamicEntityResourceState;
}

interface DynamicEntityVisualResourcesFailedChange {
	readonly entityId: DynamicEntityId;
	readonly failures: readonly DynamicEntityResourceFailure[];
	readonly kind: "visual-resources-failed";
	readonly resources: DynamicEntityResourceState;
}

interface TrackedDynamicEntityResources {
	animationResource: DynamicEntityAnimationResource | null;
	readonly animationHostKey?: HostAssetKey;
	readonly animationResourceKey?: DynamicEntityResourceKey;
	readonly generation: number;
	readonly leases: PreparedAssetLease[];
	readonly presentation: DynamicEntityPresentation;
	readonly setupHostKey: HostAssetKey;
	readonly setupResourceKey: DynamicEntityResourceKey;
}

interface DynamicVisualHostAssetRequestResult {
	readonly failures: readonly DynamicEntityResourceFailure[];
	readonly preparedAssets: ReadonlyMap<string, PreparedAsset>;
}

interface DynamicMaterialRenderEntry {
	readonly entry: StaticMaterialTableEntry;
	readonly family: DynamicMaterialRenderFamily;
	readonly pass: "opaque" | "alpha-test" | "transparent" | "additive";
}

type DynamicMaterialRenderFamily =
	| "flat-color"
	| "indexed-paletted"
	| "texture-rgba";

const SETUP_ANIMATION_REQUIRED_RESOURCES = [
	"setup-model",
	"animation",
] as const satisfies readonly DynamicEntityRequiredResource[];
const VISUAL_REQUIRED_RESOURCES = [
	"setup-appearance",
	"gfx",
	"material",
	"palette",
	"render-surface",
	"prepared-texture",
] as const satisfies readonly DynamicEntityRequiredResource[];
const reportedAnimationResourceWarnings = new Set<string>();

/** Owns dynamic semantic resource state and leases over host-prepared assets. */
export class DynamicEntityResourceManager {
	readonly #assetService: AssetService;
	#onResourcesChanged?: (change: DynamicEntityResourceChange) => void;
	readonly #trackedByEntityId = new Map<
		DynamicEntityId,
		TrackedDynamicEntityResources
	>();
	#generation = 0;

	constructor({
		assetService,
		onResourcesChanged,
	}: DynamicEntityResourceManagerOptions) {
		this.#assetService = assetService;
		this.#onResourcesChanged = onResourcesChanged;
	}

	setResourceChangeListener(
		onResourcesChanged: (change: DynamicEntityResourceChange) => void,
	): void {
		this.#onResourcesChanged = onResourcesChanged;
	}

	trackProjectedVisualResources(
		entityId: DynamicEntityId,
		presentation: DynamicEntityPresentation,
	): void {
		this.releaseEntity(entityId);

		const keys = createSetupAnimationResourceKeys(presentation.visualSource);
		if (keys.kind === "setup-default-unresolved") {
			reportUnresolvedSetupDefaultAnimation(entityId);
			return;
		}

		const generation = this.#nextGeneration();
		this.#trackedByEntityId.set(entityId, {
			...keys,
			animationResource: null,
			generation,
			leases: [],
			presentation,
		});

		const requests =
			keys.kind === "explicit-animation"
				? [
						this.#assetService.requestPreparedAsset(keys.setupHostKey),
						this.#assetService.requestPreparedAsset(keys.animationHostKey),
					]
				: [this.#assetService.requestPreparedAsset(keys.setupHostKey)];
		void Promise.allSettled(requests).then((results) => {
			this.#completeSetupAnimationRequest(entityId, generation, results);
		});
	}

	releaseEntity(entityId: DynamicEntityId): void {
		const tracked = this.#trackedByEntityId.get(entityId);
		if (!tracked) {
			return;
		}

		for (const lease of tracked.leases) {
			lease.release();
		}
		this.#trackedByEntityId.delete(entityId);
	}

	releaseAll(): void {
		for (const entityId of this.#trackedByEntityId.keys()) {
			this.releaseEntity(entityId);
		}
	}

	#completeSetupAnimationRequest(
		entityId: DynamicEntityId,
		generation: number,
		results: readonly PromiseSettledResult<unknown>[],
	): void {
		const tracked = this.#trackedByEntityId.get(entityId);
		if (!tracked || tracked.generation !== generation) {
			return;
		}

		const failures = createSetupAnimationLoadFailures(tracked, results);
		const animationAsset =
			failures.length === 0 && tracked.animationHostKey !== undefined
				? resolveAnimationAssetResult(results[1])
				: null;
		const animationPayload =
			animationAsset === null ? null : resolveAnimationPayload(animationAsset);
		const payloadFailures =
			failures.length === 0 &&
			tracked.animationHostKey !== undefined &&
			animationPayload === null
				? [
						{
							message:
								"Prepared animation asset did not contain an animation payload.",
							resource: "animation" as const,
							resourceKey: requireAnimationResourceKey(tracked),
						},
					]
				: [];
		const animationFailures =
			failures.length === 0 &&
			tracked.animationHostKey !== undefined &&
			animationPayload !== null &&
			animationPayload.frameCount === 0
				? [
						{
							message: "Animation payload has no frames to sample.",
							resource: "animation" as const,
							resourceKey: requireAnimationResourceKey(tracked),
						},
					]
				: [];
		const setupFailures = [
			...failures,
			...payloadFailures,
			...animationFailures,
		];
		if (setupFailures.length > 0) {
			this.#onResourcesChanged?.({
				entityId,
				failures: setupFailures,
				kind: "setup-animation-failed",
				resources: {
					required: createDynamicRequiredResources(tracked),
					setupAnimation: {
						animationKey: tracked.animationResourceKey,
						failures: setupFailures,
						setupModelKey: tracked.setupResourceKey,
						status: "failed",
					},
					status: "failed",
					visual: {
						status: "blocked",
					},
				},
			});
			return;
		}

		tracked.leases.push(
			this.#assetService.acquirePreparedAssetLease(tracked.setupHostKey),
		);
		if (tracked.animationHostKey === undefined) {
			void this.#requestVisualResources(entityId, generation, tracked);
			return;
		}
		if (
			animationAsset === null ||
			animationPayload === null ||
			tracked.animationResourceKey === undefined
		) {
			throw new Error("setup animation payload was expected after validation");
		}
		tracked.animationResource = {
			assetId: animationAsset.sourceAssetId,
			payload: animationPayload,
		};
		reportAnimationResourceWarnings(
			animationAsset.sourceAssetId,
			animationPayload,
		);
		tracked.leases.push(
			this.#assetService.acquirePreparedAssetLease(tracked.animationHostKey),
		);
		this.#onResourcesChanged?.({
			entityId,
			kind: "setup-animation-ready",
			resources: {
				required: SETUP_ANIMATION_REQUIRED_RESOURCES,
				setupAnimation: createReadySetupAnimationResourceState(tracked),
				status: "setup-animation-ready",
				visual: {
					status: "pending",
				},
			},
		});
		void this.#requestVisualResources(entityId, generation, tracked);
	}

	async #requestVisualResources(
		entityId: DynamicEntityId,
		generation: number,
		tracked: TrackedDynamicEntityResources,
	): Promise<void> {
		const materialPlanningIdentity =
			tracked.presentation.policy.materialPlanningIdentity;
		if (materialPlanningIdentity.kind === "pending") {
			reportPendingRuntimeMaterialPlanning(
				entityId,
				materialPlanningIdentity.reason,
			);
			return;
		}

		const visualSource = tracked.presentation.visualSource;
		const closure = await resolveStaticObjectSourceClosure({
			assetService: this.#assetService,
			sourceAssetIds: visualSource.sourceAssetIds,
		});
		const sourceAssets = closure.sourceAssets.filter(
			(source) => source.identity.sourceDid === visualSource.setupModelId,
		);
		const missingRefs = closure.missingRefs.filter(
			(ref) =>
				!(
					ref.kind === "static-object-source" &&
					ref.sourceAssetKind === "setup-appearance"
				),
		);
		const materialSlots = createDynamicMaterialSlotRequirements(
			materialPlanningIdentity.visualObject,
			sourceAssets,
		);
		const materialPlans = planStaticObjectMaterials({
			domain: createDynamicMaterialPlanningDomain(tracked.presentation),
			landblock: createMaterialPlanningLandblockSource(visualSource),
			materialSlots: materialSlots.map((slot) => slot.planningFacts),
			materialSources: closure.materialSources,
			paletteSources: closure.paletteSources,
			regionRenderProfile: { detailRoles: [] },
			textureRefs: closure.textureRefs,
		});
		const unsupportedReasons = createUnsupportedMaterialReasons(
			materialPlans.fallbackReasons,
		);
		const textureRequirements = createTextureRequirements(
			materialPlans.materialPlans,
		);
		const resourceKeys = createVisualHostAssetKeys({
			closure,
			visualSource,
			setupAppearanceIsMissing: closure.missingRefs.some(isSetupAppearanceRef),
			textureRequirements,
		});
		const visualHostAssets = await this.#requestVisualHostAssets(resourceKeys);
		const current = this.#trackedByEntityId.get(entityId);
		if (!current || current.generation !== generation) {
			return;
		}

		if (
			missingRefs.length > 0 ||
			unsupportedReasons.length > 0 ||
			visualHostAssets.failures.length > 0
		) {
			const failures = [
				...createMissingRefFailures(missingRefs),
				...visualHostAssets.failures,
			];
			this.#onResourcesChanged?.({
				entityId,
				failures,
				kind: "visual-resources-failed",
				resources: {
					required: [
						...createDynamicRequiredResources(tracked),
						...VISUAL_REQUIRED_RESOURCES,
					],
					setupAnimation: createResolvedSetupAnimationResourceState(tracked),
					status: "failed",
					visual: {
						failures,
						missingRefs,
						status: "failed",
						unsupportedReasons,
					},
				},
			});
			return;
		}

		current.leases.push(
			...resourceKeys.map((key) =>
				this.#assetService.acquirePreparedAssetLease(key),
			),
		);
		let renderParts: readonly DynamicEntityRenderPart[];
		try {
			renderParts = createDynamicRenderParts({
				materialPlans: materialPlans.materialPlans,
				preparedAssets: visualHostAssets.preparedAssets,
				sourceAssets,
				textureRequirements,
			});
		} catch (error) {
			const failures = [createDynamicRenderPartExtractionFailure(error)];
			this.#onResourcesChanged?.({
				entityId,
				failures,
				kind: "visual-resources-failed",
				resources: {
					required: [
						...createDynamicRequiredResources(tracked),
						...VISUAL_REQUIRED_RESOURCES,
					],
					setupAnimation: createResolvedSetupAnimationResourceState(tracked),
					status: "failed",
					visual: {
						failures,
						missingRefs: [],
						status: "failed",
						unsupportedReasons: [],
					},
				},
			});
			return;
		}
		this.#onResourcesChanged?.({
			entityId,
			kind: "visual-resources-ready",
			resources: {
				required: [
					...createDynamicRequiredResources(tracked),
					...VISUAL_REQUIRED_RESOURCES,
				],
				setupAnimation: createResolvedSetupAnimationResourceState(tracked),
				status: "ready",
				visual: {
					materialSlots: materialSlots.map((slot) => ({
						identity: slot.identity,
						material: slot.planningFacts.material,
						partIndex: slot.partIndex,
						slot: slot.partSlot,
					})),
					materialSources: closure.materialSources,
					paletteSources: closure.paletteSources,
					renderParts,
					sourceAssets,
					status: "ready",
					textureRefs: closure.textureRefs,
					textureRequirements,
				},
			},
		});
	}

	async #requestVisualHostAssets(
		keys: readonly HostAssetKey[],
	): Promise<DynamicVisualHostAssetRequestResult> {
		const failures: DynamicEntityResourceFailure[] = [];
		const preparedAssets = new Map<string, PreparedAsset>();
		await Promise.all(
			uniqueHostAssetKeys(keys).map(async (key) => {
				try {
					preparedAssets.set(
						describeHostAssetKey(key),
						await this.#assetService.requestPreparedAsset(key),
					);
				} catch (error) {
					failures.push({
						message: formatErrorMessage(error),
						resource: createRequiredResourceFromHostKey(key),
						resourceKey: createResourceKeyFromHostKey(key),
					});
				}
			}),
		);
		return {
			failures,
			preparedAssets,
		};
	}

	#nextGeneration(): number {
		this.#generation += 1;
		return this.#generation;
	}
}

type SetupAnimationResourceKeys =
	| {
			readonly kind: "explicit-animation";
			readonly animationHostKey: HostAssetKey;
			readonly animationResourceKey: DynamicEntityResourceKey;
			readonly setupHostKey: HostAssetKey;
			readonly setupResourceKey: DynamicEntityResourceKey;
	  }
	| {
			readonly kind: "no-animation";
			readonly setupHostKey: HostAssetKey;
			readonly setupResourceKey: DynamicEntityResourceKey;
	  }
	| {
			readonly kind: "setup-default-unresolved";
			readonly setupHostKey: HostAssetKey;
			readonly setupResourceKey: DynamicEntityResourceKey;
	  };

function createSetupAnimationResourceKeys(
	visualSource: DynamicVisualSource,
): SetupAnimationResourceKeys {
	const setupHostKey = createHostAssetKey(
		"setup-model",
		visualSource.setupModelId,
	);
	const setupResourceKey = {
		id: visualSource.setupModelId,
		kind: "setup-model" as const,
	};
	if (visualSource.animationSelection.kind === "setup-default") {
		return {
			kind: "setup-default-unresolved",
			setupHostKey,
			setupResourceKey,
		};
	}
	if (visualSource.animationSelection.kind === "none") {
		return {
			kind: "no-animation",
			setupHostKey,
			setupResourceKey,
		};
	}

	return {
		animationHostKey: createHostAssetKey(
			"animation",
			visualSource.animationSelection.animationId,
		),
		animationResourceKey: {
			id: visualSource.animationSelection.animationId,
			kind: "animation",
		},
		kind: "explicit-animation",
		setupHostKey,
		setupResourceKey,
	};
}

function createMaterialPlanningLandblockSource(
	visualSource: DynamicVisualSource,
): LandblockSourceIdentity {
	return {
		kind: "landblock-source",
		landblockId: visualSource.effectiveResidence.landblockId,
		source:
			visualSource.effectiveResidence.kind === "env-cell"
				? "env-cells"
				: "outdoor",
	};
}

function createDynamicMaterialPlanningDomain(
	presentation: DynamicEntityPresentation,
): StaticMaterialPlanningDomain {
	return presentation.policy.materialPlanningDomain;
}

function reportUnresolvedSetupDefaultAnimation(
	entityId: DynamicEntityId,
): void {
	console.warn(
		`[holtburger-3d][dynamic-resources] ${entityId} requested setup-default animation, but setup-default animation evidence is not available yet. Runtime resource tracking requires an explicit animation id.`,
	);
}

function reportPendingRuntimeMaterialPlanning(
	entityId: DynamicEntityId,
	reason: DynamicPendingMaterialPlanningReason,
): void {
	console.warn(
		`[holtburger-3d][dynamic-resources] ${entityId} cannot prepare visual resources yet: ${reason}.`,
	);
}

function createReadySetupAnimationResourceState(
	tracked: TrackedDynamicEntityResources,
): Extract<
	DynamicEntitySetupAnimationResourceState,
	{ readonly status: "ready" }
> {
	if (tracked.animationResource === null) {
		throw new Error("dynamic setup animation resource is not ready");
	}
	const animationResourceKey = requireAnimationResourceKey(tracked);
	return {
		animation: tracked.animationResource,
		animationKey: animationResourceKey,
		setupModelKey: tracked.setupResourceKey,
		status: "ready",
	};
}

function createResolvedSetupAnimationResourceState(
	tracked: TrackedDynamicEntityResources,
): Extract<
	DynamicEntitySetupAnimationResourceState,
	{ readonly status: "not-required" | "ready" }
> {
	if (tracked.animationHostKey === undefined) {
		return {
			reason: "animation-not-selected",
			setupModelKey: tracked.setupResourceKey,
			status: "not-required",
		};
	}
	return createReadySetupAnimationResourceState(tracked);
}

function createDynamicRequiredResources(
	tracked: TrackedDynamicEntityResources,
): readonly DynamicEntityRequiredResource[] {
	return tracked.animationHostKey === undefined
		? ["setup-model"]
		: SETUP_ANIMATION_REQUIRED_RESOURCES;
}

function requireAnimationResourceKey(
	tracked: TrackedDynamicEntityResources,
): DynamicEntityResourceKey {
	if (tracked.animationResourceKey === undefined) {
		throw new Error("dynamic animation resource key was expected");
	}
	return tracked.animationResourceKey;
}

function resolveAnimationAssetResult(
	result: PromiseSettledResult<unknown> | undefined,
): PreparedAsset | null {
	if (result?.status !== "fulfilled") {
		return null;
	}
	return isPreparedAsset(result.value) ? result.value : null;
}

function resolveAnimationPayload(
	asset: PreparedAsset,
): AnimationPayloadDto | null {
	return isAnimationPayload(asset.payload) ? asset.payload : null;
}

function isPreparedAsset(value: unknown): value is PreparedAsset {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Partial<PreparedAsset>;
	return (
		typeof candidate.sourceAssetId === "string" &&
		typeof candidate.payload === "object" &&
		candidate.payload !== null
	);
}

function isAnimationPayload(value: unknown): value is AnimationPayloadDto {
	return animationPayloadDtoSchema.safeParse(value).success;
}

function reportAnimationResourceWarnings(
	animationAssetId: string,
	payload: AnimationPayloadDto,
): void {
	if (
		payload.objectPositionFrames.length > 0 &&
		payload.objectPositionFrames.length !== payload.frameCount
	) {
		warnOnce(
			[
				"malformed-object-position-frames",
				animationAssetId,
				payload.animationId,
				payload.frameCount,
				payload.objectPositionFrames.length,
			].join("|"),
			() => {
				console.warn(
					"[holtburger-3d][dynamic-animation-malformed-object-position-frames]",
					{
						animationAssetId,
						animationId: payload.animationId,
						expectedFrameCount: payload.frameCount,
						objectPositionFrameCount: payload.objectPositionFrames.length,
					},
				);
			},
		);
	}

	for (
		let frameIndex = 0;
		frameIndex < payload.partFrames.length;
		frameIndex += 1
	) {
		const partFrame = payload.partFrames[frameIndex];
		if (!partFrame) {
			continue;
		}
		for (const hook of partFrame.hooks) {
			if (hook.payloadKind === "none" || hook.payloadKind === "set-omega") {
				continue;
			}
			warnOnce(
				[
					"unsupported-hook",
					animationAssetId,
					payload.animationId,
					frameIndex,
					hook.hookType,
					hook.hookName,
					hook.payloadKind,
				].join("|"),
				() => {
					console.warn("[holtburger-3d][dynamic-animation-hook-unsupported]", {
						animationAssetId,
						animationId: payload.animationId,
						frameIndex,
						hookName: hook.hookName,
						hookType: hook.hookType,
						payloadKind: hook.payloadKind,
					});
				},
			);
		}
	}
}

function warnOnce(warningKey: string, warn: () => void): void {
	if (reportedAnimationResourceWarnings.has(warningKey)) {
		return;
	}
	reportedAnimationResourceWarnings.add(warningKey);
	warn();
}

function createSetupAnimationLoadFailures(
	tracked: TrackedDynamicEntityResources,
	results: readonly PromiseSettledResult<unknown>[],
): readonly DynamicEntityResourceFailure[] {
	const failures: DynamicEntityResourceFailure[] = [];
	const setupResult = results[0];
	const animationResult = results[1];

	if (setupResult?.status === "rejected") {
		failures.push({
			message: formatErrorMessage(setupResult.reason),
			resource: "setup-model",
			resourceKey: tracked.setupResourceKey,
		});
	}

	if (
		animationResult?.status === "rejected" &&
		tracked.animationResourceKey !== undefined
	) {
		failures.push({
			message: formatErrorMessage(animationResult.reason),
			resource: "animation",
			resourceKey: tracked.animationResourceKey,
		});
	}

	return failures;
}

function formatErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface DynamicMaterialSlotFacts {
	readonly identity: DynamicVisualMaterialSlotIdentity;
	readonly partIndex: number;
	readonly partSlot: StaticObjectPartMaterialSlotFacts;
	readonly planningFacts: StaticMaterialPlanningSlotFacts;
}

function createDynamicMaterialSlotRequirements(
	visualObject: DynamicVisualObjectIdentity,
	sourceAssets: readonly StaticObjectSourceAssetFacts[],
): readonly DynamicMaterialSlotFacts[] {
	return sourceAssets.flatMap((source) =>
		source.parts.flatMap((part) =>
			part.materialSlots.map((slot) => {
				const visualPart = createDynamicVisualPartIdentity({
					part,
					source,
					visualObject,
				});
				return {
					identity: createDynamicVisualMaterialSlotIdentity({
						part: visualPart,
						slot,
					}),
					partIndex: part.partIndex,
					partSlot: slot,
					planningFacts: {
						material: slot.material,
						paletteOverride: slot.paletteOverride,
						paletteViews: slot.paletteViews,
					},
				};
			}),
		),
	);
}

function createDynamicVisualPartIdentity(options: {
	readonly part: StaticObjectSourceAssetFacts["parts"][number];
	readonly source: StaticObjectSourceAssetFacts;
	readonly visualObject: DynamicVisualObjectIdentity;
}): DynamicVisualPartIdentity {
	return {
		gfxObj: options.part.gfxObj,
		kind: "dynamic-visual-part",
		object: options.visualObject,
		partIndex: options.part.partIndex,
		source: options.source.identity,
	};
}

function createDynamicVisualMaterialSlotIdentity(options: {
	readonly part: DynamicVisualPartIdentity;
	readonly slot: StaticObjectPartMaterialSlotFacts;
}): DynamicVisualMaterialSlotIdentity {
	return {
		geometrySurfaceId: options.slot.geometrySurfaceId,
		kind: "dynamic-visual-material-slot",
		materialSurfaceId: options.slot.materialSurfaceId,
		part: options.part,
		slotIndex: options.slot.slotIndex,
	};
}

function createTextureRequirements(
	materialPlans: readonly StaticMaterialPlan[],
): readonly DynamicEntityTextureRequirement[] {
	return materialPlans.flatMap((plan) => {
		const dataUses = plan.textureRoles.map((role) => role.dataUse);
		const wrapMode = resolveRepeatedStaticMaterialPrimaryWrapMode(dataUses);
		return plan.textureRoles.map(
			(role): DynamicEntityTextureRequirement => ({
				dataUse: role.dataUse,
				key: createTextureRequirementKey(role.dataUse),
				material: plan.material,
				role: role.role,
				samplingPolicy: createStaticMaterialTextureSamplingPolicy({
					dataUse: role.dataUse,
					wrapMode,
				}),
				textureUseId: createDynamicTextureUseId(plan, role),
			}),
		);
	});
}

function createDynamicTextureUseId(
	plan: StaticMaterialPlan,
	role: StaticMaterialPlan["textureRoles"][number],
): string {
	return [
		"dynamic-texture",
		plan.material.materialId.toString(16).padStart(8, "0"),
		role.role,
		role.dataUse.kind === "palette-texture-use"
			? role.dataUse.palette.paletteId.toString(16).padStart(8, "0")
			: createPreparedTextureHostKey(role.dataUse).id,
	].join(":");
}

function createTextureRequirementKey(
	dataUse: MaterialTextureDataUseIdentity,
): DynamicEntityResourceKey {
	if (dataUse.kind === "palette-texture-use") {
		return {
			id: dataUse.palette.paletteId,
			kind: "palette",
		};
	}

	return {
		id: createPreparedTextureHostKey(dataUse).id,
		kind: "prepared-texture",
	};
}

function createUnsupportedMaterialReasons(
	reasons: readonly StaticMaterialFallbackReason[],
): readonly DynamicEntityUnsupportedMaterialReason[] {
	return reasons.map((reason) => ({
		code: reason.code,
		material: reason.material,
		message: reason.message,
	}));
}

function createDynamicRenderParts(options: {
	readonly materialPlans: readonly StaticMaterialPlan[];
	readonly preparedAssets: ReadonlyMap<string, PreparedAsset>;
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): readonly DynamicEntityRenderPart[] {
	const materialEntryByMaterialId = createDynamicMaterialEntriesByMaterialId(
		options.materialPlans,
		options.textureRequirements,
	);
	const parts: DynamicEntityRenderPart[] = [];
	for (const sourceAsset of options.sourceAssets) {
		for (const part of sourceAsset.parts) {
			const key = createHostAssetKey("gfx-obj", part.gfxObj.sourceDid);
			const prepared = options.preparedAssets.get(describeHostAssetKey(key));
			if (!prepared) {
				throw new Error(
					`Dynamic render part ${part.partIndex} missing prepared gfx asset ${describeHostAssetKey(key)}.`,
				);
			}
			const gfxObj = resolveGfxObjPayload(prepared, part.partIndex);
			parts.push(
				...createDynamicRenderPartSlices({
					gfxObj,
					materialEntryByMaterialId,
					part,
				}),
			);
		}
	}
	return parts;
}

function resolveGfxObjPayload(
	prepared: PreparedAsset,
	partIndex: number,
): GfxObjPayloadDto {
	if (
		typeof prepared.payload !== "object" ||
		prepared.payload === null ||
		!("kind" in prepared.payload) ||
		prepared.payload.kind !== "gfx-obj"
	) {
		throw new Error(
			`Dynamic render part ${partIndex} expected prepared gfx-obj payload for ${describeHostAssetKey(prepared.key)}.`,
		);
	}
	return prepared.payload as GfxObjPayloadDto;
}

interface DynamicTriangleRenderCandidate {
	readonly materialEntry: DynamicMaterialRenderEntry;
	readonly triangle: StaticObjectSourceAssetFacts["parts"][number]["triangles"][number];
}

function createDynamicRenderPartSlices(options: {
	readonly gfxObj: GfxObjPayloadDto;
	readonly materialEntryByMaterialId: ReadonlyMap<
		number,
		DynamicMaterialRenderEntry
	>;
	readonly part: StaticObjectSourceAssetFacts["parts"][number];
}): readonly DynamicEntityRenderPart[] {
	const triangles = options.part.triangles;
	const sourcePositions = asFloat32Array(
		options.gfxObj.renderGeometry.positions,
	);
	const sourceTexCoords = asFloat32Array(options.gfxObj.renderGeometry.uvs);
	const renderEntries = uniqueMaterialRenderEntries(
		options.part.materialSlots.flatMap((slot) => {
			const renderEntry = options.materialEntryByMaterialId.get(
				slot.material.materialId,
			);
			if (!renderEntry) {
				throw new Error(
					`Dynamic render part ${options.part.partIndex} has no material entry for material 0x${slot.material.materialId.toString(16).padStart(8, "0")}.`,
				);
			}
			return [renderEntry];
		}),
	);
	if (renderEntries.length === 0) {
		throw new Error(
			`Dynamic render part ${options.part.partIndex} has no material entries.`,
		);
	}
	const materialEntryBySurfaceId = new Map(
		options.part.materialSlots.flatMap((slot) => {
			const renderEntry = renderEntries.find((entry) =>
				entry.entry.materialIds.includes(slot.material.materialId),
			);
			if (!renderEntry) {
				throw new Error(
					`Dynamic render part ${options.part.partIndex} cannot map surface ${slot.geometrySurfaceId} to a material entry.`,
				);
			}
			return uniqueNumbers([
				slot.geometrySurfaceId,
				slot.materialSurfaceId,
			]).map((surfaceId) => [surfaceId, renderEntry] as const);
		}),
	);
	const candidateSlices = new Map<string, DynamicTriangleRenderCandidate[]>();
	for (
		let triangleIndex = 0;
		triangleIndex < triangles.length;
		triangleIndex += 1
	) {
		const triangle = triangles[triangleIndex];
		if (!triangle) {
			continue;
		}
		const materialEntry = resolveDynamicTriangleMaterialEntry({
			materialEntryBySurfaceId,
			partIndex: options.part.partIndex,
			triangleGeometrySurfaceId: triangle.geometrySurfaceId,
		});
		const compatibilityKey =
			createDynamicMaterialCompatibilityKey(materialEntry);
		const existing = candidateSlices.get(compatibilityKey);
		const candidate = { materialEntry, triangle };
		if (existing) {
			existing.push(candidate);
		} else {
			candidateSlices.set(compatibilityKey, [candidate]);
		}
	}
	return [...candidateSlices.values()].map((candidates) =>
		createDynamicRenderPartSlice({
			candidates,
			part: options.part,
			sourcePositions,
			sourceTexCoords,
		}),
	);
}

function createDynamicRenderPartSlice(options: {
	readonly candidates: readonly DynamicTriangleRenderCandidate[];
	readonly part: StaticObjectSourceAssetFacts["parts"][number];
	readonly sourcePositions: Float32Array;
	readonly sourceTexCoords: Float32Array;
}): DynamicEntityRenderPart {
	const positions = new Float32Array(options.candidates.length * 9);
	const texCoords = new Float32Array(options.candidates.length * 6);
	const materialSlotIndices = new Float32Array(options.candidates.length * 3);
	const indices =
		options.candidates.length * 3 > 65535
			? new Uint32Array(options.candidates.length * 3)
			: new Uint16Array(options.candidates.length * 3);
	const renderEntries = uniqueMaterialRenderEntries(
		options.candidates.map((candidate) => candidate.materialEntry),
	);
	const materialEntries = renderEntries.map((entry) => entry.entry);
	for (
		let triangleIndex = 0;
		triangleIndex < options.candidates.length;
		triangleIndex += 1
	) {
		const candidate = options.candidates[triangleIndex];
		if (!candidate) {
			continue;
		}
		const { materialEntry, triangle } = candidate;
		for (let vertex = 0; vertex < 3; vertex += 1) {
			const sourceVertexIndex = triangle.firstVertex + vertex;
			const targetVertexIndex = triangleIndex * 3 + vertex;
			assertDynamicSourceVertexAvailable({
				partIndex: options.part.partIndex,
				sourcePositions: options.sourcePositions,
				sourceTexCoords: options.sourceTexCoords,
				sourceVertexIndex,
			});
			positions[targetVertexIndex * 3] = options.sourcePositions[
				sourceVertexIndex * 3
			] as number;
			positions[targetVertexIndex * 3 + 1] = options.sourcePositions[
				sourceVertexIndex * 3 + 1
			] as number;
			positions[targetVertexIndex * 3 + 2] = options.sourcePositions[
				sourceVertexIndex * 3 + 2
			] as number;
			texCoords[targetVertexIndex * 2] = options.sourceTexCoords[
				sourceVertexIndex * 2
			] as number;
			texCoords[targetVertexIndex * 2 + 1] = options.sourceTexCoords[
				sourceVertexIndex * 2 + 1
			] as number;
			materialSlotIndices[targetVertexIndex] = materialEntry.entry.slot;
			indices[targetVertexIndex] = targetVertexIndex;
		}
	}
	const firstMaterial = renderEntries[0] as DynamicMaterialRenderEntry;
	return {
		bounds: options.part.bounds,
		indexType: indices instanceof Uint16Array ? "uint16" : "uint32",
		indices,
		materialEntries,
		materialFamily: firstMaterial.family,
		materialPass: firstMaterial.pass,
		materialSlotIndices,
		partIndex: options.part.partIndex,
		positions,
		renderState: firstMaterial.entry.renderState,
		sourceAssetId: `gfx-obj/${options.part.gfxObj.sourceDid.toString(16).padStart(8, "0")}`,
		texCoords,
		textureUseIds: uniqueSortedStrings(
			materialEntries.flatMap((entry) =>
				[
					entry.primaryTextureUseId,
					entry.indexTextureUseId,
					entry.paletteTextureUseId,
					entry.detailTextureUseId,
				].filter(
					(textureUseId): textureUseId is string => textureUseId !== null,
				),
			),
		),
		triangleCount: options.candidates.length,
		vertexCount: options.candidates.length * 3,
	};
}

function resolveDynamicTriangleMaterialEntry(options: {
	readonly materialEntryBySurfaceId: ReadonlyMap<
		number,
		DynamicMaterialRenderEntry
	>;
	readonly partIndex: number;
	readonly triangleGeometrySurfaceId: number | null;
}): DynamicMaterialRenderEntry {
	if (options.triangleGeometrySurfaceId === null) {
		if (options.materialEntryBySurfaceId.size === 1) {
			return [
				...options.materialEntryBySurfaceId.values(),
			][0] as DynamicMaterialRenderEntry;
		}
		throw new Error(
			`Dynamic render part ${options.partIndex} has a triangle without geometry surface id and ${options.materialEntryBySurfaceId.size} material slots.`,
		);
	}
	const materialEntry = options.materialEntryBySurfaceId.get(
		options.triangleGeometrySurfaceId,
	);
	if (materialEntry === undefined) {
		throw new Error(
			`Dynamic render part ${options.partIndex} has no material slot for geometry surface ${options.triangleGeometrySurfaceId}.`,
		);
	}
	return materialEntry;
}

function createDynamicMaterialCompatibilityKey(
	entry: DynamicMaterialRenderEntry,
): string {
	const { blend, depthTest, depthWrite } = entry.entry.renderState;
	return [
		`family:${entry.family}`,
		`pass:${entry.pass}`,
		`blend:${blend.enabled}:${blend.mode}:${blend.srcFactor ?? "none"}:${blend.dstFactor ?? "none"}`,
		`depth:${depthTest}:${depthWrite}`,
	].join("|");
}

function assertDynamicSourceVertexAvailable(options: {
	readonly partIndex: number;
	readonly sourcePositions: Float32Array;
	readonly sourceTexCoords: Float32Array;
	readonly sourceVertexIndex: number;
}): void {
	const positionOffset = options.sourceVertexIndex * 3;
	const texCoordOffset = options.sourceVertexIndex * 2;
	if (positionOffset + 2 >= options.sourcePositions.length) {
		throw new Error(
			`Dynamic render part ${options.partIndex} triangle references missing position vertex ${options.sourceVertexIndex}.`,
		);
	}
	if (texCoordOffset + 1 >= options.sourceTexCoords.length) {
		throw new Error(
			`Dynamic render part ${options.partIndex} triangle references missing texcoord vertex ${options.sourceVertexIndex}.`,
		);
	}
}

function createDynamicMaterialEntriesByMaterialId(
	materialPlans: readonly StaticMaterialPlan[],
	textureRequirements: readonly DynamicEntityTextureRequirement[],
): ReadonlyMap<number, DynamicMaterialRenderEntry> {
	return new Map(
		materialPlans.map((plan, slot): [number, DynamicMaterialRenderEntry] => [
			plan.material.materialId,
			createDynamicMaterialEntry(plan, slot, textureRequirements),
		]),
	);
}

function resolveDynamicTextureUseId(options: {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly materialId: number;
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): string {
	const key = createTextureRequirementKey(options.dataUse);
	const requirement = options.textureRequirements.find(
		(candidate) =>
			candidate.material.materialId === options.materialId &&
			candidate.key.kind === key.kind &&
			candidate.key.id === key.id,
	);
	if (!requirement) {
		throw new Error(
			`Dynamic material 0x${options.materialId.toString(16).padStart(8, "0")} has no texture use id for ${key.kind}:${key.id}.`,
		);
	}
	return requirement.textureUseId;
}

function createDynamicMaterialEntry(
	plan: StaticMaterialPlan,
	slot: number,
	textureRequirements: readonly DynamicEntityTextureRequirement[],
): DynamicMaterialRenderEntry {
	const dataUses = plan.textureRoles.map((role) => role.dataUse);
	const textureWrapMode =
		resolveRepeatedStaticMaterialPrimaryWrapMode(dataUses);
	return {
		entry: createStaticMaterialTableEntry({
			createTextureUseId: (dataUse) =>
				resolveDynamicTextureUseId({
					dataUse,
					materialId: plan.material.materialId,
					textureRequirements,
				}),
			materialIds: [plan.material.materialId],
			plan,
			slot,
			textureWrapMode,
		}),
		family: resolveDynamicRenderableMaterialFamily(plan),
		pass: plan.pass,
	};
}

function asFloat32Array(
	values: readonly number[] | Float32Array,
): Float32Array {
	return values instanceof Float32Array ? values : new Float32Array(values);
}

function resolveDynamicRenderableMaterialFamily(
	plan: StaticMaterialPlan,
): DynamicMaterialRenderFamily {
	if (
		plan.family === "flat-color" ||
		plan.family === "indexed-paletted" ||
		plan.family === "texture-rgba"
	) {
		return plan.family;
	}
	throw new Error(
		`Dynamic material 0x${plan.material.materialId.toString(16).padStart(8, "0")} has unrenderable family ${plan.family}.`,
	);
}

function uniqueMaterialRenderEntries(
	entries: readonly DynamicMaterialRenderEntry[],
): readonly DynamicMaterialRenderEntry[] {
	const byMaterialId = new Map<number, DynamicMaterialRenderEntry>();
	for (const entry of entries) {
		const materialId = entry.entry.materialIds[0];
		if (materialId !== undefined) {
			byMaterialId.set(materialId, entry);
		}
	}
	return [...byMaterialId.values()].sort(
		(left, right) => left.entry.slot - right.entry.slot,
	);
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)];
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function createDynamicRenderPartExtractionFailure(
	error: unknown,
): DynamicEntityResourceFailure {
	return {
		message: formatErrorMessage(error),
		resource: "gfx",
		resourceKey: {
			id: "dynamic-render-parts",
			kind: "gfx",
		},
	};
}

function createMissingRefFailures(
	missingRefs: readonly StaticResourceIdentity[],
): readonly DynamicEntityResourceFailure[] {
	return missingRefs.map((ref) => {
		const resourceKey = createResourceKeyFromMissingRef(ref);
		return {
			message: `Missing dynamic visual resource ${formatMissingRef(ref)}.`,
			resource: resourceKey.kind,
			resourceKey,
		};
	});
}

function createResourceKeyFromMissingRef(
	ref: StaticResourceIdentity,
): DynamicEntityResourceKey {
	switch (ref.kind) {
		case "static-object-source":
			return {
				id: ref.sourceDid,
				kind: ref.sourceAssetKind === "gfx-obj" ? "gfx" : ref.sourceAssetKind,
			};
		case "static-material-source":
			return {
				id: ref.materialId,
				kind: "material",
			};
		case "surface-texture":
			return {
				id: ref.surfaceTextureId,
				kind: "prepared-texture",
			};
		case "render-surface":
			return {
				id: ref.renderSurfaceId,
				kind: "render-surface",
			};
		case "palette":
			return {
				id: ref.paletteId,
				kind: "palette",
			};
		default:
			return {
				id: formatMissingRef(ref),
				kind: "prepared-texture",
			};
	}
}

function formatMissingRef(ref: StaticResourceIdentity): string {
	if (ref.kind === "static-object-source") {
		return `${ref.sourceAssetKind}:${ref.sourceDid.toString(16).padStart(8, "0")}`;
	}
	if (ref.kind === "static-material-source") {
		return `material:${ref.materialId.toString(16).padStart(8, "0")}`;
	}
	if (ref.kind === "surface-texture") {
		return `surface-texture:${ref.surfaceTextureId.toString(16).padStart(8, "0")}`;
	}
	if (ref.kind === "render-surface") {
		return `render-surface:${ref.renderSurfaceId.toString(16).padStart(8, "0")}`;
	}
	if (ref.kind === "palette") {
		return `palette:${ref.paletteId.toString(16).padStart(8, "0")}`;
	}
	return ref.kind;
}

function createVisualHostAssetKeys(options: {
	readonly closure: Awaited<
		ReturnType<typeof resolveStaticObjectSourceClosure>
	>;
	readonly visualSource: DynamicVisualSource;
	readonly setupAppearanceIsMissing: boolean;
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): readonly HostAssetKey[] {
	return uniqueHostAssetKeys([
		...(options.setupAppearanceIsMissing
			? []
			: [
					createHostAssetKey(
						"setup-appearance",
						options.visualSource.setupModelId,
					),
				]),
		...options.closure.sourceAssets.flatMap((source) =>
			source.parts.map((part) =>
				createHostAssetKey("gfx-obj", part.gfxObj.sourceDid),
			),
		),
		...options.closure.materialSources.map((source) =>
			createHostAssetKey("material", source.identity.materialId),
		),
		...options.closure.textureRefs.flatMap((ref) => {
			if (ref.role === "surface-texture") {
				return [
					createHostAssetKey("surface-texture", ref.texture.surfaceTextureId),
				];
			}
			return [
				createHostAssetKey("render-surface", ref.renderSurface.renderSurfaceId),
			];
		}),
		...options.closure.paletteSources.map((source) =>
			createHostAssetKey("palette", source.palette.paletteId),
		),
		...options.textureRequirements.flatMap((requirement) =>
			createTextureRequirementHostKeys(requirement.dataUse),
		),
	]);
}

function isSetupAppearanceRef(ref: StaticResourceIdentity): boolean {
	return (
		ref.kind === "static-object-source" &&
		ref.sourceAssetKind === "setup-appearance"
	);
}

function createRequiredResourceFromHostKey(
	key: HostAssetKey,
): DynamicEntityRequiredResource {
	switch (key.kind) {
		case "setup-appearance":
			return "setup-appearance";
		case "gfx-obj":
			return "gfx";
		case "material":
			return "material";
		case "palette":
			return "palette";
		case "render-surface":
			return "render-surface";
		case "prepared-texture":
			return "prepared-texture";
		default:
			return "prepared-texture";
	}
}

function createResourceKeyFromHostKey(
	key: HostAssetKey,
): DynamicEntityResourceKey {
	const resource = createRequiredResourceFromHostKey(key);
	if (resource === "animation" || resource === "setup-model") {
		return {
			id: Number.parseInt(key.id, 16) >>> 0,
			kind: resource,
		};
	}

	return {
		id: key.id,
		kind: resource,
	};
}

function createTextureRequirementHostKeys(
	dataUse: MaterialTextureDataUseIdentity,
): readonly HostAssetKey[] {
	if (dataUse.kind === "palette-texture-use") {
		return [
			createHostAssetKey("palette", dataUse.palette.paletteId),
			...dataUse.subPalettes.map((subPalette) =>
				createHostAssetKey("palette", subPalette.palette.paletteId),
			),
		];
	}

	return [createPreparedTextureHostKey(dataUse)];
}

function uniqueHostAssetKeys(
	keys: readonly HostAssetKey[],
): readonly HostAssetKey[] {
	return [
		...new Map(keys.map((key) => [describeHostAssetKey(key), key])).values(),
	].sort((left, right) =>
		describeHostAssetKey(left).localeCompare(describeHostAssetKey(right)),
	);
}
