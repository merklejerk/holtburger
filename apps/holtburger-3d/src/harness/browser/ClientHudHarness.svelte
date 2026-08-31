<script lang="ts">
	import type { FrameRates } from "../../app/frame-rate-sampler";
	import ClientWorldView from "../../client/ClientWorldView.svelte";
	import type { ClientChatLine } from "../../client/ClientChat.svelte";
	import type { MapPanelFrame } from "../../app/map-panel-frame";
	import type { ClientPresentationDiagnostics } from "../../client/client-presentation-session";

	const jumpFixture = new URLSearchParams(window.location.search).get("jump");
	const jumpChargeActive = jumpFixture === "charging" || jumpFixture === "full";
	const jumpExtent = jumpFixture === "full" ? 1 : 0.45;
	const jumpStatus =
		jumpFixture === "rejected" ? "You need stable ground to jump." : null;

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
			anchor: null,
			cameraFovRadians: Math.PI / 3,
			cameraHeadingRadians: 0,
			presentedEntities: () => [],
			presentedEntityRevision: 0,
			source: null,
		};
	}

	function readDiagnostics(): ClientPresentationDiagnostics | null {
		return null;
	}

	function readFrameRates(): FrameRates {
		return { capped: 60, uncapped: 144 };
	}
</script>

<ClientWorldView
	cameraController={null}
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
	{jumpStatus}
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
