import { pointToSegmentDistance2d } from "../math/geometry-utils";
import type { SetupSidewaysSpan } from "../resolution/presentation";
import { createLandblockWorldOrigin } from "../landblocks";
import type { DynamicEntityView } from "../runtime/dynamic-entity-feed";
import type { ScenePlacement } from "../scene";
import {
	isInteractableMapCategory,
	type DynamicEntityMapBlipCategory,
} from "./map-blip-category";
import {
	mapHeadingFromSceneTransform,
	type ProjectedMapView,
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
	/** Setup-pose width at current root scale; absent while geometry is unavailable. */
	readonly sidewaysSpan: SetupSidewaysSpan | null;
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
	/** Projected door span; null retains the ordinary point marker when width is unavailable. */
	readonly span: {
		readonly startX: number;
		readonly startY: number;
		readonly endX: number;
		readonly endY: number;
	} | null;
	readonly guid: number;
	readonly name: string;
	/** Clip-space position, both axes in [-1, 1] for anything on screen. */
	readonly clipX: number;
	readonly clipY: number;
	/** Marker treatment, including the controlled entity's screen-relative facing. */
	readonly appearance:
		| {
				/** Selects the directional marker and its frontend-authored color. */
				readonly category: "controlled";
				/** Facing relative to the map anchor, clockwise from screen-up. */
				readonly headingRadians: number;
		  }
		| {
				/** Producer-resolved class selecting the marker shape and color. */
				readonly category: DynamicEntityMapBlipCategory;
				/** Entity height minus map-anchor height in world metres. */
				readonly heightOffsetMeters: number;
		  };
}

/**
 * Select and place the blips for one map frame.
 *
 * Retail drew only objects whose `ShowableOnRadar` was one of the three show values, then applied
 * a fixed radius. Ordinary objects retain those visibility semantics; doors and switches
 * are explicit landmarks. All markers use the current map extent:
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
	projection: ProjectedMapView,
	controlledEntityGuid: number | null,
): readonly MapBlip[] {
	const { view, worldToClip } = projection;
	const blips: MapBlip[] = [];
	for (const { view: entity, placement, sidewaysSpan } of entities) {
		const controlled = entity.identity.guid === controlledEntityGuid;
		const behavior = entity.presentation.radar.behavior;
		const interactable = isInteractableMapCategory(
			entity.presentation.radar.category,
		);
		// The controlled marker is navigation chrome rather than an object's radar appearance. It
		// remains available even when the controlled entity is hidden or authored as ShowNever.
		// RETAIL QUIRK: despite their conditional names, ShowMovement and ShowAttacking are always
		// accepted alongside ShowAlways; InqShowableOnRadar performs no state test
		// (acclient.c:417954-417970). Gating either would hide authored objects retail shows. The
		// 43,913-template catalog census found every defined value 0..4 in shipped content.
		if (
			!controlled &&
			!interactable &&
			behavior !== "ShowMovement" &&
			behavior !== "ShowAttacking" &&
			behavior !== "ShowAlways"
		) {
			continue;
		}
		// RETAIL DIVERGENCE: InqShowableOnRadar excludes unset radar behavior
		// (acclient.c:417954-417970). We expose doors and native switches as map landmarks.
		// The 43,913-template census found all 542 doors and 193 switches omit radar behavior;
		// 92 switches are server-only and cannot reach a normal live-client feed. Restoring the
		// retail predicate would hide these landmarks. Map drawing cannot affect server content.
		if (
			!controlled &&
			(entity.physics.hidden || (interactable && entity.physics.noDraw))
		)
			continue;
		const origin = createLandblockWorldOrigin(placement.landblockId);
		const [clipX, clipY] = projectMapWorldPoint(
			worldToClip,
			view,
			origin.x + placement.localTransform.m41,
			origin.z + placement.localTransform.m43,
		);
		const category = entity.presentation.radar.category;
		let span: MapBlip["span"] = null;
		if (
			!controlled &&
			(category === "door" || category === "door-no-direct-use") &&
			sidewaysSpan !== null &&
			sidewaysSpan.maxX > sidewaysSpan.minX
		) {
			// AC forward is +Y and sideways is X. Deliberately approximate half-open setup geometry;
			// unusual door models keep this convention rather than guessing a different axis.
			const m = placement.localTransform;
			const project = (x: number) =>
				projectMapWorldPoint(
					worldToClip,
					view,
					origin.x + m.m11 * x + m.m31 * sidewaysSpan.z + m.m41,
					origin.z + m.m13 * x + m.m33 * sidewaysSpan.z + m.m43,
				);
			const start = project(sidewaysSpan.minX),
				end = project(sidewaysSpan.maxX);
			span = { startX: start[0], startY: start[1], endX: end[0], endY: end[1] };
		}
		if (
			span === null
				? Math.abs(clipX) > 1 || Math.abs(clipY) > 1
				: !spanIntersectsMap(span)
		)
			continue;
		blips.push({
			span,
			// RETAIL DIVERGENCE: retail selects marker fill from the effective RadarColor
			// (acclient.c:252944-253079). We use the producer-resolved semantic category so players,
			// NPCs, mobs, portals, and lifestones retain stable frontend-tunable identities instead
			// of inheriting an arbitrary authored palette entry. Restoring retail would make members
			// of one class vary and can collapse unrelated classes onto one color. The shipped-catalog
			// census found 8,739 of 10,883 radar-visible templates omit an explicit color and therefore
			// use retail's category fallback; the remaining 2,144 author colors that this map ignores.
			appearance: controlled
				? {
						category: "controlled",
						headingRadians:
							mapHeadingFromSceneTransform(placement.localTransform) -
							view.anchor.headingRadians,
					}
				: {
						category: entity.presentation.radar.category,
						heightOffsetMeters:
							placement.localTransform.m42 - view.anchor.worldY,
					},
			clipX,
			clipY,
			guid: entity.identity.guid,
			name: entity.display.name,
		});
	}
	return blips;
}

/** Keep a span whose center lies outside the circular map but whose geometry crosses it. */
function spanIntersectsMap(span: NonNullable<MapBlip["span"]>): boolean {
	return (
		pointToSegmentDistance2d(
			0,
			0,
			span.startX,
			span.startY,
			span.endX,
			span.endY,
		) <= 1
	);
}
