import type {
	NameplateAppearance,
	NameplateColor,
	NameplateTextAppearance,
	NameplateVisual,
} from "./nameplate-policy";
import type { NameplateContent } from "../systems/dynamic-presentation-source";

const NAMEPLATE_STYLE_REVISION = 2;
const MAX_NAMEPLATE_TEXTURE_BYTES = 16 * 1024 * 1024;

export interface RasterizedNameplate {
	readonly height: number;
	readonly pixels: TexImageSource;
	readonly width: number;
}

/** Injectable typography boundary; production delegates shaping and rasterization to Canvas2D. */
export interface NameplateRasterizer {
	rasterize(
		visual: NameplateVisual,
		appearance: NameplateAppearance,
		density: number,
	): RasterizedNameplate;
}

export interface NameplateTextureBinding {
	readonly height: number;
	readonly texture: WebGLTexture;
	readonly width: number;
}

export interface NameplateTextureCacheDiagnostics {
	readonly byteCount: number;
	readonly hitCount: number;
	readonly liveEntryCount: number;
	readonly missCount: number;
	readonly rasterizationCount: number;
	/** Rasters rejected before GPU allocation because their dimensions exceeded a hard bound. */
	readonly rejectedRasterCount: number;
	readonly releaseCount: number;
}

type CacheEntry = NameplateTextureBinding;

interface ActiveNameplateStyle {
	readonly appearance: NameplateAppearance;
	readonly density: number;
	readonly generation: number;
}

interface CachedVisualKey {
	readonly generation: number;
	readonly key: string;
}

/** Renderer-local residency for complete, rarely-changing Canvas nameplate images. */
export class WebGL2NameplateTextureCache {
	readonly #entries = new Map<string, CacheEntry>();
	readonly #gl: WebGL2RenderingContext;
	readonly #rasterizer: NameplateRasterizer;
	readonly #visualKeys = new WeakMap<
		NameplateContent,
		Map<NameplateVisual["category"], CachedVisualKey>
	>();
	#activeStyle: ActiveNameplateStyle | null = null;
	#nextStyleGeneration = 1;
	#byteCount = 0;
	#hitCount = 0;
	#missCount = 0;
	#rasterizationCount = 0;
	#rejectedRasterCount = 0;
	#releaseCount = 0;
	#destroyed = false;

	constructor(
		gl: WebGL2RenderingContext,
		rasterizer: NameplateRasterizer = new Canvas2DNameplateRasterizer(),
	) {
		this.#gl = gl;
		this.#rasterizer = rasterizer;
	}

	/** Reconcile exact installed references only when the owner population revision changes. */
	reconcile(
		visuals: Iterable<NameplateVisual>,
		appearance: NameplateAppearance,
		density: number,
	): void {
		this.#requireAlive();
		this.#activateStyle(appearance, density);
		const referencedKeys = new Set<string>();
		for (const visual of visuals) referencedKeys.add(this.#key(visual));
		for (const [key, entry] of this.#entries) {
			if (referencedKeys.has(key)) continue;
			this.#deleteEntry(key, entry);
		}
	}

	/** Resolve one visible value, creating its Canvas and GPU resource only on first use. */
	acquire(visual: NameplateVisual): NameplateTextureBinding {
		this.#requireAlive();
		const style = this.#activeStyle;
		if (style === null)
			throw new Error("Nameplate texture cache has no reconciled style.");
		const key = this.#key(visual);
		const existing = this.#entries.get(key);
		if (existing) {
			this.#hitCount += 1;
			return existing;
		}
		this.#missCount += 1;
		const rasterized = this.#rasterizer.rasterize(
			visual,
			style.appearance,
			style.density,
		);
		this.#rasterizationCount += 1;
		this.#validateDimensions(rasterized);
		const texture = this.#gl.createTexture();
		if (!texture) throw new Error("Failed to allocate nameplate texture.");
		try {
			const gl = this.#gl;
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				rasterized.pixels,
			);
			gl.bindTexture(gl.TEXTURE_2D, null);
		} catch (cause) {
			this.#gl.bindTexture(this.#gl.TEXTURE_2D, null);
			this.#gl.deleteTexture(texture);
			throw cause;
		}
		const entry: CacheEntry = {
			height: rasterized.height,
			texture,
			width: rasterized.width,
		};
		this.#entries.set(key, entry);
		this.#byteCount += rasterized.width * rasterized.height * 4;
		return entry;
	}

	diagnostics(): NameplateTextureCacheDiagnostics {
		return {
			byteCount: this.#byteCount,
			hitCount: this.#hitCount,
			liveEntryCount: this.#entries.size,
			missCount: this.#missCount,
			rasterizationCount: this.#rasterizationCount,
			rejectedRasterCount: this.#rejectedRasterCount,
			releaseCount: this.#releaseCount,
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const [key, entry] of this.#entries) this.#deleteEntry(key, entry);
	}

	#validateDimensions(rasterized: RasterizedNameplate): void {
		const maximumDimension = this.#gl.getParameter(
			this.#gl.MAX_TEXTURE_SIZE,
		) as number;
		const bytes = rasterized.width * rasterized.height * 4;
		if (
			!Number.isSafeInteger(rasterized.width) ||
			!Number.isSafeInteger(rasterized.height) ||
			rasterized.width <= 0 ||
			rasterized.height <= 0 ||
			rasterized.width > maximumDimension ||
			rasterized.height > maximumDimension ||
			bytes > MAX_NAMEPLATE_TEXTURE_BYTES
		) {
			this.#rejectedRasterCount += 1;
			throw new Error(
				`Nameplate texture rejected: raster ${rasterized.width}x${rasterized.height} exceeds device or ${MAX_NAMEPLATE_TEXTURE_BYTES}-byte limits.`,
			);
		}
	}

	#activateStyle(appearance: NameplateAppearance, density: number): void {
		if (!Number.isFinite(density) || density <= 0)
			throw new Error("Nameplate raster density must be finite and positive.");
		if (
			this.#activeStyle?.appearance === appearance &&
			this.#activeStyle.density === density
		)
			return;
		this.#activeStyle = {
			appearance,
			density,
			generation: this.#nextStyleGeneration,
		};
		this.#nextStyleGeneration += 1;
	}

	#key(visual: NameplateVisual): string {
		const style = this.#activeStyle;
		if (style === null)
			throw new Error("Nameplate texture cache has no reconciled style.");
		let categoryKeys = this.#visualKeys.get(visual.content);
		if (categoryKeys === undefined) {
			categoryKeys = new Map();
			this.#visualKeys.set(visual.content, categoryKeys);
		}
		const cached = categoryKeys.get(visual.category);
		if (cached?.generation === style.generation) return cached.key;
		// Content objects are replaced, never mutated. Serialize their arbitrary text once per style
		// generation while preserving value sharing across distinct equal content objects.
		const key = JSON.stringify([
			NAMEPLATE_STYLE_REVISION,
			style.generation,
			visual.category,
			visual.content.name,
			visual.content.level,
		]);
		categoryKeys.set(visual.category, { generation: style.generation, key });
		return key;
	}

	#deleteEntry(key: string, entry: CacheEntry): void {
		this.#gl.deleteTexture(entry.texture);
		this.#entries.delete(key);
		this.#byteCount -= entry.width * entry.height * 4;
		this.#releaseCount += 1;
	}

	#requireAlive(): void {
		if (this.#destroyed)
			throw new Error("Nameplate texture cache is destroyed.");
	}
}

/** Browser Canvas implementation kept behind a small testable rasterizer port. */
class Canvas2DNameplateRasterizer implements NameplateRasterizer {
	rasterize(
		visual: NameplateVisual,
		appearance: NameplateAppearance,
		density: number,
	): RasterizedNameplate {
		if (!Number.isFinite(density) || density <= 0)
			throw new Error("Nameplate raster density must be finite and positive.");
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		if (!context)
			throw new Error("Canvas2D is unavailable for nameplate rasterization.");
		const { content } = visual;
		const nameFont = canvasFont(appearance.name, appearance.fontFamily);
		const levelFont = canvasFont(appearance.level, appearance.fontFamily);
		context.font = nameFont;
		const nameWidth = context.measureText(content.name).width;
		context.font = levelFont;
		const levelText = content.level === null ? null : `Level ${content.level}`;
		const levelWidth =
			levelText === null ? 0 : context.measureText(levelText).width;
		const cssWidth = Math.ceil(
			Math.max(nameWidth, levelWidth) + appearance.horizontalPaddingPixels * 2,
		);
		const cssHeight = Math.ceil(
			appearance.verticalPaddingPixels * 2 +
				appearance.name.fontSizePixels +
				(levelText === null
					? 0
					: appearance.lineGapPixels + appearance.level.fontSizePixels),
		);
		canvas.width = Math.max(1, Math.ceil(cssWidth * density));
		canvas.height = Math.max(1, Math.ceil(cssHeight * density));
		context.scale(density, density);
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.lineJoin = "round";
		context.strokeStyle = canvasColor(appearance.outlineColor);
		context.fillStyle = canvasColor(appearance.fillColors[visual.category]);
		context.lineWidth = appearance.name.outlineWidthPixels;
		context.font = nameFont;
		const nameY =
			appearance.verticalPaddingPixels + appearance.name.fontSizePixels / 2;
		if (appearance.name.outlineWidthPixels > 0)
			context.strokeText(content.name, cssWidth / 2, nameY);
		context.fillText(content.name, cssWidth / 2, nameY);
		if (levelText !== null) {
			context.font = levelFont;
			context.lineWidth = appearance.level.outlineWidthPixels;
			const levelY =
				appearance.verticalPaddingPixels +
				appearance.name.fontSizePixels +
				appearance.lineGapPixels +
				appearance.level.fontSizePixels / 2;
			if (appearance.level.outlineWidthPixels > 0)
				context.strokeText(levelText, cssWidth / 2, levelY);
			context.fillText(levelText, cssWidth / 2, levelY);
		}
		return { height: canvas.height, pixels: canvas, width: canvas.width };
	}
}

function canvasFont(
	appearance: NameplateTextAppearance,
	fontFamily: string,
): string {
	return `${appearance.fontStyle} ${appearance.fontWeight} ${appearance.fontSizePixels}px ${fontFamily}`;
}

function canvasColor(color: NameplateColor): string {
	return `rgba(${color.red * 255}, ${color.green * 255}, ${color.blue * 255}, ${color.alpha})`;
}
