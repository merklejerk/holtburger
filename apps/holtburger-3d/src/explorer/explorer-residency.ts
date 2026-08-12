import type {
	ScenePointResidencyCandidates,
	SceneResidency,
} from "../lib/game/scene";

/** Explicit Explorer policy result; candidate order is never a residency tie-break. */
export type ExplorerResidencyResolution =
	| {
			readonly kind: "resolved";
			readonly residency: SceneResidency;
			readonly source:
				| "cell-containment"
				| "explicit-env-cell"
				| "host-physical-camera"
				| "outdoor"
				| "physical-handoff";
	  }
	| {
			readonly kind: "ambiguous";
			readonly candidates: readonly (SceneResidency & {
				readonly envCellId: NonNullable<SceneResidency["envCellId"]>;
			})[];
	  }
	| {
			readonly kind: "outside";
	  }
	| {
			readonly kind: "topology-unavailable";
			readonly landblockId: SceneResidency["landblockId"];
	  };

/**
 * Select Explorer residency from a complete scene candidate query.
 *
 * Outdoor remains an explicit fallback only when no resident CellStruct contains the point.
 * Multiple containment matches remain inspectable ambiguity.
 */
export function resolveExplorerPointResidency(
	candidates: ScenePointResidencyCandidates | null,
): ExplorerResidencyResolution {
	if (candidates === null) return { kind: "outside" };
	const containingCells = candidates.envCells.filter(
		(candidate) => candidate.containsPoint,
	);
	if (containingCells.length === 1) {
		const candidate = containingCells[0]!;
		return {
			kind: "resolved",
			residency: {
				envCellId: candidate.envCellId,
				landblockId: candidate.landblockId,
			},
			source: "cell-containment",
		};
	}
	if (containingCells.length > 1) {
		return {
			candidates: containingCells.map(({ envCellId, landblockId }) => ({
				envCellId,
				landblockId,
			})),
			kind: "ambiguous",
		};
	}
	return {
		kind: "resolved",
		residency: candidates.outdoor,
		source: "outdoor",
	};
}

/** Report missing EnvCell topology without letting scene geometry infer lifecycle state. */
function unavailableExplorerTopology(
	landblockId: SceneResidency["landblockId"],
): ExplorerResidencyResolution {
	return { kind: "topology-unavailable", landblockId };
}

/** Resolve exact-DID intent without applying overlap selection or an outdoor fallback. */
export function resolveExplicitExplorerEnvCell(
	residency: SceneResidency & {
		readonly envCellId: NonNullable<SceneResidency["envCellId"]>;
	},
	state: "contained" | "outside" | "topology-unavailable",
): ExplorerResidencyResolution {
	if (state === "topology-unavailable") {
		return unavailableExplorerTopology(residency.landblockId);
	}
	if (state === "outside") return { kind: "outside" };
	return {
		kind: "resolved",
		residency,
		source: "explicit-env-cell",
	};
}
