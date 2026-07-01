import type {
	MaterialTextureDataUseIdentity,
	StaticBakeBatchAttachments,
	StaticObjectInstanceIdentity,
	StaticObjectMaterialSlotFacts,
	StaticObjectPartSourceFacts,
	StaticObjectSourceGeometryAttachment,
	StaticObjectSourceIdentity,
} from "../../contracts";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	createStaticObjectSourceScaleMatrix,
	multiplyMat4,
} from "../../../math/ac-placement-transform";
import {
	createStaticMaterialColorKey,
	createStaticMaterialRenderState,
	createStaticMaterialTextureRoleLayoutKey,
	createStaticMaterialTextureRoleSchemaKey,
	resolveStaticMaterialDetailTextureTiling,
} from "../../bake/static-material-adapter";
import {
	createObjectVisualMaterialUseKey,
	planObjectVisualMaterials,
	type ObjectVisualMaterialPlan,
	type ObjectVisualMaterialTextureUseRole,
} from "../../../visual/object-visual-material-planner";
import {
	createObjectVisualMissingDependenciesResolution,
	createObjectVisualReadyResolution,
	createObjectVisualRecipeKeyRegistry,
	objectVisualGeometryBufferKey,
	objectVisualGeometryRecipeKey,
	objectVisualMaterialRecipeKey,
	objectVisualPartRecipeKey,
	objectVisualTextureRecipeKey,
	type ObjectVisualBundleResolution,
	type ObjectVisualGeometryBuffer,
	type ObjectVisualGeometryBufferId,
	type ObjectVisualGeometryRecipe,
	type ObjectVisualGeometryRecipeId,
	type ObjectVisualMaterialRecipe,
	type ObjectVisualMaterialRecipeId,
	type ObjectVisualPartRecipeId,
	type ObjectVisualRecipeBundle,
	type ObjectVisualTextureRecipe,
	type ObjectVisualTextureRecipeId,
	type ObjectVisualTextureUsage,
} from "../../../visual/object-visual-recipe-bundle";
import {
	describeStaticObjectCanonicalGeometryIdentity,
	getStaticObjectCanonicalGeometryIdentity,
} from "../static-object-source-assets";
import type { StaticObjectBatchPayload } from "./static-object-batch-partitioner";

export interface StaticObjectVisualBundleExpansion {
	readonly geometryBuffers: ReadonlyMap<
		ObjectVisualGeometryBufferId,
		ObjectVisualGeometryBuffer
	>;
	readonly resolution: ObjectVisualBundleResolution;
}

export function createStaticObjectVisualBundleExpansion(input: {
	readonly attachments: Pick<
		StaticBakeBatchAttachments,
		"staticObjectSourceGeometry"
	>;
	readonly payload: StaticObjectBatchPayload;
}): StaticObjectVisualBundleExpansion {
	const missingAttachments = findMissingGeometryAttachments(
		input.payload,
		input.attachments.staticObjectSourceGeometry,
	);
	if (missingAttachments.length > 0) {
		return {
			geometryBuffers: new Map(),
			resolution: createObjectVisualMissingDependenciesResolution(
				missingAttachments.map((sourceId) => ({
					sourceId,
					sourceKind: "static-object-source-geometry",
				})),
			),
		};
	}

	const materialPlan = planObjectVisualMaterials(input.payload);
	const materialRecipeSpecs = collectMaterialRecipeSpecs({
		materialPlans: materialPlan.materialPlans,
		payload: input.payload,
	});
	const registry = createObjectVisualRecipeKeyRegistry(
		createRecipeKeys({
			materialPlans: materialPlan.materialPlans,
			materialRecipeSpecs,
			payload: input.payload,
		}),
	);
	const geometryBuffers = createGeometryBuffers({
		attachments: input.attachments.staticObjectSourceGeometry,
		registry,
	});
	const materialRecipes = createMaterialRecipes({
		materialRecipeSpecs,
		registry,
	});
	const geometryRecipes = createGeometryRecipes({
		payload: input.payload,
		registry,
	});
	const partRecipes = createPartRecipes({
		materialPlans: materialPlan.materialPlans,
		payload: input.payload,
		registry,
	});
	const partInstances = createPartInstances({
		payload: input.payload,
		registry,
	});
	const bundle: ObjectVisualRecipeBundle = {
		geometryBufferRefs: new Map(
			[...geometryBuffers.values()].map((buffer) => [
				buffer.bufferId,
				{
					coordinateSpace: "source-local",
					sourceKey: `static-object-buffer:${buffer.bufferId}`,
					sourceKind: "gfx-obj",
					triangleCount: buffer.triangleCount,
					vertexCount: buffer.vertexCount,
				},
			]),
		),
		geometryRecipes,
		materialRecipes,
		partInstances,
		partRecipes,
		recipeKeys: registry.recipeKeys,
		textureRecipes: createTextureRecipes({
			materialPlans: materialPlan.materialPlans,
			registry,
		}),
	};

	return {
		geometryBuffers,
		resolution: createObjectVisualReadyResolution(bundle),
	};
}

interface MaterialRecipeSpec {
	readonly key: string;
	readonly plan: ObjectVisualMaterialPlan;
	readonly textureWrapMode: "clamp" | "repeat";
}

function createRecipeKeys(options: {
	readonly payload: StaticObjectBatchPayload;
	readonly materialPlans: readonly ObjectVisualMaterialPlan[];
	readonly materialRecipeSpecs: readonly MaterialRecipeSpec[];
}) {
	const geometryBufferKeys = new Set<string>();
	const geometryRecipeKeys = new Set<string>();
	const partRecipeKeys = new Set<string>();
	for (const source of options.payload.sourceAssets) {
		for (const part of source.parts) {
			const canonical = getStaticObjectCanonicalGeometryIdentity(part.geometry);
			geometryBufferKeys.add(createGeometryBufferKey(canonical));
			geometryRecipeKeys.add(createGeometryRecipeKey(part));
		}
	}
	for (const object of options.payload.objects) {
		const source = requireSource(options.payload, object.source);
		for (const part of source.parts) {
			partRecipeKeys.add(createPartRecipeKey(object.identity, part));
		}
	}

	return {
		geometryBufferKeys: [...geometryBufferKeys].map(
			objectVisualGeometryBufferKey,
		),
		geometryRecipeKeys: [...geometryRecipeKeys].map(
			objectVisualGeometryRecipeKey,
		),
		materialRecipeKeys: options.materialRecipeSpecs.map((spec) =>
			objectVisualMaterialRecipeKey(spec.key),
		),
		partRecipeKeys: [...partRecipeKeys].map(objectVisualPartRecipeKey),
		textureRecipeKeys: createTextureRecipeKeys(options.materialPlans).map(
			objectVisualTextureRecipeKey,
		),
	};
}

function createGeometryBuffers(options: {
	readonly attachments: readonly StaticObjectSourceGeometryAttachment[];
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ReadonlyMap<ObjectVisualGeometryBufferId, ObjectVisualGeometryBuffer> {
	return new Map(
		options.attachments.map((attachment) => {
			const key = objectVisualGeometryBufferKey(
				createGeometryBufferKey(attachment.identity),
			);
			const bufferId = requireRegistryId(
				options.registry.geometryBufferIdsByKey,
				key,
				"geometry buffer",
			);
			return [
				bufferId,
				{
					...attachment.buffer,
					bufferId,
				},
			];
		}),
	);
}

function createGeometryRecipes(options: {
	readonly payload: StaticObjectBatchPayload;
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ReadonlyMap<ObjectVisualGeometryRecipeId, ObjectVisualGeometryRecipe> {
	const recipes = new Map();
	for (const source of options.payload.sourceAssets) {
		for (const part of source.parts) {
			const recipeId = requireRegistryId(
				options.registry.geometryRecipeIdsByKey,
				objectVisualGeometryRecipeKey(createGeometryRecipeKey(part)),
				"geometry recipe",
			);
			const bufferId = requireRegistryId(
				options.registry.geometryBufferIdsByKey,
				objectVisualGeometryBufferKey(
					createGeometryBufferKey(
						getStaticObjectCanonicalGeometryIdentity(part.geometry),
					),
				),
				"geometry buffer",
			);
			recipes.set(recipeId, {
				bufferId,
				kind: "gfx-obj",
				sourceDid: part.gfxObj.sourceDid,
			});
		}
	}
	return recipes;
}

function createPartRecipes(options: {
	readonly materialPlans: readonly ObjectVisualMaterialPlan[];
	readonly payload: StaticObjectBatchPayload;
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ObjectVisualRecipeBundle["partRecipes"] {
	const materialByUseKey = new Map(
		options.materialPlans.map((plan) => [plan.materialUseKey, plan]),
	);
	const materialSlots = new MaterialSlotIndex(options.payload);
	const recipes = new Map();
	for (const object of options.payload.objects) {
		const source = requireSource(options.payload, object.source);
		for (const part of source.parts) {
			const recipeId = requireRegistryId(
				options.registry.partRecipeIdsByKey,
				objectVisualPartRecipeKey(createPartRecipeKey(object.identity, part)),
				"part recipe",
			);
			const geometryRecipeId = requireRegistryId(
				options.registry.geometryRecipeIdsByKey,
				objectVisualGeometryRecipeKey(createGeometryRecipeKey(part)),
				"geometry recipe",
			);
			const bindings = part.triangles.flatMap((triangle) => {
				const slot = materialSlots.resolveMaterialSlot(
					object.identity,
					part,
					triangle,
				);
				if (!slot || triangle.geometrySurfaceId === null) {
					return [];
				}
				const plan = materialByUseKey.get(
					createObjectVisualMaterialUseKey(
						slot.material,
						slot.paletteOverride,
						slot.paletteViews,
					),
				);
				if (!plan) {
					return [];
				}
				return {
					geometrySurfaceId: triangle.geometrySurfaceId,
					materialRecipeId: requireRegistryId(
						options.registry.materialRecipeIdsByKey,
						objectVisualMaterialRecipeKey(
							createMaterialRecipeKey(
								plan,
								resolveTextureWrapMode(
									triangle.materialVariantSignature ?? null,
								),
							),
						),
						"material recipe",
					),
					materialSlot: getMaterialSlotIndex(slot),
					polygonIds: [triangle.polygonId],
				};
			});
			recipes.set(recipeId, {
				geometryRecipeId,
				materialBindings: bindings,
			});
		}
	}
	return recipes;
}

function getMaterialSlotIndex(
	slot:
		| StaticObjectMaterialSlotFacts
		| StaticObjectPartSourceFacts["materialSlots"][number],
): number {
	return "slotIndex" in slot ? slot.slotIndex : slot.identity.slotIndex;
}

function createPartInstances(options: {
	readonly payload: StaticObjectBatchPayload;
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ObjectVisualRecipeBundle["partInstances"] {
	return options.payload.objects.flatMap((object) => {
		const source = requireSource(options.payload, object.source);
		return source.parts.map((part) => ({
			instanceId: `${createObjectKey(object.identity)}:part:${part.partIndex}`,
			partRecipeId: requireRegistryId(
				options.registry.partRecipeIdsByKey,
				objectVisualPartRecipeKey(createPartRecipeKey(object.identity, part)),
				"part recipe",
			),
			residency:
				options.payload.domain === "env-cell-system" &&
				object.owningEnvCellId !== undefined &&
				object.owningEnvCellId !== null
					? {
							envCellId: object.owningEnvCellId,
							kind: "env-cell" as const,
							landblockId: options.payload.landblock.landblockId,
						}
					: {
							kind: "outdoor-landblock" as const,
							landblockId: options.payload.landblock.landblockId,
						},
			sourcePartIndex: null,
			transform: Array.from(
				createStaticObjectSourcePartMatrix(object, part),
			) as [
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
				number,
			],
		}));
	});
}

function createMaterialRecipes(options: {
	readonly materialRecipeSpecs: readonly MaterialRecipeSpec[];
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ObjectVisualRecipeBundle["materialRecipes"] {
	return new Map(
		options.materialRecipeSpecs.map((spec) => [
			requireRegistryId(
				options.registry.materialRecipeIdsByKey,
				objectVisualMaterialRecipeKey(spec.key),
				"material recipe",
			),
			createMaterialRecipe(spec, options.registry),
		]),
	);
}

function createMaterialRecipe(
	spec: MaterialRecipeSpec,
	registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>,
): ObjectVisualMaterialRecipe {
	const plan = spec.plan;
	const base = {
		alphaTest: plan.alphaPolicy.alphaTest,
		detailTextureTiling: resolveStaticMaterialDetailTextureTiling(plan),
		indexedClipThreshold: plan.alphaPolicy.indexedClipThreshold,
		materialColor: plan.color,
		materialEmissiveColor: plan.emissiveColor,
		paletteFirstIndex: getPaletteFirstIndex(plan.textureRoles),
		pass: plan.pass,
		primaryTextureWrapMode: spec.textureWrapMode,
		renderState: createStaticMaterialRenderState(plan.blend),
		textureRoleLayoutKey: createStaticMaterialTextureRoleLayoutKey(
			plan.textureRoles,
		),
		textureRoleSchemaKey: createStaticMaterialTextureRoleSchemaKey(
			plan.textureRoles,
		),
	};
	switch (plan.family) {
		case "flat-color":
			return {
				...base,
				family: "direct-color",
			};
		case "indexed-paletted":
			return {
				...base,
				colorTextureRecipeId: requireTextureRecipeId(
					registry,
					requireTextureRole(plan.textureRoles, "base-index").dataUse,
				),
				family: "indexed-color",
				indexedTextureFormat:
					requireTextureRole(plan.textureRoles, "base-index").indexedFormat ===
					"index16"
						? "index16"
						: "p8",
				paletteTextureRecipeId: requireTextureRecipeId(
					registry,
					requireTextureRole(plan.textureRoles, "palette-rgba").dataUse,
				),
			};
		case "texture-rgba":
			return {
				...base,
				detailTextureRecipeId: findTextureRole(
					plan.textureRoles,
					"detail-overlay",
				)
					? requireTextureRecipeId(
							registry,
							requireTextureRole(plan.textureRoles, "detail-overlay").dataUse,
						)
					: null,
				family: "texture-rgba",
				rgbaTextureRecipeId: requireTextureRecipeId(
					registry,
					requireTextureRole(plan.textureRoles, "base-color").dataUse,
				),
			};
		case "unsupported":
			return {
				...base,
				family: "unsupported",
				reason: plan.fallbackReasons.map((reason) => reason.code).join(","),
			};
	}
}

function createTextureRecipes(options: {
	readonly materialPlans: readonly ObjectVisualMaterialPlan[];
	readonly registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>;
}): ObjectVisualRecipeBundle["textureRecipes"] {
	const recipes = new Map<
		ObjectVisualTextureRecipeId,
		ObjectVisualTextureRecipe
	>();
	for (const plan of options.materialPlans) {
		for (const role of plan.textureRoles) {
			const textureId = requireTextureRecipeId(options.registry, role.dataUse);
			if (recipes.has(textureId)) {
				continue;
			}
			recipes.set(textureId, createTextureRecipe(role));
		}
	}
	return recipes;
}

function createTextureRecipe(role: ObjectVisualMaterialTextureUseRole) {
	switch (role.role) {
		case "base-color":
		case "base-index":
		case "detail-overlay":
			return {
				source: {
					kind: "render-surface" as const,
					renderSurfaceId: role.renderSurface.renderSurfaceId,
					surfaceTextureId: role.texture.surfaceTextureId,
				},
				usage: getTextureUsage(role),
			};
		case "palette-rgba":
			return {
				source: {
					firstIndex: role.dataUse.firstIndex,
					indexCount: role.dataUse.indexCount,
					kind: "palette" as const,
					paletteId: role.palette.paletteId,
				},
				usage: "object-palette" as const,
			};
	}
}

function getTextureUsage(
	role: ObjectVisualMaterialTextureUseRole,
): ObjectVisualTextureUsage {
	switch (role.role) {
		case "base-color":
			return "object-base-color";
		case "base-index":
			return "object-index";
		case "detail-overlay":
			return "object-detail";
		case "palette-rgba":
			return "object-palette";
	}
}

function createTextureRecipeKeys(
	materialPlans: readonly ObjectVisualMaterialPlan[],
): readonly string[] {
	return [
		...new Set(
			materialPlans.flatMap((plan) =>
				plan.textureRoles.map((role) => createTextureRecipeKey(role.dataUse)),
			),
		),
	].sort();
}

function collectMaterialRecipeSpecs(options: {
	readonly materialPlans: readonly ObjectVisualMaterialPlan[];
	readonly payload: StaticObjectBatchPayload;
}): readonly MaterialRecipeSpec[] {
	const materialByUseKey = new Map(
		options.materialPlans.map((plan) => [plan.materialUseKey, plan]),
	);
	const materialSlots = new MaterialSlotIndex(options.payload);
	const specsByKey = new Map<string, MaterialRecipeSpec>();
	for (const object of options.payload.objects) {
		const source = requireSource(options.payload, object.source);
		for (const part of source.parts) {
			for (const triangle of part.triangles) {
				const slot = materialSlots.resolveMaterialSlot(
					object.identity,
					part,
					triangle,
				);
				if (!slot) {
					continue;
				}
				const plan = materialByUseKey.get(
					createObjectVisualMaterialUseKey(
						slot.material,
						slot.paletteOverride,
						slot.paletteViews,
					),
				);
				if (!plan) {
					continue;
				}
				const textureWrapMode = resolveTextureWrapMode(
					triangle.materialVariantSignature ?? null,
				);
				const key = createMaterialRecipeKey(plan, textureWrapMode);
				specsByKey.set(key, { key, plan, textureWrapMode });
			}
		}
	}
	return [...specsByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function createMaterialRecipeKey(
	plan: ObjectVisualMaterialPlan,
	textureWrapMode: "clamp" | "repeat",
): string {
	return [plan.materialUseKey, `wrap:${textureWrapMode}`].join("|");
}

function resolveTextureWrapMode(
	materialVariantSignature: string | null,
): "clamp" | "repeat" {
	return materialVariantSignature?.includes("sampler=repeat")
		? "repeat"
		: "clamp";
}

function requireTextureRecipeId(
	registry: ReturnType<typeof createObjectVisualRecipeKeyRegistry>,
	dataUse: MaterialTextureDataUseIdentity,
): ObjectVisualTextureRecipeId {
	return requireRegistryId(
		registry.textureRecipeIdsByKey,
		objectVisualTextureRecipeKey(createTextureRecipeKey(dataUse)),
		"texture recipe",
	);
}

function createTextureRecipeKey(
	dataUse: MaterialTextureDataUseIdentity,
): string {
	if (dataUse.kind === "palette-texture-use") {
		return [
			"palette",
			formatHex32(dataUse.palette.paletteId),
			`first:${dataUse.firstIndex}`,
			`count:${dataUse.indexCount}`,
		].join(":");
	}
	return [
		"render-surface",
		formatHex32(dataUse.renderSurface.renderSurfaceId),
		dataUse.usage,
	].join(":");
}

function findTextureRole<
	TRole extends ObjectVisualMaterialTextureUseRole["role"],
>(
	roles: readonly ObjectVisualMaterialTextureUseRole[],
	role: TRole,
): Extract<
	ObjectVisualMaterialTextureUseRole,
	{ readonly role: TRole }
> | null {
	return (
		roles.find(
			(
				candidate,
			): candidate is Extract<
				ObjectVisualMaterialTextureUseRole,
				{ readonly role: TRole }
			> => candidate.role === role,
		) ?? null
	);
}

function requireTextureRole<
	TRole extends ObjectVisualMaterialTextureUseRole["role"],
>(
	roles: readonly ObjectVisualMaterialTextureUseRole[],
	role: TRole,
): Extract<ObjectVisualMaterialTextureUseRole, { readonly role: TRole }> {
	const found = findTextureRole(roles, role);
	if (!found) {
		throw new Error(`Material recipe requires texture role ${role}.`);
	}
	return found;
}

function getPaletteFirstIndex(
	roles: readonly ObjectVisualMaterialTextureUseRole[],
): number {
	return findTextureRole(roles, "palette-rgba")?.dataUse.firstIndex ?? 0;
}

class MaterialSlotIndex {
	readonly #slotsByObjectPartSurface = new Map<
		string,
		StaticObjectMaterialSlotFacts
	>();

	constructor(payload: StaticObjectBatchPayload) {
		for (const slot of payload.materialSlots) {
			this.#slotsByObjectPartSurface.set(
				createMaterialSlotKey({
					geometrySurfaceId: slot.identity.geometrySurfaceId,
					materialVariantSignature: slot.materialVariantSignature,
					object: slot.object,
					partIndex: slot.identity.part.partIndex,
				}),
				slot,
			);
		}
	}

	resolveMaterialSlot(
		object: StaticObjectInstanceIdentity,
		part: StaticObjectPartSourceFacts,
		triangle: {
			readonly geometrySurfaceId: number | null;
			readonly materialVariantSignature: string | null;
		},
	):
		| StaticObjectMaterialSlotFacts
		| StaticObjectPartSourceFacts["materialSlots"][number]
		| null {
		if (triangle.geometrySurfaceId === null) {
			return null;
		}
		return (
			this.#slotsByObjectPartSurface.get(
				createMaterialSlotKey({
					geometrySurfaceId: triangle.geometrySurfaceId,
					materialVariantSignature: triangle.materialVariantSignature,
					object,
					partIndex: part.partIndex,
				}),
			) ??
			part.materialSlots.find(
				(slot) =>
					slot.geometrySurfaceId === triangle.geometrySurfaceId &&
					slot.materialVariantSignature === triangle.materialVariantSignature,
			) ??
			null
		);
	}
}

function findMissingGeometryAttachments(
	payload: StaticObjectBatchPayload,
	attachments: readonly StaticObjectSourceGeometryAttachment[],
): readonly string[] {
	const attachmentKeys = new Set(
		attachments.map((attachment) =>
			describeStaticObjectCanonicalGeometryIdentity(attachment.identity),
		),
	);
	const missing: string[] = [];
	for (const source of payload.sourceAssets) {
		for (const part of source.parts) {
			const key = describeStaticObjectCanonicalGeometryIdentity(
				getStaticObjectCanonicalGeometryIdentity(part.geometry),
			);
			if (!attachmentKeys.has(key)) {
				missing.push(key);
			}
		}
	}
	return [...new Set(missing)].sort();
}

function createStaticObjectSourcePartMatrix(
	object: StaticObjectBatchPayload["objects"][number],
	part: StaticObjectPartSourceFacts,
): Float32Array {
	let matrix = buildAcPlacementMatrix(object.localPlacement, AC_UNIT_SCALE);
	for (const placement of part.defaultPlacements) {
		matrix = multiplyMat4(
			matrix,
			buildAcPlacementMatrix(placement, AC_UNIT_SCALE),
		);
	}
	return multiplyMat4(
		matrix,
		createStaticObjectSourceScaleMatrix({
			x: object.sourceScale.x * part.scale.x,
			y: object.sourceScale.y * part.scale.y,
			z: object.sourceScale.z * part.scale.z,
		}),
	);
}

function createPartRecipeKey(
	object: StaticObjectInstanceIdentity,
	part: StaticObjectPartSourceFacts,
): string {
	return [
		"static-object-part",
		createObjectKey(object),
		createSourceKey(part.source),
		`part:${part.partIndex}`,
	].join("|");
}

function createGeometryRecipeKey(part: StaticObjectPartSourceFacts): string {
	return [
		"static-object-geometry",
		createSourceKey(part.source),
		createSourceKey(part.gfxObj),
		`part:${part.partIndex}`,
	].join("|");
}

function createGeometryBufferKey(
	identity: StaticObjectSourceGeometryAttachment["identity"],
): string {
	return describeStaticObjectCanonicalGeometryIdentity(identity);
}

function requireSource(
	payload: StaticObjectBatchPayload,
	identity: StaticObjectSourceIdentity,
): StaticObjectBatchPayload["sourceAssets"][number] {
	const source = payload.sourceAssets.find(
		(candidate) =>
			createSourceKey(candidate.identity) === createSourceKey(identity),
	);
	if (!source) {
		throw new Error(
			`Static object visual bundle references missing source ${createSourceKey(identity)}.`,
		);
	}
	return source;
}

function createMaterialSlotKey(options: {
	readonly object: StaticObjectInstanceIdentity;
	readonly partIndex: number;
	readonly geometrySurfaceId: number;
	readonly materialVariantSignature: string | null;
}): string {
	return [
		createObjectKey(options.object),
		`part:${options.partIndex}`,
		`surface:${options.geometrySurfaceId}`,
		`variant:${options.materialVariantSignature ?? "none"}`,
	].join("|");
}

function createObjectKey(object: StaticObjectInstanceIdentity): string {
	return [
		formatHex32(object.landblockId),
		object.objectKind,
		object.instanceId,
	].join(":");
}

function createSourceKey(source: StaticObjectSourceIdentity): string {
	return [
		source.kind,
		source.sourceAssetKind,
		formatHex32(source.sourceDid),
	].join(":");
}

function requireRegistryId<TKey, TId>(
	map: ReadonlyMap<TKey, TId>,
	key: TKey,
	subject: string,
): TId {
	const id = map.get(key);
	if (id === undefined) {
		throw new Error(`Missing object visual ${subject} id for ${String(key)}.`);
	}
	return id;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
