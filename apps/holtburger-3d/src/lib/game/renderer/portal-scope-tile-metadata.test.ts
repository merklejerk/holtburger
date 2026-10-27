import { describe, expect, it } from "vitest";
import {
	PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES,
	writePortalScopeAtlasPixel,
	writePortalScopeScreenPixel,
	writePortalScopeTileAtlasNdc,
	writePortalScopeTileMetadata,
} from "./portal-scope-tile-metadata";

const MAPPING_CASE_COUNT = 2_048;
const UNIT_SAMPLES = [0, 0.25, 0.5, 1] as const;

describe("portal scope-tile metadata", () => {
	it("maps screen, atlas, and instanced tile coordinates through one integer record", () => {
		const random = deterministicRandom(0x5c0f_e71e);
		const metadata = new Uint32Array(
			PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES / Uint32Array.BYTES_PER_ELEMENT,
		);
		const point = new Float64Array(2);
		for (let caseIndex = 0; caseIndex < MAPPING_CASE_COUNT; caseIndex += 1) {
			const drawingWidth = integer(random, 32, 4_096);
			const drawingHeight = integer(random, 32, 2_160);
			const width = integer(random, 1, drawingWidth);
			const height = integer(random, 1, drawingHeight);
			const screenX = integer(random, 0, drawingWidth - width);
			const screenY = integer(random, 0, drawingHeight - height);
			const atlasWidth = drawingWidth * 2;
			const atlasHeight = drawingHeight * 3;
			const atlasX = integer(random, 0, atlasWidth - width);
			const atlasY = integer(random, 0, atlasHeight - height);
			writePortalScopeTileMetadata(
				metadata,
				0,
				atlasX,
				atlasY,
				screenX,
				screenY,
				width,
				height,
			);

			for (const unitX of UNIT_SAMPLES) {
				for (const unitY of UNIT_SAMPLES) {
					const sourceX = screenX + width * unitX;
					const sourceY = screenY + height * unitY;
					const expectedAtlasX = atlasX + width * unitX;
					const expectedAtlasY = atlasY + height * unitY;
					writePortalScopeAtlasPixel(metadata, 0, sourceX, sourceY, point, 0);
					expect(point[0], `atlas x case ${caseIndex}/${unitX}`).toBe(
						expectedAtlasX,
					);
					expect(point[1], `atlas y case ${caseIndex}/${unitY}`).toBe(
						expectedAtlasY,
					);

					writePortalScopeScreenPixel(
						metadata,
						0,
						point[0]!,
						point[1]!,
						point,
						0,
					);
					expect(point[0], `screen x case ${caseIndex}/${unitX}`).toBe(sourceX);
					expect(point[1], `screen y case ${caseIndex}/${unitY}`).toBe(sourceY);

					writePortalScopeTileAtlasNdc(
						metadata,
						0,
						unitX,
						unitY,
						atlasWidth,
						atlasHeight,
						point,
						0,
					);
					expect(point[0]).toBeCloseTo(
						(2 * expectedAtlasX) / atlasWidth - 1,
						12,
					);
					expect(point[1]).toBeCloseTo(
						(2 * expectedAtlasY) / atlasHeight - 1,
						12,
					);
				}
			}
		}
	});
});

function deterministicRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_0000_0000;
	};
}

function integer(
	random: () => number,
	minimum: number,
	maximum: number,
): number {
	return minimum + Math.floor(random() * (maximum - minimum + 1));
}
