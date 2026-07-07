import { describe, expect, it } from "vitest";

import {
	estimateVisualGeometryPayloadBufferBytes,
	type VisualGeometryPayload,
} from "./visual-geometry";

describe("visual geometry payloads", () => {
	it("estimates uploaded buffer bytes from shared geometry arrays", () => {
		const payload: VisualGeometryPayload = {
			bounds: null,
			indices: new Uint32Array([0, 1, 2]),
			indexType: "uint32",
			materialEntries: [],
			materialFamily: "flat-color",
			materialPass: "opaque",
			materialSlotIndices: new Float32Array([0, 0, 0]),
			positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			renderState: {
				blend: {
					dstFactor: null,
					enabled: false,
					mode: "opaque",
					srcFactor: null,
				},
				depthTest: true,
				depthWrite: true,
			},
			texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
			textureBindingIds: [],
			triangleCount: 1,
			vertexCount: 3,
		};

		expect(estimateVisualGeometryPayloadBufferBytes(payload)).toBe(
			payload.positions.byteLength +
				payload.texCoords.byteLength +
				payload.materialSlotIndices.byteLength +
				payload.indices.byteLength,
		);
	});
});
