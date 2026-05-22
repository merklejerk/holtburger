import type { BrowserLocationSelection } from "../../app/browser-mode";
import { browserLocationToLandblockId } from "../../app/browser-mode";
import type { Vec3Dto } from "../host/contracts";
import {
	getOutdoorLandblockCoords,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import {
	deriveChunkRootOffset,
	type RenderChunkKey,
	type RenderChunkPlacement,
	type RenderLandblockAnchor,
} from "./render-chunks";

export type RenderAnchorSource = "browser-destination";

export interface RenderAnchorCandidate {
	anchor: RenderLandblockAnchor;
	source: RenderAnchorSource;
	retainRadius: number;
}

export interface RenderAnchorCommit {
	anchor: RenderLandblockAnchor | null;
	committed: boolean;
	source: RenderAnchorSource | null;
}

export interface RenderChunkTransform {
	chunkKey: RenderChunkKey;
	chunkLandblockId: number;
	offset: Vec3Dto;
}

export const STANDARD_RENDER_ANCHOR_RETAIN_RADIUS = 1;

export function deriveRenderAnchorCandidate(
	browserDestination: BrowserLocationSelection | null,
): RenderAnchorCandidate | null {
	if (!browserDestination) {
		return null;
	}

	return {
		anchor: {
			landblockId: normalizeOutdoorLandblockId(
				browserLocationToLandblockId(browserDestination),
			),
		},
		source: "browser-destination",
		retainRadius: STANDARD_RENDER_ANCHOR_RETAIN_RADIUS,
	};
}

export function commitRenderAnchorCandidate(
	currentAnchor: RenderLandblockAnchor | null,
	candidate: RenderAnchorCandidate | null,
): RenderAnchorCommit {
	if (candidate === null) {
		return {
			anchor: null,
			committed: currentAnchor !== null,
			source: null,
		};
	}

	if (
		currentAnchor === null ||
		isOutsideRetainRadius(
			currentAnchor.landblockId,
			candidate.anchor.landblockId,
			candidate.retainRadius,
		)
	) {
		if (currentAnchor?.landblockId === candidate.anchor.landblockId) {
			return {
				anchor: currentAnchor,
				committed: false,
				source: candidate.source,
			};
		}

		return {
			anchor: candidate.anchor,
			committed: true,
			source: candidate.source,
		};
	}

	return {
		anchor: currentAnchor,
		committed: false,
		source: candidate.source,
	};
}

export function deriveRenderChunkTransforms(
	anchor: RenderLandblockAnchor | null,
	chunks: Iterable<RenderChunkPlacement>,
): RenderChunkTransform[] {
	if (anchor === null) {
		return [];
	}

	const chunksByKey = new Map<RenderChunkKey, RenderChunkPlacement>();
	for (const chunk of chunks) {
		chunksByKey.set(chunk.chunkKey, chunk);
	}

	return [...chunksByKey.values()]
		.sort((left, right) => left.chunkKey.localeCompare(right.chunkKey))
		.map((chunk) => ({
			chunkKey: chunk.chunkKey,
			chunkLandblockId: chunk.chunkLandblockId,
			offset: deriveChunkRootOffset(chunk.chunkLandblockId, anchor.landblockId),
		}));
}

function isOutsideRetainRadius(
	anchorLandblockId: number,
	focusLandblockId: number,
	retainRadius: number,
): boolean {
	const radius = Math.max(0, Math.trunc(retainRadius));
	const anchorCoords = getOutdoorLandblockCoords(anchorLandblockId);
	const focusCoords = getOutdoorLandblockCoords(focusLandblockId);
	const distance = Math.max(
		Math.abs(focusCoords.x - anchorCoords.x),
		Math.abs(focusCoords.y - anchorCoords.y),
	);

	return distance > radius;
}
