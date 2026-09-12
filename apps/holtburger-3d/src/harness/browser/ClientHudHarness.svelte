<script lang="ts">
	import { installKeyboardPolicyFixture } from "./keyboard-policy-fixture";
	import { clientSelectedEntity } from "../../client/client-selected-entity";
	import { probeClientInventory } from "./client-inventory-probe";
	import type { DynamicEntityMapBlipCategory } from "../../lib/game/map/map-blip-category";
	import { mapBlipFillStyle } from "../../lib/game/map/map-appearance";
	import { probeBoomCameraCorrection } from "./boom-camera-probe";
	import { probeClientAudio } from "./client-audio-probe";
	import ClientMessageDialog from "../../client/ClientMessageDialog.svelte";
	import {
		ClientDialogs,
		type ClientDialogPresentation,
	} from "../../client/client-dialogs";
	import { provideAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import { probeBrowserInput } from "./input-browser-probe";
	import { onMount, tick } from "svelte";
	import { ClientEntityInteractions } from "../../client/client-entity-interactions";
	import { ClientEntitySelection } from "../../client/client-entity-selection";
	import { ClientLifecycleSession } from "../../client/client-lifecycle-session";
	import { CLIENT_TUNING } from "../../client/client-tuning";
	import { defaultUiThemeUrl } from "../../app/ui-theme";
	import { uiThemes } from "../../app/mount";
	import opaqueUrl from "./themes/opaque.css?url&no-inline";
	import type { FrameRates } from "../../app/frame-rate-sampler";
	import ClientCharacterSelect from "../../client/ClientCharacterSelect.svelte";
	import type { ClientLifecycleUiState } from "../../client/client-lifecycle-state";
	import { ClientInventoryState } from "../../client/client-inventory-state";
	import { browserItemIconRepository } from "../../app/item-icon-repository";
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
	import {
		ClientToastCenter,
		CLIENT_TOAST_DURATION_MS,
		type ClientToast,
	} from "../../client/client-toast-center";
	import type { ClientTargetIndicatorFrame } from "../../client/client-target-indicator";
	const { viewport: inputGate, keyboard } = provideAppInputPolicy();

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
			readonly interactDisabled: boolean;
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

	/** Exercise selection replacement and clearing through the mounted diagnostic panel. */
	async function probeSelectedDiagnostics(): Promise<void> {
		const debug = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Debug"]',
		);
		if (debug === null) throw new Error("Debug shortcut is absent.");
		const wasOpen = debug.getAttribute("aria-pressed") === "true";
		const previousGuid = selection.selectedGuid();
		if (!wasOpen) debug.click();
		const sample = () =>
			new Promise<void>((resolve) => window.setTimeout(resolve, 300));
		try {
			selection.select(7);
			await sample();
			const panel = document.querySelector(
				'section[aria-label="Selected entity details"]',
			);
			const snapshot = panel?.querySelector<HTMLTextAreaElement>("textarea");
			if (
				!panel?.textContent?.includes("Drudge") ||
				!panel.textContent.includes("42 (0x0000002a)") ||
				snapshot === null ||
				snapshot === undefined ||
				!snapshot.value.includes('"wcid": 42')
			) {
				throw new Error(
					"Selected entity diagnostics did not display identity and JSON.",
				);
			}
			const toggle = Array.from(document.querySelectorAll("label.toggle-field"))
				.find((label) => label.textContent?.includes("Unrestricted use"))
				?.querySelector<HTMLInputElement>('input[type="checkbox"]');
			const useButton = document.querySelector<HTMLButtonElement>(
				'button[aria-label="Interact"]',
			);
			if (!toggle || !useButton || toggle.checked)
				throw new Error("Unrestricted use must start disabled.");
			for (const expected of [true, false]) {
				toggle.click();
				await tick();
				useButton.click();
				await tick();
				const command = interactionCommands.at(-1);
				if (
					command?.command !== "use_client_entity" ||
					command.args?.unrestricted !== expected
				) {
					throw new Error("Debug use policy did not reach the use request.");
				}
			}
			selection.select(8);
			await sample();
			if (
				!panel.textContent?.includes("0x00000008") ||
				!panel.textContent.includes("No scene presentation for this entity.") ||
				!panel.querySelector("textarea")?.value.includes('"facts"')
			) {
				throw new Error(
					"Unavailable selection retained stale diagnostic details.",
				);
			}
			selection.select(null);
			await sample();
			if (panel.querySelector("dl, textarea") !== null) {
				throw new Error("Cleared selection retained diagnostic details.");
			}
		} finally {
			selection.select(previousGuid);
			if (!wasOpen) debug.click();
		}
	}

	/** Cold character-selection fixture exercises production controls without a live server. */
	let previewCharacters = $state(false);
	/** Session-local diagnostic use policy exercised through the production panel. */
	let unrestrictedUse = $state(false);
	let entryPending = $state(false);
	let characterState = $state<
		Extract<ClientLifecycleUiState, { kind: "character-selection" }>
	>({
		kind: "character-selection",
		selectedGuid: null,
		characters: [
			{ guid: 1, name: "Wayfarer", slot: 0, deleteTime: 0 },
			{ guid: 2, name: "Lantern Keeper", slot: 1, deleteTime: 0 },
		],
	});
	/** Test a live theme change against existing DOM and layout ownership. */
	async function probeThemeApplication() {
		const canvas = document.querySelector(".client-canvas");
		const before = capture().surfaces;
		const chat = document.querySelector(".chat-buffer");
		if (chat === null)
			throw new Error("Theme probe requires the chat backing.");
		const expectedBackdrop = getComputedStyle(document.documentElement)
			.getPropertyValue("--ui-backdrop-filter")
			.trim();
		if (getComputedStyle(chat).backdropFilter !== expectedBackdrop)
			throw new Error("Client chat did not consume the HUD backdrop.");

		try {
			await uiThemes.replace(defaultUiThemeUrl, opaqueUrl);
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
			const panel = document.querySelector(".hud-window");
			if (panel === null)
				throw new Error("Theme probe requires an open diagnostic window.");
			const stable =
				canvas === document.querySelector(".client-canvas") &&
				JSON.stringify(before) === JSON.stringify(capture().surfaces);
			const opaque =
				getComputedStyle(panel).backdropFilter === "none" &&
				getComputedStyle(chat).backdropFilter === "none";
			if (!stable || !opaque)
				throw new Error(
					"Client theme application changed layout/identity or retained filtering.",
				);
			return {
				identityAndLayoutPreserved: stable,
				opaqueOverride: opaque,
			};
		} finally {
			await uiThemes.replace(defaultUiThemeUrl, null);
		}
	}
	const probeInventory = () =>
		probeClientInventory({
			emit: emitInteractionEvent,
			selection,
			commands: interactionCommands,
			readSampleCount: () => inventorySampleCount,
			readPreparedIconCount: () => preparedIconCount,
			holdIconPreparation,
			failIcon: (base) => {
				iconFailures.add(base);
			},
			readViewportInput: () => ({
				clicks: viewportSelectionPoints.length,
				orbits: orbitDeltas.length,
				zooms: zoomDeltas.length,
			}),
		});

	let keyboardFixture: ReturnType<typeof installKeyboardPolicyFixture> | null =
		null;
	interface ClientHudHarnessApi {
		/** Install a real DOM fixture for CDP keyboard and pointer events. */
		readonly beginKeyboardProbe: () => void;
		/** Read the currently installed keyboard fixture. */
		readonly keyboardProbe: () => ReturnType<
			typeof installKeyboardPolicyFixture
		>;
		/** Verify live inventory, shared placement, geometry, selection, and recovery. */
		readonly probeInventory: typeof probeInventory;
		/** Verify style updates without replacing world presentation or HUD placement. */
		readonly probeThemeApplication: typeof probeThemeApplication;
		/** Verify sampled selected-entity identity and snapshot disclosure. */
		readonly probeSelectedDiagnostics: typeof probeSelectedDiagnostics;
		readonly probeInteractableMarker: typeof probeInteractableMarker;
		readonly measureDoorBar: typeof measureDoorBar;
		/** Exercise health presentation and use dispatch through production session owners. */
		readonly probeSelectedInteractions: typeof probeSelectedInteractions;
		/** Show production character selection for the theme probe. */
		readonly previewCharacterSelection: () => void;
		/** Exercise overlapping modal/chat ownership while a viewport gesture is pending. */
		readonly probeViewportBlockers: () => void;
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
	/** Counts synthetic artwork preparation independently of inventory sampling. */
	let preparedIconCount = 0;
	let iconPreparationGate: Promise<void> | null = null;
	const iconFailures = new Set<number>();
	function holdIconPreparation(): () => void {
		if (iconPreparationGate !== null)
			throw new Error("Icon preparation is already held.");
		let release = () => {};
		iconPreparationGate = new Promise<void>((resolve) => {
			release = resolve;
		});
		return () => {
			iconPreparationGate = null;
			release();
		};
	}
	/** Counts persistent inventory pulls, including while its panel is hidden. */
	let inventorySampleCount = 0;
	let inventory = $state<ClientInventoryState | null>(null);
	function readInventoryEntities() {
		inventorySampleCount += 1;
		return interactionLifecycle.entities.read();
	}
	let preciseJumpActive = $state(false);
	let cameraEnabled = $state(true);
	let selectedGuid = $state<number | null>(null);
	const interactionHandlers = new Map<string, (payload: unknown) => void>();
	const interactionCommands: {
		command: string;
		args: Record<string, unknown> | undefined;
	}[] = [];
	/** Establish actual session facts for the mounted HUD and its interaction probes. */
	function emitInteractionBaseline(): void {
		emitInteractionEvent("client-current-state", {
			lifecycle: { kind: "in-world" },
			entityCollisionDisabled: false,
			localPlayerGuid: 1,
			serverTime: 10,
			worldGeneration: 1,
			worldName: "Fixture",
			playerName: "Wayfarer",
			vitals: [],
			characterMotion: null,
			activeConfirmation: null,
			dynamic: { hostTime: { seconds: 10 }, entities: [] },
			entities: {
				entities: [1, 7, 8].map((guid) => ({
					guid,
					description: {
						kind: "known",
						name: guid === 1 ? "Wayfarer" : "Drudge",
						healthQuery: "eligible",
						itemType: 0,
						objectFlags: 0,
						wcid: guid === 7 ? 42 : null,
						weenieType: null,
						pyrealBalance: null,
						stackCount: null,
						structure: { current: null, max: null },
						icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
					},
					location: { kind: "none" },
					ownedByPlayer: false,
					scenePlacement: "available",
					storage:
						guid === 1
							? {
									kind: "container",
									roster: "announced",
									packCapacity: 7,
									itemCapacity: 24,
								}
							: { kind: "not-established" },
				})),
			},
		});
	}

	const interactionLifecycle = new ClientLifecycleSession({
		listen: async (event, handler) => {
			interactionHandlers.set(event, handler);
			return () => {
				interactionHandlers.delete(event);
			};
		},
		invoke: async (command, args) => {
			interactionCommands.push({ command, args });
			if (command === "request_client_current_state") emitInteractionBaseline();
		},
	});
	const selection = new ClientEntitySelection({
		lifecycle: interactionLifecycle,
		presentation: () => null,
	});
	const interactions = new ClientEntityInteractions({
		selection,
		lifecycle: interactionLifecycle,
		onFailure: (error) => {
			throw error;
		},
	});
	const unsubscribeSelection = selection.subscribe((guid) => {
		selectedGuid = guid;
	});

	function emitInteractionEvent(event: string, payload: unknown): void {
		const handler = interactionHandlers.get(event);
		if (handler === undefined)
			throw new Error(`Missing interaction listener: ${event}`);
		handler(payload);
	}

	let dialogPresentation = $state<ClientDialogPresentation | null>(null);
	let dialogOwner: ClientDialogs | null = null;

	async function probeDialogs() {
		const owner = new ClientDialogs(interactionLifecycle);
		dialogOwner = owner;
		const unsubscribe = owner.subscribe((value) => {
			dialogPresentation = value;
		});
		const canvas = document.querySelector<HTMLCanvasElement>(".client-canvas");
		if (canvas === null)
			throw new Error("Dialog probe requires the viewport canvas.");
		keyboard.returnToGame();
		const previousFocus = document.activeElement;
		const startCommands = interactionCommands.length;
		const longMessage = Array.from(
			{ length: 120 },
			(_, index) => `Server notice line ${index + 1}`,
		).join("\n");
		try {
			emitInteractionEvent("client-lifecycle-changed", {
				kind: "character-selection",
				characters: [],
			});
			emitInteractionEvent("client-popup-string", { message: longMessage });
			await tick();
			const modal = document.querySelector<HTMLDialogElement>(
				".client-message-dialog",
			);
			if (
				modal === null ||
				!modal.open ||
				inputGate.allowed ||
				!modal.contains(document.activeElement)
			)
				throw new Error("Pre-world popup did not acquire modal focus/input.");
			if (
				modal.scrollHeight <= modal.clientHeight ||
				modal.getBoundingClientRect().height > window.innerHeight
			)
				throw new Error("Long popup is not scrollable within the viewport.");
			emitInteractionEvent("client-confirmation-updated", {
				confirmation: { requestId: "100", text: "Accept request A?" },
			});
			await tick();
			const accept = Array.from(modal.querySelectorAll("button")).find(
				(button) => button.textContent === "Accept",
			);
			if (accept === undefined)
				throw new Error("Confirmation did not take popup priority.");
			accept.click();
			await tick();
			if (!accept.disabled)
				throw new Error("Pending confirmation remained submittable.");
			await owner.respond("100", true);
			emitInteractionEvent("client-confirmation-updated", {
				confirmation: { requestId: "101", text: "Accept request B?" },
			});
			await owner.respond("100", false);
			await tick();
			modal.dispatchEvent(new Event("cancel", { cancelable: true }));
			await tick();
			const responses = interactionCommands
				.slice(startCommands)
				.filter((entry) => entry.command === "respond_to_client_confirmation");
			if (
				JSON.stringify(responses.map((entry) => entry.args)) !==
				JSON.stringify([
					{ request_id: "100", accepted: true },
					{ request_id: "101", accepted: false },
				])
			)
				throw new Error(
					"Confirmation responses lost identity or duplicated submission.",
				);
			emitInteractionEvent("client-confirmation-updated", {
				confirmation: null,
			});
			await tick();
			if (!modal.textContent?.includes("Server notice line 120"))
				throw new Error("Confirmation discarded the waiting popup.");
			modal.dispatchEvent(new Event("cancel", { cancelable: true }));
			await tick();
			if (
				!inputGate.allowed ||
				document.querySelector(".client-message-dialog") !== null ||
				document.activeElement !== previousFocus
			)
				throw new Error(
					`Popup dismissal did not release focus/input: allowed=${inputGate.allowed}, modal=${document.querySelector(".client-message-dialog") !== null}, focus=${document.activeElement?.tagName}, expected=${previousFocus?.tagName}.`,
				);
			emitInteractionEvent("client-popup-string", {
				message: "Pending at disconnect",
			});
			await tick();
			emitInteractionEvent("client-lifecycle-changed", {
				kind: "exiting",
				cause: "server-disconnect",
			});
			await tick();
			if (
				!inputGate.allowed ||
				document.querySelector(".client-message-dialog") !== null
			)
				throw new Error("Disconnect leaked dialog ownership.");
			return {
				preWorld: true,
				longTextScrollable: true,
				exactResponses: responses,
				focusRestored: true,
				disconnectCleared: true,
			};
		} finally {
			owner.destroy();
			unsubscribe();
			dialogOwner = null;
			emitInteractionBaseline();
			await tick();
		}
	}

	async function probeActionFeedback() {
		const previousToast = toast;
		const center = new ClientToastCenter({
			durationMs: CLIENT_TOAST_DURATION_MS,
			scheduler: {
				cancel: (handle) => window.clearTimeout(handle),
				schedule: (callback, delay) => window.setTimeout(callback, delay),
			},
		});
		const unsubscribeToast = center.subscribe((next) => {
			toast = next;
		});
		const unsubscribeFeedback = interactionLifecycle.subscribe((event) => {
			if (event.type === "action-feedback") center.publish(event.feedback);
			if (event.type === "transient-string")
				center.publish({ message: event.message, tone: "status" });
		});
		const notices = [
			"You're too busy!",
			"Use timed out waiting for the server.",
			"You can't open or close this Door that way",
		];
		try {
			for (const message of notices) {
				emitInteractionEvent("client-action-feedback", {
					message,
					tone: "warning",
				});
				await tick();
				const notice = Array.from(
					document.querySelectorAll(".client-toast"),
				).find((element) => element.textContent?.trim() === message);
				if (
					notice?.getAttribute("role") !== "alert" ||
					!notice.classList.contains("client-toast-warning")
				) {
					throw new Error("Action feedback did not reach the warning toast.");
				}
			}
			emitInteractionEvent("client-transient-string", {
				message: "The door is locked!",
			});
			await tick();
			const transient = Array.from(
				document.querySelectorAll(".client-toast"),
			).find(
				(element) => element.textContent?.trim() === "The door is locked!",
			);
			if (transient?.getAttribute("role") !== "status")
				throw new Error("Server transient did not reach the notice surface.");
			return {
				messages: notices,
				role: "alert",
				transient: "The door is locked!",
			};
		} finally {
			unsubscribeFeedback();
			unsubscribeToast();
			center.destroy();
			toast = previousToast;
			await tick();
		}
	}

	async function probeSelectedInteractions() {
		const target = selection.selectedGuid();
		if (target === null)
			throw new Error("Interaction probe requires a selected entity.");
		const meter = document.querySelector(
			'[aria-label="Selected entity health"]',
		);
		const button = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Interact"]',
		);
		if (meter === null || button === null)
			throw new Error("Selected entity controls are missing.");
		const unknown = meter.getAttribute("aria-valuetext");
		emitInteractionEvent("client-entity-health-updated", {
			guid: target,
			healthFraction: 0.35,
		});
		emitInteractionEvent("client-entity-health-updated", {
			guid: target + 1,
			healthFraction: 0.9,
		});
		await new Promise((resolve) =>
			window.setTimeout(
				resolve,
				CLIENT_TUNING.selectedEntityHud.displayIntervalMs * 2,
			),
		);
		const health = meter.getAttribute("aria-valuenow");
		button.click();
		await tick();
		const use = interactionCommands.at(-1);
		if (
			unknown !== "Unknown" ||
			health !== "35" ||
			use?.command !== "use_client_entity" ||
			use.args?.guid !== target
		) {
			throw new Error(
				"Selected entity health or use dispatch did not match the selected target.",
			);
		}
		// Reselect the same mob with unchanged server health after the HUD has unmounted.
		selection.select(null);
		await tick();
		selection.select(target);
		await tick();
		emitInteractionEvent("client-entity-health-updated", {
			guid: target,
			healthFraction: 0.35,
		});
		await new Promise((resolve) =>
			window.setTimeout(
				resolve,
				CLIENT_TUNING.selectedEntityHud.displayIntervalMs * 2,
			),
		);
		const reselectedHealth = document
			.querySelector('[aria-label="Selected entity health"]')
			?.getAttribute("aria-valuenow");
		if (reselectedHealth !== health)
			throw new Error("Reselection lost unchanged entity health.");
		return {
			unknown,
			health,
			reselectedHealth,
			actionFeedback: await probeActionFeedback(),
			dialogs: await probeDialogs(),
			audio: await probeClientAudio(),
			boomCamera: await probeBoomCameraCorrection(),
			use,
			commands: [...interactionCommands],
		};
	}
	let hoveredGuid = $state<number | null>(null);
	let hoverHitEnabled = true;
	let targetIndicatorFrame: ClientTargetIndicatorFrame | null = null;
	const orbitDeltas: { x: number; y: number }[] = [];
	const zoomDeltas: number[] = [];
	const selectionEvents: (number | null)[] = [];
	const viewportSelectionPoints: { x: number; y: number }[] = [];
	const viewportHoverPoints: { x: number; y: number }[] = [];
	const cameraController = {
		orbit(deltaX: number, deltaY: number): void {
			orbitDeltas.push({ x: deltaX, y: deltaY });
		},
		zoom(delta: number): void {
			zoomDeltas.push(delta);
		},
	};
	/** Imperative fixture position, matching the production map frame's presentation-rate source. */
	let minimapCategory: DynamicEntityMapBlipCategory = "mob";
	let doorAngle = 0;
	let doorHalfWidth = 2;
	let minimapHidden = false;
	let minimapNoDraw = false;
	/** Read the actual drawn door segment for browser pointer and zoom probes. */
	async function measureDoorBar(angle: number): Promise<{
		start: { x: number; y: number };
		end: { x: number; y: number };
	}> {
		doorAngle = angle;
		doorHalfWidth = 20;
		minimapCategory = "door";
		minimapHidden = false;
		minimapNoDraw = false;
		minimapSubjectIndoor = false;
		const canvas = document.querySelector<HTMLCanvasElement>(
			".minimap-overlay-canvas",
		);
		const context = canvas?.getContext("2d");
		if (!canvas || !context) throw new Error("Minimap unavailable");
		const move = context.moveTo,
			line = context.lineTo,
			stroke = context.stroke;
		let start = { x: 0, y: 0 },
			end = { x: 0, y: 0 };
		let segment: {
			start: { x: number; y: number };
			end: { x: number; y: number };
		} | null = null;
		context.strokeStyle = mapBlipFillStyle(
			"door",
			-minimapSubjectWorldY,
			"outdoor",
		);
		const color = context.strokeStyle;
		context.moveTo = (x, y) => {
			start = { x, y };
			move.call(context, x, y);
		};
		context.lineTo = (x, y) => {
			end = { x, y };
			line.call(context, x, y);
		};
		context.stroke = () => {
			if (context.strokeStyle === color) segment = { start, end };
			stroke.bind(context)();
		};
		try {
			await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
			if (segment === null) throw new Error("Door stroke absent");
			const bounds = canvas.getBoundingClientRect();
			const screen = (point: { x: number; y: number }) => ({
				x: bounds.left + (point.x * bounds.width) / canvas.width,
				y: bounds.top + (point.y * bounds.height) / canvas.height,
			});
			// Callback writes occur while the explicit sampling promise is pending.
			const measured: {
				start: { x: number; y: number };
				end: { x: number; y: number };
			} = segment;
			return { start: screen(measured.start), end: screen(measured.end) };
		} finally {
			context.moveTo = move;
			context.lineTo = line;
			context.stroke = stroke;
		}
	}

	/** Change only producer facts, without moving the marker or rebuilding the map. */
	async function probeInteractableMarker(
		category: DynamicEntityMapBlipCategory,
		indoor: boolean,
		hidden: boolean,
		noDraw: boolean,
	): Promise<void> {
		minimapCategory = category;
		minimapSubjectIndoor = indoor;
		minimapHidden = hidden;
		minimapNoDraw = noDraw;
		const canvas = document.querySelector<HTMLCanvasElement>(
			".minimap-overlay-canvas",
		);
		const context = canvas?.getContext("2d");
		if (!context) throw new Error("Minimap canvas missing");
		const originalRect = context.rect;
		const originalLine = context.lineTo;
		const originalFill = context.fill;
		const originalStroke = context.stroke;
		let rectangles = 0;
		let lines = 0;
		const fills: string[] = [];
		context.rect = (...args: Parameters<typeof originalRect>) => {
			rectangles++;
			originalRect.apply(context, args);
		};
		context.lineTo = (...args: Parameters<typeof originalLine>) => {
			lines++;
			originalLine.apply(context, args);
		};
		context.stroke = () => {
			fills.push(String(context.strokeStyle));
			originalStroke.bind(context)();
		};
		context.fill = () => {
			fills.push(String(context.fillStyle));
			originalFill.bind(context)();
		};
		try {
			await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
			const expected = mapBlipFillStyle(
				category,
				-minimapSubjectWorldY,
				indoor ? "indoor" : "outdoor",
			);
			// Canvas normalizes CSS values, so compare its canonical representation.
			context.fillStyle = expected;
			const hasFill = fills.includes(String(context.fillStyle));
			if (hasFill !== !(hidden || noDraw))
				throw new Error(`${category}: incorrect marker visibility/color`);
			if (!hidden && !noDraw && category !== "mob") {
				if (lines === 0 || rectangles !== 0)
					throw new Error(`${category}: incorrect marker shape`);
			}
		} finally {
			context.rect = originalRect;
			context.lineTo = originalLine;
			context.fill = originalFill;
			context.stroke = originalStroke;
		}
	}
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
		transform.m11 = Math.cos(doorAngle);
		transform.m13 = Math.sin(doorAngle);
		transform.m31 = -Math.sin(doorAngle);
		transform.m33 = Math.cos(doorAngle);
		return {
			sidewaysSpan: { minX: -doorHalfWidth, maxX: doorHalfWidth, z: 0 },
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
					content: { setupDid: 0x0200025a, motionTableDid: null },
					radar: {
						behavior: minimapCategory === "mob" ? "ShowAlways" : null,
						category: minimapCategory,
					},
				},
				physics: { hidden: minimapHidden, noDraw: minimapNoDraw },
			} as unknown as DynamicEntityView,
		};
	}

	function readSelectedEntity() {
		return clientSelectedEntity(
			selection.selectedGuid(),
			interactionLifecycle.entities.read(),
			[minimapEntity().view],
		);
	}

	function readDiagnostics(): ClientPresentationDiagnostics | null {
		return {
			renderer: null,
			residentResources: null,
			tickProfile: null,
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
					continuitySweeps: 0,
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
				visibleDynamicSourceRanges: 104,
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
					".layout-move, .hud-window-titlebar",
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
		const interactButton = selectedEntityHud?.querySelector<HTMLButtonElement>(
			'button[aria-label="Interact"]',
		);
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
							interactDisabled: interactButton?.disabled === true,
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
			".layout-move, .hud-window-titlebar",
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

	function probeViewportBlockers(): void {
		const canvas = document.querySelector<HTMLCanvasElement>(".client-canvas");
		const chat = document.querySelector<HTMLInputElement>(
			'[aria-label="Chat message"]',
		);
		if (canvas === null || chat === null)
			throw new Error("Viewport blocker probe requires canvas and chat.");
		const closeModal = inputGate.block();
		try {
			chat.focus();
			closeModal();
			if (keyboard.gameActive || !inputGate.allowed)
				throw new Error(
					"Chat must own keyboard input while leaving viewport gestures available.",
				);
			canvas.dispatchEvent(
				new PointerEvent("pointermove", {
					clientX: 700,
					clientY: 400,
					pointerId: 1,
				}),
			);
			keyboard.returnToGame();
			if (!inputGate.allowed)
				throw new Error("Returning to the game retained a viewport blocker.");
		} finally {
			closeModal();
			keyboard.returnToGame();
		}
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
		selection.select(guid);
		selectionEvents.push(guid);
	}

	function setHoverHitEnabled(enabled: boolean): void {
		hoverHitEnabled = enabled;
	}

	function resetSelectionFixture(): void {
		minimapSubjectWorldX = 100;
		minimapSubjectGuid = 1;
		minimapSubjectIndoor = false;
		selection.select(null);
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
		// Synthetic artwork keeps the HUD probe independent of installed DAT files.
		const image = Uint8Array.from(
			atob(
				"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAM0lEQVR4nO3OQQEAMAjEsGN+Zm1ysDtk8EkNNHVf/yx2NucAAAAAAAAAAAAAAAAAAABJMlWEAnCwXL+/AAAAAElFTkSuQmCC",
			),
			(character) => character.charCodeAt(0),
		);
		const icons = browserItemIconRepository(async (requests) => {
			preparedIconCount += requests.length;
			if (iconPreparationGate !== null) await iconPreparationGate;
			return requests.map(({ key, spec }) =>
				spec.kind === "item" &&
				spec.base !== null &&
				iconFailures.has(spec.base)
					? {
							kind: "failed" as const,
							key,
							issues: [
								{
									layer: "base" as const,
									code: "missing-asset" as const,
									assetId: spec.base,
									detail: "Injected missing HUD fixture image",
								},
							] as const,
						}
					: { kind: "ready" as const, key, image },
			);
		});
		const inventoryOwner = new ClientInventoryState(
			{
				entities: { read: readInventoryEntities },
				state: () => interactionLifecycle.state(),
				subscribe: (listener) => interactionLifecycle.subscribe(listener),
			},
			icons,
		);
		inventory = inventoryOwner;
		probeBrowserInput(keyboard, inputGate);
		void interactionLifecycle.start();
		const overlayObservation = observeMinimapOverlayArcCalls();
		readMinimapOverlayArcCalls = overlayObservation.read;
		const harnessGlobal = globalThis as typeof globalThis & {
			__HOLTBURGER_3D_CLIENT_HUD_HARNESS__: ClientHudHarnessApi | undefined;
		};
		harnessGlobal.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__ = {
			beginKeyboardProbe: () => {
				keyboardFixture = installKeyboardPolicyFixture(keyboard, inputGate);
			},
			keyboardProbe: () => {
				if (keyboardFixture === null)
					throw new Error("Keyboard fixture has not been installed.");
				return keyboardFixture;
			},
			probeInventory,
			probeThemeApplication,
			probeSelectedDiagnostics,
			probeInteractableMarker,
			measureDoorBar,
			probeSelectedInteractions,
			previewCharacterSelection: () => {
				previewCharacters = true;
			},
			probeViewportBlockers,
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
			keyboardFixture?.dispose();
			inventoryOwner.destroy();
			inventory = null;
			icons.dispose();
			interactions.destroy();
			unsubscribeSelection();
			selection.destroy();
			interactionLifecycle.stop();
			overlayObservation.restore();
			readMinimapOverlayArcCalls = () => 0;
			harnessGlobal.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__ = undefined;
		};
	});
</script>

{#if dialogPresentation !== null}
	<ClientMessageDialog
		presentation={dialogPresentation}
		onDismiss={(id) => dialogOwner?.dismissPopup(id)}
		onRespond={(id, accepted) => {
			void dialogOwner?.respond(id, accepted);
		}}
	/>
{/if}

{#if !previewCharacters}
	<ClientWorldView
		entityMetadata={{
			status: "available",
			path: "fixture.hwc",
			recordCount: 1,
		}}
		entityCollisionDisabled={false}
		onEntityCollisionDisabledChange={() => {}}
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
		{unrestrictedUse}
		onUnrestrictedUseChange={(enabled) => (unrestrictedUse = enabled)}
		{readMinimapFrame}
		{readDiagnostics}
		{readSelectedEntity}
		{readFrameRates}
		readTargetIndicatorFrame={() => targetIndicatorFrame}
		readSelectedEntityDisplay={() => interactions.display()}
		{inventory}
		onSelectInventoryItem={(guid) => selection.selectInventoryItem(guid)}
		onInteractEntity={() => interactions.interact(unrestrictedUse)}
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
		onCanvas={() => {}}
	/>
{/if}
{#if previewCharacters}
	<div class="character-preview ui-theme">
		<section class="ui-panel">
			<header class="ui-frame">Asheron’s Call</header>
			<div class="ui-body">
				<ClientCharacterSelect
					state={characterState}
					{entryPending}
					onChoose={(guid) =>
						(characterState = { ...characterState, selectedGuid: guid })}
					onEnter={() => {
						entryPending = true;
					}}
					onDisconnect={() => {
						previewCharacters = false;
					}}
				/>
			</div>
		</section>
	</div>
{/if}

<style>
	@layer components {
		.character-preview {
			position: fixed;
			inset: 0;
			z-index: 50;
			display: grid;
			place-items: start center;
			padding: 32px;
			background: var(--ui-color-well);
		}
		.character-preview section {
			width: min(100%, 640px);
		}
		.character-preview .ui-body {
			display: grid;
			gap: 12px;
		}
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
	}
</style>
