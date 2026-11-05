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
