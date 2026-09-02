import type { MapEntity } from "../lib/game/map/map-blips";
import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import {
	type MapAnchor,
	mapEnvironment,
	type MapViewParameters,
} from "../lib/game/map/map-view";

/** Smallest usable compass diameter when the containing viewport has enough room. */
export const MAP_PANEL_MINIMUM_SIZE = 140;

/** Independently remembered map extents for the two geometry modes. */
interface MapPanelViewDiameters {
	/** World-metre diameter restored whenever the anchor is inside an EnvCell. */
	readonly indoor: number;
	/** World-metre diameter restored outdoors or while residency is unknown. */
	readonly outdoor: number;
}

/** Subject the map follows and whether it represents a controlled entity or a free camera. */
export type MapPanelSubject =
	| {
			/** Distinguishes a player or possessed explorer entity from a free camera. */
			readonly kind: "controlled-entity";
			/** Entity whose live placement produced the anchor. */
			readonly guid: number;
			/** Live position and facing derived from the controlled entity. */
			readonly anchor: MapAnchor;
	  }
	| {
			/** Distinguishes explorer navigation without a possessed entity. */
			readonly kind: "free-camera";
			/** Live position and facing derived from the free camera. */
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
	/** Null until there is a coherent subject position and ownership. */
	readonly subject: MapPanelSubject | null;
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
	/** Renderer-consumed projection of the current map view. */
	readonly view: MapPanelGpuViewState | null;
	readonly panelSize: number;
}

/** Exact map-view facts whose changes invalidate the WebGL terrain and surface picture. */
interface MapPanelGpuViewState {
	/** Subject bearing that rotates the map. */
	readonly anchorHeadingRadians: number;
	/** Subject height driving terrain contours and interior floor treatment. */
	readonly anchorHeight: number;
	/** Subject residency selecting outdoor terrain or one interior component. */
	readonly anchorResidency: MapAnchor["residency"];
	/** World-space horizontal point drawn at the map centre. */
	readonly center: MapViewParameters["center"];
	/** World-space diameter visible across the map disc. */
	readonly viewDiameter: number;
}

/** Capture only facts whose change invalidates the WebGL map picture. */
export function captureMapPanelGpuDrawState(
	frame: MapPanelFrame,
	panel: MapPanelState,
	view: MapViewParameters | null,
): MapPanelGpuDrawState {
	return {
		geometryRevision: frame.source?.mapGeometry.revision ?? -1,
		panelSize: panel.size,
		source: frame.source,
		terrainRevision: frame.source?.terrainInstallationRevision ?? -1,
		view:
			view === null
				? null
				: {
						anchorHeadingRadians: view.anchor.headingRadians,
						anchorHeight: view.anchor.worldY,
						anchorResidency: view.anchor.residency,
						center: view.center,
						viewDiameter: view.viewDiameter,
					},
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
		sameGpuView(left.view, right.view)
	);
}

function sameGpuView(
	left: MapPanelGpuViewState | null,
	right: MapPanelGpuViewState | null,
): boolean {
	if (left === null || right === null) return left === right;
	return (
		left.center.worldX === right.center.worldX &&
		left.center.worldZ === right.center.worldZ &&
		left.viewDiameter === right.viewDiameter &&
		left.anchorHeight === right.anchorHeight &&
		left.anchorHeadingRadians === right.anchorHeadingRadians &&
		left.anchorResidency?.landblockId === right.anchorResidency?.landblockId &&
		left.anchorResidency?.envCellId === right.anchorResidency?.envCellId
	);
}
