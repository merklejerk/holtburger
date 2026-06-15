import type {
	LandblockOutdoorPayloadDto,
	PalettePayloadDto,
	RegionRenderProfilePayloadDto,
	RenderSurfacePayloadDto,
	SurfaceTexturePayloadDto,
	TerrainMaterialPayloadDto,
} from "../../../lib/host/contracts";
import type { AssetService, PreparedAsset } from "../../assets/contracts";
import { createHostAssetKey } from "../../assets/keys";
import type {
	PaletteIdentity,
	RegionDetailRoleFacts,
	StaticBounds,
	StaticResolverJob,
	StaticResourceIdentity,
	StaticScopePayload,
	TerrainAlphaMapFacts,
	TerrainMaterialTypeFacts,
	TerrainRoadAlphaMapFacts,
	TerrainStaticScopePayload,
	TerrainSourceSpatialFacts,
	TerrainTextureUseFacts,
} from "../contracts";
import {
	createPaletteIdentity,
	createPreparedRenderSurfaceTextureUseIdentity,
	createRegionRenderProfileIdentity,
	createRenderSurfaceIdentity,
	createSurfaceTextureIdentity,
	createTerrainMaterialIdentity,
	parseTerrainSliceDependencyRoute,
} from "./terrain-identities";

type TerrainResolverCacheKey = string & {
	readonly __terrainResolverCacheKey: unique symbol;
};

export interface TerrainResolverOptions {
	readonly assetService: AssetService;
}

export class TerrainStaticScopeResolver {
	readonly #assetService: AssetService;

	constructor(options: TerrainResolverOptions) {
		this.#assetService = options.assetService;
	}

	async resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (job.domain !== "outdoor-terrain" || job.scope.kind !== "landblock") {
			throw new Error(
				`Terrain resolver only supports outdoor landblock terrain jobs. Received ${job.scope.kind}/${job.domain}.`,
			);
		}

		const landblock = await this.#loadPayload(
			"landblock-outdoor",
			job.scope.landblockId,
			"landblock-outdoor",
		);
		const terrainMaterial = await this.#loadPayload(
			"terrain-material",
			landblock.regionNumber,
			"terrain-material",
		);
		const regionRenderProfile = await this.#loadPayload(
			"region-render-profile",
			landblock.regionNumber,
			"region-render-profile",
		);

		const textureUses = await this.#resolveTextureUses(
			terrainMaterial,
			regionRenderProfile,
		);

		return {
			job,
			scope: {
				kind: "terrain",
				landblock: {
					kind: "landblock-source",
					landblockId: landblock.landblockId,
					source: "outdoor",
				},
				mesh: createTerrainMeshFacts(landblock),
				missingRefs: textureUses.missingRefs,
				regionRenderProfile: {
					detailRoles: createRegionDetailRoles(regionRenderProfile),
					identity: createRegionRenderProfileIdentity(landblock.regionNumber),
				},
				sourceSpatial: createTerrainSourceSpatialFacts(landblock),
				terrainMaterial: {
					alphaMapCount: terrainMaterial.terrainAlphaMaps.length,
					identity: createTerrainMaterialIdentity(landblock.regionNumber),
					materialKind: terrainMaterial.materialKind,
					pcodeEncoding: terrainMaterial.pcodeEncoding,
					roadAlphaMapCount: terrainMaterial.roadAlphaMaps.length,
					roadAlphaMaps: createTerrainRoadAlphaMapFacts(terrainMaterial),
					terrainAlphaMaps: createTerrainAlphaMapFacts(terrainMaterial),
					terrainTypeCount: terrainMaterial.terrainTypes.length,
					terrainTypes: createTerrainTypeFacts(terrainMaterial),
				},
				textureUses: textureUses.facts,
			},
			sourceRevision: Math.max(
				landblock.regionNumber,
				textureUses.sourceRevision,
			),
		};
	}

	async #resolveTextureUses(
		terrainMaterial: TerrainMaterialPayloadDto,
		regionRenderProfile: RegionRenderProfilePayloadDto,
	): Promise<{
		readonly facts: readonly TerrainTextureUseFacts[];
		readonly missingRefs: readonly StaticResourceIdentity[];
		readonly sourceRevision: number;
	}> {
		const surfaceRoles = collectSurfaceRoles(
			terrainMaterial,
			regionRenderProfile,
		);
		const facts: TerrainTextureUseFacts[] = [];
		const missingRefs: StaticResourceIdentity[] = [];
		let sourceRevision = 0;

		for (const surfaceRole of surfaceRoles.values()) {
			let surface: SurfaceTexturePayloadDto;
			try {
				surface = await this.#loadPayload(
					"surface-texture",
					surfaceRole.texture.surfaceTextureId,
					"surface-texture",
				);
			} catch {
				missingRefs.push(surfaceRole.texture);
				continue;
			}

			const renderSurfaceId =
				surface.selectedRenderSurfaceId ?? surface.renderSurfaceIds[0] ?? null;
			const renderSurfaceIdentity =
				renderSurfaceId === null
					? null
					: createRenderSurfaceIdentity(renderSurfaceId);
			let palette: PaletteIdentity | null = null;

			if (renderSurfaceIdentity) {
				try {
					const renderSurface = await this.#loadPayload(
						"render-surface",
						renderSurfaceIdentity.renderSurfaceId,
						"render-surface",
					);
					sourceRevision = Math.max(
						sourceRevision,
						renderSurface.sourceByteLength,
					);
					palette = await this.#resolvePalette(renderSurface, missingRefs);
				} catch {
					missingRefs.push(renderSurfaceIdentity);
				}
			}

			facts.push({
				palette,
				preparedTextureUse: renderSurfaceIdentity
					? createPreparedRenderSurfaceTextureUseIdentity({
							renderSurfaceId: renderSurfaceIdentity.renderSurfaceId,
							usage:
								surfaceRole.role === "detail"
									? "rgba-detail"
									: surfaceRole.role === "terrain-alpha" ||
										  surfaceRole.role === "road-alpha"
										? "rgba-mask"
										: "rgba-color",
						})
					: null,
				renderSurface: renderSurfaceIdentity,
				role: surfaceRole.role,
				texture: surfaceRole.texture,
			});
		}

		return { facts, missingRefs, sourceRevision };
	}

	async #resolvePalette(
		renderSurface: RenderSurfacePayloadDto,
		missingRefs: StaticResourceIdentity[],
	): Promise<PaletteIdentity | null> {
		const paletteId =
			renderSurface.defaultPaletteId ??
			parseFirstPaletteDependency(renderSurface.dependencies.paletteAssetIds);
		if (paletteId === null) {
			return null;
		}

		const identity = createPaletteIdentity(paletteId);
		try {
			await this.#loadPayload("palette", paletteId, "palette");
			return identity;
		} catch {
			missingRefs.push(identity);
			return null;
		}
	}

	async #loadPayload<TKind extends TerrainPreparedPayload["kind"]>(
		keyKind: Parameters<typeof createHostAssetKey>[0],
		id: string | number,
		expectedKind: TKind,
	): Promise<Extract<TerrainPreparedPayload, { readonly kind: TKind }>> {
		const asset = await this.#assetService.requestPreparedAsset(
			createHostAssetKey(keyKind, id),
		);
		return requirePreparedPayloadKind(asset, expectedKind);
	}
}

type TerrainPreparedPayload =
	| LandblockOutdoorPayloadDto
	| TerrainMaterialPayloadDto
	| RegionRenderProfilePayloadDto
	| SurfaceTexturePayloadDto
	| RenderSurfacePayloadDto
	| PalettePayloadDto;

type TerrainTextureRole = TerrainTextureUseFacts["role"];

interface SurfaceRole {
	readonly role: TerrainTextureRole;
	readonly texture: ReturnType<typeof createSurfaceTextureIdentity>;
}

function collectSurfaceRoles(
	terrainMaterial: TerrainMaterialPayloadDto,
	regionRenderProfile: RegionRenderProfilePayloadDto,
): Map<TerrainResolverCacheKey, SurfaceRole> {
	const roles = new Map<TerrainResolverCacheKey, SurfaceRole>();

	for (const entry of terrainMaterial.terrainTypes) {
		addSurfaceRole(roles, "terrain-base", entry.textureAssetId);
	}
	for (const entry of terrainMaterial.terrainAlphaMaps) {
		addSurfaceRole(roles, "terrain-alpha", entry.alphaTextureAssetId);
	}
	for (const entry of terrainMaterial.roadAlphaMaps) {
		addSurfaceRole(roles, "road", entry.roadTextureAssetId);
		addSurfaceRole(roles, "road-alpha", entry.alphaTextureAssetId);
	}
	for (const role of Object.values(regionRenderProfile.detailRoles)) {
		if (role) {
			addSurfaceRole(roles, "detail", role.textureAssetId);
		}
	}

	return roles;
}

function addSurfaceRole(
	roles: Map<TerrainResolverCacheKey, SurfaceRole>,
	role: TerrainTextureRole,
	assetId: string,
): void {
	const identity = parseTerrainSliceDependencyRoute(assetId);
	if (identity.kind !== "surface-texture") {
		throw new Error(`Terrain texture role expected a surface texture route.`);
	}

	roles.set(createTerrainResolverCacheKey(identity), {
		role,
		texture: identity,
	});
}

function createRegionDetailRoles(
	profile: RegionRenderProfilePayloadDto,
): readonly RegionDetailRoleFacts[] {
	return Object.entries(profile.detailRoles).flatMap(([role, entry]) => {
		if (!entry) {
			return [];
		}
		const identity = parseTerrainSliceDependencyRoute(entry.textureAssetId);
		if (identity.kind !== "surface-texture") {
			throw new Error(`Region detail role expected a surface texture route.`);
		}

		return [
			{
				fadeFar: entry.fadeFar,
				fadeNear: entry.fadeNear,
				role: role as RegionDetailRoleFacts["role"],
				texture: identity,
				tiling: entry.tiling,
			},
		];
	});
}

function createTerrainTypeFacts(
	terrainMaterial: TerrainMaterialPayloadDto,
): readonly TerrainMaterialTypeFacts[] {
	return terrainMaterial.terrainTypes.map((entry) => ({
		terrainCode: entry.terrainType,
		texture: requireSurfaceTextureIdentity(entry.textureAssetId),
		tiling: entry.tiling,
	}));
}

function createTerrainAlphaMapFacts(
	terrainMaterial: TerrainMaterialPayloadDto,
): readonly TerrainAlphaMapFacts[] {
	return terrainMaterial.terrainAlphaMaps.map((entry) => ({
		alphaIndex: entry.alphaIndex,
		selector: entry.selector,
		texture: requireSurfaceTextureIdentity(entry.alphaTextureAssetId),
	}));
}

function createTerrainRoadAlphaMapFacts(
	terrainMaterial: TerrainMaterialPayloadDto,
): readonly TerrainRoadAlphaMapFacts[] {
	return terrainMaterial.roadAlphaMaps.map((entry) => ({
		alphaTexture: requireSurfaceTextureIdentity(entry.alphaTextureAssetId),
		roadIndex: entry.roadIndex,
		roadTexture: requireSurfaceTextureIdentity(entry.roadTextureAssetId),
		selector: entry.selector,
	}));
}

function requireSurfaceTextureIdentity(
	assetId: string,
): ReturnType<typeof createSurfaceTextureIdentity> {
	const identity = parseTerrainSliceDependencyRoute(assetId);
	if (identity.kind !== "surface-texture") {
		throw new Error(`Terrain material expected a surface texture route.`);
	}

	return identity;
}

function createTerrainSourceSpatialFacts(
	landblock: LandblockOutdoorPayloadDto,
): TerrainSourceSpatialFacts {
	return {
		bounds: landblock.terrain.bounds
			? terrainSourceBoundsToRenderLocalBounds(landblock.terrain.bounds)
			: null,
		coordinateSpace: "landblock-render-local",
		terrainBvh: {
			coordinateSpace: "landblock-render-local",
			items: landblock.terrain.terrainBvh.items,
			nodes: landblock.terrain.terrainBvh.nodes.map((node) => ({
				...node,
				bounds: terrainSourceBoundsToRenderLocalBounds(node.bounds),
			})),
		},
		terrainBvhItemCount: landblock.terrain.terrainBvh.items.length,
		terrainBvhNodeCount: landblock.terrain.terrainBvh.nodes.length,
	};
}

function createTerrainMeshFacts(
	landblock: LandblockOutdoorPayloadDto,
): TerrainStaticScopePayload["mesh"] {
	return {
		bounds: landblock.terrain.bounds
			? terrainSourceBoundsToRenderLocalBounds(landblock.terrain.bounds)
			: null,
		gridSize: landblock.terrain.gridSize,
		maxHeight: landblock.terrain.maxHeight,
		minHeight: landblock.terrain.minHeight,
		quadCount: landblock.terrain.quads.length,
		quads: landblock.terrain.quads.map((quad) => ({
			...quad,
			bounds: terrainSourceBoundsToRenderLocalBounds(quad.bounds),
		})),
		tileSize: landblock.terrain.tileSize,
		triangleCount: landblock.terrain.triangles.length,
		triangles: landblock.terrain.triangles.map((triangle) => ({
			...triangle,
			bounds: terrainSourceBoundsToRenderLocalBounds(triangle.bounds),
		})),
		vertexCount: landblock.terrain.vertices.length,
		vertices: landblock.terrain.vertices.map(
			terrainSourceVec3ToRenderLocalVec3,
		),
	};
}

function terrainSourceVec3ToRenderLocalVec3(
	vec: LandblockOutdoorPayloadDto["terrain"]["vertices"][number],
): LandblockOutdoorPayloadDto["terrain"]["vertices"][number] {
	return {
		x: vec.x,
		y: vec.z,
		z: negateWithoutNegativeZero(vec.y),
	};
}

function terrainSourceBoundsToRenderLocalBounds(
	bounds: StaticBounds,
): StaticBounds {
	return {
		max: {
			x: bounds.max.x,
			y: bounds.max.z,
			z: negateWithoutNegativeZero(bounds.min.y),
		},
		min: {
			x: bounds.min.x,
			y: bounds.min.z,
			z: negateWithoutNegativeZero(bounds.max.y),
		},
	};
}

function negateWithoutNegativeZero(value: number): number {
	return value === 0 ? 0 : -value;
}

function parseFirstPaletteDependency(
	assetIds: readonly string[],
): number | null {
	for (const assetId of assetIds) {
		const identity = parseTerrainSliceDependencyRoute(assetId);
		if (identity.kind === "palette") {
			return identity.paletteId;
		}
	}

	return null;
}

function createTerrainResolverCacheKey(
	identity: StaticResourceIdentity,
): TerrainResolverCacheKey {
	return JSON.stringify(identity) as TerrainResolverCacheKey;
}

function requirePreparedPayloadKind<
	TKind extends TerrainPreparedPayload["kind"],
>(
	asset: PreparedAsset,
	expectedKind: TKind,
): Extract<TerrainPreparedPayload, { readonly kind: TKind }> {
	const payload = asset.payload as TerrainPreparedPayload;
	if (payload.kind !== expectedKind) {
		throw new Error(
			`Prepared asset ${asset.sourceAssetId} was ${payload.kind}, expected ${expectedKind}.`,
		);
	}

	return payload as Extract<TerrainPreparedPayload, { readonly kind: TKind }>;
}
