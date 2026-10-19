const quantityFormat = new Intl.NumberFormat("en-US");

/** Exact quantities with comma grouping for labels and tooltips. */
export function formatQuantity(quantity: number | bigint): string {
	return quantityFormat.format(quantity);
}

/** Exact XP arithmetic; only the bounded bar fill becomes a JavaScript number. */
export function progressPercent(value: bigint, maximum: bigint): number {
	if (maximum === 0n) return 0;
	const bounded = value < 0n ? 0n : value > maximum ? maximum : value;
	return Number((bounded * 10000n) / maximum) / 100;
}
