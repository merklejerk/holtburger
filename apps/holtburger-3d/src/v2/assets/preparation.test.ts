import { describe, expect, it } from "vitest";
import type { AssetLookupResponseDto } from "../../lib/host/contracts";
import type { HostAssetKey } from "./contracts";
import { prepareV2StaticAssetPayload } from "./preparation/route-payloads";
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
		expect(prepared.payload).toMatchObject({
			colorsArgb: expect.any(Uint32Array),
		});
	});

	it("fails hard when a host response id does not match the requested key", () => {
		const key: HostAssetKey = {
			id: "04000001",
			kind: "palette",
		};

		expect(() =>
			prepareHostAssetResponse({
				key,
				requestId: "request-1",
				response: {
					assetId: "palette/04000002",
					payload: {},
					payloadKind: "json",
					requestId: "request-1",
				},
				revision: 1,
			}),
		).toThrow("Host response asset id palette/04000002 did not match");
	});

	it("recognizes every V2 static asset route and reports route-specific schema failures", () => {
		const routes = [
			["landblock/da55ffff/outdoor", "landblock-outdoor"],
			["landblock/da55ffff/topology", "landblock-topology"],
			["gfx-obj/01000001", "gfx-obj"],
			["setup-model/02000001", "setup-model"],
			["setup-appearance/02000001", "setup-appearance"],
			["material/08000001", "material-recipe"],
			["terrain-material/1", "terrain-material"],
			["region-render-profile/1", "region-render-profile"],
			["surface-texture/06000001", "surface-texture"],
			["render-surface/06000001", "render-surface"],
			["prepared-texture/06000001?usage=color", "prepared-texture"],
			["palette/04000001", "palette"],
		] as const;

		for (const [assetId, expectedKind] of routes) {
			expect(() =>
				prepareV2StaticAssetPayload({
					assetId,
					payload: { kind: "definitely-wrong" },
					payloadKind: "json",
					requestId: "request-1",
				}),
			).toThrow(
				`Asset ${assetId} matched the ${expectedKind} route but its payload failed the ${expectedKind} contract`,
			);
		}
	});

	it("rejects routes outside the V2 static preparation set", () => {
		expect(() =>
			prepareV2StaticAssetPayload({
				assetId: "unknown-static/01000001",
				payload: {},
				payloadKind: "json",
				requestId: "request-1",
			}),
		).toThrow("V2 asset preparation does not support host asset route");
	});
});
