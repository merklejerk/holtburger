import { describe, expect, it } from "vitest";
import type { PreparedAsset } from "../contracts";
import type { PreparedTextureUseIdentity } from "../../static/contracts";
import {
	createPreparedTextureHostKey,
	prepareDirectRgbaTextureSource,
} from "./prepared-texture-source";

describe("V2 prepared texture source preparation", () => {
	it("creates host keys with the prepared-texture transport query spelling", () => {
		expect(createPreparedTextureHostKey(createTextureUse())).toEqual({
			id: "06000010?cs=linear&mips=none&out=rgba8&usage=color",
			kind: "prepared-texture",
		});
	});

	it("converts normalized rgba8 payloads into direct texture sources", () => {
		const source = prepareDirectRgbaTextureSource(
			createPreparedAsset({
				levelFormat: "A8R8G8B8",
				outputFormat: "rgba8",
			}),
			createTextureUse(),
		);

		expect(source).toMatchObject({
			colorSpace: "linear",
			height: 1,
			kind: "direct-rgba-texture-source",
			mipPolicy: "none",
			outputFormat: "rgba8",
			renderSurfaceId: 0x06000010,
			usage: "color",
			width: 1,
		});
		expect(Array.from(source.pixels)).toEqual([255, 128, 0, 255]);
	});

	it("rejects payloads whose policy does not match the requested texture use", () => {
		expect(() =>
			prepareDirectRgbaTextureSource(
				createPreparedAsset({ outputFormat: "dxt1" }),
				createTextureUse(),
			),
		).toThrow("does not match the requested texture-use policy");
	});

	it("rejects unsupported direct texture policies after request matching", () => {
		expect(() =>
			prepareDirectRgbaTextureSource(
				createPreparedAsset({ colorSpace: "srgb", outputFormat: "rgba8" }),
				createTextureUse({ colorSpace: "srgb" }),
			),
		).toThrow("unsupported direct texture policy rgba8/none/srgb");
	});

	it("rejects invalid normalized rgba8 byte lengths", () => {
		expect(() =>
			prepareDirectRgbaTextureSource(
				createPreparedAsset({ byteLength: 3, outputFormat: "rgba8" }),
				createTextureUse(),
			),
		).toThrow("expected 4 rgba8 bytes, got 3");
	});
});

function createTextureUse(
	overrides: Partial<PreparedTextureUseIdentity> = {},
): PreparedTextureUseIdentity {
	return {
		colorSpace: "linear",
		kind: "prepared-texture-use",
		mipPolicy: "none",
		outputFormat: "rgba8",
		renderSurfaceId: 0x06000010,
		usage: "color",
		...overrides,
	};
}

function createPreparedAsset(options: {
	readonly byteLength?: number;
	readonly colorSpace?: "linear" | "srgb";
	readonly levelFormat?: string;
	readonly outputFormat: "rgba8" | "dxt1";
}): PreparedAsset {
	return {
		key: createPreparedTextureHostKey(
			createTextureUse({
				colorSpace: options.colorSpace ?? "linear",
				outputFormat: options.outputFormat,
			}),
		),
		payload: createPreparedTexturePayload(options),
		preparedAt: "test",
		revision: 1,
		sourceAssetId: "prepared-texture/06000010",
	};
}

function createPreparedTexturePayload(options: {
	readonly byteLength?: number;
	readonly colorSpace?: "linear" | "srgb";
	readonly levelFormat?: string;
	readonly outputFormat: "rgba8" | "dxt1";
}) {
	const bytes =
		options.byteLength === undefined
			? new Uint8Array([255, 128, 0, 255])
			: new Uint8Array(options.byteLength).fill(255);

	return {
		colorSpace: options.colorSpace ?? "linear",
		dependencies: {
			renderSurfaceAssetIds: ["render-surface/06000010"],
		},
		diagnostics: {
			decodeMs: 0,
			downsampleMs: 0,
			encodeMs: 0,
			generatedByteLength: bytes.byteLength,
			generatedLevelCount: 1,
			totalMs: 0,
		},
		kind: "prepared-texture",
		levels: [
			{
				byteLength: bytes.byteLength,
				bytes,
				format: options.levelFormat ?? "A8R8G8B8",
				formatRaw: 0,
				height: 1,
				level: 0,
				width: 1,
			},
		],
		mipPolicy: "none",
		outputFormat: options.outputFormat,
		provenance: {
			assetId: "prepared-texture/06000010",
			collectedAt: "test",
			source: "host",
		},
		renderSurfaceId: 0x06000010,
		residencyKind: "unknown",
		sourceAssetKind: "prepared-texture",
		sourceByteLength: bytes.byteLength,
		sourceFormat: "A8R8G8B8",
		sourceFormatRaw: 0,
		sourceHash: "hash",
		sourceHeight: 1,
		sourceWidth: 1,
		usage: "color",
	};
}
