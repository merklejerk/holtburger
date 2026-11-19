/** Known container occupancy used by item-cell bars and tooltips. */
export interface ItemCapacity {
	/** Occupied ordinary item slots; pack slots consume a separate budget. */
	readonly used: number;
	/** Server-provided ordinary item-slot limit. */
	readonly max: number;
}
