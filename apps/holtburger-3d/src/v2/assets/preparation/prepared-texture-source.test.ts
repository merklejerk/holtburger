import { describe, expect, it } from "vitest";
import type { PreparedAsset } from "../contracts";
import type { PreparedRenderSurfaceTextureUseIdentity } from "../../static/contracts";
import {
	createPreparedTextureHostKey,
	prepareDirectIndexTextureSource,
	prepareDirectPaletteTextureSource,
	prepareDirectRgbaTextureSource,
} from "./prepared-texture-source";

describe("V2 prepared texture source preparation", () => {
	it("creates host keys with the prepared-texture transport query spelling", () => {
		expect(createPreparedTextureHostKey(createTextureUse())).toEqual({
			id: "06000010?cs=linear&mips=none&out=rgba8&usage=color",
			kind: "prepared-texture",
		});
	});

	it("derives index prepared texture transport policy from semantic usage", () => {
		expect(createPreparedTextureHostKey(createTextureUse({ usage: "index8" })))
			.toEqual({
				id: "06000010?cs=data&mips=none&out=r8&usage=raw",
				kind: "prepared-texture",
			});
		expect(createPreparedTextureHostKey(createTextureUse({ usage: "index16" })))
			.toEqual({
				id: "06000010?cs=data&mips=none&out=index16&usage=raw",
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
			height: 1,
			kind: "direct-rgba-texture-source",
			outputFormat: "rgba8",
			renderSurfaceId: 0x06000010,
			usage: "rgba-color",
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
				createTextureUse(),
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

	it("converts index8 payloads into direct index sources", () => {
		const source = prepareDirectIndexTextureSource(
			createPreparedAsset({
				byteLength: 2,
				colorSpace: "data",
				levelFormat: "P8",
				outputFormat: "r8",
				sourceFormat: "P8",
				sourceFormatRaw: 0x29,
				usage: "raw",
				width: 2,
			}),
			createTextureUse({ usage: "index8" }),
		);

		expect(source).toMatchObject({
			bytesPerIndex: 1,
			height: 1,
			kind: "direct-index-texture-source",
			outputFormat: "r8",
			renderSurfaceId: 0x06000010,
			usage: "index8",
			width: 2,
		});
		expect(Array.from(source.indices)).toEqual([255, 255]);
	});

	it("converts index16 payloads into direct index sources", () => {
		const source = prepareDirectIndexTextureSource(
			createPreparedAsset({
				byteLength: 4,
				colorSpace: "data",
				levelFormat: "Index16",
				outputFormat: "index16",
				sourceFormat: "Index16",
				sourceFormatRaw: 0x65,
				usage: "raw",
				width: 2,
			}),
			createTextureUse({ usage: "index16" }),
		);

		expect(source).toMatchObject({
			bytesPerIndex: 2,
			outputFormat: "index16",
			usage: "index16",
		});
		expect(Array.from(source.indices)).toEqual([255, 255, 255, 255]);
	});

	it("rejects index payloads whose source format does not match semantic usage", () => {
		expect(() =>
			prepareDirectIndexTextureSource(
				createPreparedAsset({
					colorSpace: "data",
					outputFormat: "r8",
					sourceFormatRaw: 0x1c,
					usage: "raw",
				}),
				createTextureUse({ usage: "index8" }),
			),
		).toThrow("does not match index8");
	});

	it("converts palette payload ranges into direct rgba lookup sources", () => {
		const source = prepareDirectPaletteTextureSource(
			createPalettePreparedAsset(),
			{
				firstIndex: 1,
				indexCount: 2,
				kind: "palette-texture-use",
				palette: {
					kind: "palette",
					paletteId: 0x04000010,
				},
				subPalettes: [],
				usage: "palette-rgba",
			},
		);

		expect(source).toMatchObject({
			firstIndex: 1,
			height: 1,
			indexCount: 2,
			kind: "direct-palette-texture-source",
			outputFormat: "rgba8",
			paletteId: 0x04000010,
			usage: "palette-rgba",
			width: 2,
		});
		expect(Array.from(source.pixels)).toEqual([
			0x44, 0x55, 0x66, 0x80, 0xaa, 0xbb, 0xcc, 0xff,
		]);
	});

	it("composes palette payloads with authored subpalette replacement ranges", () => {
		const source = prepareDirectPaletteTextureSource(
			createPalettePreparedAsset(),
			{
				firstIndex: 0,
				indexCount: 3,
				kind: "palette-texture-use",
				palette: {
					kind: "palette",
					paletteId: 0x04000010,
				},
				subPalettes: [
					{
						firstIndex: 1,
						indexCount: 1,
						palette: {
							kind: "palette",
							paletteId: 0x04000020,
						},
					},
				],
				usage: "palette-rgba",
			},
			[
				createPalettePreparedAsset({
					colorsArgb: [0xff000000, 0xff778899, 0xffffffff],
					paletteId: 0x04000020,
				}),
			],
		);

		expect(source).toMatchObject({
			firstIndex: 0,
			indexCount: 3,
			width: 3,
		});
		expect(Array.from(source.pixels)).toEqual([
			0x11, 0x22, 0x33, 0xff,
			0x77, 0x88, 0x99, 0xff,
			0xaa, 0xbb, 0xcc, 0xff,
		]);
	});
});

function createTextureUse(
	overrides: Partial<PreparedRenderSurfaceTextureUseIdentity> = {},
): PreparedRenderSurfaceTextureUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId: 0x06000010,
		},
		usage: "rgba-color",
		...overrides,
	};
}

function createPreparedAsset(options: {
	readonly byteLength?: number;
	readonly colorSpace?: "data" | "linear" | "srgb";
	readonly levelFormat?: string;
	readonly outputFormat: "dxt1" | "index16" | "r8" | "rgba8";
	readonly sourceFormat?: string;
	readonly sourceFormatRaw?: number;
	readonly usage?: "color" | "detail" | "mask" | "raw";
	readonly width?: number;
}): PreparedAsset {
	return {
		key: createPreparedTextureHostKey(
			createTextureUse(),
		),
		payload: createPreparedTexturePayload(options),
		preparedAt: "test",
		revision: 1,
		sourceAssetId: "prepared-texture/06000010",
	};
}

function createPalettePreparedAsset(
	options: {
		readonly colorsArgb?: readonly number[];
		readonly paletteId?: number;
	} = {},
): PreparedAsset {
	const paletteId = options.paletteId ?? 0x04000010;
	return {
		key: {
			id: paletteId.toString(16).padStart(8, "0"),
			kind: "palette",
		},
		payload: {
			colorCount: options.colorsArgb?.length ?? 3,
			colorsArgb: Uint32Array.from(
				options.colorsArgb ?? [0xff112233, 0x80445566, 0xffaabbcc],
			),
			kind: "palette",
			paletteId,
			provenance: {
				detail: null,
				errorCode: null,
				source: "repo-local-hba",
				sourceAssetKind: "palette",
			},
			residencyKind: "unknown",
			sourceAssetKind: "palette",
		},
		preparedAt: "test",
		revision: 1,
		sourceAssetId: `palette/${paletteId.toString(16).padStart(8, "0")}`,
	};
}

function createPreparedTexturePayload(options: {
	readonly byteLength?: number;
	readonly colorSpace?: "data" | "linear" | "srgb";
	readonly levelFormat?: string;
	readonly outputFormat: "dxt1" | "index16" | "r8" | "rgba8";
	readonly sourceFormat?: string;
	readonly sourceFormatRaw?: number;
	readonly usage?: "color" | "detail" | "mask" | "raw";
	readonly width?: number;
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
				width: options.width ?? 1,
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
		sourceFormat: options.sourceFormat ?? "A8R8G8B8",
		sourceFormatRaw: options.sourceFormatRaw ?? 0,
		sourceHash: "hash",
		sourceHeight: 1,
		sourceWidth: options.width ?? 1,
		usage: options.usage ?? "color",
	};
}
