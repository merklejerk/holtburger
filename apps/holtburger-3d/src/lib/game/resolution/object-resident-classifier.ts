import type { DatAssetId } from "../game-types";
import type {
	AuthoredDynamicSource,
	ResolvedObjectBehavior,
	ResolvedObjectResident,
} from "./landblock-layer";

/** Exhaustive partition of one object-layer's complete authored residents. */
export interface ClassifiedObjectResidents {
	readonly staticResidents: readonly ResolvedObjectResident[];
	readonly dynamicSources: readonly AuthoredDynamicSource[];
}

/** Setup-default IDs before their behavior capability is classified. */
export interface ObjectBehaviorIds {
	readonly animationId: DatAssetId | null;
	readonly physicsScriptId: DatAssetId | null;
	readonly physicsScriptTableId: DatAssetId | null;
	readonly soundTableId: DatAssetId | null;
}

/** Compute the setup's closed capability shape once at the source decode boundary. */
export function resolveObjectBehavior(
	ids: ObjectBehaviorIds,
): ResolvedObjectBehavior {
	const hasScript =
		ids.physicsScriptId !== null || ids.physicsScriptTableId !== null;
	if (ids.animationId === null && !hasScript) {
		return {
			kind: "none",
			animationId: null,
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: ids.soundTableId,
		};
	}
	if (ids.animationId === null) {
		return {
			...resolveScriptIds(ids),
			animationId: null,
			kind: "script-only",
			soundTableId: ids.soundTableId,
		};
	}
	if (!hasScript) {
		return {
			kind: "animation-only",
			animationId: ids.animationId,
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: ids.soundTableId,
		};
	}
	return {
		...resolveScriptIds(ids),
		animationId: ids.animationId,
		kind: "animation-and-script",
		soundTableId: ids.soundTableId,
	};
}

function resolveScriptIds(ids: ObjectBehaviorIds) {
	if (ids.physicsScriptId !== null) {
		return {
			physicsScriptId: ids.physicsScriptId,
			physicsScriptTableId: ids.physicsScriptTableId,
		};
	}
	if (ids.physicsScriptTableId !== null) {
		return {
			physicsScriptId: null,
			physicsScriptTableId: ids.physicsScriptTableId,
		};
	}
	throw new Error("Script capability requires a script or script-table ID.");
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
	const dynamicSources: AuthoredDynamicSource[] = [];
	for (const resident of residents) {
		if (
			resident.behavior.kind === "none" ||
			resident.behavior.kind === "script-only"
		) {
			staticResidents.push(resident);
		} else {
			if (resident.setupId === null) {
				throw new Error(
					`Animated authored resident ${resident.identity.sourceId} has no setup identity.`,
				);
			}
			dynamicSources.push({
				behavior: resident.behavior,
				identity: resident.identity,
				localBounds: resident.localBounds,
				placement: resident.placement,
				presentation: resident.presentation,
				scale: resident.scale,
				setupId: resident.setupId,
			});
		}
	}
	return { staticResidents, dynamicSources };
}
