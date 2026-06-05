import type { SceneBoundsFrame } from "./camera";
import {
	getDetailedLandblockRenderArtifacts,
	getLandblockTerrainRenderArtifact,
	getStaticObjectBundleArtifacts,
} from "./landblock-render-product";
import {
	transformEnvCellLocalBoundsByPlacement,
	transformTerrainLocalBounds,
} from "./prepared-bvh-bounds";
import { deriveLandblockRenderChunkPlacement } from "./render-chunks";
import type { RenderChunkTransform } from "./render-anchor";
import {
	renderBoundsCenter,
	renderBoundsSize,
	unionRenderBounds,
	type RenderBounds,
} from "./render-spatial-math";
import type { StaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";

const ARTIFACT_SCENE_MINIMUM_SPAN = 180;

export function calculateStaticLandblockArtifactSceneBoundsFrame(options: {
	artifacts: StaticLandblockRenderProductSet;
	renderChunkTransforms: readonly RenderChunkTransform[];
}): SceneBoundsFrame | null {
	const chunkTransformsByKey = new Map(
		options.renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform,
		]),
	);
	const bounds = collectStaticLandblockArtifactSceneBounds({
		artifacts: options.artifacts,
		chunkTransformsByKey,
	});
	if (bounds.length === 0) {
		return null;
	}
	const union = unionRenderBounds(bounds);
	return {
		center: renderBoundsCenter(union),
		size: renderBoundsSize(union),
		minimumSpan: ARTIFACT_SCENE_MINIMUM_SPAN,
	};
}

function collectStaticLandblockArtifactSceneBounds({
	artifacts,
	chunkTransformsByKey,
}: {
	artifacts: StaticLandblockRenderProductSet;
	chunkTransformsByKey: ReadonlyMap<string, RenderChunkTransform>;
}): RenderBounds[] {
	const bounds: RenderBounds[] = [];
	for (const result of artifacts.artifacts) {
		const terrain = getLandblockTerrainRenderArtifact(result);
		if (terrain) {
			const renderChunk = deriveLandblockRenderChunkPlacement(
				terrain.landblockId,
			);
			const transform = chunkTransformsByKey.get(renderChunk.chunkKey);
			const root = terrain.bvh.nodes[0];
			if (transform && root) {
				bounds.push(
					transformTerrainLocalBounds(root.bounds, transform.offset),
				);
			}
		}

		for (const bundle of getStaticObjectBundleArtifacts(result)) {
			bounds.push(...(bundle.spatialHints ?? []).map((hint) => hint.bounds));
		}

		const detailed = getDetailedLandblockRenderArtifacts(result);
		if (!detailed) {
			continue;
		}
		for (const localBvh of detailed.spatial.envCellLocalBvhs) {
			const cell = detailed.structuredInteriorCells.find(
				(candidate) => candidate.envCellId === localBvh.envCellId,
			);
			const transform = cell
				? chunkTransformsByKey.get(cell.renderChunk.chunkKey)
				: null;
			const root = localBvh.localBvh.nodes[0];
			if (cell && transform && root) {
				bounds.push(
					transformEnvCellLocalBoundsByPlacement(
						root.bounds,
						localBvh.localPlacement,
						transform,
					),
				);
			}
		}
	}
	return bounds;
}
