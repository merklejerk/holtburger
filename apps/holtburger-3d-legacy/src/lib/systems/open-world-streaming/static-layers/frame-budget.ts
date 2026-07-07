/** Replacement-owned cooperative yield hook for long static materialization chains. */
export interface OpenWorldStaticMaterializationFrameBudget {
	readonly yieldToFrameBudget: () => Promise<void>;
}

export async function yieldToStaticMaterializationFrameBudget(
	budget: OpenWorldStaticMaterializationFrameBudget,
): Promise<void> {
	await budget.yieldToFrameBudget();
}
