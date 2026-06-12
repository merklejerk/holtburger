import type {
	GfxObjPayloadDto,
	LandblockOutdoorPayloadDto,
	MaterialRecipePayloadDto,
	PalettePayloadDto,
	RegionRenderProfilePayloadDto,
	RenderSurfacePayloadDto,
	SetupAppearancePayloadDto,
	SetupModelPayloadDto,
	SurfaceTexturePayloadDto,
} from "../../../lib/host/contracts";
import type { AssetService, HostAssetKey, PreparedAsset } from "../../assets/contracts";
import {
	createHostAssetKey,
	describeHostAssetKey,
	parseHostAssetId,
} from "../../assets/keys";
import type {
	OutdoorStaticObjectsScopePayload,
	PaletteIdentity,
	RenderSurfaceIdentity,
	StaticMaterialSlotIdentity,
	StaticMaterialSourceIdentity,
	StaticObjectInstanceFacts,
	StaticObjectInstanceIdentity,
	StaticObjectMaterialSlotFacts,
	StaticObjectMaterialSourceFacts,
	StaticObjectPartIdentity,
	StaticObjectPartMaterialSlotFacts,
	StaticObjectPartSourceFacts,
	RegionDetailRoleFacts,
	StaticObjectSourceAssetFacts,
	StaticObjectSourceIdentity,
	StaticObjectTextureRefFacts,
	StaticResourceIdentity,
	StaticResolverJob,
	StaticScopePayload,
	SurfaceTextureIdentity,
} from "../contracts";
import {
	createPaletteIdentity,
	createRenderSurfaceIdentity,
	createSurfaceTextureIdentity,
} from "../terrain/terrain-identities";

type OutdoorStaticPreparedPayload =
	| GfxObjPayloadDto
	| LandblockOutdoorPayloadDto
	| MaterialRecipePayloadDto
	| PalettePayloadDto
	| RegionRenderProfilePayloadDto
	| RenderSurfacePayloadDto
	| SetupAppearancePayloadDto
	| SetupModelPayloadDto
	| SurfaceTexturePayloadDto;

interface LoadedPayload<
	TKind extends OutdoorStaticPreparedPayload["kind"] =
		OutdoorStaticPreparedPayload["kind"],
> {
	readonly asset: PreparedAsset;
	readonly payload: Extract<OutdoorStaticPreparedPayload, { readonly kind: TKind }>;
}

interface SourceResolution {
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
	readonly missingRefs: readonly StaticResourceIdentity[];
	readonly sourceRevision: number;
}

interface StaticObjectMaterialSlotInput {
	readonly slotIndex: number;
	readonly surfaceId: number;
	readonly materialId: number;
	readonly materialVariantSignature: string | null;
}

export interface OutdoorStaticObjectsResolverOptions {
	readonly assetService: AssetService;
}

export class OutdoorStaticObjectsResolver {
	readonly #assetService: AssetService;

	constructor(options: OutdoorStaticObjectsResolverOptions) {
		this.#assetService = options.assetService;
	}

	async resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (job.domain !== "outdoor-buildings" || job.scope.kind !== "landblock") {
			throw new Error(
				`Outdoor static object resolver only supports outdoor building landblock jobs. Received ${job.scope.kind}/${job.domain}.`,
			);
		}

		const landblock = await this.#loadPayload(
			createHostAssetKey("landblock-outdoor", job.scope.landblockId),
			"landblock-outdoor",
		);
		const selectedObjects = landblock.payload.statics.filter(
			(object) => object.kind === "building",
		);
		const regionRenderProfile = await this.#loadPayload(
			createHostAssetKey("region-render-profile", landblock.payload.regionNumber),
			"region-render-profile",
		);
		const sourceResolution = await this.#resolveSourceAssets(
			selectedObjects.map((object) => object.sourceAssetId),
		);
		const sourceByKey = new Map(
			sourceResolution.sourceAssets.map((source) => [
				createSourceCacheKey(source.identity),
				source,
			]),
		);
		const objects = selectedObjects.map((object): StaticObjectInstanceFacts => {
			const source = createStaticObjectSourceIdentity(
				parseHostAssetId(object.sourceAssetId),
			);
			return {
				debug: { sourceAssetId: object.sourceAssetId },
				generated: object.generated
					? {
							sceneId: object.generated.sceneId,
							sceneTemplateIndex: object.generated.sceneTemplateIndex,
							terrainIndex: object.generated.terrainIndex,
						}
					: null,
				identity: createStaticObjectInstanceIdentity({
					instanceId: object.instanceId,
					landblockId: landblock.payload.landblockId,
					objectKind: object.kind,
				}),
				instanceBounds: object.instanceBounds,
				localPlacement: object.localPlacement,
				portalCount: object.building?.portals.length ?? 0,
				source,
				sourceBounds: object.sourceBounds,
				sourceIndex: object.sourceIndex,
				sourceScale: object.sourceScale,
			};
		});
		const materialSlots = createObjectMaterialSlotFacts({
			objects,
			sourceByKey,
		});
		const scope: OutdoorStaticObjectsScopePayload = {
			domain: "outdoor-buildings",
			kind: "outdoor-static-objects",
			landblock: {
				kind: "landblock-source",
				landblockId: landblock.payload.landblockId,
				source: "outdoor",
			},
			materialSlots,
			materialSources: sourceResolution.materialSources,
			missingRefs: sourceResolution.missingRefs,
			objects,
			regionRenderProfile: {
				detailRoles: createRegionDetailRoles(regionRenderProfile.payload),
				identity: {
					kind: "region-render-profile",
					regionNumber: landblock.payload.regionNumber,
				},
			},
			sourceAssets: sourceResolution.sourceAssets,
			sourceSpatial: {
				bounds: landblock.payload.terrain.bounds,
				coordinateSpace: "landblock-render-local",
				outdoorBvhItemCount: landblock.payload.outdoorBvh?.items.length ?? 0,
				outdoorBvhNodeCount: landblock.payload.outdoorBvh?.nodes.length ?? 0,
			},
			textureRefs: sourceResolution.textureRefs,
		};

		return {
			job,
			scope,
			sourceRevision: Math.max(
				landblock.asset.revision,
				regionRenderProfile.asset.revision,
				sourceResolution.sourceRevision,
			),
		};
	}

	async #resolveSourceAssets(
		sourceAssetIds: readonly string[],
	): Promise<SourceResolution> {
		const sourceAssets = new Map<string, StaticObjectSourceAssetFacts>();
		const materialSources = new Map<string, StaticObjectMaterialSourceFacts>();
		const textureRefs = new Map<string, StaticObjectTextureRefFacts>();
		const missingRefs: StaticResourceIdentity[] = [];
		let sourceRevision = 0;

		for (const sourceAssetId of uniqueSorted(sourceAssetIds)) {
			const sourceKey = parseHostAssetId(sourceAssetId);
			const identity = createStaticObjectSourceIdentity(sourceKey);

			try {
				const source = await this.#loadRenderableSource(sourceKey);
				sourceRevision = Math.max(sourceRevision, source.asset.revision);
				const facts = await this.#createSourceAssetFacts({
					identity,
					materialSources,
					missingRefs,
					source,
					textureRefs,
				});
				sourceAssets.set(createSourceCacheKey(identity), facts);
				sourceRevision = Math.max(sourceRevision, facts.partCount);
			} catch {
				missingRefs.push(identity);
			}
		}

		return {
			materialSources: [...materialSources.values()],
			missingRefs,
			sourceAssets: [...sourceAssets.values()],
			sourceRevision,
			textureRefs: [...textureRefs.values()],
		};
	}

	async #createSourceAssetFacts(options: {
		readonly identity: StaticObjectSourceIdentity;
		readonly source: LoadedPayload<"gfx-obj" | "setup-model">;
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<StaticObjectSourceAssetFacts> {
		const parts =
			options.source.payload.kind === "gfx-obj"
				? await this.#createDirectGfxParts({
						gfxObjAssetId: options.source.asset.sourceAssetId,
						gfxObj: options.source.payload,
						materialSources: options.materialSources,
						missingRefs: options.missingRefs,
						source: options.identity,
						textureRefs: options.textureRefs,
					})
				: await this.#createSetupModelParts({
						materialSources: options.materialSources,
						missingRefs: options.missingRefs,
						setupModel: options.source.payload,
						source: options.identity,
						textureRefs: options.textureRefs,
					});

		return {
			bounds: mergePartBounds(parts),
			debug: { sourceAssetId: options.source.asset.sourceAssetId },
			identity: options.identity,
			invalidPolygonCount: sum(parts, (part) => part.invalidPolygonCount),
			materialSlotCount: sum(parts, (part) => part.materialSlotCount),
			partCount: parts.length,
			parts,
			physicsPolygonCount: sum(parts, (part) => part.physicsPolygonCount),
			renderTriangleCount: sum(parts, (part) => part.renderTriangleCount),
			skippedPolygonCount: sum(parts, (part) => part.skippedPolygonCount),
			sourceAssetKind: options.identity.sourceAssetKind,
		};
	}

	async #createDirectGfxParts(options: {
		readonly source: StaticObjectSourceIdentity;
		readonly gfxObjAssetId: string;
		readonly gfxObj: GfxObjPayloadDto;
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<readonly StaticObjectPartSourceFacts[]> {
		return [
			await this.#createGfxPartFacts({
				defaultPlacements: [],
				gfxObj: options.gfxObj,
				gfxObjAssetId: options.gfxObjAssetId,
				materialSources: options.materialSources,
				missingRefs: options.missingRefs,
				partIndex: 0,
				scale: UNIT_SCALE,
				source: options.source,
				textureRefs: options.textureRefs,
			}),
		];
	}

	async #createSetupModelParts(options: {
		readonly source: StaticObjectSourceIdentity;
		readonly setupModel: SetupModelPayloadDto;
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<readonly StaticObjectPartSourceFacts[]> {
		const setupAppearance = await this.#tryLoadSetupAppearance(
			options.setupModel.setupModelId,
			options.missingRefs,
		);
		const parts = setupAppearance?.payload.parts ?? options.setupModel.parts;
		const facts: StaticObjectPartSourceFacts[] = [];

		for (const part of parts) {
			const gfxObjAssetId = part.gfxObjAssetId;
			const gfxObjIdentity = createStaticObjectSourceIdentity(
				parseHostAssetId(gfxObjAssetId),
			);
			let gfxObj: LoadedPayload<"gfx-obj">;
			try {
				gfxObj = await this.#loadPayload(parseHostAssetId(gfxObjAssetId), "gfx-obj");
			} catch {
				options.missingRefs.push(gfxObjIdentity);
				continue;
			}

			const setupPart = options.setupModel.parts.find(
				(candidate) => candidate.partIndex === part.partIndex,
			);
			facts.push(
				await this.#createGfxPartFacts({
					defaultPlacements: deriveSetupPartDefaultPlacements(
						options.setupModel,
						part.partIndex,
					),
					gfxObj: gfxObj.payload,
					gfxObjAssetId,
					materialSlots:
						"materialSlots" in part
							? part.materialSlots.map((slot) => ({
									materialId: parseMaterialAssetId(slot.materialAssetId),
									materialVariantSignature: null,
									slotIndex: slot.slotIndex,
									surfaceId: slot.surfaceId,
								}))
							: undefined,
					materialSources: options.materialSources,
					missingRefs: options.missingRefs,
					partIndex: part.partIndex,
					scale: setupPart?.scale ?? UNIT_SCALE,
					source: options.source,
					textureRefs: options.textureRefs,
				}),
			);
		}

		return facts;
	}

	async #createGfxPartFacts(options: {
		readonly source: StaticObjectSourceIdentity;
		readonly gfxObjAssetId: string;
		readonly gfxObj: GfxObjPayloadDto;
		readonly partIndex: number;
		readonly defaultPlacements: readonly StaticObjectPartSourceFacts["defaultPlacements"][number][];
		readonly scale: StaticObjectPartSourceFacts["scale"];
		readonly materialSlots?: readonly StaticObjectMaterialSlotInput[];
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<StaticObjectPartSourceFacts> {
		const gfxObj = createStaticObjectSourceIdentity(
			parseHostAssetId(options.gfxObjAssetId),
		);
		const materialSlots = await this.#createMaterialSlotFacts({
			gfxObj: options.gfxObj,
			materialSlots: options.materialSlots,
			materialSources: options.materialSources,
			missingRefs: options.missingRefs,
			textureRefs: options.textureRefs,
		});

		return {
			bounds: options.gfxObj.renderGeometry.bounds,
			defaultPlacements: options.defaultPlacements,
			gfxObj,
			invalidPolygonCount: options.gfxObj.renderGeometry.invalidPolygons.length,
			materialSlotCount: materialSlots.length,
			materialSlots,
			normals: toFloat32Array(options.gfxObj.renderGeometry.normals),
			partIndex: options.partIndex,
			physicsPolygonCount: options.gfxObj.physicsWitness.polygonCount,
			positions: toFloat32Array(options.gfxObj.renderGeometry.positions),
			renderTriangleCount: options.gfxObj.renderGeometry.triangleCount,
			scale: options.scale,
			skippedPolygonCount: options.gfxObj.renderGeometry.skippedPolygonCount,
			source: options.source,
			texCoords: toFloat32Array(options.gfxObj.renderGeometry.uvs),
			triangles: options.gfxObj.renderGeometry.triangles.map((triangle) => ({
				firstVertex: triangle.firstVertex,
				materialVariantSignature: triangle.materialVariantSignature ?? null,
				polygonId: triangle.polygonId,
				surfaceId: triangle.surfaceId,
			})),
		};
	}

	async #createMaterialSlotFacts(options: {
		readonly gfxObj: GfxObjPayloadDto;
		readonly materialSlots?: readonly StaticObjectMaterialSlotInput[];
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<readonly StaticObjectPartMaterialSlotFacts[]> {
		const materialSlots =
			options.materialSlots ??
			options.gfxObj.surfaceIds.map((surfaceId, slotIndex) => ({
				materialId: surfaceId,
				materialVariantSignature: null,
				slotIndex,
				surfaceId,
			}));
		const slots = await Promise.all(
			materialSlots.map(async (slot) => {
				const material = createStaticMaterialSourceIdentity(slot.materialId);
				await this.#loadMaterialSource({
					material,
					materialSources: options.materialSources,
					missingRefs: options.missingRefs,
					textureRefs: options.textureRefs,
				});
				return {
					material,
					materialVariantSignature: slot.materialVariantSignature,
					slotIndex: slot.slotIndex,
					surfaceId: slot.surfaceId,
				};
			}),
		);

		return slots;
	}

	async #loadMaterialSource(options: {
		readonly material: StaticMaterialSourceIdentity;
		readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<void> {
		const key = createMaterialCacheKey(options.material);
		if (options.materialSources.has(key)) {
			return;
		}

		let material: LoadedPayload<"material-recipe">;
		try {
			material = await this.#loadPayload(
				createHostAssetKey("material", options.material.materialId),
				"material-recipe",
			);
		} catch {
			options.missingRefs.push(options.material);
			return;
		}

		const source =
			material.payload.source.kind === "solid-color"
				? {
						argb: material.payload.source.argb,
						kind: "solid-color" as const,
					}
				: {
						kind: "texture" as const,
						palette:
							material.payload.source.paletteId === null
								? null
								: createPaletteIdentity(material.payload.source.paletteId),
						renderSurfaceDefaultPalettes:
							material.payload.source.renderSurfaceDefaultPaletteIds.map(
								createPaletteIdentity,
							),
						selectedRenderSurface:
							material.payload.source.selectedRenderSurfaceId === null
								? null
								: createRenderSurfaceIdentity(
										material.payload.source.selectedRenderSurfaceId,
									),
						texture: createSurfaceTextureIdentity(
							material.payload.source.surfaceTextureId,
						),
					};

		options.materialSources.set(key, {
			diffuse: material.payload.diffuse,
			identity: options.material,
			luminosity: material.payload.luminosity,
			source,
			surfaceId: material.payload.surfaceId,
			surfaceType: material.payload.surfaceType,
			translucency: material.payload.translucency,
		});

		await this.#resolveMaterialTextureRefs(
			material.payload,
			options.textureRefs,
			options.missingRefs,
		);
	}

	async #resolveMaterialTextureRefs(
		material: MaterialRecipePayloadDto,
		textureRefs: Map<string, StaticObjectTextureRefFacts>,
		missingRefs: StaticResourceIdentity[],
	): Promise<void> {
		if (material.source.kind !== "texture") {
			return;
		}

		const texture = createSurfaceTextureIdentity(material.source.surfaceTextureId);
		let surfaceTexture: LoadedPayload<"surface-texture">;
		try {
			surfaceTexture = await this.#loadPayload(
				createHostAssetKey("surface-texture", texture.surfaceTextureId),
				"surface-texture",
			);
		} catch {
			missingRefs.push(texture);
			return;
		}

		const renderSurfaceId =
			material.source.selectedRenderSurfaceId ??
			surfaceTexture.payload.selectedRenderSurfaceId ??
			surfaceTexture.payload.renderSurfaceIds[0] ??
			null;
		const renderSurface =
			renderSurfaceId === null ? null : createRenderSurfaceIdentity(renderSurfaceId);
		let palette =
			material.source.paletteId === null
				? null
				: createPaletteIdentity(material.source.paletteId);

		textureRefs.set(createTextureRefCacheKey({ role: "surface-texture", texture }), {
			palette,
			renderSurface,
			role: "surface-texture",
			texture,
		});

		if (renderSurface === null) {
			return;
		}

		try {
			const loadedRenderSurface = await this.#loadPayload(
				createHostAssetKey("render-surface", renderSurface.renderSurfaceId),
				"render-surface",
			);
			palette =
				palette ??
				(loadedRenderSurface.payload.defaultPaletteId === null
					? null
					: createPaletteIdentity(loadedRenderSurface.payload.defaultPaletteId));
			textureRefs.set(
				createTextureRefCacheKey({ role: "render-surface", renderSurface }),
				{
					palette,
					renderSurface,
					role: "render-surface",
				},
			);
			if (palette) {
				await this.#loadPalette(palette, missingRefs);
			}
		} catch {
			missingRefs.push(renderSurface);
		}
	}

	async #loadPalette(
		palette: PaletteIdentity,
		missingRefs: StaticResourceIdentity[],
	): Promise<void> {
		try {
			await this.#loadPayload(createHostAssetKey("palette", palette.paletteId), "palette");
		} catch {
			missingRefs.push(palette);
		}
	}

	async #tryLoadSetupAppearance(
		setupModelId: number,
		missingRefs: StaticResourceIdentity[],
	): Promise<LoadedPayload<"setup-appearance"> | null> {
		const identity: StaticObjectSourceIdentity = {
			kind: "static-object-source",
			sourceAssetKind: "setup-appearance",
			sourceDid: setupModelId,
		};
		try {
			return await this.#loadPayload(
				createHostAssetKey("setup-appearance", setupModelId),
				"setup-appearance",
			);
		} catch {
			missingRefs.push(identity);
			return null;
		}
	}

	async #loadRenderableSource(
		key: HostAssetKey,
	): Promise<LoadedPayload<"gfx-obj" | "setup-model">> {
		if (key.kind !== "gfx-obj" && key.kind !== "setup-model") {
			throw new Error(
				`Outdoor static object source must be gfx-obj or setup-model, got ${describeHostAssetKey(key)}.`,
			);
		}

		return this.#loadPayload(key, key.kind);
	}

	async #loadPayload<TKind extends OutdoorStaticPreparedPayload["kind"]>(
		key: HostAssetKey,
		expectedKind: TKind,
	): Promise<LoadedPayload<TKind>> {
		const asset = await this.#assetService.requestPreparedAsset(key);
		const payload = requirePreparedPayloadKind(asset, expectedKind);
		return { asset, payload };
	}
}

function createObjectMaterialSlotFacts(options: {
	readonly objects: readonly StaticObjectInstanceFacts[];
	readonly sourceByKey: ReadonlyMap<string, StaticObjectSourceAssetFacts>;
}): readonly StaticObjectMaterialSlotFacts[] {
	return options.objects.flatMap((object) => {
		const source = options.sourceByKey.get(createSourceCacheKey(object.source));
		if (!source) {
			return [];
		}

		return source.parts.flatMap((part) =>
			part.materialSlots.map((slot) => {
				const partIdentity: StaticObjectPartIdentity = {
					kind: "static-object-part",
					object: object.identity,
					partIndex: part.partIndex,
				};
				const identity: StaticMaterialSlotIdentity = {
					kind: "static-material-slot",
					part: partIdentity,
					slotIndex: slot.slotIndex,
					surfaceId: slot.surfaceId,
				};
				return {
					gfxObj: part.gfxObj,
					identity,
					material: slot.material,
					materialVariantSignature: slot.materialVariantSignature,
					object: object.identity,
					source: object.source,
				};
			}),
		);
	});
}

function createStaticObjectSourceIdentity(key: HostAssetKey): StaticObjectSourceIdentity {
	if (
		key.kind !== "gfx-obj" &&
		key.kind !== "setup-model" &&
		key.kind !== "setup-appearance"
	) {
		throw new Error(
			`Static object source identity expected gfx/setup asset key, received ${describeHostAssetKey(
				key,
			)}.`,
		);
	}

	return {
		kind: "static-object-source",
		sourceAssetKind: key.kind,
		sourceDid: Number.parseInt(key.id, 16) >>> 0,
	};
}

function createStaticObjectInstanceIdentity(options: {
	readonly landblockId: number;
	readonly instanceId: string;
	readonly objectKind: StaticObjectInstanceIdentity["objectKind"];
}): StaticObjectInstanceIdentity {
	return {
		kind: "static-object-instance",
		instanceId: options.instanceId,
		landblockId: options.landblockId,
		objectKind: options.objectKind,
	};
}

function createStaticMaterialSourceIdentity(
	materialId: number,
): StaticMaterialSourceIdentity {
	return {
		kind: "static-material-source",
		materialId,
	};
}

function createRegionDetailRoles(
	profile: RegionRenderProfilePayloadDto,
): readonly RegionDetailRoleFacts[] {
	return Object.entries(profile.detailRoles).flatMap(([role, entry]) => {
		if (!entry) {
			return [];
		}

		return [
			{
				fadeFar: entry.fadeFar,
				fadeNear: entry.fadeNear,
				role: role as RegionDetailRoleFacts["role"],
				texture: createSurfaceTextureIdentity(entry.textureDid),
				tiling: entry.tiling,
			},
		];
	});
}

function parseMaterialAssetId(assetId: string): number {
	const key = parseHostAssetId(assetId);
	if (key.kind !== "material") {
		throw new Error(`Expected material asset route, received ${assetId}.`);
	}

	return Number.parseInt(key.id, 16) >>> 0;
}

function deriveSetupPartDefaultPlacements(
	setupModel: SetupModelPayloadDto,
	partIndex: number,
): readonly StaticObjectPartSourceFacts["defaultPlacements"][number][] {
	const byPart = setupModel.placementSets
		.flatMap((set) => set.localPlacements)
		.filter((_, index) => index === partIndex);
	const location = setupModel.connectionPoints
		.concat(setupModel.holdingLocations)
		.filter((entry) => entry.partId === partIndex)
		.map((entry) => entry.localPlacement);
	return [...byPart, ...location];
}

function toFloat32Array(values: readonly number[] | Float32Array): Float32Array {
	return values instanceof Float32Array ? values : new Float32Array(values);
}

function mergePartBounds(
	parts: readonly StaticObjectPartSourceFacts[],
): StaticObjectSourceAssetFacts["bounds"] {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	for (const part of parts) {
		if (!part.bounds) {
			continue;
		}
		minX = Math.min(minX, part.bounds.min.x);
		minY = Math.min(minY, part.bounds.min.y);
		minZ = Math.min(minZ, part.bounds.min.z);
		maxX = Math.max(maxX, part.bounds.max.x);
		maxY = Math.max(maxY, part.bounds.max.y);
		maxZ = Math.max(maxZ, part.bounds.max.z);
	}

	if (!Number.isFinite(minX)) {
		return null;
	}

	return {
		max: { x: maxX, y: maxY, z: maxZ },
		min: { x: minX, y: minY, z: minZ },
	};
}

function sum<T>(values: readonly T[], getValue: (value: T) => number): number {
	return values.reduce((total, value) => total + getValue(value), 0);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
	return Array.from(new Set(values)).sort();
}

function createSourceCacheKey(identity: StaticObjectSourceIdentity): string {
	return `${identity.sourceAssetKind}:${identity.sourceDid}`;
}

function createMaterialCacheKey(identity: StaticMaterialSourceIdentity): string {
	return `${identity.materialId}`;
}

function createTextureRefCacheKey(
	ref:
		| { readonly role: "surface-texture"; readonly texture: SurfaceTextureIdentity }
		| { readonly role: "render-surface"; readonly renderSurface: RenderSurfaceIdentity },
): string {
	return ref.role === "surface-texture"
		? `${ref.role}:${ref.texture.surfaceTextureId}`
		: `${ref.role}:${ref.renderSurface.renderSurfaceId}`;
}

function requirePreparedPayloadKind<
	TKind extends OutdoorStaticPreparedPayload["kind"],
>(
	asset: PreparedAsset,
	expectedKind: TKind,
): Extract<OutdoorStaticPreparedPayload, { readonly kind: TKind }> {
	const payload = asset.payload as OutdoorStaticPreparedPayload;
	if (payload.kind !== expectedKind) {
		throw new Error(
			`Prepared asset ${asset.sourceAssetId} was ${payload.kind}, expected ${expectedKind}.`,
		);
	}

	return payload as Extract<OutdoorStaticPreparedPayload, { readonly kind: TKind }>;
}

const UNIT_SCALE = { x: 1, y: 1, z: 1 };
