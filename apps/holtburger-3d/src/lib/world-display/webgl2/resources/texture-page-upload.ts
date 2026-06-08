import {
	createWebgl2Texture2D,
	type Webgl2Texture2DResource,
} from "../../webgl2-gl";
import type {
	RgbaTexturePageAtlasEntryRecord,
	RgbaTexturePageDetailAtlasEntry,
} from "../../compaction/compaction-family-planner";
import type {
	AtlasTexturePage,
	AtlasTexturePlacement,
} from "../../texture-pages/atlas-layout-planner";
import type { IndexedTextureFormat } from "../../indexed-material-data";
import type {
	TexturePageAtlasPlan,
	TexturePageFamily,
} from "../../texture-pages/texture-page-atlas-planner";
import type {
	TexturePageKind,
	TexturePageSampleClass,
	TexturePageUsageBucket,
} from "../../texture-pages/texture-page-binding";
import type { TextureFilteringMode } from "../../texture-pages/texture-sampling-policy";

const TERRAIN_COLOR_ATLAS_FILL_RGBA = [128, 128, 128, 255] as const;

export type Webgl2ResidentTexturePageFamily =
	| TexturePageFamily
	| TexturePageUsageBucket;

export type Webgl2ResidentTexturePageUsageBucket =
	| TexturePageUsageBucket
	| TexturePageFamily;

export type Webgl2TexturePageSamplerPolicyKey = string & {
	readonly __webgl2TexturePageSamplerPolicyKey: unique symbol;
};

interface Webgl2TexturePagePlacementResource {
	family: TexturePageFamily;
	atlasEntryKey: string;
	textureIndex: number;
	rect: readonly [number, number, number, number];
	width: number;
	height: number;
}

export interface Webgl2ResidentTexturePageEntryResource {
	virtualRefKey: string;
	sourceAssetId: string;
	rect: readonly [number, number, number, number];
}

export interface Webgl2ResidentTexturePageResource {
	key: string;
	family: Webgl2ResidentTexturePageFamily;
	textureIndex: number;
	usageBucket: Webgl2ResidentTexturePageUsageBucket;
	sampleClass: TexturePageSampleClass;
	pageKind: TexturePageKind;
	indexedFormat?: IndexedTextureFormat | null;
	samplerPolicyKey: Webgl2TexturePageSamplerPolicyKey;
	mipmapsGenerated: boolean;
	texture: Webgl2Texture2DResource;
	width: number;
	height: number;
	placementCount: number;
	entries: readonly Webgl2ResidentTexturePageEntryResource[];
	pixelStats?: TexturePagePixelStats;
	entryDiagnostics?: readonly TexturePageEntryDiagnostic[];
}

export type Webgl2TexturePageTextureResource = Webgl2ResidentTexturePageResource;

export type Webgl2DetailTexturePageTextureResource =
	Webgl2ResidentTexturePageResource;

export interface TexturePageCpuTexture {
	key: string;
	family: TexturePageFamily;
	textureIndex: number;
	width: number;
	height: number;
	placementCount: number;
	pixels: Uint8Array;
	entries: readonly Webgl2ResidentTexturePageEntryResource[];
	pixelStats: TexturePagePixelStats;
	entryDiagnostics: readonly TexturePageEntryDiagnostic[];
}

export interface TexturePagePixelStats {
	pixelCount: number;
	blackRgbPixelCount: number;
	transparentPixelCount: number;
	nonOpaquePixelCount: number;
	minRgb: readonly [number, number, number];
	maxRgb: readonly [number, number, number];
	meanRgb: readonly [number, number, number];
	minAlpha: number;
	maxAlpha: number;
}

export interface TexturePageEntryDiagnostic {
	atlasEntryKey: string;
	renderSurfaceId: number;
	preparedTextureAssetId?: string;
	sourceFormatRaw: number;
	width: number;
	height: number;
	byteLength: number;
	pixelStats: TexturePagePixelStats;
}

export interface TexturePageCpuSet {
	key: string;
	textures: readonly TexturePageCpuTexture[];
	placements: readonly Webgl2TexturePagePlacementResource[];
	detailTextures: readonly TexturePageCpuTexture[];
	detailPlacements: readonly Webgl2TexturePagePlacementResource[];
	preparedTextureAssetIds: readonly string[];
	rgbaAtlasReadyCandidateIds: readonly string[];
}

export interface TexturePageCpuSetPlan {
	key: string;
	rgbaAtlasReadyCandidateIds: readonly string[];
	detailAtlasTextures: readonly AtlasTexturePage[];
	families: readonly TexturePageAtlasPlan["families"][number][];
	preparedTextureAssetIds: readonly string[];
}

export function createTexturePageCpuSet({
	plan,
	textureFilteringMode = "anisotropic-4x",
	maxAnisotropy = 1,
}: {
	plan: TexturePageCpuSetPlan;
	textureFilteringMode?: TextureFilteringMode;
	maxAnisotropy?: number;
}): TexturePageCpuSet | null {
	if (
		plan.rgbaAtlasReadyCandidateIds.length === 0 &&
		plan.detailAtlasTextures.length === 0
	) {
		return null;
	}
	const textures = plan.families.flatMap((familyPlan) =>
		familyPlan.atlasTextures.map((page) => {
			const entriesByKey = new Map(
				familyPlan.atlasEntryRecords.map(
					(record) => [record.key, record] as const,
				),
			);
			return createTexturePageCpuTexture({
				pageSetKey: plan.key,
				family: familyPlan.family,
				page,
				entriesByKey,
			});
		}),
	);
	const placements = plan.families.flatMap((familyPlan) =>
		familyPlan.atlasTextures.flatMap((page) =>
			page.placements.map((placement) => ({
				family: familyPlan.family,
				atlasEntryKey: placement.atlasEntryKey,
				textureIndex: page.textureIndex,
				rect: [
					placement.x,
					placement.y,
					placement.width,
					placement.height,
				] as const,
				width: page.width,
				height: page.height,
			})),
		),
	);
	const detailTextures = plan.families.flatMap((familyPlan) =>
		familyPlan.detailAtlasTextures.map((page) => {
			const detailEntriesByKey = new Map(
				familyPlan.detailAtlasEntryRecords.map(
					(entry) => [entry.key, entry] as const,
				),
			);
			return createDetailTexturePageCpuTexture({
				pageSetKey: plan.key,
				family: familyPlan.family,
				page,
				entriesByKey: detailEntriesByKey,
			});
		}),
	);
	const detailPlacements = plan.families.flatMap((familyPlan) =>
		familyPlan.detailAtlasTextures.flatMap((page) =>
			page.placements.map((placement) => ({
				family: familyPlan.family,
				atlasEntryKey: placement.atlasEntryKey,
				textureIndex: page.textureIndex,
				rect: [
					placement.x,
					placement.y,
					placement.width,
					placement.height,
				] as const,
				width: page.width,
				height: page.height,
			})),
		),
	);
	return {
		key: describeWebgl2TexturePageSetKey({
			planKey: plan.key,
			textureFilteringMode,
			maxAnisotropy,
		}),
		textures,
		placements,
		detailTextures,
		detailPlacements,
		preparedTextureAssetIds: plan.preparedTextureAssetIds,
		rgbaAtlasReadyCandidateIds: plan.rgbaAtlasReadyCandidateIds,
	};
}

function createTexturePageCpuTexture({
	pageSetKey,
	family,
	page,
	entriesByKey,
}: {
	pageSetKey: string;
	family: TexturePageFamily;
	page: AtlasTexturePage;
	entriesByKey: ReadonlyMap<string, RgbaTexturePageAtlasEntryRecord>;
}): TexturePageCpuTexture {
	const pixels = new Uint8Array(page.width * page.height * 4);
	if (family === "terrain-color") {
		fillRgbaPixels(pixels, TERRAIN_COLOR_ATLAS_FILL_RGBA);
	}
	const entryDiagnostics: TexturePageEntryDiagnostic[] = [];
	const entries: Webgl2ResidentTexturePageEntryResource[] = [];
	for (const placement of page.placements) {
		const record = entriesByKey.get(placement.atlasEntryKey);
		if (!record) {
			throw new Error(
				`Texture page set ${pageSetKey} references missing entry ${placement.atlasEntryKey}.`,
			);
		}
		entries.push({
			virtualRefKey: placement.atlasEntryKey,
			sourceAssetId:
				record.entry.preparedTextureAssetId ?? placement.atlasEntryKey,
			rect: [
				placement.x,
				placement.y,
				placement.width,
				placement.height,
			],
		});
		entryDiagnostics.push({
			atlasEntryKey: placement.atlasEntryKey,
			renderSurfaceId: record.entry.renderSurfaceId,
			preparedTextureAssetId: record.entry.preparedTextureAssetId,
			sourceFormatRaw: record.entry.sourceFormatRaw,
			width: record.entry.level.width,
			height: record.entry.level.height,
			byteLength: record.entry.level.bytes.byteLength,
			pixelStats: summarizeRgbaPixels(record.entry.level.bytes),
		});
		copyTextureAtlasPlacement({
			atlasPixels: pixels,
			atlasWidth: page.width,
			atlasHeight: page.height,
			edgeMode: family === "terrain-color" ? "repeat" : "clamp",
			placement,
			entry: record.entry,
		});
	}
	const key = `${pageSetKey}/${family}/texture/${page.textureIndex}`;
	return {
		key,
		family,
		textureIndex: page.textureIndex,
		width: page.width,
		height: page.height,
		placementCount: page.placements.length,
		pixels,
		entries,
		pixelStats: summarizeRgbaPixels(pixels),
		entryDiagnostics,
	};
}

function createDetailTexturePageCpuTexture({
	pageSetKey,
	family,
	page,
	entriesByKey,
}: {
	pageSetKey: string;
	family: TexturePageFamily;
	page: AtlasTexturePage;
	entriesByKey: ReadonlyMap<string, RgbaTexturePageDetailAtlasEntry>;
}): TexturePageCpuTexture {
	const pixels = new Uint8Array(page.width * page.height * 4);
	const entryDiagnostics: TexturePageEntryDiagnostic[] = [];
	const entries: Webgl2ResidentTexturePageEntryResource[] = [];
	for (const placement of page.placements) {
		const entry = entriesByKey.get(placement.atlasEntryKey);
		if (!entry) {
			throw new Error(
				`Detail texture page set ${pageSetKey} references missing entry ${placement.atlasEntryKey}.`,
			);
		}
		entries.push({
			virtualRefKey: placement.atlasEntryKey,
			sourceAssetId: placement.atlasEntryKey,
			rect: [
				placement.x,
				placement.y,
				placement.width,
				placement.height,
			],
		});
		entryDiagnostics.push({
			atlasEntryKey: placement.atlasEntryKey,
			renderSurfaceId: entry.renderSurfaceId,
			sourceFormatRaw: entry.sourceFormatRaw,
			width: entry.width,
			height: entry.height,
			byteLength: entry.bytes.byteLength,
			pixelStats: summarizeRgbaPixels(entry.bytes),
		});
		copyDetailTextureAtlasPlacement({
			atlasPixels: pixels,
			atlasWidth: page.width,
			atlasHeight: page.height,
			edgeMode: family === "terrain-detail" ? "repeat" : "clamp",
			placement,
			entry,
		});
	}
	const key = `${pageSetKey}/${family}/detail-texture/${page.textureIndex}`;
	return {
		key,
		family,
		textureIndex: page.textureIndex,
		width: page.width,
		height: page.height,
		placementCount: page.placements.length,
		pixels,
		entries,
		pixelStats: summarizeRgbaPixels(pixels),
		entryDiagnostics,
	};
}

export function createWebgl2TexturePageTextureResourceFromCpu({
	gl,
	cpuTexture,
	textureFilteringMode,
	maxAnisotropy,
}: {
	gl: WebGL2RenderingContext;
	cpuTexture: TexturePageCpuTexture;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}):
	| Webgl2TexturePageTextureResource
	| Webgl2DetailTexturePageTextureResource {
	const texture = createWebgl2Texture2D(gl, {
		label: cpuTexture.key,
		upload: {
			width: cpuTexture.width,
			height: cpuTexture.height,
			internalFormat: gl.RGBA8,
			format: gl.RGBA,
			type: gl.UNSIGNED_BYTE,
			data: cpuTexture.pixels,
			generateMipmaps: textureFilteringMode !== "nearest",
		},
		sampler: createWebgl2TextureAtlasSampler({
			gl,
			textureFilteringMode,
			maxAnisotropy,
		}),
	});
	return {
		key: cpuTexture.key,
		family: cpuTexture.family,
		textureIndex: cpuTexture.textureIndex,
		usageBucket: cpuTexture.family,
		sampleClass: "rgba-color",
		pageKind: "packed-atlas",
		indexedFormat: null,
		samplerPolicyKey: describeWebgl2TexturePageSamplerPolicy({
			family: cpuTexture.family,
			textureFilteringMode,
			maxAnisotropy,
		}),
		mipmapsGenerated: textureFilteringMode !== "nearest",
		texture,
		width: cpuTexture.width,
		height: cpuTexture.height,
		placementCount: cpuTexture.placementCount,
		entries: cpuTexture.entries,
		pixelStats: cpuTexture.pixelStats,
		entryDiagnostics: cpuTexture.entryDiagnostics,
	};
}

export function describeWebgl2TexturePageSetKey({
	planKey,
	textureFilteringMode,
	maxAnisotropy,
}: {
	planKey: string;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}): string {
	const anisotropy =
		textureFilteringMode === "anisotropic-4x"
			? Math.min(4, Math.max(1, Math.floor(maxAnisotropy)))
			: 1;
	return `${planKey};filter=${textureFilteringMode};aniso=${anisotropy}`;
}

function describeWebgl2TexturePageSamplerPolicy({
	family,
	textureFilteringMode,
	maxAnisotropy,
}: {
	family: TexturePageFamily;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}): Webgl2TexturePageSamplerPolicyKey {
	const anisotropy =
		textureFilteringMode === "anisotropic-4x"
			? Math.min(4, Math.max(1, Math.floor(maxAnisotropy)))
			: 1;
	return createWebgl2TexturePageSamplerPolicyKey(
		`family=${family};sample=rgba-color;filter=${textureFilteringMode};mips=${textureFilteringMode === "nearest" ? "off" : "on"};aniso=${anisotropy}`,
	);
}

export function createWebgl2TexturePageSamplerPolicyKey(
	value: string,
): Webgl2TexturePageSamplerPolicyKey {
	return value as Webgl2TexturePageSamplerPolicyKey;
}

function createWebgl2TextureAtlasSampler({
	gl,
	textureFilteringMode,
	maxAnisotropy,
}: {
	gl: WebGL2RenderingContext;
	textureFilteringMode: TextureFilteringMode;
	maxAnisotropy: number;
}) {
	if (textureFilteringMode === "nearest") {
		return {
			wrapS: gl.CLAMP_TO_EDGE,
			wrapT: gl.CLAMP_TO_EDGE,
			minFilter: gl.NEAREST,
			magFilter: gl.NEAREST,
			maxAnisotropy: 1,
		};
	}
	return {
		wrapS: gl.CLAMP_TO_EDGE,
		wrapT: gl.CLAMP_TO_EDGE,
		minFilter: gl.LINEAR_MIPMAP_LINEAR,
		magFilter: gl.LINEAR,
		maxAnisotropy:
			textureFilteringMode === "anisotropic-4x"
				? Math.min(4, Math.max(1, Math.floor(maxAnisotropy)))
				: 1,
	};
}

function fillRgbaPixels(
	pixels: Uint8Array,
	color: readonly [number, number, number, number],
): void {
	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels[offset] = color[0];
		pixels[offset + 1] = color[1];
		pixels[offset + 2] = color[2];
		pixels[offset + 3] = color[3];
	}
}

function summarizeRgbaPixels(bytes: Uint8Array): TexturePagePixelStats {
	const pixelCount = Math.floor(bytes.byteLength / 4);
	let blackRgbPixelCount = 0;
	let transparentPixelCount = 0;
	let nonOpaquePixelCount = 0;
	let minR = 255;
	let minG = 255;
	let minB = 255;
	let maxR = 0;
	let maxG = 0;
	let maxB = 0;
	let minAlpha = 255;
	let maxAlpha = 0;
	let totalR = 0;
	let totalG = 0;
	let totalB = 0;

	for (let offset = 0; offset < pixelCount * 4; offset += 4) {
		const r = bytes[offset] ?? 0;
		const g = bytes[offset + 1] ?? 0;
		const b = bytes[offset + 2] ?? 0;
		const a = bytes[offset + 3] ?? 0;
		if (r === 0 && g === 0 && b === 0) {
			blackRgbPixelCount += 1;
		}
		if (a === 0) {
			transparentPixelCount += 1;
		}
		if (a !== 255) {
			nonOpaquePixelCount += 1;
		}
		minR = Math.min(minR, r);
		minG = Math.min(minG, g);
		minB = Math.min(minB, b);
		maxR = Math.max(maxR, r);
		maxG = Math.max(maxG, g);
		maxB = Math.max(maxB, b);
		minAlpha = Math.min(minAlpha, a);
		maxAlpha = Math.max(maxAlpha, a);
		totalR += r;
		totalG += g;
		totalB += b;
	}

	if (pixelCount === 0) {
		return {
			pixelCount: 0,
			blackRgbPixelCount: 0,
			transparentPixelCount: 0,
			nonOpaquePixelCount: 0,
			minRgb: [0, 0, 0],
			maxRgb: [0, 0, 0],
			meanRgb: [0, 0, 0],
			minAlpha: 0,
			maxAlpha: 0,
		};
	}

	return {
		pixelCount,
		blackRgbPixelCount,
		transparentPixelCount,
		nonOpaquePixelCount,
		minRgb: [minR, minG, minB],
		maxRgb: [maxR, maxG, maxB],
		meanRgb: [
			roundColor(totalR / pixelCount),
			roundColor(totalG / pixelCount),
			roundColor(totalB / pixelCount),
		],
		minAlpha,
		maxAlpha,
	};
}

function roundColor(value: number): number {
	return Math.round(value * 100) / 100;
}

function copyTextureAtlasPlacement({
	atlasPixels,
	atlasWidth,
	atlasHeight,
	edgeMode,
	placement,
	entry,
}: {
	atlasPixels: Uint8Array;
	atlasWidth: number;
	atlasHeight: number;
	edgeMode: "clamp" | "repeat";
	placement: AtlasTexturePlacement;
	entry: RgbaTexturePageAtlasEntryRecord["entry"];
}): void {
	validateTextureAtlasSource(entry);
	const source = entry.level.bytes;
	const sourceWidth = entry.level.width;
	const sourceHeight = entry.level.height;
	const gutter = placement.gutterPixels;
	const minX = placement.x - gutter;
	const minY = placement.y - gutter;
	const maxX = placement.x + placement.width + gutter;
	const maxY = placement.y + placement.height + gutter;
	if (minX < 0 || minY < 0 || maxX > atlasWidth || maxY > atlasHeight) {
		throw new Error(
			`Atlas placement ${placement.atlasEntryKey} exceeds ${atlasWidth}x${atlasHeight} atlas bounds.`,
		);
	}
	for (let atlasY = minY; atlasY < maxY; atlasY += 1) {
		const sourceY = resolveAtlasGutterSourceCoordinate({
			value: atlasY - placement.y,
			size: sourceHeight,
			edgeMode,
		});
		for (let atlasX = minX; atlasX < maxX; atlasX += 1) {
			const sourceX = resolveAtlasGutterSourceCoordinate({
				value: atlasX - placement.x,
				size: sourceWidth,
				edgeMode,
			});
			const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
			const atlasOffset = (atlasY * atlasWidth + atlasX) * 4;
			atlasPixels[atlasOffset] = source[sourceOffset] ?? 0;
			atlasPixels[atlasOffset + 1] = source[sourceOffset + 1] ?? 0;
			atlasPixels[atlasOffset + 2] = source[sourceOffset + 2] ?? 0;
			atlasPixels[atlasOffset + 3] = source[sourceOffset + 3] ?? 0;
		}
	}
}

function resolveAtlasGutterSourceCoordinate({
	value,
	size,
	edgeMode,
}: {
	value: number;
	size: number;
	edgeMode: "clamp" | "repeat";
}): number {
	if (edgeMode === "repeat") {
		return ((value % size) + size) % size;
	}
	return clampInteger(value, 0, size - 1);
}

function copyDetailTextureAtlasPlacement({
	atlasPixels,
	atlasWidth,
	atlasHeight,
	edgeMode,
	placement,
	entry,
}: {
	atlasPixels: Uint8Array;
	atlasWidth: number;
	atlasHeight: number;
	edgeMode: "clamp" | "repeat";
	placement: AtlasTexturePlacement;
	entry: RgbaTexturePageDetailAtlasEntry;
}): void {
	validateDetailTextureAtlasSource(entry);
	const gutter = placement.gutterPixels;
	const minX = placement.x - gutter;
	const minY = placement.y - gutter;
	const maxX = placement.x + placement.width + gutter;
	const maxY = placement.y + placement.height + gutter;
	if (minX < 0 || minY < 0 || maxX > atlasWidth || maxY > atlasHeight) {
		throw new Error(
			`Detail atlas placement ${placement.atlasEntryKey} exceeds ${atlasWidth}x${atlasHeight} atlas bounds.`,
		);
	}
	for (let atlasY = minY; atlasY < maxY; atlasY += 1) {
		const sourceY = resolveAtlasGutterSourceCoordinate({
			value: atlasY - placement.y,
			size: entry.height,
			edgeMode,
		});
		for (let atlasX = minX; atlasX < maxX; atlasX += 1) {
			const sourceX = resolveAtlasGutterSourceCoordinate({
				value: atlasX - placement.x,
				size: entry.width,
				edgeMode,
			});
			const sourceOffset = (sourceY * entry.width + sourceX) * 4;
			const atlasOffset = (atlasY * atlasWidth + atlasX) * 4;
			atlasPixels[atlasOffset] = entry.bytes[sourceOffset] ?? 0;
			atlasPixels[atlasOffset + 1] = entry.bytes[sourceOffset + 1] ?? 0;
			atlasPixels[atlasOffset + 2] = entry.bytes[sourceOffset + 2] ?? 0;
			atlasPixels[atlasOffset + 3] = entry.bytes[sourceOffset + 3] ?? 0;
		}
	}
}

function validateTextureAtlasSource(
	entry: RgbaTexturePageAtlasEntryRecord["entry"],
): void {
	const level = entry.level;
	if (level.width <= 0 || level.height <= 0) {
		throw new Error(
			`Atlas source ${entry.preparedTextureAssetId} has invalid dimensions ${level.width}x${level.height}.`,
		);
	}
	if (level.bytes.byteLength !== level.width * level.height * 4) {
		throw new Error(
			`Atlas source ${entry.preparedTextureAssetId} expected ${level.width * level.height * 4} rgba8 bytes, got ${level.bytes.byteLength}.`,
		);
	}
}

function validateDetailTextureAtlasSource(
	entry: RgbaTexturePageDetailAtlasEntry,
): void {
	if (entry.width <= 0 || entry.height <= 0) {
		throw new Error(
			`Detail atlas source ${entry.key} has invalid dimensions ${entry.width}x${entry.height}.`,
		);
	}
	if (entry.format !== "rgba8") {
		throw new Error(
			`Detail atlas source ${entry.key} has unsupported format ${entry.format}.`,
		);
	}
	if (entry.bytes.byteLength !== entry.width * entry.height * 4) {
		throw new Error(
			`Detail atlas source ${entry.key} expected ${entry.width * entry.height * 4} rgba8 bytes, got ${entry.bytes.byteLength}.`,
		);
	}
}

function clampInteger(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
