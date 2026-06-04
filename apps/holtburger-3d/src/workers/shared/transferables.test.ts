import { describe, expect, it } from "vitest";

import type { PreparedAssetRecord } from "../../lib/assets/types";
import { prepareAssetForPostMessage } from "./transferables";

describe("worker transferables", () => {
	it("summarizes prepared responses and transfers normalized payload buffers", () => {
		const source = new Uint32Array([0x01020304, 0x05060708, 0x090a0b0c]);
		const asset: PreparedAssetRecord = {
			request: {
				requestId: "request-palette",
				assetId: "palette/04000001",
				priority: "streaming",
			},
			response: {
				requestId: "request-palette",
				assetId: "palette/04000001",
				payloadKind: "json",
				payload: { kind: "palette", large: true },
			},
			payload: {
				kind: "palette",
				sourceAssetKind: "palette",
				residencyKind: "unknown",
				provenance: {
					source: "repo-local-hba",
					sourceAssetKind: "palette",
					errorCode: null,
					detail: null,
				},
				paletteId: 0x04000001,
				colorCount: 2,
				colorsArgb: source.subarray(1),
			},
			preparedAt: "2026-06-04T00:00:00.000Z",
		};

		const transferables = prepareAssetForPostMessage(asset);

		expect(asset.response.payload).toEqual({
			kind: "prepared-response-summary",
		});
		expect(asset.payload.kind).toBe("palette");
		if (asset.payload.kind !== "palette") {
			throw new Error("expected palette payload");
		}
		expect(Array.from(asset.payload.colorsArgb)).toEqual([
			0x05060708, 0x090a0b0c,
		]);
		expect(asset.payload.colorsArgb.byteOffset).toBe(0);
		expect(transferables).toEqual([asset.payload.colorsArgb.buffer]);
	});
});
