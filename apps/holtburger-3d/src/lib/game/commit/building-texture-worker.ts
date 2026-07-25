import { AABB2, Vec2 } from "../math/types";
import type { StaticTexturePageArtifact } from "./artifacts";
import type { TexturePreparation } from "../textures/types";
import {
	TexturePurpose,
	TextureWrapMode,
	type AssetTextureKey,
	type TextureGutterPixels,
	texturePurposePolicy,
} from "../textures/types";

/** Evidence-backed initial filterable gutter for packed static-object color textures. */
export const STATIC_OBJECT_TEXTURE_GUTTER_PIXELS: TextureGutterPixels = 4;
/** Initial static page limit from the Phase 0 archive census, before device-limit clamping. */
export const STATIC_OBJECT_TEXTURE_PAGE_SIZE = 2048;

/** Complete prepared pixels owned by one logical texture before packing begins. */
export interface BuildingTexturePackInput {
	readonly key: AssetTextureKey;
	readonly purpose: TexturePurpose;
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

/** Closed packing request; no source, runtime, or device callback is available after dispatch. */
export interface BuildingTexturePackJob {
	readonly resourceNamespace: string;
	readonly inputs: readonly BuildingTexturePackInput[];
	readonly pageSize?: number;
}

/** Complete page output plus logical placements from the texture worker. */
export interface BuildingTexturePackResult {
	readonly pages: readonly StaticTexturePageArtifact[];
	readonly packedBytes: number;
	/** Wall-clock algorithm time measured inside the worker boundary. */
	readonly workerDurationMs: number;
}

interface MutablePage {
	readonly purpose: TexturePurpose;
	readonly index: number;
	readonly width: number;
	readonly height: number;
	readonly pageBits: Uint8Array;
	readonly textures: Array<StaticTexturePageArtifact["textures"][number]>;
	cursorX: number;
	cursorY: number;
	rowHeight: number;
}

/**
 * Pack prepared pixels deterministically by semantic purpose. The algorithm has no knowledge of
 * draw ranges: a layout change can therefore never alter geometry or logical material bindings.
 */
export function packBuildingTextures(
	job: BuildingTexturePackJob,
): BuildingTexturePackResult {
	const startedAt = performance.now();
	const pageSize = job.pageSize ?? STATIC_OBJECT_TEXTURE_PAGE_SIZE;
	if (!Number.isInteger(pageSize) || pageSize <= 0) {
		throw new Error("Building texture page size must be a positive integer.");
	}
	const keys = new Set<AssetTextureKey>();
	for (const input of job.inputs) {
		if (keys.has(input.key)) {
			throw new Error(`Building texture job has duplicate logical key ${input.key}.`);
		}
		keys.add(input.key);
		validateInput(input);
	}
	const pages: MutablePage[] = [];
	for (const input of [...job.inputs].sort(compareInputs)) {
		const preparation = preparationForPurpose(input.purpose);
		const paddedWidth = input.width + preparation.gutterPixels * 2;
		const paddedHeight = input.height + preparation.gutterPixels * 2;
		if (paddedWidth > pageSize || paddedHeight > pageSize) {
			throw new Error(
				`Texture ${input.key} including its ${preparation.gutterPixels}px gutter exceeds ${pageSize}px page capacity.`,
			);
		}
		let page = pages.find(
			(candidate) => candidate.purpose === input.purpose && canPlace(candidate, paddedWidth, paddedHeight),
		);
		if (!page) {
			page = createPage(input.purpose, pages.filter(({ purpose }) => purpose === input.purpose).length, pageSize);
			pages.push(page);
		}
		const position = place(page, paddedWidth, paddedHeight);
		blitWithGutter({
			destination: page.pageBits,
			destinationWidth: page.width,
			gutterPixels: preparation.gutterPixels,
			input,
			x: position.x + preparation.gutterPixels,
			y: position.y + preparation.gutterPixels,
		});
		page.textures.push({
			key: input.key,
			placement: {
				bounds: new AABB2(
					new Vec2(position.x + preparation.gutterPixels, position.y + preparation.gutterPixels),
					new Vec2(
						position.x + preparation.gutterPixels + input.width,
						position.y + preparation.gutterPixels + input.height,
					),
				),
				preparation,
			},
		});
	}
	const artifacts = pages.map((page) => ({
		height: page.height,
		pageBits: page.pageBits,
		pageId: `page:building:${job.resourceNamespace}:${page.purpose}:${page.index}` as const,
		purpose: page.purpose,
		textures: page.textures,
		width: page.width,
	}));
	return {
		packedBytes: artifacts.reduce((total, page) => total + page.pageBits.byteLength, 0),
		pages: artifacts,
		workerDurationMs: performance.now() - startedAt,
	};
}

/** Return the one physical packing preparation allowed for an object texture purpose. */
export function preparationForPurpose(purpose: TexturePurpose): TexturePreparation {
	switch (purpose) {
		case TexturePurpose.ObjectDirectColor:
			return {
				gutterPixels: STATIC_OBJECT_TEXTURE_GUTTER_PIXELS,
				// Source-local UV clamping happens before atlas mapping; repeat-safe edge texels
				// support both draw-time wrap policies without duplicating the logical texture.
				wrap: TextureWrapMode.Repeat,
			};
		case TexturePurpose.ObjectIndex8:
		case TexturePurpose.ObjectIndex16:
		case TexturePurpose.ObjectPalette:
			return { gutterPixels: 0, wrap: TextureWrapMode.Clamp };
		default:
			throw new Error(`Texture purpose ${purpose} is not packable for static buildings.`);
	}
}

function validateInput(input: BuildingTexturePackInput): void {
	if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width <= 0 || input.height <= 0) {
		throw new Error(`Texture ${input.key} has invalid dimensions.`);
	}
	const expectedBytes = input.width * input.height * bytesPerPixel(input.purpose);
	if (input.pixels.byteLength !== expectedBytes) {
		throw new Error(
			`Texture ${input.key} expected ${expectedBytes} bytes, got ${input.pixels.byteLength}.`,
		);
	}
}

function bytesPerPixel(purpose: TexturePurpose): number {
	switch (texturePurposePolicy(purpose).format) {
		case "rgba8":
			return 4;
		case "r8":
			return 1;
		case "rg8":
			return 2;
		case "a8":
			return 1;
		default:
			throw new Error(`Unsupported texture pixel format for ${purpose}.`);
	}
}

function compareInputs(left: BuildingTexturePackInput, right: BuildingTexturePackInput): number {
	return left.purpose.localeCompare(right.purpose) || left.key.localeCompare(right.key);
}

function createPage(purpose: TexturePurpose, index: number, pageSize: number): MutablePage {
	return {
		cursorX: 0,
		cursorY: 0,
		height: pageSize,
		index,
		pageBits: new Uint8Array(pageSize * pageSize * bytesPerPixel(purpose)),
		purpose,
		rowHeight: 0,
		textures: [],
		width: pageSize,
	};
}

function canPlace(page: MutablePage, width: number, height: number): boolean {
	if (page.cursorX + width <= page.width && page.cursorY + height <= page.height) return true;
	return page.cursorY + page.rowHeight + height <= page.height && width <= page.width;
}

function place(page: MutablePage, width: number, height: number): { readonly x: number; readonly y: number } {
	if (page.cursorX + width > page.width) {
		page.cursorX = 0;
		page.cursorY += page.rowHeight;
		page.rowHeight = 0;
	}
	if (page.cursorY + height > page.height) {
		throw new Error(`Texture page ${page.purpose}/${page.index} has no remaining capacity.`);
	}
	const position = { x: page.cursorX, y: page.cursorY };
	page.cursorX += width;
	page.rowHeight = Math.max(page.rowHeight, height);
	return position;
}

function blitWithGutter(options: {
	readonly destination: Uint8Array;
	readonly destinationWidth: number;
	readonly gutterPixels: number;
	readonly input: BuildingTexturePackInput;
	readonly x: number;
	readonly y: number;
}): void {
	const bytes = bytesPerPixel(options.input.purpose);
	for (let row = -options.gutterPixels; row < options.input.height + options.gutterPixels; row += 1) {
		const sourceY = modulo(row, options.input.height);
		for (let column = -options.gutterPixels; column < options.input.width + options.gutterPixels; column += 1) {
			const sourceX = modulo(column, options.input.width);
			const sourceOffset = (sourceY * options.input.width + sourceX) * bytes;
			const destinationOffset = ((options.y + row) * options.destinationWidth + options.x + column) * bytes;
			options.destination.set(options.input.pixels.subarray(sourceOffset, sourceOffset + bytes), destinationOffset);
		}
	}
}

function modulo(value: number, size: number): number {
	return ((value % size) + size) % size;
}
