import { decodeClientCombatOutcome } from "../../client/client-host-contract";
import { CLIENT_COMBAT_EFFECTS_TUNING } from "../../client/client-tuning";
import type { Renderer } from "../../lib/game/renderer/renderer";
import type { GamePresentationRuntime } from "../../lib/game/runtime/game-presentation-runtime";
import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
import type { CombatEffectInstance } from "../../lib/game/systems/combat-effects-system";

/** Harness-only evidence from the production runtime-to-renderer lease boundary. */
export interface CombatEffectsRuntimeProof {
	readonly retainedPlacement: boolean;
	readonly missingTargetUnplaced: boolean;
	readonly criticalProfile: boolean;
	readonly resistProfile: boolean;
	readonly resetCleared: boolean;
	readonly hiddenExpired: boolean;
	readonly leaseCount: number;
}

/** Observe production submissions without adding diagnostic state to the effects owner. */
export class CombatEffectsRuntimeProbe {
	#instances: readonly CombatEffectInstance[] = [];
	#leaseCount = 0;

	attach(renderer: Renderer): void {
		const capability = renderer.combatEffects;
		if (!capability)
			throw new Error("Combat fixture renderer lacks effects capability.");
		const create = capability.create.bind(capability);
		capability.create = (tuning) => {
			this.#leaseCount++;
			const lease = create(tuning);
			return {
				setAppearance: (appearance) => lease.setAppearance(appearance),
				refreshFontAtlas: () => lease.refreshFontAtlas(),
				submit: (instances) => {
					this.#instances = [...instances];
					lease.submit(instances);
				},
				clear: () => {
					this.#instances = [];
					lease.clear();
				},
				release: () => lease.release(),
			};
		};
	}

	async run(
		runtime: GamePresentationRuntime,
		entity: DynamicEntityView,
	): Promise<CombatEffectsRuntimeProof> {
		const tuning = {
			...CLIENT_COMBAT_EFFECTS_TUNING,
			lifetimeMs: 1000,
			popMs: 100,
			fadeMs: 100,
		};
		const confirmed = decodeClientCombatOutcome({
			worldGeneration: 1,
			attribution: { kind: "attributed", target: entity.identity.guid },
			outcome: { kind: "damage", amount: 37, criticalHit: true },
		});
		runtime.acceptCombatOutcome(
			confirmed.outcome,
			entity.identity.guid,
			tuning,
			performance.now(),
		);
		const before = this.#instances[0];
		if (!before || before.placement.kind !== "world")
			throw new Error("Combat fixture target was not realized.");
		const captured = JSON.stringify(before.placement);
		runtime.removeDynamicEntity(entity.identity.guid, entity.generation);
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
		const retainedPlacement =
			this.#instances.length === 1 &&
			JSON.stringify(this.#instances[0].placement) === captured;
		const criticalProfile = this.#instances[0]?.profile === "critical";
		runtime.acceptCombatOutcome(
			confirmed.outcome,
			entity.identity.guid,
			tuning,
			performance.now(),
		);
		const missingTargetUnplaced =
			this.#instances[1]?.placement.kind === "unplaced" &&
			this.#instances[1]?.profile === "critical";
		runtime.acceptCombatOutcome(
			{ kind: "resisted" },
			null,
			tuning,
			performance.now(),
		);
		const resistProfile =
			this.#instances[2]?.text === "RESIST" &&
			this.#instances[2]?.profile === "avoidance";
		runtime.clearCombatEffects();
		const resetCleared = this.#instances.length === 0;
		// The presentation clock expires hidden outcomes independently of loading polls or world draws.
		runtime.acceptCombatOutcome(
			{ kind: "evaded" },
			null,
			tuning,
			performance.now() - tuning.lifetimeMs,
		);
		runtime.pollPortalTransitionLoading();
		runtime.advanceCombatEffects(performance.now());
		const hiddenExpired = this.#instances.length === 0;
		return {
			retainedPlacement,
			missingTargetUnplaced,
			criticalProfile,
			resistProfile,
			resetCleared,
			hiddenExpired,
			leaseCount: this.#leaseCount,
		};
	}
}
