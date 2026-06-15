import type {
	MaterialRecipePayloadDto,
	PalettePayloadDto,
	RenderSurfacePayloadDto,
	SetupAppearancePayloadDto,
	SetupModelPayloadDto,
	SurfaceTexturePayloadDto,
} from "../../../lib/host/contracts";
import type { ResolverGfxObjPayloadDto } from "../../assets/preparation/gfx-obj-views";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import {
	createHostAssetKey,
	describeHostAssetKey,
	parseHostAssetId,
} from "../../assets/keys";
import type {
	PaletteIdentity,
	RenderSurfaceIdentity,
	StaticMaterialSourceIdentity,
	StaticObjectMaterialSourceFacts,
	StaticObjectPaletteSourceFacts,
	StaticObjectPaletteViewFacts,
	StaticObjectPartMaterialSlotFacts,
	StaticObjectPartSourceFacts,
	StaticObjectSourceAssetFacts,
	StaticObjectSourceIdentity,
	StaticObjectTextureRefFacts,
	StaticResourceIdentity,
	SurfaceTextureIdentity,
} from "../contracts";
import {
	createPaletteIdentity,
	createRenderSurfaceIdentity,
	createSurfaceTextureIdentity,
} from "../terrain/terrain-identities";
import { createStaticObjectSourceGeometryIdentity } from "./static-object-source-assets";

type StaticObjectSourceClosurePreparedPayload =
	| MaterialRecipePayloadDto
	| PalettePayloadDto
	| RenderSurfacePayloadDto
	| ResolverGfxObjPayloadDto
	| SetupAppearancePayloadDto
	| SetupModelPayloadDto
	| SurfaceTexturePayloadDto;

interface LoadedPayload<
	TKind extends StaticObjectSourceClosurePreparedPayload["kind"] =
		StaticObjectSourceClosurePreparedPayload["kind"],
> {
	readonly asset: PreparedAsset;
	readonly payload: Extract<
		StaticObjectSourceClosurePreparedPayload,
		{ readonly kind: TKind }
	>;
}

export interface StaticObjectSourceClosure {
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly paletteSources: readonly StaticObjectPaletteSourceFacts[];
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
	readonly missingRefs: readonly StaticResourceIdentity[];
	readonly sourceRevision: number;
}

interface StaticObjectMaterialSlotInput {
	readonly slotIndex: number;
	readonly geometrySurfaceId: number;
	readonly materialSurfaceId: number;
	readonly materialId: number;
	readonly materialVariantSignature: string | null;
	readonly paletteOverride: StaticObjectPaletteViewFacts["palette"] | null;
	readonly paletteViews: readonly StaticObjectPaletteViewFacts[];
}

export async function resolveStaticObjectSourceClosure(options: {
	readonly assetService: PreparedAssetReader;
	readonly sourceAssetIds: readonly string[];
}): Promise<StaticObjectSourceClosure> {
	const sourceAssets = new Map<string, StaticObjectSourceAssetFacts>();
	const materialSources = new Map<string, StaticObjectMaterialSourceFacts>();
	const paletteSources = new Map<string, StaticObjectPaletteSourceFacts>();
	const textureRefs = new Map<string, StaticObjectTextureRefFacts>();
	const missingRefs: StaticResourceIdentity[] = [];
	let sourceRevision = 0;

	for (const sourceAssetId of uniqueSorted(options.sourceAssetIds)) {
		const sourceKey = parseHostAssetId(sourceAssetId);
		const identity = createStaticObjectSourceIdentity(sourceKey);

		try {
			const source = await loadRenderableSource(options.assetService, sourceKey);
			sourceRevision = Math.max(sourceRevision, source.asset.revision);
			const facts = await createSourceAssetFacts({
				assetService: options.assetService,
				identity,
				materialSources,
				missingRefs,
				paletteSources,
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
		paletteSources: [...paletteSources.values()],
		sourceAssets: [...sourceAssets.values()],
		sourceRevision,
		textureRefs: [...textureRefs.values()],
	};
}

export async function resolveStaticObjectSurfaceTextureRef(options: {
	readonly assetService: PreparedAssetReader;
	readonly texture: SurfaceTextureIdentity;
	readonly selectedRenderSurfaceId: number | null;
	readonly palette: PaletteIdentity | null;
	readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
	readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
	readonly missingRefs: StaticResourceIdentity[];
}): Promise<number> {
	let surfaceTexture: LoadedPayload<"surface-texture">;
	try {
		surfaceTexture = await loadPayload(
			options.assetService,
			createHostAssetKey("surface-texture", options.texture.surfaceTextureId),
			"surface-texture",
		);
	} catch {
		options.missingRefs.push(options.texture);
		return 0;
	}

	const renderSurfaceId =
		options.selectedRenderSurfaceId ??
		surfaceTexture.payload.selectedRenderSurfaceId ??
		surfaceTexture.payload.renderSurfaceIds[0] ??
		null;
	const renderSurface =
		renderSurfaceId === null ? null : createRenderSurfaceIdentity(renderSurfaceId);
	let palette = options.palette;

	options.textureRefs.set(
		createTextureRefCacheKey({
			role: "surface-texture",
			texture: options.texture,
		}),
		{
			palette,
			renderSurface,
			role: "surface-texture",
			texture: options.texture,
		},
	);

	if (renderSurface === null) {
		return 0;
	}

	try {
		const loadedRenderSurface = await loadPayload(
			options.assetService,
			createHostAssetKey("render-surface", renderSurface.renderSurfaceId),
			"render-surface",
		);
		palette =
			palette ??
			(loadedRenderSurface.payload.defaultPaletteId === null
				? null
				: createPaletteIdentity(loadedRenderSurface.payload.defaultPaletteId));
		options.textureRefs.set(
			createTextureRefCacheKey({ role: "render-surface", renderSurface }),
			{
				format: loadedRenderSurface.payload.format,
				formatRaw: loadedRenderSurface.payload.formatRaw,
				height: loadedRenderSurface.payload.height,
				indexedMaxIndex: scanIndexedMaxIndex(
					loadedRenderSurface.payload.sourceBytes,
					loadedRenderSurface.payload.formatRaw,
				),
				palette,
				renderSurface,
				role: "render-surface",
				width: loadedRenderSurface.payload.width,
			},
		);
		if (palette) {
			await loadPalette(
				options.assetService,
				palette,
				options.paletteSources,
				options.missingRefs,
			);
		}
		return loadedRenderSurface.payload.sourceByteLength;
	} catch {
		options.missingRefs.push(renderSurface);
		return 0;
	}
}

async function createSourceAssetFacts(options: {
	readonly assetService: PreparedAssetReader;
	readonly identity: StaticObjectSourceIdentity;
	readonly source: LoadedPayload<"gfx-obj" | "setup-model">;
	readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
	readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
	readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
	readonly missingRefs: StaticResourceIdentity[];
}): Promise<StaticObjectSourceAssetFacts> {
	const parts =
		options.source.payload.kind === "gfx-obj"
			? await createDirectGfxParts({
					assetService: options.assetService,
					gfxObjAssetId: options.source.asset.sourceAssetId,
					gfxObj: options.source.payload,
					materialSources: options.materialSources,
					missingRefs: options.missingRefs,
					paletteSources: options.paletteSources,
					source: options.identity,
					textureRefs: options.textureRefs,
				})
			: await createSetupModelParts({
					assetService: options.assetService,
					materialSources: options.materialSources,
					missingRefs: options.missingRefs,
					paletteSources: options.paletteSources,
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

async function createDirectGfxParts(options: {
	readonly assetService: PreparedAssetReader;
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObjAssetId: string;
	readonly gfxObj: ResolverGfxObjPayloadDto;
	readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
	readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
	readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
	readonly missingRefs: StaticResourceIdentity[];
}): Promise<readonly StaticObjectPartSourceFacts[]> {
	return [
		await createGfxPartFacts({
			assetService: options.assetService,
			defaultPlacements: [],
			gfxObj: options.gfxObj,
			gfxObjAssetId: options.gfxObjAssetId,
			materialSources: options.materialSources,
			missingRefs: options.missingRefs,
			paletteSources: options.paletteSources,
			partIndex: 0,
			scale: UNIT_SCALE,
			source: options.source,
			textureRefs: options.textureRefs,
		}),
	];
}

async function createSetupModelParts(options: {
	readonly assetService: PreparedAssetReader;
	readonly source: StaticObjectSourceIdentity;
	readonly setupModel: SetupModelPayloadDto;
	readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
	readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
	readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
	readonly missingRefs: StaticResourceIdentity[];
}): Promise<readonly StaticObjectPartSourceFacts[]> {
	const setupAppearance = await tryLoadSetupAppearance(
		options.assetService,
		options.setupModel.setupModelId,
		options.missingRefs,
	);
	const parts = setupAppearance?.payload.parts ?? options.setupModel.parts;
	const paletteOverride =
		setupAppearance?.payload.paletteId == null
			? null
			: createPaletteIdentity(setupAppearance.payload.paletteId);
	const paletteViews = createStaticObjectPaletteViews(
		setupAppearance?.payload.subPalettes ?? [],
	);
	if (paletteOverride) {
		await loadPalette(
			options.assetService,
			paletteOverride,
			options.paletteSources,
			options.missingRefs,
		);
	}
	await loadPaletteViews(
		options.assetService,
		paletteViews,
		options.paletteSources,
		options.missingRefs,
	);
	const facts: StaticObjectPartSourceFacts[] = [];

	for (const part of parts) {
		const gfxObjAssetId = part.gfxObjAssetId;
		const gfxObjIdentity = createStaticObjectSourceIdentity(
			parseHostAssetId(gfxObjAssetId),
		);
		let gfxObj: LoadedPayload<"gfx-obj">;
		try {
			gfxObj = await loadPayload(
				options.assetService,
				parseHostAssetId(gfxObjAssetId),
				"gfx-obj",
			);
		} catch {
			options.missingRefs.push(gfxObjIdentity);
			continue;
		}

		const setupPart = options.setupModel.parts.find(
			(candidate) => candidate.partIndex === part.partIndex,
		);
		facts.push(
			await createGfxPartFacts({
				assetService: options.assetService,
				defaultPlacements: deriveSetupPartDefaultPlacements(
					options.setupModel,
					part.partIndex,
				),
				gfxObj: gfxObj.payload,
				gfxObjAssetId,
				materialSlots:
					"materialSlots" in part
						? expandStaticObjectMaterialVariants({
								gfxObj: gfxObj.payload,
								materialSlots: part.materialSlots.map((slot) => ({
									geometrySurfaceId: slot.slotIndex,
									materialId: parseMaterialAssetId(slot.materialAssetId),
									materialSurfaceId: slot.surfaceId,
									materialVariantSignature: null,
									paletteOverride,
									paletteViews,
									slotIndex: slot.slotIndex,
								})),
							})
						: undefined,
				materialSources: options.materialSources,
				missingRefs: options.missingRefs,
				paletteSources: options.paletteSources,
				partIndex: part.partIndex,
				scale: setupPart?.scale ?? UNIT_SCALE,
				source: options.source,
				textureRefs: options.textureRefs,
			}),
		);
	}

	return facts;
}

async function createGfxPartFacts(options: {
	readonly assetService: PreparedAssetReader;
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObjAssetId: string;
	readonly gfxObj: ResolverGfxObjPayloadDto;
	readonly partIndex: number;
	readonly defaultPlacements: readonly StaticObjectPartSourceFacts["defaultPlacements"][number][];
	readonly scale: StaticObjectPartSourceFacts["scale"];
	readonly materialSlots?: readonly StaticObjectMaterialSlotInput[];
	readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
	readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
	readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
	readonly missingRefs: StaticResourceIdentity[];
}): Promise<StaticObjectPartSourceFacts> {
	const gfxObj = createStaticObjectSourceIdentity(
		parseHostAssetId(options.gfxObjAssetId),
	);
	const materialSlots = await createMaterialSlotFacts({
		assetService: options.assetService,
		gfxObj: options.gfxObj,
		materialSlots: options.materialSlots,
		materialSources: options.materialSources,
		missingRefs: options.missingRefs,
		paletteSources: options.paletteSources,
		textureRefs: options.textureRefs,
	});

	return {
		bounds: options.gfxObj.renderGeometry.bounds,
		defaultPlacements: options.defaultPlacements,
		geometry: createStaticObjectSourceGeometryIdentity({
			gfxObj,
			partIndex: options.partIndex,
			source: options.source,
		}),
		gfxObj,
		invalidPolygonCount: options.gfxObj.renderGeometry.invalidPolygons.length,
		materialSlotCount: materialSlots.length,
		materialSlots,
		partIndex: options.partIndex,
		physicsPolygonCount: options.gfxObj.physicsWitness.polygonCount,
		renderTriangleCount: options.gfxObj.renderGeometry.triangleCount,
		scale: options.scale,
		skippedPolygonCount: options.gfxObj.renderGeometry.skippedPolygonCount,
		source: options.source,
		triangles: options.gfxObj.renderGeometry.triangles.map((triangle) => ({
			firstVertex: triangle.firstVertex,
			geometrySurfaceId: triangle.surfaceId,
			materialVariantSignature: triangle.materialVariantSignature ?? null,
			polygonId: triangle.polygonId,
		})),
	};
}

async function createMaterialSlotFacts(options: {
	readonly assetService: PreparedAssetReader;
	readonly gfxObj: ResolverGfxObjPayloadDto;
	readonly materialSlots?: readonly StaticObjectMaterialSlotInput[];
	readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
	readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
	readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
	readonly missingRefs: StaticResourceIdentity[];
}): Promise<readonly StaticObjectPartMaterialSlotFacts[]> {
	const materialSlots =
		options.materialSlots ??
		expandStaticObjectMaterialVariants({
			gfxObj: options.gfxObj,
			materialSlots: options.gfxObj.surfaceIds.map((surfaceId, slotIndex) => ({
				geometrySurfaceId: slotIndex,
				materialId: surfaceId,
				materialSurfaceId: surfaceId,
				materialVariantSignature: null,
				paletteOverride: null,
				paletteViews: [],
				slotIndex,
			})),
		});
	const slots = await Promise.all(
		materialSlots.map(async (slot) => {
			const material = createStaticMaterialSourceIdentity(slot.materialId);
			await loadMaterialSource({
				assetService: options.assetService,
				material,
				materialSources: options.materialSources,
				missingRefs: options.missingRefs,
				paletteSources: options.paletteSources,
				textureRefs: options.textureRefs,
			});
			return {
				material,
				geometrySurfaceId: slot.geometrySurfaceId,
				materialSurfaceId: slot.materialSurfaceId,
				materialVariantSignature: slot.materialVariantSignature,
				paletteOverride: slot.paletteOverride,
				paletteViews: slot.paletteViews,
				slotIndex: slot.slotIndex,
			};
		}),
	);

	return slots;
}

async function loadMaterialSource(options: {
	readonly assetService: PreparedAssetReader;
	readonly material: StaticMaterialSourceIdentity;
	readonly materialSources: Map<string, StaticObjectMaterialSourceFacts>;
	readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
	readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
	readonly missingRefs: StaticResourceIdentity[];
}): Promise<void> {
	const key = createMaterialCacheKey(options.material);
	if (options.materialSources.has(key)) {
		return;
	}

	let material: LoadedPayload<"material-recipe">;
	try {
		material = await loadPayload(
			options.assetService,
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

	if (source.kind === "texture" && source.palette) {
		await loadPalette(
			options.assetService,
			source.palette,
			options.paletteSources,
			options.missingRefs,
		);
	}

	await resolveMaterialTextureRefs(
		options.assetService,
		material.payload,
		options.paletteSources,
		options.textureRefs,
		options.missingRefs,
	);
}

async function resolveMaterialTextureRefs(
	assetService: PreparedAssetReader,
	material: MaterialRecipePayloadDto,
	paletteSources: Map<string, StaticObjectPaletteSourceFacts>,
	textureRefs: Map<string, StaticObjectTextureRefFacts>,
	missingRefs: StaticResourceIdentity[],
): Promise<void> {
	if (material.source.kind !== "texture") {
		return;
	}

	await resolveStaticObjectSurfaceTextureRef({
		assetService,
		missingRefs,
		palette:
			material.source.paletteId === null
				? null
				: createPaletteIdentity(material.source.paletteId),
		paletteSources,
		selectedRenderSurfaceId: material.source.selectedRenderSurfaceId,
		texture: createSurfaceTextureIdentity(material.source.surfaceTextureId),
		textureRefs,
	});
}

async function loadPalette(
	assetService: PreparedAssetReader,
	palette: PaletteIdentity,
	paletteSources: Map<string, StaticObjectPaletteSourceFacts>,
	missingRefs: StaticResourceIdentity[],
): Promise<void> {
	const key = createPaletteCacheKey(palette);
	if (paletteSources.has(key)) {
		return;
	}
	try {
		const loaded = await loadPayload(
			assetService,
			createHostAssetKey("palette", palette.paletteId),
			"palette",
		);
		paletteSources.set(key, {
			colorCount: loaded.payload.colorCount,
			palette,
		});
	} catch {
		missingRefs.push(palette);
	}
}

async function loadPaletteViews(
	assetService: PreparedAssetReader,
	paletteViews: readonly StaticObjectPaletteViewFacts[],
	paletteSources: Map<string, StaticObjectPaletteSourceFacts>,
	missingRefs: StaticResourceIdentity[],
): Promise<void> {
	for (const paletteView of paletteViews) {
		await loadPalette(assetService, paletteView.palette, paletteSources, missingRefs);
	}
}

async function tryLoadSetupAppearance(
	assetService: PreparedAssetReader,
	setupModelId: number,
	missingRefs: StaticResourceIdentity[],
): Promise<LoadedPayload<"setup-appearance"> | null> {
	const identity: StaticObjectSourceIdentity = {
		kind: "static-object-source",
		sourceAssetKind: "setup-appearance",
		sourceDid: setupModelId,
	};
	try {
		return await loadPayload(
			assetService,
			createHostAssetKey("setup-appearance", setupModelId),
			"setup-appearance",
		);
	} catch {
		missingRefs.push(identity);
		return null;
	}
}

async function loadRenderableSource(
	assetService: PreparedAssetReader,
	key: HostAssetKey,
): Promise<LoadedPayload<"gfx-obj" | "setup-model">> {
	if (key.kind !== "gfx-obj" && key.kind !== "setup-model") {
		throw new Error(
			`Static object source must be gfx-obj or setup-model, got ${describeHostAssetKey(
				key,
			)}.`,
		);
	}

	return loadPayload(assetService, key, key.kind);
}

async function loadPayload<
	TKind extends StaticObjectSourceClosurePreparedPayload["kind"],
>(
	assetService: PreparedAssetReader,
	key: HostAssetKey,
	expectedKind: TKind,
): Promise<LoadedPayload<TKind>> {
	const asset = await assetService.requestPreparedAsset(key);
	const payload = requirePreparedPayloadKind(asset, expectedKind);
	return { asset, payload };
}

export function createStaticObjectSourceIdentity(
	key: HostAssetKey,
): StaticObjectSourceIdentity {
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

function createStaticMaterialSourceIdentity(
	materialId: number,
): StaticMaterialSourceIdentity {
	return {
		kind: "static-material-source",
		materialId,
	};
}

function createStaticObjectPaletteViews(
	subPalettes: readonly SetupAppearancePayloadDto["subPalettes"][number][],
): readonly StaticObjectPaletteViewFacts[] {
	return subPalettes
		.map((subPalette) => ({
			firstIndex: subPalette.offset,
			indexCount: subPalette.numColors,
			palette: createPaletteIdentity(subPalette.subId),
		}))
		.sort(
			(left, right) =>
				left.palette.paletteId - right.palette.paletteId ||
				left.firstIndex - right.firstIndex ||
				left.indexCount - right.indexCount,
		);
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

function expandStaticObjectMaterialVariants(options: {
	readonly gfxObj: ResolverGfxObjPayloadDto;
	readonly materialSlots: readonly Omit<
		StaticObjectMaterialSlotInput,
		"materialVariantSignature"
	>[];
}): readonly StaticObjectMaterialSlotInput[] {
	const variantsByGeometrySurface = collectGeometryMaterialVariants(
		options.gfxObj,
	);

	return options.materialSlots.flatMap((slot) => {
		const variants = variantsByGeometrySurface.get(slot.geometrySurfaceId);
		if (!variants || variants.size === 0) {
			return [{ ...slot, materialVariantSignature: null }];
		}

		return [...variants]
			.sort(compareMaterialVariantSignatures)
			.map((materialVariantSignature) => ({
				...slot,
				materialVariantSignature,
			}));
	});
}

function collectGeometryMaterialVariants(
	gfxObj: ResolverGfxObjPayloadDto,
): ReadonlyMap<number, ReadonlySet<string | null>> {
	const variantsByGeometrySurface = new Map<number, Set<string | null>>();

	for (const triangle of gfxObj.renderGeometry.triangles) {
		if (triangle.surfaceId === null) {
			continue;
		}
		const variants =
			variantsByGeometrySurface.get(triangle.surfaceId) ??
			new Set<string | null>();
		variants.add(triangle.materialVariantSignature ?? null);
		variantsByGeometrySurface.set(triangle.surfaceId, variants);
	}

	return variantsByGeometrySurface;
}

function compareMaterialVariantSignatures(
	left: string | null,
	right: string | null,
): number {
	return (left ?? "").localeCompare(right ?? "");
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

export function createSourceCacheKey(
	identity: StaticObjectSourceIdentity,
): string {
	return `${identity.sourceAssetKind}:${identity.sourceDid}`;
}

function createMaterialCacheKey(
	identity: StaticMaterialSourceIdentity,
): string {
	return `${identity.materialId}`;
}

export function createPaletteCacheKey(identity: PaletteIdentity): string {
	return `${identity.paletteId}`;
}

export function createTextureRefCacheKey(
	ref:
		| {
				readonly role: "surface-texture";
				readonly texture: SurfaceTextureIdentity;
		  }
		| {
				readonly role: "render-surface";
				readonly renderSurface: RenderSurfaceIdentity;
		  },
): string {
	return ref.role === "surface-texture"
		? `${ref.role}:${ref.texture.surfaceTextureId}`
		: `${ref.role}:${ref.renderSurface.renderSurfaceId}`;
}

function requirePreparedPayloadKind<
	TKind extends StaticObjectSourceClosurePreparedPayload["kind"],
>(
	asset: PreparedAsset,
	expectedKind: TKind,
): Extract<StaticObjectSourceClosurePreparedPayload, { readonly kind: TKind }> {
	const payload = asset.payload as StaticObjectSourceClosurePreparedPayload;
	if (payload.kind !== expectedKind) {
		throw new Error(
			`Prepared asset ${asset.sourceAssetId} was ${payload.kind}, expected ${expectedKind}.`,
		);
	}

	return payload as Extract<
		StaticObjectSourceClosurePreparedPayload,
		{ readonly kind: TKind }
	>;
}

const UNIT_SCALE = { x: 1, y: 1, z: 1 };

const PIXEL_FORMAT_P8 = 0x29;
const PIXEL_FORMAT_INDEX16 = 0x65;

function scanIndexedMaxIndex(
	bytes: Uint8Array,
	formatRaw: number,
): number | null {
	if (formatRaw === PIXEL_FORMAT_P8) {
		let maxIndex = 0;
		for (const index of bytes) {
			maxIndex = Math.max(maxIndex, index);
		}
		return maxIndex;
	}
	if (formatRaw !== PIXEL_FORMAT_INDEX16) {
		return null;
	}
	if (bytes.byteLength % Uint16Array.BYTES_PER_ELEMENT !== 0) {
		throw new Error(
			`Index16 render surface byte length ${bytes.byteLength} is not 16-bit aligned.`,
		);
	}
	let maxIndex = 0;
	for (let offset = 0; offset < bytes.byteLength; offset += 2) {
		const index = bytes[offset] | ((bytes[offset + 1] ?? 0) << 8);
		maxIndex = Math.max(maxIndex, index);
	}
	return maxIndex;
}
