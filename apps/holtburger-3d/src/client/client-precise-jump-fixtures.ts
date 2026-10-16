import { cellId } from "../lib/game/runtime/dynamic-entity-feed";
import type {
	DynamicEntityView,
	DynamicEntityWorldPlacement,
} from "../lib/game/runtime/dynamic-entity-feed";
import { landblockVector3 } from "../lib/assets/ac-frame";
import type {
	ClientCameraIdentity,
	ClientPreciseJumpEvaluation,
	ClientPreciseJumpProgress,
	ClientPreciseJumpLaunch,
	ClientPreciseJumpTrajectory,
} from "./client-host-contract";

/** Synthetic transport/presentation fixtures; collision correctness belongs to core tests. */
export function resolvedJumpFixture(
	camera: ClientCameraIdentity,
	sequence: number,
	power: number,
): Extract<ClientPreciseJumpProgress, { phase: "launch-resolved" }> {
	const target: ClientPreciseJumpLaunch["target"] = {
		anchor: 0xda55ffff,
		point: landblockVector3([114, 96, 0]),
		normal: [0, 0, 1],
		committedCell: null,
	};
	const curve: ClientPreciseJumpTrajectory = {
		anchor: target.anchor,
		origin: landblockVector3([120, 96, 0.005]),
		velocity: [-4, 0, 7.35],
		acceleration: [0, 0, -9.8],
		durationSeconds: 1.5,
		placements: [{ startFraction: 0, endFraction: 1, committedCell: null }],
	};
	return {
		phase: "launch-resolved",

		camera,
		sequence,
		launch: { target, power, preview: { kind: "desired", curve } },
	};
}

export function predictedJumpFixture(
	resolved: Extract<ClientPreciseJumpProgress, { phase: "launch-resolved" }>,
	outcome: "match" | "miss" | "incomplete",
): Extract<ClientPreciseJumpEvaluation, { status: "predicted" }> {
	const target = resolved.launch.target;
	const end = landblockVector3(
		outcome === "match" ? [114, 96, 0.005] : [116, 96, 0.005],
	);
	return {
		phase: "completed",

		camera: resolved.camera,
		sequence: resolved.sequence,
		status: "predicted",
		launch: resolved.launch,
		flight: {
			anchor: target.anchor,
			segments: [
				{
					start: resolved.launch.preview.curve.origin,
					end,

					committedCell: null,
				},
			],

			outcome:
				outcome === "incomplete"
					? { kind: "incomplete", reason: { kind: "flight-horizon-exhausted" } }
					: {
							kind: "landed",
							contactPoint: landblockVector3([end[0], end[1], 0]),
							normal: [0, 0, 1],
							committedCell: null,
							matchesTarget: outcome === "match",
						},
		},
	};
}

export function jumpActorFixture(
	guid: number,
	generation: number,
): DynamicEntityView & { placement: DynamicEntityWorldPlacement } {
	return {
		generation,
		motion: null,
		identity: { guid, wcid: 42 },
		display: { name: "Player", level: null },
		presentation: {
			placementFrame: 0,
			entityClass: "other",
			content: {
				motionTableDid: null,
				setupDid: 0x02000001,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			objectScale: 1,
			radar: {
				behavior: null,
				category: "other",
				obviousRange: null,
			},
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
			translucency: 0,
			lighting: false,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			kind: "world",
			spatialMembership: {
				reachesOutdoors: true,
				reachedEnvCellIds: [],
			},
			pose: {
				landblockId: cellId(0xda550001),
				coords: { x: 1, y: 2, z: 3 },
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			contact: "unknown",
			sampleMode: "authoritative-only",
		},
	};
}
