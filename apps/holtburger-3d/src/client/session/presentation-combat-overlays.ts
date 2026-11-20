import { EMPTY_ENTITY_OVERLAY_FRAME } from "../../lib/game/renderer/overlays/entity-overlay-policy";
import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
import type { DynamicPresentationOverride } from "../../lib/game/runtime/dynamic-presentation-override";
import type { SummonVisualLevel } from "../../lib/game/runtime/summon-presentation";
import type { PrimaryCameraView } from "../../lib/game/runtime/types";
import type {
	CombatEffectsAppearance,
	CombatEffectsTuning,
} from "../../lib/game/systems/combat-effects-system";
import type { BarberPreview, BarberSnapshot } from "../character/barber-state";
import { ClientCombatHealthRequests } from "../combat/combat-health-requests";
import { distanceBetweenDynamicWorldPoses } from "../world/entity-distance";
import {
	ClientEntityOverlays,
	isAlertOverlayEntity,
	resolveActiveCombatEngagement,
	resolveFreshCreatureHealth,
	type NameplateMode,
} from "../world/entity-overlays";
import { projectClientEntityCenter } from "../world/entity-projection";
import type {
	ClientCombatOutcome,
	ClientCombatMode,
	ClientDynamicScriptCue,
	ClientDynamicSoundCue,
	ClientEntityCombatObserved,
} from "./host-contract";
import type { ClientLifecycleSession } from "./lifecycle-session";
import {
	ClientLockFeedbackEffects,
	type ClientLockFeedback,
	type ClientLockFeedbackFrame,
} from "../inventory/lock-feedback";
import type { ClientSummonLeashColors } from "../combat/summon-leash-appearance";
import {
	resolveImmediateCandidate,
	type CycleCandidate,
	type CycleSelectionPresentationFrame,
} from "../combat/target-acquisition";
import {
	projectClientCombatTarget,
	type ClientCombatTargetFrame,
} from "../combat/target-indicator";
import {
	CLIENT_COMBAT_EFFECTS_TUNING,
	CLIENT_LOCK_FEEDBACK_TUNING,
	CLIENT_SUMMON_TUNING,
	CLIENT_TUNING,
} from "../settings/tuning";
import type { ClientGameplayRuntime } from "./gameplay-presentation";

const EMPTY_ALERT_GUIDS: ReadonlySet<number> = new Set();

interface MutableCombatHealthCandidate {
	guid: number;
	generation: number;
	isHostileMob: boolean;
	distanceMeters: number | null;
	freshObservedAtMs: number | null;
}

/** One authority-scoped sound or script cue delivered to the borrowed runtime. */
type GameplayPresentationCue =
	| {
			readonly kind: "script";
			readonly worldGeneration: number;
			readonly cue: ClientDynamicScriptCue;
	  }
	| {
			readonly kind: "sound";
			readonly worldGeneration: number;
			readonly receivedAtMs: number;
			readonly cue: ClientDynamicSoundCue;
	  };

export interface ClientCombatAndOverlayOptions {
	readonly session: ClientLifecycleSession;
	readonly canvas: HTMLCanvasElement;
	readonly onLockFeedback?: () => void;
	readonly nameplateMode?: NameplateMode;
	readonly trackedAlertGuids?: () => ReadonlySet<number>;
	readonly sampleImmediateTargetCandidates?: (
		frame: CycleSelectionPresentationFrame,
	) => readonly CycleCandidate[] | null;
}

/**
 * Coordinates nameplates/overlays, combat health reconciliation, lock feedback,
 * combat effects & summon leash styling, barber appearance previews, and entity cues.
 */
export class ClientCombatAndOverlayPresenter {
	readonly #session: ClientLifecycleSession;
	readonly #canvas: HTMLCanvasElement;
	readonly #lockFeedback = new ClientLockFeedbackEffects();
	readonly #onLockFeedback: ClientCombatAndOverlayOptions["onLockFeedback"];
	readonly #combatHealth: ClientCombatHealthRequests;
	/** Reused candidate records for active combat health requests. */
	readonly #combatHealthCandidates: MutableCombatHealthCandidate[] = [];
	#combatEffectsTuning: CombatEffectsTuning = CLIENT_COMBAT_EFFECTS_TUNING;
	readonly #overlays: ClientEntityOverlays;
	readonly #trackedAlertGuids: () => ReadonlySet<number>;
	/** Applied alert memberships kept in sync so crest decorations reconcile only on changes. */
	readonly #appliedAlertGuids = new Set<number>();
	readonly #sampleImmediateTargetCandidates:
		| ((
				frame: CycleSelectionPresentationFrame,
		  ) => readonly CycleCandidate[] | null)
		| null;
	/** Null until the appearance scope resolves; no duplicate hardcoded theme palette. */
	#summonLeashColors: ClientSummonLeashColors | null = null;
	/** Candidate visuals stay imperative; only their owner publishes cold HUD readiness. */
	#barberPreview: BarberPreview | null = null;

	constructor(options: ClientCombatAndOverlayOptions) {
		this.#session = options.session;
		this.#canvas = options.canvas;
		this.#onLockFeedback = options.onLockFeedback;
		this.#trackedAlertGuids =
			options.trackedAlertGuids ?? (() => EMPTY_ALERT_GUIDS);
		this.#sampleImmediateTargetCandidates =
			options.sampleImmediateTargetCandidates ?? null;
		this.#combatHealth = new ClientCombatHealthRequests({
			tuning: CLIENT_TUNING.combatHealth,
			requestFacts: (guid, priority) =>
				this.#session.appraisals.requestFacts(guid, priority),
		});
		this.#overlays = new ClientEntityOverlays({
			tuning: CLIENT_TUNING.entityOverlays,
			initialMode: options.nameplateMode,
		});
	}

	/** Cold UI mode update; stops passive preview immediately when leaving Smart. */
	setNameplateMode(mode: NameplateMode): void {
		this.#overlays.setMode(mode);
	}

	/** Invalidate passive preview immediately after input targeting preferences change. */
	invalidateImmediateOverlayPreview(): void {
		this.#overlays.invalidateImmediatePreview();
	}

	setSelectedTarget(guid: number | null): void {
		this.#combatHealth.setSelectedTarget(guid);
	}

	/** Pull target-local overlays against the same presented camera as combat indicators. */
	readLockFeedbackFrames(
		view: PrimaryCameraView | null,
		runtime: ClientGameplayRuntime | undefined,
	): readonly ClientLockFeedbackFrame[] {
		return this.#lockFeedback.readFrames(
			performance.now(),
			this.#session.state().worldGeneration,
			(feedback) => {
				if (
					view === null ||
					this.#session.mirror.entity(feedback.target, feedback.generation) ===
						null
				) {
					return null;
				}
				const state = runtime?.dynamicEntityPresentationState(feedback.target);
				if (state?.kind !== "realized") return null;
				return projectClientEntityCenter({
					bounds: state.frame.localBounds,
					placement: state.frame.placement,
					view,
					cssWidth: this.#canvas.clientWidth,
					cssHeight: this.#canvas.clientHeight,
				});
			},
		);
	}

	/** A clipped feedback still needs polling until its existing lifetime expires. */
	hasActiveLockFeedback(): boolean {
		return this.#lockFeedback.active;
	}

	/** Pull the combat bound and presented camera without publishing frame-hot UI state. */
	readCombatTargetFrame(
		view: PrimaryCameraView | null,
		runtime: ClientGameplayRuntime | undefined,
	): ClientCombatTargetFrame | null {
		// Pending non-self spell cast takes presentation priority without changing auto-attack intent.
		const engagement = resolveActiveCombatEngagement(this.#session.state());
		const state =
			engagement === null
				? null
				: runtime?.dynamicEntityPresentationState(engagement.target);
		if (view === null || engagement === null || state?.kind !== "realized") {
			return null;
		}
		const projection = projectClientCombatTarget({
			heightFraction: engagement.heightFraction,
			tuning: CLIENT_TUNING.combatTargetIndicator,
			bounds: state.frame.localBounds,
			placement: state.frame.placement,
			view,
			cssWidth: this.#canvas.clientWidth,
			cssHeight: this.#canvas.clientHeight,
		});
		return projection === null
			? null
			: { ...projection, combatType: engagement.combatType };
	}

	/** Apply gameplay effect appearance when attached and when preferences change. */
	setCombatEffectsAppearance(
		appearance: CombatEffectsAppearance,
		runtime: ClientGameplayRuntime | undefined,
	): void {
		this.#combatEffectsTuning = { ...this.#combatEffectsTuning, ...appearance };
		runtime?.setCombatEffectsAppearance(appearance);
	}

	refreshCombatEffectsFontAtlas(
		runtime: ClientGameplayRuntime | undefined,
	): void {
		runtime?.refreshCombatEffectsFontAtlas();
	}

	/** Theme changes update existing leashes without replacing the runtime or its GPU resources. */
	setSummonLeashColors(
		colors: ClientSummonLeashColors,
		runtime: ClientGameplayRuntime | undefined,
	): void {
		this.#summonLeashColors = colors;
		this.reconcileEntityPresentationPolicy(runtime);
	}

	acceptLockFeedback(feedback: ClientLockFeedback): void {
		if (
			this.#session.mirror.isAwaitingSnapshot() ||
			feedback.worldGeneration !== this.#session.state().worldGeneration
		) {
			return;
		}
		this.#lockFeedback.accept(
			feedback,
			performance.now(),
			CLIENT_LOCK_FEEDBACK_TUNING,
		);
		this.#onLockFeedback?.();
	}

	acceptCombatOutcome(
		outcome: ClientCombatOutcome,
		receivedAtMs: number,
		runtime: ClientGameplayRuntime | undefined,
	): void {
		if (
			this.#session.mirror.isAwaitingSnapshot() ||
			outcome.worldGeneration !== this.#session.state().worldGeneration
		) {
			return;
		}
		if (outcome.attribution.kind === "attributed") {
			this.#combatHealth.acceptPlayerAttack(
				outcome.attribution.target,
				this.#hostNowMs(receivedAtMs),
			);
		}
		runtime?.acceptCombatOutcome(
			outcome.outcome,
			outcome.attribution.kind === "attributed"
				? outcome.attribution.target
				: null,
			this.#combatEffectsTuning,
			receivedAtMs,
		);
	}

	setCombatMode(mode: ClientCombatMode): void {
		this.#combatHealth.setCombatMode(mode);
		this.#overlays.invalidateImmediatePreview();
	}

	setCombatTarget(target: number | null): void {
		this.#combatHealth.setCombatTarget(
			target,
			this.#hostNowMs(performance.now()),
		);
	}

	acceptCombatObserved(combat: ClientEntityCombatObserved): void {
		this.#combatHealth.acceptCombatObserved(combat);
	}

	acceptAppraisalFactsSettled(guid: number): void {
		this.#combatHealth.acceptAppraisalFactsSettled(guid);
	}

	removeEntity(guid: number, generation: number): void {
		this.#appliedAlertGuids.delete(guid);
		this.#lockFeedback.remove(guid, generation);
		this.#combatHealth.removeEntity(guid);
	}

	clearLockFeedback(): void {
		this.#lockFeedback.clear();
	}

	clearOverlays(): void {
		this.#appliedAlertGuids.clear();
		this.#overlays.clear();
	}

	clearOverlayPresentation(runtime: ClientGameplayRuntime | undefined): void {
		this.#appliedAlertGuids.clear();
		this.#overlays.clear();
		runtime?.setEntityOverlayFrame(EMPTY_ENTITY_OVERLAY_FRAME);
	}

	syncCombatHealthWorld(forceReset: boolean): void {
		const sessionState = this.#session.state();
		if (
			forceReset ||
			this.#combatHealth.worldGeneration() !== sessionState.worldGeneration
		) {
			this.#combatHealth.resetWorld(sessionState.worldGeneration);
		}
		this.#combatHealth.setCombatMode(sessionState.combatMode);
		this.#combatHealth.setCombatTarget(
			sessionState.combat.desired?.target ?? null,
			this.#hostNowMs(performance.now()),
		);
	}

	reconcileCombatHealth(nowMs: number): void {
		if (this.#combatHealth.isIdle()) return;
		const hostNowSeconds = this.#hostNowSeconds(nowMs);
		if (hostNowSeconds === null) return;
		const hostNowMs = hostNowSeconds * 1_000;
		const read = this.#session.entities.read();
		if (read.kind !== "current") {
			this.#combatHealth.reconcile([], hostNowMs);
			return;
		}
		const levelEntities = read.level.entities;
		const player =
			read.level.playerGuid === null
				? null
				: this.#session.mirror.entityByGuid(read.level.playerGuid);
		const playerPose =
			player?.placement.kind === "world" ? player.placement.pose : null;
		const recentWindowSeconds =
			CLIENT_TUNING.combatHealth.recentWindowMs / 1_000;
		const candidates = this.#combatHealthCandidates;
		let candidateCount = 0;
		for (const dynamic of this.#session.mirror.currentEntities()) {
			const guid = dynamic.identity.guid;
			const facts = levelEntities.get(guid);
			const isHostileMob =
				dynamic.presentation.entityClass === "mob" &&
				facts !== undefined &&
				facts.isHostile &&
				facts.corpse === null;
			const distanceMeters =
				isHostileMob &&
				playerPose !== null &&
				dynamic.placement.kind === "world"
					? distanceBetweenDynamicWorldPoses(playerPose, dynamic.placement.pose)
					: null;
			const freshHealth = resolveFreshCreatureHealth(
				facts,
				dynamic.generation,
				hostNowSeconds,
				recentWindowSeconds,
			);
			const freshObservedAtMs =
				freshHealth === null ? null : freshHealth.observedAtSeconds * 1_000;
			const candidate = candidates[candidateCount];
			if (candidate === undefined) {
				candidates.push({
					guid,
					generation: dynamic.generation,
					isHostileMob,
					distanceMeters,
					freshObservedAtMs,
				});
			} else {
				candidate.guid = guid;
				candidate.generation = dynamic.generation;
				candidate.isHostileMob = isHostileMob;
				candidate.distanceMeters = distanceMeters;
				candidate.freshObservedAtMs = freshObservedAtMs;
			}
			candidateCount += 1;
		}
		candidates.length = candidateCount;
		this.#combatHealth.reconcile(candidates, hostNowMs);
	}

	publishEntityOverlays(
		runtime: ClientGameplayRuntime,
		player: DynamicEntityView,
		nowMs: number,
		selectedGuid: number | null,
		hoveredGuid: number | null,
		readyAndCameraActive: boolean,
		withCycleSelectionFrame: <T>(
			visit: (frame: CycleSelectionPresentationFrame) => T,
		) => T | null,
	): void {
		const read = this.#session.entities.read();
		const hostNowSeconds = this.#hostNowSeconds(nowMs);
		if (
			read.kind !== "current" ||
			player.placement.kind !== "world" ||
			hostNowSeconds === null
		) {
			this.clearOverlayPresentation(runtime);
			return;
		}
		const engagement = resolveActiveCombatEngagement(this.#session.state());
		const sampleCandidates =
			readyAndCameraActive && this.#sampleImmediateTargetCandidates !== null
				? this.#sampleImmediateTargetCandidates
				: null;
		const alertGuids = this.#trackedAlertGuids();
		for (const guid of alertGuids) {
			if (!this.#appliedAlertGuids.has(guid)) {
				this.#appliedAlertGuids.add(guid);
				this.reconcileEntityNameplate(guid, runtime);
			}
		}
		for (const guid of this.#appliedAlertGuids) {
			if (!alertGuids.has(guid)) {
				this.#appliedAlertGuids.delete(guid);
				this.reconcileEntityNameplate(guid, runtime);
			}
		}
		const frame = this.#overlays.composeFrame({
			nowMs,
			hostNowSeconds,
			playerGuid: player.identity.guid,
			playerPose: player.placement.pose,
			dynamicEntities: this.#session.mirror.currentEntities(),
			resolveDynamicGeneration: (guid) =>
				this.#session.mirror.entityByGuid(guid)?.generation ?? null,
			factsEntities: read.level.entities,
			selectedGuid,
			hoveredGuid,
			activeCombatTargetGuid: engagement?.target ?? null,
			alertGuids,
			categoryVisibility:
				CLIENT_TUNING.frameSettings.nameplates.categoryVisibility,
			sampleImmediateTarget:
				sampleCandidates === null
					? undefined
					: () =>
							withCycleSelectionFrame((selectionFrame) => {
								const sampled = sampleCandidates(selectionFrame);
								if (sampled === null) return null;
								return (
									resolveImmediateCandidate(sampled, "smart-combat")?.guid ??
									null
								);
							}),
		});
		runtime.setEntityOverlayFrame(frame);
	}

	/** Reconcile app-owned summon effects and name decorations from the complete semantic level. */
	reconcileEntityPresentationPolicy(
		runtime: ClientGameplayRuntime | undefined,
	): void {
		const read = this.#session.entities.read();
		const nowMs = performance.now();
		const serverTime = this.#session.readServerTime(nowMs);
		const playerGuid = this.#session.state().playerGuid;
		const levels: SummonVisualLevel[] = [];
		const colors = this.#summonLeashColors;
		if (read.kind === "current") {
			for (const entity of read.level.entities.values()) {
				const summon = entity.summon;
				if (summon === null || summon.activity !== "active") continue;
				levels.push({
					guid: entity.guid,
					generation: summon.instanceSequence,
					leash:
						colors === null
							? null
							: {
									owner: summon.owner,
									color:
										summon.owner === playerGuid ? colors.own : colors.other,
								},
					expiresAtSeconds:
						summon.lifetime.kind === "estimated" && serverTime !== null
							? nowMs / 1000 + summon.lifetime.expiresAtServerTime - serverTime
							: null,
				});
			}
		}
		runtime?.setSummonVisuals(levels, CLIENT_SUMMON_TUNING);
		for (const dynamic of this.#session.mirror.currentEntities()) {
			this.reconcileEntityNameplate(dynamic.identity.guid, runtime);
		}
	}

	/** Project semantic corpse, summon, and alert state into app-local decoration without copying display facts. */
	reconcileEntityNameplate(
		guid: number,
		runtime: ClientGameplayRuntime | undefined,
	): void {
		const entities = this.#session.entities.read();
		if (runtime === undefined || entities.kind !== "current") return;
		const facts = entities.level.entities.get(guid);
		const opened = facts?.corpse === "opened";
		const isAlert = isAlertOverlayEntity(
			facts,
			this.#trackedAlertGuids(),
			guid,
		);
		runtime.setDynamicEntityNameplateDecoration(guid, {
			indicators: [],
			strikeThrough: opened,
			...(facts !== undefined && facts.summon !== null
				? { nameColor: "player" as const }
				: {}),
			...(isAlert ? { crest: "alert" as const } : {}),
		});
	}

	setBarberPreview(preview: BarberPreview | null): void {
		this.#barberPreview = preview;
	}

	/** Active barber appearance editing suppresses idle camera orbit. */
	hasActiveBarberPreview(): boolean {
		return this.#barberPreview !== null;
	}

	async reconcileBarberPresentation(
		snapshot: BarberSnapshot,
		playerGuid: number | null,
		runtime: ClientGameplayRuntime | undefined,
	): Promise<void> {
		const interaction = snapshot.interaction;
		const preview = this.#barberPreview;
		const usable =
			preview !== null &&
			preview.outcome.kind === "ready" &&
			interaction?.id === preview.id &&
			(interaction.phase.kind === "editing" ||
				interaction.phase.kind === "sending");
		if (!usable) this.#barberPreview = null;
		const committed = snapshot.particles;
		const subject = usable ? preview.subject : committed?.subject;
		const entity =
			subject === undefined
				? null
				: this.#session.mirror.entityByGuid(subject.guid);
		let level: DynamicPresentationOverride | null = null;
		if (
			subject !== undefined &&
			subject.guid === playerGuid &&
			entity?.generation === subject.instance
		) {
			const candidate =
				usable && preview.outcome.kind === "ready" ? preview.outcome : null;
			const particle =
				candidate?.particles.kind === "replace" &&
				interaction?.phase.kind !== "sending"
					? {
							key: `preview:${preview?.id}:${candidate.particles.script}`,
							script: candidate.particles.script,
						}
					: committed?.subject.guid === subject.guid &&
						  committed.subject.instance === subject.instance
						? { key: `apply:${committed.revision}`, script: committed.script }
						: null;
			level = {
				guid: subject.guid,
				generation: subject.instance,
				body:
					candidate === null
						? null
						: { setupDid: candidate.setup, appearance: candidate.appearance },
				particles: particle,
			};
		}
		await runtime?.setDynamicPresentationOverride(level);
	}

	deliverEntityCue(
		pending: GameplayPresentationCue,
		isDestroyed: boolean,
		runtime: ClientGameplayRuntime | undefined,
	): void {
		if (
			isDestroyed ||
			pending.worldGeneration !== this.#session.state().worldGeneration
		) {
			return;
		}
		if (runtime === undefined) return;
		if (pending.kind === "script") {
			runtime.playDynamicEntityScriptCue(pending.cue);
		} else {
			runtime.playDynamicEntitySoundCue(pending.cue, pending.receivedAtMs);
		}
	}

	destroy(): void {
		this.#appliedAlertGuids.clear();
		this.#lockFeedback.clear();
		this.#combatHealth.destroy();
	}

	#hostNowSeconds(localNowMs: number): number | null {
		return this.#session.mirror.isAwaitingSnapshot()
			? null
			: this.#session.mirror.hostTimeSeconds(localNowMs / 1_000);
	}

	#hostNowMs(localNowMs: number): number | null {
		const seconds = this.#hostNowSeconds(localNowMs);
		return seconds === null ? null : seconds * 1_000;
	}
}
