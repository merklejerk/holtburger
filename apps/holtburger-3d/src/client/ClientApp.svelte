<script lang="ts">
	import { onMount } from "svelte";
	import {
		createFrameRateSampler,
		type FrameRates,
		type FrameRateSampler,
	} from "../app/frame-rate-sampler";

	import {
		CharacterInputController,
		type CharacterInputKey,
	} from "../lib/game/controls/character-input-controller";
	import { FRONTEND_TUNING } from "../lib/frontend-tuning";
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
	import type { ClientDriveRequest, ClientVital } from "./client-host-contract";
	import type { ClientChatLine } from "./ClientChat.svelte";
	import {
		clientLifecycleEnablesWorldInput,
		clientLifecycleUsesWorldPresentation,
		initialClientLifecycleUiState,
		reduceClientLifecycleUiState,
		type ClientLifecycleUiState,
	} from "./client-lifecycle-state";

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
	let chatMessages = $state<readonly ClientChatLine[]>([]);
	let nextChatMessageId = 1;
	const MAXIMUM_CHAT_LINES = 250;
	let presentationError = $state<string | null>(null);
	let presentationStatus = $state<ClientPresentationStatus>({
		kind: "starting",
		diagnostic: null,
	});
	let entryPending = $state(false);
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let cameraController = $state<ClientPresentationCameraController | null>(
		null,
	);
	/** Imperative presentation source sampled by the radar on its own bounded cadence. */
	let presentationSession: ClientPresentationSession | null = null;
	let frameRateSampler: FrameRateSampler | null = null;
	let inputController: CharacterInputController | null = null;
	let inputDispatch: Promise<void> = Promise.resolve();
	const usesWorldPresentation = $derived(
		clientLifecycleUsesWorldPresentation(lifecycle),
	);
	const worldInputEnabled = $derived(
		clientLifecycleEnablesWorldInput(lifecycle),
	);

	const IDLE_CLIENT_DRIVE: ClientDriveRequest = {
		gait: "run",
		longitudinal: null,
		turning: null,
	};

	function clientInputKey(key: string): CharacterInputKey | null {
		switch (key) {
			case "w":
			case "s":
			case "a":
			case "d":
				return key;
			case "Shift":
				return "shift";
			default:
				return null;
		}
	}

	function replaceClientDrive(
		currentSession: ClientLifecycleSession,
		drive: {
			readonly gait: "run" | "walk";
			readonly longitudinal: "forward" | "backward" | null;
			readonly turn: "left" | "right" | null;
		},
		active: () => boolean,
	): void {
		cameraController?.setTranslationIntent(
			drive.longitudinal !== null || drive.turn !== null,
			performance.now(),
		);
		const request: ClientDriveRequest = {
			gait: drive.gait,
			longitudinal: drive.longitudinal,
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
				playerName = event.state.playerName;
				worldName = event.state.worldName;
				vitals = event.state.vitals;
				lifecycle = reduceClientLifecycleUiState(lifecycle, {
					type: "authority",
					lifecycle: event.state.lifecycle,
				});
				return;
			case "lifecycle":
				lifecycle = reduceClientLifecycleUiState(lifecycle, {
					type: "authority",
					lifecycle: event.lifecycle,
				});
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
				const line: ClientChatLine = {
					...event.message,
					id: nextChatMessageId++,
					receivedAt: new Date(),
				};
				chatMessages = [...chatMessages, line].slice(-MAXIMUM_CHAT_LINES);
				return;
			}
			case "exit-requested":
				lifecycle = reduceClientLifecycleUiState(lifecycle, {
					type: "exit",
					exit: event.exit,
				});
				return;
			default:
				return;
		}
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
			inputController?.reset();
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
		if (focused) inputController?.reset();
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
		const key = clientInputKey(event.key);
		if (key === null || inputController === null) return;
		event.preventDefault();
		inputController.applyKey(key, true, event.repeat);
	}

	function handleWindowKeyup(event: KeyboardEvent): void {
		if (event.target instanceof HTMLInputElement) return;
		if (lifecycle.kind !== "in-world") return;
		const key = clientInputKey(event.key);
		if (key === null || inputController === null) return;
		event.preventDefault();
		inputController.applyKey(key, false);
	}

	function diagnostic(error: unknown): string {
		return error instanceof Error
			? error.message
			: "The client command failed.";
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
				anchor: null,
				cameraFovRadians: 0,
				cameraHeadingRadians: 0,
				presentedEntities: () => [],
				presentedEntityRevision: 0,
				source: null,
			}
		);
	}

	function readDiagnostics(): ClientPresentationDiagnostics | null {
		return presentationSession?.readDiagnostics() ?? null;
	}

	function readFrameRates(): FrameRates | null {
		return frameRateSampler?.readFrameRates() ?? null;
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
		const reportPresentationError = (error: unknown): void => {
			if (cancelled) return;
			console.error(error);
			presentationError = diagnostic(error);
		};
		const presentation = new ClientPresentationSession({
			canvas,
			hostTransport: currentTransport,
			session: currentSession,
			onError: reportPresentationError,
		});
		const currentFrameRateSampler = createFrameRateSampler(
			FRONTEND_TUNING.diagnostics.frameMetricsEmaWindowMs,
		);
		presentationSession = presentation;
		frameRateSampler = currentFrameRateSampler;
		cameraController = presentation.camera;
		presentationError = null;

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
			if (
				nextStatus.kind !== presentationStatus.kind ||
				nextStatus.diagnostic !== presentationStatus.diagnostic
			) {
				presentationStatus = nextStatus;
			}
			frameHandle = window.requestAnimationFrame(frame);
		};
		void presentation
			.start()
			.then(() => {
				if (!cancelled) frameHandle = window.requestAnimationFrame(frame);
			})
			.catch(reportPresentationError);

		return () => {
			cancelled = true;
			window.cancelAnimationFrame(frameHandle);
			void presentation.destroy().catch((error: unknown) => {
				// The route is already leaving, but a release failure still belongs on the one
				// presentation diagnostic surface rather than becoming an unhandled rejection.
				presentationError = diagnostic(error);
			});
			if (cameraController === presentation.camera) cameraController = null;
			if (presentationSession === presentation) presentationSession = null;
			if (frameRateSampler === currentFrameRateSampler) frameRateSampler = null;
			presentationStatus = { kind: "stopped", diagnostic: null };
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
		const controller = new CharacterInputController({
			fullChargeDurationMs: 1000,
			now: () => performance.now(),
			onDrive: (drive) => replaceClientDrive(currentSession, drive, isActive),
			// Jump edges remain intentionally unbound: the client host contract has no jump consumer.
			onEdge: () => {},
		});
		inputController = controller;

		const clearHeldInput = (): void => controller.reset();
		window.addEventListener("blur", clearHeldInput);
		window.addEventListener("focusout", clearHeldInput);
		document.addEventListener("visibilitychange", clearHeldInput);

		return () => {
			cancelled = true;
			window.removeEventListener("blur", clearHeldInput);
			window.removeEventListener("focusout", clearHeldInput);
			document.removeEventListener("visibilitychange", clearHeldInput);
			controller.reset();
			controller.releaseOwnership();
			if (inputController === controller) inputController = null;
		};
	});

	onMount(() => {
		const transport = createElectronHostTransport();
		hostTransport = transport;
		const owner = new ClientLifecycleSession(
			hostClientLifecycleTransport(transport),
		);
		session = owner;
		const unsubscribe = owner.subscribe(receive);
		void owner.start().catch((error: unknown) => {
			startupError = diagnostic(error);
		});

		return () => {
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
		{presentationStatus}
		{presentationStatusText}
		{presentationError}
		{readMapPanelFrame}
		{readDiagnostics}
		{readFrameRates}
		{playerName}
		{worldName}
		{vitals}
		{chatMessages}
		onSendChat={sendChat}
		onChatFocusChange={handleChatFocusChange}
		onCanvas={(canvas) => (canvasElement = canvas)}
		onDisconnect={disconnect}
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
