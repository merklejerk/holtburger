import { INVALID_ID, type EnvCellId, type LandblockId } from "../game-types";
import type { Renderer } from "../renderer/renderer";
import type {
	AABB2,
	AABB3,
	ColorF,
	ColorTextureKeyVariant,
	Mat4,
	OwnerId,
	TextureAtlasPageId,
	TextureKey,
	TexturePixelFormat,
	TexturePurpose,
} from "./types";

interface LoDConfig {
	landblockRadius: number;
	buildingRadius: number;
	explicitObjectRadius: number;
	generatedObjectRadius: number;
	envCellRadius: number;
}

const DEFAULT_LOD_CONFIG: LoDConfig = {
	landblockRadius: 4,
	buildingRadius: 3,
	explicitObjectRadius: 1,
	generatedObjectRadius: 1,
	envCellRadius: 1,
};

function validateLoDConfigOrThrow(cfg: LoDConfig): void {
	const { landblockRadius } = cfg;
	if (
		landblockRadius <= 0 ||
		cfg.buildingRadius > landblockRadius ||
		cfg.explicitObjectRadius > landblockRadius ||
		cfg.generatedObjectRadius > landblockRadius ||
		cfg.envCellRadius > landblockRadius
	) {
		throw new Error("Invalid scene config.");
	}
}

export interface GameScene {}

export interface CommitPipeline {}

export enum CommitArtifactKind {
	UpsertAtlasPage,
	EvictAtlasPage,
	CommitName,
}

export enum StaticLandblockLayerKind {
	Terrain,
	Buildings,
	Objects,
	Generated,
	EnvCells,
}

export interface StaticTerrainChunkData {
	points: Float32Array;
	roadMaskTexture: TextureKey;
	colorTextures: TextureKey[];
	detailTexture: TextureKey;
	bounds: AABB3;
}

export interface StaticLandblockLayerCommitTerrain {
	chunks: StaticTerrainChunkData[];
}

export interface StaticDrawUnitData {
	indexStart: number;
	indexEnd: number;
	color: ColorF;
	colorTexture: ColorTextureKeyVariant;
	detailTexture: TextureKey | null;
}

export interface BakedStaticDrawUnitsData {
	vertexData: Float32Array;
	indexData: Uint32Array;
	drawUnits: StaticDrawUnitData[];
}

export interface StaticInstancePatchData {
	indexStart: number;
	indexEnd: number;
	colorTexture: ColorTextureKeyVariant;
	detailTexture: TextureKey | null;
	instanceData: Array<{
		transform: Mat4;
		color: ColorF;
	}>;
}

export interface InstancedStaticData {
	verexData: Float32Array;
	indexData: Uint32Array;
	patches: StaticInstancePatchData;
}

export interface EnvCellInfo {
	id: EnvCellId;
	bounds: AABB3;
	bsp: unknown;
}

export interface EnvCellPortals {
	inPortalIdxs: number[];
	outPortalIdxs: number[];
}

export enum EnvCellPortalKind {
	OutdoorToIndoor,
	IndoorToOutdoor,
	IndoorToIndoor,
}

interface EnvCellPortalInfo {
	kind: EnvCellPortalKind;
	bounds: AABB3;
}

export type StaticLandblockLayerCommitBuildings = BakedStaticDrawUnitsData;
export type StaticLandblockLayerCommitObjects = BakedStaticDrawUnitsData;
export type StaticLandblockLayerCommitGenerated = InstancedStaticData;
export interface StaticLandblockLayerCommitEnvCells {
	cells: EnvCellInfo[];
	// Keyed by cells index.
	cellPortals: EnvCellPortals[];
	// Keyed by cells index.
	cellDrawUnits: BakedStaticDrawUnitsData[];
	portals: EnvCellPortalInfo[];
	portalsVertexData: Float32Array;
	portalsIndexData: Uint32Array;
	portalsDrawRangesByKind: {
		[k in keyof EnvCellPortalKind]?: {
			indexStart: number;
			indexEnd: number;
		};
	};
}

export interface TextureAtlasPageCommit {
	pageId: TextureAtlasPageId;
	width: number;
	height: number;
	format: TexturePixelFormat;
	purpose: TexturePurpose;
	pageBits: Uint8Array;
	textures: Array<{ key: TextureKey; bounds: AABB2; owners: Set<OwnerId> }>;
}

export interface CommitBundle {
	atlasPages: TextureAtlasPageCommit[];
	staticCommitsByLayer: {
		[StaticLandblockLayerKind.Terrain]?: StaticLandblockLayerCommitTerrain;
		[StaticLandblockLayerKind.Buildings]?: StaticLandblockLayerCommitBuildings;
		[StaticLandblockLayerKind.Objects]?: StaticLandblockLayerCommitObjects;
		[StaticLandblockLayerKind.Generated]?: StaticLandblockLayerCommitGenerated;
		[StaticLandblockLayerKind.EnvCells]?: StaticLandblockLayerCommitEnvCells;
	} | null;
}

export class GameRuntime {
	readonly #scene: GameScene = new GameScene();
	#lodConfig: LoDConfig = DEFAULT_LOD_CONFIG;
	#worldAnchor: LandblockId = INVALID_ID;
	#commitArtifacts: CommitBundle[] = [];

	protected constructor(
		private readonly renderer: Renderer,
		private readonly commitPipeline: CommitPipeline,
	) {}

	public static build(
		renderer: Renderer,
		CommitPipeline: CommitPipeline,
	): GameRuntime {
		return new GameRuntime(renderer, CommitPipeline);
	}

	public setLoDConfig(cfg: LoDConfig): void {
		validateLoDConfigOrThrow(cfg);
		Object.assign(this.#lodConfig, cfg);
		this.#updateWorldInterest(this.#worldAnchor);
		// ...
	}

	public setWorldAnchor(landblockId: LandblockId) {
		if (this.#worldAnchor === landblockId) return;
		this.#updateWorldInterest(landblockId);
		this.#worldAnchor = landblockId;
	}

	public tick(): void {
		// Reserved for simulation stepping and deterministic state updates.
		// Keep no-op for now while frame rendering is the only active path.
		// TODO: drain commit artifacts.
	}

	public updateFrame(): void {
		this.renderer.drawFrame();
	}

	public destroy(): void {
		this.renderer.destroy();
	}

	#updateWorldInterest(newAnchor: LandblockId) {
		const interest = computeNewWorldInterest(newAnchor, this.#lodConfig);
		const [newLayers, evictedLayers] = diffInterest(
			// Maybe scene doesn't need to track layers, just owners?
			// Or we have a dedicated ownership system?
			this.#scene.getLandblockLayers(),
			interest,
		);
		for (const layer of evictedLayers) {
			this.#scene.tearDownLandblockLayer(layer);
			this.#texturePages.releaseByOwner(landblockLayerToOwnerKey(layer));
		}
		(async () => {
			this.#commitArtifacts.push(
				await this.commitPipeline.prepareLandblockLayers(newLayers),
			);
		})();
	}
}
