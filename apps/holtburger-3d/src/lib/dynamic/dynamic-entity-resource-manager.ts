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
import type {
	MaterialTextureDataUseIdentity,
	StaticMaterialSlotIdentity,
	StaticObjectInstanceIdentity,
	StaticObjectMaterialSlotFacts,
	StaticObjectPartMaterialSlotFacts,
	StaticObjectSourceAssetFacts,
	StaticResourceIdentity,
} from "../static/contracts";
import {
	planStaticObjectMaterials,
	type StaticMaterialFallbackReason,
	type StaticMaterialPlan,
} from "../static/objects/bake/static-object-material-planner";
import { resolveStaticObjectSourceClosure } from "../static/objects/static-object-source-closure";
import {
	animationPayloadDtoSchema,
	type AnimationPayloadDto,
} from "../host/contracts";
import type {
	DynamicEntityAnimationResource,
	DynamicEntityId,
	DynamicEntityIssue,
	DynamicEntityResourceKey,
	DynamicEntityResourceState,
	DynamicEntityRequiredResource,
	DynamicEntityTextureRequirement,
	DynamicEntityUnsupportedMaterialReason,
	StaticAuthoredDynamicSeedFacts,
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
	readonly issues: readonly DynamicEntityIssue[];
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
	readonly issues: readonly DynamicEntityIssue[];
	readonly kind: "visual-resources-failed";
	readonly resources: DynamicEntityResourceState;
}

interface TrackedDynamicEntityResources {
	readonly animationHostKey: HostAssetKey;
	animationResource: DynamicEntityAnimationResource | null;
	readonly animationResourceKey: DynamicEntityResourceKey;
	readonly generation: number;
	readonly leases: PreparedAssetLease[];
	readonly setupHostKey: HostAssetKey;
	readonly setupResourceKey: DynamicEntityResourceKey;
	readonly seed: StaticAuthoredDynamicSeedFacts;
}

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

	createInitialResourceState(
		seed: StaticAuthoredDynamicSeedFacts,
	): DynamicEntityResourceState {
		const keys = createSetupAnimationResourceKeys(seed);
		return {
			required: SETUP_ANIMATION_REQUIRED_RESOURCES,
			setupAnimation: {
				animationKey: keys.animationResourceKey,
				setupModelKey: keys.setupResourceKey,
				status: "pending",
			},
			status: "pending",
			visual: {
				status: "pending",
			},
		};
	}

	trackSetupAnimationResources(
		entityId: DynamicEntityId,
		seed: StaticAuthoredDynamicSeedFacts,
	): void {
		this.releaseEntity(entityId);

		const keys = createSetupAnimationResourceKeys(seed);
		const generation = this.#nextGeneration();
		this.#trackedByEntityId.set(entityId, {
			...keys,
			animationResource: null,
			generation,
			leases: [],
			seed,
		});

		void Promise.allSettled([
			this.#assetService.requestPreparedAsset(keys.setupHostKey),
			this.#assetService.requestPreparedAsset(keys.animationHostKey),
		]).then((results) => {
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

		const issues = createSetupAnimationLoadIssues(tracked, results);
		const animationAsset =
			issues.length === 0 ? resolveAnimationAssetResult(results[1]) : null;
		const animationPayload =
			animationAsset === null ? null : resolveAnimationPayload(animationAsset);
		const payloadIssues =
			issues.length === 0 && animationPayload === null
				? [
						{
							kind: "dynamic-resource-load-failed" as const,
							message:
								"Prepared animation asset did not contain an animation payload.",
							resource: "animation" as const,
							resourceKey: tracked.animationResourceKey,
						},
					]
				: [];
		const setupIssues = [...issues, ...payloadIssues];
		if (setupIssues.length > 0) {
			this.#onResourcesChanged?.({
				entityId,
				issues: setupIssues,
				kind: "setup-animation-failed",
				resources: {
					required: SETUP_ANIMATION_REQUIRED_RESOURCES,
					setupAnimation: {
						animationKey: tracked.animationResourceKey,
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

		if (animationAsset === null || animationPayload === null) {
			throw new Error("setup animation payload was expected after validation");
		}
		tracked.animationResource = {
			assetId: animationAsset.sourceAssetId,
			payload: animationPayload,
		};
		tracked.leases.push(
			this.#assetService.acquirePreparedAssetLease(tracked.setupHostKey),
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
		const closure = await resolveStaticObjectSourceClosure({
			assetService: this.#assetService,
			sourceAssetIds: [tracked.seed.sourceAssetId],
		});
		const sourceAssets = closure.sourceAssets.filter(
			(source) => source.identity.sourceDid === tracked.seed.setupModelId,
		);
		const missingRefs = closure.missingRefs.filter(
			(ref) =>
				!(
					ref.kind === "static-object-source" &&
					ref.sourceAssetKind === "setup-appearance"
				),
		);
		const materialSlots = createDynamicMaterialSlotRequirements(
			tracked.seed.object,
			sourceAssets,
		);
		const materialPlans = planStaticObjectMaterials({
			domain: createDynamicMaterialPlanningDomain(tracked.seed),
			landblock: tracked.seed.sourceResidence,
			materialSlots: materialSlots.map((slot) => slot.slotFacts),
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
			seed: tracked.seed,
			setupAppearanceIsMissing: closure.missingRefs.some(isSetupAppearanceRef),
			textureRequirements,
		});
		const loadIssues = await this.#requestVisualHostAssets(resourceKeys);
		const current = this.#trackedByEntityId.get(entityId);
		if (!current || current.generation !== generation) {
			return;
		}

		if (
			missingRefs.length > 0 ||
			unsupportedReasons.length > 0 ||
			loadIssues.length > 0
		) {
			this.#onResourcesChanged?.({
				entityId,
				issues: [
					...createMissingRefIssues(missingRefs),
					...loadIssues,
					...(unsupportedReasons.length > 0
						? [
								{
									kind: "visual-resources-unsupported" as const,
									reasons: unsupportedReasons,
								},
							]
						: []),
				],
				kind: "visual-resources-failed",
				resources: {
					required: [
						...SETUP_ANIMATION_REQUIRED_RESOURCES,
						...VISUAL_REQUIRED_RESOURCES,
					],
					setupAnimation: createReadySetupAnimationResourceState(tracked),
					status: "failed",
					visual: {
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
		this.#onResourcesChanged?.({
			entityId,
			kind: "visual-resources-ready",
			resources: {
				required: [
					...SETUP_ANIMATION_REQUIRED_RESOURCES,
					...VISUAL_REQUIRED_RESOURCES,
				],
				setupAnimation: createReadySetupAnimationResourceState(tracked),
				status: "ready",
				visual: {
					materialSlots: materialSlots.map((slot) => ({
						material: slot.slotFacts.material,
						partIndex: slot.partIndex,
						slot: slot.partSlot,
					})),
					materialSources: closure.materialSources,
					paletteSources: closure.paletteSources,
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
	): Promise<readonly DynamicEntityIssue[]> {
		const results = await Promise.allSettled(
			uniqueHostAssetKeys(keys).map((key) =>
				this.#assetService.requestPreparedAsset(key).then(
					() => ({
						key,
						status: "fulfilled" as const,
					}),
					(error: unknown) => ({
						error,
						key,
						status: "rejected" as const,
					}),
				),
			),
		);
		return results.flatMap((result) => {
			if (
				result.status !== "fulfilled" ||
				result.value.status === "fulfilled"
			) {
				return [];
			}
			const key = result.value.key;
			return [
				{
					kind: "dynamic-resource-load-failed" as const,
					message: formatErrorMessage(result.value.error),
					resource: createRequiredResourceFromHostKey(key),
					resourceKey: createResourceKeyFromHostKey(key),
				},
			];
		});
	}

	#nextGeneration(): number {
		this.#generation += 1;
		return this.#generation;
	}
}

function createSetupAnimationResourceKeys(
	seed: StaticAuthoredDynamicSeedFacts,
): {
	readonly animationHostKey: HostAssetKey;
	readonly animationResourceKey: DynamicEntityResourceKey;
	readonly setupHostKey: HostAssetKey;
	readonly setupResourceKey: DynamicEntityResourceKey;
} {
	return {
		animationHostKey: createHostAssetKey("animation", seed.defaultAnimationId),
		animationResourceKey: {
			id: seed.defaultAnimationId,
			kind: "animation",
		},
		setupHostKey: createHostAssetKey("setup-model", seed.setupModelId),
		setupResourceKey: {
			id: seed.setupModelId,
			kind: "setup-model",
		},
	};
}

function createReadySetupAnimationResourceState(
	tracked: TrackedDynamicEntityResources,
): Extract<
	DynamicEntityResourceState["setupAnimation"],
	{ readonly status: "ready" }
> {
	if (tracked.animationResource === null) {
		throw new Error("dynamic setup animation resource is not ready");
	}
	return {
		animation: tracked.animationResource,
		animationKey: tracked.animationResourceKey,
		setupModelKey: tracked.setupResourceKey,
		status: "ready",
	};
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

function createSetupAnimationLoadIssues(
	tracked: TrackedDynamicEntityResources,
	results: readonly PromiseSettledResult<unknown>[],
): readonly DynamicEntityIssue[] {
	const issues: DynamicEntityIssue[] = [];
	const setupResult = results[0];
	const animationResult = results[1];

	if (setupResult?.status === "rejected") {
		issues.push({
			kind: "dynamic-resource-load-failed",
			message: formatErrorMessage(setupResult.reason),
			resource: "setup-model",
			resourceKey: tracked.setupResourceKey,
		});
	}

	if (animationResult?.status === "rejected") {
		issues.push({
			kind: "dynamic-resource-load-failed",
			message: formatErrorMessage(animationResult.reason),
			resource: "animation",
			resourceKey: tracked.animationResourceKey,
		});
	}

	return issues;
}

function formatErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface DynamicMaterialSlotFacts {
	readonly partIndex: number;
	readonly partSlot: StaticObjectPartMaterialSlotFacts;
	readonly slotFacts: StaticObjectMaterialSlotFacts;
}

function createDynamicMaterialSlotRequirements(
	object: StaticObjectInstanceIdentity,
	sourceAssets: readonly StaticObjectSourceAssetFacts[],
): readonly DynamicMaterialSlotFacts[] {
	return sourceAssets.flatMap((source) =>
		source.parts.flatMap((part) =>
			part.materialSlots.map((slot) => ({
				partIndex: part.partIndex,
				partSlot: slot,
				slotFacts: {
					gfxObj: part.gfxObj,
					identity: createStaticMaterialSlotIdentity({
						geometrySurfaceId: slot.geometrySurfaceId,
						materialSurfaceId: slot.materialSurfaceId,
						object,
						partIndex: part.partIndex,
						slotIndex: slot.slotIndex,
					}),
					material: slot.material,
					materialVariantSignature: slot.materialVariantSignature,
					object,
					paletteOverride: slot.paletteOverride,
					paletteViews: slot.paletteViews,
					source: source.identity,
				},
			})),
		),
	);
}

function createStaticMaterialSlotIdentity(options: {
	readonly geometrySurfaceId: number;
	readonly materialSurfaceId: number;
	readonly object: StaticObjectInstanceIdentity;
	readonly partIndex: number;
	readonly slotIndex: number;
}): StaticMaterialSlotIdentity {
	return {
		geometrySurfaceId: options.geometrySurfaceId,
		kind: "static-material-slot",
		materialSurfaceId: options.materialSurfaceId,
		part: {
			kind: "static-object-part",
			object: options.object,
			partIndex: options.partIndex,
		},
		slotIndex: options.slotIndex,
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
			}),
		);
	});
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

function createMissingRefIssues(
	missingRefs: readonly StaticResourceIdentity[],
): readonly DynamicEntityIssue[] {
	return missingRefs.map((ref) => {
		const resourceKey = createResourceKeyFromMissingRef(ref);
		return {
			kind: "dynamic-resource-load-failed" as const,
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
	readonly seed: StaticAuthoredDynamicSeedFacts;
	readonly setupAppearanceIsMissing: boolean;
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}): readonly HostAssetKey[] {
	return uniqueHostAssetKeys([
		...(options.setupAppearanceIsMissing
			? []
			: [createHostAssetKey("setup-appearance", options.seed.setupModelId)]),
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

function createDynamicMaterialPlanningDomain(
	seed: StaticAuthoredDynamicSeedFacts,
): "landblock-env-cells" | "outdoor-buildings" | "outdoor-detail" {
	return seed.sourceResidence.source === "env-cells"
		? "landblock-env-cells"
		: "domain" in seed
			? seed.domain
			: "outdoor-buildings";
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
