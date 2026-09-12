const quantityFormat = new Intl.NumberFormat("en-US");

/** Exact item quantities with comma grouping for labels and tooltips. */
export function formatItemQuantity(count: number): string {
	return quantityFormat.format(count);
}
