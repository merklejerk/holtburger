<script lang="ts">
	import { ClientWorldContainerPanelState } from "../../client/client-world-container-panel-state";
	import { handleSpellBarKeydown } from "../../client/client-spell-bar-input";
	import type { InputDigitIndex } from "../../lib/input/input-contract";
	import {
		bindSpellCell,
		initialSpellBar,
	} from "../../client/client-spell-bar-state";

	import { z } from "zod";
	import { spellInspectionQuerySchema } from "../../client/client-spell-inspection-contract";
	import { SpellReferences } from "../../app/spell-references";
	import {
		ClientSpellState,
		type ClientSpellServices,
	} from "../../client/client-spells";
	import { resolveClientSpellCastAim } from "../../client/client-spell-casting";
	import { probeClientSpells } from "./client-spells-probe";
	import type { ClientEntityFacts } from "../../client/client-entity-mirror";
	import {
		CASTER_EQUIP_MASK,
		inventoryEquipment,
	} from "../../client/client-inventory-equipment";
	import type {
		ClientViewportTargetDestination,
		ClientViewportTargetResult,
	} from "../../client/client-pointer-selection-controller";
	import { INPUT_DEFAULTS } from "../../lib/input/input-defaults";
	import { APP_INPUT } from "../../lib/input/app-input";
	import {
		itemUseRequestSchema,
		itemUseResultSchema,
		itemUseTargetResultSchema,
	} from "../../client/client-item-use-contract";
	import { ClientItemInteractions } from "../../client/client-item-interactions";
	import { probeClientTargeting } from "./client-targeting-probe";
	import type { ClientInventoryPreviewResult } from "../../client/client-inventory-contract";
	import { installKeyboardPolicyFixture } from "./keyboard-policy-fixture";
	import { clientSelectedEntity } from "../../client/client-selected-entity";
	import { probeWorldContainer } from "./client-world-container-probe";
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
	import { ClientSelectedEntityTracking } from "../../client/client-selected-entity-tracking";
	import { ClientEntitySelection } from "../../client/client-entity-selection";
	import { ClientLifecycleSession } from "../../client/client-lifecycle-session";
	import {
		ClientObjectInspection,
		type ClientObjectInspectionState,
	} from "../../client/client-object-inspection";
	import {
		decodeObjectInspectionResult,
		type ObjectInspectionResult,
	} from "../../client/client-object-inspection-contract";
	import { CLIENT_TUNING } from "../../client/client-tuning";
	import { defaultUiThemeUrl } from "../../app/ui-theme";
	import { uiThemes } from "../../app/mount";
	import opaqueUrl from "./themes/opaque.css?url&no-inline";
	import type { FrameRates } from "../../app/frame-rate-sampler";
	import ClientCharacterSelect from "../../client/ClientCharacterSelect.svelte";
	import type { ClientLifecycleUiState } from "../../client/client-lifecycle-state";
	import { ClientInventoryState } from "../../client/client-inventory-state";
	import { browserUiIconRepository } from "../../app/ui-icon-repository";
	import ClientWorldView from "../../client/ClientWorldView.svelte";
	import type {
		ClientChatErrorMessage,
		ClientChatLine,
	} from "../../client/client-chat-policy";
	import type {
		ClientAttackProfile,
		ClientChatMessage,
		ClientCombatMode,
		ClientCombatStatus,
	} from "../../client/client-host-contract";
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
	import {
		createDefaultClientCharacterSettings,
		createDefaultClientUserSettings,
	} from "../../client/client-settings-defaults";

	let spellBar = $state(initialSpellBar());
	let userSettings = $state.raw(
		createDefaultClientUserSettings(
			{ width: window.innerWidth, height: window.innerHeight },
			9,
		),
	);
	let characterSettings = $state.raw<ReturnType<
		typeof createDefaultClientCharacterSettings
	> | null>(createDefaultClientCharacterSettings());
	let characterSettingsGuid: number | null = 1;
	let hudMode = $state<"runtime" | "layout">("runtime");
	let spellCombatMode = $state<ClientCombatMode>("peace");
	let combatStatus = $state<ClientCombatStatus>({
		desired: null,
		state: "idle",
		refill: null,
	});
	const spellBarEnabled = $derived(
		spellCombatMode === "magic" && hudMode === "runtime",
	);
	function selectSpellTab(selected: InputDigitIndex): void {
		spellBar = { ...spellBar, selected };
	}
	function activateSpellCell(slot: InputDigitIndex): void {
		const id = spellBar.tabs[spellBar.selected][slot];
		if (
			spellBarEnabled &&
			id !== null &&
			interactionLifecycle.state().knownSpells?.includes(id)
		)
			void castSpell(id);
	}
	async function castSpell(id: number): Promise<void> {
		const spellState = spells;
		const selection = selectedGuid;
		const reference =
			selection === null && spellState !== null
				? await spellState.reference(id)
				: null;
		const details = reference?.kind === "known" ? reference.details : null;
		await interactionLifecycle.castSpell(
			id,
			resolveClientSpellCastAim(details, selection),
		);
	}
	let releaseSpellKeys: (() => void) | null = null;
	let releaseSpellReferenceGate: (() => void) | null = null;
	let closeSpellModal: (() => void) | null = null;
	let savedCaster: ClientEntityFacts | null = null;
	const spellBarProbe = {
		caster: (spell: number | null, wielded: boolean) => {
			const read = interactionLifecycle.entities.read();
			if (read.kind !== "current") throw new Error("Current entities required");
			const source =
				savedCaster ??
				inventoryEquipment(read.level).rows[0]?.item ??
				read.level.entities.get(95);
			if (source?.description.kind !== "known")
				throw new Error("Caster fixture required");
			savedCaster = source;
			emitInteractionEvent("client-entity-facts-changed", {
				worldContainer: null,
				upserts: [
					{
						...source,
						ownedByPlayer: true,
						location: wielded
							? { kind: "equipped", wearerGuid: 1, mask: CASTER_EQUIP_MASK }
							: {
									kind: "contained",
									parentGuid: 1,
									slot: { kind: "item", index: 0 },
								},
						description: {
							...source.description,
							name: "Test caster",
							builtInSpell: spell,
							equipLocations: CASTER_EQUIP_MASK,
							useCapability: "targeted",
						},
					},
				],
				removed: [],
			});
			selection.select(7);
			return source.guid;
		},
		resolveCaster: () => {
			const state = itemInteractions.snapshot();
			if (state.kind !== "resolving")
				throw new Error("Caster target query required");
			emitInteractionEvent("client-item-use-target-result", {
				sequence: state.sequence,
				eligible: true,
			});
		},
		restoreCaster: () => {
			if (savedCaster === null) throw new Error("No saved caster fixture");
			itemInteractions.cancel();
			emitInteractionEvent("client-entity-facts-changed", {
				worldContainer: null,
				upserts: [savedCaster],
				removed: [],
			});
			savedCaster = null;
		},
		begin: () => {
			spellBar = initialSpellBar();
			hudMode = "runtime";
			spellCombatMode = "magic";
			emitInteractionEvent("client-lifecycle-changed", { kind: "in-world" });
			emitInteractionEvent("client-local-player-established", {
				playerGuid: 1,
			});
			emitInteractionEvent("client-combat-mode-updated", { mode: "magic" });
			emitInteractionEvent("client-player-spells-updated", {
				spellIds: [1, 2, 3],
			});
			releaseSpellKeys = keyboard.bindGame({
				keydown: (event) => {
					handleSpellBarKeydown(
						event,
						spellBarEnabled,
						selectSpellTab,
						activateSpellCell,
					);
				},
				keyup: () => {},
				cancel: () => {},
			});
			keyboard.returnToGame();
		},
		mode: (mode: ClientCombatMode) => {
			spellCombatMode = mode;
			emitInteractionEvent("client-combat-mode-updated", { mode });
		},
		knowledge: (spellIds: readonly number[]) =>
			emitInteractionEvent("client-player-spells-updated", { spellIds }),
		bind: (slot: InputDigitIndex, spell: number | null) => {
			spellBar = bindSpellCell(
				spellBar,
				{ tab: spellBar.selected, slot },
				spell,
			);
		},
		select: (guid: number | null) => {
			selectedGuid = guid;
		},
		bindings: () => spellBar,
		deferBoundSpell: async () => {
			releaseSpellReferenceGate = holdSpellReferences();
			emitInteractionEvent("client-player-spells-updated", {
				spellIds: [1, 2, 3, 1800],
			});
			spellBar = bindSpellCell(spellBar, { tab: 0, slot: 9 }, 1800);
			await tick();
		},
		releaseBoundSpell: async () => {
			if (releaseSpellReferenceGate === null || spells === null)
				throw new Error("No deferred spell reference");
			releaseSpellReferenceGate();
			releaseSpellReferenceGate = null;
			await spells.load([1800]);
			await tick();
		},
		modal: (open: boolean) => {
			if (!open) {
				closeSpellModal?.();
				closeSpellModal = null;
				return;
			}
			const element = document.createElement("dialog");
			element.textContent = "Spell input modal fixture";
			document.body.append(element);
			const modal = keyboard.modal(element);
			closeSpellModal = () => {
				modal.destroy();
				element.remove();
			};
		},
		theme: async (standard: boolean) => {
			if (standard) await uiThemes.replace(defaultUiThemeUrl, null);
			else await uiThemes.dispose();
		},
		end: () => {
			releaseSpellKeys?.();
			releaseSpellKeys = null;
			spellCombatMode = "peace";
			hudMode = "runtime";
			emitInteractionEvent("client-combat-mode-updated", { mode: "peace" });
		},
	};
	const combatBarProbe = {
		begin: (mode: "melee" | "missile") => {
			hudMode = "runtime";
			spellCombatMode = mode;
			selectedGuid = 7;
			combatStatus = { desired: null, state: "idle", refill: null };
		},
		active: (mode: "melee" | "missile") => {
			spellCombatMode = mode;
			selectedGuid = 7;
			combatStatus = {
				desired: {
					target: 7,
					profile:
						mode === "melee"
							? { kind: "melee", height: "medium", power: 0.5 }
							: { kind: "missile", height: "medium", accuracy: 0.5 },
				},
				state: "active",
				refill: { elapsedMs: 350, durationMs: 1000 },
			};
		},
		status: () => combatStatus,
		end: () => {
			spellCombatMode = "peace";
			combatStatus = { desired: null, state: "idle", refill: null };
		},
	};
	function updateCombatProfile(profile: ClientAttackProfile): void {
		if (characterSettings === null) return;
		characterSettings = {
			...characterSettings,
			combatControls:
				profile.kind === "melee"
					? {
							...characterSettings.combatControls,
							melee: { height: profile.height, power: profile.power },
						}
					: {
							...characterSettings.combatControls,
							missile: {
								height: profile.height,
								accuracy: profile.accuracy,
							},
						},
		};
	}

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
					command?.command !== "submit_client_item_use" ||
					!((intent) =>
						intent.kind === "direct" && intent.unrestricted === expected)(
						itemUseRequestSchema.parse(command.args?.request).intent,
					)
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
	let appearanceOptions = $state({ showHelmet: true, showCloak: true });
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
			const panel = document.querySelector(
				'.hud-window[aria-label="Client diagnostics"]',
			);
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
	let activeItemUseProbe: ReturnType<typeof beginItemUseProbe> | null = null;
	function beginItemUseProbe() {
		const read = interactionLifecycle.entities.read();
		if (read.kind !== "current")
			throw new Error("Item-use probe requires current entities");
		const saved = [91, 95].map((guid) => {
			const item = read.level.entities.get(guid);
			if (item === undefined || item.description.kind !== "known")
				throw new Error("Missing item-use fixture");
			return { ...item, description: item.description };
		});
		emitInteractionEvent("client-entity-facts-changed", {
			worldContainer: null,
			upserts: saved.map((item, index) => ({
				...item,
				description: {
					...item.description,
					equipLocations: null,
					consumable: {
						identity: {
							wcid: 9000 + index,
							category: index === 0 ? "food" : "charged-mana-stone",
						},
						availability: "ready",
					},
					useCapability: index === 0 ? "direct" : "targeted",
				},
			})),
			removed: [],
		});
		const owner = new ClientDialogs(interactionLifecycle);
		dialogOwner = owner;
		const unbind = owner.bindItems(itemInteractions);
		const unsubscribe = owner.subscribe((value) => {
			dialogPresentation = value;
		});
		const releaseKeys = keyboard.bindGame({
			keydown: (event) => {
				if (APP_INPUT.shortcut("interact", event)) {
					event.preventDefault();
					if (!event.repeat) itemInteractions.interactSelected(false);
				} else if (
					APP_INPUT.shortcut("cancel", event) &&
					itemInteractions.cancel()
				)
					event.preventDefault();
			},
			keyup: () => {},
			cancel: () => {
				itemInteractions.cancelTargeting();
			},
		});
		const fixture = {
			/** Let the preceding drag suppression and bounded inventory display sample finish. */
			ready: () =>
				new Promise((resolve) =>
					window.setTimeout(
						resolve,
						CLIENT_TUNING.inventory.doubleClickSuppressionMs +
							CLIENT_TUNING.inventory.displayIntervalMs,
					),
				),
			/** Drive authoritative depletion and removal through the production entity stream. */
			depleteSupply: () => {
				itemInteractions.cancel();
				const current = interactionLifecycle.entities.read();
				if (current.kind !== "current")
					throw new Error("Expected current inventory");
				const item = current.level.entities.get(95);
				if (
					item?.description.kind !== "known" ||
					item.description.consumable === null
				)
					throw new Error("Expected bound supply");
				emitInteractionEvent("client-entity-facts-changed", {
					worldContainer: null,
					upserts: [
						{
							...item,
							description: {
								...item.description,
								consumable: {
									...item.description.consumable,
									availability: "exhausted",
								},
							},
						},
						{
							...item,
							guid: 995,
							location: {
								kind: "contained",
								parentGuid: 1,
								slot: { kind: "pending" },
							},
						},
					],
					removed: [],
				});
			},
			removeSupply: () =>
				emitInteractionEvent("client-entity-facts-changed", {
					worldContainer: null,
					upserts: [],
					removed: [995],
				}),
			/** Publish stack changes independently of icon identity. */
			setFoodCount: (count: number) => {
				const current = interactionLifecycle.entities.read();
				if (current.kind !== "current")
					throw new Error("Expected current inventory");
				const item = current.level.entities.get(91);
				if (item?.description.kind !== "known")
					throw new Error("Expected food fixture");
				emitInteractionEvent("client-entity-facts-changed", {
					worldContainer: null,
					upserts: [
						{
							...item,
							description: { ...item.description, stackCount: count },
						},
					],
					removed: [],
				});
			},
			/** Change bound equipment structure without replacing its icon or action identity. */
			setToolStructure: (current: number | null, max: number | null) => {
				const read = interactionLifecycle.entities.read();
				if (read.kind !== "current")
					throw new Error("Expected current inventory");
				const item = read.level.entities.get(95);
				if (item?.description.kind !== "known")
					throw new Error("Expected tool fixture");
				emitInteractionEvent("client-entity-facts-changed", {
					worldContainer: null,
					upserts: [
						{
							...item,
							description: {
								...item.description,
								stackCount: 2,
								structure: { current, max },
							},
						},
					],
					removed: [],
				});
			},
			hoverWorld: (guid: number | null) => (hoveredGuid = guid),
			queryCommands: () =>
				interactionCommands.filter(
					(entry) => entry.command === "query_client_item_use_target",
				),
			targetReply: (payload: unknown) =>
				emitInteractionEvent(
					"client-item-use-target-result",
					itemUseTargetResultSchema.parse(payload),
				),
			interactBinding: INPUT_DEFAULTS.client.interact[0],
			alternateModifier: INPUT_DEFAULTS.actionBars.alternate,
			selected: () => selection.selectedGuid(),
			snapshot: () => itemInteractions.snapshot(),
			reply: (payload: unknown) =>
				emitInteractionEvent(
					"client-item-use-result",
					itemUseResultSchema.parse(payload),
				),
			select: (guid: number | null) => selection.select(guid),
			destroy: () => {
				itemInteractions.cancel();
				releaseKeys();
				unbind();
				unsubscribe();
				owner.destroy();
				dialogOwner = null;
				dialogPresentation = null;
				emitInteractionEvent("client-entity-facts-changed", {
					worldContainer: null,
					upserts: saved,
					removed: [995],
				});
				activeItemUseProbe = null;
			},
		};
		activeItemUseProbe = fixture;
		return fixture;
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
		/** Verify keyboard acquisition through the real browser input boundary. */
		readonly probeTargeting: () => ReturnType<typeof probeClientTargeting>;
		/** Install a real DOM fixture for CDP keyboard and pointer events. */
		readonly beginKeyboardProbe: () => void;
		/** Read the currently installed keyboard fixture. */
		readonly keyboardProbe: () => ReturnType<
			typeof installKeyboardPolicyFixture
		>;
		/** Verify live inventory, shared placement, geometry, selection, and recovery. */
		readonly probeInventory: typeof probeInventory;
		readonly probeWorldContainer: () => ReturnType<typeof probeWorldContainer>;
		/** Exercise spell membership, artwork reuse, and panel teardown. */
		readonly probeSpells: () => Promise<unknown>;
		/** Controlled delayed responses around the production examination owner and UI. */
		readonly objectInspectionProbe: () => ObjectInspectionProbe;
		/** Production spell shortcut dispatch and session requests under browser input. */
		readonly spellBarProbe: typeof spellBarProbe;
		/** Render and manipulate the production melee/missile HUD without a live server. */
		readonly combatBarProbe: typeof combatBarProbe;
		/** Inspect real session requests while CDP drives production inventory pointers. */
		readonly inventoryDragCommands: () => typeof interactionCommands;
		/** Replace selected inventory identity while a panel interaction is active. */
		readonly selectInventoryItem: (guid: number) => void;
		/** Controlled viewport answers exercise production drag ownership. */
		readonly giveProbe: typeof giveProbe;
		/** Delay one submission acknowledgement to test gesture lifetime independence. */
		/** Controlled use outcomes with production UI, controller, and session decoding. */
		readonly beginItemUseProbe: () => void;
		readonly itemUseProbe: () => NonNullable<typeof activeItemUseProbe>;
		readonly deferNextInventorySubmission: () => void;
		/** Reject the delayed acknowledgement through the real session promise. */
		readonly rejectDeferredInventorySubmission: () => void;
		/** Deliver a controlled authority response through the production session decoder. */
		readonly replyInventoryPreview: (
			result: ClientInventoryPreviewResult,
		) => void;
		/** Verify style updates without replacing world presentation or HUD placement. */
		readonly probeThemeApplication: typeof probeThemeApplication;
		/** Verify sampled selected-entity identity and snapshot disclosure. */
		readonly probeSelectedDiagnostics: typeof probeSelectedDiagnostics;
		readonly probeInteractableMarker: typeof probeInteractableMarker;
		readonly measureDoorBar: typeof measureDoorBar;
		/** Exercise health presentation and use dispatch through production session owners. */
		readonly probeSelectedInteractions: typeof probeSelectedInteractions;
		/** Verify default and pointer focus across production vital bars. */
		readonly probeCharacterVitals: typeof probeCharacterVitals;
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
	let spellReferenceGate: Promise<void> | null = null;
	function holdSpellReferences(): () => void {
		if (spellReferenceGate !== null)
			throw new Error("Spell references already held.");
		let release = () => {};
		spellReferenceGate = new Promise<void>((resolve) => {
			release = resolve;
		});
		return () => {
			spellReferenceGate = null;
			release();
		};
	}
	let spells = $state<ClientSpellServices | null>(null);
	let inventory = $state<ClientInventoryState | null>(null);
	let worldContainer = $state<ClientWorldContainerPanelState | null>(null);
	function readInventoryEntities() {
		inventorySampleCount += 1;
		return interactionLifecycle.entities.read();
	}
	let preciseJumpActive = $state(false);
	let cameraEnabled = $state(true);
	let selectedGuid = $state<number | null>(null);
	const interactionHandlers = new Map<string, (payload: unknown) => void>();
	let deferInventorySubmission = false;
	let rejectInventorySubmission: ((error: Error) => void) | null = null;
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
			knownSpells: null,
			appearanceOptions,
			combatMode: "peace",
			combat: { desired: null, state: "idle", refill: null },
			vitals: [],
			characterMotion: null,
			activeConfirmation: null,
			dynamic: { hostTime: { seconds: 10 }, entities: [] },
			entities: {
				worldContainer: { kind: "closed" },
				entities: [1, 7, 8].map((guid) => ({
					guid,
					description: {
						kind: "known",
						name: guid === 1 ? "Wayfarer" : "Drudge",
						healthQuery: "eligible",
						itemType: 0,
						hasAlternateEquipSide: false,
						builtInSpell: null,
						mapCategory: "other",
						objectFlags: 0,
						wcid: guid === 7 ? 42 : null,
						weenieType: null,
						pyrealBalance: null,
						burden: null,
						equipLocations: null,
						consumable: null,
						useCapability: "direct",
						stackCount: null,
						structure: { current: null, max: null },
						icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
					},
					location: { kind: "none" },
					ownedByPlayer: false,
					canPickUp: false,
					worldContainerContent: false,
					canReceiveGive: false,
					targeting: "non-creature",
					corpse: null,
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
			if (command === "query_client_spell_inspection") {
				const { query } = z
					.object({
						query: spellInspectionQuerySchema,
					})
					.parse(args);
				emitInteractionEvent("client-spell-inspection-result", {
					...query,
					context: { revision: spellInspectionRevision, player: 1 },
					outcome: {
						kind: "ready",
						rangeMetres: spellInspectionRevision === 1 ? 25 : 30,
						formula: {
							kind: "ready",
							components:
								spellInspectionRevision === 1
									? [1, 188, 0, 0, 0, 0, 0, 0]
									: [188, 188, 0, 0, 0, 0, 0, 0],
						},
					},
				});
			}
			if (command === "submit_client_inventory" && deferInventorySubmission) {
				deferInventorySubmission = false;
				await new Promise<void>((_resolve, reject) => {
					rejectInventorySubmission = reject;
				});
			}
			if (command === "request_client_current_state") emitInteractionBaseline();
		},
	});
	let objectInspection = $state<ClientObjectInspectionState>({ kind: "idle" });
	let inspectionFailure = $state<string | null>(null);
	const objectInspectionOwner = new ClientObjectInspection(
		interactionLifecycle,
		(message) => {
			inspectionFailure = message;
			toast = { id: 9001, message, tone: "warning" };
		},
	);
	const unsubscribeObjectInspection = objectInspectionOwner.subscribe(
		(state) => (objectInspection = state),
	);
	const selection = new ClientEntitySelection({
		lifecycle: interactionLifecycle,
		presentation: () => null,
	});
	const interactions = new ClientSelectedEntityTracking({
		selection,
		lifecycle: interactionLifecycle,
		onFailure: (error) => {
			throw error;
		},
	});
	const itemInteractions = new ClientItemInteractions({
		reportNotice: (message) => {
			toast = { id: 1, message, tone: "status" };
		},
		session: interactionLifecycle,
		selection,
		reportFailure: (message) => {
			interactionFailures.push(message);
		},
		beginAcquisition: () => keyboard.returnToGame(),
	});
	let inventoryWorldResult: ClientViewportTargetResult | null = {
		kind: "empty",
	};
	let pendingInventoryWorldPick: ClientViewportTargetDestination | null = null;
	let releaseGiveKeys: (() => void) | null = null;
	const giveProbe = {
		binding: INPUT_DEFAULTS.client.give[0],
		begin: () => {
			const read = interactionLifecycle.entities.read();
			if (read.kind !== "current")
				throw new Error("Give fixture requires current entities");
			const recipient = read.level.entities.get(91);
			if (recipient?.description.kind !== "known")
				throw new Error("Give fixture recipient missing");
			emitInteractionEvent("client-entity-facts-changed", {
				worldContainer: null,
				upserts: [
					{
						...recipient,
						guid: 7,
						canReceiveGive: true,
						ownedByPlayer: false,
						location: { kind: "none" },
						scenePlacement: "available",
						targeting: "creature",
						corpse: null,
						description: {
							...recipient.description,
							name: "Give recipient",
							healthQuery: "eligible",
						},
					},
				],
				removed: [],
			});
			selection.select(7);
			releaseGiveKeys = keyboard.bindGame({
				keydown: (event) => {
					if (APP_INPUT.shortcut("give", event) && !event.isComposing) {
						event.preventDefault();
						if (!event.repeat) itemInteractions.giveSelected();
					}
				},
				keyup: () => {},
				cancel: () => {},
			});
			keyboard.returnToGame();
		},
		removeSource: (guid: number): ClientEntityFacts => {
			const read = interactionLifecycle.entities.read();
			if (read.kind !== "current")
				throw new Error("Source removal requires current authority");
			const source = read.level.entities.get(guid);
			if (source === undefined)
				throw new Error("Source removal requires an existing source");
			emitInteractionEvent("client-entity-facts-changed", {
				worldContainer: null,
				upserts: [],
				removed: [guid],
			});
			return source;
		},
		restoreSource: (source: ClientEntityFacts) =>
			emitInteractionEvent("client-entity-facts-changed", {
				worldContainer: null,
				upserts: [source],
				removed: [],
			}),
		setTarget: (result: ClientViewportTargetResult | null) => {
			inventoryWorldResult = result;
		},
		reply: (result: ClientViewportTargetResult) => {
			const pending = pendingInventoryWorldPick;
			pendingInventoryWorldPick = null;
			if (pending === null) throw new Error("No pending viewport pick");
			if (pending.isCurrent()) pending.commit(result);
		},
		end: () => {
			emitInteractionEvent("client-entity-facts-changed", {
				worldContainer: null,
				upserts: [],
				removed: [7],
			});
			inventoryWorldResult = { kind: "empty" };
			pendingInventoryWorldPick = null;
			releaseGiveKeys?.();
			releaseGiveKeys = null;
		},
	};
	const interactionFailures: string[] = [];
	const unsubscribeSelection = selection.subscribe((guid) => {
		selectedGuid = guid;
	});

	let spellInspectionRevision = 1;
	function emitInteractionEvent(event: string, payload: unknown): void {
		if (event === "client-current-state") {
			const localPlayerGuid = z
				.object({ localPlayerGuid: z.number().nullable() })
				.parse(payload).localPlayerGuid;
			if (localPlayerGuid !== characterSettingsGuid) {
				characterSettingsGuid = localPlayerGuid;
				characterSettings =
					localPlayerGuid === null
						? null
						: createDefaultClientCharacterSettings();
			}
		}
		if (event === "client-local-player-established") {
			const playerGuid = z
				.object({ playerGuid: z.number() })
				.parse(payload).playerGuid;
			if (playerGuid !== characterSettingsGuid || characterSettings === null) {
				characterSettingsGuid = playerGuid;
				characterSettings = createDefaultClientCharacterSettings();
			}
		}
		if (event === "client-lifecycle-changed") {
			const kind = z.object({ kind: z.string() }).parse(payload).kind;
			if (kind === "entering-world" || kind === "character-selection") {
				characterSettingsGuid = null;
				characterSettings = null;
			}
		}
		if (event === "client-spell-inspection-context")
			spellInspectionRevision = z
				.object({ revision: z.number() })
				.parse(payload).revision;
		const handler = interactionHandlers.get(event);
		if (handler === undefined)
			throw new Error(`Missing interaction listener: ${event}`);
		handler(payload);
	}

	type InspectionResponseKind = "item" | "creature" | "rejected" | "missing";
	const itemDescriptionPrefix = "Archived appraisal context. ";
	const longItemDescription = `${itemDescriptionPrefix.repeat(
		Math.floor(
			CLIENT_TUNING.objectInspection.collapsedDescriptionCharacters /
				itemDescriptionPrefix.length,
		) + 1,
	)}This final archival sentence must remain hidden until the reader explicitly expands the description.`;
	interface ObjectInspectionProbeSnapshot {
		readonly commandCount: number;
		readonly commands: readonly unknown[];
		readonly failure: string | null;
		readonly selectedGuid: number | null;
		readonly state: ClientObjectInspectionState;
		readonly window: null | {
			readonly count: number;
			readonly rectangle: ClientHudHarnessRectangle;
			readonly scrollHeight: number;
			readonly clientHeight: number;
			readonly text: string;
			readonly title: string | null;
		};
	}
	interface ObjectInspectionProbe {
		readonly binding: (typeof INPUT_DEFAULTS.client.examine)[number];
		begin(): void;
		end(): void;
		select(guid: number | null): void;
		respond(kind: InspectionResponseKind, guid: number): void;
		resync(): void;
		restore(): void;
		setArtworkFailure(failed: boolean): void;
		snapshot(): ObjectInspectionProbeSnapshot;
	}

	function inspectionResult(
		kind: InspectionResponseKind,
		guid: number,
	): ObjectInspectionResult {
		if (kind === "rejected" || kind === "missing")
			return decodeObjectInspectionResult({
				guid,
				outcome: { kind },
			});
		if (kind === "creature")
			return decodeObjectInspectionResult({
				guid,
				outcome: {
					kind: "ready",
					inspection: {
						guid,
						name: "Holtmage",
						description:
							"An adventurer fixture with disclosed character appraisal details.",
						level: 126,
						details: {
							kind: "creature",
							details: {
								identity: {
									kind: "character",
									lineage: "Male Undead",
									role: "Adventurer",
									playerKillerStatus: "non-player-killer",
								},
								health: {
									effective: { current: 1840, max: 2400 },
									unbuffed: null,
									enchantment: "harmful",
								},
								attributesAndVitals: {
									attributes: {
										strength: {
											effective: 410,
											unbuffed: null,
											enchantment: "beneficial",
										},
										endurance: {
											effective: 395,
											unbuffed: null,
											enchantment: "harmful",
										},
										coordination: {
											effective: 360,
											unbuffed: null,
											enchantment: null,
										},
										quickness: {
											effective: 345,
											unbuffed: null,
											enchantment: null,
										},
										focus: {
											effective: 290,
											unbuffed: null,
											enchantment: null,
										},
										selfAttr: {
											effective: 275,
											unbuffed: null,
											enchantment: null,
										},
									},
									stamina: {
										effective: { current: 825, max: 910 },
										unbuffed: null,
										enchantment: "beneficial",
									},
									mana: {
										effective: { current: 190, max: 300 },
										unbuffed: null,
										enchantment: null,
									},
								},
								armorCoverage: {
									head: { level: 312, enchantable: true },
									chest: { level: 507, enchantable: true },
									abdomen: { level: 484, enchantable: true },
									upperArm: { level: 181, enchantable: true },
									lowerArm: { level: 181, enchantable: true },
									hand: { level: 277, enchantable: true },
									upperLeg: { level: 484, enchantable: true },
									lowerLeg: { level: 484, enchantable: false },
									foot: { level: 490, enchantable: true },
								},
								ratings: {
									damageRating: 5,
									damageResistanceRating: 0,
									criticalRating: 3,
									criticalDamageRating: 0,
									criticalResistanceRating: 1,
									criticalDamageResistanceRating: 0,
									playerKillerDamageRating: null,
									playerKillerDamageResistanceRating: null,
									overpowerChancePercent: 2,
									overpowerResistancePercent: 1,
									healingBoostRating: null,
									netherResistanceRating: 4,
									damageOverTimeResistanceRating: 2,
									lifeMagicResistanceRating: 1,
								},
								maxHealthBonus: 25,
								characterDetails: {
									allegianceName: "Test Allegiance",
									patron: "Test Patron",
									monarch: "Test Monarch",
									allegianceFollowers: 12,
									fellowship: "Test Fellowship",
									arrivedInDereth: "1 Frostfell, 1 P.Y.",
									ageSeconds: 90_061,
									deaths: 0,
									titlesEarned: 7,
									chessRank: 3,
									fishingSkill: 210,
									enlightenment: 2,
								},
							},
						},
					},
				},
			});
		return decodeObjectInspectionResult({
			guid,
			outcome: {
				kind: "ready",
				inspection: {
					guid,
					name: "Ancient Atlan Sword of the Long Appraisal",
					description: longItemDescription,
					level: 80,
					details: {
						kind: "item",
						details: {
							artwork: {
								base: 777,
								overlay: 778,
								underlay: null,
								uiEffects: 1,
								itemType: 1,
							},
							value: 125000,
							burden: 650,
							capacity: { items: 24, containers: 2 },
							material: { materialType: "BlackGarnet", workmanship: 9.6 },
							tinkering: { count: 8 },
							spellcraft: 340,
							mana: {
								kind: "mana",
								current: 9802,
								max: 10000,
								secondsLeft: 3723,
							},
							status: {
								bonded: "bonded",
								attuned: "Attuned",
								retained: true,
								isOpen: null,
								isLocked: null,
								sellable: false,
								ivoryable: true,
								unenchantable: true,
							},
							stack: { current: 3, max: 10 },
							uses: { current: 42, max: 50 },
							armor: {
								effective: 315,
								unbuffed: null,
								enchantment: "beneficial",
							},
							weapon: {
								damage: {
									effective: { min: 31.5, max: 63 },
									unbuffed: { min: 27.5, max: 55 },
									enchantment: "beneficial",
								},
								damageType: 0x11,
								weaponSkill: "HeavyWeapons",
								speed: {
									effective: 32,
									unbuffed: 40,
									enchantment: "beneficial",
								},
								weaponType: "Sword",
							},
							protections: {
								slashing: {
									effective: 1.2,
									unbuffed: 1,
									enchantment: "beneficial",
								},
								piercing: { effective: 1.1, unbuffed: null, enchantment: null },
								bludgeoning: {
									effective: 0.9,
									unbuffed: 1,
									enchantment: "harmful",
								},
								fire: {
									effective: 1.3,
									unbuffed: 1,
									enchantment: "beneficial",
								},
								cold: { effective: 1.25, unbuffed: null, enchantment: null },
								acid: { effective: 1.05, unbuffed: null, enchantment: null },
								lightning: {
									effective: 1.15,
									unbuffed: null,
									enchantment: null,
								},
								nether: { effective: 0.8, unbuffed: null, enchantment: null },
							},
							bonuses: [
								{
									kind: "attack",
									value: {
										effective: 0.18,
										unbuffed: 0.12,
										enchantment: "beneficial",
									},
								},
								{
									kind: "magicDefense",
									value: { effective: 0.12, unbuffed: null, enchantment: null },
								},
							],
							wieldRequirements: [
								{ type: "level", data: { level: 80 } },
								{
									type: "training",
									data: { skill: "HeavyWeapons", level: "specialized" },
								},
							],
							inscription: {
								text: "May this blade remember every long road through Dereth, every fellowship at its side, and every hand that kept its edge bright.",
								scribe: "Harness Artisan",
							},
							imbuedEffects: 0x4001,
							effects: [
								{ type: "armor-cleaving" },
								{
									type: "slayer",
									data: { creatureType: "Olthoi", bonus: 0.2 },
								},
							],
							useText: "Use this item to recall to a remembered sanctuary.",
							spells: [
								{ id: 2000, activeEnchantment: true },
								{ id: 999999, activeEnchantment: false },
							],
						},
					},
				},
			},
		});
	}

	let releaseInspectionKeys: (() => void) | null = null;
	let inspectionCommandOffset = 0;
	function examineHarnessSelection(): void {
		const guid = selection.selectedGuid();
		if (guid !== null) void objectInspectionOwner.examine(guid);
	}
	function examineHarnessItem(guid: number): void {
		selection.selectContentsItem(guid, "select");
		void objectInspectionOwner.examine(guid);
	}
	const objectInspectionProbe: ObjectInspectionProbe = {
		binding: INPUT_DEFAULTS.client.examine[0],
		begin: () => {
			releaseInspectionKeys?.();
			objectInspectionOwner.close();
			inspectionFailure = null;
			inspectionCommandOffset = interactionCommands.length;
			selection.select(null);
			releaseInspectionKeys = keyboard.bindGame({
				keydown: (event) => {
					if (!APP_INPUT.shortcut("examine", event) || event.isComposing)
						return;
					event.preventDefault();
					if (!event.repeat) examineHarnessSelection();
				},
				keyup: () => {},
				cancel: () => {},
			});
			keyboard.returnToGame();
		},
		end: () => {
			releaseInspectionKeys?.();
			releaseInspectionKeys = null;
			objectInspectionOwner.close();
			selection.select(null);
		},
		select: (guid) => selection.select(guid),
		respond: (kind, guid) =>
			emitInteractionEvent(
				"client-object-inspection-result",
				inspectionResult(kind, guid),
			),
		resync: () => emitInteractionEvent("client-state-resyncing", null),
		restore: emitInteractionBaseline,
		setArtworkFailure: (failed) => {
			if (failed) iconFailures.add(777);
			else iconFailures.delete(777);
		},
		snapshot: () => {
			const commands = interactionCommands
				.slice(inspectionCommandOffset)
				.filter(({ command }) => command === "examine_client_entity");
			const bodies = Array.from(
				document.querySelectorAll<HTMLElement>(".inspection-scroll"),
			);
			const body = bodies[0] ?? null;
			const panel = body?.closest<HTMLElement>("section[aria-label]") ?? null;
			return {
				commandCount: commands.length,
				commands,
				failure: inspectionFailure,
				selectedGuid: selection.selectedGuid(),
				state: objectInspectionOwner.read(),
				window:
					body === null || panel === null
						? null
						: {
								count: bodies.length,
								rectangle: rectangle(panel),
								scrollHeight: body.scrollHeight,
								clientHeight: body.clientHeight,
								text: body.innerText,
								title: panel.getAttribute("aria-label"),
							},
			};
		},
	};

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
		const previousActionBar = document.querySelector(
			"[data-action-bar-surface]",
		);
		if (previousActionBar === null)
			throw new Error("Dialog probe requires a mounted action bar.");
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
			if (previousActionBar.isConnected)
				throw new Error(
					"Character reset retained the outgoing action bar's mounted interaction state.",
				);
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
			emitInteractionEvent("client-action-feedback", {
				message: "Attuned item.",
				tone: "status",
			});
			await tick();
			const refusal = Array.from(
				document.querySelectorAll(".client-toast"),
			).find((element) => element.textContent?.trim() === "Attuned item.");
			if (
				refusal?.getAttribute("role") !== "status" ||
				refusal.classList.contains("client-toast-warning")
			)
				throw new Error(
					"Inventory refusal did not reach the neutral notice surface.",
				);
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
		const splitButton = document.querySelector(
			'button[aria-label="Split stack"]',
		);
		if (meter === null || button === null || splitButton !== null)
			throw new Error(
				"Selected creature controls are missing or expose an ineligible split action.",
			);
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
			use?.command !== "submit_client_item_use" ||
			itemUseRequestSchema.parse(use.args?.request).intent.source !== target
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

	async function probeCharacterVitals() {
		const vitalLabels = ["Health", "Mana", "Stamina"] as const;
		type VitalLabel = (typeof vitalLabels)[number];
		const bar = (label: VitalLabel): HTMLElement => {
			const element = document.querySelector<HTMLElement>(
				`.character-hud [role="meter"][aria-label="${label}"]`,
			);
			if (element === null) throw new Error(`Missing ${label} vital bar.`);
			return element;
		};
		const vitalGroup = (): HTMLElement => {
			const element = bar("Health").closest<HTMLElement>(".vitals");
			if (element === null) throw new Error("Missing vital group.");
			return element;
		};
		const snapshotBar = (label: VitalLabel) => {
			const element = bar(label);
			const quantity = element.querySelector<HTMLElement>("strong");
			return {
				focused: element.dataset.focused === "true",
				height: element.getBoundingClientRect().height,
				quantity: quantity?.textContent?.trim() ?? null,
				quantityVisible:
					quantity !== null &&
					getComputedStyle(quantity).visibility === "visible",
			};
		};
		const snapshot = () => ({
			health: snapshotBar("Health"),
			mana: snapshotBar("Mana"),
			stamina: snapshotBar("Stamina"),
		});
		const groupHeight = (): number =>
			vitalGroup().getBoundingClientRect().height;
		const stackHeight = (): number =>
			vitalLabels.reduce(
				(total, label) => total + bar(label).getBoundingClientRect().height,
				0,
			);
		const verifyStableFootprint = async (
			expectedGroupHeight: number,
			expectedStackHeight: number,
		): Promise<void> => {
			const nextFrame = () =>
				new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			await nextFrame();
			while (true) {
				const currentGroupHeight = groupHeight();
				const currentStackHeight = stackHeight();
				if (
					currentGroupHeight !== expectedGroupHeight ||
					Math.abs(currentStackHeight - expectedStackHeight) > 0.01
				)
					throw new Error(
						`Vital footprint changed during focus transition: group ${expectedGroupHeight} -> ${currentGroupHeight}, bars ${expectedStackHeight} -> ${currentStackHeight}`,
					);
				if (vitalGroup().getAnimations({ subtree: true }).length === 0) return;
				await nextFrame();
			}
		};
		const initial = snapshot();
		const initialGroupHeight = groupHeight();
		const initialStackHeight = stackHeight();
		if (
			initial.health.focused !== true ||
			initial.health.quantity !== "1,555 / 12,555" ||
			initial.health.quantityVisible !== true ||
			initial.health.height <= initial.mana.height ||
			initial.stamina.quantityVisible !== false ||
			initial.mana.quantityVisible !== false
		)
			throw new Error(
				`Initial vital focus is invalid: ${JSON.stringify(initial)}`,
			);
		bar("Mana").dispatchEvent(new PointerEvent("pointerenter"));
		await verifyStableFootprint(initialGroupHeight, initialStackHeight);
		const hovered = snapshot();
		if (
			hovered.mana.focused !== true ||
			hovered.mana.height !== initial.health.height ||
			hovered.mana.quantity !== "1,302 / 4,100" ||
			hovered.mana.quantityVisible !== true ||
			hovered.health.height !== initial.mana.height ||
			hovered.health.quantityVisible !== false
		)
			throw new Error(
				`Hovered vital focus is invalid: ${JSON.stringify(hovered)}`,
			);
		vitalGroup().dispatchEvent(new PointerEvent("pointerleave"));
		await verifyStableFootprint(initialGroupHeight, initialStackHeight);
		const reset = snapshot();
		if (
			reset.health.focused !== true ||
			reset.health.height !== initial.health.height ||
			reset.health.quantityVisible !== true ||
			reset.mana.height !== initial.mana.height ||
			reset.mana.quantityVisible !== false
		)
			throw new Error(
				`Vital focus did not reset after pointer exit: ${JSON.stringify(reset)}`,
			);
		return { initial, hovered, reset };
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
		const icons = browserUiIconRepository(async (requests) => {
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
		const inventoryToasts = new ClientToastCenter({
			durationMs: CLIENT_TOAST_DURATION_MS,
			scheduler: {
				cancel: (handle) => window.clearTimeout(handle),
				schedule: (callback, delay) => window.setTimeout(callback, delay),
			},
		});
		const unsubscribeInventoryToasts = inventoryToasts.subscribe((next) => {
			toast = next;
		});
		const inventoryOwner = new ClientInventoryState(
			{
				entities: { read: readInventoryEntities },
				previewInventory: (request) =>
					interactionLifecycle.previewInventory(request),
				submitInventory: (intent) =>
					interactionLifecycle.submitInventory(intent),
				state: () => interactionLifecycle.state(),
				subscribe: (listener) => interactionLifecycle.subscribe(listener),
			},
			icons,
			(message) => inventoryToasts.publish({ message, tone: "warning" }),
		);
		inventory = inventoryOwner;
		const containerOwner = new ClientWorldContainerPanelState(
			interactionLifecycle,
			icons,
			(message) => inventoryToasts.publish({ message, tone: "warning" }),
		);
		worldContainer = containerOwner;
		let spellReferenceRequests = 0;
		const references = new SpellReferences({
			invoke: async (command, args) => {
				spellReferenceRequests++;
				if (command === "load_spell_components")
					return [
						{
							id: 1,
							name: "Lead Scarab",
							artwork: {
								kind: "ready",
								spec: { kind: "spell-component", base: 1 },
							},
						},
						{
							id: 188,
							name: "Prismatic Taper",
							artwork: {
								kind: "ready",
								spec: { kind: "spell-component", base: 188 },
							},
						},
					];
				if (spellReferenceGate !== null) await spellReferenceGate;
				const ids = z
					.object({ request: z.object({ spellIds: z.array(z.number()) }) })
					.parse(args).request.spellIds;
				return ids.map((id) =>
					id === 999999
						? { kind: "missing", id }
						: {
								kind: "known",
								id,
								name:
									id === 2000
										? "Harm Other I"
										: id === 2001
											? "Impenetrability I"
											: `Spell ${String(id).padStart(4, "0")} ${id % 2 === 0 ? "Frost Protection Self" : "Acid Protection Other"}`,
								details: {
									castingRoute:
										id !== 2000 && id % 2 === 0
											? "self-target"
											: "selected-target",
									description: "Fixture spell description.",
									school: id === 2000 ? 5 : id % 2 === 0 ? 2 : 3,
									usesProjectileHandler: id === 2000,
									baseMana: 10,
									manaPerTarget: 2,
									durationSeconds: 60,
									classification: {
										beneficial: id !== 2000,
										level: ((id - 1) % 8) + 1,
										recipient: "creature",
										fellowship: false,
										damage:
											id === 2000
												? "direct"
												: id === 2001
													? "misc"
													: id % 2 === 0
														? "frost"
														: "acid",
									},
								},
								artwork: {
									kind: "ready",
									spec: {
										kind: "spell",
										base: id,
										background: 1,
										effects: 2,
										overlay: null,
									},
								},
							},
				);
			},
		});
		const spellState = new ClientSpellState(
			interactionLifecycle,
			references,
			icons,
		);
		spells = spellState;
		probeBrowserInput(keyboard, inputGate);
		void interactionLifecycle.start();
		const overlayObservation = observeMinimapOverlayArcCalls();
		readMinimapOverlayArcCalls = overlayObservation.read;
		const harnessGlobal = globalThis as typeof globalThis & {
			__HOLTBURGER_3D_CLIENT_HUD_HARNESS__: ClientHudHarnessApi | undefined;
		};
		harnessGlobal.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__ = {
			probeTargeting: () => probeClientTargeting(keyboard),
			beginKeyboardProbe: () => {
				keyboardFixture = installKeyboardPolicyFixture(keyboard, inputGate);
			},
			keyboardProbe: () => {
				if (keyboardFixture === null)
					throw new Error("Keyboard fixture has not been installed.");
				return keyboardFixture;
			},
			probeInventory,
			probeWorldContainer: async () => {
				// Match ClientApp's feedback composition for server-refused transfer fixtures.
				const unsubscribe = interactionLifecycle.subscribe((event) => {
					if (event.type === "action-feedback")
						inventoryToasts.publish(event.feedback);
				});
				try {
					return await probeWorldContainer({
						emit: emitInteractionEvent,
						selection,
						interactions: itemInteractions,
						commands: interactionCommands,
					});
				} finally {
					unsubscribe();
				}
			},
			beginItemUseProbe: () => {
				beginItemUseProbe();
			},
			itemUseProbe: () => {
				if (activeItemUseProbe === null) throw new Error("No item-use probe");
				return activeItemUseProbe;
			},
			spellBarProbe,
			combatBarProbe,
			probeSpells: () =>
				probeClientSpells(
					emitInteractionEvent,
					holdSpellReferences,
					(ids) => references.load(ids),
					() => spellReferenceRequests,
				),
			objectInspectionProbe: () => objectInspectionProbe,
			inventoryDragCommands: () => interactionCommands,
			selectInventoryItem: (guid) =>
				selection.selectContentsItem(guid, "select"),
			giveProbe,
			deferNextInventorySubmission: () => {
				deferInventorySubmission = true;
			},
			rejectDeferredInventorySubmission: () => {
				if (rejectInventorySubmission === null)
					throw new Error("No deferred inventory submission");
				rejectInventorySubmission(
					new Error("Injected late submission failure"),
				);
				rejectInventorySubmission = null;
			},
			replyInventoryPreview: (result) =>
				emitInteractionEvent("client-inventory-preview", result),
			probeThemeApplication,
			probeSelectedDiagnostics,
			probeInteractableMarker,
			measureDoorBar,
			probeSelectedInteractions,
			probeCharacterVitals,
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
			objectInspectionProbe.end();
			unsubscribeObjectInspection();
			objectInspectionOwner.destroy();
			keyboardFixture?.dispose();
			spellState.destroy();
			references.dispose();
			spells = null;
			inventoryOwner.destroy();
			containerOwner.destroy();
			worldContainer = null;
			unsubscribeInventoryToasts();
			inventoryToasts.destroy();
			inventory = null;
			icons.dispose();
			itemInteractions.destroy();
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
		{appearanceOptions}
		onAppearanceOptionChange={async (option, enabled) => {
			appearanceOptions = {
				...appearanceOptions,
				[option === "helmet" ? "showHelmet" : "showCloak"]: enabled,
			};
		}}
		inspectionPreviewHeight={userSettings.inspection.previewHeight}
		onInspectionPreviewHeightChange={(previewHeight) =>
			(userSettings = {
				...userSettings,
				inspection: { previewHeight },
			})}
		objectPreviewService={{
			open: () => ({
				dispose: async () => undefined,
				diagnostics: () => null,
				ready: Promise.resolve(),
				setViewport: () => undefined,
			}),
		}}
		itemSession={interactionLifecycle}
		hudLayout={userSettings.hudLayout}
		onHudLayoutChange={(hudLayout) =>
			(userSettings = { ...userSettings, hudLayout })}
		spellBarShape={userSettings.spellBarShape}
		onSpellBarShapeChange={(spellBarShape) =>
			(userSettings = { ...userSettings, spellBarShape })}
		minimapViewDiameters={userSettings.minimapViewDiameters}
		onMinimapViewDiametersChange={(minimapViewDiameters) =>
			(userSettings = { ...userSettings, minimapViewDiameters })}
		chatFilters={userSettings.chatFilters}
		onChatFiltersChange={(chatFilters) =>
			(userSettings = { ...userSettings, chatFilters })}
		actionBars={characterSettings?.actionBars ?? null}
		onActionBarsChange={(actionBars) => {
			if (characterSettings !== null)
				characterSettings = { ...characterSettings, actionBars };
		}}
		{hudMode}
		onHudModeChange={(mode) => (hudMode = mode)}
		{spellBar}
		onSpellBarChange={(state) => (spellBar = state)}
		{spellBarEnabled}
		onSelectSpellTab={selectSpellTab}
		onActivateSpellCell={activateSpellCell}
		combatMode={spellCombatMode}
		{combatStatus}
		combatControls={characterSettings?.combatControls ?? {
			melee: { height: "medium", power: 0.5 },
			missile: { height: "medium", accuracy: 0.5 },
		}}
		onCombatProfileSelect={(profile) => {
			updateCombatProfile(profile);
			combatBarProbe.active(profile.kind);
		}}
		combatEnabled={true}
		onToggleCombat={() => {}}
		onCastSpell={(id) => void castSpell(id)}
		{itemInteractions}
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
		onInventoryNotice={(message) => {
			toast = { id: 1, message, tone: "status" };
		}}
		onPickInventoryTarget={(_x, _y, destination) => {
			if (inventoryWorldResult === null)
				pendingInventoryWorldPick = destination;
			else if (destination.isCurrent())
				destination.commit(inventoryWorldResult);
		}}
		onViewportSelect={(x, y) => {
			viewportSelectionPoints.push({ x, y });
			selectEntity(7);
		}}
		onViewportExamine={(x, y) => {
			viewportSelectionPoints.push({ x, y });
			selectEntity(7);
			void objectInspectionOwner.examine(7);
		}}
		onViewportHover={(x, y) => {
			viewportHoverPoints.push({ x, y });
			// The item-use fixture supplies explicit hit-test results through hoverWorld.
			if (activeItemUseProbe === null) hoveredGuid = hoverHitEnabled ? 7 : null;
		}}
		onViewportHoverClear={() => (hoveredGuid = null)}
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
		readSelectedEntityDisplay={() => interactions.display(unrestrictedUse)}
		{spells}
		{inventory}
		{worldContainer}
		onSelectContentsItem={(guid, mode) =>
			selection.selectContentsItem(guid, mode)}
		onInteractEntity={() => itemInteractions.interactSelected(unrestrictedUse)}
		{objectInspection}
		onExamineEntity={examineHarnessSelection}
		onExamineItem={examineHarnessItem}
		onCloseInspection={() => objectInspectionOwner.close()}
		selectedEntityGuid={selectedGuid}
		hoveredEntityGuid={hoveredGuid}
		showRetailHiddenGeometry={false}
		onShowRetailHiddenGeometryChange={() => undefined}
		playerName="Alice"
		worldName="ACE Emulator"
		vitals={[
			{ kind: "health", current: 1_555, maximum: 12_555 },
			{ kind: "stamina", current: 210, maximum: 245 },
			{ kind: "mana", current: 1_302, maximum: 4_100 },
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
