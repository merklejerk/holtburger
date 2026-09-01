<script lang="ts">
	import { onMount, untrack } from "svelte";
	import {
		createFrameRateSampler,
		type FrameRates,
		type FrameRateSampler,
	} from "../app/frame-rate-sampler";

	import {
		CharacterInputController,
		type CharacterDrive,
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
	import ClientWorldView from "./ClientWorldView.svelte";
	import type { MapPanelFrame } from "../app/map-panel-frame";
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
	import { clientInputKey, ClientInputArbiter } from "./client-input-arbiter";
	import { ClientPreciseJumpSession } from "./client-precise-jump-session";
	import {
		CLIENT_TOAST_DURATION_MS,
		ClientToastCenter,
		type ClientToast,
	} from "./client-toast-center";

	let lifecycle = $state<ClientLifecycleUiState>(
		initialClientLifecycleUiState(),
	);
	const debugEnabled = clientDebugEnabled(window.location.search);
	let session = $state<ClientLifecycleSession | null>(null);
	let hostTransport = $state<HostTransport | null>(null);
	let startupError = $state<string | null>(null);
	let commandFailure = $state<string | null>(null);
	let playerName = $state<string | null>(null);
	let worldName = $state<string | null>(null);
	let vitals = $state<readonly ClientVital[]>([]);
	let characterMotion = $state<ClientCharacterMotionCapabilities | null>(null);
	let activeJumpBeginSequence = $state<number | null>(null);
	let toast = $state<ClientToast | null>(null);
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
	const toastCenter = new ClientToastCenter({
		durationMs: CLIENT_TOAST_DURATION_MS,
		scheduler: {
			cancel: (handle) => window.clearTimeout(handle),
			schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
		},
	});
	let frameSettings = $state<FrameSettings>({ ...CLIENT_TUNING.frameSettings });
	let inputController: CharacterInputController | null = null;
	let inputArbiter: ClientInputArbiter | null = null;
	let preciseJumpSession: ClientPreciseJumpSession | null = null;
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
		active: () => boolean,
	): void {
		cameraController?.setTranslationIntent(
			drive.longitudinal !== null ||
				drive.lateral !== null ||
				drive.turn !== null,
			performance.now(),
		);
		const request: ClientDriveRequest = {
			gait: drive.gait,
			longitudinal: drive.longitudinal,
			lateral: drive.lateral,
			turning: drive.turn,
		};
		inputDispatch = inputDispatch
			.then(() => currentSession.replaceDrive(request))
			.catch((error: unknown) => {
				if (active()) commandFailure = diagnostic(error);
			});
	}

	function receive(event: ClientLifecycleSessionEvent): void {
		switch (event.type) {
			case "current-state":
				if (event.state.lifecycle.kind !== "in-world") inputArbiter?.reset();
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
				if (event.lifecycle.kind !== "in-world") inputArbiter?.reset();
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
				inputArbiter?.reset();
				lifecycle = reduceClientLifecycleUiState(lifecycle, {
					type: "exit",
					exit: event.exit,
				});
				return;
			case "presentation-discontinuity":
				inputArbiter?.reset();
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
			inputArbiter?.reset();
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

	function handleChatFocusChange(focused: boolean): void {
		if (focused) inputArbiter?.reset();
	}

	function handleWindowKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented) return;
		if (event.target instanceof HTMLInputElement) return;
		if (lifecycle.kind === "character-selection" && event.key === "Enter") {
			event.preventDefault();
			void enterWorld();
			return;
		}
		if (lifecycle.kind !== "in-world") return;
		if (
			event.key === "Escape" &&
			inputArbiter?.applyEscape(true, event.repeat)
		) {
			event.preventDefault();
			return;
		}
		if (
			event.key.toLowerCase() === "j" &&
			event.shiftKey &&
			inputArbiter !== null
		) {
			event.preventDefault();
			if (!event.repeat) inputArbiter.enterPrecise();
			return;
		}
		const key = clientInputKey(event.key);
		if (key === null || inputArbiter === null) return;
		if (
			key === "space" &&
			characterMotion === null &&
			!inputArbiter.preciseActive
		)
			return;
		event.preventDefault();
		inputArbiter.applyKey(key, true, event.repeat);
	}

	function handleWindowKeyup(event: KeyboardEvent): void {
		if (event.target instanceof HTMLInputElement) return;
		if (lifecycle.kind !== "in-world") return;
		const key = clientInputKey(event.key);
		if (key === null || inputArbiter === null) return;
		event.preventDefault();
		inputArbiter.applyKey(key, false, event.repeat);
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

	function readMapPanelFrame(): MapPanelFrame {
		return (
			presentationSession?.readMapPanelFrame() ?? {
				cameraFovRadians: 0,
				cameraHeadingRadians: 0,
				presentedEntities: () => [],
				presentedEntityRevision: 0,
				source: null,
				subject: null,
			}
		);
	}

	function readDiagnostics(): ClientPresentationDiagnostics | null {
		return presentationSession?.readDiagnostics() ?? null;
	}

	function readFrameRates(): FrameRates | null {
		return frameRateSampler?.readFrameRates() ?? null;
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
		});
		// Frame settings are cold presentation policy, not renderer identity. The control handler
		// updates the live owner directly; this snapshot only initializes a genuinely new owner.
		presentation.setFrameSettings(untrack(() => frameSettings));
		const currentFrameRateSampler = createFrameRateSampler(
			CLIENT_TUNING.diagnostics.frameMetricsEmaWindowMs,
		);
		presentationSession = presentation;
		frameRateSampler = currentFrameRateSampler;
		cameraController = presentation.camera;
		reportPresentationStatus({ kind: "starting", diagnostic: null });

		const frame = (timeMs: number): void => {
			if (cancelled) return;
			const frameStartedAt = performance.now();
			const nextStatus = presentation.frame(timeMs).status;
			const frameFinishedAt = performance.now();
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
			// Space remains gated until authority supplies capability; this value only permits the
			// shared drive controller to exist early enough for W/S/A/D/Z/C.
			fullChargeDurationMs:
				initialCharacterMotion?.fullChargeDurationMs ?? 1000,
			now: () => performance.now(),
			onDrive: (drive) => replaceClientDrive(currentSession, drive, isActive),
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

		const clearHeldInput = (): void => arbiter.reset();
		window.addEventListener("blur", clearHeldInput);
		window.addEventListener("focusout", clearHeldInput);
		document.addEventListener("visibilitychange", clearHeldInput);

		return () => {
			cancelled = true;
			activeJumpBeginSequence = null;
			window.removeEventListener("blur", clearHeldInput);
			window.removeEventListener("focusout", clearHeldInput);
			document.removeEventListener("visibilitychange", clearHeldInput);
			arbiter.reset();
			controller.releaseOwnership();
			if (inputArbiter === arbiter) inputArbiter = null;
			if (inputController === controller) inputController = null;
		};
	});

	onMount(() => {
		const unsubscribeToast = toastCenter.subscribe((next) => (toast = next));
		const transport = createElectronHostTransport();
		hostTransport = transport;
		const owner = new ClientLifecycleSession(
			hostClientLifecycleTransport(transport),
		);
		session = owner;
		const unsubscribe = owner.subscribe(receive);
		const precise = new ClientPreciseJumpSession(owner, (error) => {
			commandFailure = diagnostic(error);
		});
		preciseJumpSession = precise;
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
			unsubscribeToast();
			toastCenter.destroy();
			unsubscribePrecise();
			precise.destroy();
			if (preciseJumpSession === precise) preciseJumpSession = null;
			unsubscribe();
			owner.stop();
			session = null;
			hostTransport = null;
		};
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} onkeyup={handleWindowKeyup} />

{#if usesWorldPresentation && startupError === null && commandFailure === null}
	<ClientWorldView
		cameraController={lifecycle.kind === "in-world" ? cameraController : null}
		{debugEnabled}
		{readMapPanelFrame}
		{readDiagnostics}
		{readFrameRates}
		showRetailHiddenGeometry={frameSettings.showRetailHiddenGeometry}
		onShowRetailHiddenGeometryChange={setShowRetailHiddenGeometry}
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
		{chatMessages}
		onSendChat={sendChat}
		onChatFocusChange={handleChatFocusChange}
		onCanvas={(canvas) => (canvasElement = canvas)}
	/>
{:else}
	<main class="client-screen" aria-label="Holtburger client">
		<section class="client-panel ac-panel">
			<header class="ac-titlebar">
				<span>Client</span>
			</header>

			<div class="client-panel-body ac-panel-body">
				<p class="ac-section-label">Holtburger 3D Client</p>
				{#if startupError !== null}
					<h1>Client unavailable</h1>
					<p class="client-status client-status-error" role="alert">
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
	.client-screen {
		display: grid;
		min-height: 100vh;
		place-items: start center;
		padding: clamp(16px, 5vw, 48px);
		background:
			linear-gradient(rgb(7 6 5 / 0.82), rgb(7 6 5 / 0.9)),
			repeating-linear-gradient(
				135deg,
				rgb(201 183 132 / 0.035) 0,
				rgb(201 183 132 / 0.035) 1px,
				transparent 1px,
				transparent 5px
			),
			radial-gradient(
				circle at 24% 18%,
				rgb(112 78 28 / 0.28),
				transparent 18rem
			),
			radial-gradient(
				circle at 78% 76%,
				rgb(52 75 29 / 0.18),
				transparent 22rem
			),
			var(--ac-panel-deep);
	}

	.client-panel {
		width: min(100%, 640px);
	}

	.client-panel-body {
		display: grid;
		gap: 16px;
		padding: clamp(18px, 4vw, 32px);
	}

	.client-panel-body .ac-section-label {
		margin-bottom: -4px;
	}

	.client-status-error {
		padding: 10px;
		border: 1px solid rgb(179 41 27 / 0.9);
		background: rgb(65 14 11 / 0.72);
		color: var(--ac-ink);
	}
</style>
