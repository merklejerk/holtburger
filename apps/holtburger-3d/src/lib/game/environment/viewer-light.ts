import { sceneVec3, type SceneVec3 } from "../../assets/ac-frame";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import { normalizedRgbColor } from "../../frontend-color";
import { createLandblockWorldOrigin } from "../landblocks";
import { transformPoint3 } from "../math/matrices";
import { Vec3 } from "../math/types";
import type { ScenePlacement } from "../scene";
import { RUNTIME_LIGHT_RANGE_SCALE } from "./runtime-lights";

const TUNING = SHARED_FRONTEND_TUNING.rendering.viewerLight;

/**
 * Draw-time headlamp values, with `rangeAdjust` folded into the authored falloff: a hardware light
 * reaches `falloff * 1.5` (`config_hardware_light`, acclient.c:432899).
 *
 * Shaped so the renderer can place it as one more runtime light without knowing whose it is;
 * every value it holds is authored in `SHARED_FRONTEND_TUNING.rendering.viewerLight`.
 */
export const VIEWER_LIGHT = {
	range: TUNING.falloff * RUNTIME_LIGHT_RANGE_SCALE,
	intensity: TUNING.intensity,
	color: normalizedRgbColor(TUNING.color),
} as const;

/** Reused because the offset is a fixed constant and this resolves once per frame. */
const CARRY_OFFSET = new Vec3(0, TUNING.carryHeight, 0);

/**
 * Where the viewer light hangs this frame, in canonical scene space.
 *
 * `SmartBox::set_viewer` attaches the light to the body being driven when there is one and to the
 * camera otherwise (acclient.c:137879-137897), which is why this takes both: whoever knows what
 * the viewer is driving decides, and the renderer only places the light where it is told.
 *
 * The carry offset is composed through the carrier's own frame, exactly as retail composes the
 * light's offset frame against the player's, so a tilted carrier tilts the light with it. Dynamic
 * root placements carry no scale, so nothing else rides along with the rotation.
 */
export function resolveViewerLightOrigin(
	carrier: ScenePlacement | null,
	cameraPosition: SceneVec3,
): SceneVec3 {
	if (carrier === null) return cameraPosition;
	return sceneVec3(
		transformPoint3(carrier.localTransform, CARRY_OFFSET).add(
			createLandblockWorldOrigin(carrier.landblockId),
		),
	);
}
