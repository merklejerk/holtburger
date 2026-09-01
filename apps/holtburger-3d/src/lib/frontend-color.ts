const HEX_RGB_PATTERN = /^#[\da-f]{6}$/i;
const HEX_RGBA_PATTERN = /^#[\da-f]{8}$/i;

declare const HEX_RGB_COLOR: unique symbol;
declare const HEX_RGBA_COLOR: unique symbol;

/** Frontend-authored `#RRGGBB` color whose shape was validated at construction. */
export type HexRgbColor = string & { readonly [HEX_RGB_COLOR]: true };

/** Frontend-authored `#RRGGBBAA` color whose shape was validated at construction. */
export type HexRgbaColor = string & { readonly [HEX_RGBA_COLOR]: true };

/** Normalized RGB channels used by renderer-facing runtime contracts. */
export interface NormalizedRgbColor {
	/** Red intensity in [0, 1]. */
	readonly red: number;
	/** Green intensity in [0, 1]. */
	readonly green: number;
	/** Blue intensity in [0, 1]. */
	readonly blue: number;
}

/** Normalized straight-alpha RGBA channels used by renderer-facing runtime contracts. */
export interface NormalizedRgbaColor extends NormalizedRgbColor {
	/** Straight alpha in [0, 1]. */
	readonly alpha: number;
}

/** Validate and retain one authored six-digit hex color. */
export function hexRgb(value: string): HexRgbColor {
	if (!HEX_RGB_PATTERN.test(value))
		throw new Error(
			`Expected a #RRGGBB color, received ${JSON.stringify(value)}.`,
		);
	return value as HexRgbColor;
}

/** Validate and retain one authored eight-digit straight-alpha hex color. */
export function hexRgba(value: string): HexRgbaColor {
	if (!HEX_RGBA_PATTERN.test(value))
		throw new Error(
			`Expected a #RRGGBBAA color, received ${JSON.stringify(value)}.`,
		);
	return value as HexRgbaColor;
}

/** Decode one authored RGB color at the boundary that consumes normalized channels. */
export function normalizedRgbColor(color: HexRgbColor): NormalizedRgbColor {
	return normalizedRgbChannels(color);
}

function normalizedRgbChannels(color: string): NormalizedRgbColor {
	return {
		red: byte(color, 1) / 255,
		green: byte(color, 3) / 255,
		blue: byte(color, 5) / 255,
	};
}

/** Decode one authored RGBA color at the boundary that consumes normalized channels. */
export function normalizedRgbaColor(color: HexRgbaColor): NormalizedRgbaColor {
	return {
		...normalizedRgbChannels(color),
		alpha: byte(color, 7) / 255,
	};
}

function byte(color: string, offset: number): number {
	return Number.parseInt(color.slice(offset, offset + 2), 16);
}
