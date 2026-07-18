import { log, LogLevel } from "../../logs";
import type { LandblockId } from "../game-types";
import { IntegerTexture2DFormat } from "../renderer/resource-manager";
import type {
	RendererResourceManager,
	RenderResourceKey,
	Texture2DResourceKey,
	Texture2DUpload,
} from "../renderer/resource-manager";
import {
	compileTerrainCompositionTable,
	TERRAIN_COMPOSITION_TABLE_HEIGHT,
	type TerrainCompositionTable,
} from "./composition-table";
import type { TerrainGenerator } from "./terrain-generator";
import {
	selectTerrainMeshStride,
	selectTerrainTransitionDirection,
	terrainTextureKeysFromFacts,
	type RealizedTerrainResources,
	type TerrainDrawResources,
	type TerrainGenerationResult,
	type TerrainMeshStride,
	type TerrainSourceInstallation,
} from "./types";

const TERRAIN_MESH_STRIDES: readonly TerrainMeshStride[] = [1, 2, 4, 8];
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

interface LoadingTerrainInstallation {
	readonly kind: "loading";
	readonly input: TerrainSourceInstallation;
	readonly composition: Texture2DResourceKey;
}

interface FailedTerrainInstallation {
	readonly kind: "failed";
	readonly input: TerrainSourceInstallation;
	readonly composition: Texture2DResourceKey;
}

interface RealizedTerrainInstallation {
	readonly kind: "realized";
	readonly input: TerrainSourceInstallation;
	readonly composition: Texture2DResourceKey;
	readonly resources: RealizedTerrainResources;
}

type TerrainInstallation =
	| LoadingTerrainInstallation
	| FailedTerrainInstallation
	| RealizedTerrainInstallation;

interface RetainedTerrainComposition {
	readonly key: Texture2DResourceKey;
	readonly referenceCount: number;
}

/** Owns terrain generation state, generated device allocations, and frame-time variant selection. */
export class TerrainService {
	readonly #generator: TerrainGenerator;
	readonly #renderResources: RendererResourceManager;
	readonly #installations = new Map<LandblockId, TerrainInstallation>();
	readonly #compositions = new Map<number, RetainedTerrainComposition>();
	#destroyed = false;

	constructor(
		generator: TerrainGenerator,
		renderResources: RendererResourceManager,
	) {
		this.#generator = generator;
		this.#renderResources = renderResources;
	}

	/** Retain a newly interested source and start exactly one generation operation. */
	installSource(input: TerrainSourceInstallation): void {
		if (this.#destroyed) {
			throw new Error(
				"Cannot install terrain after TerrainService is destroyed.",
			);
		}
		if (this.#installations.has(input.landblockId)) return;

		const installation: LoadingTerrainInstallation = {
			composition: this.#retainComposition(input),
			input,
			kind: "loading",
		};
		this.#installations.set(input.landblockId, installation);
		void this.#generateAndRealize(input.landblockId, installation);
	}

	/** Drop one installation and release every generated device resource it owns. */
	removeSource(landblockId: LandblockId): void {
		const installation = this.#installations.get(landblockId);
		if (!installation) return;
		this.#installations.delete(landblockId);
		if (installation.kind === "realized") {
			this.#releaseRealizedResources(installation.resources);
		}
		this.#releaseComposition(installation.input, installation.composition);
	}

	/** Select already-realized terrain resources for one visible landblock. */
	getDrawResources(
		landblockId: LandblockId,
		anchorLandblockId: LandblockId,
	): TerrainDrawResources | null {
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
		const surfaceField = installation.resources.surfaceFields.get(stride);
		if (!surfaceField) {
			throw new Error(
				`Terrain ${landblockId} is missing stride ${stride} surface data.`,
			);
		}
		return {
			composition: installation.composition,
			geometry: installation.resources.geometry,
			indexCount: variant.indexCount,
			indexStart: variant.indexStart,
			surfaceField,
			textures: terrainTextureKeysFromFacts(
				installation.input.presentation.textures,
			),
		};
	}

	/** Release retained device allocations and reject all later worker completions. */
	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const installation of this.#installations.values()) {
			if (installation.kind === "realized") {
				this.#releaseRealizedResources(installation.resources);
			}
		}
		this.#installations.clear();
		for (const composition of this.#compositions.values()) {
			if (!this.#renderResources.releaseResource(composition.key)) {
				throw new Error(
					`Terrain composition resource ${composition.key} disappeared before destroy.`,
				);
			}
		}
		this.#compositions.clear();
	}

	async #generateAndRealize(
		landblockId: LandblockId,
		installation: LoadingTerrainInstallation,
	): Promise<void> {
		try {
			const result = await this.#generator.generate(
				installation.input.generation,
			);
			if (this.#installations.get(landblockId) !== installation) return;
			const resources = this.#realizeResult(result);
			if (this.#installations.get(landblockId) !== installation) {
				this.#releaseRealizedResources(resources);
				return;
			}
			this.#installations.set(landblockId, {
				composition: installation.composition,
				input: installation.input,
				kind: "realized",
				resources,
			});
		} catch (error) {
			if (this.#installations.get(landblockId) !== installation) return;
			this.#installations.set(landblockId, {
				composition: installation.composition,
				input: installation.input,
				kind: "failed",
			});
			log(error, LogLevel.Error);
		}
	}

	#realizeResult(result: TerrainGenerationResult): RealizedTerrainResources {
		validateTerrainGenerationResult(result);
		const allocated: RenderResourceKey[] = [];
		try {
			const geometry = this.#renderResources.createGeometry(result.geometry);
			allocated.push(geometry);
			const surfaceFields = new Map<TerrainMeshStride, Texture2DResourceKey>();
			for (const field of result.surfaceFields) {
				const key = this.#renderResources.createTexture2D(
					createTerrainSurfaceUpload(field),
				);
				allocated.push(key);
				surfaceFields.set(field.stride, key);
			}
			return {
				geometry,
				surfaceFields,
				variants: result.variants,
			};
		} catch (error) {
			for (const key of allocated.reverse()) {
				if (!this.#renderResources.releaseResource(key)) {
					throw new Error(`Terrain realization lost partial resource ${key}.`, {
						cause: error,
					});
				}
			}
			throw error;
		}
	}

	#releaseRealizedResources(resources: RealizedTerrainResources): void {
		for (const key of [
			resources.geometry,
			...resources.surfaceFields.values(),
		]) {
			if (!this.#renderResources.releaseResource(key)) {
				throw new Error(`Terrain resource ${key} disappeared before release.`);
			}
		}
	}

	#retainComposition(input: TerrainSourceInstallation): Texture2DResourceKey {
		const regionNumber = input.presentation.composition.regionNumber;
		const retained = this.#compositions.get(regionNumber);
		if (retained) {
			this.#compositions.set(regionNumber, {
				key: retained.key,
				referenceCount: retained.referenceCount + 1,
			});
			return retained.key;
		}
		const table = compileTerrainCompositionTable(
			input.presentation.composition,
			input.presentation.textures,
		);
		const key = this.#renderResources.createTexture2D(
			createTerrainCompositionUpload(table),
		);
		this.#compositions.set(regionNumber, { key, referenceCount: 1 });
		return key;
	}

	#releaseComposition(
		input: TerrainSourceInstallation,
		key: Texture2DResourceKey,
	): void {
		const regionNumber = input.presentation.composition.regionNumber;
		const retained = this.#compositions.get(regionNumber);
		if (!retained || retained.key !== key) {
			throw new Error(
				`Terrain region ${regionNumber} lost composition resource ${key}.`,
			);
		}
		if (retained.referenceCount > 1) {
			this.#compositions.set(regionNumber, {
				key,
				referenceCount: retained.referenceCount - 1,
			});
			return;
		}
		this.#compositions.delete(regionNumber);
		if (!this.#renderResources.releaseResource(key)) {
			throw new Error(
				`Terrain composition resource ${key} disappeared before release.`,
			);
		}
	}
}

function validateTerrainGenerationResult(
	result: TerrainGenerationResult,
): void {
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
