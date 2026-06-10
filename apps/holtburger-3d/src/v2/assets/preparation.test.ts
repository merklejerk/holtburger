import { describe, expect, it } from "vitest";
import type { AssetLookupResponseDto } from "../../lib/host/contracts";
import type { HostAssetKey } from "./contracts";
import {
	createHostAssetLookupRequest,
	prepareHostAssetResponse,
} from "./preparation";

describe("V2 host asset preparation", () => {
	it("creates host lookup requests from typed V2 keys", () => {
		const key: HostAssetKey = {
			id: "da55ffff",
			kind: "landblock-outdoor",
		};

		expect(createHostAssetLookupRequest(key, "request-1")).toEqual({
			assetId: "landblock/da55ffff/outdoor",
			priority: "streaming",
			requestId: "request-1",
		});
	});

	it("prepares host responses into V2 prepared assets without exposing old records", () => {
		const key: HostAssetKey = {
			id: "04000001",
			kind: "palette",
		};
		const response: AssetLookupResponseDto = {
			assetId: "palette/04000001",
			payload: {
				colorCount: 2,
				colorsArgb: [0xff112233, 0x80445566],
				kind: "palette",
				paletteId: 0x04000001,
				provenance: {
					detail: null,
					errorCode: null,
					source: "repo-local-hba",
					sourceAssetKind: "palette",
				},
				residencyKind: "unknown",
				sourceAssetKind: "palette",
			},
			payloadKind: "json",
			requestId: "request-1",
		};

		const prepared = prepareHostAssetResponse({
			key,
			now: () => new Date("2026-06-10T00:00:00.000Z"),
			requestId: "request-1",
			response,
			revision: 4,
		});

		expect(prepared).toMatchObject({
			key,
			preparedAt: "2026-06-10T00:00:00.000Z",
			revision: 4,
			sourceAssetId: "palette/04000001",
		});
		expect(prepared.payload).toMatchObject({ kind: "palette" });
	});
});
