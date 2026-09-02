import type { DecodedStaticPresentation } from "../../lib/assets/decode-static-source-record";
import type {
	SetupVisualAppearance,
	SetupVisualSource,
} from "../../lib/assets/setup-visual-source";
import type { LandblockOwnerId } from "../../lib/game/game-types";
import { AABB3, Mat4, Vec3 } from "../../lib/game/math/types";
import {
	cellId,
	type DynamicEntityView,
} from "../../lib/game/runtime/dynamic-entity-feed";

export const SYNTHETIC_NAMEPLATE_SETUP_DID = 0x0200_fffe;
const SYNTHETIC_NAMEPLATE_WALL_SETUP_DID = 0x0200_fffd;
const SYNTHETIC_SHADOW_CROWD_SETUP_DID = 0x0200_fffc;
const SYNTHETIC_SHADOW_CROWD_PART_COUNT = 61;

export type SyntheticNameplateWorkload =
	| "repeated-100"
	| "unique-100"
	| "ordered-500"
	| "shadow-crowd-112x61"
	| "occlusion-open"
	| "occlusion-wall"
	| "portal-open"
	| "portal-wall"
	| "portal-plural";

const BOUNDS = new AABB3(new Vec3(-0.5, 0, -0.5), new Vec3(0.5, 2, 0.5));
const VISUAL = createVisual();
const WALL_VISUAL = createWallVisual();
const SHADOW_CROWD_VISUAL = createShadowCrowdVisual();

/** Harness-only setup source preserving the production source for every non-fixture setup. */
export class SyntheticNameplateSetupVisualSource implements SetupVisualSource {
	constructor(private readonly delegate: SetupVisualSource) {}

	load(
		setupDid: number,
		appearance: SetupVisualAppearance,
	): Promise<DecodedStaticPresentation> {
		if (setupDid === SYNTHETIC_NAMEPLATE_SETUP_DID)
			return Promise.resolve(VISUAL);
		if (setupDid === SYNTHETIC_NAMEPLATE_WALL_SETUP_DID)
			return Promise.resolve(WALL_VISUAL);
		if (setupDid === SYNTHETIC_SHADOW_CROWD_SETUP_DID)
			return Promise.resolve(SHADOW_CROWD_VISUAL);
		return this.delegate.load(setupDid, appearance);
	}
}

/** Build deterministic dynamic views around one camera without depending on catalog contents. */
export function createSyntheticNameplateWorkload(
	workload: SyntheticNameplateWorkload,
	landblockId: LandblockOwnerId,
	cameraPosition: readonly [number, number, number],
	envCellId: string | null,
): readonly DynamicEntityView[] {
	const count =
		workload === "ordered-500"
			? 500
			: workload === "shadow-crowd-112x61"
				? 112
				: workload === "occlusion-open" ||
					  workload === "occlusion-wall" ||
					  workload.startsWith("portal-")
					? 1
					: 100;
	const owner = parseInt(landblockId.slice(2, 6), 16);
	const residencyCellId = cellId(
		envCellId === null
			? ((owner << 16) | 1) >>> 0
			: Number.parseInt(envCellId.slice(2), 16),
	);
	const firstEnvCellId = cellId(((owner << 16) | 0x0100) >>> 0);
	const localCameraX = cameraPosition[0] - ownerX(owner);
	const localCameraY = -cameraPosition[2] - ownerY(owner);
	const cameraHeight = cameraPosition[1];
	const targets = Array.from({ length: count }, (_, index) => {
		const columnCount =
			workload === "ordered-500"
				? 20
				: workload === "shadow-crowd-112x61"
					? 14
					: 10;
		const column = index % columnCount;
		const row = Math.floor(index / columnCount);
		const lateral = workload.startsWith("portal-")
			? 4.5
			: workload === "occlusion-open" || workload === "occlusion-wall"
				? 0
				: (column - (columnCount - 1) * 0.5) * 1.5;
		// The 20-column budget workload starts deeper than the 10-column visual workloads so
		// every near-row entity sits comfortably inside the camera frustum on every backend.
		const forward = (workload === "ordered-500" ? 24 : 8) + row * 1.75;
		return entity({
			entityClass: "mob",
			guid: 0xff00_0000 + index,
			level: workload === "unique-100" ? index + 1 : 42,
			name: workload === "unique-100" ? `Nameplate ${index + 1}` : "Drudge",
			reachedEnvCellIds:
				envCellId === null
					? workload === "portal-plural"
						? [firstEnvCellId]
						: []
					: [residencyCellId],
			residencyCellId,
			reachesOutdoors: envCellId === null || workload === "portal-plural",
			setupDid:
				workload === "shadow-crowd-112x61"
					? SYNTHETIC_SHADOW_CROWD_SETUP_DID
					: SYNTHETIC_NAMEPLATE_SETUP_DID,
			x: localCameraX + lateral,
			y: localCameraY + forward,
			z: cameraHeight - 1.5,
		});
	});
	if (workload !== "occlusion-wall" && workload !== "portal-wall")
		return targets;
	return [
		...targets,
		entity({
			entityClass: "other",
			guid: 0xff10_0000,
			level: null,
			name: "Occluder",
			reachedEnvCellIds: envCellId === null ? [] : [residencyCellId],
			reachesOutdoors: envCellId === null,
			residencyCellId,
			setupDid: SYNTHETIC_NAMEPLATE_WALL_SETUP_DID,
			x: localCameraX + (workload === "portal-wall" ? 4.5 : 0),
			y: localCameraY + (workload === "portal-wall" ? 1 : 4),
			z: cameraHeight - 4,
		}),
	];
}

function ownerX(owner: number): number {
	return ((owner >>> 8) & 0xff) * 192;
}

function ownerY(owner: number): number {
	return (owner & 0xff) * 192;
}

function entity(input: {
	readonly entityClass: DynamicEntityView["presentation"]["entityClass"];
	readonly guid: number;
	readonly level: number | null;
	readonly name: string;
	readonly reachedEnvCellIds: readonly ReturnType<typeof cellId>[];
	readonly reachesOutdoors: boolean;
	readonly residencyCellId: ReturnType<typeof cellId>;
	readonly setupDid: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}): DynamicEntityView {
	return {
		display: { level: input.level, name: input.name },
		generation: 1,
		identity: { guid: input.guid, wcid: input.setupDid },
		physics: {
			cloaked: false,
			translucency: 0,
			defaultAnimation: false,
			defaultScript: false,
			hidden: false,
			lighting: false,
			noDraw: false,
			participation: "pose-only",
			semanticMask: 0,
		},
		placement: {
			contact: "grounded",
			kind: "world",
			pose: {
				coords: { x: input.x, y: input.y, z: input.z },
				landblockId: input.residencyCellId,
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			sampleMode: "authoritative-only",
			spatialMembership: {
				reachedEnvCellIds: [...input.reachedEnvCellIds],
				reachesOutdoors: input.reachesOutdoors,
			},
		},
		motion: null,
		presentation: {
			appearance: {
				paletteDid: null,
				partChanges: [],
				subPalettes: [],
				textureChanges: [],
			},
			entityClass: input.entityClass,
			content: {
				motionTableDid: null,
				physicsEffectTableDid: null,
				setupDid: input.setupDid,
				soundTableDid: null,
			},
			objectScale: 1,
			radar: { behavior: null, blipColor: "Red", obviousRange: null },
		},
	};
}

function createWallVisual(): DecodedStaticPresentation {
	const bounds = new AABB3(new Vec3(-4, 0, -0.1), new Vec3(4, 8, 0.1));
	return {
		...VISUAL,
		localBounds: bounds,
		presentation: {
			...VISUAL.presentation,
			appearanceKey: "appearance:synthetic-nameplate-wall",
			id: "presentation:synthetic-nameplate-wall",
			parts: [
				{
					defaultScale: new Vec3(1, 1, 1),
					geometry: {
						bounds,
						id: "geometry:synthetic-nameplate-wall",
						indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
						materialSideKinds: new Uint8Array([0, 0]),
						materialSideTypes: new Uint8Array([0, 0]),
						materialSlotIndices: new Uint16Array([0, 0]),
						materialStippling: new Uint8Array([0, 0]),
						materialWrapModes: new Uint8Array([0, 0]),
						normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
						positions: new Float32Array([-4, 0, 0, 4, 0, 0, 4, 8, 0, -4, 8, 0]),
						sourceDiagnostics: { rejectedDegenerateTriangles: [] },
						textureCoordinates: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
					},
					materials: [
						{
							color: [0.05, 0.05, 0.05, 1],
							diffuseScale: 1,
							id: "material:synthetic-nameplate-wall",
							kind: "solid-color",
							luminosity: 0,
							rawSurfaceFlags: 0,
							translucency: 0,
						},
					],
					partIndex: 0,
					retailVisibility: "normally-visible",
				},
			],
			selectionBounds: bounds,
			sortingBounds: bounds,
			sourceAssetId: "0x0200fffd",
		},
		setupId: "0x0200fffd",
	};
}

function createVisual(): DecodedStaticPresentation {
	return {
		behavior: {
			animationId: null,
			kind: "none",
			motionTableId: null,
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		},
		localBounds: BOUNDS,
		presentation: {
			appearanceKey: "appearance:synthetic-nameplate",
			holdingLocations: new Map(),
			id: "presentation:synthetic-nameplate",
			lights: [],
			parts: [
				{
					defaultScale: new Vec3(1, 1, 1),
					geometry: {
						bounds: BOUNDS,
						id: "geometry:synthetic-nameplate",
						indices: new Uint32Array([0, 1, 2]),
						materialSideKinds: new Uint8Array([0]),
						materialSideTypes: new Uint8Array([0]),
						materialSlotIndices: new Uint16Array([0]),
						materialStippling: new Uint8Array([0]),
						materialWrapModes: new Uint8Array([0]),
						normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
						positions: new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 2, 0]),
						sourceDiagnostics: { rejectedDegenerateTriangles: [] },
						textureCoordinates: new Float32Array([0, 0, 1, 0, 0.5, 1]),
					},
					materials: [
						{
							color: [0.7, 0.15, 0.15, 1],
							diffuseScale: 1,
							id: "material:synthetic-nameplate",
							kind: "solid-color",
							luminosity: 0,
							rawSurfaceFlags: 0,
							translucency: 0,
						},
					],
					partIndex: 0,
					retailVisibility: "normally-visible",
				},
			],
			placementPoses: new Map([
				[0, { partTransforms: [Mat4.identity()], placementId: 0 }],
			]),
			selectionBounds: BOUNDS,
			sortingBounds: BOUNDS,
			sourceAssetId: "0x0200fffe",
		},
		setupId: "0x0200fffe",
	};
}

/**
 * Repeat one catalog-independent rigid part to match the measured client crowd's parts-per-root
 * distribution without depending on a locally generated weenie catalog.
 *
 * Every part intentionally consumes the same geometry and depth state. The fixture reproduces
 * selection and instance-record cardinality, not the live crowd's geometry/run distribution.
 */
function createShadowCrowdVisual(): DecodedStaticPresentation {
	const sourcePart = VISUAL.presentation.parts[0];
	if (sourcePart === undefined)
		throw new Error("Synthetic shadow crowd source visual has no rigid part.");
	return {
		...VISUAL,
		presentation: {
			...VISUAL.presentation,
			appearanceKey: "appearance:synthetic-shadow-crowd",
			id: "presentation:synthetic-shadow-crowd",
			parts: Array.from(
				{ length: SYNTHETIC_SHADOW_CROWD_PART_COUNT },
				(_, partIndex) => ({ ...sourcePart, partIndex }),
			),
			placementPoses: new Map([
				[
					0,
					{
						partTransforms: Array.from(
							{ length: SYNTHETIC_SHADOW_CROWD_PART_COUNT },
							() => Mat4.identity(),
						),
						placementId: 0,
					},
				],
			]),
			sourceAssetId: "0x0200fffc",
		},
		setupId: "0x0200fffc",
	};
}
