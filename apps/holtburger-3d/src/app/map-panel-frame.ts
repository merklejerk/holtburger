import type { MapEntity } from "../lib/game/map/map-blips";
import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import type { MapAnchor } from "../lib/game/map/map-view";

/** Panel geometry and view choices, owned by whichever shell mounts the map. */
export interface MapPanelState {
	readonly left: number;
	readonly top: number;
	readonly size: number;
	readonly viewDiameter: number;
}

/** One imperative read of every hot input the map and compass render. */
export interface MapPanelFrame {
	/** Null until the runtime is ready; the map remains blank meanwhile. */
	readonly source: MapTerrainSource | null;
	readonly anchor: MapAnchor | null;
	/** Monotonic owner-produced fact covering live entity placement changes. */
	readonly presentedEntityRevision: number;
	readonly presentedEntities: () => Iterable<MapEntity>;
	/** Camera field of view in radians, drawn as the view cone. */
	readonly cameraFovRadians: number;
	/** Camera bearing, distinct from the possessed subject's bearing. */
	readonly cameraHeadingRadians: number;
}

/** Facts captured for the last completed map draw. */
export interface MapPanelDrawState {
	readonly source: MapTerrainSource | null;
	readonly terrainRevision: number;
	readonly geometryRevision: number;
	readonly presentedEntityRevision: number;
	readonly anchor: MapAnchor | null;
	readonly cameraFovRadians: number;
	readonly cameraHeadingRadians: number;
	readonly panelSize: number;
	readonly viewDiameter: number;
}

/** Capture all facts whose change invalidates the map or compass picture. */
export function captureMapPanelDrawState(
	frame: MapPanelFrame,
	panel: MapPanelState,
): MapPanelDrawState {
	return {
		anchor: frame.anchor,
		cameraFovRadians: frame.cameraFovRadians,
		cameraHeadingRadians: frame.cameraHeadingRadians,
		geometryRevision: frame.source?.mapGeometry.revision ?? -1,
		panelSize: panel.size,
		presentedEntityRevision: frame.presentedEntityRevision,
		source: frame.source,
		terrainRevision: frame.source?.terrainInstallationRevision ?? -1,
		viewDiameter: panel.viewDiameter,
	};
}

/** Whether a previously drawn picture still represents the latest imperative read. */
export function sameMapPanelDrawState(
	left: MapPanelDrawState | null,
	right: MapPanelDrawState,
): boolean {
	return (
		left !== null &&
		left.source === right.source &&
		left.terrainRevision === right.terrainRevision &&
		left.geometryRevision === right.geometryRevision &&
		left.presentedEntityRevision === right.presentedEntityRevision &&
		left.cameraFovRadians === right.cameraFovRadians &&
		left.cameraHeadingRadians === right.cameraHeadingRadians &&
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
