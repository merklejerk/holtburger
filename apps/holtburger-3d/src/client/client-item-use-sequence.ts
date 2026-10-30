// Identities survive controller replacement so late host results cannot match a new owner.
let nextOperation = 0;
export function allocateItemUseOperation(): number {
	if (nextOperation === 0xffff_ffff)
		throw new Error("Item interaction identity space exhausted.");
	return ++nextOperation;
}
