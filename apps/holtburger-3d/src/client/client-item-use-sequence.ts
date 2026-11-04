// Monotonically increasing identities survive controller replacement. Late host results cannot
// match a new owner, and cancellation can retire all identities through a captured watermark.
let nextOperation = 0;
/** Cancellation can retire all existing identities without allocating a new request. */
export function lastAllocatedItemUseOperation(): number {
	return nextOperation;
}

export function allocateItemUseOperation(): number {
	if (nextOperation === 0xffff_ffff)
		throw new Error("Item interaction identity space exhausted.");
	return ++nextOperation;
}
