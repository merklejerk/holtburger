<script lang="ts">
	import { onMount } from "svelte";
	import type { FrameRates } from "../../app/frame-rate-sampler";
	import ClientWorldView from "../../client/ClientWorldView.svelte";
	import type { ClientChatLine } from "../../client/ClientChat.svelte";
	import type { MapPanelFrame } from "../../app/map-panel-frame";
	import type { ClientPresentationDiagnostics } from "../../client/client-presentation-session";
	import type { ClientToast } from "../../client/client-toast-center";

	const jumpFixture = new URLSearchParams(window.location.search).get("jump");
	const jumpChargeActive = jumpFixture === "charging" || jumpFixture === "full";
	const jumpExtent = jumpFixture === "full" ? 1 : 0.45;
	const toastFixture = new URLSearchParams(window.location.search).get("toast");
	const toast: ClientToast | null =
		toastFixture === "precise"
			? { id: 1, message: "Precise jump enabled", tone: "status" }
			: toastFixture === "rejected"
				? {
						id: 1,
						message: "You need stable ground to jump.",
						tone: "warning",
					}
				: null;

	const messages: readonly ClientChatLine[] = [
		line(
			1,
			"system",
			null,
			"Welcome to the Holtburger client HUD harness.\nEmbedded chat line breaks remain visible.",
		),
		line(2, "speech", "Alex", "Duis aute irure dolor in reprehenderit."),
		line(
			3,
			"channel",
			"Taylor",
			"Excepteur sint occaecat cupidatat non proident.",
			"General",
		),
		line(4, "emote", "Sam", "salutes smartly"),
		line(5, "tell", "Jordan", "Consectetur adipiscing elit, sed do eiusmod."),
	];

	function line(
		id: number,
		kind: ClientChatLine["kind"],
		sender: string | null,
		message: string,
		channel: string | null = null,
	): ClientChatLine {
		return {
			channel,
			id,
			kind,
			message,
			receivedAt: new Date(2026, 7, 27, 9, id),
			sender,
		};
	}

	function readMapPanelFrame(): MapPanelFrame {
		return {
			cameraFovRadians: Math.PI / 3,
			cameraHeadingRadians: 0,
			presentedEntities: () => [],
			presentedEntityRevision: 0,
			source: null,
			subject: null,
		};
	}

	function readDiagnostics(): ClientPresentationDiagnostics | null {
		return {
			playerGuid: 0x5000_0001,
			playerResidency: {
				landblockId: "0xda55ffff",
				envCellId: null,
			},
			cameraResidency: {
				landblockId: "0xda55ffff",
				envCellId: null,
			},
			cameraStatus: {
				kind: "active",
				identity: {
					cameraGeneration: 3,
					playerGuid: 0x5000_0001,
					entityGeneration: 2,
				},
				sequence: 184,
				targetSphereRole: "primary",
				clearance: { projectionRevision: 12, radius: 0.2 },
				desiredReach: 4.5,
				renderedReach: 4.5,
				convergence: "settled",
				placementOutcome: {
					kind: "reseeded",
					reason: "initial-placement",
				},
				droppedPaths: 0,
				diagnostics: {
					collisionProof: { status: "covered" },
					controlLegs: 0,
					clearanceSweeps: 1,
					transitSubsteps: 0,
					contactPasses: 1,
				},
			},
			renderedFrameCount: 12_846,
			viewport: {
				cssWidth: 1280,
				cssHeight: 720,
				drawingBufferWidth: 1280,
				drawingBufferHeight: 720,
			},
			draw: {
				viewCount: 1,
				visibleSceneEntries: 148,
				visibleStaticNodes: 912,
				visibleDynamicEntities: 37,
				visibleDynamicParts: 104,
				objectDrawCalls: 286,
				dynamicDrawCalls: 81,
				particleBatches: 7,
			},
		};
	}

	function readFrameRates(): FrameRates {
		return { capped: 60, uncapped: 144 };
	}

	onMount(() => {
		const debugButton = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Debug"]',
		);
		if (debugButton === null) {
			throw new Error(
				"Client HUD harness could not find the diagnostics control.",
			);
		}
		debugButton.click();
	});
</script>

<ClientWorldView
	cameraController={null}
	preciseJumpActive={false}
	onPreciseJumpAim={() => undefined}
	onPreciseJumpActivate={() => undefined}
	onPreciseJumpEnter={() => undefined}
	debugEnabled={true}
	presentationStatus={{ kind: "ready", diagnostic: null }}
	presentationStatusText={() => "World ready"}
	presentationError={null}
	{readMapPanelFrame}
	{readDiagnostics}
	{readFrameRates}
	showRetailHiddenGeometry={false}
	onShowRetailHiddenGeometryChange={() => undefined}
	playerName="Alice"
	worldName="ACE Emulator"
	vitals={[
		{ kind: "health", current: 555, maximum: 555 },
		{ kind: "stamina", current: 210, maximum: 245 },
		{ kind: "mana", current: 302, maximum: 410 },
	]}
	{jumpChargeActive}
	readJumpExtent={() => jumpExtent}
	{toast}
	chatMessages={messages}
	onSendChat={async () => {}}
	onChatFocusChange={() => {}}
	onCanvas={() => {}}
	onDisconnect={() => {}}
/>

<style>
	:global(body) {
		margin: 0;
		overflow: hidden;
	}
	:global(.client-canvas) {
		background:
			linear-gradient(rgb(80 45 50 / 0.12), rgb(28 20 18 / 0.1)),
			radial-gradient(
				circle at 55% 78%,
				#b58c68,
				#624d42 45%,
				#27343a 78%,
				#aab8b5
			);
	}
</style>
