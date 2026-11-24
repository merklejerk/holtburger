export function ratio(current: number, max: number): number {
	return max > 0 ? current / max : 0;
}

export function entitySummary(
	entity: EntitySummary | EntityDetail | null | undefined,
): EntitySummary | null {
	if (entity == null) {
		return null;
	}
	return "summary" in entity ? entity.summary : entity;
}

export function isDefeated(
	entity: EntitySummary | EntityDetail | null | undefined,
): boolean {
	const summary = entitySummary(entity);
	return summary?.isDead === true;
}

/** Shared eligibility for acquiring and retaining the mage's PvE combat targets. */
export function isAttackCandidate(
	entity: EntitySummary | EntityDetail | null | undefined,
): boolean {
	const summary = entitySummary(entity);
	return (
		summary != null &&
		summary.category === "monster" &&
		summary.isHostile &&
		!summary.isDead
	);
}
