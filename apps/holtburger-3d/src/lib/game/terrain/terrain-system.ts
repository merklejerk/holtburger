import { log, LogLevel } from "../../logs";
import type { LandblockId } from "../game-types";
import type { AABB3 } from "../math/types";
import type { Vec3 } from "../math/types";
import {
	createLandblockWorldOrigin,
	landblockAtWorldPoint,
} from "../landblocks";
import type { SceneGraph, SceneNodeId, ScenePlacement } from "../scene";
import type { GeometryManager } from "../geometry/geometry-manager";
import {
	createTerrainGeometryKey,
	type TerrainGeometryKey,
} from "../geometry/types";
import { IntegerTexture2DFormat } from "../renderer/resource-manager";
import type { Texture2DUpload } from "../renderer/resource-manager";
import type {
	GeneratedTextureSource,
	TextureManager,
} from "../textures/texture-manager";
import {
	compileTerrainCompositionTable,
	TERRAIN_COMPOSITION_TABLE_HEIGHT,
	type TerrainCompositionTable,
} from "./composition-table";
import type { TerrainGenerator } from "./terrain-generator";
import {
	sampleTerrainSurface,
	type TerrainSurfaceSample,
} from "./terrain-surface";
import {
	selectTerrainMeshStride,
	selectTerrainTransitionDirection,
	terrainGeneratedTextureKeys,
	terrainTextureKeysFromFacts,
	type RealizedTerrainResources,
	type TerrainDrawUnit,
	type TerrainGeneratedTextureKeys,
	type TerrainGenerationResult,
	type TerrainSourceInstallation,
	TERRAIN_MESH_STRIDES,
} from "./types";

const TERRAIN_TRANSITION_DIRECTIONS = [
	"viewer-block",
	"north",
	"northeast",
	"east",
	"southeast",
	"south",
	"southwest",
	"west",
	"northwest",
] as const;

/** One resolved terrain source and every stable resource identity it owns. */
interface ResolvedTerrainSource<TOwnerId extends string> {
	/** Runtime layer owner retaining this source's geometry and textures. */
	readonly owner: TOwnerId;
	readonly input: TerrainSourceInstallation;
	readonly geometry: TerrainGeometryKey;
	readonly generatedTextures: TerrainGeneratedTextureKeys;
}

interface LoadingTerrainInstallation<TOwnerId extends string> {
	readonly kind: "loading";
	readonly source: ResolvedTerrainSource<TOwnerId>;
}

interface FailedTerrainInstallation<TOwnerId extends string> {
	readonly kind: "failed";
	readonly source: ResolvedTerrainSource<TOwnerId>;
}

interface RealizedTerrainInstallation<TOwnerId extends string> {
	readonly kind: "realized";
	readonly source: ResolvedTerrainSource<TOwnerId>;
	readonly resources: RealizedTerrainResources;
}

type TerrainInstallation<TOwnerId extends string> =
	| LoadingTerrainInstallation<TOwnerId>
	| FailedTerrainInstallation<TOwnerId>
	| RealizedTerrainInstallation<TOwnerId>;

/** Complete source and spatial publication for one interested terrain layer. */
export interface TerrainSystemArtifact {
	readonly placement: ScenePlacement;
	/** Landblock-local bounds paired with terrain's identity root transform. */
	readonly localBounds: AABB3;
	readonly source: TerrainSourceInstallation;
}

/** Owns terrain generation state, generated geometry, and frame-time variant selection. */
export class TerrainSystem<
	TManagerOwnerId extends string = string,
	TOwnerId extends TManagerOwnerId = TManagerOwnerId,
> {
	readonly #generator: TerrainGenerator;
	readonly #geometry: GeometryManager<TManagerOwnerId>;
	readonly #textures: TextureManager<TManagerOwnerId>;
	/** Creates a private geometry/texture lease owner for each installed source. */
	readonly #ownerForLandblock: (landblockId: LandblockId) => TOwnerId;
	readonly #scene: SceneGraph;
	readonly #nodes = new Map<TOwnerId, SceneNodeId>();
	readonly #nodeLandblocks = new Map<SceneNodeId, LandblockId>();
	readonly #installations = new Map<
		LandblockId,
		TerrainInstallation<TOwnerId>
	>();
	#destroyed = false;

	constructor(
		scene: SceneGraph,
		generator: TerrainGenerator,
		geometry: GeometryManager<TManagerOwnerId>,
		textures: TextureManager<TManagerOwnerId>,
		ownerForLandblock: (landblockId: LandblockId) => TOwnerId,
	) {
		this.#scene = scene;
		this.#generator = generator;
		this.#geometry = geometry;
		this.#textures = textures;
		this.#ownerForLandblock = ownerForLandblock;
	}

	/** Install one terrain source and its stable scene attachment. */
	install(ownerId: TOwnerId, artifact: TerrainSystemArtifact): SceneNodeId {
		const existing = this.#nodes.get(ownerId);
		if (existing) return existing;
		this.removeOwner(ownerId);
		this.#installSource(artifact.source);
		const nodeId = this.#scene.createNode({
			...artifact.placement,
			localBounds: artifact.localBounds,
			parentId: null,
		});
		this.#nodes.set(ownerId, nodeId);
		this.#nodeLandblocks.set(nodeId, artifact.source.landblockId);
		return nodeId;
	}

	/** Drop one installation, including its owned node and retained source resources. */
	removeOwner(ownerId: TOwnerId): void {
		const nodeId = this.#nodes.get(ownerId);
		if (!nodeId) return;
		const landblockId = this.#nodeLandblocks.get(nodeId);
		if (!landblockId)
			throw new Error(`Terrain node ${nodeId} has no landblock.`);
		this.#scene.destroyNode(nodeId);
		this.#nodes.delete(ownerId);
		this.#nodeLandblocks.delete(nodeId);
		this.#removeSource(landblockId);
	}

	/** Reserve a newly interested source's resources and start one generation operation. */
	#installSource(input: TerrainSourceInstallation): void {
		if (this.#destroyed) {
			throw new Error(
				"Cannot install terrain after TerrainSystem is destroyed.",
			);
		}
		if (this.#installations.has(input.landblockId)) return;

		const source = this.#resolveSource(input);
		this.#reserveSourceResources(source);
		try {
			this.#publishComposition(source);
		} catch (error) {
			this.#releaseSourceResources(source);
			throw error;
		}
		const installation: LoadingTerrainInstallation<TOwnerId> = {
			kind: "loading",
			source,
		};
		this.#installations.set(input.landblockId, installation);
		void this.#generateAndRealize(input.landblockId, installation);
	}

	/** Drop one terrain source and release resources retained by its layer owner. */
	#removeSource(landblockId: LandblockId): void {
		const installation = this.#installations.get(landblockId);
		if (!installation) return;
		this.#installations.delete(landblockId);
		this.#releaseSourceResources(installation.source);
	}

	/** Select one already-realized terrain draw unit for a visible landblock. */
	getDrawUnit(
		nodeId: SceneNodeId,
		anchorLandblockId: LandblockId,
	): TerrainDrawUnit | null {
		const landblockId = this.#nodeLandblocks.get(nodeId);
		if (!landblockId) return null;
		const installation = this.#installations.get(landblockId);
		if (!installation || installation.kind !== "realized") return null;

		const stride = selectTerrainMeshStride(landblockId, anchorLandblockId);
		const transitionDirection = selectTerrainTransitionDirection(
			landblockId,
			anchorLandblockId,
		);
		const variant = installation.resources.variants.find(
			(candidate) =>
				candidate.variant.stride === stride &&
				candidate.variant.transitionDirection === transitionDirection,
		);
		if (!variant) {
			throw new Error(
				`Terrain ${landblockId} is missing ${stride}/${transitionDirection} geometry.`,
			);
		}
		const surfaceField =
			installation.source.generatedTextures.surfaceFields.get(stride);
		if (!surfaceField) {
			throw new Error(
				`Terrain ${landblockId} is missing stride ${stride} surface data.`,
			);
		}
		const drawUnit: TerrainDrawUnit = {
			composition: installation.source.generatedTextures.composition,
			geometry: installation.source.geometry,
			indexCount: variant.indexCount,
			indexStart: variant.indexStart,
			landblockId,
			surfaceField,
			textures: terrainTextureKeysFromFacts(
				installation.source.input.presentation.textures,
			),
		};
		return this.#hasDrawUnit(drawUnit) ? drawUnit : null;
	}

	/** Sample source-proven terrain height without waiting for generated GPU resources. */
	querySurfaceAtWorldPoint(point: Vec3): TerrainSurfaceSample | null {
		const landblockId = landblockAtWorldPoint(point);
		if (!landblockId) return null;
		const installation = this.#installations.get(landblockId);
		if (!installation) return null;
		const origin = createLandblockWorldOrigin(landblockId);
		return sampleTerrainSurface(
			installation.source.input.generation,
			point.x - origin.x,
			point.z - origin.z,
		);
	}

	/** Reject all later worker completions and clear terrain source state. */
	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const ownerId of [...this.#nodes.keys()]) this.removeOwner(ownerId);
		for (const installation of this.#installations.values())
			this.#releaseSourceResources(installation.source);
		this.#installations.clear();
		this.#nodes.clear();
		this.#nodeLandblocks.clear();
	}

	async #generateAndRealize(
		landblockId: LandblockId,
		installation: LoadingTerrainInstallation<TOwnerId>,
	): Promise<void> {
		try {
			const result = await this.#generator.generate(
				installation.source.input.generation,
			);
			if (this.#installations.get(landblockId) !== installation) return;
			const resources = this.#realizeResult(installation.source, result);
			if (this.#installations.get(landblockId) !== installation) return;
			this.#installations.set(landblockId, {
				kind: "realized",
				source: installation.source,
				resources,
			});
		} catch (error) {
			if (this.#installations.get(landblockId) !== installation) return;
			// Geometry publication precedes the generated surface fields. Release the whole source owner
			// on any failure so a failed installation cannot retain a partial device realization.
			this.#releaseSourceResources(installation.source);
			this.#installations.set(landblockId, {
				kind: "failed",
				source: installation.source,
			});
			log(error, LogLevel.Error);
		}
	}

	#realizeResult(
		source: ResolvedTerrainSource<TOwnerId>,
		result: TerrainGenerationResult,
	): RealizedTerrainResources {
		validateTerrainGenerationResult(result);
		this.#geometry.upsertGeometry({
			geometry: result.geometry,
			key: source.geometry,
		});
		this.#textures.upsertGeneratedTextures(
			result.surfaceFields.map((field) => {
				const key = source.generatedTextures.surfaceFields.get(field.stride);
				if (!key) {
					throw new Error(
						`Terrain ${source.input.landblockId} has no generated texture key for stride ${field.stride}.`,
					);
				}
				return { key, upload: createTerrainSurfaceUpload(field) };
			}),
		);
		return {
			variants: result.variants,
		};
	}

	#publishComposition(source: ResolvedTerrainSource<TOwnerId>): void {
		const table = compileTerrainCompositionTable(
			source.input.presentation.composition,
			source.input.presentation.textures,
		);
		const composition: GeneratedTextureSource = {
			key: source.generatedTextures.composition,
			upload: createTerrainCompositionUpload(table),
		};
		this.#textures.upsertGeneratedTextures([composition]);
	}

	#resolveSource(
		input: TerrainSourceInstallation,
	): ResolvedTerrainSource<TOwnerId> {
		return {
			generatedTextures: terrainGeneratedTextureKeys(
				input.landblockId,
				input.presentation,
			),
			geometry: createTerrainGeometryKey(input.landblockId),
			input,
			owner: this.#ownerForLandblock(input.landblockId),
		};
	}

	#reserveSourceResources(source: ResolvedTerrainSource<TOwnerId>): void {
		this.#geometry.reserveKeys(source.owner, [source.geometry]);
		this.#textures.reserveKeys(source.owner, [
			source.generatedTextures.composition,
			...source.generatedTextures.surfaceFields.values(),
		]);
		void this.#textures.retain(
			source.owner,
			Object.values(source.input.presentation.textures),
		);
	}

	#releaseSourceResources(source: ResolvedTerrainSource<TOwnerId>): void {
		this.#textures.dropOwner(source.owner);
		this.#geometry.dropOwner(source.owner);
	}

	#hasDrawUnit(drawUnit: TerrainDrawUnit): boolean {
		return (
			this.#geometry.hasGeometry(drawUnit.geometry) &&
			this.#textures.hasTexture(drawUnit.surfaceField) &&
			this.#textures.hasTexture(drawUnit.composition) &&
			Object.values(drawUnit.textures).every((key) =>
				this.#textures.hasTexture(key),
			)
		);
	}
}

function validateTerrainGenerationResult(
	result: TerrainGenerationResult,
): void {
	const vertexCount = result.geometry.positions.length / 3;
	if (
		!Number.isInteger(vertexCount) ||
		result.geometry.normals.length !== result.geometry.positions.length ||
		result.geometry.textureCoordinates.length !== vertexCount * 2
	) {
		throw new Error(
			"Terrain generation geometry has incompatible attribute lengths.",
		);
	}
	if (
		[...result.geometry.positions, ...result.geometry.normals].some(
			(value) => !Number.isFinite(value),
		) ||
		[...result.geometry.textureCoordinates].some(
			(value) => !Number.isFinite(value),
		) ||
		[...result.geometry.indices].some((index) => index >= vertexCount)
	) {
		throw new Error(
			"Terrain generation geometry contains invalid attribute or index values.",
		);
	}
	const ranges = [...result.variants]
		.map(({ indexCount, indexStart }) => ({ indexCount, indexStart }))
		.sort((left, right) => left.indexStart - right.indexStart);
	for (let index = 0; index < ranges.length; index += 1) {
		const range = ranges[index];
		const previous = ranges[index - 1];
		if (
			!Number.isInteger(range.indexStart) ||
			!Number.isInteger(range.indexCount) ||
			range.indexStart < 0 ||
			range.indexCount <= 0 ||
			range.indexStart + range.indexCount > result.geometry.indices.length ||
			(previous !== undefined &&
				previous.indexStart + previous.indexCount > range.indexStart)
		) {
			throw new Error(
				"Terrain generation contains overlapping or out-of-bounds draw ranges.",
			);
		}
	}
	const strides = new Set(result.surfaceFields.map(({ stride }) => stride));
	if (
		strides.size !== result.surfaceFields.length ||
		strides.size !== TERRAIN_MESH_STRIDES.length ||
		TERRAIN_MESH_STRIDES.some((stride) => !strides.has(stride))
	) {
		throw new Error(
			"Terrain generation must return one surface field for every stride.",
		);
	}
	for (const field of result.surfaceFields) {
		const expectedDimension = 8 / field.stride;
		if (
			field.width !== expectedDimension ||
			field.height !== expectedDimension ||
			field.cellPcodes.length !== field.width * field.height
		) {
			throw new Error(
				`Terrain stride ${field.stride} surface field does not match its generated cell grid.`,
			);
		}
	}
	const expectedVariants = new Set(
		TERRAIN_MESH_STRIDES.flatMap((stride) =>
			TERRAIN_TRANSITION_DIRECTIONS.map(
				(direction) => `${stride}/${direction}`,
			),
		),
	);
	const returnedVariants = new Set(
		result.variants.map(
			({ variant }) => `${variant.stride}/${variant.transitionDirection}`,
		),
	);
	if (
		returnedVariants.size !== result.variants.length ||
		returnedVariants.size !== expectedVariants.size ||
		[...expectedVariants].some((variant) => !returnedVariants.has(variant))
	) {
		throw new Error(
			"Terrain generation must return every stride and transition-direction variant.",
		);
	}
	for (const variant of result.variants) {
		if (!strides.has(variant.variant.stride)) {
			throw new Error(
				`Terrain variant ${variant.variant.stride}/${variant.variant.transitionDirection} has no surface field.`,
			);
		}
	}
}

function createTerrainSurfaceUpload(
	field: TerrainGenerationResult["surfaceFields"][number],
): Texture2DUpload {
	return {
		data: field.cellPcodes,
		format: IntegerTexture2DFormat.R32UI,
		height: field.height,
		mipLevels: 1,
		width: field.width,
	};
}

function createTerrainCompositionUpload(
	table: TerrainCompositionTable,
): Texture2DUpload {
	if (!Number.isInteger(table.width) || table.width <= 0) {
		throw new Error(
			"Terrain composition table width must be a positive integer.",
		);
	}
	const expectedTexels = table.width * TERRAIN_COMPOSITION_TABLE_HEIGHT * 4;
	if (table.texels.length !== expectedTexels) {
		throw new Error(
			`Terrain composition table contains ${table.texels.length} values; expected ${expectedTexels}.`,
		);
	}
	return {
		data: table.texels,
		format: IntegerTexture2DFormat.RGBA32UI,
		height: TERRAIN_COMPOSITION_TABLE_HEIGHT,
		mipLevels: 1,
		width: table.width,
	};
}
