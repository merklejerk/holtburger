import { describe, expect, it } from "vitest";

import type {
	PreparedRenderSurfacePayload,
	PreparedTexturePayload,
} from "../assets/types";
import { prepareRenderSurfaceTextureUploadData } from "./render-surface-texture-data";
import type { TextureSamplingPolicy } from "./texture-sampling-policy";

describe("render surface texture upload data", () => {
	it("decodes direct-color surfaces without creating Three textures", () => {
		const prepared = prepareRenderSurfaceTextureUploadData(
			createRenderSurfacePayload(0x06000002, {
				sourceBytes: new Uint8Array([0x10, 0x20, 0x30, 0xff]),
			}),
			createSamplingPolicy(),
		);

		expect(prepared.status).toBe("ready");
		if (prepared.status !== "ready") {
			throw new Error("Expected direct render surface to be ready.");
		}
		expect(prepared.upload).toMatchObject({
			kind: "direct",
			renderSurfaceId: 0x06000002,
			width: 1,
			height: 1,
			sourceFormatRaw: 0x15,
			hasSourceAlpha: true,
			format: "rgba",
			dataType: "uint8",
			internalFormat: null,
		});
		expect([...prepared.upload.data]).toEqual([0x30, 0x20, 0x10, 0xff]);
	});

	it("reports unsupported direct texture formats explicitly", () => {
		const prepared = prepareRenderSurfaceTextureUploadData(
			createRenderSurfacePayload(0x06000003, {
				formatRaw: 0x1234,
				format: "Unknown",
				sourceBytes: new Uint8Array([0]),
			}),
			createSamplingPolicy(),
		);

		expect(prepared).toMatchObject({
			status: "unsupported",
			reason: "unsupported-format",
			detail: {
				renderSurfaceId: "06000003",
				format: "Unknown",
				formatRaw: 0x1234,
			},
		});
	});

	it("keeps prepared compressed mip metadata renderer-neutral", () => {
		const prepared = prepareRenderSurfaceTextureUploadData(
			createDxtRenderSurfacePayload(0x06000004),
			createSamplingPolicy(),
			{ supportsS3tc: true, supportsS3tcSrgb: false },
			createPreparedDxtTexturePayload(0x06000004),
		);

		expect(prepared.status).toBe("ready");
		if (prepared.status !== "ready") {
			throw new Error("Expected compressed render surface to be ready.");
		}
		expect(prepared.upload).toMatchObject({
			kind: "compressed",
			renderSurfaceId: 0x06000004,
			width: 4,
			height: 4,
			sourceFormatRaw: 0x3154_5844,
			hasSourceAlpha: false,
			format: "s3tc-dxt1-rgba",
			samplingPolicy: { mipFilter: "linear" },
		});
		expect(prepared.upload.levels).toHaveLength(2);
		expect(prepared.upload.levels.map((level) => level.width)).toEqual([4, 2]);
	});

	it("reports missing compressed support without falling through to placeholder logic", () => {
		const prepared = prepareRenderSurfaceTextureUploadData(
			createDxtRenderSurfacePayload(0x06000005),
			createSamplingPolicy(),
			{ supportsS3tc: false, supportsS3tcSrgb: false },
		);

		expect(prepared).toMatchObject({
			status: "unsupported",
			reason: "compressed-texture-unsupported",
			detail: {
				renderSurfaceId: "06000005",
				format: "Dxt1",
				formatRaw: 0x3154_5844,
			},
		});
	});
});

function createSamplingPolicy(): TextureSamplingPolicy {
	return {
		wrapS: "repeat",
		wrapT: "repeat",
		minFilter: "linear",
		magFilter: "linear",
		mipFilter: "linear",
		colorSpace: "srgb",
		anisotropy: 1,
	};
}

function createRenderSurfacePayload(
	renderSurfaceId: number,
	options: {
		sourceBytes?: Uint8Array;
		formatRaw?: number;
		format?: string;
	} = {},
): PreparedRenderSurfacePayload {
	const sourceBytes =
		options.sourceBytes ?? new Uint8Array([0x33, 0x22, 0x11, 0xff]);
	return {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "render-surface",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId,
		unknown: 0,
		width: 1,
		height: 1,
		formatRaw: options.formatRaw ?? 0x15,
		format: options.format ?? "A8R8G8B8",
		sourceByteLength: sourceBytes.byteLength,
		sourceBytes,
		defaultPaletteId: null,
		dependencies: { paletteAssetIds: [] },
	};
}

function createDxtRenderSurfacePayload(
	renderSurfaceId: number,
): PreparedRenderSurfacePayload {
	return {
		...createRenderSurfacePayload(renderSurfaceId),
		width: 4,
		height: 4,
		formatRaw: 0x3154_5844,
		format: "Dxt1",
		sourceByteLength: 8,
		sourceBytes: new Uint8Array(8),
	};
}

function createPreparedDxtTexturePayload(
	renderSurfaceId: number,
): PreparedTexturePayload {
	return {
		kind: "prepared-texture",
		sourceAssetKind: "prepared-texture",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "prepared-texture",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId,
		usage: "raw",
		outputFormat: "dxt1",
		mipPolicy: "retail4",
		colorSpace: "source",
		sourceFormatRaw: 0x3154_5844,
		sourceFormat: "Dxt1",
		sourceWidth: 4,
		sourceHeight: 4,
		sourceByteLength: 8,
		sourceHash: "test-source",
		levels: [
			{
				level: 0,
				width: 4,
				height: 4,
				formatRaw: 0x3154_5844,
				format: "Dxt1",
				byteLength: 8,
				bytes: new Uint8Array(8),
			},
			{
				level: 1,
				width: 2,
				height: 2,
				formatRaw: 0x3154_5844,
				format: "Dxt1",
				byteLength: 8,
				bytes: new Uint8Array(8),
			},
		],
		dependencies: { renderSurfaceAssetIds: [] },
		diagnostics: {
			generatedLevelCount: 2,
			generatedByteLength: 16,
			decodeMs: 0,
			downsampleMs: 0,
			encodeMs: 0,
			totalMs: 0,
		},
	};
}
