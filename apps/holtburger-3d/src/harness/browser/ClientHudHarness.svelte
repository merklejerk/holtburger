<script lang="ts">
	import { onMount } from "svelte";
	import type { FrameRates } from "../../app/frame-rate-sampler";
	import ClientWorldView from "../../client/ClientWorldView.svelte";
	import type {
		ClientChatErrorMessage,
		ClientChatLine,
	} from "../../client/client-chat-policy";
	import type { ClientChatMessage } from "../../client/client-host-contract";
	import type { MinimapFrame } from "../../app/minimap-frame";
	import type { MapEntity } from "../../lib/game/map/map-blips";
	import { Mat4 } from "../../lib/game/math/types";
	import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
	import type { ScenePlacement } from "../../lib/game/scene";
	import {
		MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
		MINIMAP_BREADCRUMB_POLICY,
	} from "../../app/minimap-tuning";
	import type { ClientPresentationDiagnostics } from "../../client/client-presentation-session";
	import type { ClientToast } from "../../client/client-toast-center";
	import type { ClientTargetIndicatorFrame } from "../../client/client-target-indicator";

	interface ClientHudHarnessRectangle {
		readonly height: number;
		readonly left: number;
		readonly top: number;
		readonly width: number;
	}

	interface ClientHudHarnessState {
		/** Bounds used to drive the actual game-canvas pointer handlers. */
		readonly gameCanvas: ClientHudHarnessRectangle;
		/** Browser-resolved cursor for the game canvas. */
		readonly gameCanvasCursor: string;
		readonly hoveredGuid: number | null;
		readonly jumpActionDisabled: boolean | null;
		readonly mode: "runtime" | "layout";
		/** Coordinates currently displayed beneath the map. */
		readonly minimapCoordinates: string;
		/** Whether the subject-attached camera cone is currently rendered. */
		readonly minimapConeVisible: boolean;
		/** Whether detached-map chrome is currently available. */
		readonly minimapResetVisible: boolean;
		/** Non-transparent backing pixels in the Canvas2D breadcrumb/blip overlay. */
		readonly minimapOverlayInkPixels: number;
		/** Last overlay arc count; this fixture's null map source leaves breadcrumbs as its only arcs. */
		readonly minimapOverlayArcCalls: number;
		/** Bounds used to drive the actual minimap overlay pointer handlers. */
		readonly minimapOverlayCanvas: ClientHudHarnessRectangle;
		readonly moveHandles: Readonly<Record<string, ClientHudHarnessRectangle>>;
		/** Camera deltas emitted by completed drag classification. */
		readonly orbitDeltas: readonly { readonly x: number; readonly y: number }[];
		/** Left-clicks consumed by precise-jump mode. */
		readonly preciseJumpActivationCount: number;
		readonly preciseJumpEnterCount: number;
		/** Selection changes emitted by either viewport or minimap input. */
		readonly selectionEvents: readonly (number | null)[];
		/** Cadence ticks delivered independently of pointer presence. */
		readonly selectionMaintenanceCount: number;
		/** Identity currently read back by the minimap frame. */
		readonly selectedGuid: number | null;
		readonly selectionAnnouncement: string;
		readonly selectedEntityHud: null | {
			readonly actionsDisabled: boolean;
			readonly name: string;
		};
		readonly targetIndicator: null | {
			readonly fill: string | null;
			readonly filter: string;
			readonly rectangle: ClientHudHarnessRectangle;
		};
		readonly surfaces: Readonly<Record<string, ClientHudHarnessRectangle>>;
		readonly toast: {
			readonly preview: boolean;
			readonly role: string | null;
			readonly text: string;
		} | null;
		readonly viewport: { readonly height: number; readonly width: number };
		/** Completed viewport click locations sent to entity acquisition. */
		readonly viewportSelectionPoints: readonly {
			readonly x: number;
			readonly y: number;
		}[];
		/** Bounded-cadence viewport hover samples received by the component boundary. */
		readonly viewportHoverPoints: readonly {
			readonly x: number;
			readonly y: number;
		}[];
	}

	interface ClientHudHarnessApi {
		readonly capture: () => ClientHudHarnessState;
		readonly dragSurface: (
			label: string,
			deltaX: number,
			deltaY: number,
		) => void;
		/** Move the imperative subject fixture beyond the production automatic-reset threshold. */
		readonly moveMinimapSubjectPastAutomaticReanchor: () => void;
		/** Move by a fraction of the current environment's production breadcrumb spacing. */
		readonly moveMinimapSubjectByBreadcrumbSpacing: (fraction: number) => void;
		/** Move beyond the production continuous-step threshold in one observation. */
		readonly teleportMinimapSubject: () => void;
		/** Select controlled identity and environment; null identity selects a free camera. */
		readonly setMinimapSubject: (guid: number | null, indoor: boolean) => void;
		/** Activate the map's visible reset control. */
		readonly resetMinimap: () => void;
		/** Restore deterministic interaction inputs and clear recorded output. */
		readonly resetSelectionFixture: () => void;
		/** Toggle the lifecycle-owned camera capability supplied to the HUD. */
		readonly setCameraEnabled: (enabled: boolean) => void;
		/** Choose whether subsequent viewport hover samples resolve an entity. */
		readonly setHoverHitEnabled: (enabled: boolean) => void;
		/** Toggle precise-jump pointer ownership. */
		readonly setPreciseJumpActive: (active: boolean) => void;
		/** Replace the frame-hot target projection consumed by the real indicator component. */
		readonly setTargetIndicatorFrame: (
			frame: ClientTargetIndicatorFrame | null,
		) => void;
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
	let preciseJumpActivationCount = 0;
	let selectionMaintenanceCount = 0;
	let preciseJumpActive = $state(false);
	let cameraEnabled = $state(true);
	let selectedGuid = $state<number | null>(null);
	let hoveredGuid = $state<number | null>(null);
	let hoverHitEnabled = true;
	let targetIndicatorFrame: ClientTargetIndicatorFrame | null = null;
	const orbitDeltas: { x: number; y: number }[] = [];
	const selectionEvents: (number | null)[] = [];
	const viewportSelectionPoints: { x: number; y: number }[] = [];
	const viewportHoverPoints: { x: number; y: number }[] = [];
	const cameraController = {
		orbit(deltaX: number, deltaY: number): void {
			orbitDeltas.push({ x: deltaX, y: deltaY });
		},
		zoom(): void {},
	};
	/** Imperative fixture position, matching the production map frame's presentation-rate source. */
	let minimapSubjectWorldX = 100;
	const minimapSubjectWorldY = 20;
	const minimapSubjectWorldZ = -200;
	let minimapSubjectGuid: number | null = 1;
	let minimapSubjectIndoor = false;
	let readMinimapOverlayArcCalls = (): number => 0;

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

	function readMinimapFrame(): MinimapFrame {
		return {
			cameraFovRadians: Math.PI / 3,
			cameraHeadingRadians: 0,
			presentedEntities: () =>
				minimapSubjectGuid === null ? [] : [minimapEntity()],
			selectedGuid,
			source: null,
			subject: {
				anchor: {
					headingRadians: 0,
					residency: minimapSubjectIndoor
						? {
								envCellId: "0x01020100",
								landblockId: "0x0102ffff",
							}
						: null,
					worldX: minimapSubjectWorldX,
					worldY: minimapSubjectWorldY,
					worldZ: minimapSubjectWorldZ,
				},
				...(minimapSubjectGuid === null
					? { kind: "free-camera" as const }
					: { guid: minimapSubjectGuid, kind: "controlled-entity" as const }),
			},
		};
	}

	/** One visible marker centred on the fixture subject. */
	function minimapEntity(): MapEntity {
		const transform = Mat4.identity();
		// Landblock (0, 1) begins at world (0, -192), placing this at (100, -200).
		transform.m41 = 100;
		transform.m43 = -8;
		return {
			placement: {
				envCellId: null,
				landblockId: "0x0001ffff",
				localTransform: transform,
			} as ScenePlacement,
			view: {
				identity: { guid: 7, wcid: 42 },
				display: { name: "Selection Fixture", level: null },
				presentation: {
					entityClass: "mob",
					radar: {
						behavior: "ShowAlways",
						category: "mob",
					},
				},
				physics: { hidden: false },
			} as unknown as DynamicEntityView,
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
				entitySelection: {
					activeMaskBytes: 0,
					allocatedTargetGenerationCount: 0,
					compositeDrawCount: 0,
					disposedTargetGenerationCount: 0,
					maskDrawCount: 0,
					selectedSphereProxyCount: 0,
					selectedPartCount: 0,
					selectedTriangleCount: 0,
					skippedReason: "no-target",
				},
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
					".hud-panel-move, .minimap-move, .hud-window-titlebar",
				);
				return handle === null ? [] : [[label, rectangle(handle)]];
			}),
		);
		const toastElement = document.querySelector<HTMLElement>(".client-toast");
		const jumpAction =
			document.querySelector<HTMLButtonElement>(".jump-precise");
		const gameCanvas = document.querySelector<HTMLElement>(".client-canvas");
		const targetIndicator =
			document.querySelector<HTMLElement>(".target-indicator");
		const targetIndicatorGlass = targetIndicator?.querySelector<SVGPathElement>(
			".target-indicator__glass",
		);
		const selectedEntityHud =
			document.querySelector<HTMLElement>(".selected-entity");
		const selectedEntityActions = selectedEntityHud?.querySelectorAll("button");
		const minimapOverlayCanvas = document.querySelector<HTMLElement>(
			".minimap-overlay-canvas",
		);
		if (gameCanvas === null || minimapOverlayCanvas === null) {
			throw new Error("Client HUD interaction canvases are unavailable.");
		}
		return {
			gameCanvas: rectangle(gameCanvas),
			gameCanvasCursor: getComputedStyle(gameCanvas).cursor,
			hoveredGuid,
			jumpActionDisabled: jumpAction?.disabled ?? null,
			mode: lock.getAttribute("aria-pressed") === "true" ? "layout" : "runtime",
			minimapCoordinates:
				document.querySelector<HTMLElement>(".minimap-coordinates")
					?.textContent ?? "",
			minimapConeVisible:
				document.querySelector<SVGPathElement>(".minimap-cone")?.style
					.display !== "none",
			minimapResetVisible: document.querySelector(".minimap-reset") !== null,
			minimapOverlayArcCalls: readMinimapOverlayArcCalls(),
			minimapOverlayInkPixels: countMinimapOverlayInkPixels(),
			minimapOverlayCanvas: rectangle(minimapOverlayCanvas),
			moveHandles,
			orbitDeltas: orbitDeltas.map((delta) => ({ ...delta })),
			preciseJumpActivationCount,
			preciseJumpEnterCount,
			selectedGuid,
			selectionAnnouncement:
				document
					.querySelector<HTMLElement>(".selection-announcement")
					?.textContent?.trim() ?? "",
			selectionEvents: [...selectionEvents],
			selectionMaintenanceCount,
			selectedEntityHud:
				selectedEntityHud === null
					? null
					: {
							actionsDisabled:
								selectedEntityActions?.length === 2 &&
								Array.from(selectedEntityActions).every(
									(action) => action.disabled,
								),
							name:
								selectedEntityHud
									.querySelector("strong")
									?.textContent?.trim() ?? "",
						},
			surfaces,
			toast:
				toastElement === null
					? null
					: {
							preview: toastElement.classList.contains("client-toast-preview"),
							role: toastElement.getAttribute("role"),
							text: toastElement.textContent?.trim() ?? "",
						},
			targetIndicator:
				targetIndicator === null || targetIndicator.hidden
					? null
					: {
							fill:
								targetIndicatorGlass === null ||
								targetIndicatorGlass === undefined
									? null
									: getComputedStyle(targetIndicatorGlass).fill,
							filter: getComputedStyle(targetIndicator).filter,
							rectangle: rectangle(targetIndicator),
						},
			viewport: {
				height: clientWorld().clientHeight,
				width: clientWorld().clientWidth,
			},
			viewportSelectionPoints: viewportSelectionPoints.map((point) => ({
				...point,
			})),
			viewportHoverPoints: viewportHoverPoints.map((point) => ({ ...point })),
		};
	}

	function countMinimapOverlayInkPixels(): number {
		const canvas = document.querySelector<HTMLCanvasElement>(
			".minimap-overlay-canvas",
		);
		const context = canvas?.getContext("2d");
		if (!canvas || !context) return 0;
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
		let count = 0;
		for (let alpha = 3; alpha < pixels.length; alpha += 4) {
			if (pixels[alpha] !== 0) count += 1;
		}
		return count;
	}

	/** Observe final Canvas operations without adding diagnostic state to production components. */
	function observeMinimapOverlayArcCalls(): {
		readonly read: () => number;
		readonly restore: () => void;
	} {
		const canvas = document.querySelector<HTMLCanvasElement>(
			".minimap-overlay-canvas",
		);
		const context = canvas?.getContext("2d");
		if (!canvas || !context) {
			throw new Error("Client HUD minimap overlay is unavailable.");
		}
		let arcCalls = 0;
		const originalArc = context.arc;
		const originalClearRect = context.clearRect;
		context.arc = (
			x: number,
			y: number,
			radius: number,
			startAngle: number,
			endAngle: number,
			counterclockwise?: boolean,
		): void => {
			arcCalls += 1;
			originalArc.call(
				context,
				x,
				y,
				radius,
				startAngle,
				endAngle,
				counterclockwise,
			);
		};
		context.clearRect = (
			x: number,
			y: number,
			width: number,
			height: number,
		) => {
			arcCalls = 0;
			originalClearRect.call(context, x, y, width, height);
		};
		return {
			read: () => arcCalls,
			restore: () => {
				context.arc = originalArc;
				context.clearRect = originalClearRect;
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
			".hud-panel-move, .minimap-move, .hud-window-titlebar",
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

	function resetMinimap(): void {
		const reset = document.querySelector<HTMLButtonElement>(".minimap-reset");
		if (reset === null)
			throw new Error("Client HUD minimap reset is unavailable.");
		reset.click();
	}

	function moveMinimapSubjectPastAutomaticReanchor(): void {
		minimapSubjectWorldX += MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS + 1;
	}

	function moveMinimapSubjectByBreadcrumbSpacing(fraction: number): void {
		const environment = minimapSubjectIndoor ? "indoor" : "outdoor";
		minimapSubjectWorldX +=
			MINIMAP_BREADCRUMB_POLICY.spacingMeters[environment] * fraction;
	}

	function teleportMinimapSubject(): void {
		minimapSubjectWorldX +=
			MINIMAP_BREADCRUMB_POLICY.maximumContinuousStepMeters + 1;
	}

	function setMinimapSubject(guid: number | null, indoor: boolean): void {
		minimapSubjectGuid = guid;
		minimapSubjectIndoor = indoor;
	}

	function setCameraEnabled(enabled: boolean): void {
		cameraEnabled = enabled;
	}

	function setPreciseJumpActive(active: boolean): void {
		preciseJumpActive = active;
	}

	function setTargetIndicatorFrame(
		frame: ClientTargetIndicatorFrame | null,
	): void {
		targetIndicatorFrame = frame;
	}

	function selectEntity(guid: number | null): void {
		selectedGuid = guid;
		selectionEvents.push(guid);
	}

	function setHoverHitEnabled(enabled: boolean): void {
		hoverHitEnabled = enabled;
	}

	function resetSelectionFixture(): void {
		minimapSubjectWorldX = 100;
		minimapSubjectGuid = 1;
		minimapSubjectIndoor = false;
		selectedGuid = null;
		hoveredGuid = null;
		hoverHitEnabled = true;
		targetIndicatorFrame = null;
		cameraEnabled = true;
		preciseJumpActive = false;
		preciseJumpActivationCount = 0;
		orbitDeltas.length = 0;
		selectionEvents.length = 0;
		viewportSelectionPoints.length = 0;
		viewportHoverPoints.length = 0;
	}

	onMount(() => {
		const overlayObservation = observeMinimapOverlayArcCalls();
		readMinimapOverlayArcCalls = overlayObservation.read;
		const harnessGlobal = globalThis as typeof globalThis & {
			__HOLTBURGER_3D_CLIENT_HUD_HARNESS__: ClientHudHarnessApi | undefined;
		};
		harnessGlobal.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__ = {
			capture,
			dragSurface,
			moveMinimapSubjectByBreadcrumbSpacing,
			moveMinimapSubjectPastAutomaticReanchor,
			resetMinimap,
			resetSelectionFixture,
			setCameraEnabled,
			setHoverHitEnabled,
			setMinimapSubject,
			setPreciseJumpActive,
			setTargetIndicatorFrame,
			setRuntimeTransients,
			teleportMinimapSubject,
			toggleMode,
		};
		return () => {
			overlayObservation.restore();
			readMinimapOverlayArcCalls = () => 0;
			harnessGlobal.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__ = undefined;
		};
	});
</script>

<ClientWorldView
	cameraController={cameraEnabled ? cameraController : null}
	{preciseJumpActive}
	onPreciseJumpAim={() => undefined}
	onPreciseJumpActivate={() => {
		preciseJumpActivationCount += 1;
	}}
	onPreciseJumpEnter={() => {
		preciseJumpEnterCount += 1;
	}}
	onViewportSelect={(x, y) => {
		viewportSelectionPoints.push({ x, y });
		selectEntity(7);
	}}
	onViewportHover={(x, y) => {
		viewportHoverPoints.push({ x, y });
		hoveredGuid = hoverHitEnabled ? 7 : null;
	}}
	onMaintainEntitySelection={() => {
		selectionMaintenanceCount += 1;
	}}
	onSelectEntity={selectEntity}
	debugEnabled={true}
	{readMinimapFrame}
	{readDiagnostics}
	{readFrameRates}
	readTargetIndicatorFrame={() => targetIndicatorFrame}
	readSelectedEntityName={() => (selectedGuid === null ? null : "Drudge")}
	selectedEntityGuid={selectedGuid}
	hoveredEntityGuid={hoveredGuid}
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
