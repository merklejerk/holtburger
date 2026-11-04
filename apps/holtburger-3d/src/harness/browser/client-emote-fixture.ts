import {
	cellId,
	type DynamicEntityMotion,
	type DynamicEntityView,
} from "../../lib/game/runtime/dynamic-entity-feed";

/** Synthetic host-owned player playback for emote restoration and cancellation probes. */
export function emotePlaybackFixture(
	guid: number,
	activity: DynamicEntityMotion["activity"],
): DynamicEntityView {
	return {
		generation: 1,
		identity: { guid, wcid: 1 },
		display: { name: "Emote fixture", level: null },
		presentation: {
			entityClass: "player",
			placementFrame: 0,
			objectScale: 1,
			content: {
				setupDid: 0x02000001,
				motionTableDid: null,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			radar: { category: "player", behavior: null, obviousRange: null },
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
			spatialMembership: { reachesOutdoors: true, reachedEnvCellIds: [] },
			pose: {
				landblockId: cellId(0xda550001),
				coords: { x: 1, y: 2, z: 3 },
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			contact: "unknown",
			sampleMode: "authoritative-only",
		},
		motion: {
			activity,
			restPosture: null,
			locomotionCommandActive: false,
			locomotion: null,
			ordinary: {
				playbackId: "1",
				clip: { kind: "settled", animationId: 0x03000001, frame: 0 },
			},
		},
	};
}
