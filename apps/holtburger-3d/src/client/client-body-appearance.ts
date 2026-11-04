/** Retail palette sets divide the inclusive hue interval into equal authored bins. */
export function appearanceShadeIndex(hue: number, count: number): number {
	return Math.floor((count - 0.000001) * hue);
}
