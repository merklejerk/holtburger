import {
	createWebgl2Texture2D,
	type Webgl2Texture2DResource,
} from "./webgl2-gl";
import type {
	AtlasStaticCompactionEntry,
	AtlasStaticCompactionPlan,
} from "./atlas-static-compaction-planner";
import type {
	AtlasTexturePage,
	AtlasTexturePlacement,
} from "./atlas-layout-planner";

export interface Webgl2AtlasStaticTextureResource {
	key: string;
	textureIndex: number;
	texture: Webgl2Texture2DResource;
	width: number;
	height: number;
	placementCount: number;
}

export interface Webgl2AtlasStaticGenerationResource {
	key: string;
	textures: readonly Webgl2AtlasStaticTextureResource[];
	preparedTextureAssetIds: readonly string[];
	compactableDrawUnitIds: readonly string[];
	dispose(): void;
}

export function createWebgl2AtlasStaticGenerationResource({
	gl,
	plan,
}: {
	gl: WebGL2RenderingContext;
	plan: AtlasStaticCompactionPlan;
}): Webgl2AtlasStaticGenerationResource | null {
	if (plan.compactableDrawUnitIds.length === 0) {
		return null;
	}
	const entriesByKey = new Map(
		plan.atlasEntryRecords.map((record) => [record.key, record] as const),
	);
	const textures = plan.atlasTextures.map((page) =>
		createWebgl2AtlasStaticTexture({
			gl,
			generationKey: plan.key,
			page,
			entriesByKey,
		}),
	);
	return {
		key: plan.key,
		textures,
		preparedTextureAssetIds: plan.preparedTextureAssetIds,
		compactableDrawUnitIds: plan.compactableDrawUnitIds,
		dispose() {
			for (const texture of textures) {
				texture.texture.dispose();
			}
		},
	};
}

function createWebgl2AtlasStaticTexture({
	gl,
	generationKey,
	page,
	entriesByKey,
}: {
	gl: WebGL2RenderingContext;
	generationKey: string;
	page: AtlasTexturePage;
	entriesByKey: ReadonlyMap<string, AtlasStaticCompactionEntry>;
}): Webgl2AtlasStaticTextureResource {
	const pixels = new Uint8Array(page.width * page.height * 4);
	for (const placement of page.placements) {
		const record = entriesByKey.get(placement.atlasEntryKey);
		if (!record) {
			throw new Error(
				`Atlas static generation ${generationKey} references missing entry ${placement.atlasEntryKey}.`,
			);
		}
		copyAtlasStaticPlacement({
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

function copyAtlasStaticPlacement({
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
	entry: AtlasStaticCompactionEntry["entry"];
}): void {
	validateAtlasStaticSource(entry);
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

function validateAtlasStaticSource(
	entry: AtlasStaticCompactionEntry["entry"],
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

function clampInteger(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
