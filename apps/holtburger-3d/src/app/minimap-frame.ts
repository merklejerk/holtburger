import type { ResizeEdges } from "./resize-edges";
import type { MapEntity } from "../lib/game/map/map-blips";
import type { MapWaypointDisplay } from "../lib/game/map/map-waypoint";
import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import {
	type MapAnchor,
	mapEnvironment,
	type MapViewParameters,
} from "../lib/game/map/map-view";

/** Independently remembered map extents for the two geometry modes. */
interface MinimapViewDiameters {
	/** World-metre diameter restored whenever the anchor is inside an EnvCell. */
	readonly indoor: number;
	/** World-metre diameter restored outdoors or while residency is unknown. */
	readonly outdoor: number;
}

/** Subject the map follows and whether it represents a controlled entity or a free camera. */
export type MinimapSubject =
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

/** Complete below-disc geometry, reported by the shared footer to its placement owner. */
export interface MinimapFooterExtent {
	/** Full centered footer width, including any overhang beyond the disc. */
	readonly width: number;
	/** Space below the disc, including padding and gaps between readout rows. */
	readonly height: number;
}

/** Minimap geometry and view choices, owned by whichever shell mounts the widget. */
export interface MinimapState {
	readonly left: number;
	readonly top: number;
	readonly size: number;
	readonly viewDiameters: MinimapViewDiameters;
}

/** Client-shell limits for the disc; viewport height already reserves the footer's height. */
export interface MinimapResizeBounds {
	/** Usable horizontal viewport extent in CSS pixels. */
	readonly width: number;
	/** Usable vertical disc extent in CSS pixels. */
	readonly height: number;
	/** Centered readout width, which can extend beyond a small disc. */
	readonly footerWidth: number;
}

/** Resize the square map, keeping the opposing borders stationary on the dragged axes. */
export function resizeMinimapBounds(
	start: Pick<MinimapState, "left" | "top" | "size">,
	minimumSize: number,
	deltaX: number,
	deltaY: number,
	edges: ResizeEdges,
	bounds: MinimapResizeBounds | null,
): Pick<MinimapState, "left" | "top" | "size"> {
	let delta: number;
	if (edges.horizontal === undefined) {
		delta = edges.vertical === "top" ? -deltaY : deltaY;
	} else {
		const horizontal = edges.horizontal === "left" ? -deltaX : deltaX;
		const vertical = edges.vertical === "top" ? -deltaY : deltaY;
		// Corners follow the dominant axis for both growth and shrinkage.
		delta =
			edges.vertical === undefined || Math.abs(horizontal) >= Math.abs(vertical)
				? horizontal
				: vertical;
	}
	let size = Math.max(minimumSize, Math.round(start.size + delta));
	if (bounds !== null) {
		const horizontalSpace =
			edges.horizontal === "left"
				? start.left + start.size
				: bounds.width - start.left;
		const verticalSpace =
			edges.vertical === "top"
				? start.top + start.size
				: bounds.height - start.top;
		// A centered footer needs half its width on either side of the disc center.
		// Solve that constraint before anchoring, so the shell does not have to shift the resized disc.
		const footerWidth = Math.min(bounds.footerWidth, bounds.width);
		const maximum = Math.max(
			0,
			Math.min(
				horizontalSpace,
				2 * horizontalSpace - footerWidth,
				verticalSpace,
			),
		);
		// Shrinking cannot make the footer overhang the stationary side of the disc.
		const footerMinimum = footerWidth - 2 * (bounds.width - horizontalSpace);
		size = Math.min(Math.max(size, footerMinimum), maximum);
	}
	return {
		size,
		left: start.left + (edges.horizontal === "left" ? start.size - size : 0),
		top: start.top + (edges.vertical === "top" ? start.size - size : 0),
	};
}

/** One imperative read of every hot input the map and compass render. */
export interface MinimapFrame {
	/** Profile-resolved surface-map eligibility for the subject; false until scene demand admits it. */
	readonly surfaceMapEligible: boolean;
	/** Local navigation display; null in modes without a waypoint or before one is set. */
	readonly waypoint: MapWaypointDisplay | null;
	/** Null until the runtime is ready; the map remains blank meanwhile. */
	readonly source: MapTerrainSource | null;
	/** Null until there is a coherent subject position and ownership. */
	readonly subject: MinimapSubject | null;
	readonly presentedEntities: () => Iterable<MapEntity>;
	/** Cold selected identity; the widget samples it with the rest of its bounded frame. */
	readonly selectedGuid: number | null;
	/** Optional app-owned tracked identities; absent in Explorer and undecorated frames. */
	readonly trackedGuids?: ReadonlySet<number>;
	/** Camera field of view in radians, drawn as the view cone. */
	readonly cameraFovRadians: number;
	/** Camera bearing, distinct from the possessed subject's bearing. */
	readonly cameraHeadingRadians: number;
}

/** Facts captured for the last completed WebGL map draw. */
export interface MinimapGpuDrawState {
	readonly source: MapTerrainSource | null;
	readonly terrainRevision: number;
	readonly geometryRevision: number;
	/** Renderer-consumed projection of the current map view. */
	readonly view: MinimapGpuViewState | null;
	readonly minimapSize: number;
}

/** Exact map-view facts whose changes invalidate the WebGL terrain and surface picture. */
interface MinimapGpuViewState {
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
export function captureMinimapGpuDrawState(
	frame: MinimapFrame,
	state: MinimapState,
	view: MapViewParameters | null,
): MinimapGpuDrawState {
	return {
		geometryRevision: frame.source?.mapGeometry.revision ?? -1,
		minimapSize: state.size,
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
export function minimapViewDiameter(
	state: MinimapState,
	anchor: MapAnchor | null,
): number {
	return state.viewDiameters[mapEnvironment(anchor)];
}

/** Whether a previously drawn WebGL picture still represents the latest imperative read. */
export function sameMinimapGpuDrawState(
	left: MinimapGpuDrawState | null,
	right: MinimapGpuDrawState,
): boolean {
	return (
		left !== null &&
		left.source === right.source &&
		left.terrainRevision === right.terrainRevision &&
		left.geometryRevision === right.geometryRevision &&
		left.minimapSize === right.minimapSize &&
		sameGpuView(left.view, right.view)
	);
}

function sameGpuView(
	left: MinimapGpuViewState | null,
	right: MinimapGpuViewState | null,
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
