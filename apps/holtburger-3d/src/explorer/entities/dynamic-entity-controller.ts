import {
	CharacterInputController,
	type CharacterDrive,
	type CharacterInputEdge,
} from "../../lib/game/controls/character-input-controller";
import {
	CharacterMovementArbiter,
	type CharacterForwardSource,
} from "../../lib/game/controls/character-movement-arbiter";
import { FacingInputDispatch } from "../../lib/game/controls/facing-input-dispatch";
import { createEntityFacingCameraYaw } from "../../lib/game/math/camera-orientation";
import type { HostCameraPlacement } from "../../lib/game/motion/host-placed-path";
import type {
	DynamicEntityEvent,
	DynamicEntityPhysicsFlags,
	DynamicEntityView,
} from "../../lib/game/runtime/dynamic-entity-feed";
import type { GamePresentationRuntime } from "../../lib/game/runtime/game-presentation-runtime";
import type { ScenePlacement } from "../../lib/game/scene";
import type { HostTransport } from "../../lib/host/host-transport";
import type { WeenieCatalogCapability } from "../../lib/host/weenie-catalog-capability";
import type { CharacterActionInput } from "../camera/camera-input-controller";
import {
	ExplorerDynamicEntitySession,
	hostExplorerDynamicEntityTransport,
	type ExplorerFixedTickReceipt,
} from "./dynamic-entity-session";
import {
	createExplorerLaunchRequest,
	createExplorerRelocationRequest,
	createExplorerSpawnRequest,
	createExplorerTransformRequest,
	EMPTY_EXPLORER_SELECTION_STATUS,
	EXPLORER_SPAWN_DISTANCE,
	type ExplorerEntityTransformRequest,
	type ExplorerSelectionStatus,
	type ExplorerWeenieSearchRequest,
	type ExplorerWeenieSearchResult,
} from "./entity-commands";
import {
	findSelectedExplorerEntity,
	refreshesExplorerEntityPanel,
	type ExplorerEntitySelection,
} from "./entity-panel-state";
import {
	MOTION_STYLE,
	possessionStance,
	type ExplorerPossession,
	type ExplorerPossessionControls,
	type MotionStyleName,
	type PossessionEventOutcome,
	type PossessionMotionProbe,
} from "./entity-possession";

/** Drive with no axis held, used when a stance changes while no key is down. */
const IDLE_DRIVE: CharacterDrive = {
	gait: "run",
	lateral: null,
	longitudinal: null,
	turn: null,
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface ExplorerDynamicEntityControllerDependencies {
	readonly hostTransport: HostTransport;
	readonly isActivationReady: () => boolean;
	readonly hasPresentedCameraPlacement: () => boolean;
	readonly resolveSpawnAuthority: () => Promise<{
		readonly placement: HostCameraPlacement;
		readonly viewDirection: [number, number, number];
	}>;
	readonly onBeginPossessionCamera: (
		possession: ExplorerPossession,
	) => Promise<void>;
	readonly onEndPossessionCamera: () => Promise<void>;
	readonly onSetPossessedControlScheme: () => void;
	readonly onRestoreNonPossessionControlScheme: () => void;
	readonly onBoomFrame: (
		boom: NonNullable<ExplorerFixedTickReceipt["envelope"]["boom"]>,
		durationMs: number,
		receivedAtMs: number,
	) => void;
	readonly onBoomTranslationIntent: (active: boolean, nowMs: number) => void;
	readonly onPhysicalCameraError: (error: string | null) => void;
	readonly onEntityCatalogChange: (
		catalog: WeenieCatalogCapability | null,
	) => void;
	readonly onSpawnedEntitiesChange: (
		entities: readonly DynamicEntityView[],
	) => void;
	readonly onSpawnedEntityPresentationErrorChange: (
		error: string | null,
	) => void;
	readonly onExplorerPossessionChange: (
		possession: ExplorerPossession | null,
	) => void;
	readonly onPossessedControlsChange: (
		controls: ExplorerPossessionControls | null,
	) => void;
	readonly readSelectedEntity: () => ExplorerEntitySelection | null;
	readonly onClearSelectedEntity: () => void;
	readonly onSelectionStatusChange?: (status: ExplorerSelectionStatus) => void;
	readonly onJumpChargeActiveChange?: (active: boolean) => void;
	readonly onAutoRunChange?: (enabled: boolean) => void;
}

/**
 * Owns Explorer dynamic-entity mirror subscription, presentation convergence,
 * spawning/despawning, and character possession outside Svelte reactive state.
 */
export class ExplorerDynamicEntityController {
	dynamicEntitySession: ExplorerDynamicEntitySession | undefined;
	possessionInput: CharacterInputController | undefined;
	private possessionArbiter: CharacterMovementArbiter | undefined;
	private readonly facingDispatch: FacingInputDispatch;
	possessionIntentRevision = 0;
	dynamicEntityPresentationCompletion: Promise<void> = Promise.resolve();
	sceneActivationPresentationConvergence: {
		readonly completion: Promise<void>;
		ready: boolean;
	} | null = null;
	possessedPlacement: ScenePlacement | null = null;

	private gameRuntime: GamePresentationRuntime | undefined;
	private unsubscribeDynamicEntities: (() => void) | undefined;
	private unsubscribeFixedTicks: (() => void) | undefined;
	private unsubscribePossessionOutcomes: (() => void) | undefined;
	private dynamicEntityPresentationRevision = 0;
	private spawnedEntities: readonly DynamicEntityView[] = [];
	private explorerPossession: ExplorerPossession | null = null;
	private possessedControls: ExplorerPossessionControls | null = null;
	private selectionSyncSerial = 0;
	private pendingTransform: ExplorerEntityTransformRequest | null = null;
	private transformInFlight: Promise<void> | null = null;
	private transformEpoch = 0;

	constructor(
		private readonly deps: ExplorerDynamicEntityControllerDependencies,
	) {
		this.facingDispatch = new FacingInputDispatch(
			async (deltaRadians, current) => {
				const session = this.dynamicEntitySession;
				const held = this.explorerPossession;
				if (!session || held === null || held.guid === null || !current()) {
					return;
				}
				try {
					await session.applyPossessionYaw(
						held.possessionGeneration,
						deltaRadians,
					);
				} catch (error) {
					if (current()) {
						this.deps.onSpawnedEntityPresentationErrorChange(
							errorMessage(error),
						);
					}
				}
			},
		);
	}

	async start(): Promise<void> {
		const entitySession = new ExplorerDynamicEntitySession(
			hostExplorerDynamicEntityTransport(this.deps.hostTransport),
		);
		this.dynamicEntitySession = entitySession;
		this.unsubscribeDynamicEntities = entitySession.subscribe((event) =>
			this.acceptDynamicEntityEvent(event),
		);
		this.unsubscribeFixedTicks = entitySession.subscribeFixedTicks((receipt) =>
			this.acceptFixedTick(receipt),
		);
		this.unsubscribePossessionOutcomes =
			entitySession.subscribePossessionOutcomes((outcome) =>
				this.acceptPossessionEventOutcome(outcome),
			);
		await entitySession.start();
		const catalog = await entitySession.catalogCapability();
		this.deps.onEntityCatalogChange(catalog);
	}

	attachRuntime(runtime: GamePresentationRuntime): void {
		this.gameRuntime = runtime;
		void this.replaceSpawnedEntitySnapshot();
	}

	detach(): void {
		const entityUnsubscribe = this.unsubscribeDynamicEntities;
		const fixedTickUnsubscribe = this.unsubscribeFixedTicks;
		const possessionOutcomeUnsubscribe = this.unsubscribePossessionOutcomes;
		const entitySession = this.dynamicEntitySession;

		this.gameRuntime = undefined;
		this.dynamicEntitySession = undefined;
		this.unsubscribeDynamicEntities = undefined;
		this.unsubscribeFixedTicks = undefined;
		this.unsubscribePossessionOutcomes = undefined;
		this.dynamicEntityPresentationRevision += 1;
		this.dynamicEntityPresentationCompletion = Promise.resolve();
		this.sceneActivationPresentationConvergence = null;
		this.facingDispatch.cancel();
		this.possessionArbiter?.reset();
		this.possessionArbiter = undefined;
		this.possessionInput?.releaseOwnership();
		this.possessionInput = undefined;
		this.deps.onJumpChargeActiveChange?.(false);
		this.possessionIntentRevision = 0;
		this.possessedPlacement = null;
		this.setExplorerPossession(null);
		this.setPossessedControls(null);
		this.spawnedEntities = [];
		this.transformEpoch += 1;
		this.pendingTransform = null;
		this.transformInFlight = null;
		this.selectionSyncSerial += 1;
		this.deps.onSelectionStatusChange?.(EMPTY_EXPLORER_SELECTION_STATUS);
		this.deps.onEntityCatalogChange(null);
		this.deps.onSpawnedEntitiesChange([]);
		this.deps.onClearSelectedEntity();
		this.deps.onSpawnedEntityPresentationErrorChange(null);

		entityUnsubscribe?.();
		fixedTickUnsubscribe?.();
		possessionOutcomeUnsubscribe?.();
		entitySession?.stop();
	}

	private setExplorerPossession(possession: ExplorerPossession | null): void {
		this.explorerPossession = possession;
		this.deps.onExplorerPossessionChange(possession);
	}

	private setPossessedControls(
		controls: ExplorerPossessionControls | null,
	): void {
		this.possessedControls = controls;
		this.deps.onPossessedControlsChange(controls);
	}

	hasPossession(): boolean {
		return (
			this.explorerPossession !== null || this.possessionInput !== undefined
		);
	}

	hasPossessionInput(): boolean {
		return this.possessionInput !== undefined;
	}

	readPossessedGuid(): number | null {
		return this.explorerPossession?.guid ?? null;
	}

	readPossessionOwnership() {
		return {
			input: this.possessionInput,
			possessionGeneration:
				this.explorerPossession?.possessionGeneration ?? null,
		};
	}

	handleCameraCharacterInput(input: CharacterActionInput): void {
		const arbiter = this.possessionArbiter;
		if (arbiter === undefined) return;
		if (input.kind === "reset") {
			this.facingDispatch.cancel();
			arbiter.releaseHeldActions();
			this.deps.onJumpChargeActiveChange?.(
				this.possessionInput?.chargeExtent() !== null,
			);
			return;
		}
		arbiter.applyAction(input.action, input.pressed);
	}

	applyPossessionForward(
		source: Exclude<CharacterForwardSource, "keyboard">,
		down: boolean,
	): void {
		this.possessionArbiter?.applyForward(source, down);
	}

	togglePossessionAutoRun(): void {
		this.possessionArbiter?.toggleAutoRun();
	}

	applyPossessionTurn(deltaRadians: number): void {
		if (this.explorerPossession?.guid == null) return;
		this.facingDispatch.add(deltaRadians);
	}

	cancelPossessionTurn(): void {
		this.facingDispatch.cancel();
	}

	readJumpChargeExtent(): number | null {
		return this.possessionInput?.chargeExtent() ?? null;
	}

	syncPossessedPlacement(runtime: GamePresentationRuntime): void {
		const possessedGuid = this.explorerPossession?.guid ?? null;
		this.possessedPlacement =
			possessedGuid === null
				? null
				: (runtime.spawnedEntityPlacement(possessedGuid) ?? null);
		// The possessed character is what the viewer is driving, so it carries the
		// viewer light; with nothing possessed the camera carries it, as retail does.
		runtime.setViewerEntity(possessedGuid);
	}

	syncSceneActivationConvergence(
		activationPending: boolean,
		staticActivationReady: boolean,
	): void {
		if (!activationPending || !staticActivationReady) {
			this.sceneActivationPresentationConvergence = null;
		} else if (this.sceneActivationPresentationConvergence === null) {
			void this.replaceSpawnedEntitySnapshot();
		}
	}

	isActivationPresentationReady(): boolean {
		return this.sceneActivationPresentationConvergence?.ready ?? false;
	}

	clearActivationConvergence(): void {
		this.sceneActivationPresentationConvergence = null;
	}

	/** Publish a cold panel snapshot and retire possession if its exact generation disappeared. */
	private publishExplorerEntityPanelSnapshot(): readonly DynamicEntityView[] {
		const session = this.dynamicEntitySession;
		if (session === undefined) return [];
		const entities = session.mirror.entities();
		this.spawnedEntities = entities;
		this.deps.onSpawnedEntitiesChange(entities);
		const selected = this.deps.readSelectedEntity();
		if (
			selected !== null &&
			findSelectedExplorerEntity(entities, selected) === null
		) {
			this.deps.onClearSelectedEntity();
		}
		const held = this.explorerPossession;
		if (
			held !== null &&
			held.guid !== null &&
			!entities.some(
				(entity) =>
					entity.identity.guid === held.guid &&
					entity.generation === held.entityGeneration,
			)
		) {
			this.retireFrontendPossession();
		}
		return entities;
	}

	/** Project lifecycle state from the one authoritative mirror into Svelte and presentation. */
	replaceSpawnedEntitySnapshot(): Promise<void> {
		const session = this.dynamicEntitySession;
		if (session === undefined) return Promise.resolve();
		const entities = this.publishExplorerEntityPanelSnapshot();
		const runtime = this.gameRuntime;
		if (runtime === undefined) return Promise.resolve();
		return this.trackDynamicEntityPresentation(
			runtime.replaceDynamicEntitySnapshot(entities),
			entities,
		);
	}

	/** Retain one presentation completion as the current Explorer convergence boundary. */
	private trackDynamicEntityPresentation(
		operation: Promise<unknown>,
		entities: readonly DynamicEntityView[],
	): Promise<void> {
		const revision = ++this.dynamicEntityPresentationRevision;
		this.deps.onSpawnedEntityPresentationErrorChange(null);
		const completion = operation.then(() => undefined);
		this.dynamicEntityPresentationCompletion = completion;
		if (this.deps.isActivationReady()) {
			const convergence = { completion, ready: false };
			this.sceneActivationPresentationConvergence = convergence;
			void completion.then(() => {
				if (this.sceneActivationPresentationConvergence === convergence) {
					convergence.ready = true;
				}
			});
		}
		void completion.catch((error: unknown) => {
			if (revision !== this.dynamicEntityPresentationRevision) return;
			const wcids = entities.map(({ identity }) => identity.wcid).join(", ");
			const message = `Presentation realization for WCID ${wcids || "<none>"}: ${errorMessage(error)}`;
			this.deps.onSpawnedEntityPresentationErrorChange(message);
			console.error(message, error);
		});
		return completion;
	}

	/** Route high-frequency accepted paths without restarting visual resource realization. */
	acceptDynamicEntityEvent(event: DynamicEntityEvent): void {
		if (this.dynamicEntitySession === undefined) return;
		if (refreshesExplorerEntityPanel(event)) {
			this.publishExplorerEntityPanelSnapshot();
		}
		const runtime = this.gameRuntime;
		if (runtime === undefined) return;
		try {
			switch (event.kind) {
				case "ticked":
					runtime.applyDynamicEntityTick(event.batch, performance.now());
					this.deps.onSpawnedEntityPresentationErrorChange(null);
					return;
				case "snapshot":
					void this.trackDynamicEntityPresentation(
						runtime.replaceDynamicEntitySnapshot(this.spawnedEntities),
						this.spawnedEntities,
					);
					return;
				case "upserted":
					void this.trackDynamicEntityPresentation(
						runtime.upsertDynamicEntity(event.entity),
						[event.entity],
					);
					return;
				case "removed":
					runtime.removeDynamicEntity(event.guid, event.generation);
					this.deps.onSpawnedEntityPresentationErrorChange(null);
					return;
			}
		} catch (error) {
			this.deps.onSpawnedEntityPresentationErrorChange(
				`Dynamic-entity presentation: ${errorMessage(error)}`,
			);
		}
	}

	/** Apply one host epoch to entity and camera playback from the exact same receipt instant. */
	acceptFixedTick({ envelope, receivedAtMs }: ExplorerFixedTickReceipt): void {
		const entityEvent = envelope.entityEvent;
		if (entityEvent !== null) {
			if (refreshesExplorerEntityPanel(entityEvent)) {
				this.publishExplorerEntityPanelSnapshot();
			}
			try {
				this.gameRuntime?.applyDynamicEntityTick(
					entityEvent.batch,
					receivedAtMs,
				);
				this.deps.onSpawnedEntityPresentationErrorChange(null);
			} catch (error) {
				this.deps.onSpawnedEntityPresentationErrorChange(
					`Dynamic-entity path presentation: ${errorMessage(error)}`,
				);
			}
		}
		if (envelope.boom !== null) {
			this.deps.onBoomFrame(envelope.boom, envelope.durationMs, receivedAtMs);
		}
	}

	async spawnExplorerEntity(
		wcid: number,
		distance: number,
	): Promise<ExplorerEntitySelection> {
		const session = this.dynamicEntitySession;
		if (!session) {
			throw new Error("Explorer entity spawning requires an active runtime.");
		}
		const authority = await this.deps.resolveSpawnAuthority();
		const request = createExplorerSpawnRequest(
			wcid,
			authority.placement,
			authority.viewDirection,
			distance,
			"integrated",
		);
		const receipt = await session.spawn(request);
		await this.dynamicEntityPresentationCompletion;
		return { guid: receipt.guid, generation: receipt.generation };
	}

	/** Synchronize the selected Explorer entity with host physics-suspension policy. */
	async setSelectedExplorerEntity(
		selection: ExplorerEntitySelection | null,
	): Promise<void> {
		this.pendingTransform = null;
		const session = this.dynamicEntitySession;
		if (!session) {
			this.selectionSyncSerial += 1;
			this.deps.onSelectionStatusChange?.(EMPTY_EXPLORER_SELECTION_STATUS);
			return;
		}
		const serial = ++this.selectionSyncSerial;
		// Drain any in-flight drag transform before switching or clearing selection so a late
		// transform cannot arrive after deselect resumes physics or executes a queued launch.
		await this.transformInFlight;
		if (
			serial !== this.selectionSyncSerial ||
			this.dynamicEntitySession !== session
		) {
			return;
		}
		try {
			const status = await session.setSelectedEntity(selection);
			if (serial === this.selectionSyncSerial) {
				this.deps.onSelectionStatusChange?.(status);
			}
		} catch (error) {
			if (serial === this.selectionSyncSerial) {
				this.deps.onSelectionStatusChange?.(EMPTY_EXPLORER_SELECTION_STATUS);
				this.deps.onSpawnedEntityPresentationErrorChange(errorMessage(error));
			}
		}
	}

	/** Coalesce high-frequency gizmo pose updates into single-flight host IPC calls. */
	scheduleEntityTransform(
		guid: number,
		generation: number,
		pose: ExplorerEntityTransformRequest["pose"],
	): void {
		if (!this.dynamicEntitySession) return;
		this.pendingTransform = createExplorerTransformRequest(
			guid,
			generation,
			pose,
		);
		this.kickPendingTransformDrain();
	}

	/** Discard queued (unsent) gizmo transforms without wedging an in-flight IPC drain. */
	cancelPendingTransform(): void {
		this.pendingTransform = null;
	}

	private kickPendingTransformDrain(): void {
		if (
			this.transformInFlight !== null ||
			this.pendingTransform === null ||
			this.dynamicEntitySession === undefined
		) {
			return;
		}
		const epoch = this.transformEpoch;
		const flight = this.drainPendingTransforms(epoch).finally(() => {
			if (this.transformInFlight === flight) {
				this.transformInFlight = null;
			}
			if (
				this.transformEpoch === epoch &&
				this.pendingTransform !== null &&
				this.dynamicEntitySession !== undefined
			) {
				this.kickPendingTransformDrain();
			}
		});
		this.transformInFlight = flight;
	}

	private async drainPendingTransforms(epoch: number): Promise<void> {
		while (
			this.transformEpoch === epoch &&
			this.pendingTransform !== null &&
			this.dynamicEntitySession !== undefined
		) {
			const next = this.pendingTransform;
			this.pendingTransform = null;
			try {
				await this.dynamicEntitySession.setTransform(next);
			} catch (error) {
				if (this.transformEpoch === epoch) {
					this.pendingTransform = null;
					this.deps.onSpawnedEntityPresentationErrorChange(errorMessage(error));
				}
				return;
			}
		}
	}

	private async refreshSelectionStatus(): Promise<void> {
		const session = this.dynamicEntitySession;
		if (!session) return;
		const selected = this.deps.readSelectedEntity();
		const serial = ++this.selectionSyncSerial;
		try {
			const status = await session.setSelectedEntity(selected);
			if (serial === this.selectionSyncSerial) {
				this.deps.onSelectionStatusChange?.(status);
			}
		} catch {
			// A concurrent selection change or despawn supersedes this status read.
		}
	}

	async searchExplorerWeenies(
		request: ExplorerWeenieSearchRequest,
	): Promise<readonly ExplorerWeenieSearchResult[]> {
		const session = this.dynamicEntitySession;
		if (!session) {
			throw new Error("Explorer weenie search requires an active runtime.");
		}
		return session.searchWeenies(request);
	}

	async despawnExplorerEntity(entity: DynamicEntityView): Promise<void> {
		const session = this.dynamicEntitySession;
		if (!session) {
			throw new Error("Explorer entity despawn requires an active runtime.");
		}
		this.pendingTransform = null;
		await this.transformInFlight;
		await session.despawn(entity.identity.guid, entity.generation);
		await this.dynamicEntityPresentationCompletion;
	}

	private sendPossessedIntent(): void {
		const session = this.dynamicEntitySession;
		const input = this.possessionInput;
		const held = this.explorerPossession;
		if (
			!session ||
			input === undefined ||
			held === null ||
			held.guid === null
		) {
			return;
		}
		const controls = this.possessedControls;
		if (controls === null) return;
		this.possessionIntentRevision += 1;
		void session
			.setPossessionIntent({
				drive: input.drive(),
				possessionGeneration: held.possessionGeneration,
				revision: this.possessionIntentRevision,
				runRateScalar: controls.runRateScalar,
				stance: controls.stance,
			})
			.catch((error: unknown) => {
				this.deps.onSpawnedEntityPresentationErrorChange(errorMessage(error));
			});
	}

	private setPossessionTranslationIntent(drive: CharacterDrive): void {
		this.facingDispatch.flush();
		this.deps.onBoomTranslationIntent(
			drive.longitudinal !== null || drive.lateral !== null,
			performance.now(),
		);
		this.sendPossessedIntent();
	}

	possessedEntityFacingCameraYaw(): number {
		const held = this.explorerPossession;
		const session = this.dynamicEntitySession;
		if (
			held === null ||
			held.guid === null ||
			held.entityGeneration === null ||
			session === undefined
		) {
			throw new Error("Possession camera requires an active possessed entity.");
		}
		const entity = session.mirror.entity(held.guid, held.entityGeneration);
		if (entity === null || entity.placement.kind !== "world") {
			throw new Error(
				"Possession camera requires the possessed entity's current world pose.",
			);
		}
		return createEntityFacingCameraYaw(entity.placement.pose.rotation);
	}

	private acceptPossessionEventOutcome(outcome: PossessionEventOutcome): void {
		const held = this.explorerPossession;
		if (
			held === null ||
			outcome.possessionGeneration !== held.possessionGeneration
		) {
			return;
		}
		if (outcome.result.kind !== "rejected") return;
		this.possessionInput?.rejectBegin(outcome.sequence);
		this.deps.onJumpChargeActiveChange?.(
			this.possessionInput?.chargeExtent() !== null,
		);
		this.deps.onSpawnedEntityPresentationErrorChange(
			`Possession ${outcome.sequence} rejected: ${outcome.result.reason}.`,
		);
	}

	queuePossessedEdge(edge: CharacterInputEdge): void {
		const session = this.dynamicEntitySession;
		const input = this.possessionInput;
		const held = this.explorerPossession;
		if (!session || input === undefined || held === null || held.guid === null)
			return;
		const controls = this.possessedControls;
		if (controls === null) return;
		this.facingDispatch.flush();
		if (edge.kind === "begin-jump") {
			this.deps.onJumpChargeActiveChange?.(true);
		} else {
			this.deps.onJumpChargeActiveChange?.(false);
		}
		this.possessionIntentRevision += 1;
		const drive = edge.kind === "reset" ? input.drive() : edge.drive;
		void session
			.queuePossessionEvent({
				...edge,
				drive,
				possessionGeneration: held.possessionGeneration,
				revision: this.possessionIntentRevision,
				runRateScalar: controls.runRateScalar,
				stance: controls.stance,
			})
			.then((receipt) => {
				for (const outcome of receipt.outcomes) {
					this.acceptPossessionEventOutcome(outcome);
				}
			})
			.catch((error: unknown) => {
				this.deps.onSpawnedEntityPresentationErrorChange(errorMessage(error));
				if (
					this.explorerPossession?.possessionGeneration !==
					held.possessionGeneration
				) {
					return;
				}
				// A missing sequence can strand every later edge. End both sides of this ownership
				// epoch; if the transport is unavailable, the generation check still protects the host.
				void session
					.possess(null)
					.catch((releaseError: unknown) => {
						this.deps.onSpawnedEntityPresentationErrorChange(
							`${errorMessage(error)} Release also failed: ${errorMessage(releaseError)}`,
						);
					})
					.finally(() => {
						if (
							this.explorerPossession?.possessionGeneration ===
							held.possessionGeneration
						) {
							this.retireFrontendPossession();
						}
					});
			});
	}

	retireFrontendPossession(): void {
		this.facingDispatch.cancel();
		this.possessionArbiter?.reset();
		this.possessionArbiter = undefined;
		this.possessionInput?.releaseOwnership();
		this.possessionInput = undefined;
		this.deps.onJumpChargeActiveChange?.(false);
		this.setExplorerPossession(null);
		this.setPossessedControls(null);
		this.possessionIntentRevision = 0;
		void this.deps.onEndPossessionCamera().catch((error: unknown) => {
			this.deps.onPhysicalCameraError(errorMessage(error));
		});
		void this.refreshSelectionStatus();
	}

	async possessExplorerEntity(
		guid: number | null,
	): Promise<ExplorerPossession> {
		const session = this.dynamicEntitySession;
		if (!session) {
			throw new Error("Explorer possession requires an active runtime.");
		}
		if (guid !== null && !this.deps.hasPresentedCameraPlacement()) {
			throw new Error(
				"Explorer possession requires a currently presented camera placement.",
			);
		}
		let possession: ExplorerPossession;
		try {
			possession = await session.possess(guid);
		} catch (error) {
			await this.refreshSelectionStatus();
			throw error;
		}
		if (possession.guid === null) {
			// Installing the next scheme first asks the outgoing character owner for its one reset.
			this.facingDispatch.cancel();
			this.possessionArbiter?.reset();
			this.possessionArbiter = undefined;
			this.deps.onRestoreNonPossessionControlScheme();
			this.setExplorerPossession(null);
			this.setPossessedControls(null);
			this.possessionInput = undefined;
			this.deps.onJumpChargeActiveChange?.(false);
			this.possessionIntentRevision = 0;
			await this.deps.onEndPossessionCamera();
			await this.refreshSelectionStatus();
			return possession;
		}
		this.setExplorerPossession(possession);
		const acceptedName = (Object.keys(MOTION_STYLE) as MotionStyleName[]).find(
			(candidate) => MOTION_STYLE[candidate] === possession.acceptedStance,
		);
		if (acceptedName === undefined) {
			throw new Error(
				`Host accepted unknown possession stance 0x${possession.acceptedStance.toString(16)}.`,
			);
		}
		if (possession.runRateCapability === null) {
			throw new Error("Host omitted the possession run-rate capability.");
		}
		this.setPossessedControls({
			stance: possession.acceptedStance,
			runRateScalar: possession.runRateCapability.initial,
		});
		this.possessionIntentRevision = 0;
		const capability = possessionStance(possession, possession.acceptedStance);
		if (capability === null) {
			throw new Error(
				"Host omitted the accepted possession stance capability.",
			);
		}
		// Transition before installing the new sink so held camera keys cannot leak into the new
		// character ownership epoch; keys held across the cutover require a fresh browser press.
		this.deps.onSetPossessedControlScheme();
		const possessionInput = new CharacterInputController({
			fullChargeDurationMs: capability.chargeDurationMs,
			now: () => performance.now(),
			onDrive: (drive) => this.setPossessionTranslationIntent(drive),
			onEdge: (edge) => this.queuePossessedEdge(edge),
		});
		this.possessionInput = possessionInput;
		this.possessionArbiter = new CharacterMovementArbiter({
			ordinary: possessionInput,
			onAutoRunChanged: (enabled) => this.deps.onAutoRunChange?.(enabled),
		});
		try {
			await this.deps.onBeginPossessionCamera(possession);
		} catch (error) {
			try {
				await session.possess(null);
			} finally {
				this.retireFrontendPossession();
			}
			throw error;
		}
		await this.refreshSelectionStatus();
		return possession;
	}

	async setExplorerEntityStance(style: number): Promise<void> {
		const session = this.dynamicEntitySession;
		const held = this.explorerPossession;
		const controls = this.possessedControls;
		if (!session || held === null || held.guid === null || controls === null)
			return;
		const name = (Object.keys(MOTION_STYLE) as MotionStyleName[]).find(
			(candidate) => MOTION_STYLE[candidate] === style,
		);
		if (name === undefined) {
			throw new Error(`Unknown possession stance 0x${style.toString(16)}.`);
		}
		this.possessionIntentRevision += 1;
		const revision = this.possessionIntentRevision;
		const nextControls = { ...controls, stance: style };
		this.setPossessedControls(nextControls);
		try {
			const result = await session.setPossessionIntent({
				drive: this.possessionInput?.drive() ?? IDLE_DRIVE,
				possessionGeneration: held.possessionGeneration,
				revision,
				runRateScalar: nextControls.runRateScalar,
				stance: nextControls.stance,
			});
			if (result === "accepted") {
				const capability = possessionStance(held, style);
				if (capability === null) {
					throw new Error(
						"Host accepted a stance absent from its capability receipt.",
					);
				}
				this.possessionInput?.setFullChargeDurationMs(
					capability.chargeDurationMs,
				);
			}
		} catch (error) {
			if (
				this.possessionIntentRevision === revision &&
				this.explorerPossession?.possessionGeneration ===
					held.possessionGeneration
			) {
				this.setPossessedControls(controls);
			}
			throw error;
		}
	}

	async setExplorerEntityRunRate(value: number): Promise<void> {
		const session = this.dynamicEntitySession;
		const held = this.explorerPossession;
		const controls = this.possessedControls;
		if (!session || held === null || held.guid === null || controls === null)
			return;
		const capability = held.runRateCapability;
		if (capability === null) {
			throw new Error("Host omitted the possession run-rate capability.");
		}
		if (
			!Number.isFinite(value) ||
			value < capability.minimum ||
			value > capability.maximum
		) {
			throw new Error("Run rate is outside the host-reported range.");
		}
		this.possessionIntentRevision += 1;
		const revision = this.possessionIntentRevision;
		const nextControls = { ...controls, runRateScalar: value };
		this.setPossessedControls(nextControls);
		try {
			await session.setPossessionIntent({
				drive: this.possessionInput?.drive() ?? IDLE_DRIVE,
				possessionGeneration: held.possessionGeneration,
				revision,
				runRateScalar: nextControls.runRateScalar,
				stance: nextControls.stance,
			});
		} catch (error) {
			if (
				this.possessionIntentRevision === revision &&
				this.explorerPossession?.possessionGeneration ===
					held.possessionGeneration
			) {
				this.setPossessedControls(controls);
			}
			throw error;
		}
	}

	/** Despawn all Explorer-local entities and clear possession/selection cleanly. */
	async resetAllEntities(): Promise<void> {
		const session = this.dynamicEntitySession;
		if (!session)
			throw new Error("Explorer entity reset requires an active runtime.");
		this.transformEpoch += 1;
		this.pendingTransform = null;
		await this.transformInFlight;
		this.transformInFlight = null;
		if (this.explorerPossession !== null) {
			await this.possessExplorerEntity(null);
		}
		await session.resetAll();
		this.selectionSyncSerial += 1;
		this.deps.onSelectionStatusChange?.(EMPTY_EXPLORER_SELECTION_STATUS);
		this.deps.onClearSelectedEntity();
	}

	/** Teleport an existing entity in front of the current camera pose. */
	async relocateExplorerEntity(
		entity: Pick<DynamicEntityView, "generation"> & {
			readonly identity: { readonly guid: number };
		},
		distance: number = EXPLORER_SPAWN_DISTANCE.default,
	): Promise<void> {
		const session = this.dynamicEntitySession;
		if (!session)
			throw new Error("Explorer relocation requires an active runtime.");
		this.pendingTransform = null;
		await this.transformInFlight;
		const { placement, viewDirection } =
			await this.deps.resolveSpawnAuthority();
		await session.relocate(
			createExplorerRelocationRequest(
				entity.identity.guid,
				entity.generation,
				placement,
				viewDirection,
				distance,
				"teleport",
			),
		);
	}

	/** Launch an existing entity along the current camera view direction. */
	async launchExplorerEntity(
		entity: Pick<DynamicEntityView, "generation"> & {
			readonly identity: { readonly guid: number };
		},
	): Promise<{ readonly queued: boolean }> {
		const session = this.dynamicEntitySession;
		if (!session)
			throw new Error("Explorer launch requires an active runtime.");
		const { viewDirection } = await this.deps.resolveSpawnAuthority();
		const receipt = await session.launch(
			createExplorerLaunchRequest(
				entity.identity.guid,
				entity.generation,
				viewDirection,
			),
		);
		const selected = this.deps.readSelectedEntity();
		if (
			receipt.queued &&
			selected !== null &&
			selected.guid === entity.identity.guid &&
			selected.generation === entity.generation
		) {
			// Advance selectionSyncSerial so an older in-flight selection status read cannot
			// clobber `launchQueued: true` back to false.
			this.selectionSyncSerial += 1;
			this.deps.onSelectionStatusChange?.({
				suspended: true,
				launchQueued: true,
			});
		}
		return { queued: receipt.queued };
	}

	/** Replace an entity's typed simulation physics flags and realization mode. */
	async replaceExplorerEntityPhysicsState(
		entity: Pick<DynamicEntityView, "generation"> & {
			readonly identity: { readonly guid: number };
		},
		flags: DynamicEntityPhysicsFlags,
		physicalMode: "pose-only" | "integrated",
	): Promise<void> {
		const session = this.dynamicEntitySession;
		if (!session)
			throw new Error(
				"Explorer physics state update requires an active runtime.",
			);
		await session.replacePhysicsState({
			guid: entity.identity.guid,
			generation: entity.generation,
			flags,
			physicalMode,
		});
		await this.refreshSelectionStatus();
	}

	/** Pull one exact current generation for disclosure-scoped volatile diagnostics. */
	readExplorerEntity(
		selection: ExplorerEntitySelection,
	): DynamicEntityView | null {
		const session = this.dynamicEntitySession;
		return session === undefined
			? null
			: findSelectedExplorerEntity(session.mirror.entities(), selection);
	}

	/** Pull the host-applied possession sample only when the Inspector is sampling diagnostics. */
	async readPossessionMotionProbe(): Promise<PossessionMotionProbe | null> {
		return (await this.dynamicEntitySession?.possessionMotionProbe()) ?? null;
	}
}
