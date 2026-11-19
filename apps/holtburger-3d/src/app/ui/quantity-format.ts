const quantityFormat = new Intl.NumberFormat("en-US");
const compactQuantityFormat = new Intl.NumberFormat("en-US", {
	notation: "compact",
	minimumFractionDigits: 0,
	maximumFractionDigits: 2,
});

/** Exact quantities with comma grouping for labels and tooltips. */
export function formatQuantity(quantity: number | bigint): string {
	return quantityFormat.format(quantity);
}

/** Abbreviate millions and above without converting exact bigint totals to numbers. */
export function formatCompactQuantity(quantity: number | bigint): string {
	return quantity > -1_000_000 && quantity < 1_000_000
		? formatQuantity(quantity)
		: compactQuantityFormat.format(quantity);
}

/** Exact XP arithmetic; only the bounded bar fill becomes a JavaScript number. */
export function progressPercent(value: bigint, maximum: bigint): number {
	if (maximum === 0n) return 0;
	const bounded = value < 0n ? 0n : value > maximum ? maximum : value;
	return Number((bounded * 10000n) / maximum) / 100;
}
