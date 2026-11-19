import { formatError } from "../lib/format-error";
import { normalizeLandblockOwner } from "../lib/game/landblocks";
import {
	datAssetId,
	hasUsableDynamicBody,
	type DynamicEntityRealizationResults,
} from "../lib/game/runtime/dynamic-entity-presentation";
import type {
	DynamicEntityView,
	DynamicEntityWorldPlacement,
} from "../lib/game/runtime/dynamic-entity-feed";
import {
	SceneInterestRequestCoordinator,
	type SceneInterestTarget,
} from "../lib/game/runtime/scene-target";
import type { SceneInterestMembership } from "../lib/game/runtime/render-scene-interest-controller";
import { validateSceneInterestRadiiOrThrow } from "../lib/game/runtime/scene-interest";
import type {
	PrimaryCameraView,
	SceneInterestRadii,
} from "../lib/game/runtime/types";
import type { ResolvedSceneOrigin } from "../lib/game/scene";
import type { SceneActivationReceipt } from "../lib/game/runtime/scene-availability";
import { PortalTransitionController } from "../lib/client/portal-transition-controller";
import type {
	PortalRevealReceipt,
	PortalTransitionPresentationPlan,
	PortalTransitionPresentationReceipt,
} from "../lib/client/portal-transition-presentation";
import {
	CLIENT_GRAPHICS_DEFAULTS,
	clientSceneInterestRadii,
} from "./client-settings-policy";
import { CLIENT_GRAPHICS_RANGES } from "./client-settings-values";
import { CLIENT_TUNING } from "./client-tuning";
import type { ClientLifecycle } from "./client-host-contract";
import type { ClientGameplayPresentationResources } from "./client-gameplay-presentation";

/** One exact portal destination's static acceptance and dynamic installation progress. */
type PortalSceneActivation =
	| {
			readonly kind: "requesting";
			readonly generation: number;
			readonly key: string;
	  }
	| {
			readonly kind: "accepted";
			readonly generation: number;
			readonly key: string;
			readonly receipt: SceneActivationReceipt;
			readonly realization: "idle" | "pending" | "deferred" | "ready";
			/** Exact player residency/membership facts used by the latest realization attempt. */
			readonly realizedPlayerPlacementKey: string | null;
			readonly revealAcknowledged: boolean;
	  };

/** One generation-current answer to whether the destination's static/player barriers are ready. */
type PortalActivationReadiness =
	| {
			readonly kind: "waiting";
			readonly status: "loading-activation" | "loading-player";
			readonly diagnostic?: string;
	  }
	| { readonly kind: "failed"; readonly diagnostic: string }
	| { readonly kind: "ready"; readonly origin: ResolvedSceneOrigin };

/** Settled destination view retained unchanged for every frame of one portal exit. */
interface PortalDestinationFrame {
	readonly generation: number;
	readonly primaryView: PrimaryCameraView;
}

export interface ClientScenePortalContext {
	readonly onSceneMembership?: (source: SceneInterestMembership | null) => void;
	readonly isActiveResources: (
		resources: ClientGameplayPresentationResources,
	) => boolean;
	readonly isDestroyed: () => boolean;
	readonly isAwaitingSnapshot: () => boolean;
	readonly playerGuid: () => number | null;
	readonly worldGeneration: () => number;
	readonly authoritativePlayer: (guid: number) => DynamicEntityView | null;
	readonly observeWork: (completion: Promise<unknown>) => void;
	readonly onError: (error: unknown) => void;
}

/**
 * Coordinates scene interest demand, portal activation convergence barriers, and portal transitions.
 *
 * Keeps destination camera retention, deferred dynamic eligibility retries, and scene profile
 * request cancellation isolated from frame rendering and combat/overlay state.
 */
export class ClientScenePortalCoordinator {
	#sceneInterestRadii: SceneInterestRadii = clientSceneInterestRadii(
		CLIENT_GRAPHICS_DEFAULTS.viewDistance,
	);
	#sceneInterestRevision = 0;
	#fieldOfView: number = CLIENT_GRAPHICS_DEFAULTS.verticalFovDegrees;
	#pendingFieldOfView: number | null = null;
	#sceneInterestCoordinator: SceneInterestRequestCoordinator | null = null;
	#sceneTargetKey: string | null = null;
	#portalSceneActivation: PortalSceneActivation | null = null;
	#portalDestinationFrame: PortalDestinationFrame | null = null;
	readonly #portalTransition = new PortalTransitionController(
		CLIENT_TUNING.portalTransition.timing,
	);
	readonly #context: ClientScenePortalContext;

	constructor(context: ClientScenePortalContext) {
		this.#context = context;
	}

	attach(resources: ClientGameplayPresentationResources): void {
		this.#context.onSceneMembership?.(
			resources.runtime.sceneInterestMembership(),
		);
		this.#sceneInterestCoordinator = new SceneInterestRequestCoordinator(
			resources.profileSource,
		);
	}

	detach(resources: ClientGameplayPresentationResources | null): void {
		this.#sceneInterestCoordinator?.invalidate();
		this.#sceneInterestCoordinator = null;
		this.#context.onSceneMembership?.(null);
		if (resources !== null) {
			resources.runtime.setPortalTransition(undefined);
			resources.runtime.clearSceneInterest();
		}
	}

	invalidateCoordinator(): void {
		this.#sceneInterestCoordinator?.invalidate();
	}

	fieldOfView(): number {
		return this.#fieldOfView;
	}

	/** The host acknowledges a projection revision before the new FOV becomes visible. */
	setFieldOfView(degrees: number): void {
		if (
			!Number.isFinite(degrees) ||
			degrees < CLIENT_GRAPHICS_RANGES.verticalFovDegrees.minimum ||
			degrees > CLIENT_GRAPHICS_RANGES.verticalFovDegrees.maximum
		) {
			throw new Error(
				"Client vertical field of view is outside the configurable range.",
			);
		}
		if (this.#portalTransition.activeGeneration() !== null) {
			this.#pendingFieldOfView = degrees;
		} else {
			this.#fieldOfView = degrees;
		}
	}

	/** Reissue static demand on the next frame even if the player has not moved. */
	setSceneInterestRadii(radii: SceneInterestRadii): void {
		validateSceneInterestRadiiOrThrow(radii);
		if (
			this.#sceneInterestRadii.terrainRadius === radii.terrainRadius &&
			this.#sceneInterestRadii.buildingRadius === radii.buildingRadius &&
			this.#sceneInterestRadii.explicitObjectRadius ===
				radii.explicitObjectRadius &&
			this.#sceneInterestRadii.generatedObjectRadius ===
				radii.generatedObjectRadius &&
			this.#sceneInterestRadii.envCellRadius === radii.envCellRadius
		) {
			return;
		}
		this.#sceneInterestRadii = radii;
		this.#sceneInterestRevision += 1;
	}

	activePortalGeneration(): number | null {
		return this.#portalTransition.activeGeneration();
	}

	portalDestinationFrame(generation: number): PrimaryCameraView | null {
		return this.#portalDestinationFrame?.generation === generation
			? this.#portalDestinationFrame.primaryView
			: null;
	}

	setPortalDestinationFrame(
		generation: number,
		primaryView: PrimaryCameraView,
	): void {
		this.#portalDestinationFrame = { generation, primaryView };
	}

	/** Start one generation-keyed portal presentation edge and choose outgoing capture policy. */
	ensurePortalTransition(
		resources: ClientGameplayPresentationResources,
		lifecycle: Extract<ClientLifecycle, { kind: "portal-space" }>,
		hasRenderedFrame: boolean,
		onResetCamera: () => void,
	): void {
		const generation = this.#portalTransition.activeGeneration();
		if (generation === lifecycle.worldGeneration) return;
		if (this.#portalSceneActivation?.kind === "accepted") {
			resources.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = null;
		this.#portalDestinationFrame = null;
		resources.runtime.setAudioListener(null);
		onResetCamera();
		const origin =
			generation === null && lifecycle.cause === "teleport" && hasRenderedFrame
				? { kind: "capture-last-world" as const }
				: { kind: "absent" as const };
		this.#portalTransition.begin(lifecycle.worldGeneration, origin);
		resources.runtime.playPortalTransitionSound?.("enter");
	}

	exitPortalToWorld(resources: ClientGameplayPresentationResources): void {
		this.#portalTransition.reset();
		if (this.#pendingFieldOfView !== null) {
			this.#fieldOfView = this.#pendingFieldOfView;
			this.#pendingFieldOfView = null;
		}
		resources.runtime.setPortalTransition(undefined);
		if (this.#portalSceneActivation?.kind === "accepted") {
			resources.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = null;
		this.#portalDestinationFrame = null;
	}

	/** Resolve and install one exact destination before any portal frame is acknowledged. */
	syncSceneActivation(
		resources: ClientGameplayPresentationResources,
		player: DynamicEntityView,
		worldGeneration: number,
	): void {
		if (player.placement.kind !== "world") return;
		const target = clientSceneInterestTarget(player.placement);
		const key = `${worldGeneration}:${sceneInterestTargetKey(target)}`;
		if (this.#portalSceneActivation?.key === key) return;
		const coordinator = this.#sceneInterestCoordinator;
		if (coordinator === null) return;
		if (this.#portalSceneActivation !== null) {
			// A later destination within the same authority generation supersedes any fade progress
			// earned by the provisional scene. Only the replacement may produce the reveal frame.
			this.#portalTransition.begin(worldGeneration, { kind: "absent" });
			this.#portalDestinationFrame = null;
		}
		if (this.#portalSceneActivation?.kind === "accepted") {
			resources.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = {
			kind: "requesting",
			generation: worldGeneration,
			key,
		};
		const request = coordinator.request(target, this.#sceneInterestRadii);
		void request.promise
			.then((resolved) => {
				if (
					this.#context.isDestroyed() ||
					!this.#context.isActiveResources(resources) ||
					!coordinator.isCurrent(request.revision)
				) {
					return null;
				}
				return resources.runtime.activateScene({
					generation: worldGeneration,
					target: resolved,
				});
			})
			.then((receipt) => {
				if (receipt === null) return;
				const current = this.#portalSceneActivation;
				if (
					this.#context.isDestroyed() ||
					!this.#context.isActiveResources(resources) ||
					!coordinator.isCurrent(request.revision) ||
					current?.kind !== "requesting" ||
					current.key !== key ||
					!this.#isCurrentPortalPresentation(worldGeneration)
				) {
					return;
				}
				this.#portalSceneActivation = {
					kind: "accepted",
					generation: worldGeneration,
					key,
					receipt,
					realization: "idle",
					realizedPlayerPlacementKey: null,
					revealAcknowledged: false,
				};
			})
			.catch((error: unknown) => {
				if (
					!this.#context.isDestroyed() &&
					coordinator.isCurrent(request.revision)
				) {
					this.#context.onError(error);
				}
			});
	}

	syncSceneInterest(
		resources: ClientGameplayPresentationResources,
		player: DynamicEntityView,
	): void {
		if (player.placement.kind !== "world") {
			this.clearSceneDemand(resources);
			return;
		}
		const target = clientSceneInterestTarget(player.placement);
		const key = `${this.#sceneInterestRevision}:${sceneInterestTargetKey(target)}`;
		if (key === this.#sceneTargetKey) return;
		const coordinator = this.#sceneInterestCoordinator;
		if (coordinator === null) return;
		this.#sceneTargetKey = key;
		const request = coordinator.request(target, this.#sceneInterestRadii);
		void request.promise
			.then((resolved) => {
				if (
					this.#context.isDestroyed() ||
					!this.#context.isActiveResources(resources) ||
					!coordinator.isCurrent(request.revision) ||
					this.#sceneTargetKey !== key
				) {
					return;
				}
				resources.runtime.updateSceneInterest(resolved);
			})
			.catch((error: unknown) => {
				if (
					!this.#context.isDestroyed() &&
					coordinator.isCurrent(request.revision)
				) {
					this.#context.onError(error);
				}
			});
	}

	clearSceneDemand(
		resources: ClientGameplayPresentationResources | null,
	): void {
		if (this.#sceneTargetKey === null && this.#portalSceneActivation === null) {
			return;
		}
		this.#sceneTargetKey = null;
		if (
			resources !== null &&
			this.#portalSceneActivation?.kind === "accepted"
		) {
			resources.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = null;
		this.#portalDestinationFrame = null;
		this.#sceneInterestCoordinator?.invalidate();
		if (resources !== null) resources.runtime.clearSceneInterest();
	}

	/** Force the exact local-player installation barrier to observe its latest desired level. */
	invalidatePlayerPresentationConvergence(): void {
		const activation = this.#portalSceneActivation;
		if (activation?.kind !== "accepted") return;
		this.#portalSceneActivation = {
			...activation,
			realization: "idle",
			realizedPlayerPlacementKey: null,
		};
	}

	prepareDynamicTickRetry(): boolean {
		const activation = this.#portalSceneActivation;
		const retryDeferred =
			activation?.kind === "accepted" &&
			activation.realization === "deferred" &&
			activation.realizedPlayerPlacementKey !==
				this.#authoritativePlayerConvergenceKey();
		if (retryDeferred) {
			this.#portalSceneActivation = {
				...activation,
				realization: "idle",
			};
		}
		return retryDeferred;
	}

	ensureScenePresentationConvergence(
		resources: ClientGameplayPresentationResources,
	): void {
		const activation = this.#portalSceneActivation;
		if (activation?.kind !== "accepted" || activation.realization !== "idle") {
			return;
		}
		this.#portalSceneActivation = {
			...activation,
			realization: "pending",
			realizedPlayerPlacementKey: this.#authoritativePlayerConvergenceKey(),
		};
		this.#context.observeWork(
			this.#requestDynamicEligibilityReevaluation(resources),
		);
	}

	checkPortalDestinationActivation(
		resources: ClientGameplayPresentationResources,
		playerGuid: number,
	): PortalActivationReadiness {
		const sceneActivation = this.#portalSceneActivation;
		if (sceneActivation?.kind !== "accepted") {
			return { kind: "waiting", status: "loading-activation" };
		}
		const activation = resources.runtime.sceneActivationStatus(
			sceneActivation.receipt,
		);
		if (activation.kind === "failed") {
			return { kind: "failed", diagnostic: activation.diagnostic };
		}
		if (activation.kind !== "ready") {
			return { kind: "waiting", status: "loading-activation" };
		}
		this.ensureScenePresentationConvergence(resources);
		const convergedActivation = this.#portalSceneActivation;
		if (convergedActivation?.kind !== "accepted") {
			return { kind: "waiting", status: "loading-activation" };
		}
		const playerFailure =
			resources.runtime.dynamicEntityBodyFailure(playerGuid);
		if (playerFailure !== null) {
			return { kind: "failed", diagnostic: formatError(playerFailure) };
		}
		if (convergedActivation.realization !== "ready") {
			return { kind: "waiting", status: "loading-player" };
		}
		const origin = resources.runtime.dynamicEntityOrigin(playerGuid);
		if (origin === null) {
			return {
				kind: "waiting",
				status: "loading-player",
				diagnostic:
					"The authoritative local player has no installed runtime presentation.",
			};
		}
		if (
			origin.envCellId !== null &&
			!resources.runtime.hasEnvCellScope(origin)
		) {
			return { kind: "waiting", status: "loading-activation" };
		}
		return { kind: "ready", origin };
	}

	/** Advance the presentation state before a portal frame; waiting has no timeout. */
	publishPortalTransition(
		resources: ClientGameplayPresentationResources,
		nowMs: number,
		destinationReady: boolean,
	): PortalTransitionPresentationPlan {
		const update = this.#portalTransition.advance({ nowMs, destinationReady });
		if (update.audio !== undefined) {
			resources.runtime.playPortalTransitionSound?.(update.audio);
		}
		resources.runtime.setPortalTransition(update.plan);
		return update.plan;
	}

	acknowledgePresented(
		receipt: PortalTransitionPresentationReceipt | null,
	): PortalRevealReceipt | null {
		return receipt === null
			? null
			: this.#portalTransition.acknowledgePresented(receipt);
	}

	claimPortalRevealAcknowledgement(
		transitionReceipt: PortalTransitionPresentationReceipt | null,
	): number | null {
		const sceneActivation = this.#portalSceneActivation;
		if (sceneActivation?.kind !== "accepted") return null;
		const reveal = this.acknowledgePresented(transitionReceipt);
		if (reveal === null || sceneActivation.revealAcknowledged) return null;
		this.#portalSceneActivation = {
			...sceneActivation,
			revealAcknowledged: true,
		};
		return sceneActivation.generation;
	}

	failPortalPresentation(resources: ClientGameplayPresentationResources): void {
		if (this.#portalSceneActivation?.kind === "accepted") {
			resources.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = null;
		this.#portalDestinationFrame = null;
		this.#portalTransition.reset();
		resources.runtime.setPortalTransition(undefined);
	}

	resetOnDiscontinuity(
		resources: ClientGameplayPresentationResources | null,
	): void {
		this.#sceneTargetKey = null;
		this.#portalSceneActivation = null;
		this.#portalDestinationFrame = null;
		this.#portalTransition.reset();
		this.#sceneInterestCoordinator?.invalidate();
		resources?.runtime.clearSceneInterest();
	}

	async #requestDynamicEligibilityReevaluation(
		resources: ClientGameplayPresentationResources,
	): Promise<void> {
		if (
			!this.#context.isActiveResources(resources) ||
			this.#context.isAwaitingSnapshot()
		) {
			return;
		}
		const portalActivation = this.#portalSceneActivation;
		if (
			portalActivation?.kind !== "accepted" ||
			portalActivation.realization !== "pending" ||
			!this.#isCurrentPortalPresentation(portalActivation.generation)
		) {
			return;
		}
		const results =
			await resources.runtime.reevaluateDynamicEntityEligibility();
		if (!this.#isCurrentPortalPresentation(portalActivation.generation)) return;
		const current = this.#portalSceneActivation;
		if (
			current?.kind !== "accepted" ||
			current.receipt !== portalActivation.receipt
		) {
			return;
		}
		const realization = this.#localPlayerHasUsableBody(results)
			? "ready"
			: "deferred";
		this.#portalSceneActivation = {
			...current,
			realization,
		};
		if (
			realization === "deferred" &&
			current.realizedPlayerPlacementKey !==
				this.#authoritativePlayerConvergenceKey()
		) {
			this.#portalSceneActivation = {
				...this.#portalSceneActivation,
				realization: "idle",
			};
			this.ensureScenePresentationConvergence(resources);
		}
	}

	/** Whether one controller generation still owns the session's current presentation barrier. */
	#isCurrentPortalPresentation(generation: number): boolean {
		return (
			this.#portalTransition.activeGeneration() === generation &&
			this.#context.worldGeneration() === generation
		);
	}

	#localPlayerHasUsableBody(results: DynamicEntityRealizationResults): boolean {
		const playerGuid = this.#context.playerGuid();
		if (playerGuid === null) return false;
		return hasUsableDynamicBody(results.get(playerGuid));
	}

	#authoritativePlayerConvergenceKey(): string | null {
		const playerGuid = this.#context.playerGuid();
		return playerGuid === null
			? null
			: playerPresentationConvergenceKey(
					this.#context.authoritativePlayer(playerGuid),
				);
	}
}

function clientSceneInterestTarget(
	placement: DynamicEntityWorldPlacement,
): SceneInterestTarget {
	const cellId = placement.pose.landblockId >>> 0;
	const landblockId = normalizeLandblockOwner(
		datAssetId((cellId & 0xffff_0000) | 0xffff),
	);
	const envCellId = cellId & 0xffff;
	return envCellId >= 0x0100
		? {
				kind: "env-cell",
				landblockId,
				envCellId: datAssetId(cellId) as `0x${string}`,
			}
		: { kind: "automatic-landblock", landblockId };
}

function sceneInterestTargetKey(target: SceneInterestTarget): string {
	return target.kind === "env-cell"
		? `${target.kind}:${target.landblockId}:${target.envCellId}`
		: `${target.kind}:${target.landblockId}`;
}

/** Stable retry identity for player facts that can change dynamic scope eligibility. */
function playerPresentationConvergenceKey(
	player: DynamicEntityView | null,
): string | null {
	if (player?.placement.kind !== "world") return null;
	const membership = player.placement.spatialMembership;
	return [
		player.generation,
		player.placement.pose.landblockId,
		membership.reachesOutdoors ? "outdoor" : "interior",
		...membership.reachedEnvCellIds,
	].join(":");
}
