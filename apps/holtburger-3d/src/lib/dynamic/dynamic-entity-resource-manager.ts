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
	StaticMaterialSlotIdentity,
	StaticObjectInstanceIdentity,
	StaticMaterialTableEntry,
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
	type GfxObjPayloadDto,
} from "../host/contracts";
import type {
	DynamicEntityAnimationResource,
	DynamicEntityId,
	DynamicEntityIssue,
	DynamicEntityRenderPart,
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

interface DynamicVisualHostAssetRequestResult {
	readonly issues: readonly DynamicEntityIssue[];
	readonly preparedAssets: ReadonlyMap<string, PreparedAsset>;
}

interface DynamicMaterialRenderEntry {
	readonly entry: StaticMaterialTableEntry;
	readonly family: "flat-color" | "indexed-paletted" | "texture-rgba";
	readonly pass: "opaque" | "alpha-test" | "transparent" | "additive";
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
		const textureRequirements = createTextureRequirements(materialPlans.materialPlans);
		const resourceKeys = createVisualHostAssetKeys({
			closure,
			seed: tracked.seed,
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
			visualHostAssets.issues.length > 0
		) {
			this.#onResourcesChanged?.({
				entityId,
					issues: [
						...createMissingRefIssues(missingRefs),
						...visualHostAssets.issues,
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
		let renderParts: readonly DynamicEntityRenderPart[];
		try {
			renderParts = createDynamicRenderParts({
				materialPlans: materialPlans.materialPlans,
				preparedAssets: visualHostAssets.preparedAssets,
				sourceAssets,
				textureRequirements,
			});
		} catch (error) {
			this.#onResourcesChanged?.({
				entityId,
				issues: [createDynamicRenderPartExtractionIssue(error)],
				kind: "visual-resources-failed",
				resources: {
					required: [
						...SETUP_ANIMATION_REQUIRED_RESOURCES,
						...VISUAL_REQUIRED_RESOURCES,
					],
					setupAnimation: createReadySetupAnimationResourceState(tracked),
					status: "failed",
					visual: {
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
		const issues: DynamicEntityIssue[] = [];
		const preparedAssets = new Map<string, PreparedAsset>();
		await Promise.all(
			uniqueHostAssetKeys(keys).map(async (key) => {
				try {
					preparedAssets.set(
						describeHostAssetKey(key),
						await this.#assetService.requestPreparedAsset(key),
					);
				} catch (error) {
					issues.push({
						kind: "dynamic-resource-load-failed",
						message: formatErrorMessage(error),
						resource: createRequiredResourceFromHostKey(key),
						resourceKey: createResourceKeyFromHostKey(key),
					});
				}
			}),
		);
		return {
			issues,
			preparedAssets,
		};
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
				createDynamicRenderPart({
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

function createDynamicRenderPart(options: {
	readonly gfxObj: GfxObjPayloadDto;
	readonly materialEntryByMaterialId: ReadonlyMap<
		number,
		DynamicMaterialRenderEntry
	>;
	readonly part: StaticObjectSourceAssetFacts["parts"][number];
}): DynamicEntityRenderPart {
	const triangles = options.part.triangles;
	const sourcePositions = asFloat32Array(options.gfxObj.renderGeometry.positions);
	const sourceTexCoords = asFloat32Array(options.gfxObj.renderGeometry.uvs);
	const positions = new Float32Array(triangles.length * 9);
	const texCoords = new Float32Array(triangles.length * 6);
	const materialSlotIndices = new Float32Array(triangles.length * 3);
	const indices =
		triangles.length * 3 > 65535
			? new Uint32Array(triangles.length * 3)
			: new Uint16Array(triangles.length * 3);
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
	const materialEntries = renderEntries.map((entry) => entry.entry);
	const materialSlotEntries = options.part.materialSlots.flatMap((slot) => {
			const materialEntryIndex = renderEntries.findIndex((entry) =>
				entry.entry.materialIds.includes(slot.material.materialId),
			);
			if (materialEntryIndex < 0) {
				throw new Error(
					`Dynamic render part ${options.part.partIndex} cannot map surface ${slot.geometrySurfaceId} to a material entry.`,
				);
			}
			return uniqueNumbers([
				slot.geometrySurfaceId,
				slot.materialSurfaceId,
			]).map((surfaceId) => [surfaceId, materialEntryIndex] as const);
		});
	const materialSlotBySurfaceId = new Map(materialSlotEntries);
	for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
		const triangle = triangles[triangleIndex];
		if (!triangle) {
			continue;
		}
		const materialSlot = resolveDynamicTriangleMaterialSlot({
			materialSlotBySurfaceId,
			partIndex: options.part.partIndex,
			triangleGeometrySurfaceId: triangle.geometrySurfaceId,
		});
		for (let vertex = 0; vertex < 3; vertex += 1) {
			const sourceVertexIndex = triangle.firstVertex + vertex;
			const targetVertexIndex = triangleIndex * 3 + vertex;
			assertDynamicSourceVertexAvailable({
				partIndex: options.part.partIndex,
				sourcePositions,
				sourceTexCoords,
				sourceVertexIndex,
			});
			positions[targetVertexIndex * 3] =
				sourcePositions[sourceVertexIndex * 3] as number;
			positions[targetVertexIndex * 3 + 1] =
				sourcePositions[sourceVertexIndex * 3 + 1] as number;
			positions[targetVertexIndex * 3 + 2] =
				sourcePositions[sourceVertexIndex * 3 + 2] as number;
			texCoords[targetVertexIndex * 2] =
				sourceTexCoords[sourceVertexIndex * 2] as number;
			texCoords[targetVertexIndex * 2 + 1] =
				sourceTexCoords[sourceVertexIndex * 2 + 1] as number;
			materialSlotIndices[targetVertexIndex] = materialSlot;
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
				].filter((textureUseId): textureUseId is string => textureUseId !== null),
			),
		),
		triangleCount: triangles.length,
		vertexCount: triangles.length * 3,
	};
}

function resolveDynamicTriangleMaterialSlot(options: {
	readonly materialSlotBySurfaceId: ReadonlyMap<number, number>;
	readonly partIndex: number;
	readonly triangleGeometrySurfaceId: number | null;
}): number {
	if (options.triangleGeometrySurfaceId === null) {
		if (options.materialSlotBySurfaceId.size === 1) {
			return [...options.materialSlotBySurfaceId.values()][0] as number;
		}
		throw new Error(
			`Dynamic render part ${options.partIndex} has a triangle without geometry surface id and ${options.materialSlotBySurfaceId.size} material slots.`,
		);
	}
	const materialSlot = options.materialSlotBySurfaceId.get(
		options.triangleGeometrySurfaceId,
	);
	if (materialSlot === undefined) {
		throw new Error(
			`Dynamic render part ${options.partIndex} has no material slot for geometry surface ${options.triangleGeometrySurfaceId}.`,
		);
	}
	return materialSlot;
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
	const textureWrapMode = resolveRepeatedStaticMaterialPrimaryWrapMode(dataUses);
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

function asFloat32Array(values: readonly number[] | Float32Array): Float32Array {
	return values instanceof Float32Array ? values : new Float32Array(values);
}

function resolveDynamicRenderableMaterialFamily(
	plan: StaticMaterialPlan,
): DynamicMaterialRenderEntry["family"] {
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

function createDynamicRenderPartExtractionIssue(
	error: unknown,
): DynamicEntityIssue {
	return {
		kind: "dynamic-resource-load-failed",
		message: formatErrorMessage(error),
		resource: "gfx",
		resourceKey: {
			id: "dynamic-render-parts",
			kind: "gfx",
		},
	};
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
