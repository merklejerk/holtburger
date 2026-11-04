import type {
	CommitPipeline,
	LandblockLayerCommit,
} from "../../lib/game/commit/types";
import type { StandardCommitPipeline } from "../../lib/game/commit/pipeline";
import type { LandblockOwnerId } from "../../lib/game/game-types";
import { createTranslationMat4 } from "../../lib/game/math/matrices";
import { AABB3, Mat4, Vec3 } from "../../lib/game/math/types";
import type {
	ResolvedObjectResident,
	ResolvedOutdoorStaticLayerSource,
} from "../../lib/game/resolution/landblock-layer";
import type {
	ResolvedGeometry,
	ResolvedMaterial,
	ResolvedObjectPresentation,
} from "../../lib/game/resolution/presentation";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../../lib/game/runtime/scene-interest";

const MATERIAL_FLAGS = [0x10, 0x100, 0x200, 0x10000, 0x10100, 0x10200];
const LOCAL_BOUNDS = new AABB3(new Vec3(0, 0, 0), new Vec3(3, 5, 0));

/** Closed source-first fixture used only to prove the renderer's blended building phases. */
export class SyntheticBlendedBuildingPipeline implements CommitPipeline {
	/** Real terrain supplies the residency authority required by synthetic dynamic roots. */
	constructor(private readonly terrain: StandardCommitPipeline) {}
	async prepareLandblockLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<readonly LandblockLayerCommit[]> {
		const terrain = await this.terrain.prepareLandblockLayers(
			new Set(
				[...layers].filter(({ layer }) => layer === LandblockLayerKind.Terrain),
			),
		);
		return [
			...terrain,
			...[...layers]
				.filter(({ layer }) => layer === LandblockLayerKind.Buildings)
				.map(({ id }) => buildingBundle(id)),
		];
	}

	async destroy(): Promise<void> {
		await this.terrain.destroy();
	}
}

function buildingBundle(landblockId: LandblockOwnerId): LandblockLayerCommit {
	const staticResidents = MATERIAL_FLAGS.map((flags, index) =>
		resident(landblockId, flags, index),
	);
	const source: ResolvedOutdoorStaticLayerSource = {
		dynamicSources: [],
		// These display-only triangles have no physics polygons, but every source owns a map entry.
		mapBlockers: new Map(
			staticResidents.map((resident) => [
				resident.presentation.sourceAssetId,
				{ positions: new Float32Array(), indices: new Uint32Array() },
			]),
		),
		kind: LandblockLayerKind.Buildings,
		landblockId,
		staticResidents,
	};
	return {
		commit: { source },
		landblockId,
		layer: LandblockLayerKind.Buildings,
	};
}

function resident(
	landblockId: LandblockOwnerId,
	flags: number,
	index: number,
): ResolvedObjectResident {
	return {
		behavior: {
			animationId: null,
			kind: "none",
			physicsScriptId: null,
			physicsScriptTableId: null,
			motionTableId: null,
			soundTableId: null,
		},
		identity: { kind: "authored", sourceId: `synthetic-blended:${index}` },
		localBounds: LOCAL_BOUNDS,
		placement: {
			envCellId: null,
			landblockId,
			localTransform: createTranslationMat4(new Vec3(84 + index * 4, 0, -120)),
		},
		presentation: presentation(flags, index),
		scale: new Vec3(1, 1, 1),
		setupId: null,
	};
}

function presentation(
	flags: number,
	index: number,
): ResolvedObjectPresentation {
	return {
		appearanceKey: `appearance:synthetic-blended:${index}`,
		id: `presentation:synthetic-blended:${index}`,
		parts: [
			{
				defaultScale: new Vec3(1, 1, 1),
				geometry: triangleGeometry(index),
				materials: [material(flags, index)],
				partIndex: 0,
				retailVisibility: "normally-visible",
			},
		],
		lights: [],
		holdingLocations: new Map(),
		placementPoses: new Map([
			[0, { partTransforms: [Mat4.identity()], placementId: 0 }],
		]),
		selectionBounds: LOCAL_BOUNDS,
		sortingBounds: LOCAL_BOUNDS,
		sourceAssetId: `0x0100${index.toString(16).padStart(4, "0")}`,
	};
}

function triangleGeometry(index: number): ResolvedGeometry {
	return {
		bounds: LOCAL_BOUNDS,
		id: `geometry:synthetic-blended:${index}`,
		indices: Uint32Array.of(0, 1, 2),
		materialSideKinds: Uint8Array.of(0),
		materialSideTypes: Uint8Array.of(0),
		materialSlotIndices: Uint16Array.of(0),
		materialStippling: Uint8Array.of(0),
		materialWrapModes: Uint8Array.of(0),
		normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
		positions: Float32Array.of(0, 0, 0, 3, 0, 0, 1.5, 5, 0),
		sourceDiagnostics: { rejectedDegenerateTriangles: [] },
		textureCoordinates: Float32Array.of(0, 0, 1, 0, 0.5, 1),
	};
}

function material(flags: number, index: number): ResolvedMaterial {
	return {
		color: [index % 2, (index + 1) % 2, 1, 0.5],
		diffuseScale: 1,
		id: `material:synthetic-blended:${flags}`,
		kind: "solid-color",
		luminosity: 0,
		rawSurfaceFlags: flags,
		translucency: 0,
	};
}
