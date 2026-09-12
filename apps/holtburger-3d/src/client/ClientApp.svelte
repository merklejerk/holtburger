<script lang="ts">
	import { ClientInventoryState } from "./client-inventory-state";
	import { browserItemIconRepository } from "../app/item-icon-repository";
	import { prepareItemIcons } from "../app/item-icon-source";
	import {
		clientSelectedEntity,
		type ClientSelectedEntity,
	} from "./client-selected-entity";
	import { z } from "zod";
	import {
		weenieCatalogCapabilitySchema,
		type WeenieCatalogCapability,
	} from "../lib/host/weenie-catalog-capability";
	import ClientMessageDialog from "./ClientMessageDialog.svelte";
	import ClientToastOverlay from "./ClientToastOverlay.svelte";
	import {
		ClientDialogs,
		type ClientDialogPresentation,
	} from "./client-dialogs";
	import { provideAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { APP_INPUT } from "../lib/input/app-input";
	import { onMount, untrack } from "svelte";
	import {
		createFrameRateSampler,
		type FrameRates,
		type FrameRateSampler,
	} from "../app/frame-rate-sampler";

	import {
		CharacterInputController,
		type CharacterDrive,
		type CharacterDriveIntent,
		type CharacterInputEdge,
	} from "../lib/game/controls/character-input-controller";
	import { CLIENT_TUNING } from "./client-tuning";
	import { createElectronHostTransport } from "../lib/host/electron-host-transport";
	import type { HostTransport } from "../lib/host/host-transport";
	import {
		ClientLifecycleSession,
		hostClientLifecycleTransport,
		type ClientLifecycleSessionEvent,
	} from "./client-lifecycle-session";
	import {
		ClientPresentationSession,
		type ClientPresentationCameraController,
		type ClientPresentationDiagnostics,
		type ClientPresentationStatus,
	} from "./client-presentation-session";
	import { clientDebugEnabled } from "./client-debug";
	import ClientCharacterSelect from "./ClientCharacterSelect.svelte";
	import {
		ClientEntityInteractions,
		type ClientSelectedEntityDisplay,
		EMPTY_CLIENT_SELECTED_DISPLAY,
	} from "./client-entity-interactions";
	import ClientWorldView from "./ClientWorldView.svelte";
	import type { MinimapFrame } from "../app/minimap-frame";
	import type {
		ClientCharacterMotionCapabilities,
		ClientCharacterMotionEventRequest,
		ClientCharacterMotionRejection,
		ClientChatMessage,
		ClientDriveRequest,
		ClientVital,
	} from "./client-host-contract";
	import type {
		ClientChatErrorMessage,
		ClientChatLine,
	} from "./client-chat-policy";
	import type { FrameSettings } from "../lib/game/renderer/renderer";
	import {
		clientLifecycleEnablesWorldInput,
		clientLifecycleUsesWorldPresentation,
		initialClientLifecycleUiState,
		reduceClientLifecycleUiState,
		type ClientLifecycleUiState,
	} from "./client-lifecycle-state";
	import { ClientInputArbiter } from "./client-input-arbiter";
	import { ClientPreciseJumpSession } from "./client-precise-jump-session";
	import { ClientEntitySelection } from "./client-entity-selection";
	import {
		CLIENT_TOAST_DURATION_MS,
		ClientToastCenter,
		type ClientToast,
	} from "./client-toast-center";
	import type { ClientTargetIndicatorFrame } from "./client-target-indicator";

	let entityCollisionDisabled = $state(false);
	let lifecycle = $state<ClientLifecycleUiState>(
		initialClientLifecycleUiState(),
	);
	const debugEnabled = clientDebugEnabled(window.location.search);
	let session = $state<ClientLifecycleSession | null>(null);
	let inventory = $state<ClientInventoryState | null>(null);
	let hostTransport = $state<HostTransport | null>(null);
	let startupError = $state<string | null>(null);
	let commandFailure = $state<string | null>(null);
	let playerName = $state<string | null>(null);
	let worldName = $state<string | null>(null);
	let vitals = $state<readonly ClientVital[]>([]);
	let characterMotion = $state<ClientCharacterMotionCapabilities | null>(null);
	let activeJumpBeginSequence = $state<number | null>(null);
	let toast = $state<ClientToast | null>(null);
	let dialogPresentation = $state<ClientDialogPresentation | null>(null);
	let dialogs: ClientDialogs | null = null;
	let chatMessages = $state<readonly ClientChatLine[]>([]);
	let nextChatMessageId = 1;
	const MAXIMUM_CHAT_LINES = 250;
	let entryPending = $state(false);
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let cameraController = $state<ClientPresentationCameraController | null>(
		null,
	);
	/** Imperative presentation source sampled by the radar on its own bounded cadence. */
	let presentationSession: ClientPresentationSession | null = null;
	let frameRateSampler: FrameRateSampler | null = null;

	/** CDP-facing bridge for explicit live-client performance probes. */
	interface ClientPerformanceProbe {
		reset(): void;
		setRendererProfilingEnabled(enabled: boolean): void;
		snapshot(): {
			readonly diagnostics: ClientPresentationDiagnostics;
			readonly frameRates: FrameRates | null;
			readonly meanFrameWorkMs: number | null;
			readonly sampledFrameCount: number;
		};
	}
	type ClientPerformanceWindow = Window & {
		__holtburgerClientPerformance?: ClientPerformanceProbe;
	};
	const toastCenter = new ClientToastCenter({
		durationMs: CLIENT_TOAST_DURATION_MS,
		scheduler: {
			cancel: (handle) => window.clearTimeout(handle),
			schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
		},
	});
	// Controls replace this cold policy snapshot; frame-hot consumers must receive plain objects.
	let frameSettings = $state.raw<FrameSettings>({
		...CLIENT_TUNING.frameSettings,
	});
	let inputController: CharacterInputController | null = null;
	const { viewport: inputGate, keyboard } = provideAppInputPolicy();
	let inputArbiter: ClientInputArbiter | null = null;
	const characterInput = APP_INPUT.characterContext((action, pressed) => {
		if (
			action === "jump" &&
			characterMotion === null &&
			!inputArbiter?.preciseActive
		)
			return;
		inputArbiter?.applyAction(action, pressed);
	});

	$effect(() => {
		if (!worldInputEnabled) return untrack(() => inputGate.block());
	});
	let preciseJumpSession: ClientPreciseJumpSession | null = null;
	let entitySelection: ClientEntitySelection | null = null;
	let entityInteractions: ClientEntityInteractions | null = null;
	let selectedEntityGuid = $state<number | null>(null);
	/** Session-local diagnostic policy; each use captures the current value. */
	let unrestrictedUse = $state(false);
	let hoveredEntityGuid = $state<number | null>(null);
	let preciseJumpActive = $state(false);
	let inputDispatch: Promise<void> = Promise.resolve();
	const usesWorldPresentation = $derived(
		clientLifecycleUsesWorldPresentation(lifecycle),
	);
	const worldInputEnabled = $derived(
		clientLifecycleEnablesWorldInput(lifecycle),
	);

	function queueCharacterMotionEdge(
		currentSession: ClientLifecycleSession,
		edge: CharacterInputEdge,
		active: () => boolean,
	): void {
		if (edge.kind === "reset") {
			cameraController?.setTranslationIntent(false, performance.now());
		}
		if (edge.kind === "begin-jump") {
			activeJumpBeginSequence = edge.sequence;
		} else {
			activeJumpBeginSequence = null;
		}
		const request: ClientCharacterMotionEventRequest =
			edge.kind === "reset"
				? edge
				: {
						...edge,
						drive: {
							gait: edge.drive.gait,
							longitudinal: edge.drive.longitudinal,
							lateral: edge.drive.lateral,
							turning: edge.drive.turn,
						},
					};
		inputDispatch = inputDispatch
			.then(() => currentSession.queueCharacterMotionEvent(request))
			.catch((error: unknown) => {
				if (active()) commandFailure = diagnostic(error);
			});
	}

	function jumpRejectionText(reason: ClientCharacterMotionRejection): string {
		switch (reason) {
			case "airborne":
				return "You are already airborne.";
			case "unsupported":
				return "You need stable ground to jump.";
			case "overburdened":
				return "You are carrying too much to jump.";
			case "capability-unavailable":
			case "body-unavailable":
			case "collision-unavailable":
				return "Jump is not ready yet.";
			case "charge-not-active":
				return "The jump charge is no longer active.";
			case "launch-rejected":
				return "The jump could not be launched.";
		}
	}

	function replaceClientDrive(
		currentSession: ClientLifecycleSession,
		drive: CharacterDrive,
		intent: CharacterDriveIntent,
		active: () => boolean,
	): void {
		cameraController?.setTranslationIntent(
			drive.longitudinal !== null ||
				drive.lateral !== null ||
				drive.turn !== null,
			performance.now(),
		);
		const request: ClientDriveRequest = {
			kind: intent,
			drive: {
				gait: drive.gait,
				longitudinal: drive.longitudinal,
				lateral: drive.lateral,
				turning: drive.turn,
			},
		};
		inputDispatch = inputDispatch
			.then(() => currentSession.replaceDrive(request))
			.catch((error: unknown) => {
				if (active()) commandFailure = diagnostic(error);
			});
	}

	function receive(event: ClientLifecycleSessionEvent): void {
		switch (event.type) {
			case "entity-collision-disabled":
				entityCollisionDisabled = event.disabled;
				return;
			case "current-state":
				entityCollisionDisabled = event.state.entityCollisionDisabled;
				if (event.state.lifecycle.kind !== "in-world") inputGate.cancel();
				playerName = event.state.playerName;
				worldName = event.state.worldName;
				vitals = event.state.vitals;
				characterMotion = event.state.characterMotion;
				if (characterMotion !== null)
					inputController?.setFullChargeDurationMs(
						characterMotion.fullChargeDurationMs,
					);
				lifecycle = reduceClientLifecycleUiState(lifecycle, {
					type: "authority",
					lifecycle: event.state.lifecycle,
				});
				return;
			case "lifecycle":
				if (event.lifecycle.kind !== "in-world") inputGate.cancel();
				lifecycle = reduceClientLifecycleUiState(lifecycle, {
					type: "authority",
					lifecycle: event.lifecycle,
				});
				return;
			case "character-motion-capabilities":
				characterMotion = event.capabilities;
				if (event.capabilities !== null)
					inputController?.setFullChargeDurationMs(
						event.capabilities.fullChargeDurationMs,
					);
				return;
			case "transient-string":
				toastCenter.publish({ message: event.message, tone: "status" });
				return;
			case "action-feedback":
				toastCenter.publish(event.feedback);
				return;
			case "character-motion-feedback":
				if (event.feedback.outcome.kind === "rejected") {
					inputController?.rejectBegin(event.feedback.sequence);
					if (activeJumpBeginSequence === event.feedback.sequence)
						activeJumpBeginSequence = null;
					toastCenter.publish({
						message: jumpRejectionText(event.feedback.outcome.reason),
						tone: "warning",
					});
				}
				return;
			case "world-name":
				worldName = event.name;
				return;
			case "player-entered":
				if (event.player.playerGuid === session?.state().playerGuid) {
					playerName = event.player.name;
				}
				return;
			case "vitals":
				vitals = event.vitals;
				return;
			case "chat": {
				appendChatLine(event.message);
				return;
			}
			case "exit-requested":
				inputGate.cancel();
				lifecycle = reduceClientLifecycleUiState(lifecycle, {
					type: "exit",
					exit: event.exit,
				});
				return;
			case "presentation-discontinuity":
				inputGate.cancel();
				return;
			default:
				return;
		}
	}

	function appendChatLine(
		message: ClientChatMessage | ClientChatErrorMessage,
	): void {
		const line: ClientChatLine = {
			...message,
			id: nextChatMessageId++,
			receivedAt: new Date(),
		};
		chatMessages = [...chatMessages, line].slice(-MAXIMUM_CHAT_LINES);
	}

	function appendChatError(error: unknown): void {
		appendChatLine({ kind: "error", message: diagnostic(error) });
	}

	function chooseCharacter(guid: number): void {
		lifecycle = reduceClientLifecycleUiState(lifecycle, {
			type: "select",
			guid,
		});
	}

	/** Enter, button activation, and double-click all converge on this one idempotent edge. */
	async function enterWorld(): Promise<void> {
		if (
			entryPending ||
			commandFailure !== null ||
			session === null ||
			lifecycle.kind !== "character-selection" ||
			lifecycle.selectedGuid === null
		) {
			return;
		}

		entryPending = true;
		try {
			await session.enterWorld(lifecycle.selectedGuid);
		} catch (error) {
			// The host owns terminal failure policy. Keep this shell inert and diagnostic-only; there
			// is deliberately no retry or editable configuration path in the first cut.
			commandFailure = diagnostic(error);
		} finally {
			entryPending = false;
		}
	}

	async function disconnect(): Promise<void> {
		if (session === null || lifecycle.kind === "exiting") return;
		try {
			inputGate.cancel();
			await inputDispatch;
			await session.disconnect();
		} catch (error) {
			commandFailure = diagnostic(error);
		}
	}

	async function sendChat(message: string): Promise<void> {
		if (session === null) throw new Error("Chat session is unavailable.");
		await session.sendChat(message);
	}

	function handleGameKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented) return;
		if (
			APP_INPUT.shortcut("cancel", event) &&
			inputArbiter?.applyCancel(true, event.repeat)
		) {
			event.preventDefault();
			return;
		}
		if (APP_INPUT.shortcut("preciseJump", event) && inputArbiter !== null) {
			event.preventDefault();
			if (!event.repeat) inputArbiter.enterPrecise();
			return;
		}
		if (
			APP_INPUT.shortcut("interact", event) &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.metaKey &&
			!event.isComposing
		) {
			event.preventDefault();
			if (!event.repeat) entityInteractions?.interact(unrestrictedUse);
			return;
		}
		if (inputArbiter !== null && characterInput.apply(event, true))
			event.preventDefault();
	}

	function handleGameKeyup(event: KeyboardEvent): void {
		if (characterInput.apply(event, false)) event.preventDefault();
	}

	function aimPreciseJump(clientX: number, clientY: number): void {
		const ray = presentationSession?.samplePreciseJumpRay(clientX, clientY);
		if (ray !== null && ray !== undefined) preciseJumpSession?.aim(ray);
	}

	function activatePreciseJump(): void {
		inputArbiter?.activatePointer();
	}

	function enterPreciseJump(): void {
		inputArbiter?.enterPrecise();
	}

	function diagnostic(error: unknown): string {
		if (error instanceof Error) return error.message;
		if (typeof error === "string" && error.trim().length > 0) return error;
		return "The client command failed.";
	}

	function presentationStatusText(status: ClientPresentationStatus): string {
		if (status.diagnostic !== null && status.kind !== "error") {
			return status.diagnostic;
		}
		switch (status.kind) {
			case "starting":
				return "Preparing world presentation…";
			case "awaiting-snapshot":
				return "Waiting for an authoritative world snapshot…";
			case "loading-player":
				return "Waiting for the player presentation…";
			case "loading-activation":
				return "Loading the authoritative scene…";
			case "ready":
				return "World ready";
			case "error":
				return status.diagnostic ?? "World presentation failed.";
			case "stopped":
				return "World presentation stopped.";
		}
	}

	function readMinimapFrame(): MinimapFrame {
		return (
			presentationSession?.readMinimapFrame() ?? {
				cameraFovRadians: 0,
				cameraHeadingRadians: 0,
				presentedEntities: () => [],
				selectedGuid: selectedEntityGuid,
				source: null,
				subject: null,
			}
		);
	}

	function readSelectedEntity(): ClientSelectedEntity | null {
		return session === null
			? null
			: clientSelectedEntity(
					entitySelection?.selectedGuid() ?? null,
					session.entities.read(),
					session.mirror.entities(),
				);
	}

	function readDiagnostics(): ClientPresentationDiagnostics | null {
		return presentationSession?.readDiagnostics() ?? null;
	}

	function readFrameRates(): FrameRates | null {
		return frameRateSampler?.readFrameRates() ?? null;
	}

	function readTargetIndicatorFrame(): ClientTargetIndicatorFrame | null {
		return presentationSession?.readTargetIndicatorFrame() ?? null;
	}

	function readSelectedEntityDisplay(): ClientSelectedEntityDisplay {
		return entityInteractions?.display() ?? EMPTY_CLIENT_SELECTED_DISPLAY;
	}

	async function setEntityCollisionDisabled(disabled: boolean): Promise<void> {
		try {
			if (session === null) throw new Error("Client session unavailable.");
			await session.setEntityCollisionDisabled(disabled);
		} catch (error) {
			toastCenter.publish({ message: String(error), tone: "warning" });
		}
	}

	function setShowRetailHiddenGeometry(visible: boolean): void {
		frameSettings = { ...frameSettings, showRetailHiddenGeometry: visible };
		presentationSession?.setFrameSettings(frameSettings);
	}

	/** Build and drive the renderer after Svelte mounts the world-presentation canvas. */
	$effect(() => {
		const currentSession = session;
		const currentTransport = hostTransport;
		const shouldInstall = usesWorldPresentation;
		const canvas = canvasElement;
		if (
			currentSession === null ||
			currentTransport === null ||
			canvas === null ||
			!shouldInstall
		) {
			return;
		}

		let cancelled = false;
		let frameHandle = 0;
		let lastStatus: ClientPresentationStatus | null = null;
		let lastErrorMessage: string | null = null;
		const reportPresentationError = (error: unknown): void => {
			if (cancelled) return;
			console.error(error);
			const message = diagnostic(error);
			if (message === lastErrorMessage) return;
			lastErrorMessage = message;
			appendChatError(error);
		};
		const reportPresentationStatus = (
			nextStatus: ClientPresentationStatus,
		): void => {
			if (
				nextStatus.kind === lastStatus?.kind &&
				nextStatus.diagnostic === lastStatus.diagnostic
			) {
				return;
			}
			lastStatus = nextStatus;
			if (nextStatus.kind === "error") {
				reportPresentationError(
					nextStatus.diagnostic ?? "World presentation failed.",
				);
				return;
			}
			lastErrorMessage = null;
			if (nextStatus.kind === "stopped") return;
			toastCenter.publish({
				message: presentationStatusText(nextStatus),
				tone: "status",
			});
		};
		const presentation = new ClientPresentationSession({
			canvas,
			hostTransport: currentTransport,
			session: currentSession,
			onError: reportPresentationError,
			enablePerformanceProfiling: debugEnabled,
		});
		// Frame settings are cold presentation policy, not renderer identity. The control handler
		// updates the live owner directly; this snapshot only initializes a genuinely new owner.
		presentation.setFrameSettings(untrack(() => frameSettings));
		const currentFrameRateSampler = createFrameRateSampler(
			CLIENT_TUNING.diagnostics.frameMetricsEmaWindowMs,
		);
		let sampledFrameWorkMs = 0;
		let sampledFrameCount = 0;
		const performanceProbe: ClientPerformanceProbe = {
			reset: (): void => {
				sampledFrameWorkMs = 0;
				sampledFrameCount = 0;
				presentation.resetRendererFrameProfile();
			},
			setRendererProfilingEnabled: (enabled): void => {
				presentation.setRendererFrameProfilingEnabled(enabled);
			},
			snapshot: () => ({
				diagnostics: presentation.readDiagnostics(),
				frameRates: currentFrameRateSampler.readFrameRates(),
				meanFrameWorkMs:
					sampledFrameCount === 0
						? null
						: sampledFrameWorkMs / sampledFrameCount,
				sampledFrameCount,
			}),
		};
		presentationSession = presentation;
		presentation.setSelectedEntityGuid(untrack(() => selectedEntityGuid));
		frameRateSampler = currentFrameRateSampler;
		(window as ClientPerformanceWindow).__holtburgerClientPerformance =
			performanceProbe;
		cameraController = presentation.camera;
		reportPresentationStatus({ kind: "starting", diagnostic: null });

		const frame = (timeMs: number): void => {
			if (cancelled) return;
			const frameStartedAt = performance.now();
			const nextStatus = presentation.frame(timeMs).status;
			const frameFinishedAt = performance.now();
			sampledFrameWorkMs += frameFinishedAt - frameStartedAt;
			sampledFrameCount += 1;
			currentFrameRateSampler.recordFrame({
				animationFrameTimeMs: timeMs,
				startedAtMs: frameStartedAt,
				workMs: frameFinishedAt - frameStartedAt,
			});
			reportPresentationStatus(nextStatus);
			frameHandle = window.requestAnimationFrame(frame);
		};
		void presentation
			.start()
			.then(() => {
				if (!cancelled) {
					// The imperative owner remains authoritative; this snapshot only closes the
					// race between marker publication and presentation startup.
					presentation.setPreciseJumpMarker(
						preciseJumpSession?.snapshot().marker ?? null,
					);
					frameHandle = window.requestAnimationFrame(frame);
				}
			})
			.catch(reportPresentationError);

		return () => {
			cancelled = true;
			window.cancelAnimationFrame(frameHandle);
			void presentation.destroy().catch((error: unknown) => {
				// The route is already leaving, so keep teardown failure visible to diagnostics
				// without mutating an unmounted chat surface.
				console.error(error);
			});
			if (cameraController === presentation.camera) cameraController = null;
			if (presentationSession === presentation) presentationSession = null;
			if (frameRateSampler === currentFrameRateSampler) frameRateSampler = null;
			const performanceWindow = window as ClientPerformanceWindow;
			if (
				performanceWindow.__holtburgerClientPerformance === performanceProbe
			) {
				delete performanceWindow.__holtburgerClientPerformance;
			}
		};
	});

	/** Raw browser ownership ends at the client shell; every edge publishes an idle replacement. */
	$effect(() => {
		const currentSession = session;
		const shouldOwnInput = worldInputEnabled;
		if (currentSession === null || !shouldOwnInput) {
			inputController?.releaseOwnership();
			inputController = null;
			return;
		}

		let cancelled = false;
		const isActive = (): boolean => !cancelled && session === currentSession;
		const initialCharacterMotion = untrack(() => characterMotion);
		const controller = new CharacterInputController({
			// Jump remains gated until authority supplies capability; movement can start earlier.
			fullChargeDurationMs:
				initialCharacterMotion?.fullChargeDurationMs ?? 1000,
			now: () => performance.now(),
			onDrive: (drive, intent) =>
				replaceClientDrive(currentSession, drive, intent, isActive),
			onEdge: (edge) =>
				queueCharacterMotionEdge(currentSession, edge, isActive),
		});
		inputController = controller;
		const arbiter = new ClientInputArbiter({
			ordinary: controller,
			onEnter: () => {
				preciseJumpSession?.enter();
				toastCenter.publish({
					message: "Precise jump enabled",
					tone: "status",
				});
			},
			onActivate: () => preciseJumpSession?.activate(),
			onCancel: () => preciseJumpSession?.cancel(),
		});
		inputArbiter = arbiter;

		return () => {
			cancelled = true;
			activeJumpBeginSequence = null;
			keyboard.cancel();
			controller.releaseOwnership();
			if (inputArbiter === arbiter) inputArbiter = null;
			if (inputController === controller) inputController = null;
		};
	});

	onMount(() =>
		keyboard.bindGame({
			keydown: handleGameKeydown,
			keyup: handleGameKeyup,
			cancel: () => {
				characterInput.reset();
				inputArbiter?.reset();
			},
		}),
	);

	/** One startup result consumed only by the diagnostics panel. */
	let entityMetadata = $state<WeenieCatalogCapability | null>(null);
	onMount(() => {
		let disposed = false;
		const unsubscribeToast = toastCenter.subscribe((next) => (toast = next));
		const transport = createElectronHostTransport();
		hostTransport = transport;
		void transport
			.invoke("host_status")
			.then((value) => {
				const status = z
					.object({ entityMetadata: weenieCatalogCapabilitySchema })
					.parse(value);
				if (!disposed) entityMetadata = status.entityMetadata;
			})
			.catch((error: unknown) => {
				if (!disposed) commandFailure = diagnostic(error);
			});
		const owner = new ClientLifecycleSession(
			hostClientLifecycleTransport(transport),
		);
		session = owner;
		const icons = browserItemIconRepository((requests) =>
			prepareItemIcons(transport, requests),
		);
		const inventoryOwner = new ClientInventoryState(owner, icons);
		inventory = inventoryOwner;
		const dialogOwner = new ClientDialogs(owner);
		dialogs = dialogOwner;
		const unsubscribeDialogs = dialogOwner.subscribe(
			(value) => (dialogPresentation = value),
		);
		const unsubscribe = owner.subscribe(receive);
		const precise = new ClientPreciseJumpSession(owner, (error) => {
			commandFailure = diagnostic(error);
		});
		preciseJumpSession = precise;
		const selection = new ClientEntitySelection({
			lifecycle: owner,
			presentation: () => presentationSession,
			onSelectionSubmissionFailed: appendChatError,
		});
		entitySelection = selection;
		const interactions = new ClientEntityInteractions({
			selection,
			lifecycle: owner,
			onFailure: appendChatError,
		});
		entityInteractions = interactions;
		unrestrictedUse = false;
		const unsubscribeSelection = selection.subscribe((guid) => {
			selectedEntityGuid = guid;
			presentationSession?.setSelectedEntityGuid(guid);
		});
		const unsubscribeHover = selection.subscribeHovered(
			(guid) => (hoveredEntityGuid = guid),
		);
		const unsubscribePrecise = precise.subscribe((snapshot) => {
			if (preciseJumpActive !== snapshot.active)
				preciseJumpActive = snapshot.active;
			presentationSession?.setPreciseJumpMarker(snapshot.marker);
			if (!snapshot.active) inputArbiter?.deactivate();
		});
		void owner.start().catch((error: unknown) => {
			startupError = diagnostic(error);
		});

		return () => {
			disposed = true;
			inventoryOwner.destroy();
			inventory = null;
			icons.dispose();
			dialogOwner.destroy();
			unsubscribeDialogs();
			dialogs = null;
			unsubscribeToast();
			toastCenter.destroy();
			unsubscribePrecise();
			unsubscribeSelection();
			unsubscribeHover();
			interactions.destroy();
			if (entityInteractions === interactions) entityInteractions = null;
			selection.destroy();
			if (entitySelection === selection) entitySelection = null;
			precise.destroy();
			if (preciseJumpSession === precise) preciseJumpSession = null;
			unsubscribe();
			owner.stop();
			session = null;
			hostTransport = null;
		};
	});
</script>

{#if dialogPresentation !== null}
	<ClientMessageDialog
		presentation={dialogPresentation}
		onDismiss={(id) => dialogs?.dismissPopup(id)}
		onRespond={(id, accepted) => {
			void dialogs?.respond(id, accepted);
		}}
	/>
{/if}
{#if !usesWorldPresentation}
	<ClientToastOverlay {toast} previewMessage={null} />
{/if}

{#if usesWorldPresentation && startupError === null && commandFailure === null}
	<ClientWorldView
		{entityMetadata}
		cameraController={lifecycle.kind === "in-world" ? cameraController : null}
		{debugEnabled}
		{readMinimapFrame}
		{readDiagnostics}
		{readSelectedEntity}
		{readFrameRates}
		{readTargetIndicatorFrame}
		{readSelectedEntityDisplay}
		{inventory}
		onSelectInventoryItem={(guid) => entitySelection?.selectInventoryItem(guid)}
		onInteractEntity={() => entityInteractions?.interact(unrestrictedUse)}
		{selectedEntityGuid}
		{hoveredEntityGuid}
		showRetailHiddenGeometry={frameSettings.showRetailHiddenGeometry}
		onShowRetailHiddenGeometryChange={setShowRetailHiddenGeometry}
		{entityCollisionDisabled}
		onEntityCollisionDisabledChange={setEntityCollisionDisabled}
		{unrestrictedUse}
		onUnrestrictedUseChange={(enabled) => (unrestrictedUse = enabled)}
		{playerName}
		{worldName}
		{vitals}
		jumpChargeActive={activeJumpBeginSequence !== null}
		readJumpExtent={() => inputController?.chargeExtent() ?? 0}
		{toast}
		{preciseJumpActive}
		onPreciseJumpAim={aimPreciseJump}
		onPreciseJumpActivate={activatePreciseJump}
		onPreciseJumpEnter={enterPreciseJump}
		onViewportSelect={(clientX, clientY) =>
			entitySelection?.acquireViewportPoint(clientX, clientY)}
		onViewportHover={(clientX, clientY) =>
			entitySelection?.acquireViewportHover(clientX, clientY)}
		onMaintainEntitySelection={() => entitySelection?.maintainSelection()}
		onSelectEntity={(guid) => entitySelection?.select(guid)}
		{chatMessages}
		onSendChat={sendChat}
		onCanvas={(canvas) => (canvasElement = canvas)}
	/>
{:else}
	<main class="client-screen ui-theme" aria-label="Holtburger client">
		<section class="client-panel ui-panel">
			<header class="ui-frame">
				<span>Client</span>
			</header>

			<div class="client-panel-body ui-body">
				<p class="ui-muted">Holtburger 3D Client</p>
				{#if startupError !== null}
					<h1>Client unavailable</h1>
					<p class="client-status ui-error" role="alert">
						{startupError}
					</p>
				{:else if commandFailure !== null}
					<h1>Client stopped</h1>
					<p class="client-status client-status-error" role="alert">
						{commandFailure}
					</p>
				{:else if lifecycle.kind === "connecting"}
					<h1>Connecting</h1>
					<p class="client-status" aria-live="polite">
						Opening the game session…
					</p>
				{:else if lifecycle.kind === "authenticating"}
					<h1>Authenticating</h1>
					<p class="client-status" aria-live="polite">
						Checking the launch account…
					</p>
				{:else if lifecycle.kind === "character-selection"}
					<ClientCharacterSelect
						state={lifecycle}
						{entryPending}
						onChoose={chooseCharacter}
						onEnter={enterWorld}
						onDisconnect={disconnect}
					/>
				{:else if lifecycle.kind === "entering-world"}
					<h1>Entering world</h1>
					<p class="client-status" aria-live="polite">
						Preparing character 0x{lifecycle.characterGuid
							.toString(16)
							.padStart(8, "0")}…
					</p>
				{:else}
					<h1>Disconnecting</h1>
					<p class="client-status" aria-live="polite">
						{lifecycle.kind === "exiting" && lifecycle.diagnostic !== null
							? lifecycle.diagnostic
							: "Closing the game session…"}
					</p>
				{/if}
			</div>
		</section>
	</main>
{/if}

<style>
	@layer components {
		.client-screen {
			display: grid;
			min-height: 100vh;
			place-items: start center;
			padding: clamp(16px, 5vw, 48px);
			background: var(--ui-color-well);
		}
		.client-panel {
			width: min(100%, 640px);
		}
		.client-panel-body {
			display: grid;
			gap: 12px;
			padding: clamp(12px, 3vw, 24px);
		}
	}
</style>
