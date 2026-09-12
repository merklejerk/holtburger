import { packTerrainPcode } from "./pcode";
import { AABB3, Vec3 } from "../math/types";
import type { GeometryManager } from "../geometry/geometry-manager";
import { createTerrainGeometryKey } from "../geometry/types";
import {
	getLandblockCoordinates,
	isOutdoorLandblock,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	OUTDOOR_TERRAIN_GRID_CELLS,
	type LandblockCoordinates,
} from "../landblocks";
import type { TerrainGeometryData } from "../renderer/geometry";
import type { ResourceOwnerId } from "../runtime/owner-ids";
import type { SceneInterestRequest } from "../runtime/scene-interest";
import type { TextureManager } from "../textures/texture-manager";
import {
	type TerrainCompositionTextureKey,
	createTerrainCompositionTextureKey,
	createTerrainSurfaceTextureKey,
} from "../textures/types";
import {
	createTerrainCompositionUpload,
	createTerrainSurfaceUpload,
} from "./terrain-system";
import {
	terrainTextureKeysFromFacts,
	type OceanBackdropDrawUnit,
	type TerrainPresentationSource,
	type TerrainTextureKeys,
} from "./types";

/** Authored WaterDeepSea terrain code; boundary survey resolves height index zero to sea level zero. */
export const OCEAN_TERRAIN_CODE = 20;
/** AC sea-surface elevation measured in the installed archive's boundary terrain. */
export const OCEAN_HEIGHT = 0;
const OWNER = "ocean-backdrop";
const GEOMETRY = createTerrainGeometryKey(OWNER);
const SURFACE = createTerrainSurfaceTextureKey(OWNER);
/** Shared local bounds for frustum selection of the reusable ocean tile. */
export const OCEAN_BACKDROP_BOUNDS = new AABB3(
	new Vec3(0, OCEAN_HEIGHT, -OUTDOOR_LANDBLOCK_WORLD_SIZE),
	new Vec3(OUTDOOR_LANDBLOCK_WORLD_SIZE, OCEAN_HEIGHT, 0),
);

/** Cover only the out-of-bounds portion of the same square window used by authored terrain. */
export function oceanBackdropCoordinates(
	anchor: LandblockCoordinates,
	radius: number,
): readonly LandblockCoordinates[] {
	const coordinates: LandblockCoordinates[] = [];
	for (let y = anchor.y - radius; y <= anchor.y + radius; y += 1) {
		for (let x = anchor.x - radius; x <= anchor.x + radius; x += 1) {
			if (!isOutdoorLandblock(x, y)) coordinates.push({ x, y });
		}
	}
	return coordinates;
}

/** One reusable landblock-sized surface; placement supplies the unbounded grid coordinates. */
export function createOceanBackdropGeometry(): TerrainGeometryData {
	const size = OUTDOOR_LANDBLOCK_WORLD_SIZE;
	return {
		kind: "terrain",
		positions: new Float32Array([
			0,
			OCEAN_HEIGHT,
			0,
			size,
			OCEAN_HEIGHT,
			0,
			0,
			OCEAN_HEIGHT,
			-size,
			size,
			OCEAN_HEIGHT,
			-size,
		]),
		normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
		textureCoordinates: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
		terrainColorCodes: new Uint8Array(4).fill(OCEAN_TERRAIN_CODE),
		indices: new Uint16Array([0, 1, 3, 0, 3, 2]),
	};
}

/** Resource realization and retirement are mutually exclusive states of the single ocean lease. */
type OceanResourceState =
	| { readonly kind: "uninstalled" | "loading" | "ready" | "destroyed" }
	| { readonly kind: "failed"; readonly error: Error };

/**
 * Presentation-only ocean tiles sharing one resource lease, never entering authored terrain queries.
 * RETAIL DIVERGENCE: Retail leaves out-of-bounds slots empty (acclient.c:296873-296881). This intentional visual
 * enhancement fills them with ocean; removing it exposes the world edge again. A local archive
 * census covered all 1,016 perimeter landblocks; all 255 eastern blocks were flat at height zero.
 * Authored placements remain bounded (acclient.c:117515); the extension owns no game-world
 * surface or entity state. Seam matching is intentionally outside this backdrop's scope.
 */
export class OceanBackdrop {
	readonly #geometry: GeometryManager<ResourceOwnerId>;
	readonly #textures: TextureManager<ResourceOwnerId>;
	#presentation: TerrainPresentationSource | null = null;
	#coordinates: readonly LandblockCoordinates[] = [];
	#drawUnits: readonly OceanBackdropDrawUnit[] = [];
	#state: OceanResourceState = { kind: "uninstalled" };

	constructor(
		geometry: GeometryManager<ResourceOwnerId>,
		textures: TextureManager<ResourceOwnerId>,
	) {
		this.#geometry = geometry;
		this.#textures = textures;
	}

	/** Coverage follows scene interest, including clearing on dungeon transitions. */
	setInterest(request: SceneInterestRequest | null): void {
		this.#coordinates =
			request?.target.kind === "outdoor"
				? oceanBackdropCoordinates(
						getLandblockCoordinates(request.target.requested.landblockId),
						request.radii.terrainRadius,
					)
				: [];
		this.#update();
	}

	/** Reuse the region contract already resolved for authored terrain. */
	setPresentation(presentation: TerrainPresentationSource): void {
		if (this.#presentation !== null) {
			if (
				this.#presentation.composition.activeRegionKey !==
				presentation.composition.activeRegionKey
			)
				throw new Error("Ocean backdrop cannot mix active regions.");
			return;
		}
		this.#presentation = presentation;
		this.#update();
	}

	/** Stable inputs reused until the scene-interest window changes. */
	readDrawUnits(): readonly OceanBackdropDrawUnit[] {
		if (this.#state.kind === "failed") throw this.#state.error;
		return this.#state.kind === "ready" ? this.#drawUnits : [];
	}

	/** Release the single backdrop lease with the owning presentation runtime. */
	destroy(): void {
		if (this.#state.kind === "destroyed") return;
		this.#state = { kind: "destroyed" };
		this.#drawUnits = [];
		this.#textures.dropOwner(OWNER);
		this.#geometry.dropOwner(OWNER);
	}

	#update(): void {
		const presentation = this.#presentation;
		if (
			this.#state.kind === "destroyed" ||
			presentation === null ||
			this.#coordinates.length === 0
		) {
			this.#drawUnits = [];
			return;
		}
		const composition = createTerrainCompositionTextureKey(
			presentation.composition.activeRegionKey,
		);
		const textures = terrainTextureKeysFromFacts(presentation.textures);
		this.#drawUnits = this.#coordinates.map((coordinates) => ({
			kind: "ocean",
			coordinates,
			geometry: GEOMETRY,
			surfaceField: SURFACE,
			composition,
			textures,
		}));
		if (this.#state.kind !== "uninstalled") return;
		this.#state = { kind: "loading" };
		void this.#install(presentation, composition, textures)
			.then(() => {
				if (this.#state.kind !== "destroyed") this.#state = { kind: "ready" };
			})
			.catch((error: unknown) => {
				if (this.#state.kind === "destroyed") return;
				this.#textures.dropOwner(OWNER);
				this.#geometry.dropOwner(OWNER);
				this.#state = {
					kind: "failed",
					error: error instanceof Error ? error : new Error(String(error)),
				};
			});
	}

	/** Publish one shared surface and await its regional material, with rollback owned by the caller. */
	async #install(
		presentation: TerrainPresentationSource,
		composition: TerrainCompositionTextureKey,
		textures: TerrainTextureKeys,
	): Promise<void> {
		this.#geometry.reserveKeys(OWNER, [GEOMETRY]);
		this.#textures.reserveKeys(OWNER, [SURFACE, composition]);
		this.#geometry.upsertGeometry({
			key: GEOMETRY,
			geometry: createOceanBackdropGeometry(),
		});
		// Authored samples place the terrain code above the two road bits; ocean has no roads.
		const sample = OCEAN_TERRAIN_CODE << 2;
		const pcode = packTerrainPcode([sample, sample, sample, sample]);
		this.#textures.upsertGeneratedTextures([
			{
				key: composition,
				upload: createTerrainCompositionUpload(presentation.compositionTable),
			},
			{
				key: SURFACE,
				upload: createTerrainSurfaceUpload({
					width: OUTDOOR_TERRAIN_GRID_CELLS,
					height: OUTDOOR_TERRAIN_GRID_CELLS,
					cellPcodes: new Uint32Array(OUTDOOR_TERRAIN_GRID_CELLS ** 2).fill(
						pcode,
					),
				}),
			},
		]);
		await this.#textures.retain(OWNER, Object.values(presentation.textures));
		if (this.#state.kind === "destroyed") return;
		if (!Object.values(textures).every((key) => this.#textures.hasTexture(key)))
			throw new Error("Ocean backdrop material failed to become resident.");
	}
}
