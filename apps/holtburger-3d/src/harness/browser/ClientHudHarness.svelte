<script lang="ts">
	import { onMount } from "svelte";
	import type { FrameRates } from "../../app/frame-rate-sampler";
	import ClientWorldView from "../../client/ClientWorldView.svelte";
	import type {
		ClientChatErrorMessage,
		ClientChatLine,
	} from "../../client/client-chat-policy";
	import type { ClientChatMessage } from "../../client/client-host-contract";
	import type { MapPanelFrame } from "../../app/map-panel-frame";
	import { MAP_AUTOMATIC_REANCHOR_DISTANCE_METERS } from "../../lib/game/map/map-appearance";
	import type { ClientPresentationDiagnostics } from "../../client/client-presentation-session";
	import type { ClientToast } from "../../client/client-toast-center";

	interface ClientHudHarnessRectangle {
		readonly height: number;
		readonly left: number;
		readonly top: number;
		readonly width: number;
	}

	interface ClientHudHarnessState {
		readonly diagnosticsCloseDisabled: boolean | null;
		readonly jumpActionDisabled: boolean | null;
		readonly mode: "runtime" | "layout";
		/** Coordinates currently displayed beneath the map. */
		readonly mapCoordinates: string;
		/** Whether the subject-attached camera cone is currently rendered. */
		readonly mapConeVisible: boolean;
		/** Whether detached-map chrome is currently available. */
		readonly mapResetVisible: boolean;
		readonly moveHandles: Readonly<Record<string, ClientHudHarnessRectangle>>;
		readonly preciseJumpEnterCount: number;
		readonly surfaces: Readonly<Record<string, ClientHudHarnessRectangle>>;
		readonly toast: {
			readonly preview: boolean;
			readonly role: string | null;
			readonly text: string;
		} | null;
		readonly viewport: { readonly height: number; readonly width: number };
	}

	interface ClientHudHarnessApi {
		readonly capture: () => ClientHudHarnessState;
		readonly dragSurface: (
			label: string,
			deltaX: number,
			deltaY: number,
		) => void;
		/** Move the imperative subject fixture beyond the production automatic-reset threshold. */
		readonly moveMapSubjectPastAutomaticReanchor: () => void;
		/** Activate the map's visible reset control. */
		readonly resetMap: () => void;
		readonly setRuntimeTransients: (visible: boolean) => void;
		readonly toggleMode: () => void;
	}

	const jumpFixture = new URLSearchParams(window.location.search).get("jump");
	let jumpChargeActive = $state(
		jumpFixture === "charging" || jumpFixture === "full",
	);
	const jumpExtent = jumpFixture === "full" ? 1 : 0.45;
	const toastFixture = new URLSearchParams(window.location.search).get("toast");
	let toast = $state<ClientToast | null>(
		toastFixture === "precise"
			? { id: 1, message: "Precise jump enabled", tone: "status" }
			: toastFixture === "rejected"
				? {
						id: 1,
						message: "You need stable ground to jump.",
						tone: "warning",
					}
				: null,
	);
	let preciseJumpEnterCount = 0;
	/** Imperative fixture position, matching the production map frame's presentation-rate source. */
	let mapSubjectWorldX = 100;
	const mapSubjectWorldZ = -200;

	const messages: readonly ClientChatLine[] = [
		line(1, {
			kind: "system",
			message:
				"Welcome to the Holtburger client HUD harness.\nEmbedded chat line breaks remain visible.",
		}),
		line(2, {
			kind: "speech",
			sender: "Ulgrim the Unpleasant",
			speakerKind: "non-player",
			message: "Duis aute irure dolor in reprehenderit.",
		}),
		line(3, {
			kind: "channel",
			channel: "general",
			sender: "Taylor",
			speakerKind: "player",
			message: "Excepteur sint occaecat cupidatat non proident.",
		}),
		line(4, {
			kind: "emote",
			sender: "Sam",
			speakerKind: "player",
			message: "salutes smartly",
		}),
		line(5, {
			kind: "tell",
			sender: "Jordan",
			speakerKind: "player",
			message: "Consectetur adipiscing elit, sed do eiusmod.",
		}),
		line(6, { kind: "error", message: "Example presentation failure." }),
		line(7, {
			kind: "combat",
			message: "You hit a Drudge for 37 slashing damage. Critical hit.",
			emphasized: true,
		}),
	];

	function line(
		id: number,
		message: ClientChatMessage | ClientChatErrorMessage,
	): ClientChatLine {
		return {
			...message,
			id,
			receivedAt: new Date(2026, 7, 27, 9, id),
		};
	}

	function readMapPanelFrame(): MapPanelFrame {
		return {
			cameraFovRadians: Math.PI / 3,
			cameraHeadingRadians: 0,
			presentedEntities: () => [],
			source: null,
			subject: {
				anchor: {
					headingRadians: 0,
					residency: null,
					worldX: mapSubjectWorldX,
					worldY: 20,
					worldZ: mapSubjectWorldZ,
				},
				guid: 1,
				kind: "controlled-entity",
			},
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

	function clientWorld(): HTMLElement {
		const world = document.querySelector<HTMLElement>(".client-world");
		if (world === null)
			throw new Error("Client HUD harness world is unavailable.");
		return world;
	}

	function surface(label: string): HTMLElement {
		const candidate = Array.from(
			clientWorld().querySelectorAll<HTMLElement>(
				":scope > section[aria-label]",
			),
		).find((element) => element.getAttribute("aria-label") === label);
		if (candidate === undefined)
			throw new Error(`Client HUD surface is unavailable: ${label}.`);
		return candidate;
	}

	function rectangle(element: HTMLElement): ClientHudHarnessRectangle {
		const bounds = element.getBoundingClientRect();
		return {
			height: bounds.height,
			left: bounds.left,
			top: bounds.top,
			width: bounds.width,
		};
	}

	function capture(): ClientHudHarnessState {
		const lock = document.querySelector<HTMLButtonElement>(".client-ui-lock");
		if (lock === null)
			throw new Error("Client HUD harness layout control is unavailable.");
		const surfaces = Object.fromEntries(
			Array.from(
				clientWorld().querySelectorAll<HTMLElement>(
					":scope > section[aria-label]",
				),
			).map((element) => [
				element.getAttribute("aria-label") ?? "",
				rectangle(element),
			]),
		);
		const moveHandles = Object.fromEntries(
			Object.keys(surfaces).flatMap((label) => {
				const handle = surface(label).querySelector<HTMLElement>(
					".hud-panel-move, .map-panel-move, .hud-window-titlebar",
				);
				return handle === null ? [] : [[label, rectangle(handle)]];
			}),
		);
		const toastElement = document.querySelector<HTMLElement>(".client-toast");
		const jumpAction =
			document.querySelector<HTMLButtonElement>(".jump-precise");
		const diagnosticsClose = document.querySelector<HTMLButtonElement>(
			'.hud-window-close[aria-label="Close Client diagnostics"]',
		);
		return {
			diagnosticsCloseDisabled: diagnosticsClose?.disabled ?? null,
			jumpActionDisabled: jumpAction?.disabled ?? null,
			mode: lock.getAttribute("aria-pressed") === "true" ? "layout" : "runtime",
			mapCoordinates:
				document.querySelector<HTMLElement>(".map-panel-coordinates")
					?.textContent ?? "",
			mapConeVisible:
				document.querySelector<SVGPathElement>(".map-panel-cone")?.style
					.display !== "none",
			mapResetVisible: document.querySelector(".map-panel-reset") !== null,
			moveHandles,
			preciseJumpEnterCount,
			surfaces,
			toast:
				toastElement === null
					? null
					: {
							preview: toastElement.classList.contains("client-toast-preview"),
							role: toastElement.getAttribute("role"),
							text: toastElement.textContent?.trim() ?? "",
						},
			viewport: {
				height: clientWorld().clientHeight,
				width: clientWorld().clientWidth,
			},
		};
	}

	function toggleMode(): void {
		const lock = document.querySelector<HTMLButtonElement>(".client-ui-lock");
		if (lock === null)
			throw new Error("Client HUD harness layout control is unavailable.");
		lock.click();
	}

	function setRuntimeTransients(visible: boolean): void {
		jumpChargeActive = visible;
		toast = visible
			? { id: 2, message: "Runtime notification", tone: "status" }
			: null;
	}

	function dragSurface(label: string, deltaX: number, deltaY: number): void {
		const target = surface(label);
		const handle = target.querySelector<HTMLElement>(
			".hud-panel-move, .map-panel-move, .hud-window-titlebar",
		);
		if (handle === null)
			throw new Error(`Client HUD surface has no move handle: ${label}.`);
		const bounds = handle.getBoundingClientRect();
		const clientX = bounds.left + bounds.width / 2;
		const clientY = bounds.top + bounds.height / 2;
		const pointerId = 37;
		handle.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				buttons: 1,
				clientX,
				clientY,
				pointerId,
			}),
		);
		window.dispatchEvent(
			new PointerEvent("pointermove", {
				bubbles: true,
				buttons: 1,
				clientX: clientX + deltaX,
				clientY: clientY + deltaY,
				pointerId,
			}),
		);
		window.dispatchEvent(
			new PointerEvent("pointerup", {
				bubbles: true,
				button: 0,
				clientX: clientX + deltaX,
				clientY: clientY + deltaY,
				pointerId,
			}),
		);
	}

	function resetMap(): void {
		const reset = document.querySelector<HTMLButtonElement>(".map-panel-reset");
		if (reset === null) throw new Error("Client HUD map reset is unavailable.");
		reset.click();
	}

	function moveMapSubjectPastAutomaticReanchor(): void {
		mapSubjectWorldX += MAP_AUTOMATIC_REANCHOR_DISTANCE_METERS + 1;
	}

	onMount(() => {
		const harnessGlobal = globalThis as typeof globalThis & {
			__HOLTBURGER_3D_CLIENT_HUD_HARNESS__: ClientHudHarnessApi | undefined;
		};
		harnessGlobal.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__ = {
			capture,
			dragSurface,
			moveMapSubjectPastAutomaticReanchor,
			resetMap,
			setRuntimeTransients,
			toggleMode,
		};
		return () => {
			harnessGlobal.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__ = undefined;
		};
	});
</script>

<ClientWorldView
	cameraController={null}
	preciseJumpActive={false}
	onPreciseJumpAim={() => undefined}
	onPreciseJumpActivate={() => undefined}
	onPreciseJumpEnter={() => {
		preciseJumpEnterCount += 1;
	}}
	debugEnabled={true}
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
