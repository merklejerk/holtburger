const quantityFormat = new Intl.NumberFormat("en-US");

/** Exact quantities with comma grouping for labels and tooltips. */
export function formatQuantity(quantity: number): string {
	return quantityFormat.format(quantity);
}
