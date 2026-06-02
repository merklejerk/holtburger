import {
	createWebgl2Texture2D,
	type Webgl2Texture2DResource,
} from "../../webgl2-gl";
import type {
	RgbaTexturePageAtlasEntryRecord,
	RgbaTexturePageDetailAtlasEntry,
} from "../../compaction-family-planner";
import type {
	AtlasTexturePage,
	AtlasTexturePlacement,
} from "../../texture-pages/atlas-layout-planner";
import type { TexturePageAtlasPlan } from "../../texture-pages/texture-page-atlas-planner";

interface Webgl2TextureAtlasPlacementResource {
	atlasEntryKey: string;
	textureIndex: number;
	rect: readonly [number, number, number, number];
	width: number;
	height: number;
}

export interface Webgl2TextureAtlasTextureResource {
	key: string;
	textureIndex: number;
	texture: Webgl2Texture2DResource;
	width: number;
	height: number;
	placementCount: number;
}

export interface Webgl2DetailTextureAtlasTextureResource {
	key: string;
	textureIndex: number;
	texture: Webgl2Texture2DResource;
	width: number;
	height: number;
	placementCount: number;
}

export interface Webgl2TextureAtlasGenerationResource {
	key: string;
	textures: readonly Webgl2TextureAtlasTextureResource[];
	placements: readonly Webgl2TextureAtlasPlacementResource[];
	detailTextures: readonly Webgl2DetailTextureAtlasTextureResource[];
	detailPlacements: readonly Webgl2TextureAtlasPlacementResource[];
	preparedTextureAssetIds: readonly string[];
	rgbaAtlasReadyDrawUnitIds: readonly string[];
	dispose(): void;
}

export function createWebgl2TextureAtlasGenerationResource({
	gl,
	plan,
}: {
	gl: WebGL2RenderingContext;
	plan: TexturePageAtlasPlan;
}): Webgl2TextureAtlasGenerationResource | null {
	if (
		plan.rgbaAtlasReadyDrawUnitIds.length === 0 &&
		plan.detailAtlasTextures.length === 0
	) {
		return null;
	}
	const entriesByKey = new Map(
		plan.atlasEntryRecords.map((record) => [record.key, record] as const),
	);
	const textures = plan.atlasTextures.map((page) =>
		createWebgl2TextureAtlasTexture({
			gl,
			generationKey: plan.key,
			page,
			entriesByKey,
		}),
	);
	const placements = plan.atlasTextures.flatMap((page) =>
		page.placements.map((placement) => ({
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
	);
	const detailEntriesByKey = new Map(
		(plan.detailAtlasEntryRecords ?? []).map(
			(entry) => [entry.key, entry] as const,
		),
	);
	const detailTextures = (plan.detailAtlasTextures ?? []).map((page) =>
		createWebgl2DetailTextureAtlasTexture({
			gl,
			generationKey: plan.key,
			page,
			entriesByKey: detailEntriesByKey,
		}),
	);
	const detailPlacements = (plan.detailAtlasTextures ?? []).flatMap((page) =>
		page.placements.map((placement) => ({
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
	);
	return {
		key: plan.key,
		textures,
		placements,
		detailTextures,
		detailPlacements,
		preparedTextureAssetIds: plan.preparedTextureAssetIds,
		rgbaAtlasReadyDrawUnitIds: plan.rgbaAtlasReadyDrawUnitIds,
		dispose() {
			for (const texture of textures) {
				texture.texture.dispose();
			}
			for (const texture of detailTextures) {
				texture.texture.dispose();
			}
		},
	};
}

function createWebgl2TextureAtlasTexture({
	gl,
	generationKey,
	page,
	entriesByKey,
}: {
	gl: WebGL2RenderingContext;
	generationKey: string;
	page: AtlasTexturePage;
	entriesByKey: ReadonlyMap<string, RgbaTexturePageAtlasEntryRecord>;
}): Webgl2TextureAtlasTextureResource {
	const pixels = new Uint8Array(page.width * page.height * 4);
	for (const placement of page.placements) {
		const record = entriesByKey.get(placement.atlasEntryKey);
		if (!record) {
			throw new Error(
				`Texture atlas generation ${generationKey} references missing entry ${placement.atlasEntryKey}.`,
			);
		}
		copyTextureAtlasPlacement({
			atlasPixels: pixels,
			atlasWidth: page.width,
			atlasHeight: page.height,
			placement,
			entry: record.entry,
		});
	}
	const key = `${generationKey}/texture/${page.textureIndex}`;
	const texture = createWebgl2Texture2D(gl, {
		label: key,
		upload: {
			width: page.width,
			height: page.height,
			internalFormat: gl.RGBA8,
			format: gl.RGBA,
			type: gl.UNSIGNED_BYTE,
			data: pixels,
			generateMipmaps: true,
		},
		sampler: {
			wrapS: gl.CLAMP_TO_EDGE,
			wrapT: gl.CLAMP_TO_EDGE,
			minFilter: gl.LINEAR_MIPMAP_LINEAR,
			magFilter: gl.LINEAR,
		},
	});
	return {
		key,
		textureIndex: page.textureIndex,
		texture,
		width: page.width,
		height: page.height,
		placementCount: page.placements.length,
	};
}

function createWebgl2DetailTextureAtlasTexture({
	gl,
	generationKey,
	page,
	entriesByKey,
}: {
	gl: WebGL2RenderingContext;
	generationKey: string;
	page: AtlasTexturePage;
	entriesByKey: ReadonlyMap<
		string,
		RgbaTexturePageDetailAtlasEntry
	>;
}): Webgl2DetailTextureAtlasTextureResource {
	const pixels = new Uint8Array(page.width * page.height * 4);
	for (const placement of page.placements) {
		const entry = entriesByKey.get(placement.atlasEntryKey);
		if (!entry) {
			throw new Error(
				`Detail texture atlas generation ${generationKey} references missing entry ${placement.atlasEntryKey}.`,
			);
		}
		copyDetailTextureAtlasPlacement({
			atlasPixels: pixels,
			atlasWidth: page.width,
			atlasHeight: page.height,
			placement,
			entry,
		});
	}
	const key = `${generationKey}/detail-texture/${page.textureIndex}`;
	const texture = createWebgl2Texture2D(gl, {
		label: key,
		upload: {
			width: page.width,
			height: page.height,
			internalFormat: gl.RGBA8,
			format: gl.RGBA,
			type: gl.UNSIGNED_BYTE,
			data: pixels,
			generateMipmaps: true,
		},
		sampler: {
			wrapS: gl.CLAMP_TO_EDGE,
			wrapT: gl.CLAMP_TO_EDGE,
			minFilter: gl.LINEAR_MIPMAP_LINEAR,
			magFilter: gl.LINEAR,
		},
	});
	return {
		key,
		textureIndex: page.textureIndex,
		texture,
		width: page.width,
		height: page.height,
		placementCount: page.placements.length,
	};
}

function copyTextureAtlasPlacement({
	atlasPixels,
	atlasWidth,
	atlasHeight,
	placement,
	entry,
}: {
	atlasPixels: Uint8Array;
	atlasWidth: number;
	atlasHeight: number;
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
		const sourceY = clampInteger(atlasY - placement.y, 0, sourceHeight - 1);
		for (let atlasX = minX; atlasX < maxX; atlasX += 1) {
			const sourceX = clampInteger(atlasX - placement.x, 0, sourceWidth - 1);
			const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
			const atlasOffset = (atlasY * atlasWidth + atlasX) * 4;
			atlasPixels[atlasOffset] = source[sourceOffset] ?? 0;
			atlasPixels[atlasOffset + 1] = source[sourceOffset + 1] ?? 0;
			atlasPixels[atlasOffset + 2] = source[sourceOffset + 2] ?? 0;
			atlasPixels[atlasOffset + 3] = source[sourceOffset + 3] ?? 0;
		}
	}
}

function copyDetailTextureAtlasPlacement({
	atlasPixels,
	atlasWidth,
	atlasHeight,
	placement,
	entry,
}: {
	atlasPixels: Uint8Array;
	atlasWidth: number;
	atlasHeight: number;
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
		const sourceY = clampInteger(atlasY - placement.y, 0, entry.height - 1);
		for (let atlasX = minX; atlasX < maxX; atlasX += 1) {
			const sourceX = clampInteger(atlasX - placement.x, 0, entry.width - 1);
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
