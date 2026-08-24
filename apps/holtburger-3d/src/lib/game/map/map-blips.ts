import { createLandblockWorldOrigin } from "../landblocks";
import type { DynamicEntityView } from "../runtime/dynamic-entity-feed";
import type { ScenePlacement } from "../scene";
import {
	type MapViewParameters,
	computeMapWorldToClip,
	projectMapWorldPoint,
} from "./map-view";

/**
 * One realized entity, as the map is given it.
 *
 * Identity and placement arrive together and from the same source — the running scene — because
 * they go stale at different rates otherwise. Ordinary integrated advances move entities every host
 * tick without republishing any view, so a position taken from a published snapshot is a position
 * from the last discontinuous correction.
 */
export interface MapEntity {
	readonly view: DynamicEntityView;
	/** Where the entity is being drawn right now, in its landblock's local frame. */
	readonly placement: ScenePlacement;
}

/**
 * One entity reduced to what the map draws of it.
 *
 * Positions are clip space, matching the geometry beneath, so the blip layer applies exactly the
 * transform the map did rather than reimplementing zoom and rotation and drifting from it.
 */
export interface MapBlip {
	readonly guid: number;
	readonly name: string;
	/** Clip-space position, both axes in [-1, 1] for anything on screen. */
	readonly clipX: number;
	readonly clipY: number;
	/** Effective producer-resolved radar colour. */
	readonly color: DynamicEntityView["presentation"]["radar"]["blipColor"];
}

/**
 * Select and place the blips for one map frame.
 *
 * Retail drew only objects whose `ShowableOnRadar` was one of the three show values, then applied
 * a fixed radius. We keep the visibility semantics and drop the radius:
 *
 * RETAIL DIVERGENCE: retail limited blips to `CPlayerSystem::GetRadarRadius`, a flat 75 m outdoors
 * and 25 m indoors (acclient.c:378719-378725), tested as a horizontal distance compare
 * (acclient.c:254410-254415). That radius existed because retail's radar had one fixed scale; this
 * map zooms, so a fixed radius would hide entities standing on terrain the reader can plainly see.
 * Blips are limited by the visible extent instead. Nothing authored can observe the difference —
 * radar drawing is client presentation, and `ObviousRadarRange`, the property that looked like it
 * governed this, is read nowhere in ACE's server logic.
 */
export function selectMapBlips(
	entities: Iterable<MapEntity>,
	view: MapViewParameters,
	canvasWidth: number,
	canvasHeight: number,
): readonly MapBlip[] {
	const worldToClip = computeMapWorldToClip(view, canvasWidth, canvasHeight);
	const blips: MapBlip[] = [];
	for (const { view: entity, placement } of entities) {
		const behavior = entity.presentation.radar.behavior;
		// RETAIL QUIRK: despite their conditional names, ShowMovement and ShowAttacking are always
		// accepted alongside ShowAlways; InqShowableOnRadar performs no state test
		// (acclient.c:417954-417970). Gating either would hide authored objects retail shows. The
		// 43,913-template catalog census found every defined value 0..4 in shipped content.
		if (
			behavior !== "ShowMovement" &&
			behavior !== "ShowAttacking" &&
			behavior !== "ShowAlways"
		) {
			continue;
		}
		if (entity.physics.hidden) continue;
		const origin = createLandblockWorldOrigin(placement.landblockId);
		const [clipX, clipY] = projectMapWorldPoint(
			worldToClip,
			view,
			origin.x + placement.localTransform.m41,
			origin.z + placement.localTransform.m43,
		);
		if (Math.abs(clipX) > 1 || Math.abs(clipY) > 1) continue;
		blips.push({
			clipX,
			clipY,
			color: entity.presentation.radar.blipColor,
			guid: entity.identity.guid,
			name: entity.identity.name,
		});
	}
	return blips;
}
