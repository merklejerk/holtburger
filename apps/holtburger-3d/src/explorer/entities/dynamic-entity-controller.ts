import {
	CharacterInputController,
	type CharacterDrive,
	type CharacterInputEdge,
} from "../../lib/game/controls/character-input-controller";
import { createEntityFacingCameraYaw } from "../../lib/game/math/camera-orientation";
import type { HostCameraPlacement } from "../../lib/game/motion/host-placed-path";
import type {
	DynamicEntityEvent,
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
	createExplorerSpawnRequest,
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
}

/**
 * Owns Explorer dynamic-entity mirror subscription, presentation convergence,
 * spawning/despawning, and character possession outside Svelte reactive state.
 */
export class ExplorerDynamicEntityController {
	dynamicEntitySession: ExplorerDynamicEntitySession | undefined;
	possessionInput: CharacterInputController | undefined;
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

	constructor(
		private readonly deps: ExplorerDynamicEntityControllerDependencies,
	) {}

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
		this.possessionInput?.releaseOwnership();
		this.possessionInput = undefined;
		this.possessionIntentRevision = 0;
		this.possessedPlacement = null;
		this.setExplorerPossession(null);
		this.setPossessedControls(null);
		this.spawnedEntities = [];
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
		const owner = this.possessionInput;
		if (owner === undefined) return;
		if (input.kind === "reset") {
			owner.reset();
			return;
		}
		owner.applyAction(input.action, input.pressed);
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

	async spawnExplorerEntity(wcid: number, distance: number): Promise<void> {
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
		await session.spawn(request);
		await this.dynamicEntityPresentationCompletion;
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
		this.possessionInput?.releaseOwnership();
		this.possessionInput = undefined;
		this.setExplorerPossession(null);
		this.setPossessedControls(null);
		this.possessionIntentRevision = 0;
		void this.deps.onEndPossessionCamera().catch((error: unknown) => {
			this.deps.onPhysicalCameraError(errorMessage(error));
		});
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
		const possession = await session.possess(guid);
		if (possession.guid === null) {
			// Installing the next scheme first asks the outgoing character owner for its one reset.
			this.deps.onRestoreNonPossessionControlScheme();
			this.setExplorerPossession(null);
			this.setPossessedControls(null);
			this.possessionInput = undefined;
			this.possessionIntentRevision = 0;
			await this.deps.onEndPossessionCamera();
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
		this.possessionInput = new CharacterInputController({
			fullChargeDurationMs: capability.chargeDurationMs,
			now: () => performance.now(),
			onDrive: (drive) => this.setPossessionTranslationIntent(drive),
			onEdge: (edge) => this.queuePossessedEdge(edge),
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
