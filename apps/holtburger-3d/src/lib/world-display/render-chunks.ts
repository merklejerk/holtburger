import type { Vec3Dto } from "../host/contracts";
import {
	formatHex32,
	getOutdoorLandblockCoords,
	normalizeOutdoorLandblockId,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";

export type RenderChunkKey = `landblock/${string}`;

export interface RenderLandblockAnchor {
	landblockId: number;
}

export interface RenderChunkPlacement {
	chunkKey: RenderChunkKey;
	chunkLandblockId: number;
}

export interface RenderCameraFrame {
	position: Vec3Dto;
	target: Vec3Dto;
	up: Vec3Dto;
	aspect: number;
	fovDegrees: number;
	near: number;
	far: number;
}

export interface StaticRenderableChunkSource {
	owningLandblockId: number;
	owningEnvCellId: number | null;
}

export function deriveRenderChunkKeyFromLandblockId(
	landblockId: number,
): RenderChunkKey {
	return `landblock/${formatHex32(deriveRenderChunkLandblockId(landblockId))}`;
}

export function deriveRenderChunkKeyFromEnvCellId(
	envCellId: number,
): RenderChunkKey {
	return deriveRenderChunkKeyFromLandblockId(envCellId);
}

function deriveRenderChunkLandblockId(landblockId: number): number {
	return normalizeOutdoorLandblockId(landblockId);
}

export function deriveTerrainTileRenderChunk(
	landblockId: number,
): RenderChunkPlacement {
	return buildRenderChunkPlacement(landblockId);
}

export function deriveStructuredCellRenderChunk(
	envCellId: number,
): RenderChunkPlacement {
	return buildRenderChunkPlacement(envCellId);
}

export function deriveDebugOverlayRenderChunk(
	envCellId: number,
): RenderChunkPlacement {
	return deriveStructuredCellRenderChunk(envCellId);
}

export function deriveStaticRenderablePartRenderChunk(
	part: StaticRenderableChunkSource,
): RenderChunkPlacement {
	return buildRenderChunkPlacement(
		part.owningEnvCellId ?? part.owningLandblockId,
	);
}

export function deriveChunkRootOffset(
	chunkLandblockId: number,
	anchorLandblockId: number,
): Vec3Dto {
	const chunkCoords = getOutdoorLandblockCoords(chunkLandblockId);
	const anchorCoords = getOutdoorLandblockCoords(anchorLandblockId);

	return {
		x: normalizeZero(
			(chunkCoords.x - anchorCoords.x) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
		y: 0,
		z: normalizeZero(
			-(chunkCoords.y - anchorCoords.y) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
	};
}

export function chunkLocalPointToRendererLocal(
	point: Vec3Dto,
	chunkLandblockId: number,
	anchorLandblockId: number,
): Vec3Dto {
	return addVec3(
		point,
		deriveChunkRootOffset(chunkLandblockId, anchorLandblockId),
	);
}

export function rendererLocalPointToChunkLocal(
	point: Vec3Dto,
	chunkLandblockId: number,
	anchorLandblockId: number,
): Vec3Dto {
	return subtractVec3(
		point,
		deriveChunkRootOffset(chunkLandblockId, anchorLandblockId),
	);
}

export function convertCameraFrameBetweenAnchors<
	TFrame extends RenderCameraFrame,
>(
	frame: TFrame,
	oldAnchorLandblockId: number,
	newAnchorLandblockId: number,
): TFrame {
	const rebaseOffset = deriveAnchorRebaseOffset(
		oldAnchorLandblockId,
		newAnchorLandblockId,
	);

	return {
		...frame,
		position: addVec3(frame.position, rebaseOffset),
		target: addVec3(frame.target, rebaseOffset),
		up: { ...frame.up },
	};
}

function deriveAnchorRebaseOffset(
	oldAnchorLandblockId: number,
	newAnchorLandblockId: number,
): Vec3Dto {
	const oldAnchorCoords = getOutdoorLandblockCoords(oldAnchorLandblockId);
	const newAnchorCoords = getOutdoorLandblockCoords(newAnchorLandblockId);

	return {
		x: normalizeZero(
			(oldAnchorCoords.x - newAnchorCoords.x) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
		y: 0,
		z: normalizeZero(
			(newAnchorCoords.y - oldAnchorCoords.y) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
	};
}

function buildRenderChunkPlacement(
	landblockOrEnvCellId: number,
): RenderChunkPlacement {
	const chunkLandblockId = deriveRenderChunkLandblockId(landblockOrEnvCellId);

	return {
		chunkKey: deriveRenderChunkKeyFromLandblockId(chunkLandblockId),
		chunkLandblockId,
	};
}

function addVec3(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.x + right.x,
		y: left.y + right.y,
		z: left.z + right.z,
	};
}

function subtractVec3(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.x - right.x,
		y: left.y - right.y,
		z: left.z - right.z,
	};
}

function normalizeZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}
