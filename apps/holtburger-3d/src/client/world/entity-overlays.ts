import { tryEntityHorizontalForward } from "../../lib/game/math/camera-orientation";
import type {
	EntityOverlayEntry,
	EntityOverlayFrame,
	EntityOverlayOcclusion,
	EntityOverlayPriority,
} from "../../lib/game/renderer/entity-overlay-policy";
import {
	resolveNameplateCategory,
	type NameplateCategory,
} from "../../lib/game/renderer/nameplate-policy";
import type {
	DynamicEntityView,
	DynamicEntityWorldPlacement,
} from "../../lib/game/runtime/dynamic-entity-feed";
import {
	deltaBetweenDynamicWorldPoses,
	distanceSquaredBetweenDynamicWorldPoses,
} from "./entity-distance";
import type { ClientEntityFacts } from "./entity-mirror";
import type {
	ClientCombatMode,
	ClientCombatStatus,
} from "../session/host-contract";
import type { ClientNameplateMode } from "../settings/settings-contract";
import { CLIENT_TUNING } from "../settings/tuning";
import type { ClientEntityOverlayTuning } from "../settings/tuning-contract";

export type NameplateMode = ClientNameplateMode;

type WorldPose = DynamicEntityWorldPlacement["pose"];

/** Active offensive engagement target shared by the combat reticle and overlay policy. */
export interface ActiveCombatEngagement {
	readonly target: number;
	readonly combatType: "melee" | "missile" | "magic";
	readonly heightFraction: number;
}

/**
 * Resolve active combat engagement shared between `readCombatTargetFrame()` and nameplate/bar
 * priority: pending non-self `spellCastTarget` takes priority, otherwise `combat.desired.target`
 * while confirmed combat mode is melee, missile, or magic.
 */
export function resolveActiveCombatEngagement(state: {
	readonly combatMode: ClientCombatMode;
	readonly spellCastTarget: number | null;
	readonly combat: { readonly desired: ClientCombatStatus["desired"] };
}): ActiveCombatEngagement | null {
	if (state.spellCastTarget !== null) {
		return {
			target: state.spellCastTarget,
			combatType: "magic",
			heightFraction: 0.5,
		};
	}
	if (
		state.combatMode !== "melee" &&
		state.combatMode !== "missile" &&
		state.combatMode !== "magic"
	) {
		return null;
	}
	if (state.combat.desired === null) return null;
	return {
		target: state.combat.desired.target,
		combatType: state.combat.desired.profile.kind,
		heightFraction:
			CLIENT_TUNING.combatTargetIndicator.heightFractions[
				state.combat.desired.profile.height
			],
	};
}

/**
 * Evaluate Smart proximity using the player's body facing (not camera facing), horizontal total arc
 * (`proximityArcDegrees`), and inclusive 3D root-to-root Euclidean distance (`proximityRadiusMeters`).
 * Distinct coincident horizontal origins are within the cone if 3D distance qualifies.
 */
export function isWithinSmartProximity(
	playerPose: WorldPose,
	candidatePose: WorldPose,
	tuning: Pick<
		ClientEntityOverlayTuning,
		"proximityArcDegrees" | "proximityRadiusMeters"
	>,
): boolean {
	const { dx, dy, dz } = deltaBetweenDynamicWorldPoses(
		playerPose,
		candidatePose,
	);
	const distanceSquared = dx * dx + dy * dy + dz * dz;
	if (
		distanceSquared >
		tuning.proximityRadiusMeters * tuning.proximityRadiusMeters
	)
		return false;
	const horizontalLengthSquared = dx * dx + dy * dy;
	if (horizontalLengthSquared <= Number.EPSILON * Number.EPSILON) {
		return true;
	}
	const forward = tryEntityHorizontalForward(playerPose.rotation);
	if (forward === null) return false;
	const cosHalfArc = Math.cos(
		(tuning.proximityArcDegrees * 0.5 * Math.PI) / 180,
	);
	const dot = dx * forward.x + dy * forward.y;
	return dot >= cosHalfArc * Math.sqrt(horizontalLengthSquared);
}

/**
 * Return the authoritative creature health snapshot when it matches the living incarnation and is
 * fresh on the host timeline, else null. Tolerates negative snapshot-IPC skew (`hostNow - observed < window`).
 */
export function resolveFreshCreatureHealth(
	facts: ClientEntityFacts | undefined,
	generation: number,
	hostNowSeconds: number | null,
	recentWindowSeconds: number,
): NonNullable<ClientEntityFacts["health"]> | null {
	if (
		hostNowSeconds === null ||
		facts === undefined ||
		facts.targeting !== "creature" ||
		facts.corpse !== null ||
		facts.health === null ||
		facts.health.instanceSequence !== generation
	)
		return null;
	if (hostNowSeconds - facts.health.observedAtSeconds >= recentWindowSeconds)
		return null;
	return facts.health;
}

/**
 * Provisional broad creature health-bar admission: fresh damaged creature within distance bound,
 * matching incarnation generation, and fraction strictly below 1 (0% remains visible until corpse/gone).
 */
export function resolveVisibleHealthBarFraction(input: {
	readonly dynamic: DynamicEntityView;
	readonly facts: ClientEntityFacts | undefined;
	readonly playerPose: WorldPose | null;
	readonly hostNowSeconds: number | null;
	readonly recentWindowSeconds: number;
	readonly maxDistanceSquared: number;
}): number | null {
	const {
		dynamic,
		facts,
		playerPose,
		hostNowSeconds,
		recentWindowSeconds,
		maxDistanceSquared,
	} = input;
	const health = resolveFreshCreatureHealth(
		facts,
		dynamic.generation,
		hostNowSeconds,
		recentWindowSeconds,
	);
	if (health === null) return null;
	if (!Number.isFinite(health.fraction) || health.fraction >= 1) return null;
	if (playerPose === null || dynamic.placement.kind !== "world") return null;
	if (
		distanceSquaredBetweenDynamicWorldPoses(
			playerPose,
			dynamic.placement.pose,
		) > maxDistanceSquared
	)
		return null;
	return Math.max(0, health.fraction);
}

/** Inputs supplied by gameplay presentation each ready frame to compose overlays. */
export interface ClientEntityOverlaysFrameInput {
	readonly nowMs: number;
	readonly hostNowSeconds: number | null;
	readonly playerGuid: number;
	readonly playerPose: WorldPose | null;
	readonly dynamicEntities: Iterable<DynamicEntityView>;
	readonly resolveDynamicGeneration: (guid: number) => number | null;
	readonly factsEntities: ReadonlyMap<number, ClientEntityFacts>;
	readonly selectedGuid: number | null;
	readonly hoveredGuid: number | null;
	readonly activeCombatTargetGuid: number | null;
	readonly alertGuids: ReadonlySet<number>;
	readonly categoryVisibility: Readonly<Record<NameplateCategory, boolean>>;
	readonly sampleImmediateTarget?: () => number | null;
}

/**
 * Owns Smart Nameplate policy composition, passive 10 Hz Smart Tab immediate preview cadence,
 * and independent creature health-bar admission for ready in-world gameplay.
 */
export class ClientEntityOverlays {
	readonly #tuning: ClientEntityOverlayTuning;
	#mode: NameplateMode;
	#nextPreviewAtMs: number | null = null;
	#immediateTarget: {
		readonly guid: number;
		readonly generation: number;
	} | null = null;
	readonly #entities = new Map<number, EntityOverlayEntry>();

	constructor(options: {
		readonly tuning: ClientEntityOverlayTuning;
		readonly initialMode?: NameplateMode;
	}) {
		this.#tuning = options.tuning;
		this.#mode = options.initialMode ?? "smart";
	}

	/** Switch cold presentation mode; stops passive preview and clears cached preview state when leaving Smart. */
	setMode(mode: NameplateMode): void {
		if (this.#mode === mode) return;
		this.#mode = mode;
		this.#immediateTarget = null;
		this.#nextPreviewAtMs = null;
	}

	/** Clear cached passive preview and reused resolved entries across lifecycle/portal/discontinuity boundaries. */
	clear(): void {
		this.#immediateTarget = null;
		this.#nextPreviewAtMs = null;
		this.#entities.clear();
	}

	/** Invalidate passive preview after targeting filters, party, or combat stance change. */
	invalidateImmediatePreview(): void {
		this.#immediateTarget = null;
		this.#nextPreviewAtMs = null;
	}

	/** Synchronously compose the borrowed `resolved` overlay frame from current authoritative facts. */
	composeFrame(input: ClientEntityOverlaysFrameInput): EntityOverlayFrame {
		this.#updateImmediatePreview(input);
		this.#entities.clear();
		const recentWindowSeconds = this.#tuning.healthRecentWindowMs / 1_000;
		const maxDistanceSquared =
			this.#tuning.healthMaxDistanceMeters *
			this.#tuning.healthMaxDistanceMeters;

		for (const dynamic of input.dynamicEntities) {
			const guid = dynamic.identity.guid;
			const facts = input.factsEntities.get(guid);
			const isSelected = guid === input.selectedGuid;
			const isHovered = guid === input.hoveredGuid;
			const isCombatTarget = guid === input.activeCombatTargetGuid;
			const hasNameplate = dynamic.display.name.trim().length > 0;

			let nameplate: EntityOverlayPriority | null = null;
			if (hasNameplate) {
				if (isSelected || isHovered) {
					nameplate = "focus";
				} else if (
					this.#mode !== "minimal" &&
					facts?.targeting !== "projectile"
				) {
					// Projectiles never receive automatic nameplates so fired shots do not flash labels.
					const isSmartImmediate =
						this.#mode === "smart" &&
						this.#immediateTarget !== null &&
						this.#immediateTarget.guid === guid &&
						this.#immediateTarget.generation === dynamic.generation;
					if (isCombatTarget || isSmartImmediate) {
						nameplate = "focus";
					} else if (input.alertGuids.has(guid)) {
						nameplate = "alert";
					} else if (this.#mode === "smart") {
						if (
							guid !== input.playerGuid &&
							input.playerPose !== null &&
							dynamic.placement.kind === "world" &&
							isWithinSmartProximity(
								input.playerPose,
								dynamic.placement.pose,
								this.#tuning,
							)
						) {
							nameplate = "ambient";
						}
					} else {
						const category = resolveNameplateCategory(
							dynamic.presentation.entityClass,
							guid === input.playerGuid,
						);
						if (input.categoryVisibility[category]) {
							nameplate = "ambient";
						}
					}
				}
			}

			const barFraction = resolveVisibleHealthBarFraction({
				dynamic,
				facts,
				playerPose: input.playerPose,
				hostNowSeconds: input.hostNowSeconds,
				recentWindowSeconds,
				maxDistanceSquared,
			});
			const healthBar =
				barFraction === null
					? null
					: {
							fraction: barFraction,
							priority:
								isSelected || isHovered || isCombatTarget
									? ("focus" as const)
									: ("ambient" as const),
						};

			if (nameplate === null && healthBar === null) continue;
			const occlusion: EntityOverlayOcclusion =
				isSelected || isHovered ? "overlay" : "scene";
			this.#entities.set(guid, {
				generation: dynamic.generation,
				presentation: {
					occlusion,
					nameplate,
					healthBar,
				},
			});
		}

		return {
			kind: "resolved",
			entities: this.#entities,
		};
	}

	#updateImmediatePreview(input: ClientEntityOverlaysFrameInput): void {
		if (this.#mode !== "smart" || input.sampleImmediateTarget === undefined) {
			this.#immediateTarget = null;
			this.#nextPreviewAtMs = null;
			return;
		}
		if (this.#immediateTarget !== null) {
			const currentGen = input.resolveDynamicGeneration(
				this.#immediateTarget.guid,
			);
			if (
				currentGen !== this.#immediateTarget.generation ||
				!input.factsEntities.has(this.#immediateTarget.guid)
			) {
				// Never carry an old incarnation's preview across despawn or GUID reuse.
				this.#immediateTarget = null;
			}
		}
		if (this.#nextPreviewAtMs !== null && input.nowMs < this.#nextPreviewAtMs) {
			return;
		}
		const winnerGuid = input.sampleImmediateTarget();
		const winnerGen =
			winnerGuid === null ? null : input.resolveDynamicGeneration(winnerGuid);
		this.#immediateTarget =
			winnerGuid !== null &&
			winnerGen !== null &&
			input.factsEntities.has(winnerGuid)
				? { guid: winnerGuid, generation: winnerGen }
				: null;
		// Schedule from current time without catch-up bursts after delayed/background frames.
		this.#nextPreviewAtMs =
			input.nowMs + this.#tuning.immediatePreviewIntervalMs;
	}
}
