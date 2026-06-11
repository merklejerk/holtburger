import { createHostAssetKey } from "../keys";
import type { HostAssetKey, PreparedAsset } from "../contracts";
import type { PreparedTexturePayloadDto } from "../../../lib/host/contracts";
import type { PreparedTextureUseIdentity } from "../../static/contracts";

export interface DirectRgbaTextureSource {
	readonly kind: "direct-rgba-texture-source";
	readonly renderSurfaceId: number;
	readonly usage: PreparedTextureUseIdentity["usage"];
	readonly outputFormat: "rgba8";
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

export function createPreparedTextureHostKey(
	source: PreparedTextureUseIdentity,
): HostAssetKey {
	const query = new URLSearchParams({
		cs: "linear",
		mips: "none",
		out: source.outputFormat,
		usage: source.usage,
	});

	return createHostAssetKey(
		"prepared-texture",
		`${source.renderSurfaceId.toString(16).padStart(8, "0")}?${query.toString()}`,
	);
}

export function prepareDirectRgbaTextureSource(
	prepared: PreparedAsset,
	expectedUse: PreparedTextureUseIdentity,
): DirectRgbaTextureSource {
	const payload = parsePreparedTexturePayload(prepared.payload, expectedUse);
	if (
		payload.outputFormat !== "rgba8" ||
		payload.mipPolicy !== "none" ||
		payload.colorSpace !== "linear"
	) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurfaceId)} uses unsupported direct texture policy ${payload.outputFormat}/${payload.mipPolicy}/${payload.colorSpace}. Only rgba8/none/linear is supported for direct texture sources.`,
		);
	}

	const levelZero = payload.levels.find((level) => level.level === 0);
	if (!levelZero) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurfaceId)} has no mip level 0.`,
		);
	}

	const expectedByteLength = levelZero.width * levelZero.height * 4;
	if (levelZero.bytes.byteLength !== expectedByteLength) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurfaceId)} expected ${expectedByteLength} rgba8 bytes, got ${levelZero.bytes.byteLength}.`,
		);
	}

	return {
		height: levelZero.height,
		kind: "direct-rgba-texture-source",
		outputFormat: "rgba8",
		pixels: levelZero.bytes,
		renderSurfaceId: payload.renderSurfaceId,
		usage: payload.usage,
		width: levelZero.width,
	};
}

function parsePreparedTexturePayload(
	payload: unknown,
	expectedUse: PreparedTextureUseIdentity,
): PreparedTexturePayloadDto {
	if (
		typeof payload !== "object" ||
		payload === null ||
		(payload as { kind?: unknown }).kind !== "prepared-texture"
	) {
		throw new Error(
			`Prepared texture payload for render surface ${formatRenderSurfaceId(expectedUse.renderSurfaceId)} is not a prepared-texture payload.`,
		);
	}

	const candidate = payload as PreparedTexturePayloadDto;
	if (
		candidate.renderSurfaceId !== expectedUse.renderSurfaceId ||
		candidate.usage !== expectedUse.usage ||
		candidate.outputFormat !== expectedUse.outputFormat
	) {
		throw new Error(
			`Prepared texture payload for render surface ${formatRenderSurfaceId(expectedUse.renderSurfaceId)} does not match the requested texture-use policy.`,
		);
	}

	return candidate;
}

function formatRenderSurfaceId(renderSurfaceId: number): string {
	return renderSurfaceId.toString(16).padStart(8, "0");
}
