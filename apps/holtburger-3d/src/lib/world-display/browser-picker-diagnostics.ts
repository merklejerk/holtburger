import type { AssetChannelState } from "../assets/types";
import { formatHex32 } from "../landblocks";
import type { RenderChunkTransform } from "./render-anchor";
import type { StaticRenderableSceneModel } from "./static-renderables";
import {
	buildStagedStaticDrawUnitAssemblies,
	type StagedStaticDrawUnitAssembly,
} from "./staged-world-assembly";
import type { StagedWorldMaterialPlan } from "./staged-world-materials";

export interface BrowserStaticRenderablePickDiagnostic {
	renderKey: string;
	drawUnits: readonly BrowserStaticDrawUnitDiagnostic[];
}

export interface BrowserStaticDrawUnitDiagnostic {
	drawUnitId: string;
	material: BrowserStagedMaterialDiagnostic;
	geometry: BrowserStagedGeometryDiagnostic;
}

export interface BrowserStagedGeometryDiagnostic {
	vertexCount: number;
	triangleCount: number;
	uv: BrowserUvDiagnostic;
}

export interface BrowserUvDiagnostic {
	coordinateCount: number;
	minU: number | null;
	maxU: number | null;
	minV: number | null;
	maxV: number | null;
	spanU: number | null;
	spanV: number | null;
	outsideUnitSquare: boolean;
}

export type BrowserStagedMaterialDiagnostic =
	| {
			kind: "direct-texture";
			key: string;
			textureKey: string;
			renderSurfaceId: string;
			size: string;
			sourceFormatRaw: string;
			hasSourceAlpha: boolean;
			wrap: string;
			filter: string;
			texturePageReadiness: BrowserTexturePageReadinessDiagnostic | null;
			detailOverlay: BrowserDetailOverlayDiagnostic | null;
	  }
	| {
			kind: "indexed-paletted";
			key: string;
			indexFormat: string;
			indexSize: string;
			paletteColorCount: number;
			wrap: string;
			detailOverlay: BrowserDetailOverlayDiagnostic | null;
	  }
	| {
			kind: "flat" | "terrain-blend";
			key: string;
			fallbackReason: string | null;
	  };

export interface BrowserTexturePageReadinessDiagnostic {
	materialSlotKey: string;
	atlasEntryKey: string;
	renderStateKey: string;
	samplingKey: string;
	wrap: string;
	entry: {
		renderSurfaceId: string;
		preparedTextureAssetId: string;
		size: string;
		sourceFormatRaw: string;
		sourceHash: string;
	};
}

export interface BrowserDetailOverlayDiagnostic {
	renderSurfaceId: string;
	textureAssetId: string;
	tiling: number;
	blendMode: string;
	signature: string;
}

export function deriveBrowserStaticRenderablePickDiagnostic(options: {
	assetState: AssetChannelState;
	staticRenderableScene: StaticRenderableSceneModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
	detailTexturesEnabled: boolean;
	renderKey: string;
}): BrowserStaticRenderablePickDiagnostic | null {
	const part = options.staticRenderableScene.parts.find(
		(candidate) => candidate.renderKey === options.renderKey,
	);
	if (!part) {
		return null;
	}
	const chunkOffsetByKey = new Map(
		options.renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform.offset,
		]),
	);
	const drawUnits = buildStagedStaticDrawUnitAssemblies({
		assetState: options.assetState,
		chunkOffsetByKey,
		staticRenderableScene: {
			...options.staticRenderableScene,
			sourceInstances: [],
			parts: [part],
			partsByRenderGroupKey: new Map([[part.renderKey, [part]]]),
			missingSourceAssetIds: [],
			missingGfxAssetIds: [],
			missingSetupAppearanceAssetIds: [],
		},
		detailTexturesEnabled: options.detailTexturesEnabled,
	});
	const drawUnitSegment = `/${part.renderKey}/part-${part.partIndex}/`;
	const matchingDrawUnits = drawUnits.filter((drawUnit) =>
		drawUnit.id.includes(drawUnitSegment),
	);
	if (matchingDrawUnits.length === 0) {
		return null;
	}
	return {
		renderKey: part.renderKey,
		drawUnits: matchingDrawUnits.map(describeStaticDrawUnit),
	};
}

export function summarizeUvBuffer(
	uvs: Float32Array | readonly number[],
): BrowserUvDiagnostic {
	let minU = Number.POSITIVE_INFINITY;
	let maxU = Number.NEGATIVE_INFINITY;
	let minV = Number.POSITIVE_INFINITY;
	let maxV = Number.NEGATIVE_INFINITY;
	let outsideUnitSquare = false;
	for (let index = 0; index + 1 < uvs.length; index += 2) {
		const u = uvs[index] ?? 0;
		const v = uvs[index + 1] ?? 0;
		minU = Math.min(minU, u);
		maxU = Math.max(maxU, u);
		minV = Math.min(minV, v);
		maxV = Math.max(maxV, v);
		outsideUnitSquare ||= u < 0 || u > 1 || v < 0 || v > 1;
	}
	if (uvs.length < 2) {
		return {
			coordinateCount: 0,
			minU: null,
			maxU: null,
			minV: null,
			maxV: null,
			spanU: null,
			spanV: null,
			outsideUnitSquare: false,
		};
	}
	return {
		coordinateCount: Math.floor(uvs.length / 2),
		minU,
		maxU,
		minV,
		maxV,
		spanU: maxU - minU,
		spanV: maxV - minV,
		outsideUnitSquare,
	};
}

function describeStaticDrawUnit(
	drawUnit: StagedStaticDrawUnitAssembly,
): BrowserStaticDrawUnitDiagnostic {
	return {
		drawUnitId: drawUnit.id,
		material: describeMaterial(drawUnit.material),
		geometry: {
			vertexCount: drawUnit.geometry.vertexCount,
			triangleCount: drawUnit.geometry.triangleCount,
			uv: summarizeUvBuffer(drawUnit.geometry.uvs ?? []),
		},
	};
}

function describeMaterial(
	material: StagedWorldMaterialPlan,
): BrowserStagedMaterialDiagnostic {
	if (material.kind === "direct-texture") {
		const upload = material.textureUpload.upload;
		return {
			kind: "direct-texture",
			key: material.key,
			textureKey: material.textureKey,
			renderSurfaceId: formatRenderSurfaceId(upload.renderSurfaceId),
			size: `${upload.width}x${upload.height}`,
			sourceFormatRaw: formatHex32(upload.sourceFormatRaw),
			hasSourceAlpha: upload.hasSourceAlpha,
			wrap: `${upload.samplingPolicy.wrapS}/${upload.samplingPolicy.wrapT}`,
			filter: `${upload.samplingPolicy.minFilter}/${upload.samplingPolicy.magFilter}/${upload.samplingPolicy.mipFilter}`,
			texturePageReadiness: material.texturePageReadiness
				? {
						materialSlotKey: material.texturePageReadiness.materialSlotKey,
						atlasEntryKey: material.texturePageReadiness.atlasEntryKey,
						renderStateKey: material.texturePageReadiness.renderStateKey,
						samplingKey: material.texturePageReadiness.samplingKey,
						wrap: `${material.texturePageReadiness.samplingPolicy.wrapS}/${material.texturePageReadiness.samplingPolicy.wrapT}`,
						entry: {
							renderSurfaceId: formatRenderSurfaceId(
								material.texturePageReadiness.atlasEntry.renderSurfaceId,
							),
							preparedTextureAssetId:
								material.texturePageReadiness.atlasEntry.preparedTextureAssetId,
							size: `${material.texturePageReadiness.atlasEntry.level.width}x${material.texturePageReadiness.atlasEntry.level.height}`,
							sourceFormatRaw: formatHex32(
								material.texturePageReadiness.atlasEntry.sourceFormatRaw,
							),
							sourceHash: material.texturePageReadiness.atlasEntry.sourceHash,
						},
					}
				: null,
			detailOverlay: describeDetailOverlay(material.detailOverlay),
		};
	}
	if (material.kind === "indexed-paletted") {
		return {
			kind: "indexed-paletted",
			key: material.key,
			indexFormat: material.indexedMaterial.texture.format,
			indexSize: `${material.indexedMaterial.texture.width}x${material.indexedMaterial.texture.height}`,
			paletteColorCount: material.indexedMaterial.palette.colorCount,
			wrap: `${material.indexedMaterial.samplingPolicy.wrapS}/${material.indexedMaterial.samplingPolicy.wrapT}`,
			detailOverlay: describeDetailOverlay(material.detailOverlay),
		};
	}
	return {
		kind: material.kind,
		key: material.key,
		fallbackReason: material.fallbackReason,
	};
}

function describeDetailOverlay(
	overlay: Extract<
		StagedWorldMaterialPlan,
		{ kind: "direct-texture" | "indexed-paletted" }
	>["detailOverlay"],
): BrowserDetailOverlayDiagnostic | null {
	if (!overlay) {
		return null;
	}
	return {
		renderSurfaceId: formatRenderSurfaceId(
			overlay.renderSurface.renderSurfaceId,
		),
		textureAssetId: overlay.role.textureAssetId,
		tiling: overlay.role.tiling,
		blendMode: overlay.blendMode,
		signature: overlay.signature,
	};
}

function formatRenderSurfaceId(renderSurfaceId: number): string {
	return `render-surface/${formatHex32(renderSurfaceId)}`;
}
