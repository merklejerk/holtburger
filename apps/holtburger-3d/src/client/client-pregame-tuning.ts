import {
	sceneVec3,
	acVector3,
	type AcVector3,
	type SceneVec3,
} from "../lib/assets/ac-frame";
import { Quat, Vec3 } from "../lib/game/math/types";
import type { SceneInterestRadii } from "../lib/game/runtime/types";
import type { EnvCellId, LandblockOwnerId } from "../lib/game/game-types";
import type { PregameCameraOffset } from "./client-pregame-camera";

/** Client-owned pregame projection and per-focus camera placement preferences. */
interface ClientPregameCameraTuning {
	/** Initial character rotation relative to facing the fitted camera; zero looks at the viewer. */
	readonly initialYawRadians: number;
	/** Full vertical field of view in degrees, shared by both focus modes. */
	readonly fovDegrees: number;
	/** Full-body camera height and distance preferences. */
	readonly body: PregameCameraOffset;
	/** Face camera height and distance preferences. */
	readonly face: PregameCameraOffset;
}

/** Pregame projection and preferred translations; authored tuning may crop or clip the character. */
export const CLIENT_PREGAME_CAMERA_TUNING = {
	/** Start facing the fitted camera; isolated inspection keeps its separate initial yaw. */
	initialYawRadians: 0,
	/** Full vertical field of view in degrees, shared by body and face compositions. */
	fovDegrees: 80,
	/** Full-body composition. */
	body: { heightOffsetFraction: 0.05, distanceOffsetFraction: -0.1 },
	/** Face composition uses its own focus height for the independent vertical adjustment. */
	face: { heightOffsetFraction: -0.25, distanceOffsetFraction: -0.15 },
} as const satisfies ClientPregameCameraTuning;

/** One authored pregame composition; character and camera can occupy different cells. */
export interface ClientPregameLocation {
	/** Landblock containing both placements. */
	readonly landblockId: LandblockOwnerId;
	/** Character standing position in landblock-local AC axes. */
	readonly character: {
		/** Character's visibility cell, independent of the camera cell. */
		readonly envCellId: EnvCellId;
		/** Authored position; preview orientation is camera-relative rather than location-owned. */
		readonly position: AcVector3;
	};
	/** Reference camera pose in canonical scene axes; framing retains its orientation. */
	readonly camera: {
		/** Camera's visibility cell. */
		readonly envCellId: EnvCellId;
		/** Canonical world position before character framing. */
		readonly position: SceneVec3;
		/** Scene-axis camera orientation. */
		readonly rotation: Quat;
	};
}

/** Authored staging location and frontend composition policy; positions use canonical scene axes. */
export const CLIENT_PREGAME_SCENE_TUNING = {
	/** Launch-time candidates; authors supply sufficient space for character and camera movement. */
	locations: [
		{
			landblockId: "0x0138ffff",
			character: {
				envCellId: "0x01380180",
				position: acVector3([40, -280, -5.995]),
			},
			camera: {
				envCellId: "0x01380180",
				position: sceneVec3(new Vec3(232, -3.751, -10467.59)),
				rotation: new Quat(0.995, -0.0998, 0, 0),
			},
		},
		{
			landblockId: "0x5f44ffff",
			character: {
				envCellId: "0x5f4401a3",
				position: acVector3([229.424, -103.144, 0.005]),
			},
			camera: {
				envCellId: "0x5f4401a4",
				position: sceneVec3(new Vec3(18469.419, 2.249, -12948.446)),
				rotation: new Quat(0.995, -0.0998, -0.0005, -0.0001),
			},
		},
		{
			landblockId: "0x0291ffff",
			character: {
				envCellId: "0x02910387",
				position: acVector3([208.798, -113.903, 6.005]),
			},
			camera: {
				envCellId: "0x02910387",
				position: sceneVec3(new Vec3(590.255, 8.249, -27729.701)),
				rotation: new Quat(0.301, -0.0302, -0.9484, -0.0952),
			},
		},
	] as const satisfies readonly [
		ClientPregameLocation,
		...ClientPregameLocation[],
	],
	/** Inset around the character's reserved UI rectangle in CSS pixels. */
	margin: 12,
	fillLight: {
		/** Displacement in fixed camera axes, relative to the prepared whole-body center. */
		offset: new Vec3(0.8, 1, 2),
		color: { red: 1, green: 0.94, blue: 0.85 },
		intensity: 1.25,
		range: 6,
	},
	/** Bounded coverage also works if this candidate is classified as outdoor content. */
	radii: {
		terrainRadius: 1,
		buildingRadius: 1,
		explicitObjectRadius: 1,
		generatedObjectRadius: 1,
		envCellRadius: 0,
	} satisfies SceneInterestRadii,
	/** Local calendar starts at noon; gameplay replaces it with its server-owned clock. */
	dayIndex: 0,
	timeOfDay: 0.5,
} as const;

/** Pick once at app startup; the presentation root retains the selected entry through mode changes. */
export function choosePregameLocation(): ClientPregameLocation {
	const locations = CLIENT_PREGAME_SCENE_TUNING.locations;
	const location = locations[Math.floor(Math.random() * locations.length)];
	if (location === undefined)
		throw new Error(
			"Pregame location selection must resolve a configured entry.",
		);
	return location;
}
