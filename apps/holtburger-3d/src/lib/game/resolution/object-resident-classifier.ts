import type { ResolvedObjectResident } from "./landblock-layer";

/** Exhaustive partition of one object-layer's complete authored residents. */
export interface ClassifiedObjectResidents {
	readonly staticResidents: readonly ResolvedObjectResident[];
	readonly dynamicResidents: readonly ResolvedObjectResident[];
}

/**
 * Preserve the retail setup-default-animation promotion rule without reducing either resident
 * branch to a diagnostic projection. Direct GfxObj presentations have no default animation and
 * therefore remain static.
 */
export function classifyObjectResidents(
	residents: readonly ResolvedObjectResident[],
): ClassifiedObjectResidents {
	const staticResidents: ResolvedObjectResident[] = [];
	const dynamicResidents: ResolvedObjectResident[] = [];
	for (const resident of residents) {
		if (resident.presentation.effects.animationId === null) {
			staticResidents.push(resident);
		} else {
			dynamicResidents.push(resident);
		}
	}
	return { staticResidents, dynamicResidents };
}
