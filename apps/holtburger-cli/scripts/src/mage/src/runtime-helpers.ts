export function ratio(current: number, max: number): number {
	return max > 0 ? current / max : 0;
}

export function isDefeated(entity: ScriptEntityView | null): boolean {
	if (entity == null) {
		return false;
	}

	if (entity.motionCommand.kind === "dead") {
		return true;
	}

	return (
		entity.profile?.kind === "creature" && entity.profile.data.health === 0
	);
}

/** Shared eligibility for acquiring and retaining the mage's PvE combat targets. */
export function isAttackCandidate(entity: ScriptEntityView | null): boolean {
	return (
		entity != null &&
		entity.kind === "monster" &&
		entity.isHostile &&
		!isDefeated(entity)
	);
}
