import { describe, expect, it } from "vitest";

import {
	chunkLocalPointToRendererLocal,
	convertCameraFrameBetweenAnchors,
	deriveChunkRootOffset,
	deriveDebugOverlayRenderChunk,
	deriveLandblockRenderChunkPlacement,
	deriveRenderChunkKeyFromEnvCellId,
	deriveRenderChunkKeyFromLandblockId,
	deriveStaticRenderablePartRenderChunk,
	deriveStructuredCellRenderChunk,
	rendererLocalPointToChunkLocal,
} from "./render-chunks";

describe("render chunk helpers", () => {
	it("derives normalized landblock chunk keys from landblock and env-cell ids", () => {
		expect(deriveRenderChunkKeyFromLandblockId(0xda550123)).toBe(
			"landblock/da55ffff",
		);
		expect(deriveRenderChunkKeyFromEnvCellId(0x016c0155)).toBe(
			"landblock/016cffff",
		);
	});

	it("derives owning render chunks for current scene item sources", () => {
		expect(deriveLandblockRenderChunkPlacement(0x01020304)).toEqual({
			chunkKey: "landblock/0102ffff",
			chunkLandblockId: 0x0102ffff,
		});
		expect(deriveStructuredCellRenderChunk(0x016c0155)).toEqual({
			chunkKey: "landblock/016cffff",
			chunkLandblockId: 0x016cffff,
		});
		expect(deriveDebugOverlayRenderChunk(0x016c0155)).toEqual({
			chunkKey: "landblock/016cffff",
			chunkLandblockId: 0x016cffff,
		});
		expect(
			deriveStaticRenderablePartRenderChunk({
				owningLandblockId: 0xda55ffff,
				owningEnvCellId: null,
			}),
		).toEqual({
			chunkKey: "landblock/da55ffff",
			chunkLandblockId: 0xda55ffff,
		});
		expect(
			deriveStaticRenderablePartRenderChunk({
				owningLandblockId: 0xda55ffff,
				owningEnvCellId: 0x016c0155,
			}),
		).toEqual({
			chunkKey: "landblock/016cffff",
			chunkLandblockId: 0x016cffff,
		});
	});

	it("keeps neighboring outdoor landblock offsets stable at 192 meters", () => {
		expect(deriveChunkRootOffset(0xda55ffff, 0xda55ffff)).toEqual({
			x: 0,
			y: 0,
			z: 0,
		});
		expect(deriveChunkRootOffset(0xdb55ffff, 0xda55ffff)).toEqual({
			x: 192,
			y: 0,
			z: 0,
		});
		expect(deriveChunkRootOffset(0xda56ffff, 0xda55ffff)).toEqual({
			x: 0,
			y: 0,
			z: -192,
		});
	});

	it("rebases chunk roots while preserving chunk-local positions", () => {
		const chunkLandblockId = 0xdb56ffff;
		const oldAnchorLandblockId = 0xda55ffff;
		const newAnchorLandblockId = 0xdb55ffff;
		const chunkLocalPoint = { x: 12, y: 3, z: -7 };
		const oldRendererPoint = chunkLocalPointToRendererLocal(
			chunkLocalPoint,
			chunkLandblockId,
			oldAnchorLandblockId,
		);
		const newRendererPoint = chunkLocalPointToRendererLocal(
			chunkLocalPoint,
			chunkLandblockId,
			newAnchorLandblockId,
		);

		expect(oldRendererPoint).toEqual({ x: 204, y: 3, z: -199 });
		expect(newRendererPoint).toEqual({ x: 12, y: 3, z: -199 });
		expect(
			rendererLocalPointToChunkLocal(
				newRendererPoint,
				chunkLandblockId,
				newAnchorLandblockId,
			),
		).toEqual(chunkLocalPoint);
	});

	it("converts camera frames across anchor changes without changing canonical position", () => {
		const chunkLandblockId = 0xdb56ffff;
		const oldAnchorLandblockId = 0xda55ffff;
		const newAnchorLandblockId = 0xdb55ffff;
		const canonicalChunkLocalPosition = { x: 40, y: 30, z: -20 };
		const oldRendererPosition = chunkLocalPointToRendererLocal(
			canonicalChunkLocalPosition,
			chunkLandblockId,
			oldAnchorLandblockId,
		);
		const convertedFrame = convertCameraFrameBetweenAnchors(
			{
				position: oldRendererPosition,
				target: {
					x: oldRendererPosition.x,
					y: 30,
					z: oldRendererPosition.z - 10,
				},
				up: { x: 0, y: 1, z: 0 },
				aspect: 1,
				fovDegrees: 52,
				near: 0.1,
				far: 5000,
			},
			oldAnchorLandblockId,
			newAnchorLandblockId,
		);

		expect(convertedFrame.position).toEqual(
			chunkLocalPointToRendererLocal(
				canonicalChunkLocalPosition,
				chunkLandblockId,
				newAnchorLandblockId,
			),
		);
		expect(convertedFrame.target).toEqual({ x: 40, y: 30, z: -222 });
		expect(convertedFrame.up).toEqual({ x: 0, y: 1, z: 0 });
	});
});
