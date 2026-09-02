import {
	MAP_BLIP_MAXIMUM_ELEVATION_BRIGHTNESS_ADJUSTMENT,
	mapBrightnessAdjustedChannelByte,
	mapElevationBrightness,
} from "../lib/game/map/map-appearance";
import {
	mapEnvironment,
	projectMapWorldPoint,
	type ProjectedMapView,
} from "../lib/game/map/map-view";
import type { NormalizedRgbColor } from "../lib/frontend-color";
import type {
	MinimapBreadcrumb,
	MinimapBreadcrumbTrail,
} from "./minimap-breadcrumb-trail";
import {
	MINIMAP_BREADCRUMB_COLOR,
	MINIMAP_BREADCRUMB_HALO_COLOR,
	MINIMAP_BREADCRUMB_HALO_WIDTH_PIXELS,
	MINIMAP_BREADCRUMB_NEWEST_OPACITY,
	MINIMAP_BREADCRUMB_OLDEST_OPACITY,
	MINIMAP_BREADCRUMB_RADIUS_PIXELS,
} from "./minimap-tuning";

/** Fixed opacity resolution; more bands add Canvas state changes without adding route information. */
const MINIMAP_BREADCRUMB_AGE_BUCKET_COUNT = 4;
/** Below, same-level, and above bands reuse the map's signed elevation language. */
const MINIMAP_BREADCRUMB_ELEVATION_BUCKET_COUNT = 3;
/** Hard upper bound on breadcrumb paths filled during one overlay repaint. */
export const MINIMAP_BREADCRUMB_MAXIMUM_FILL_CALLS =
	MINIMAP_BREADCRUMB_AGE_BUCKET_COUNT *
	MINIMAP_BREADCRUMB_ELEVATION_BUCKET_COUNT;
/** Hard upper bound on age-batched halo strokes during one overlay repaint. */
export const MINIMAP_BREADCRUMB_MAXIMUM_STROKE_CALLS =
	MINIMAP_BREADCRUMB_AGE_BUCKET_COUNT;
/** Total fixed paint budget for cores and halos during one overlay repaint. */
export const MINIMAP_BREADCRUMB_MAXIMUM_PAINT_CALLS =
	MINIMAP_BREADCRUMB_MAXIMUM_FILL_CALLS +
	MINIMAP_BREADCRUMB_MAXIMUM_STROKE_CALLS;

/** Narrow Canvas surface needed to batch and fill breadcrumb circles. */
export type MinimapBreadcrumbCanvas = Pick<
	CanvasRenderingContext2D,
	| "arc"
	| "beginPath"
	| "fill"
	| "fillStyle"
	| "lineWidth"
	| "moveTo"
	| "stroke"
	| "strokeStyle"
>;

type BreadcrumbBucket = number[];

/**
 * Draw one retained trail using at most sixteen Canvas paint calls and style changes.
 *
 * Every visible sample is projected once into a flat coordinate bucket. Bucket paths are then
 * painted oldest-first so newer route evidence wins where history overlaps itself. One dark
 * age-batched halo plus elevation-colored cores preserves contrast without reading map pixels.
 */
export function drawMinimapBreadcrumbTrail(
	context: MinimapBreadcrumbCanvas,
	trail: MinimapBreadcrumbTrail,
	projection: ProjectedMapView,
	canvasSize: number,
): void {
	if (trail.kind === "empty") return;
	if (!Number.isFinite(canvasSize) || canvasSize <= 0) {
		throw new Error(
			`Minimap breadcrumb canvas size must be positive; received ${canvasSize}.`,
		);
	}

	const buckets = Array.from(
		{ length: MINIMAP_BREADCRUMB_MAXIMUM_FILL_CALLS },
		(): BreadcrumbBucket => [],
	);
	const environment = mapEnvironment(projection.view.anchor);
	for (let index = 0; index < trail.samples.length; index += 1) {
		const sample = trail.samples[index];
		const [clipX, clipY] = projectMapWorldPoint(
			projection.worldToClip,
			projection.view,
			sample.worldX,
			sample.worldZ,
		);
		if (Math.abs(clipX) > 1 || Math.abs(clipY) > 1) continue;
		const ageBucket =
			trail.samples.length === 1
				? 0
				: Math.round(
						(index * (MINIMAP_BREADCRUMB_AGE_BUCKET_COUNT - 1)) /
							(trail.samples.length - 1),
					);
		const elevationBucket = breadcrumbElevationBucket(
			sample,
			projection.view.anchor.worldY,
			environment,
		);
		const bucket =
			buckets[
				ageBucket * MINIMAP_BREADCRUMB_ELEVATION_BUCKET_COUNT + elevationBucket
			];
		// Clip space is [-1, 1] with +Y up; Canvas pixels run down from the top-left.
		bucket.push(((clipX + 1) / 2) * canvasSize, ((1 - clipY) / 2) * canvasSize);
	}

	for (
		let ageBucket = MINIMAP_BREADCRUMB_AGE_BUCKET_COUNT - 1;
		ageBucket >= 0;
		ageBucket -= 1
	) {
		let haloPathStarted = false;
		for (
			let elevationBucket = 0;
			elevationBucket < MINIMAP_BREADCRUMB_ELEVATION_BUCKET_COUNT;
			elevationBucket += 1
		) {
			const bucket = bucketAt(buckets, ageBucket, elevationBucket);
			if (bucket.length === 0) continue;
			if (!haloPathStarted) {
				context.beginPath();
				haloPathStarted = true;
			}
			appendBreadcrumbCircles(context, bucket);
		}
		if (haloPathStarted) {
			context.lineWidth = MINIMAP_BREADCRUMB_HALO_WIDTH_PIXELS * 2;
			context.strokeStyle = breadcrumbHaloStrokeStyle(ageBucket);
			context.stroke();
		}

		for (
			let elevationBucket = 0;
			elevationBucket < MINIMAP_BREADCRUMB_ELEVATION_BUCKET_COUNT;
			elevationBucket += 1
		) {
			const bucket = bucketAt(buckets, ageBucket, elevationBucket);
			if (bucket.length === 0) continue;
			context.beginPath();
			appendBreadcrumbCircles(context, bucket);
			context.fillStyle = breadcrumbCoreFillStyle(ageBucket, elevationBucket);
			context.fill();
		}
	}
}

function bucketAt(
	buckets: readonly BreadcrumbBucket[],
	ageBucket: number,
	elevationBucket: number,
): BreadcrumbBucket {
	return buckets[
		ageBucket * MINIMAP_BREADCRUMB_ELEVATION_BUCKET_COUNT + elevationBucket
	];
}

function appendBreadcrumbCircles(
	context: MinimapBreadcrumbCanvas,
	bucket: BreadcrumbBucket,
): void {
	for (let coordinate = 0; coordinate < bucket.length; coordinate += 2) {
		const x = bucket[coordinate];
		const y = bucket[coordinate + 1];
		// Moving to each circumference prevents Canvas from joining separate arcs by a line.
		context.moveTo(x + MINIMAP_BREADCRUMB_RADIUS_PIXELS, y);
		context.arc(x, y, MINIMAP_BREADCRUMB_RADIUS_PIXELS, 0, Math.PI * 2);
	}
}

function breadcrumbElevationBucket(
	sample: MinimapBreadcrumb,
	anchorHeight: number,
	environment: "indoor" | "outdoor",
): number {
	const brightness = mapElevationBrightness(
		sample.worldY - anchorHeight,
		environment,
	);
	const halfBand = MAP_BLIP_MAXIMUM_ELEVATION_BRIGHTNESS_ADJUSTMENT / 2;
	if (brightness < 1 - halfBand) return 0;
	if (brightness > 1 + halfBand) return 2;
	return 1;
}

function breadcrumbCoreFillStyle(
	ageBucket: number,
	elevationBucket: number,
): string {
	const brightness =
		1 +
		(elevationBucket - 1) * MAP_BLIP_MAXIMUM_ELEVATION_BRIGHTNESS_ADJUSTMENT;
	return breadcrumbColorStyle(
		MINIMAP_BREADCRUMB_COLOR,
		brightness,
		breadcrumbOpacity(ageBucket),
	);
}

function breadcrumbHaloStrokeStyle(ageBucket: number): string {
	return breadcrumbColorStyle(
		MINIMAP_BREADCRUMB_HALO_COLOR,
		1,
		breadcrumbOpacity(ageBucket),
	);
}

function breadcrumbOpacity(ageBucket: number): number {
	const ageFraction = ageBucket / (MINIMAP_BREADCRUMB_AGE_BUCKET_COUNT - 1);
	return (
		MINIMAP_BREADCRUMB_NEWEST_OPACITY +
		(MINIMAP_BREADCRUMB_OLDEST_OPACITY - MINIMAP_BREADCRUMB_NEWEST_OPACITY) *
			ageFraction
	);
}

function breadcrumbColorStyle(
	color: NormalizedRgbColor,
	brightness: number,
	opacity: number,
): string {
	return `rgba(${mapBrightnessAdjustedChannelByte(color.red, brightness)}, ${mapBrightnessAdjustedChannelByte(color.green, brightness)}, ${mapBrightnessAdjustedChannelByte(color.blue, brightness)}, ${opacity})`;
}
