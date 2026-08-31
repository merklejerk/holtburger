import type { MapEntity } from "../lib/game/map/map-blips";
import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import { type MapAnchor, mapEnvironment } from "../lib/game/map/map-view";

/** Smallest usable compass diameter when the containing viewport has enough room. */
export const MAP_PANEL_MINIMUM_SIZE = 140;

/** Independently remembered map extents for the two geometry modes. */
interface MapPanelViewDiameters {
	/** World-metre diameter restored whenever the anchor is inside an EnvCell. */
	readonly indoor: number;
	/** World-metre diameter restored outdoors or while residency is unknown. */
	readonly outdoor: number;
}

/** The map's centre and whether it represents a user-controlled entity or a free camera. */
export type MapPanelSubject =
	| {
			/** Distinguishes a player or possessed explorer entity from a free camera. */
			readonly kind: "controlled-entity";
			/** Entity whose live placement produced the anchor. */
			readonly guid: number;
			/** Live map centre and facing derived from the controlled entity. */
			readonly anchor: MapAnchor;
	  }
	| {
			/** Distinguishes explorer navigation without a possessed entity. */
			readonly kind: "free-camera";
			/** Live map centre and facing derived from the free camera. */
			readonly anchor: MapAnchor;
	  };

/** Panel geometry and view choices, owned by whichever shell mounts the map. */
export interface MapPanelState {
	readonly left: number;
	readonly top: number;
	readonly size: number;
	readonly viewDiameters: MapPanelViewDiameters;
}

/** One imperative read of every hot input the map and compass render. */
export interface MapPanelFrame {
	/** Null until the runtime is ready; the map remains blank meanwhile. */
	readonly source: MapTerrainSource | null;
	/** Null until there is a coherent position and ownership for the map's centre. */
	readonly subject: MapPanelSubject | null;
	/** Monotonic owner-produced fact covering live entity placement changes. */
	readonly presentedEntityRevision: number;
	readonly presentedEntities: () => Iterable<MapEntity>;
	/** Camera field of view in radians, drawn as the view cone. */
	readonly cameraFovRadians: number;
	/** Camera bearing, distinct from the possessed subject's bearing. */
	readonly cameraHeadingRadians: number;
}

/** Facts captured for the last completed WebGL map draw. */
export interface MapPanelGpuDrawState {
	readonly source: MapTerrainSource | null;
	readonly terrainRevision: number;
	readonly geometryRevision: number;
	readonly anchor: MapAnchor | null;
	readonly panelSize: number;
	readonly viewDiameter: number;
}

/** Capture only facts whose change invalidates the WebGL map picture. */
export function captureMapPanelGpuDrawState(
	frame: MapPanelFrame,
	panel: MapPanelState,
): MapPanelGpuDrawState {
	return {
		anchor: frame.subject?.anchor ?? null,
		geometryRevision: frame.source?.mapGeometry.revision ?? -1,
		panelSize: panel.size,
		source: frame.source,
		terrainRevision: frame.source?.terrainInstallationRevision ?? -1,
		viewDiameter: mapPanelViewDiameter(panel, frame.subject?.anchor ?? null),
	};
}

/** Select the remembered extent for the anchor's current geometry mode. */
export function mapPanelViewDiameter(
	panel: MapPanelState,
	anchor: MapAnchor | null,
): number {
	return panel.viewDiameters[mapEnvironment(anchor)];
}

/** Whether a previously drawn WebGL picture still represents the latest imperative read. */
export function sameMapPanelGpuDrawState(
	left: MapPanelGpuDrawState | null,
	right: MapPanelGpuDrawState,
): boolean {
	return (
		left !== null &&
		left.source === right.source &&
		left.terrainRevision === right.terrainRevision &&
		left.geometryRevision === right.geometryRevision &&
		left.panelSize === right.panelSize &&
		left.viewDiameter === right.viewDiameter &&
		sameAnchor(left.anchor, right.anchor)
	);
}

function sameAnchor(left: MapAnchor | null, right: MapAnchor | null): boolean {
	if (left === null || right === null) return left === right;
	return (
		left.worldX === right.worldX &&
		left.worldY === right.worldY &&
		left.worldZ === right.worldZ &&
		left.headingRadians === right.headingRadians &&
		left.residency?.landblockId === right.residency?.landblockId &&
		left.residency?.envCellId === right.residency?.envCellId
	);
}
