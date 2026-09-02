import type { LandblockOwnerId } from "../game-types";
import type { TerrainFogCoverage } from "../environment/terrain-fog";
import {
	computeDungeonSceneInterest,
	computeOutdoorSceneInterest,
	type LandblockLayerKind,
	retainSceneInterestWithinExitMargin,
	type SceneInterestMap,
	type SceneInterestRequest,
	validateSceneInterestRadiiOrThrow,
} from "./scene-interest";
import type { ResolvedSceneInterestTarget } from "./scene-target";

type OutdoorSceneInterestTarget = Extract<
	ResolvedSceneInterestTarget,
	{ readonly kind: "outdoor" }
>;
type DungeonSceneInterestTarget = Extract<
	ResolvedSceneInterestTarget,
	{ readonly kind: "dungeon" }
>;

/** One render-interest policy transition, separated from asynchronous resource realization. */
export interface RenderSceneInterestTransition {
	/** Exact destination demand before hysteresis retention. */
	readonly nominalInterest: SceneInterestMap;
	/** Bounded demand including eligible prior memberships. */
	readonly effectiveInterest: SceneInterestMap;
}

/** Correlated render-interest facts that must change atomically. */
type RenderSceneInterestState =
	| { readonly kind: "empty"; readonly interest: SceneInterestMap }
	| {
			readonly kind: "outdoor";
			readonly interest: SceneInterestMap;
			readonly target: OutdoorSceneInterestTarget;
			readonly fogCoverage: TerrainFogCoverage;
	  }
	| {
			readonly kind: "dungeon";
			readonly interest: SceneInterestMap;
			readonly target: DungeonSceneInterestTarget;
	  };

const EMPTY_INTEREST: SceneInterestMap = new Map();

/** Owns synchronous render-interest policy while the runtime owns resource reconciliation. */
export class RenderSceneInterestController {
	#state: RenderSceneInterestState = {
		kind: "empty",
		interest: EMPTY_INTEREST,
	};

	/** Follow an outdoor target with hysteresis; dungeon requests remain exact. */
	follow(request: SceneInterestRequest): RenderSceneInterestTransition {
		const nominal = nominalSceneInterest(request);
		const effective =
			request.target.kind === "outdoor" && this.#state.kind === "outdoor"
				? retainSceneInterestWithinExitMargin(
						nominal,
						this.#state.interest,
						request.target.requested.landblockId,
						request.radii,
					)
				: nominal;
		this.#setState(request, effective);
		return { effectiveInterest: effective, nominalInterest: nominal };
	}

	/** Replace all prior policy state with one exact destination demand. */
	replace(request: SceneInterestRequest): RenderSceneInterestTransition {
		const nominal = nominalSceneInterest(request);
		this.#setState(request, nominal);
		return { effectiveInterest: nominal, nominalInterest: nominal };
	}

	/** Clear interest and all correlated target and fog context. */
	clear(): RenderSceneInterestTransition {
		this.#state = { kind: "empty", interest: EMPTY_INTEREST };
		return {
			effectiveInterest: EMPTY_INTEREST,
			nominalInterest: EMPTY_INTEREST,
		};
	}

	/** Layers currently authorizing one owner's render-dependent behavior. */
	layersFor(
		owner: LandblockOwnerId,
	): ReadonlySet<LandblockLayerKind> | undefined {
		return this.#state.interest.get(owner);
	}

	/** Current resolved target context for environment-dependent presentation. */
	resolvedTarget(): ResolvedSceneInterestTarget | null {
		return this.#state.kind === "empty" ? null : this.#state.target;
	}

	/** Current nominal outdoor terrain coverage used by fog policy. */
	fogCoverage(): TerrainFogCoverage | null {
		return this.#state.kind === "outdoor"
			? { ...this.#state.fogCoverage }
			: null;
	}

	/** Cloned effective interest and target context for diagnostics and harnesses. */
	snapshot(): {
		readonly interest: SceneInterestMap;
		readonly resolvedTarget: ResolvedSceneInterestTarget | null;
	} {
		return {
			interest: cloneSceneInterest(this.#state.interest),
			resolvedTarget: this.resolvedTarget(),
		};
	}

	#setState(request: SceneInterestRequest, interest: SceneInterestMap): void {
		this.#state =
			request.target.kind === "outdoor"
				? {
						kind: "outdoor",
						interest,
						target: request.target,
						fogCoverage: { terrainRadius: request.radii.terrainRadius },
					}
				: {
						kind: "dungeon",
						interest,
						target: request.target,
					};
	}
}

function nominalSceneInterest(request: SceneInterestRequest): SceneInterestMap {
	validateSceneInterestRadiiOrThrow(request.radii);
	return request.target.kind === "outdoor"
		? computeOutdoorSceneInterest(
				request.target.requested.landblockId,
				request.radii,
				request.ambientOutdoorEnvCellOwners,
			)
		: computeDungeonSceneInterest(request.target.requested.landblockId);
}

function cloneSceneInterest(interest: SceneInterestMap): SceneInterestMap {
	return new Map(
		[...interest].map(([owner, layers]) => [owner, new Set(layers)]),
	);
}
