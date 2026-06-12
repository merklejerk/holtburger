import { createHostAssetKey } from "../keys";
import type { HostAssetKey, PreparedAsset } from "../contracts";
import type { PreparedTexturePayloadDto } from "../../../lib/host/contracts";
import type {
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	PreparedRgbaRenderSurfaceTextureUsage,
} from "../../static/contracts";

export interface DirectRgbaTextureSource {
	readonly kind: "direct-rgba-texture-source";
	readonly renderSurfaceId: number;
	readonly usage: PreparedRgbaRenderSurfaceTextureUsage;
	readonly outputFormat: "rgba8";
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

export function createPreparedTextureHostKey(
	source: PreparedRgbaRenderSurfaceTextureUseIdentity,
): HostAssetKey {
	const policy = getPreparedRgbaHostPolicy(source.usage);
	const query = new URLSearchParams({
		cs: "linear",
		mips: "none",
		out: policy.outputFormat,
		usage: policy.hostUsage,
	});

	return createHostAssetKey(
		"prepared-texture",
		`${source.renderSurface.renderSurfaceId.toString(16).padStart(8, "0")}?${query.toString()}`,
	);
}

export function prepareDirectRgbaTextureSource(
	prepared: PreparedAsset,
	expectedUse: PreparedRgbaRenderSurfaceTextureUseIdentity,
): DirectRgbaTextureSource {
	const payload = parsePreparedTexturePayload(prepared.payload, expectedUse);
	if (
		payload.outputFormat !== "rgba8" ||
		payload.mipPolicy !== "none" ||
		payload.colorSpace !== "linear"
	) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} uses unsupported direct texture policy ${payload.outputFormat}/${payload.mipPolicy}/${payload.colorSpace}. Only rgba8/none/linear is supported for direct texture sources.`,
		);
	}

	const levelZero = payload.levels.find((level) => level.level === 0);
	if (!levelZero) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} has no mip level 0.`,
		);
	}

	const expectedByteLength = levelZero.width * levelZero.height * 4;
	if (levelZero.bytes.byteLength !== expectedByteLength) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} expected ${expectedByteLength} rgba8 bytes, got ${levelZero.bytes.byteLength}.`,
		);
	}

	return {
		height: levelZero.height,
		kind: "direct-rgba-texture-source",
		outputFormat: "rgba8",
		pixels: levelZero.bytes,
		renderSurfaceId: payload.renderSurfaceId,
		usage: expectedUse.usage,
		width: levelZero.width,
	};
}

function parsePreparedTexturePayload(
	payload: unknown,
	expectedUse: PreparedRgbaRenderSurfaceTextureUseIdentity,
): PreparedTexturePayloadDto {
	const policy = getPreparedRgbaHostPolicy(expectedUse.usage);
	if (
		typeof payload !== "object" ||
		payload === null ||
		(payload as { kind?: unknown }).kind !== "prepared-texture"
	) {
		throw new Error(
			`Prepared texture payload for render surface ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} is not a prepared-texture payload.`,
		);
	}

	const candidate = payload as PreparedTexturePayloadDto;
	if (
		candidate.renderSurfaceId !== expectedUse.renderSurface.renderSurfaceId ||
		candidate.usage !== policy.hostUsage ||
		candidate.outputFormat !== policy.outputFormat
	) {
		throw new Error(
			`Prepared texture payload for render surface ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} does not match the requested texture-use policy.`,
		);
	}

	return candidate;
}

function getPreparedRgbaHostPolicy(
	usage: PreparedRgbaRenderSurfaceTextureUsage,
): {
	readonly hostUsage: PreparedTexturePayloadDto["usage"];
	readonly outputFormat: "rgba8";
} {
	switch (usage) {
		case "rgba-color":
			return { hostUsage: "color", outputFormat: "rgba8" };
		case "rgba-detail":
			return { hostUsage: "detail", outputFormat: "rgba8" };
		case "rgba-mask":
			return { hostUsage: "mask", outputFormat: "rgba8" };
		case "rgba-raw":
			return { hostUsage: "raw", outputFormat: "rgba8" };
	}
}

function formatRenderSurfaceId(renderSurfaceId: number): string {
	return renderSurfaceId.toString(16).padStart(8, "0");
}
