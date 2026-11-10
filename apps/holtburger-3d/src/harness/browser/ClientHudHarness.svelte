<script lang="ts">
	import { STAT_ICON_FIXTURE } from "./stat-icon-fixture";
	import { clientChatRequestSchema } from "../../client/client-host-contract";
	import { applyUiScale } from "../../app/ui-scale";
	import UiTooltipHost from "../../app/UiTooltipHost.svelte";
	import { provideClientHudGeometry } from "../../client/client-hud-geometry-context";
	import { clientMinimapLandmark } from "../../client/client-minimap-policy";
	import { CameraLookController } from "../../lib/game/controls/camera-look-controller";
	import { createCameraAxesRadians } from "../../lib/game/math/camera-orientation";
	import gameplayPreferencesFixture from "./fixtures/gameplay-preferences.json";
	import {
		clientUiSettingsSchema,
		type ClientUserSettings,
	} from "../../client/client-settings-contract";
	import { createFixtureThemeSettings } from "./ui-showcase-themes";
	import UiShowcaseWorkbench from "./UiShowcaseWorkbench.svelte";
	import {
		SHOWCASE_CHARACTER_SHEET,
		SHOWCASE_WAYPOINT,
		SHOWCASE_ITEM_GUID_BASE,
		SHOWCASE_ENCHANTMENTS,
		SHOWCASE_VITAL_KINDS,
		showcaseActionBars,
		type ShowcasePanel,
		type UiShowcaseSession,
	} from "./ui-showcase-fixture";
	import { provideItemCooldowns } from "../../app/item-cooldowns.svelte";
	import { createSalvageFixture } from "./client-salvage-fixture";
	import { ClientLocksState } from "../../client/client-locks-state";
	import { ClientSalvageState } from "../../client/client-salvage-state";
	import "../../client/client-canvas.css";
	import { createClientMouseMovementFixture } from "./client-mouse-movement-fixture";
	import { soulEmoteFixture } from "../../client/client-soul-emotes.test-support";
	import {
		ClientRestPostureController,
		REST_POSTURE_LABELS,
		handleRestPostureKeydown,
	} from "../../client/client-rest-posture-controller";
	import type { RestPosture } from "../../lib/game/runtime/dynamic-entity-feed";
	import { ClientEmoteController } from "../../client/client-emote-controller";
	import { emotePlaybackFixture } from "./client-emote-fixture";
	import { decodeClientCombatMode } from "../../client/client-host-contract";
	import { RenderSceneInterestController } from "../../lib/game/runtime/render-scene-interest-controller";
	import { nearbySceneInterest } from "../../client/client-nearby.test-support";
	import { runClientHelpCommand } from "../../client/client-command-help";
	import { runClientVersionCommand } from "../../client/client-version-command";
	import { runClientCopyEntityCommand } from "../../client/client-copy-entity-command";
	import {
		PARTY_HUD_PREVIEW,
		PARTY_HUD_MAXIMUM_COLUMNS,
		readPartyHudGeometry,
		presentPartyHud,
	} from "../../client/client-party-hud";
	import type { PartySnapshot } from "../../client/client-party-contract";
	import { probeHudAttention } from "./client-hud-attention-probe";
	import { probeVitalWarnings } from "./client-vital-warning-probe";
	import {
		MINIMUM_JUMP_POWER,
		type ClientVital,
	} from "../../client/client-host-contract";
	import { CLIENT_UI_DEFAULTS } from "../../client/client-ui-defaults";
	import { ClientHousingManagementState } from "../../client/client-housing-management-state";
	import {
		emptyHousing,
		housingSnapshotSchema,
		housingManagementResultSchema,
		type HousingSnapshot,
	} from "../../client/client-housing-contract";
	import { ClientTradeState } from "../../client/client-trade-state";
	import { createTradeFixture } from "./client-trade-fixture";
	import { createBarberFixture } from "./client-barber-fixture";
	import { ClientBarberState } from "../../client/client-barber-state";
	import { createVendorFixture } from "./client-vendor-fixture";
	import { ClientVendorState } from "../../client/client-vendor-state";
	import { ClientHouseCrystalState } from "../../client/client-house-crystal-state";
	import { createHousingFixture } from "./client-housing-fixture";
	import { ClientWorldContainerPanelState } from "../../client/client-world-container-panel-state";
	import { handleCombatBarKeydown } from "../../client/client-combat-bar-input";
	import { handleSpellBarKeydown } from "../../client/client-spell-bar-input";
	import type {
		CombatBreakpointIndex,
		CombatHeightIndex,
		InputDigitIndex,
		ClientInputConfiguration,
	} from "../../lib/input/input-contract";
	import {
		COMBAT_BREAKPOINTS,
		COMBAT_HEIGHTS,
		RECKLESSNESS_RANGE,
	} from "../../client/client-combat-bar-state";
	import {
		bindSpellCell,
		initialSpellBar,
	} from "../../client/client-spell-bar-state";
	import { findWieldedCasterSpell } from "../../client/client-inventory-equipment";
	import { z } from "zod";
	import { spellInspectionQuerySchema } from "../../client/client-spell-inspection-contract";
	import { SpellReferences } from "../../app/spell-references";
	import {
		ClientSpellState,
		type ClientSpellServices,
	} from "../../client/client-spells";
	import type { ResolvedEnchantments } from "../../client/client-enchantments-contract";
	import type { ClientTimedEnchantments } from "../../client/client-lifecycle-session";
	import { resolveClientSpellCastAim } from "../../client/client-spell-casting";
	import { probeClientSpells } from "./client-spells-probe";
	import type {
		ClientEntityFacts,
		ProjectileSupply,
	} from "../../client/client-entity-mirror";
	import {
		CASTER_EQUIP_MASK,
		EQUIPMENT_SLOTS,
		inventoryEquipment,
	} from "../../client/client-inventory-equipment";
	import type {
		ClientViewportTargetDestination,
		ClientViewportTargetResult,
	} from "../../client/client-pointer-selection-controller";
	import { createInputDefaults } from "../../lib/input/input-defaults";
	import { entityFacts } from "../../client/client-entity-mirror.test-support";
	import { probeClientBindings } from "./client-binding-probe";
	import {
		clientKeyboardSettingsEqual,
		clientInputSettingsSchema,
		clientInputConfiguration,
	} from "../../client/client-input-settings";
	import { AppInput } from "../../lib/input/app-input";
	import { provideClientInput } from "../../client/client-input-context";
	import {
		itemUseRequestSchema,
		itemUseResultSchema,
		itemUseTargetResultSchema,
	} from "../../client/client-item-use-contract";
	import { ClientItemInteractions } from "../../client/client-item-interactions";
	import { probeClientTargeting } from "./client-targeting-probe";
	import type { ClientInventoryPreviewResult } from "../../client/client-inventory-contract";
	import { isLogopolisCommand } from "../../client/client-logopolis";
	import { installKeyboardPolicyFixture } from "./keyboard-policy-fixture";
	import { clientSelectedEntity } from "../../client/client-selected-entity";
	import { ClientPartyState } from "../../client/client-party-state";
	import { probeAllegiance } from "./client-allegiance-probe";
	import { probeSquelch } from "./client-squelch-probe";
	import { probeUiScaling } from "./ui-scaling-probe";
	import { probeSelectedActions } from "./client-selected-actions-probe";
	import {
		contractsUpdatedSchema,
		type ContractsSnapshot,
	} from "../../client/client-contracts-contract";
	import contractFixture from "./fixtures/contracts.json";
	import { probeContractMap } from "./client-contracts-map-probe";
	import { probeContracts } from "./client-contracts-probe";
	import { probeFriends } from "./client-friends-probe";
	import { probeParty } from "./client-party-probe";
	import { probeWorldContainer } from "./client-world-container-probe";
	import { probeClientLocks } from "./client-locks-probe";
	import { probeClientInventory } from "./client-inventory-probe";
	import type { DynamicEntityMapBlipCategory } from "../../lib/game/map/map-blip-category";
	import { probeBoomCameraCorrection } from "./boom-camera-probe";
	import { probeClientAudio } from "./client-audio-probe";
	import ClientMessageDialog from "../../client/ClientMessageDialog.svelte";
	import {
		ClientDialogs,
		type ClientDialogPresentation,
	} from "../../client/client-dialogs";
	import { provideAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import { probeBrowserInput } from "./input-browser-probe";
	import { probeClientEnvironment } from "./client-environment-probe";
	import {
		bindClientPresentationEnvironment,
		clientWeatherPresets,
		createClientServerEnvironmentSource,
	} from "../../client/client-environment";
	import {
		clientEnvironmentFixture,
		ENVIRONMENT_FIXTURE_DAY_SECONDS,
	} from "../../client/client-environment.test-support";
	import type { ClientEnvironmentOverrides } from "../../client/client-environment-settings";
	import {
		getAllContexts,
		mount,
		onMount,
		tick,
		unmount,
		untrack,
	} from "svelte";
	import ClientHousingManagement from "../../client/ClientHousingManagement.svelte";
	import { ClientSelectedEntityTracking } from "../../client/client-selected-entity-tracking";
	import { probeClientNearby } from "./client-nearby-probe";
	import { ClientNearby } from "../../client/client-nearby";
	import { CLIENT_NEARBY_TUNING } from "../../client/client-tuning";
	import { ClientEntitySelection } from "../../client/client-entity-selection";
	import { ClientLifecycleSession } from "../../client/client-lifecycle-session";
	import { captureLoadout } from "../../client/client-loadout";
	import type { ClientActionFeedback } from "../../client/client-host-contract";
	import {
		ClientBookReader,
		type ClientBookReaderState,
	} from "../../client/client-book-reader";
	import type {
		ClientBook,
		ClientBookOpened,
	} from "../../client/client-book-contract";
	import {
		ClientInspection,
		type ClientInspectionState,
	} from "../../client/client-inspection";
	import {
		decodeObjectInspectionResult,
		type ObjectInspectionResult,
	} from "../../client/client-object-inspection-contract";
	import {
		CLIENT_CONNECTION_BADGE_TUNING,
		CLIENT_WAYPOINT_NEAR_RADIUS_METERS,
		CLIENT_TUNING,
	} from "../../client/client-tuning";
	import { recordSentChat } from "../../client/client-chat-input-history";
	import { selectedChatRecipient } from "../../client/client-chat-compose";
	import { ClientChatComposer } from "../../client/client-chat-composer.svelte";
	import { uiThemes } from "../../app/mount";
	import { steelUrl } from "./ui-showcase-themes";
	import type { FrameRates } from "../../app/frame-rate-sampler";
	import { ClientInventoryState } from "../../client/client-inventory-state";
	import { browserUiIconRepository } from "../../app/ui-icon-repository";
	import { createClientShortcuts } from "../../client/ClientShortcutDock.svelte";
	import ClientGameplayView from "../../client/ClientGameplayView.svelte";
	import { createWorldMapFixture } from "./world-map-fixture";
	import { probeWorldMapLifetime } from "./client-world-map-lifetime-probe";
	import {
		clientChatShouldSuppress,
		type ClientChatEntry,
		type ClientChatLine,
	} from "../../client/client-chat-policy";
	import type {
		ClientAttackProfile,
		ClientChatMessage,
		ClientChatRequest,
		ClientChatTellTarget,
		ClientCombatMode,
		ClientCombatStatus,
	} from "../../client/client-host-contract";
	import {
		probeClientWaypoint,
		type WaypointProbeControls,
	} from "./client-waypoint-probe";
	import type { MapWaypointTarget } from "../../lib/game/map/map-waypoint";
	import { ClientNavigationWaypointOwner } from "../../client/client-navigation-waypoint";
	import type { MinimapFrame } from "../../app/minimap-frame";
	import type { MapEntity } from "../../lib/game/map/map-blips";
	import { Mat4 } from "../../lib/game/math/types";
	import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
	import type { ScenePlacement } from "../../lib/game/scene";
	import type { ClientGameplayPresentationDiagnostics } from "../../client/client-gameplay-presentation";
	import {
		ClientToastCenter,
		CLIENT_TOAST_DURATION_MS,
		type ClientToast,
	} from "../../client/client-toast-center";
	import {
		CLIENT_AUDIO_DEFAULTS,
		createDefaultClientCharacterSettings,
		createDefaultClientUserSettings,
	} from "../../client/client-settings-defaults";
	interface Props {
		/** Render the interactive showcase around the same client fixture used by probes. */
		readonly showcase?: boolean;
	}
	const { showcase = false }: Props = $props();
	/** Ready commands are installed only after the real fixture session starts. */
	let showcaseStartupError = $state<string | null>(null);
	let showcaseActions = $state<Omit<
		UiShowcaseSession,
		| "vitals"
		| "warningsEnabled"
		| "editable"
		| "jumpExtent"
		| "jumpActive"
		| "waypointEnabled"
	> | null>(null);
	const fixtureTheme = createFixtureThemeSettings((id) => {
		userSettings = { ...userSettings, ui: { ...userSettings.ui, themeId: id } };
	});

	/** Mounted production panel owner for keyboard routing diagnostics. */
	let gameplayView = $state<ClientGameplayView | null>(null);
	let gameplayCanvas = $state<HTMLCanvasElement | null>(null);
	let interactionRoot = $state<HTMLElement | null>(null);
	let warningVitals = $state<readonly ClientVital[]>([
		{ kind: "health", current: 1_555, maximum: 12_555 },
		{ kind: "stamina", current: 210, maximum: 245 },
		{ kind: "mana", current: 1_302, maximum: 4_100 },
	]);
	let vitalWarningsEnabled = $state(true);
	let partyHudPresent = $state(false);
	let spellBar = $state(initialSpellBar());
	const environmentRegion = clientEnvironmentFixture();
	let environmentSeconds: number | null = ENVIRONMENT_FIXTURE_DAY_SECONDS * 1.9;
	const environmentServer = createClientServerEnvironmentSource(
		environmentRegion,
		() => environmentSeconds,
	);
	environmentServer.refresh(0);
	const environmentPresets = clientWeatherPresets(environmentRegion);
	/** Binding is imperative; only its cold mismatch message enters markup. */
	let environmentIssue = $state<string | null>(null);
	const initialUserSettings = createDefaultClientUserSettings(
		{ width: window.innerWidth, height: window.innerHeight },
		9,
		"windows",
	);
	// Fixtures mount Base; the interactive showcase selects the client default during startup.
	let userSettings = $state.raw<ClientUserSettings>({
		...initialUserSettings,
		ui: { ...initialUserSettings.ui, themeId: null },
	});
	const clientInput = provideClientInput(
		new AppInput(
			clientInputConfiguration(
				untrack(() => userSettings.input),
				"windows",
			),
		),
	);
	// Initialize the imperative binding once; controls replace it without reactive reconstruction.
	let environmentBinding = bindClientPresentationEnvironment(
		environmentServer,
		environmentRegion,
		untrack(() => userSettings.environmentOverrides),
	);
	function changeEnvironmentOverrides(
		environmentOverrides: ClientEnvironmentOverrides,
	): void {
		userSettings = { ...userSettings, environmentOverrides };
		environmentBinding = bindClientPresentationEnvironment(
			environmentServer,
			environmentRegion,
			environmentOverrides,
		);
		environmentIssue = environmentBinding.issue;
	}
	const characterInput = clientInput.characterContext((_action, pressed) => {
		if (pressed) locks?.cancel();
	});
	function changeInput(input: ClientInputConfiguration) {
		const accepted = clientInputSettingsSchema.parse(input);
		if (!clientKeyboardSettingsEqual(userSettings.input, accepted)) {
			keyboard.cancel();
			characterInput.replaceBindings(accepted.character);
			clientInput.replaceConfiguration(
				clientInputConfiguration(accepted, "windows"),
			);
		}
		userSettings = { ...userSettings, input: accepted };
		return accepted;
	}
	async function probeBindings() {
		const targeting = await probeClientTargeting(keyboard);
		const previousSpellTarget = interactionLifecycle.state().spellCastTarget;
		try {
			emitInteractionEvent("client-spell-cast-target-updated", { target: 7 });
			if (interactionLifecycle.state().spellCastTarget !== 7)
				throw new Error(
					"Browser session did not retain the accepted spell target.",
				);
			emitInteractionEvent("client-spell-cast-target-updated", {
				target: null,
			});
			if (interactionLifecycle.state().spellCastTarget !== null)
				throw new Error("Browser session retained a completed cast target.");
		} finally {
			emitInteractionEvent("client-spell-cast-target-updated", {
				target: previousSpellTarget,
			});
		}
		const previous = userSettings.input;
		emitInteractionEvent("client-entity-facts-changed", {
			projectileSupply: null,
			salvage: null,
			worldContainer: null,
			upserts: [91, 95].map((guid) =>
				entityFacts(guid, {
					ownedByPlayer: true,
					location: {
						kind: "contained",
						parentGuid: 1,
						slot: { kind: "pending" },
					},
				}),
			),
			removed: [],
		});
		const fixture = beginItemUseProbe();
		fixture.select(91);

		try {
			await fixture.ready();
			const bindings = await probeClientBindings({
				context: partyProbeContext,
				keyboard,
				initial: previous,
				accept: changeInput,
				interact: () => itemInteractions.interactSelected(false),
				submissions: () =>
					interactionCommands.filter(
						(command) => command.command === "submit_client_item_use",
					).length,
			});
			return { ...bindings, targeting, spellCastTargetLifecycle: true };
		} finally {
			fixture.destroy();
			changeInput(previous);
		}
	}
	let characterSettings = $state.raw<ReturnType<
		typeof createDefaultClientCharacterSettings
	> | null>(createDefaultClientCharacterSettings());
	let characterSettingsGuid: number | null = 1;
	let hudMode = $state<"runtime" | "layout">("runtime");
	let spellCombatMode = $state<ClientCombatMode>("peace");
	let combatStatus = $state<ClientCombatStatus>({
		desired: null,
		state: "idle",
		processedIntentSequence: 0,
		refill: null,
	});
	const spellBarEnabled = $derived(
		spellCombatMode === "magic" && hudMode === "runtime",
	);
	function selectSpellTab(selected: InputDigitIndex): void {
		spellBar = { ...spellBar, selected };
	}
	function activateSpellCell(slot: number): void {
		const id = spellBar.tabs[spellBar.selected][slot];
		if (
			spellBarEnabled &&
			id !== null &&
			interactionLifecycle.state().knownSpells?.includes(id)
		)
			void castSpell(id);
	}
	function activateCasterSpell(): void {
		if (!spellBarEnabled || inventory === null) return;
		const caster = findWieldedCasterSpell(inventory.readItems().items.values());
		if (caster !== null) itemInteractions.castWieldedSpell(caster.item);
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
	function seedSpellBar(): void {
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
	}
	const spellBarProbe = {
		caster: (spell: number | null, wielded: boolean) => {
			const read = interactionLifecycle.entities.read();
			if (read.kind !== "current") throw new Error("Current entities required");
			// Own this fixture rather than depending on an earlier inventory probe's equipment.
			const source = savedCaster ?? entityFacts(95);
			if (source.description.kind !== "known")
				throw new Error("Caster fixture required");
			savedCaster = source;
			emitInteractionEvent("client-entity-facts-changed", {
				projectileSupply: null,
				salvage: null,
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
				lockpickSuccessPercent: null,
			});
		},
		restoreCaster: () => {
			if (savedCaster === null) throw new Error("No saved caster fixture");
			itemInteractions.cancel();
			emitInteractionEvent("client-entity-facts-changed", {
				projectileSupply: null,
				salvage: null,
				worldContainer: null,
				upserts: [savedCaster],
				removed: [],
			});
			savedCaster = null;
		},
		begin: () => {
			seedSpellBar();
			releaseSpellKeys = keyboard.bindGame({
				keydown: (event) => {
					handleSpellBarKeydown(
						clientInput,
						event,
						spellBarEnabled,
						selectSpellTab,
						activateSpellCell,
						activateCasterSpell,
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
		bind: (slot: number, spell: number | null) => {
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
		theme: async (alternate: boolean) => {
			await uiThemes.replace(alternate ? steelUrl : null, null);
		},
		end: () => {
			releaseSpellKeys?.();
			releaseSpellKeys = null;
			spellCombatMode = "peace";
			hudMode = "runtime";
			emitInteractionEvent("client-combat-mode-updated", { mode: "peace" });
		},
	};
	let releaseCombatKeys: (() => void) | null = null;
	const combatBarProbe = {
		/** Production range and selection route for exact endpoint checks. */
		range: RECKLESSNESS_RANGE,
		select: selectCombatProfile,
		/** Exercise the shipped copper gauge as well as the plain theme. */
		theme: (id: string | null) => fixtureTheme.applyPreview(id, false),
		/** Feed training changes through the production character-sheet owner while its panel is closed. */
		recklessness: async (
			training: "Unusable" | "Untrained" | "Trained" | "Specialized" | null,
		) => {
			interactionLifecycle.characterSheet.replace({
				...SHOWCASE_CHARACTER_SHEET,
				skills:
					training === null
						? []
						: [
								{
									description: null,
									availableInEor: true,
									stat: {
										skill_type: "Recklessness",
										training,
										ranks: 0,
										init: 0,
										spent_xp: 0,
										next_rank_xp: null,
										base: 0,
										current: 0,
										trained_cost: 4,
										specialized_cost: 2,
										breakdown: {
											formula: "NoFormula",
											base_bonuses: [],
											current_bonuses: [],
											vitae: 1,
											modifiers: {
												contributions: [],
												multiplier: 1,
												additive: 0,
											},
											wide_modifiers: [],
											wide_additive_rounded: 0,
											finalization: {
												before_rounding: 0,
												rounded: 0,
												minimum: 0,
												result: 0,
											},
										},
									},
								},
							],
			});
			await new Promise((resolve) =>
				setTimeout(resolve, CLIENT_TUNING.characterSheet.displayIntervalMs * 2),
			);
		},
		/** Exercise the same cold UI preference passed to the production HUD. */
		help: (showHelpLabels: boolean) => {
			userSettings = {
				...userSettings,
				ui: { ...userSettings.ui, showHelpLabels },
			};
		},
		/** Runtime tuning used by indexed binding assertions. */
		breakpoints: COMBAT_BREAKPOINTS,
		/** Supply enters through the production semantic mirror, not component-local state. */
		supply: async (supply: ProjectileSupply) => {
			emitInteractionEvent("client-entity-facts-changed", {
				projectileSupply: supply,
				salvage: {
					skills: {
						salvagingSkill: 0,
						tinkeringSkill: 0,
						augmentationBonusSalvage: 0,
					},
				},
				worldContainer: null,
				upserts: [],
				removed: [],
			});
			await new Promise((resolve) =>
				setTimeout(resolve, CLIENT_TUNING.inventory.displayIntervalMs * 2),
			);
		},
		begin: (mode: "melee" | "missile") => {
			hudMode = "runtime";
			spellCombatMode = mode;
			selectedGuid = 7;
			combatStatus = {
				desired: null,
				state: "idle",
				processedIntentSequence: 0,
				refill: null,
			};
			releaseCombatKeys?.();
			releaseCombatKeys = keyboard.bindGame({
				keydown: (event) => {
					handleCombatBarKeydown(
						clientInput,
						event,
						true,
						selectCombatBreakpoint,
						selectCombatHeight,
					);
				},
				keyup: () => {},
				cancel: () => {},
			});
			keyboard.returnToGame();
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
				processedIntentSequence: 0,
				refill: { elapsedMs: 350, durationMs: 1000 },
			};
		},
		status: () => combatStatus,
		end: () => {
			releaseCombatKeys?.();
			releaseCombatKeys = null;
			spellCombatMode = "peace";
			combatStatus = {
				desired: null,
				state: "idle",
				processedIntentSequence: 0,
				refill: null,
			};
		},
	};
	let combatProfileSelectionRevision = $state(0);
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
	function selectCombatProfile(profile: ClientAttackProfile): void {
		updateCombatProfile(profile);
		combatProfileSelectionRevision += 1;
		combatBarProbe.active(profile.kind);
		combatStatus = { ...combatStatus, desired: { target: 7, profile } };
	}
	function selectCombatBreakpoint(index: CombatBreakpointIndex): void {
		if (characterSettings === null) return;
		const value = COMBAT_BREAKPOINTS[index];
		if (spellCombatMode === "melee")
			selectCombatProfile({
				kind: "melee",
				...characterSettings.combatControls.melee,
				power: value,
			});
		else if (spellCombatMode === "missile")
			selectCombatProfile({
				kind: "missile",
				...characterSettings.combatControls.missile,
				accuracy: value,
			});
	}
	function selectCombatHeight(index: CombatHeightIndex): void {
		if (characterSettings === null) return;
		const height = COMBAT_HEIGHTS[index];
		if (spellCombatMode === "melee")
			selectCombatProfile({
				kind: "melee",
				...characterSettings.combatControls.melee,
				height,
			});
		else if (spellCombatMode === "missile")
			selectCombatProfile({
				kind: "missile",
				...characterSettings.combatControls.missile,
				height,
			});
	}

	const { viewport: inputGate, keyboard } = provideAppInputPolicy();
	// Standalone HUD probes inherit the geometry owner normally provided by ClientGameplayView.
	provideClientHudGeometry();
	const partyProbeContext = getAllContexts();
	const worldMapFixture = createWorldMapFixture();
	/** Cold authority fixtures for Housing tab/map acceptance through production components. */
	let housingCharacterGuid = $state<number | null>(1);
	let housing = $state<HousingSnapshot>(emptyHousing());
	let housingRefreshes = 0;
	const housingSearches: number[] = [];

	interface ClientHudHarnessRectangle {
		readonly height: number;
		readonly left: number;
		readonly top: number;
		readonly width: number;
	}
	/** Input evidence shared by focused gesture and inventory checks. */
	interface ClientHudHarnessState {
		/** Bounds used to drive real game-canvas pointer handlers. */
		readonly gameCanvas: ClientHudHarnessRectangle;
		/** Camera deltas emitted by drag classification. */
		readonly orbitDeltas: readonly { readonly x: number; readonly y: number }[];
		/** Left-clicks consumed by precise-jump mode. */
		readonly preciseJumpActivationCount: number;
		/** Aim refreshes distinguish click jitter from deliberate camera movement. */
		readonly preciseJumpAimCount: number;
		/** Identity currently selected through production interaction owners. */
		readonly selectedGuid: number | null;
		/** Completed viewport activations sent to entity acquisition. */
		readonly viewportSelectionPoints: readonly {
			readonly interact: boolean;
			readonly x: number;
			readonly y: number;
		}[];
	}

	let gameplayPreferences = $state({ ...gameplayPreferencesFixture });
	let deferGameplayUpdate = false;
	let pendingGameplayUpdate: (() => void) | null = null;
	let appearanceOptions = $state({ showHelmet: true, showCloak: true });
	/** Session-local diagnostic use policy exercised through the production panel. */
	let unrestrictedUse = $state(false);
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
			projectileSupply: null,
			salvage: null,
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
		const releaseKeys = keyboard.bindGame({
			keydown: (event) => {
				if (clientInput.shortcut("interact", event)) {
					event.preventDefault();
					if (!event.repeat) itemInteractions.interactSelected(false);
				} else if (
					clientInput.shortcut("cancel", event) &&
					itemInteractions.cancel()
				)
					event.preventDefault();
				else characterInput.apply(event, true);
			},
			keyup: (event) => {
				characterInput.apply(event, false);
			},
			cancel: () => {
				itemInteractions.cancelTargeting();
				characterInput.reset();
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
					projectileSupply: null,
					salvage: null,
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
					projectileSupply: null,
					salvage: null,
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
					projectileSupply: null,
					salvage: null,
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
					projectileSupply: null,
					salvage: null,
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
			interactBinding: createInputDefaults("windows").client.interact[0],
			alternateModifier: createInputDefaults("windows").actionBars.alternate,
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
				emitInteractionEvent("client-entity-facts-changed", {
					projectileSupply: null,
					salvage: null,
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
	const probeInventory = () => {
		// The inventory baseline has no enchantments; clear the retained HUD fixture too.
		enchantments = null;
		return probeClientInventory({
			readInput: () => userSettings.input,
			changeInput,
			emit: emitInteractionEvent,
			selection,
			commands: interactionCommands,

			prepareTellRecipient: (guid) => {
				const read = interactionLifecycle.entities.read();
				chatComposer.setSelection(
					selectedChatRecipient(
						guid,
						guid !== null && read.kind === "current"
							? read.level.entities.get(guid)
							: undefined,
					),
				);
			},
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
	};

	let logopolisLaunchRevision = $state(0);
	let keyboardFixture: ReturnType<typeof installKeyboardPolicyFixture> | null =
		null;
	interface ClientHudHarnessApi {
		/** Production composer/session boundary with controlled synthetic incoming messages and failures. */
		readonly chat: {
			readonly setPartyPresent: (present: boolean) => void;
			readonly reset: () => void;
			/** Focus a fresh entity tag for native browser keyboard activation checks. */
			readonly prepareEntityKeyboard: () => Promise<void>;
			/** Recreate the composer from synthetic saved user settings. */
			readonly restart: () => Promise<void>;
			readonly select: (target: ClientChatTellTarget | null) => void;
			/** Set the production selection used by entity debugging commands. */
			readonly selectEntity: (guid: number | null) => void;
			readonly receive: (message: ClientChatMessage) => void;
			readonly rejectNextSend: () => void;
			readonly rejectAfter: (successes: number) => void;
			readonly setEmotesEnabled: (enabled: boolean) => void;
			/** Inject a confirmed stance for emote availability checks. */
			readonly setCombatMode: (mode: ClientCombatMode, ready?: boolean) => void;
			readonly setMotionReady: (ready: boolean) => void;
			/** Explicit user stance intent invalidates a queued return before any acknowledgement. */
			readonly changeCombatMode: (
				mode: Exclude<ClientCombatMode, "unknown">,
			) => Promise<void>;
			/** Synthetic request outcomes from the production host contract. */
			readonly admitEmotes: () => void;
			readonly completeEmotes: () => void;
			readonly waitForEmoteTimeout: () => Promise<void>;

			readonly professorPrompt: () => void;
			readonly clearPrompt: () => void;
			readonly read: () => {
				/** Retained history used to verify suppression happens before storage. */
				readonly retainedMessages: readonly ClientChatLine[];
				readonly selectedEntity: number | null;
				readonly requests: readonly ClientChatRequest[];
				readonly destination: typeof chatComposer.destination;
				readonly recentEmotes: readonly string[];
				/** Explicit peace requests submitted by the production emote policy. */
				readonly peaceRequests: number;
				/** Captured explicit combat requests, excluding peace. */
				readonly combatRequests: readonly ClientCombatMode[];
				readonly inputAllowed: boolean;
				readonly gameActive: boolean;
				readonly reply: ClientChatTellTarget | null;
				readonly retell: ClientChatTellTarget | null;
				readonly responses: readonly {
					readonly command: string;
					readonly args?: Record<string, unknown>;
				}[];
			};
		};
		/** Append synthetic lines through the production component's real props. */
		readonly appendChatLines: (count: number) => void;
		/** Trim oldest retained lines through the same props used by the real history buffer. */
		readonly retainChatLines: (count: number) => void;
		/** Prepare text-bearing production surfaces for the coordinate-link probe. */
		readonly showWaypointContent: (
			surface: "chat" | "book" | "item" | "creature" | "contracts",
		) => Promise<void>;
		/** Focused navigation controls, using the production owner and actual map consumers. */
		readonly waypoint: WaypointProbeControls;
		/** Automated waypoint DOM and lifecycle assertions through production map consumers. */
		readonly probeWaypoint: () => ReturnType<typeof probeClientWaypoint>;
		/** DOM/lifecycle checks for the production party HUD, without visual acceptance. */
		readonly probePartyHud: typeof probePartyHud;
		/** Production catalog and alerts with controlled authoritative delivery. */
		readonly probeNearby: () => ReturnType<typeof probeClientNearby>;
		/** Prepare the production HUD with a full synthetic roster for literal screenshots. */
		readonly showPartyHud: typeof showPartyHud;
		/** Runtime overlay checks using real CSS and viewport hit testing. */
		readonly probeVitalWarnings: () => ReturnType<typeof probeVitalWarnings>;
		/** Themeable notification animation lifecycle, without visual acceptance. */
		readonly probeHudAttention: () => ReturnType<typeof probeHudAttention>;
		/** Deterministic production environment controls/readout integration. */
		readonly probeEnvironment: () => ReturnType<typeof probeClientEnvironment>;
		/** Replace housing without mounting a new World panel or replaying crystal intent. */
		readonly setHousing: (snapshot: unknown) => void;
		/** Match core retirement followed by a new character's complete replacement state. */
		readonly replaceHousingCharacter: (playerGuid: number) => void;
		readonly readHousingRefreshes: () => number;
		readonly readHousingSearches: () => readonly number[];
		/** Inject the existing core timeout snapshot/feedback seam. */
		readonly timeoutHousingSearch: () => void;
		/** Explicit synthetic authority for production management controls. */
		readonly readHousingManagementCommands: () => typeof interactionCommands;
		readonly finishHousingManagement: (result: unknown) => void;
		/** Remount production controls with the same session owner during a refresh. */
		readonly probeHousingManagementRemount: () => Promise<boolean>;
		/** Hold option mirroring independently of accepted transport delivery. */
		readonly deferNextGameplayUpdate: () => void;
		/** Deliver the held option update through the production control's props. */
		readonly flushGameplayUpdate: () => void;
		/** Exercise settings controls and real browser audio independently of inventory fixtures. */
		readonly probeAudio: () => ReturnType<typeof probeAudioControls>;
		readonly setMapTeleportPermission: (allowed: boolean) => void;
		readonly readMapTeleports: () => typeof interactionCommands;
		/** Hold and advance synthetic map generation to verify progress markup deterministically. */
		readonly holdWorldMapPreparation: () => void;
		readonly advanceWorldMapPreparation: () => void;
		readonly releaseWorldMapPreparation: () => void;
		/** Mount and retire production map overlays while tile reads remain pending. */
		readonly probeWorldMapLifetime: () => ReturnType<
			typeof probeWorldMapLifetime
		>;
		/** Requests made by the retained World-panel fixture. */
		readonly readWorldMapFixture: () => ReturnType<
			typeof worldMapFixture.read
		> & { readonly sceneZooms: number; readonly sceneOrbits: number };
		/** Verify keyboard acquisition through the real browser input boundary. */
		readonly probeTargeting: () => ReturnType<typeof probeClientTargeting>;
		/** Install a real DOM fixture for CDP keyboard and pointer events. */
		readonly beginKeyboardProbe: () => void;
		/** Production posture input and toast fixture for native browser events. */
		readonly beginRestPostureProbe: () => ReturnType<
			typeof beginRestPostureProbe
		>;
		/** Read the currently installed keyboard fixture. */
		readonly keyboardProbe: () => ReturnType<
			typeof installKeyboardPolicyFixture
		>;
		/** Verify live inventory, shared placement, geometry, selection, and recovery. */
		readonly probeInventory: typeof probeInventory;
		readonly probeLocks: () => ReturnType<typeof probeClientLocks>;
		/** Salvage authority replies exercise the production window and session. */
		readonly salvageProbe: ReturnType<typeof createSalvageFixture>;
		/** Synthetic replies through the real barber editor and HUD. */
		readonly barberProbe: ReturnType<typeof createBarberFixture>;
		/** Synthetic replies through the real vendor session and HUD. */
		readonly vendorProbe: ReturnType<typeof createVendorFixture>;
		/** Synthetic profiles and payment quotes through production session decoding. */
		readonly housingProbe: ReturnType<typeof createHousingFixture>;
		readonly tradeProbe: ReturnType<typeof createTradeFixture>;
		readonly probeAllegiance: () => ReturnType<typeof probeAllegiance>;
		readonly probeSquelch: () => ReturnType<typeof probeSquelch>;
		/** Change the production UI preference for external geometry probes. */
		readonly setUiScale: (scale: number) => void;
		/** Verify overall UI scale and additional text enlargement across retained UI and native dialogs. */
		readonly probeUiScaling: () => ReturnType<typeof probeUiScaling>;
		/** Verify accepted Settings changes, shortcut presentation, and feature dispatch. */
		readonly probeBindings: typeof probeBindings;
		/** Route real browser presses to the production main-panel owner. */
		readonly bindSystemPanelKeys: () => () => void;
		/** Production arbiter and semantic mouse port for real DOM movement probes. */
		readonly mouseMovement: {
			fixture: typeof mouseFixture;
			/** Production camera math resolves pointer deltas to a direction for input assertions. */
			lookDirection: typeof mouseLookDirection;
			resetLook: () => void;
			/** Whether production mouse input currently owns camera orbit. */
			orbitHeld: () => boolean;
			rearFollowEntries: () => number;
		};
		/** Accepted settings seam for focused browser remapping scenarios. */
		readonly bindingSettings: {
			read: () => ClientInputConfiguration;
			replace: typeof changeInput;
		};
		/** Verify selected HUD direct actions and icon-labeled popup commands. */
		readonly probeSelectedActions: () => ReturnType<
			typeof probeSelectedActions
		>;
		readonly probeContractMap: () => ReturnType<typeof probeContractMap>;
		readonly probeContracts: () => ReturnType<typeof probeContracts>;
		readonly probeFriends: () => ReturnType<typeof probeFriends>;
		readonly probeParty: () => ReturnType<typeof probeParty>;
		readonly probeWorldContainer: () => ReturnType<typeof probeWorldContainer>;
		/** Exercise spell membership, artwork reuse, and panel teardown. */
		readonly probeSpells: () => Promise<unknown>;
		/** Deliver a shared resolved snapshot through the real browser session event path. */
		readonly setEnchantments: (resolved: ResolvedEnchantments) => void;
		/** Count content requests to detect accidental polling-driven retries. */
		readonly spellReferenceRequests: () => number;
		/** Fail the next reference batch before returning immutable definitions. */
		readonly failNextSpellReferences: () => void;
		/** Inject coherent character facts and correlated quotes through session listeners. */
		readonly setCharacterSheet: (sheet: unknown) => void;
		/** Exercise portal admission through the production lifecycle listener. */
		readonly setCharacterPortalSpace: (active: boolean) => void;
		readonly replyProgression: (evaluation: unknown) => void;
		readonly replyProgressionFeedback: (feedback: unknown) => void;
		readonly retireCharacterSheet: (lateSheet: unknown) => boolean;
		/** Hold one enchantment metadata response across session retirement. */
		readonly deferEnchantmentReferences: () => void;
		readonly releaseEnchantmentReferences: () => void;
		readonly resyncEnchantments: () => void;
		readonly reconnectEnchantments: () => void;
		/** Controlled delayed responses around the production examination owner and UI. */
		readonly objectInspectionProbe: () => ObjectInspectionProbe;
		/** Inject decoded book receipts through the real session-to-reader HUD path. */
		readonly bookProbe: {
			readonly open: (receipt: ClientBookOpened) => void;
			readonly update: (book: ClientBook) => void;
			readonly read: () => ClientBookReaderState;
			readonly requests: () => typeof interactionCommands;
			readonly close: () => void;
			readonly retry: () => void;
			readonly failNextRequest: () => void;
		};
		/** Production spell shortcut dispatch and session requests under browser input. */
		readonly spellBarProbe: typeof spellBarProbe;
		/** Render and manipulate the production melee/missile HUD without a live server. */
		readonly combatBarProbe: typeof combatBarProbe;
		/** Controlled sigil activation exercises production drop admission. */
		readonly aetheriaDropProbe: typeof aetheriaDropProbe;
		/** Inspect real session requests while CDP drives production inventory pointers. */
		readonly inventoryDragCommands: () => typeof interactionCommands;
		/** Controlled incoming facts exercise production pack context menus and toast decoding. */
		readonly autoMergeProbe: {
			readonly begin: () => void;
			readonly resync: () => void;
			readonly feedback: (feedback: ClientActionFeedback) => void;
			readonly toast: () => ReturnType<ClientToastCenter["snapshot"]>;
			readonly timing: typeof CLIENT_TUNING.inventory.autoMerge;
		};
		/** Observe immutable captures and exercise failure feedback without a live server. */
		readonly loadoutProbe: typeof loadoutProbe;
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
		/** Verify action warning presentation independently of selected-entity fixtures. */
		readonly probeActionFeedback: typeof probeActionFeedback;
		readonly probeConnectionBadge: typeof probeConnectionBadge;
		readonly capture: () => ClientHudHarnessState;
		/** Restore deterministic interaction inputs and clear recorded output. */
		readonly resetSelectionFixture: () => void;
		/** Toggle precise-jump pointer ownership. */
		readonly setPreciseJumpActive: (active: boolean) => void;
		/** Verify real viewport wheel ownership in precise/manual and blocked states. */
		readonly probePreciseJumpWheel: () => Promise<{ passed: boolean }>;
	}

	const jumpFixture = new URLSearchParams(window.location.search).get("jump");
	let jumpChargeActive = $state(
		jumpFixture === "charging" || jumpFixture === "full",
	);
	let jumpExtent = $state(jumpFixture === "full" ? 1 : 0.45);
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
	/** Wheel power requests captured only by the focused routing probe. */
	const preciseJumpPowerSteps: number[] = [];
	let preciseJumpActivationCount = 0;
	/** Counts aim publication for the precise click/drag ownership probe. */
	let preciseJumpAimCount = 0;
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
	let releaseEnchantmentReferences: (() => void) | null = null;
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
	let enchantments = $state.raw<ClientTimedEnchantments | null>(null);
	const itemCooldowns = provideItemCooldowns();
	$effect(() => {
		itemCooldowns.replace(
			enchantments === null
				? null
				: {
						cooldowns: enchantments.resolved.cooldowns,
						receivedAtMs: enchantments.receivedAtMs,
					},
		);
	});
	let salvage = $state<ClientSalvageState | null>(null);
	let locks = $state<ClientLocksState | null>(null);
	$effect(() => {
		if (!userSettings.ui.useUnlockHelper) locks?.close();
	});
	let inventory = $state<ClientInventoryState | null>(null);
	let barber = $state<ClientBarberState | null>(null);
	let vendor = $state<ClientVendorState | null>(null);
	let houseCrystal = $state<ClientHouseCrystalState | null>(null);
	let housingManagement = $state<ClientHousingManagementState | null>(null);
	let trade = $state<ClientTradeState | null>(null);
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
	let canTeleportFromMap = $state(false);
	/** Establish actual session facts for the mounted HUD and its interaction probes. */
	function emitInteractionBaseline(
		playerGuid = 1,
		contracts: ContractsSnapshot | null = null,
	): void {
		const playerName = playerGuid === 1 ? "Wayfarer" : "Wayfarer II";
		emitInteractionEvent("client-current-state", {
			lifecycle: { kind: "in-world" },
			characterManagement: { kind: "idle" },
			playerVisualCapture: null,
			entityCollisionDisabled: false,
			canTeleportFromMap: false,
			recallDestinations: [],
			housing: emptyHousing(),
			localPlayerGuid: playerGuid,
			serverTime: 10,
			worldGeneration: 1,
			connection: null,
			worldName: "Fixture",
			accountName: "Fixture account",
			playerName,
			knownSpells: null,
			enchantments: null,
			appearanceOptions,
			gameplayPreferences,
			party: null,
			partyPreferences: null,
			friends: null,
			contracts,
			squelch: null,
			allegiance: {
				playerGuid: null,
				profile: null,
				refreshing: false,
				canSwear: false,
			},
			allegiancePreferences: null,
			friendsPreferences: null,
			combatMode: "peace",
			socialMotionReady: true,
			combat: {
				desired: null,
				state: "idle",
				processedIntentSequence: 0,
				refill: null,
			},
			spellCastTarget: null,
			vitals: [],
			characterSheet: null,
			barber: { interaction: null, result: null, particles: null },
			trade: { trade: null, pending_items: [] },
			characterMotion: null,
			activeConfirmation: null,
			dynamic: { hostTime: { seconds: 10 }, entities: [] },
			entities: {
				projectileSupply: { kind: "not-applicable" },
				salvage: {
					skills: {
						salvagingSkill: 0,
						tinkeringSkill: 0,
						augmentationBonusSalvage: 0,
					},
				},
				worldContainer: { kind: "closed" },
				entities: [playerGuid, 7, 8].map((guid) => ({
					guid,
					nearby: null,
					description: {
						kind: "known",
						name: guid === playerGuid ? playerName : "Drudge",
						healthQuery: "eligible",
						itemType: 0,
						hasAlternateEquipSide: false,
						builtInSpell: null,
						mapCategory: "other",
						objectFlags: 0,
						wcid: guid === 7 ? 42 : null,
						pyrealBalance: null,
						aetheriaActivation: null,
						burden: null,
						equipLocations: null,
						consumable: null,
						useCapability: "direct",
						cooldown: null,
						stackCount: null,
						structure: { current: null, max: null },
						icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
					},
					location: { kind: "none" },
					ownedByPlayer: false,
					canPickUp: false,
					worldContainerContent: false,
					canReceiveGive: false,
					canTrade: false,
					canOfferTrade: false,
					vendorSale: null,
					lockTool: null,
					isLocked: null,
					salvage: {
						kind: "ineligible",
						reason: "Fixture item cannot be salvaged.",
					},
					targeting: "non-creature",
					playerThreat: false,
					corpse: null,
					scenePlacement: "available",
					storage:
						guid === playerGuid
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

	let failNextBookPageRequest = false;
	let chatSuccessesBeforeFailure: number | null = null;
	const emoteFeedbackRequests = new Set<number>();
	const interactionLifecycle = new ClientLifecycleSession({
		listen: async (event, handler) => {
			interactionHandlers.set(event, handler);
			return () => {
				interactionHandlers.delete(event);
			};
		},
		invoke: async (command, args) => {
			interactionCommands.push({ command, args });
			if (
				command === "send_client_chat" &&
				chatSuccessesBeforeFailure !== null
			) {
				if (chatSuccessesBeforeFailure === 0) {
					chatSuccessesBeforeFailure = null;
					throw new Error("Injected chat enqueue failure");
				}
				chatSuccessesBeforeFailure--;
			}
			if (command === "send_client_chat") {
				const request = clientChatRequestSchema.parse(args?.request);
				if (request.kind === "soul-emote" && request.requestId !== undefined)
					emoteFeedbackRequests.add(request.requestId);
			}
			if (command === "read_client_book_page" && failNextBookPageRequest) {
				failNextBookPageRequest = false;
				throw new Error("Injected page request failure");
			}
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
	const nearbyScene = new RenderSceneInterestController();
	nearbyScene.replace(nearbySceneInterest("0x0001ffff", "outdoor"));
	const nearbyOwner = new ClientNearby({
		session: interactionLifecycle,
		now: () => Date.now(),
		timing: CLIENT_NEARBY_TUNING,
		appendChat: (entry) => {
			appendChat(entry);
		},
		saveRules: (rules) => {
			if (characterSettings !== null)
				characterSettings = { ...characterSettings, entityAlerts: rules };
		},
	});
	nearbyOwner.setSceneMembership(nearbyScene);
	nearbyOwner.acceptSettings({
		kind: "ready",
		characterGuid: 1,
		generation: 1,
		settings: createDefaultClientCharacterSettings(),
		lastKnownName: null,
	});

	let publishLoadoutFeedback:
		((feedback: ClientActionFeedback) => void) | null = null;
	const loadoutProbe = {
		capture: () => captureLoadout(interactionLifecycle.entities.read()),
		bars: () => characterSettings?.actionBars,
		restore: (settings: NonNullable<typeof characterSettings>) =>
			(characterSettings = settings),
		settings: () => characterSettings,
		fail: async (
			equipment: readonly { item: number | null; target: number }[],
		) => {
			const publish = publishLoadoutFeedback;
			if (publish === null)
				throw new Error("Loadout toast probe is not mounted");
			const unsubscribe = interactionLifecycle.subscribe((event) => {
				if (event.type === "action-feedback") publish(event.feedback);
			});
			try {
				emitInteractionEvent("client-action-feedback", {
					message: "The server rejected the equipment request",
					tone: "warning",
					equipment,
				});
				await tick();
			} finally {
				unsubscribe();
			}
		},
	};
	// Feed the real Social window as well as the isolated domain probes.
	const socialParty = new ClientPartyState(
		interactionLifecycle,
		(message) => {
			throw new Error(message);
		},
		() => {},
	);
	let inspection = $state<ClientInspectionState>({ kind: "idle" });
	let bookReader = $state<ClientBookReaderState>({ kind: "idle" });
	const bookReaderOwner = new ClientBookReader(interactionLifecycle);
	const unsubscribeBookReader = bookReaderOwner.subscribe(
		(state) => (bookReader = state),
	);
	let inspectionFailure = $state<string | null>(null);
	const inspectionOwner = new ClientInspection(
		interactionLifecycle,
		(message) => {
			inspectionFailure = message;
			toast = { id: 9001, message, tone: "warning" };
		},
	);
	const unsubscribeInspection = inspectionOwner.subscribe(
		(state) => (inspection = state),
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
		beginSalvage: (tool) => {
			if (salvage === null)
				throw new Error("Salvage fixture owner is not mounted.");
			salvage.openTool(tool);
		},
		beginTrade: (partner) => trade?.open(partner),
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
	/** Original authority retained while CDP exercises sigil drop admission. */
	let aetheriaDropRecords: readonly ClientEntityFacts[] = [];
	const aetheriaDropProbe = {
		setActivation: (activated: boolean | null) => {
			const slot = EQUIPMENT_SLOTS.find(
				(slot) => "activation" in slot && slot.activation === "red",
			);
			if (slot === undefined) throw new Error("Red aetheria slot missing");
			const read = interactionLifecycle.entities.read();
			if (read.kind !== "current")
				throw new Error("Aetheria fixture requires current authority");
			if (aetheriaDropRecords.length === 0) {
				aetheriaDropRecords = [1, 91].map((guid) => {
					const record = read.level.entities.get(guid);
					if (record?.description.kind !== "known")
						throw new Error("Aetheria fixture record missing");
					return record;
				});
			}
			emitInteractionEvent("client-entity-facts-changed", {
				projectileSupply: null,
				salvage: null,
				worldContainer: null,
				removed: [],
				upserts: aetheriaDropRecords.map((record) => {
					if (record.description.kind !== "known")
						throw new Error("Aetheria fixture requires known descriptions");
					return {
						...record,
						description:
							record.guid === 1
								? {
										...record.description,
										aetheriaActivation:
											activated === null
												? null
												: { blue: false, yellow: false, red: activated },
									}
								: { ...record.description, equipLocations: slot.mask },
					};
				}),
			});
		},
		restore: () => {
			emitInteractionEvent("client-entity-facts-changed", {
				projectileSupply: null,
				salvage: null,
				worldContainer: null,
				removed: [],
				upserts: aetheriaDropRecords,
			});
			aetheriaDropRecords = [];
		},
	};

	let pendingInventoryWorldPick: ClientViewportTargetDestination | null = null;
	let releaseGiveKeys: (() => void) | null = null;
	const giveProbe = {
		binding: createInputDefaults("windows").client.give[0],
		begin: () => {
			const read = interactionLifecycle.entities.read();
			if (read.kind !== "current")
				throw new Error("Give fixture requires current entities");
			const recipient = read.level.entities.get(91);
			if (recipient?.description.kind !== "known")
				throw new Error("Give fixture recipient missing");
			emitInteractionEvent("client-entity-facts-changed", {
				projectileSupply: null,
				salvage: null,
				worldContainer: null,
				upserts: [
					{
						...recipient,
						guid: 7,
						canReceiveGive: true,
						canTrade: false,
						canOfferTrade: false,
						lockTool: null,
						isLocked: null,
						salvage: {
							kind: "ineligible",
							reason: "Fixture item cannot be salvaged.",
						},
						ownedByPlayer: false,
						location: { kind: "none" },
						scenePlacement: "available",
						targeting: "creature",
						playerThreat: false,
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
					if (clientInput.shortcut("give", event) && !event.isComposing) {
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
				projectileSupply: null,
				salvage: null,
				worldContainer: null,
				upserts: [],
				removed: [guid],
			});
			return source;
		},
		restoreSource: (source: ClientEntityFacts) =>
			emitInteractionEvent("client-entity-facts-changed", {
				projectileSupply: null,
				salvage: null,
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
				projectileSupply: null,
				salvage: null,
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

	type InspectionResponseKind =
		| "locked"
		| "item"
		| "item-maximum"
		| "item-zero"
		| "item-plain"
		| "consumable"
		| "consumable-depletion"
		| "healing-kit"
		| "creature"
		| "rejected"
		| "unavailable"
		| "missing";
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
		readonly state: ClientInspectionState;
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
		crosstalk(): Promise<{
			readonly backgroundIsolation: true;
			readonly sharedCancellation: true;
		}>;
		readonly binding: ReturnType<
			typeof createInputDefaults
		>["client"]["examine"][number];
		begin(): void;
		end(): void;
		select(guid: number | null): void;
		respond(kind: InspectionResponseKind, guid: number): void;
		deferSpellReferences(): void;
		releaseSpellReferences(): void;
		resync(): void;
		restore(): void;
		setArtworkFailure(failed: boolean): void;
		snapshot(): ObjectInspectionProbeSnapshot;
	}

	function inspectionResult(
		kind: InspectionResponseKind,
		guid: number,
	): ObjectInspectionResult {
		if (kind === "locked") {
			const result = inspectionResult("item-plain", guid);
			if (
				result.outcome.kind !== "ready" ||
				result.outcome.inspection.details.kind !== "item"
			)
				throw new Error("Expected an item inspection fixture");
			const inspection = result.outcome.inspection;
			const item = result.outcome.inspection.details.details;
			return {
				...result,
				outcome: {
					kind: "ready",
					inspection: {
						...inspection,
						name: "Harness Locked Chest",
						details: {
							kind: "item",
							details: {
								...item,
								status: { ...item.status, isLocked: true },
								lockpicking: { difficulty: 250, successPercent: 0 },
							},
						},
					},
				},
			};
		}
		if (
			kind === "consumable" ||
			kind === "consumable-depletion" ||
			kind === "healing-kit"
		) {
			const result = inspectionResult("item-plain", guid);
			if (
				result.outcome.kind !== "ready" ||
				result.outcome.inspection.details.kind !== "item"
			)
				throw new Error("Expected an item inspection fixture");
			return {
				...result,
				outcome: {
					kind: "ready",
					inspection: {
						...result.outcome.inspection,
						name:
							kind === "healing-kit" ? "Harness Healing Kit" : "Harness Potion",
						details: {
							kind: "item",
							details: {
								...result.outcome.inspection.details.details,
								useEffect:
									kind === "healing-kit"
										? {
												kind: "healing-kit",
												skillBonus: 50,
												restorationMultiplier: 1.3,
											}
										: {
												kind: "vital-change",
												vital: "Stamina",
												amount: kind === "consumable" ? 50 : -20,
											},
								spells:
									kind === "healing-kit" ? [] : [{ id: 2001, role: "on-use" }],
							},
						},
					},
				},
			};
		}
		if (kind === "unavailable")
			return decodeObjectInspectionResult({
				guid,
				outcome: { kind, reason: "unsupported item XP style: 3" },
			});
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
						description: waypointContentProbeEnabled
							? "Meet at 40.0N, 20.0E."
							: "An adventurer fixture with disclosed character appraisal details.",
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
									allegianceRank: { rank: 3, title: "Baroness" },
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
					description: waypointContentProbeEnabled
						? `Meet at 42.1N, 33.6E. ${longItemDescription} Finish at 1.2S, 3.4W.`
						: longItemDescription,
					level: 80,
					details: {
						kind: "item",
						details: {
							progression:
								kind === "item-plain"
									? null
									: {
											level:
												kind === "item-maximum"
													? 5
													: kind === "item-zero"
														? 0
														: 2,
											maxLevel: 5,
											totalXp:
												kind === "item-maximum"
													? "3100000000"
													: kind === "item-zero"
														? "0"
														: "350000000",
											advancement:
												kind === "item-maximum"
													? { kind: "maximum", maxLevelXp: "3100000000" }
													: {
															kind: "advancing",
															levelStartXp:
																kind === "item-zero" ? "0" : "300000000",
															nextLevelXp:
																kind === "item-zero"
																	? "100000000"
																	: "700000000",
														},
										},
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
							lockpicking: null,
							lockTool: null,
							status: {
								bonded: "bonded",
								attuned: "Attuned",
								retained: true,
								isOpen: null,
								isLocked: null,
								sellable: false,
								ivoryable: true,
								dyeable: true,
								unenchantable: true,
							},
							stack: { current: 3, max: 10 },
							cooldown: null,
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
							equipmentSet: { id: 13, name: "Soldier's" },
							gearRatings: [
								{ kind: "critical-damage", value: 3 },
								{ kind: "max-health", value: 25 },
							],
							portalLevels: {
								minimum: 80,
								maximum: { kind: "level", level: 150 },
							},
							lifetime: {
								lifespanSeconds: 10800,
								remaining: { kind: "remaining", seconds: 3600 },
							},
							manaStone: { efficiency: 0.8, destructionChance: 0 },
							gems: { count: 2, material: "Ruby" },
							attribution: {
								craftsman: "Harness Crafter",
								tinker: "Harness Tinker",
								imbuer: null,
								plating: null,
							},
							useRequirements: [
								{
									type: "skill",
									data: {
										skill: "Summoning",
										requirement: {
											kind: "training",
											training: "specialized",
											minimum: 570,
										},
									},
								},
								{ type: "level", data: { level: 180 } },
								{
									type: "attribute",
									data: { attribute: "self", minimum: 295 },
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
								text: waypointContentProbeEnabled
									? "Remember 0.00S, 0.0W."
									: "May this blade remember every long road through Dereth, every fellowship at its side, and every hand that kept its edge bright.",
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
							useEffect: null,
							portalDestination: "Holtburg (42.1N, 33.6E).",
							portalRestrictions: ["no-recall-or-tie", "no-summon"],
							useText: "Use this item to recall to a remembered sanctuary.",
							spells: [
								{ id: 2000, role: "active-enchantment" as const },
								{ id: 2000, role: "triggered" as const },
								{ id: 2001, role: "item" as const },
								{ id: 2002, role: "item" as const },
								{ id: 2003, role: "item" as const },
								{ id: 2004, role: "item" as const },
								{ id: 2005, role: "item" as const },
								{ id: 999999, role: "item" as const },
							],
						},
					},
				},
			},
		});
	}

	let releaseInspectionKeys: (() => void) | null = null;
	let releaseInspectionSpellReferences: (() => void) | null = null;
	let inspectionCommandOffset = 0;
	function examineHarnessSelection(): void {
		const guid = selection.selectedGuid();
		if (guid !== null) void inspectionOwner.examine(guid);
	}
	function examineHarnessItem(guid: number): void {
		void inspectionOwner.examine(guid);
	}
	const objectInspectionProbe: ObjectInspectionProbe = {
		async crosstalk() {
			inspectionOwner.close();
			await inspectionOwner.examine(7);
			emitInteractionEvent(
				"client-object-inspection-result",
				inspectionResult("item", 7),
			);
			const visible = inspectionOwner.read();
			const previousFailure = inspectionFailure;
			for (const [kind, guid] of [
				["rejected", 7],
				["item", 7],
				["missing", 8],
			] as const) {
				let delivered = false;
				await interactionLifecycle.appraisals.request(guid, () => {
					delivered = true;
				}).sent;
				emitInteractionEvent(
					"client-object-inspection-result",
					inspectionResult(kind, guid),
				);
				if (
					!delivered ||
					inspectionOwner.read() !== visible ||
					inspectionFailure !== previousFailure
				)
					throw new Error(
						"Background appraisal changed the inspector presentation.",
					);
			}
			let delivered = false;
			const shared = interactionLifecycle.appraisals.request(7, () => {
				delivered = true;
			});
			await shared.sent;
			const beforeJoin = interactionCommands.length;
			await inspectionOwner.examine(7);
			if (interactionCommands.length !== beforeJoin)
				throw new Error("Inspector duplicated shared appraisal work.");
			inspectionOwner.close();
			emitInteractionEvent(
				"client-object-inspection-result",
				inspectionResult("item", 7),
			);
			await tick();
			if (!delivered || inspectionOwner.read().kind !== "idle")
				throw new Error(
					"Closing the inspector cancelled background work or reopened the window.",
				);
			return { backgroundIsolation: true, sharedCancellation: true };
		},
		binding: createInputDefaults("windows").client.examine[0],
		begin: () => {
			releaseInspectionKeys?.();
			inspectionOwner.close();
			inspectionFailure = null;
			inspectionCommandOffset = interactionCommands.length;
			selection.select(null);
			releaseInspectionKeys = keyboard.bindGame({
				keydown: (event) => {
					if (!clientInput.shortcut("examine", event) || event.isComposing)
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
			releaseInspectionSpellReferences?.();
			releaseInspectionSpellReferences = null;
			inspectionOwner.close();
			selection.select(null);
		},
		select: (guid) => selection.select(guid),
		respond: (kind, guid) =>
			emitInteractionEvent(
				"client-object-inspection-result",
				inspectionResult(kind, guid),
			),
		deferSpellReferences: () => {
			if (releaseInspectionSpellReferences !== null)
				throw new Error("Inspection spell references are already deferred.");
			releaseInspectionSpellReferences = holdSpellReferences();
		},
		releaseSpellReferences: () => {
			if (releaseInspectionSpellReferences === null)
				throw new Error("Inspection spell references are not deferred.");
			releaseInspectionSpellReferences();
			releaseInspectionSpellReferences = null;
		},
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
				state: inspectionOwner.read(),
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
		const previousDialogs = dialogOwner;
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
				rejection: null,
				maxSlots: 11,
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
			dialogOwner = previousDialogs;
			dialogPresentation = previousDialogs?.snapshot() ?? null;
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
			"Select a target before attacking.",
			"Select a valid target before attacking.",
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
				message: "The Iron Chest is locked",
				tone: "warning",
			});
			emitInteractionEvent("client-action-feedback", {
				message: "Using the Iron Chest",
				tone: "progress",
			});
			await tick();
			const lockWarning = Array.from(
				document.querySelectorAll('.client-toast[role="alert"]'),
			).find(
				(element) => element.textContent?.trim() === "The Iron Chest is locked",
			);
			if (
				center.snapshot()?.message !== "The Iron Chest is locked" ||
				lockWarning === undefined
			)
				throw new Error("Use progress replaced the chest lock warning.");
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

	async function probeAudioControls() {
		document
			.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')
			?.click();
		await tick();
		const tab = document.querySelector<HTMLButtonElement>(
			"#settings-tab-audio",
		);
		if (!tab) throw new Error("Audio settings tab missing");
		tab.click();
		await tick();
		const panel = document.querySelector<HTMLElement>(
			"#settings-section-audio",
		);
		if (!panel) throw new Error("Audio settings panel missing");
		const sliders = [
			...panel.querySelectorAll<HTMLInputElement>('input[type="range"]'),
		];
		const keys = [
			"masterVolume",
			"effectVolume",
			"ambientVolume",
			"musicVolume",
		] as const;
		if (sliders.length !== keys.length)
			throw new Error("Audio sliders missing");
		const mix = {
			...CLIENT_AUDIO_DEFAULTS,
			masterVolume: 0.4,
			musicVolume: 0.3,
			effectVolume: 0.6,
			ambientVolume: 0.2,
		};
		for (const [index, key] of keys.entries()) {
			const slider = sliders[index];
			if (!slider) throw new Error(`Audio slider missing: ${key}`);
			slider.value = String(mix[key]);
			slider.dispatchEvent(new Event("input", { bubbles: true }));
			await tick();
		}
		const mute = panel.querySelector<HTMLInputElement>(
			'input[type="checkbox"]',
		);
		const reset = panel.querySelector<HTMLButtonElement>("button");
		if (!mute || !reset) throw new Error("Audio mute or reset missing");
		mute.click();
		await tick();
		if (
			!userSettings.audio.muted ||
			keys.some((key) => userSettings.audio[key] !== mix[key])
		)
			throw new Error("Mute discarded the audio mix");
		mute.click();
		await tick();
		if (
			userSettings.audio.muted ||
			keys.some((key) => userSettings.audio[key] !== mix[key])
		)
			throw new Error("Unmute discarded the audio mix");
		reset.click();
		await tick();
		if (
			userSettings.audio.muted !== CLIENT_AUDIO_DEFAULTS.muted ||
			keys.some((key) => userSettings.audio[key] !== CLIENT_AUDIO_DEFAULTS[key])
		)
			throw new Error("Audio reset did not restore declared defaults");
		return {
			settings: { ...userSettings.audio },
			playback: await probeClientAudio(),
		};
	}

	/** Read capture geometry from the same CSS probe used by the production resize boundary. */
	function partyScreenshotGeometry() {
		const probe = document.querySelector<HTMLElement>(
			".party-hud-theme-metrics",
		);
		if (probe === null) throw new Error("Party theme metric probe is missing");
		const gap = Number.parseFloat(getComputedStyle(probe).rowGap);
		if (!Number.isFinite(gap))
			throw new Error("Party screenshot grid gap must resolve to a CSS length");
		return { ...readPartyHudGeometry(probe), gap };
	}

	async function showPartyHud(columns: number) {
		if (
			!Number.isInteger(columns) ||
			columns < 1 ||
			columns > PARTY_HUD_MAXIMUM_COLUMNS
		)
			throw new Error("Party screenshot columns must be between one and four");
		emitInteractionBaseline();
		const teammates = [
			["Aelwyn Stormweaver", 216, 120, 72],
			["Borin Ironhand", 108, 144, 36],
			["Cerys", 168, 64, 114],
			["Dain", 60, 104, 60],
			["Elora", 240, 88, 96],
			["Fenric", 144, 32, 54],
			["Galen", 192, 136, 18],
			["Hestia", 84, 96, 84],
		] as const;
		const party: PartySnapshot = {
			name: "Screenshot party",
			leader: 2,
			shareXp: true,
			evenShare: true,
			open: false,
			locked: false,
			capabilities: {
				isLeader: false,
				canRecruit: false,
				canChangeOpenness: false,
			},
			members: [
				{
					guid: 1,
					name: "Player",
					level: 10,
					canManage: false,
					vitals: [240, 160, 120, 240, 160, 120],
				},
				...teammates.map(
					(
						[name, health, stamina, mana],
						index,
					): PartySnapshot["members"][number] => ({
						guid: index + 2,
						name,
						level: 10,
						canManage: false,
						vitals: [health, stamina, mana, 240, 160, 120],
					}),
				),
			],
		};
		emitInteractionEvent("client-party-updated", { party });
		hudMode = "runtime";
		vitalWarningsEnabled = false;
		await tick();
		const geometry = partyScreenshotGeometry();
		const rows = Math.ceil(teammates.length / columns);
		userSettings = {
			...userSettings,
			hudLayout: {
				...userSettings.hudLayout,
				partyHud: {
					horizontal: { alignment: "start", offset: 400 },
					vertical: { alignment: "start", offset: 32 },
					preferredWidth:
						columns * geometry.cellSize.width + (columns - 1) * geometry.gap,
					preferredHeight:
						rows * geometry.cellSize.height + (rows - 1) * geometry.gap,
				},
			},
		};
		await new Promise<void>((resolve) =>
			setTimeout(resolve, CLIENT_TUNING.partyHud.displayIntervalMs * 2),
		);
		const panel = document.querySelector<HTMLElement>(
			'[aria-label="Party HUD"]',
		);
		const grid = panel?.querySelector<HTMLElement>(".party-hud");
		if (panel === null || grid === null || grid === undefined)
			throw new Error("Party screenshot surface is missing");
		if (grid.querySelectorAll(".party-member").length !== teammates.length)
			throw new Error("Party screenshot does not contain eight teammates");
		if (
			getComputedStyle(grid).gridTemplateColumns.split(" ").length !== columns
		)
			throw new Error("Party screenshot has the wrong column count");
		const rect = panel.getBoundingClientRect();
		const content = grid.getBoundingClientRect();
		if (content.width > rect.width || content.height > rect.height)
			throw new Error("Party screenshot bounds do not include all teammates");
		return {
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
			scale: 2,
		};
	}

	async function probePartyHud() {
		const previousMode = hudMode;
		const previousParty = interactionLifecycle.partySnapshot();
		const previousPlacement = userSettings.hudLayout.partyHud;
		const settle = () =>
			new Promise<void>((resolve) =>
				setTimeout(resolve, CLIENT_TUNING.partyHud.displayIntervalMs * 2),
			);
		const rows = () => document.querySelectorAll(".party-hud .party-member");
		const snapshot: PartySnapshot = {
			leader: 1,
			members: Array.from({ length: 9 }, (_, index) => ({
				guid: index + 1,
				name: index === 0 ? "Player" : `Teammate ${index}`,
				level: 10,
				canManage: index !== 0,
				vitals: [25, 50, 75, 100, 100, 100],
			})),
			name: "Combat fixture",
			shareXp: true,
			evenShare: true,
			open: false,
			locked: false,
			capabilities: {
				isLeader: true,
				canRecruit: false,
				canChangeOpenness: true,
			},
		};
		const replace = (party: PartySnapshot | null) =>
			emitInteractionEvent("client-party-updated", { party });
		try {
			hudMode = "runtime";
			replace(null);
			await settle();
			if (rows().length !== 0)
				throw new Error("Party HUD visible without membership");
			const commandStart = interactionCommands.length;
			hudMode = "layout";
			await settle();
			const geometry = partyScreenshotGeometry();
			if (rows().length !== PARTY_HUD_PREVIEW.members.length)
				throw new Error("Missing full-party layout preview");
			const previewMember = document.querySelector<HTMLButtonElement>(
				".party-hud .party-member",
			);
			if (previewMember === null || !previewMember.disabled)
				throw new Error("Layout preview admitted party target selection");
			const previewSelection = selection.selectedGuid();
			previewMember.click();
			if (selection.selectedGuid() !== previewSelection)
				throw new Error("Layout preview changed target selection");
			if (!document.querySelector('[aria-label="Party HUD"] .layout-move'))
				throw new Error("Party HUD missing placement controls");
			const panel = () => {
				const element = document.querySelector<HTMLElement>(
					'[aria-label="Party HUD"]',
				);
				if (element === null) throw new Error("Missing party HUD surface");
				return element;
			};
			const grid = () => {
				const element = panel().querySelector<HTMLElement>(".party-hud");
				if (element === null) throw new Error("Missing party HUD grid");
				return element;
			};
			const resize = panel().querySelector<HTMLElement>(
				".resize-border-bottom-right",
			);
			if (resize === null) throw new Error("Missing party HUD resize handle");
			const start = userSettings.hudLayout.partyHud;
			const bounds = resize.getBoundingClientRect();
			const point = {
				clientX: bounds.left + bounds.width / 2,
				clientY: bounds.top + bounds.height / 2,
				pointerId: 73,
				bubbles: true,
			};
			resize.dispatchEvent(
				new PointerEvent("pointerdown", { ...point, button: 0, buttons: 1 }),
			);
			window.dispatchEvent(
				new PointerEvent("pointermove", {
					...point,
					clientX: point.clientX + geometry.cellSize.width,
					clientY: point.clientY + geometry.cellSize.height,
					buttons: 1,
				}),
			);
			window.dispatchEvent(
				new PointerEvent("pointerup", { ...point, button: 0 }),
			);
			await tick();
			if (
				userSettings.hudLayout.partyHud.preferredWidth <=
					start.preferredWidth ||
				userSettings.hudLayout.partyHud.preferredHeight <= start.preferredHeight
			)
				throw new Error("Party HUD resize did not update retained placement");
			for (
				let columns = 1;
				columns <= PARTY_HUD_MAXIMUM_COLUMNS + 1;
				columns++
			) {
				userSettings = {
					...userSettings,
					hudLayout: {
						...userSettings.hudLayout,
						partyHud: {
							...start,
							preferredWidth:
								columns * geometry.cellSize.width +
								(columns - 1) * geometry.gap,
							preferredHeight: geometry.cellSize.height * 4 + geometry.gap * 3,
						},
					},
				};
				await settle();
				const actualColumns =
					getComputedStyle(grid()).gridTemplateColumns.split(" ").length;
				if (actualColumns !== Math.min(columns, PARTY_HUD_MAXIMUM_COLUMNS))
					throw new Error(
						`Party HUD column mismatch: ${actualColumns} at ${columns}`,
					);
				if (
					[...rows()].some(
						(row) =>
							row.getBoundingClientRect().height !== geometry.cellSize.height ||
							row.getBoundingClientRect().width !== geometry.cellSize.width,
					)
				)
					throw new Error("Resizing changed the fixed party cell dimensions");
			}
			userSettings = {
				...userSettings,
				hudLayout: {
					...userSettings.hudLayout,
					partyHud: {
						...start,
						preferredHeight: geometry.cellSize.height,
					},
				},
			};
			await settle();
			const roster = grid();
			const members = [...rows()];
			const lastMember = members.at(-1);
			if (
				getComputedStyle(roster).overflowX !== "visible" ||
				getComputedStyle(roster).overflowY !== "visible"
			)
				throw new Error("Party roster must paint overflow in both axes");
			if (
				lastMember === undefined ||
				lastMember.getBoundingClientRect().bottom <=
					panel().getBoundingClientRect().bottom
			)
				throw new Error(
					"Short party HUD did not expose overflowing roster rows",
				);
			roster.scrollTop = geometry.cellSize.height;
			if (roster.scrollTop !== 0)
				throw new Error("Party roster captured scrolling");
			if (
				interactionCommands
					.slice(commandStart)
					.some(
						(call) =>
							call.command === "set_client_party_updates" &&
							call.args?.enabled === true,
					)
			)
				throw new Error("Layout preview requested live updates");
			hudMode = "runtime";
			replace({ ...snapshot, members: snapshot.members.slice(0, 1) });
			await settle();
			if (rows().length !== 0)
				throw new Error("Solo party HUD visible during play");
			replace(snapshot);
			await settle();
			if (rows().length !== snapshot.members.length - 1)
				throw new Error("Off-scene party members missing");
			const clickMember = (guid: number) => {
				const button = panel().querySelector<HTMLButtonElement>(
					`[aria-label="Select Teammate ${guid - 1}"]`,
				);
				if (button === null)
					throw new Error("Missing party HUD selection button");
				return button;
			};
			const ownBars = [
				...document.querySelectorAll('.character-hud [role="meter"]'),
			].map((meter) => meter.getAttribute("aria-label"));
			const teammateBars = [
				...clickMember(7).querySelectorAll('[role="meter"]'),
			];
			if (
				ownBars.length !== 3 ||
				teammateBars.some(
					(meter, index) =>
						meter.getAttribute("aria-label") !==
						`Teammate 6: ${ownBars[index]}`,
				)
			)
				throw new Error("Party vital order differs from character vitals");
			if (
				JSON.stringify(
					teammateBars.map((meter) => meter.getAttribute("aria-valuenow")),
				) !== JSON.stringify(["25", "75", "50"])
			)
				throw new Error("Party vital order changed wire tuple meaning");
			const vital = clickMember(7).querySelector<HTMLElement>(
				".party-member__vital",
			);
			if (vital === null) throw new Error("Missing clickable party vital");
			selection.select(null);
			vital.click();
			await settle();
			if (selection.selectedGuid() !== 7)
				throw new Error("Party vital click did not select a known teammate");
			clickMember(2).click();
			await settle();
			if (selection.selectedGuid() !== 7)
				throw new Error("Off-scene teammate displaced the known selection");
			if ([...rows()].some((row) => row.textContent?.includes("Player")))
				throw new Error("Self appeared in teammate HUD");
			if (document.querySelector(".party-hud .party-member__leader"))
				throw new Error("Self leadership marked a teammate");
			replace({ ...snapshot, leader: 2 });
			await settle();
			if (!document.querySelector(".party-hud .party-member__leader"))
				throw new Error("Missing teammate leader marker");
			if (
				document.querySelectorAll(".party-hud [role=meter]").length !==
				(snapshot.members.length - 1) * 3
			)
				throw new Error("Missing party vital bars");
			replace({
				...snapshot,
				members: snapshot.members.map((member) => ({
					...member,
					vitals: [0, 0, 0, 0, 100, 100],
				})),
			});
			await settle();
			if (
				document
					.querySelector(".party-hud [role=meter]")
					?.getAttribute("aria-valuetext") !== "Unavailable"
			)
				throw new Error("Zero maximum displayed as known health");
			replace({ ...snapshot, members: snapshot.members.slice(0, 1) });
			await settle();
			if (rows().length !== 0)
				throw new Error("Party HUD survived final other-member departure");
			replace({ ...snapshot, leader: 2 });
			await settle();
			const overrides = {
				"--ui-party-cell-width": "calc(7rem + 10px)",
				"--ui-party-health-height": "1rem",
				"--ui-party-mana-height": "6px",
				"--ui-party-stamina-height": "10px",
				"--ui-party-grid-gap": "0.5rem",
				"--ui-party-name-font-size": "13px",
				"--ui-party-leader-icon-size": "14px",
			} as const;
			const root = document.documentElement;
			const previous = Object.keys(overrides).map((key) => ({
				key,
				value: root.style.getPropertyValue(key),
				priority: root.style.getPropertyPriority(key),
			}));
			try {
				for (const [key, value] of Object.entries(overrides))
					root.style.setProperty(key, value);
				await settle();
				const themed = partyScreenshotGeometry();
				const rem = Number.parseFloat(getComputedStyle(root).fontSize);
				const themedHealth =
					panel().querySelector<HTMLElement>(".ui-meter--health");
				const themedCell = panel().querySelector<HTMLElement>(".party-member");
				if (themedHealth === null || themedCell === null)
					throw new Error("Missing themed party cell");
				if (
					themed.cellSize.width !== rem * 7 + 10 ||
					themed.cellSize.height !==
						themedCell.getBoundingClientRect().height ||
					themedHealth.getBoundingClientRect().height !== rem ||
					themed.gap !== rem / 2
				)
					throw new Error(
						"Party theme geometry did not resolve changed CSS lengths",
					);
				userSettings = {
					...userSettings,
					hudLayout: {
						...userSettings.hudLayout,
						partyHud: { ...start, preferredWidth: 1000, preferredHeight: 400 },
					},
				};
				await settle();
				if (
					getComputedStyle(grid()).gridTemplateColumns.split(" ").length >
					PARTY_HUD_MAXIMUM_COLUMNS
				)
					throw new Error("Themed party grid exceeded the column cap");
				userSettings = {
					...userSettings,
					hudLayout: {
						...userSettings.hudLayout,
						partyHud: { ...start, preferredWidth: 1, preferredHeight: 1 },
					},
				};
				await settle();
				const rect = panel().getBoundingClientRect();
				if (
					rect.width !== themed.cellSize.width ||
					rect.height !== themed.cellSize.height
				)
					throw new Error(
						"Party resize minimum did not follow the active theme",
					);
				for (const kind of ["mana", "stamina"] as const) {
					const meter = panel().querySelector<HTMLElement>(
						`.ui-meter--${kind}`,
					);
					if (
						meter === null ||
						meter.getBoundingClientRect().height !==
							Number.parseFloat(overrides[`--ui-party-${kind}-height`])
					)
						throw new Error(
							`Party ${kind} row did not follow its own theme height`,
						);
				}
				const name = panel().querySelector<HTMLElement>(".party-member__name");
				const leader = panel().querySelector<HTMLElement>(
					".party-member__leader",
				);
				if (
					name === null ||
					getComputedStyle(name).fontSize !==
						overrides["--ui-party-name-font-size"]
				)
					throw new Error("Party name font did not follow the theme");
				if (
					leader === null ||
					leader.getBoundingClientRect().width !==
						Number.parseFloat(overrides["--ui-party-leader-icon-size"])
				)
					throw new Error("Party leader artwork did not follow the theme");
			} finally {
				for (const { key, value, priority } of previous) {
					if (value === "") root.style.removeProperty(key);
					else root.style.setProperty(key, value, priority);
				}
				await settle();
			}
			return {
				passed: true,
				teammates: snapshot.members.length - 1,
				themeGeometry: true,
				themeResizeMinimum: true,
			};
		} finally {
			replace(previousParty);
			userSettings = {
				...userSettings,
				hudLayout: { ...userSettings.hudLayout, partyHud: previousPlacement },
			};
			hudMode = previousMode;
			await settle();
		}
	}

	async function probeConnectionBadge() {
		const settle = () =>
			new Promise<void>((resolve) =>
				setTimeout(
					resolve,
					CLIENT_CONNECTION_BADGE_TUNING.displayIntervalMs * 2,
				),
			);
		const badge = () => {
			const element =
				document.querySelector<HTMLButtonElement>(".connection-badge");
			if (element === null) throw new Error("Connection badge is absent.");
			return element;
		};
		const sample = {
			health: "connected",
			quality: "good",
			reliability: {
				receiveRepairShare: 0,
				sendRepairShare: null,
				receiveGap: false,
			},
			sampleAgeSeconds: 0,
			receiveAgeSeconds: 0.1,
			receiveBytesPerSecond: 256,
			sendBytesPerSecond: 0,
		} as const;
		emitInteractionEvent("client-connection-updated", sample);
		await settle();
		const initial = badge().getBoundingClientRect();
		if (
			badge().dataset.health !== "connected" ||
			badge().querySelector(".receive.active") === null ||
			badge().querySelector(".send.active") !== null
		)
			throw new Error("Receive-only activity was not displayed.");
		const segment = (selector: string) => {
			const element = badge().querySelector<HTMLElement>(selector);
			if (element === null)
				throw new Error(`Missing connection segment ${selector}.`);
			return element.getBoundingClientRect();
		};
		const receive = segment(".receive");
		const send = segment(".send");
		const bars = [...badge().querySelectorAll<HTMLElement>(".quality-bar")];
		if (
			bars.length !== 3 ||
			badge().querySelectorAll(".quality-bar.lit").length !== 3 ||
			send.left >= receive.left ||
			send.top <= bars[2].getBoundingClientRect().top ||
			receive.width !== receive.height
		)
			throw new Error(
				"Quality bars and TX/RX circles were not arranged correctly.",
			);

		const nameRow = badge().parentElement;
		if (nameRow === null) throw new Error("Connection name row is absent.");

		const themeColors = [
			["--ui-connection-good-color", "rgb(20, 40, 60)"],
			["--ui-connection-fair-color", "rgb(60, 80, 100)"],
			["--ui-connection-poor-color", "rgb(100, 120, 140)"],
			["--ui-connection-activity-color", "rgb(140, 160, 180)"],
		] as const;
		const originalColors = themeColors.map(([token]) =>
			nameRow.style.getPropertyValue(token),
		);
		try {
			for (const [token, color] of themeColors)
				nameRow.style.setProperty(token, color);
			for (const [index, quality] of (
				["good", "fair", "poor"] as const
			).entries()) {
				emitInteractionEvent("client-connection-updated", {
					...sample,
					quality,
				});
				await settle();
				if (getComputedStyle(bars[0]).backgroundColor !== themeColors[index][1])
					throw new Error(
						`Theme override did not reach ${quality} connection bars.`,
					);
			}
			for (const dot of badge().querySelectorAll<HTMLElement>(".activity")) {
				if (getComputedStyle(dot).backgroundColor !== themeColors[3][1])
					throw new Error(
						"Theme override did not reach both connection activity dots.",
					);
			}
		} finally {
			for (const [index, [token]] of themeColors.entries())
				nameRow.style.setProperty(token, originalColors[index]);
		}
		const originalFontSize = nameRow.style.fontSize;
		const originalSegments = [
			badge(),
			...bars,
			...badge().querySelectorAll<HTMLElement>(".activity"),
		].map((element) => element.getBoundingClientRect());
		try {
			nameRow.style.fontSize = `${parseFloat(getComputedStyle(nameRow).fontSize) * 2}px`;
			const scaledSegments = [
				badge(),
				...bars,
				...badge().querySelectorAll<HTMLElement>(".activity"),
			].map((element) => element.getBoundingClientRect());
			for (let index = 0; index < originalSegments.length; index++) {
				const before = originalSegments[index];
				const after = scaledSegments[index];
				// Fractional CSS dimensions are rounded to browser layout units.
				if (
					Math.abs(after.width - before.width * 2) > 0.1 ||
					Math.abs(after.height - before.height * 2) > 0.1
				)
					throw new Error(
						"Connection geometry did not scale with the name row text.",
					);
			}
		} finally {
			nameRow.style.fontSize = originalFontSize;
		}
		emitInteractionEvent("client-connection-updated", {
			...sample,
			quality: "fair",
		});
		await settle();
		if (badge().querySelectorAll(".quality-bar.lit").length !== 2)
			throw new Error("Fair reliability did not illuminate two bars.");
		badge().dispatchEvent(new PointerEvent("pointerenter"));
		badge().focus();
		await tick();
		if (
			document.activeElement !== badge() ||
			!badge().title.includes("256 B/s") ||
			badge().getAttribute("aria-label") !== badge().title
		)
			throw new Error(
				"Connection details are unavailable through native tooltip and accessible label.",
			);
		const heldTitle = badge().title;
		let titleMutations = 0;
		const titleObserver = new MutationObserver((changes) => {
			titleMutations += changes.length;
		});
		titleObserver.observe(badge(), {
			attributes: true,
			attributeFilter: ["title"],
		});
		emitInteractionEvent("client-connection-updated", {
			...sample,
			health: "waiting",
			quality: "poor",
			sampleAgeSeconds: 0,
			receiveAgeSeconds: 10,
			receiveBytesPerSecond: 0,
			sendBytesPerSecond: 64,
		});
		await settle();
		if (
			badge().dataset.health !== "waiting" ||
			badge().querySelectorAll(".quality-bar.lit").length !== 1 ||
			badge().querySelector(".send.active") === null ||
			badge().querySelector(".receive.active") !== null
		)
			throw new Error("Waiting/send-only activity was not displayed.");
		emitInteractionEvent("client-connection-updated", sample);
		await settle();
		if (badge().dataset.health !== "connected")
			throw new Error("Connection recovery was not displayed.");
		await new Promise<void>((resolve) =>
			setTimeout(
				resolve,
				CLIENT_CONNECTION_BADGE_TUNING.activityHoldMs +
					CLIENT_CONNECTION_BADGE_TUNING.displayIntervalMs * 2,
			),
		);
		if (badge().querySelector(".activity.active") !== null)
			throw new Error("Old activity remained illuminated.");
		emitInteractionEvent("client-connection-updated", {
			...sample,
			sampleAgeSeconds:
				CLIENT_CONNECTION_BADGE_TUNING.activityHoldMs / 1_000 + 1,
		});
		await settle();
		if (badge().querySelector(".activity.active") !== null)
			throw new Error("Recovered old rates replayed activity.");
		emitInteractionEvent("client-connection-updated", {
			...sample,
			health: "disconnected",
			quality: "unavailable",
		});
		await settle();
		const terminal = badge().getBoundingClientRect();
		if (
			badge().dataset.health !== "disconnected" ||
			badge().querySelectorAll(".quality-bar.lit").length !== 0 ||
			terminal.width !== initial.width ||
			terminal.height !== initial.height
		)
			throw new Error(
				"Disconnect changed the badge footprint or kept quality bars lit.",
			);
		badge().dispatchEvent(new PointerEvent("pointerleave"));
		await tick();
		if (badge().title !== heldTitle || titleMutations !== 0)
			throw new Error(
				"Native tooltip text changed during pointer/focus engagement.",
			);
		titleObserver.disconnect();
		badge().dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				code: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
		badge().dispatchEvent(
			new KeyboardEvent("keyup", {
				key: "Escape",
				code: "Escape",
				bubbles: true,
			}),
		);
		await tick();
		if (!keyboard.gameActive || document.activeElement === badge())
			throw new Error(
				"Connection details did not release keyboard ownership on Escape.",
			);
		if (!badge().title.startsWith("Disconnected"))
			throw new Error(
				"Tooltip snapshot did not refresh after engagement ended.",
			);
		emitInteractionEvent("client-connection-updated", sample);
		return { passed: true, width: terminal.width, height: terminal.height };
	}
	let hoveredGuid = $state<number | null>(null);
	const mouseFixture = createClientMouseMovementFixture(
		keyboard,
		inputGate,
		() => gameplayView?.cancelMouseInput(),
	);
	let rearFollowEntries = 0;
	const orbitDeltas: { x: number; y: number }[] = [];
	/** Production mouse ownership, exposed for button-edge and cancellation probes. */
	let orbitHeld = false;
	const zoomDeltas: number[] = [];
	const viewportSelectionPoints: { x: number; y: number; interact: boolean }[] =
		[];
	const mouseLook = new CameraLookController({
		yawRadians: 0,
		pitchRadians: 0,
	});
	function rotateMouseLook(deltaX: number, deltaY: number): void {
		const orbit = CLIENT_TUNING.camera.orbit;
		mouseLook.rotate(
			deltaX,
			deltaY,
			orbit.yawRadiansPerPixel,
			orbit.pitchRadiansPerPixel,
			orbit.maximumPitchRadians,
		);
	}
	function mouseLookDirection() {
		const look = mouseLook.snapshot();
		return createCameraAxesRadians(look.yawRadians, look.pitchRadians).forward;
	}
	const cameraController = {
		setOrbitHeld(held: boolean): void {
			orbitHeld = held;
		},
		pitch(deltaY: number): void {
			orbitDeltas.push({ x: 0, y: deltaY });
			rotateMouseLook(0, deltaY);
		},
		followRear(): void {
			rearFollowEntries += 1;
		},
		orbit(deltaX: number, deltaY: number): void {
			orbitDeltas.push({ x: deltaX, y: deltaY });
			rotateMouseLook(deltaX, deltaY);
		},
		zoom(delta: number): void {
			zoomDeltas.push(delta);
		},
	};
	/** Imperative fixture position, matching the production map frame's presentation-rate source. */
	let minimapCategory: DynamicEntityMapBlipCategory = "mob";
	let nearbyMapFixture = false;
	let minimapHidden = false;
	let minimapNoDraw = false;
	let minimapSubjectWorldX = 100;
	const minimapSubjectWorldY = 20;
	let minimapSubjectWorldZ = -200;
	let minimapSubjectGuid: number | null = 1;
	let minimapSubjectIndoor = false;

	/** Keep the keyboard fixture's two submitted entries regardless of product tuning. */
	const chatHistoryLimit = 2;
	let emotesEnabled = $state(true);
	/** Synthetic user settings survive session resets and composer recreation. */
	let savedRecentEmotes: readonly string[] = [];
	function createChatComposer(): ClientChatComposer {
		const composer = new ClientChatComposer({
			recentEmotes: savedRecentEmotes,
			onRecentEmotesChange: (ids) => (savedRecentEmotes = ids),
		});
		composer.setEmotes(soulEmoteFixture());
		return composer;
	}
	let chatComposer = $state.raw(createChatComposer());
	const emoteController = new ClientEmoteController(
		interactionLifecycle,
		keyboard,
		(error) => appendChat({ kind: "error", message: String(error) }),
	);
	/** Exercise production cycle input and toast publication through real keyboard scopes. */
	function beginRestPostureProbe() {
		emitInteractionBaseline();
		emoteController.cancel();
		const commandStart = interactionCommands.length;
		const previousToast = toast;
		const center = new ClientToastCenter({
			durationMs: CLIENT_TOAST_DURATION_MS,
			scheduler: {
				cancel: (handle) => window.clearTimeout(handle),
				schedule: (callback, delay) => window.setTimeout(callback, delay),
			},
		});
		const unsubscribe = center.subscribe((next) => {
			toast = next;
		});
		const controller = new ClientRestPostureController(
			interactionLifecycle,
			keyboard,
			(error) => center.publish({ message: String(error), tone: "warning" }),
			(posture) =>
				center.publish({
					message: REST_POSTURE_LABELS[posture],
					tone: "status",
				}),
		);
		let dispatch = Promise.resolve();
		const releaseKeys = keyboard.bindGame({
			keydown: (event) => {
				handleRestPostureKeydown(clientInput, event, () => {
					dispatch = controller
						.cycle(dispatch)
						.catch((error) =>
							center.publish({ message: String(error), tone: "warning" }),
						);
				});
			},
			keyup: () => {},
			cancel: () => {},
		});
		keyboard.returnToGame();
		return {
			read: () => ({
				commands: interactionCommands
					.slice(commandStart)
					.filter((entry) => entry.command.endsWith("rest_posture")),
				toast: center.snapshot(),
			}),
			observe: (posture: RestPosture) => {
				const entity = emotePlaybackFixture(1, "explicit");
				if (entity.motion === null)
					throw new Error("Posture fixture requires motion");
				entity.motion.restPosture = posture;
				emitInteractionEvent("client-dynamic-entity", {
					kind: "upserted",
					entity,
				});
			},
			dispose: () => {
				controller.destroy();
				releaseKeys();
				unsubscribe();
				center.destroy();
				toast = previousToast;
			},
		};
	}

	const chatRequests: ClientChatRequest[] = [];
	let sentChatHistory = $state<readonly string[]>([]);
	let messages = $state<readonly ClientChatLine[]>([
		line(1, {
			kind: "system",
			message:
				"Welcome to the Holtburger client HUD harness.\nEmbedded chat line breaks remain visible.",
		}),
		line(2, {
			kind: "speech",
			category: "speech",
			sender: "Ulgrim the Unpleasant",
			speakerKind: "non-player",
			message: "Duis aute irure dolor in reprehenderit.",
		}),
		line(3, {
			kind: "channel",
			origin: { kind: "turbine", roomId: 2, typeId: 2 },
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
			category: "tell",
			target: { kind: "player", name: "Jordan" },
			sender: "Jordan",
			speakerKind: "player",
			message: "Consectetur adipiscing elit, sed do eiusmod.",
		}),
		line(6, { kind: "error", message: "Example presentation failure." }),
		line(7, {
			kind: "combat",
			message: "You hit a Drudge for 37 slashing damage. Critical hit.",
			emphasized: true,
			selfEvasion: false,
		}),
	]);

	function line(id: number, message: ClientChatEntry): ClientChatLine {
		return {
			...message,
			id,
			receivedAt: new Date(2026, 7, 27, 9, id),
			generation: chatComposer.generation,
		};
	}

	function appendChat(message: ClientChatEntry): void {
		if (clientChatShouldSuppress(userSettings.chatSuppression, message)) return;
		const id =
			messages.reduce((maximum, entry) => Math.max(maximum, entry.id), 0) + 1;
		messages = [...messages, line(id, message)];
	}

	const waypointOwner = new ClientNavigationWaypointOwner(
		CLIENT_WAYPOINT_NEAR_RADIUS_METERS,
	);
	/** Cold showcase control mirrors explicit destination edits, never map-frame updates. */
	let showcaseWaypointEnabled = $state(false);
	function setWaypoint(target: MapWaypointTarget): void {
		waypointOwner.set(target, notifyWaypoint);
		showcaseWaypointEnabled = true;
	}
	function clearWaypoint(): void {
		waypointOwner.clear();
		showcaseWaypointEnabled = false;
	}
	let waypointProbeEnabled = false;
	let waypointContentProbeEnabled = false;
	let waypointAvailable = true;
	let waypointMixedInterior = false;
	let waypointHeading = 0;
	let waypointCameraHeading = 0;
	const waypointMessages: ClientChatMessage[] = [];
	const waypointServerMessages: string[] = [];
	const waypointNotices: string[] = [];
	function notifyWaypoint(message: string): void {
		waypointNotices.push(message);
		toast = { id: waypointNotices.length, message, tone: "status" };
	}
	function submitWaypointChat(message: string): void {
		if (
			!waypointOwner.runCommand(
				message,
				() => readMinimapFrame().waypoint,
				(line) => waypointMessages.push(line),
				notifyWaypoint,
			)
		)
			waypointServerMessages.push(message);
		showcaseWaypointEnabled = readMinimapFrame().waypoint !== null;
	}
	function readMinimapFrame(): MinimapFrame {
		const read = interactionLifecycle.entities.read();
		const facts = read.kind === "current" ? read.level.entities : null;
		const player =
			minimapSubjectGuid === null ? undefined : facts?.get(minimapSubjectGuid);
		const playerName =
			player?.description.kind === "known" ? player.description.name : null;
		const frame: MinimapFrame = {
			landmarkCategory: (guid) =>
				clientMinimapLandmark(facts?.get(guid), playerName),
			surfaceMapEligible: !minimapSubjectIndoor || waypointMixedInterior,
			waypoint: null,
			cameraFovRadians: Math.PI / 3,
			cameraHeadingRadians: waypointCameraHeading,
			presentedEntities: () => {
				if (minimapSubjectGuid === null) return [];
				if (!nearbyMapFixture) return [minimapEntity()];
				const second = minimapEntity();
				second.placement.localTransform.m41 += 20;
				return [
					minimapEntity(),
					{
						...second,
						view: {
							...second.view,
							identity: { ...second.view.identity, guid: 8 },
							presentation: {
								...second.view.presentation,
								radar: {
									...second.view.presentation.radar,
									category: "other",
									behavior: "ShowNever",
								},
							},
						},
					},
				];
			},
			selectedGuid,
			trackedGuids: nearbyOwner.trackedGuids(),
			source: null,
			subject: {
				anchor: {
					headingRadians: waypointHeading,
					residency: minimapSubjectIndoor
						? {
								envCellId: "0x01020100",
								landblockId: "0x0102ffff",
							}
						: waypointProbeEnabled
							? { landblockId: "0x0102ffff", envCellId: null }
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
		return {
			...frame,
			waypoint: waypointOwner.read(frame, waypointAvailable),
		};
	}

	/** One visible marker centred on the fixture subject. */
	function minimapEntity(): MapEntity {
		const transform = Mat4.identity();
		// Landblock (0, 1) begins at world (0, -192), placing this at (100, -200).
		transform.m41 = 100;
		transform.m43 = -8;
		return {
			sidewaysSpan: { minX: -2, maxX: 2, z: 0 },
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

	function readDiagnostics(): ClientGameplayPresentationDiagnostics | null {
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
		const canvas = document.querySelector<HTMLElement>(".client-canvas");
		if (canvas === null) throw new Error("Client HUD canvas is unavailable.");
		return {
			gameCanvas: rectangle(canvas),
			orbitDeltas: orbitDeltas.map((delta) => ({ ...delta })),
			preciseJumpActivationCount,
			preciseJumpAimCount,
			selectedGuid,
			viewportSelectionPoints: viewportSelectionPoints.map((point) => ({
				...point,
			})),
		};
	}

	async function probePreciseJumpWheel() {
		const canvas = document.querySelector<HTMLCanvasElement>(".client-canvas");
		if (canvas === null)
			throw new Error("Precise wheel probe requires a canvas");
		const previous = { preciseJumpActive, cameraEnabled, hudMode };
		const zoomStart = zoomDeltas.length;
		const powerStart = preciseJumpPowerSteps.length;
		const wheel = (shiftKey: boolean, deltaY: number, deltaX = 0) =>
			canvas.dispatchEvent(
				new WheelEvent("wheel", {
					bubbles: true,
					cancelable: true,
					shiftKey,
					deltaY,
					deltaX,
				}),
			);
		try {
			preciseJumpActive = true;
			cameraEnabled = true;
			hudMode = "runtime";
			await tick();
			wheel(false, 120);
			if (
				zoomDeltas.length !== zoomStart + 1 ||
				preciseJumpPowerSteps.length !== powerStart
			)
				throw new Error(
					"Plain wheel did not retain camera zoom in precise mode",
				);
			wheel(true, -120);
			wheel(true, 0, -120);
			if (
				zoomDeltas.length !== zoomStart + 1 ||
				preciseJumpPowerSteps.slice(powerStart).join(",") !== "1,1"
			)
				throw new Error("Shift wheel did not exclusively adjust precise power");
			const unblock = inputGate.block();
			try {
				wheel(true, 120);
			} finally {
				unblock();
			}
			if (preciseJumpPowerSteps.length !== powerStart + 2)
				throw new Error("Blocked viewport changed jump power");
			preciseJumpActive = false;
			await tick();
			wheel(true, 120);
			if (zoomDeltas.length !== zoomStart + 2)
				throw new Error("Manual mode wheel did not zoom");
			return { passed: true };
		} finally {
			preciseJumpActive = previous.preciseJumpActive;
			cameraEnabled = previous.cameraEnabled;
			hudMode = previous.hudMode;
			zoomDeltas.splice(zoomStart);
			preciseJumpPowerSteps.splice(powerStart);
			await tick();
		}
	}

	function setPreciseJumpActive(active: boolean): void {
		preciseJumpActive = active;
	}

	function selectEntity(guid: number | null): void {
		selection.select(guid);
	}

	function resetSelectionFixture(): void {
		minimapSubjectWorldX = 100;
		minimapSubjectGuid = 1;
		minimapSubjectIndoor = false;
		selection.select(null);
		hoveredGuid = null;
		cameraEnabled = true;
		preciseJumpActive = false;
		preciseJumpActivationCount = 0;
		orbitDeltas.length = 0;
		viewportSelectionPoints.length = 0;
	}

	const showcaseSession = $derived(
		showcaseActions === null
			? null
			: {
					...showcaseActions,
					vitals: warningVitals,
					warningsEnabled: vitalWarningsEnabled,
					editable: hudMode === "layout",
					jumpExtent,
					jumpActive: jumpChargeActive,
					waypointEnabled: showcaseWaypointEnabled,
				},
	);

	onMount(() => {
		const retireKeyboard = keyboard.mount(document);
		let releaseShowcaseKeys: (() => void) | null = null;
		let mounted = true;
		const unsubscribeChat = interactionLifecycle.subscribe((event) => {
			if (event.type === "chat") {
				chatComposer.accept(event.message);
				appendChat(event.message);
			}
		});
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
		publishLoadoutFeedback = (feedback) => inventoryToasts.publish(feedback);
		const inventoryOwner = new ClientInventoryState(
			{
				entities: { read: readInventoryEntities },
				previewInventory: (request) =>
					interactionLifecycle.previewInventory(request),
				submitInventory: (intent) =>
					interactionLifecycle.submitInventory(intent),
				autoMergeContainer: (container) =>
					interactionLifecycle.autoMergeContainer(container),
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
		const barberOwner = new ClientBarberState(
			interactionLifecycle,
			async () => {},
			(message) => inventoryToasts.publish({ message, tone: "warning" }),
		);
		barber = barberOwner;
		const vendorOwner = new ClientVendorState(
			interactionLifecycle,
			icons,
			(message) => inventoryToasts.publish({ message, tone: "warning" }),
			// The isolated HUD fixture has no world poses; its vendor stays in reach.
			() => 0,
		);
		vendor = vendorOwner;
		const houseCrystalOwner = new ClientHouseCrystalState(
			interactionLifecycle,
			icons,
			(message) => inventoryToasts.publish({ message, tone: "warning" }),
			// The synthetic HUD has no scene poses; range lifetime is covered by focused state tests.
			() => 0,
			() => {
				vendorOwner.close();
				const read = interactionLifecycle.entities.read();
				if (
					read.kind === "current" &&
					read.level.worldContainer.kind === "open"
				)
					containerOwner.close(read.level.worldContainer.root);
			},
		);
		houseCrystal = houseCrystalOwner;
		const housingManagementOwner = new ClientHousingManagementState(
			interactionLifecycle,
			(message) => inventoryToasts.publish({ message, tone: "warning" }),
		);
		housingManagement = housingManagementOwner;
		const salvageOwner = new ClientSalvageState(
			interactionLifecycle,
			(message) => inventoryToasts.publish({ message, tone: "status" }),
			() => {
				itemInteractions.cancelTargeting();
				gameplayView?.showInventory();
			},
		);
		const locksOwner = new ClientLocksState(
			interactionLifecycle,
			keyboard,
			() => itemInteractions.cancel(),
			(message, tone) => inventoryToasts.publish({ message, tone }),
			() => ({
				enabled: userSettings.ui.useUnlockHelper,
				autoUseKeys: userSettings.lockInteractions.autoUseKeys,
			}),
			(message) => appendChat({ kind: "system", message }),
			selection,
		);
		locks = locksOwner;
		salvage = salvageOwner;
		const sessionDialogs = new ClientDialogs(interactionLifecycle);
		const unbindSalvage = sessionDialogs.bindLocal(salvageOwner);
		dialogOwner = sessionDialogs;
		const unbindItemDialogs = sessionDialogs.bindLocal(itemInteractions);
		const unbindHousingDialogs = sessionDialogs.bindLocal(
			housingManagementOwner,
		);
		const unbindContractDialogs = sessionDialogs.bindLocal(
			interactionLifecycle.contracts,
		);
		const unsubscribeDialogs = sessionDialogs.subscribe((value) => {
			dialogPresentation = value;
		});
		const tradeOwner = new ClientTradeState(
			interactionLifecycle,
			icons,
			(message) => interactionFailures.push(message),
		);
		trade = tradeOwner;
		let spellReferenceRequests = 0;
		/** One-shot transport failure for reference retry coverage. */
		let failSpellReferences = false;
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
				if (failSpellReferences) {
					failSpellReferences = false;
					throw new Error("Fixture spell-reference failure");
				}
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
									id === 666
										? "Vitae"
										: id === 2000
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
									school:
										id === 666 ? 4 : id === 2000 ? 5 : id % 2 === 0 ? 2 : 3,
									usesProjectileHandler: id === 2000,
									baseMana: 10,
									manaPerTarget: 2,
									durationSeconds: 60,
									cantripTier:
										id === 2001
											? "major"
											: id === 2002
												? "epic"
												: id === 2003 || id === 2004
													? "legendary"
													: id === 2005
														? "other"
														: null,
									classification: {
										beneficial: id !== 2000 && id !== 666,
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
		// Synthetic focus/key assertions belong to the diagnostic entry, not interactive startup.
		if (!showcase) probeBrowserInput(keyboard, inputGate);
		const unsubscribePanelAuthority = interactionLifecycle.subscribe(
			(event) => {
				if (event.type === "party-presence") partyHudPresent = event.hudPresent;
				if (event.type === "party-presence")
					chatComposer.inParty = event.inParty;
				if (event.type === "party-updates-failed")
					throw new Error(event.message);
				if (event.type === "housing-updated") housing = event.housing;
				if (event.type === "current-state") {
					housing = event.state.housing;
					housingCharacterGuid = event.state.localPlayerGuid;
				}
				if (event.type === "map-teleport-capability")
					canTeleportFromMap = event.allowed;
				if (event.type === "current-state")
					canTeleportFromMap = event.state.canTeleportFromMap;
			},
		);
		const sessionStarted = interactionLifecycle.start();
		const harnessGlobal = globalThis as typeof globalThis & {
			__HOLTBURGER_3D_CLIENT_HUD_HARNESS__: ClientHudHarnessApi | undefined;
		};
		const waypointControls: WaypointProbeControls = {
			enable: () => {
				waypointProbeEnabled = true;
				minimapSubjectGuid = 1;
				waypointOwner.acceptCharacter(1);
			},
			chat: submitWaypointChat,
			mixedInterior: (enabled) => {
				waypointMixedInterior = enabled;
			},
			player: (x, z, heading, camera, indoor, available) => {
				minimapSubjectWorldX = x;
				minimapSubjectWorldZ = z;
				waypointHeading = heading;
				waypointCameraHeading = camera;
				minimapSubjectIndoor = indoor;
				waypointAvailable = available;
			},
			character: (guid) => waypointOwner.acceptCharacter(guid),
			lifecycle: (lifecycle) => waypointOwner.acceptLifecycle(lifecycle),
			read: () => ({
				frame: readMinimapFrame(),
				messages: waypointMessages.slice(),
				notices: waypointNotices.slice(),
				sent: waypointServerMessages.slice(),
				gameActive: keyboard.gameActive,
				history: sentChatHistory,
			}),
			placeAtBottom: () => {
				userSettings = {
					...userSettings,
					hudLayout: {
						...userSettings.hudLayout,
						minimap: {
							...userSettings.hudLayout.minimap,
							vertical: { alignment: "end", offset: 0 },
							// Keep the lowest footer row clear of the centered action bar and right dock.
							horizontal: { alignment: "start", offset: 900 },
							preferredWidth: CLIENT_UI_DEFAULTS.minimap.minSize,
							preferredHeight: CLIENT_UI_DEFAULTS.minimap.minSize,
						},
					},
				};
			},
		};
		harnessGlobal.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__ = {
			probeNearby: () => {
				nearbyMapFixture = true;
				waypointOwner.acceptCharacter(1);
				minimapCategory = "mob";
				minimapHidden = false;
				minimapNoDraw = false;
				minimapSubjectGuid = 1;
				waypointProbeEnabled = true;
				return probeClientNearby({
					minimapDiameter: () => userSettings.minimapViewDiameters.outdoor,
					prepareMinimapLandmarks: () => {
						minimapCategory = "other";
						const read = interactionLifecycle.entities.read();
						const player =
							read.kind === "current" ? read.level.entities.get(1) : undefined;
						if (player?.description.kind !== "known")
							throw new Error(
								"Minimap fixture requires the player's public name.",
							);
						return player.description.name;
					},
					owner: nearbyOwner,
					scene: nearbyScene,
					baseline: emitInteractionBaseline,
					emit: emitInteractionEvent,
					selected: () => selection.selectedGuid(),
					commands: () => interactionCommands,
					messages: () => messages,
					waypoint: () => readMinimapFrame().waypoint?.target ?? null,
					select: (guid) => selection.select(guid),
					retireChat: () => chatComposer.reset(),
					notice: () => toast?.message ?? null,
				});
			},
			chat: {
				prepareEntityKeyboard: async () => {
					selection.select(null);
					appendChat({
						kind: "formatted-system",
						rows: [
							{
								indented: false,
								spans: [{ kind: "entity", guid: 7, text: "Keyboard entity" }],
							},
						],
					});
					await tick();
					const historyToggle = document.querySelector<HTMLButtonElement>(
						'[aria-label="Interact with chat history"]',
					);
					if (historyToggle === null)
						throw new Error("Chat history toggle is missing");
					historyToggle.click();
					await tick();
					const tag = document.querySelector<HTMLSpanElement>(
						'[aria-label="Select entity: Keyboard entity"]',
					);
					if (tag === null) throw new Error("Keyboard entity tag is missing");
					// Deliberate keyboard navigation admits native controls through the containing scope.
					tag.focus();
				},
				setPartyPresent: (present) => {
					chatComposer.inParty = present;
				},
				restart: async () => {
					emoteController.cancel();
					chatComposer.reset();
					// Retire the previous session's keyed editor before starting a new owner.
					await tick();
					chatComposer = createChatComposer();
				},
				reset: () => {
					emoteController.cancel();
					chatComposer.reset();
					emoteFeedbackRequests.clear();
					chatRequests.length = 0;
					chatSuccessesBeforeFailure = null;
					sentChatHistory = [];
				},
				select: (target) =>
					chatComposer.setSelection(
						target === null ? { kind: "none" } : { kind: "target", target },
					),
				selectEntity: (guid) => selection.select(guid),
				receive: (message) =>
					emitInteractionEvent("client-chat-message", message),
				rejectAfter: (successes) => {
					chatSuccessesBeforeFailure = successes;
				},
				setEmotesEnabled: (enabled) => {
					emotesEnabled = enabled;
				},
				setCombatMode: (mode, ready = mode === "peace") => {
					spellCombatMode = mode;
					emitInteractionEvent("client-combat-mode-updated", { mode });
					emitInteractionEvent("client-social-motion-ready-updated", { ready });
				},
				setMotionReady: (ready) =>
					emitInteractionEvent("client-social-motion-ready-updated", { ready }),
				changeCombatMode: async (mode) => {
					emoteController.cancel();
					await interactionLifecycle.setCombatMode(mode);
				},
				admitEmotes: () => {
					for (const requestId of emoteFeedbackRequests)
						emitInteractionEvent("client-local-motion-feedback", {
							requestId,
							worldGeneration: 1,
							outcome: "accepted",
						});
				},
				completeEmotes: () => {
					for (const requestId of emoteFeedbackRequests)
						emitInteractionEvent("client-local-motion-feedback", {
							requestId,
							worldGeneration: 1,
							outcome: "completed",
						});
					emoteFeedbackRequests.clear();
				},
				waitForEmoteTimeout: () =>
					new Promise((resolve) =>
						setTimeout(resolve, CLIENT_TUNING.emotes.admissionTimeoutMs + 100),
					),

				rejectNextSend: () => {
					chatSuccessesBeforeFailure = 0;
				},
				professorPrompt: () =>
					emitInteractionEvent("client-confirmation-updated", {
						confirmation: {
							requestId: "900",
							text: "I can teach you the level one War Spells for 2 X Notes.",
						},
					}),
				clearPrompt: () =>
					emitInteractionEvent("client-confirmation-updated", {
						confirmation: null,
					}),
				read: () => ({
					retainedMessages: messages,
					selectedEntity: selection.selectedGuid(),
					requests: chatRequests.slice(),
					peaceRequests: interactionCommands.filter(
						(entry) =>
							entry.command === "set_client_combat_mode" &&
							entry.args?.mode === "peace",
					).length,
					combatRequests: interactionCommands
						.filter(
							(entry) =>
								entry.command === "set_client_combat_mode" &&
								entry.args?.mode !== "peace",
						)
						.map((entry) => decodeClientCombatMode(entry.args).mode),
					destination: chatComposer.destination,
					recentEmotes: [...chatComposer.recentEmotes],
					inputAllowed: inputGate.allowed,
					gameActive: keyboard.gameActive,
					reply: chatComposer.reply,
					retell: chatComposer.retell,
					responses: interactionCommands.filter(
						(entry) => entry.command === "respond_to_client_confirmation",
					),
				}),
			},
			retainChatLines: (count) => {
				messages = messages.slice(Math.max(0, messages.length - count));
			},
			appendChatLines: (count) => {
				const first =
					messages.reduce((maximum, entry) => Math.max(maximum, entry.id), 0) +
					1;
				messages = [
					...messages,
					...Array.from({ length: count }, (_, index) =>
						line(first + index, {
							kind: "system",
							message: `Scroll fixture line ${first + index}`,
						}),
					),
				];
			},
			showWaypointContent: async (surface) => {
				waypointContentProbeEnabled = true;
				waypointControls.enable();
				inspectionOwner.close();
				bookReaderOwner.close();
				if (surface === "chat") {
					messages = [
						line(100, {
							kind: "system",
							message:
								"Meet at (42.1N, 33.6E), then 0.00S, 0.0W. Invalid: 102N 0E.",
						}),
					];
				} else if (surface === "book") {
					emitInteractionEvent("client-book-opened", {
						name: "Waypoint Journal",
						book: {
							guid: 42,
							inscription: "Inscribed at 2.0N, 3.0E.",
							authorName: "Traveler",
							pages: [
								{
									index: 0,
									authorName: "Writer",
									text: "First stop: 42.1N, 33.6E.\nNext page follows.",
								},
								{ index: 1, authorName: "Writer", text: null },
							],
						},
					});
				} else if (surface === "contracts") {
					const facts = contractsUpdatedSchema.parse(contractFixture).contracts;
					if (facts === null) throw new Error("Missing contract fixture");
					emitInteractionBaseline(1, {
						rows: facts.rows.map((row) =>
							row.kind === "resolved"
								? {
										...row,
										description: "Travel to 1.2S, 3.4W.",
										status:
											row.status.kind === "inProgress"
												? { kind: "inProgress", progress: "Next: 4.5N, 6.7E." }
												: row.status,
									}
								: row,
						),
					});
				} else {
					await inspectionOwner.examine(7);
					emitInteractionEvent(
						"client-object-inspection-result",
						inspectionResult(surface, 7),
					);
				}
			},
			waypoint: waypointControls,
			probeWaypoint: () => probeClientWaypoint(waypointControls),
			probeHudAttention: async () => {
				const previousToast = toast;
				const previousEnchantments = enchantments;
				try {
					return await probeHudAttention((nextToast, resolved) => {
						toast = nextToast;
						enchantments = { resolved, receivedAtMs: performance.now() };
					});
				} finally {
					toast = previousToast;
					enchantments = previousEnchantments;
				}
			},
			probeVitalWarnings: async () => {
				const previousVitals = warningVitals;
				const previousEnabled = vitalWarningsEnabled;
				const previousUi = userSettings.ui;
				try {
					return await probeVitalWarnings(
						(values, enabled) => {
							warningVitals = values;
							vitalWarningsEnabled = enabled;
						},
						() => userSettings.ui.vitalWarningThresholds,
					);
				} finally {
					vitalWarningsEnabled = false;
					await tick();
					warningVitals = previousVitals;
					userSettings = { ...userSettings, ui: previousUi };
					vitalWarningsEnabled = previousEnabled;
					await tick();
				}
			},
			probeEnvironment: () =>
				probeClientEnvironment({
					setServerTime: (seconds) => {
						environmentSeconds = seconds;
						environmentServer.refresh(performance.now());
					},
					readPresentation: () => environmentBinding.source.read(),
					placeMinimapAtBottom: () => {
						userSettings = {
							...userSettings,
							hudLayout: {
								...userSettings.hudLayout,
								minimap: {
									...userSettings.hudLayout.minimap,
									vertical: { alignment: "end", offset: 0 },
									horizontal: { alignment: "start", offset: 0 },
									preferredWidth: CLIENT_UI_DEFAULTS.minimap.minSize,
									preferredHeight: CLIENT_UI_DEFAULTS.minimap.minSize,
								},
							},
						};
					},
				}),
			setHousing: (snapshot) => {
				emitInteractionEvent(
					"client-housing-updated",
					housingSnapshotSchema.parse(snapshot),
				);
			},
			replaceHousingCharacter: (playerGuid) => {
				emitInteractionEvent("client-housing-updated", emptyHousing());
				emitInteractionEvent("client-lifecycle-changed", {
					kind: "character-selection",
					rejection: null,
					maxSlots: 11,
					characters: [],
				});
				emitInteractionBaseline(playerGuid);
			},
			readHousingRefreshes: () => housingRefreshes,
			readHousingSearches: () => housingSearches,
			timeoutHousingSearch: () => {
				emitInteractionEvent("client-housing-updated", {
					...housing,
					search: { ...housing.search, pendingType: null },
				});
				inventoryToasts.publish({
					message: "Housing search timed out waiting for the server",
					tone: "warning",
				});
			},
			readHousingManagementCommands: () =>
				interactionCommands.filter(
					(entry) =>
						entry.command === "query_client_housing_access" ||
						entry.command === "submit_client_housing_management",
				),
			probeHousingManagementRemount: async () => {
				const target = document.createElement("div");
				target.hidden = true;
				document.body.append(target);
				const commandCount = interactionCommands.length;
				try {
					for (let attempt = 0; attempt < 2; attempt++) {
						const component = mount(ClientHousingManagement, {
							target,
							props: { model: housingManagementOwner },
						});
						await tick();
						await tick();
						const checked = target.querySelector<HTMLInputElement>(
							'input[type="checkbox"]',
						)?.checked;
						await unmount(component);
						if (checked !== true) return false;
					}
					return interactionCommands.length === commandCount;
				} finally {
					target.remove();
				}
			},
			finishHousingManagement: (result) =>
				emitInteractionEvent(
					"client-housing-management-finished",
					housingManagementResultSchema.parse(result),
				),
			deferNextGameplayUpdate: () => {
				deferGameplayUpdate = true;
			},
			flushGameplayUpdate: () => {
				if (pendingGameplayUpdate === null)
					throw new Error("No gameplay update is waiting.");
				pendingGameplayUpdate();
				pendingGameplayUpdate = null;
			},
			probeAudio: probeAudioControls,
			setMapTeleportPermission: (allowed) =>
				emitInteractionEvent("client-map-teleport-capability-changed", allowed),
			readMapTeleports: () =>
				interactionCommands.filter(
					(entry) => entry.command === "teleport_client_to_map_position",
				),
			holdWorldMapPreparation: worldMapFixture.holdPreparation,
			advanceWorldMapPreparation: worldMapFixture.advancePreparation,
			releaseWorldMapPreparation: worldMapFixture.releasePreparation,
			probeWorldMapLifetime: () =>
				probeWorldMapLifetime(
					partyProbeContext,
					interactionLifecycle.contracts,
					readMinimapFrame,
				),
			readWorldMapFixture: () => ({
				...worldMapFixture.read(),
				sceneZooms: zoomDeltas.length,
				sceneOrbits: orbitDeltas.length,
			}),
			probeTargeting: () => probeClientTargeting(keyboard),
			beginRestPostureProbe,
			beginKeyboardProbe: () => {
				keyboardFixture = installKeyboardPolicyFixture(keyboard, inputGate);
			},
			keyboardProbe: () => {
				if (keyboardFixture === null)
					throw new Error("Keyboard fixture has not been installed.");
				return keyboardFixture;
			},
			probeInventory,
			probeLocks: () =>
				probeClientLocks({
					selection,
					model: locksOwner,
					setAutomaticKeys: (autoUseKeys) =>
						(userSettings = {
							...userSettings,
							lockInteractions: { autoUseKeys },
						}),
					readToast: () => inventoryToasts.snapshot(),
					emit: emitInteractionEvent,
					commands: interactionCommands,
					bindMovement: () =>
						keyboard.bindGame({
							keydown: (event) => {
								characterInput.apply(event, true);
							},
							keyup: (event) => {
								characterInput.apply(event, false);
							},
							cancel: () => characterInput.reset(),
						}),
				}),
			tradeProbe: createTradeFixture({
				emit: emitInteractionEvent,
				baseline: emitInteractionBaseline,
				select: (guid) => selection.select(guid),
				commands: interactionCommands,
			}),
			salvageProbe: createSalvageFixture({
				ready: () => interactionLifecycle.entities.read().kind === "current",
				emit: emitInteractionEvent,
				baseline: emitInteractionBaseline,
				commands: interactionCommands,
				showInventory: () => gameplayView?.showInventory(),
				select: (guid) => selection.select(guid),
				activateBound: (guid) =>
					itemInteractions.activate(guid, "direct", false),
			}),
			barberProbe: createBarberFixture({
				emit: emitInteractionEvent,
				baseline: emitInteractionBaseline,
				commands: interactionCommands,
			}),
			vendorProbe: createVendorFixture({
				emit: emitInteractionEvent,
				baseline: emitInteractionBaseline,
				commands: interactionCommands,
			}),
			housingProbe: createHousingFixture({
				emit: emitInteractionEvent,
				baseline: emitInteractionBaseline,
				commands: interactionCommands,
			}),
			probeAllegiance: () =>
				probeAllegiance({
					context: partyProbeContext,
					session: interactionLifecycle,
					emit: emitInteractionEvent,
					commands: interactionCommands,
				}),
			probeSquelch: () =>
				probeSquelch({
					context: partyProbeContext,
					session: interactionLifecycle,
					emit: emitInteractionEvent,
					commands: interactionCommands,
				}),
			setUiScale: (scale) => {
				userSettings = {
					...userSettings,
					ui: clientUiSettingsSchema.parse({
						...userSettings.ui,
						uiScale: scale,
					}),
				};
			},
			probeUiScaling: async () => {
				const previous = spellCombatMode;
				const previousScale = userSettings.ui.uiScale;
				// Re-enter with a fractional preference so fresh bars cannot rely on neutral-scale measurements.
				userSettings = {
					...userSettings,
					ui: { ...userSettings.ui, uiScale: 0.9 },
				};
				const savedCharacterSettings = characterSettings;
				characterSettings = null;
				await tick();
				characterSettings = savedCharacterSettings;
				spellCombatMode = "magic";
				await tick();
				try {
					return await probeUiScaling(
						partyProbeContext,
						() => userSettings.hudLayout,
					);
				} finally {
					spellCombatMode = previous;
					userSettings = {
						...userSettings,
						ui: { ...userSettings.ui, uiScale: previousScale },
					};
				}
			},
			probeBindings,
			bindSystemPanelKeys: () => {
				hudMode = "runtime";
				keyboard.returnToGame();
				return keyboard.bindGame({
					keydown: (event) => {
						gameplayView?.handleSystemPanelKeydown(event);
					},
					keyup: () => {},
					cancel: () => {},
				});
			},
			mouseMovement: {
				fixture: mouseFixture,
				lookDirection: mouseLookDirection,
				orbitHeld: () => orbitHeld,
				resetLook: () => {
					mouseLook.replace({ yawRadians: 0, pitchRadians: 0 });
				},
				rearFollowEntries: () => rearFollowEntries,
			},
			bindingSettings: { read: () => userSettings.input, replace: changeInput },
			probeSelectedActions: () => probeSelectedActions(partyProbeContext),
			probeContractMap: () =>
				probeContractMap({
					session: interactionLifecycle,
					emit: emitInteractionEvent,
					baseline: emitInteractionBaseline,
					commands: interactionCommands,
				}),
			probeContracts: () =>
				probeContracts({
					session: interactionLifecycle,
					emit: emitInteractionEvent,
					commands: interactionCommands,
					baseline: emitInteractionBaseline,
					inputAllowed: () => keyboard.gameActive,
					onToast: (next) => {
						toast = next;
					},
				}),
			probeFriends: () =>
				probeFriends({
					context: partyProbeContext,
					session: interactionLifecycle,
					emit: emitInteractionEvent,
					commands: interactionCommands,
				}),
			probeParty: () =>
				probeParty({
					onSelectEntity: (guid) => selection.selectKnownEntity(guid),
					selectedGuid: () => selection.selectedGuid(),
					context: partyProbeContext,
					session: interactionLifecycle,
					emit: emitInteractionEvent,
					commands: interactionCommands,
				}),
			probeWorldContainer: async () => {
				const previousScale = userSettings.ui.uiScale;
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
						setUiScale: (uiScale) => {
							userSettings = {
								...userSettings,
								ui: { ...userSettings.ui, uiScale },
							};
						},
					});
				} finally {
					userSettings = {
						...userSettings,
						ui: { ...userSettings.ui, uiScale: previousScale },
					};
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
			setEnchantments: (resolved) => {
				emitInteractionEvent("client-player-enchantments-updated", resolved);
				enchantments = interactionLifecycle.state().enchantments;
				if (enchantments === null)
					throw new Error(
						"Enchantment update was not accepted by the browser session.",
					);
			},
			spellReferenceRequests: () => spellReferenceRequests,
			failNextSpellReferences: () => {
				failSpellReferences = true;
			},
			setCharacterSheet: (sheet) => {
				emitInteractionEvent("client-character-sheet-updated", sheet);
			},
			setCharacterPortalSpace: (active) => {
				emitInteractionEvent(
					"client-lifecycle-changed",
					active
						? {
								kind: "portal-space",
								cause: "teleport",
								worldGeneration:
									interactionLifecycle.state().worldGeneration + 1,
							}
						: { kind: "in-world" },
				);
			},
			replyProgression: (evaluation) => {
				emitInteractionEvent("client-progression-evaluated", evaluation);
			},
			replyProgressionFeedback: (feedback) => {
				// Other probes own isolated toast centers; match app delivery only for this injection.
				const unsubscribe = interactionLifecycle.subscribe((event) => {
					if (event.type === "action-feedback")
						inventoryToasts.publish(event.feedback);
				});
				try {
					emitInteractionEvent("client-progression-feedback", feedback);
				} finally {
					unsubscribe();
				}
			},
			retireCharacterSheet: (lateSheet) => {
				emitInteractionEvent("client-lifecycle-changed", {
					kind: "exiting",
					cause: "server-disconnect",
				});
				emitInteractionEvent("client-character-sheet-updated", lateSheet);
				return interactionLifecycle.characterSheet.read().sheet === null;
			},
			deferEnchantmentReferences: () => {
				if (releaseEnchantmentReferences !== null)
					throw new Error("Enchantment references are already deferred.");
				releaseEnchantmentReferences = holdSpellReferences();
			},
			releaseEnchantmentReferences: () => {
				if (releaseEnchantmentReferences === null)
					throw new Error("Enchantment references are not deferred.");
				releaseEnchantmentReferences();
				releaseEnchantmentReferences = null;
			},
			resyncEnchantments: () => {
				emitInteractionEvent("client-state-resyncing", null);
				enchantments = interactionLifecycle.state().enchantments;
			},
			reconnectEnchantments: () => {
				emitInteractionBaseline(2);
				if (interactionLifecycle.state().playerGuid !== 2)
					throw new Error("Replacement character snapshot was not accepted.");
				enchantments = interactionLifecycle.state().enchantments;
			},
			objectInspectionProbe: () => objectInspectionProbe,
			bookProbe: {
				open: (receipt) => emitInteractionEvent("client-book-opened", receipt),
				update: (book) => emitInteractionEvent("client-book-updated", book),
				read: () => bookReaderOwner.read(),
				requests: () => interactionCommands,
				close: () => bookReaderOwner.close(),
				retry: () => bookReaderOwner.retry(),
				failNextRequest: () => {
					failNextBookPageRequest = true;
				},
			},
			inventoryDragCommands: () => interactionCommands,
			autoMergeProbe: {
				begin: () => {
					emitInteractionBaseline();
					const pack = (
						guid: number,
						entryKind: "container" | "foci",
						index: number,
					) =>
						entityFacts(guid, {
							ownedByPlayer: true,
							location: {
								kind: "contained",
								parentGuid: 1,
								slot: { kind: "pack", entryKind, index },
							},
							// Even contradictory storage facts must not offer the action for a focus.
							storage: {
								kind: "container",
								roster: "announced",
								itemCapacity: 24,
								packCapacity: 0,
							},
						});
					emitInteractionEvent("client-entity-facts-changed", {
						projectileSupply: null,
						salvage: null,
						worldContainer: null,
						removed: [],
						upserts: [pack(1001, "container", 0), pack(1002, "foci", 1)],
					});
					gameplayView?.showInventory();
				},
				resync: () => emitInteractionEvent("client-state-resyncing", null),
				feedback: (feedback) => {
					const release = interactionLifecycle.subscribe((event) => {
						if (event.type === "action-feedback")
							inventoryToasts.publish(event.feedback);
					});
					try {
						emitInteractionEvent("client-action-feedback", feedback);
					} finally {
						release();
					}
				},
				toast: () => inventoryToasts.snapshot(),
				timing: CLIENT_TUNING.inventory.autoMerge,
			},
			aetheriaDropProbe,
			loadoutProbe,
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
			probeActionFeedback,
			probeConnectionBadge,
			probePartyHud,
			showPartyHud,
			capture,
			resetSelectionFixture,
			setPreciseJumpActive,
			probePreciseJumpWheel,
		};
		function seedShowcaseInventory(): void {
			const read = interactionLifecycle.entities.read();
			if (read.kind !== "current")
				throw new Error("Showcase inventory needs a current baseline");
			const player = read.level.entities.get(1);
			if (player === undefined) throw new Error("Showcase player is missing");
			const contents = Array.from(
				{ length: 24 },
				(_, index): ClientEntityFacts => {
					const item = entityFacts(SHOWCASE_ITEM_GUID_BASE + index, {
						ownedByPlayer: true,
						location:
							index === 0
								? {
										kind: "equipped",
										wearerGuid: 1,
										mask: EQUIPMENT_SLOTS[0].mask,
									}
								: {
										kind: "contained",
										parentGuid: 1,
										slot: { kind: "item", index: index - 1 },
									},
					});
					if (item.description.kind !== "known")
						throw new Error("Showcase item description is missing");
					return {
						...item,
						description: {
							...item.description,
							name:
								index === 0 ? "Traveler’s equipment" : `Travel supply ${index}`,
							stackCount:
								index === 1 || index === 2 || index % 3 === 0 ? 12 : null,
							cooldown:
								index === 2 ? { groupId: 1, durationSeconds: 12 } : null,
							equipLocations: index === 0 ? EQUIPMENT_SLOTS[0].mask : null,
							icon: {
								...item.description.icon,
								base: 0x06001000 + index,
							},
						},
					};
				},
			);
			emitInteractionEvent("client-entity-facts-changed", {
				projectileSupply: null,
				salvage: null,
				worldContainer: null,
				removed: [],
				upserts: [
					{
						...player,
						storage: {
							kind: "container",
							roster: "announced",
							itemCapacity: 48,
							packCapacity: 7,
						},
					},
					...contents,
				],
			});
		}
		function seedShowcaseHud(): void {
			seedShowcaseInventory();
			interactionLifecycle.characterSheet.replace(SHOWCASE_CHARACTER_SHEET);
			emitInteractionEvent("client-party-updated", {
				party: {
					name: "Travelers",
					leader: PARTY_HUD_PREVIEW.leader,
					shareXp: true,
					evenShare: true,
					open: false,
					locked: false,
					capabilities: {
						isLeader: true,
						canRecruit: true,
						canChangeOpenness: true,
					},
					members: [
						{
							guid: 1,
							name: "Wayfarer",
							level: 10,
							canManage: true,
							vitals: [100, 100, 100, 100, 100, 100],
						},
						...PARTY_HUD_PREVIEW.members.map((member) => ({
							...member,
							level: 10,
							canManage: false,
						})),
					],
				},
			});
			emitInteractionEvent("client-entity-health-updated", {
				guid: 7,
				healthFraction: 0.68,
			});
		}
		async function openShowcasePanel(panel: ShowcasePanel): Promise<void> {
			const api = harnessGlobal.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__;
			if (api === undefined || gameplayView === null)
				throw new Error("Showcase client fixture did not mount");
			if (panel === "inventory") {
				gameplayView.showInventory();
			} else if (panel === "vendor") {
				api.vendorProbe.begin();
				await api.vendorProbe.settle();
				api.vendorProbe.reply({
					buys: [],
					sells: [],
					currencies: api.vendorProbe.currencies,
					affordable: true,
				});
			} else if (panel === "trade") {
				api.tradeProbe.begin();
				api.tradeProbe.register();
				api.tradeProbe.acknowledge();
			} else if (panel === "inspection") {
				await inspectionOwner.examine(7);
				emitInteractionEvent(
					"client-object-inspection-result",
					inspectionResult("item", 7),
				);
			} else if (panel === "book") {
				emitInteractionEvent("client-book-opened", {
					name: "A Traveler’s Journal",
					book: {
						guid: 6000,
						authorName: "A traveler",
						inscription: "For those who follow the road.",
						pages: [
							{
								index: 0,
								authorName: "",
								text: "The road to Holtburg winds between old stone walls.\n\nMeet your fellowship at 42.1N, 33.6E before setting out.",
							},
							{
								index: 1,
								authorName: "",
								text: "Keep a little room in your pack for what you find along the way.",
							},
						],
					},
				});
			} else if (panel === "spells") {
				seedSpellBar();
				spellBarProbe.bind(0, 1);
				spellBarProbe.bind(1, 2);
				spellBarProbe.bind(2, 3);
				spellBarProbe.bind(spellBar.tabs[spellBar.selected].length - 1, 1);
			} else if (panel === "combat") {
				combatBarProbe.active("melee");
				emitInteractionEvent("client-combat-mode-updated", { mode: "melee" });
			} else if (panel === "salvage") {
				api.salvageProbe.begin();
				api.salvageProbe.activateBound();
				// Opening the tool requires the same authority estimate as live use.
				api.salvageProbe.reply();
				salvageOwner.add(9201);
				api.salvageProbe.reply();
			}
			seedShowcaseHud();
			await tick();
		}
		if (showcase) {
			void sessionStarted
				.then(async () => {
					if (!mounted) return;
					await fixtureTheme.applyPreview(
						initialUserSettings.ui.themeId,
						false,
					);
					if (!mounted) return;
					seedShowcaseHud();
					nearbyMapFixture = true;
					waypointControls.enable();
					setWaypoint(SHOWCASE_WAYPOINT);
					waypointCameraHeading = Math.PI / 6;
					selection.select(7);
					warningVitals = SHOWCASE_VITAL_KINDS.map((kind) => ({
						kind,
						current: 100,
						maximum: 100,
					}));
					jumpExtent = 0.65;
					jumpChargeActive = true;
					const resetLayout = () => {
						const rect = gameplayCanvas?.getBoundingClientRect();
						if (rect === undefined)
							throw new Error("Showcase canvas did not mount");
						const defaults = createDefaultClientUserSettings(
							{ width: rect.width, height: rect.height },
							createClientShortcuts(true).length,
							"windows",
						);
						userSettings = { ...userSettings, hudLayout: defaults.hudLayout };
						if (characterSettings === null)
							throw new Error("Showcase character settings are missing");
						characterSettings = {
							...characterSettings,
							actionBars: showcaseActionBars(),
						};
					};
					const restartCooldown = () => {
						enchantments = {
							receivedAtMs: performance.now(),
							resolved: SHOWCASE_ENCHANTMENTS,
						};
					};
					resetLayout();
					restartCooldown();
					releaseShowcaseKeys = keyboard.bindGame({
						keydown: (event) => {
							if (gameplayView?.handleSystemPanelKeydown(event)) return;
							if (
								handleSpellBarKeydown(
									clientInput,
									event,
									spellBarEnabled,
									selectSpellTab,
									activateSpellCell,
									activateCasterSpell,
								)
							)
								return;
							handleCombatBarKeydown(
								clientInput,
								event,
								hudMode === "runtime" &&
									(spellCombatMode === "melee" ||
										spellCombatMode === "missile"),
								selectCombatBreakpoint,
								selectCombatHeight,
							);
						},
						keyup: () => {},
						cancel: () => {},
					});
					showcaseActions = {
						openPanel: openShowcasePanel,
						setVital: (kind, percent) => {
							warningVitals = warningVitals.map((vital) =>
								vital.kind === kind
									? { ...vital, current: percent, maximum: 100 }
									: vital,
							);
						},
						setWarningsEnabled: (enabled) => (vitalWarningsEnabled = enabled),
						setEditable: (editable) =>
							(hudMode = editable ? "layout" : "runtime"),
						setJump: (extent, active) => {
							jumpExtent = extent;
							jumpChargeActive = active;
						},
						setWaypointEnabled: (enabled) => {
							if (enabled) {
								waypointControls.enable();
								setWaypoint(SHOWCASE_WAYPOINT);
							} else clearWaypoint();
						},
						resetLayout,
						restartCooldown,
						notify: (message) => {
							toast = { id: performance.now(), message, tone: "status" };
						},
					};
					appendChat({
						kind: "system",
						message:
							"Welcome to the UI showcase. All windows share this client stage.",
					});
					await tick();
				})
				.catch((error: unknown) => {
					if (!mounted) return;
					console.error(error);
					showcaseStartupError =
						error instanceof Error ? error.message : String(error);
				});
		}

		return () => {
			mounted = false;
			showcaseActions = null;
			releaseShowcaseKeys?.();
			retireKeyboard();
			unsubscribeChat();
			objectInspectionProbe.end();
			unsubscribePanelAuthority();
			unsubscribeInspection();
			unsubscribeBookReader();
			bookReaderOwner.destroy();
			inspectionOwner.destroy();
			keyboardFixture?.dispose();
			spellState.destroy();
			references.dispose();
			spells = null;
			inventoryOwner.destroy();
			containerOwner.destroy();
			tradeOwner.destroy();
			trade = null;
			void barberOwner.destroy().catch((error) => {
				throw error;
			});
			barber = null;
			vendorOwner.destroy();
			unbindHousingDialogs();
			unbindSalvage();
			locksOwner.destroy();
			locks = null;
			salvageOwner.destroy();
			salvage = null;
			unbindItemDialogs();
			unbindContractDialogs();
			unsubscribeDialogs();
			sessionDialogs.destroy();
			if (dialogOwner === sessionDialogs) dialogOwner = null;
			housingManagementOwner.destroy();
			housingManagement = null;
			houseCrystalOwner.destroy();
			houseCrystal = null;
			vendor = null;
			worldContainer = null;
			unsubscribeInventoryToasts();
			publishLoadoutFeedback = null;
			inventoryToasts.destroy();
			inventory = null;
			icons.dispose();
			itemInteractions.destroy();
			interactions.destroy();
			unsubscribeSelection();
			selection.destroy();
			socialParty.destroy();
			nearbyOwner.destroy();
			emoteController.destroy();
			interactionLifecycle.stop();
			harnessGlobal.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__ = undefined;
		};
	});
</script>

{#snippet client()}
	<!-- Match the app's non-null dialog lifetime across nested snippet teardown. -->
	<div
		bind:this={interactionRoot}
		class="harness-appearance ui-theme"
		style:--ui-text-scale={userSettings.ui.textScale}
		style:--ui-scale={userSettings.ui.uiScale}
	>
		{#if !showcase && interactionRoot !== null}<UiTooltipHost
				root={interactionRoot}
			/>{/if}
		<div
			class="harness-dialog-scale"
			use:applyUiScale={userSettings.ui.uiScale}
		>
			{#each dialogPresentation === null ? [] : [dialogPresentation] as presentation}
				<ClientMessageDialog
					{presentation}
					onDismiss={(id) => dialogOwner?.dismissPopup(id)}
					onRespond={(id, accepted, suppress) => {
						void dialogOwner?.respond(id, accepted, suppress);
					}}
				/>
			{/each}
		</div>

		<canvas
			bind:this={gameplayCanvas}
			class="client-canvas gameplay"
			data-game-viewport
			tabindex="-1"
			aria-label="Game world"
		></canvas>
		{#if gameplayCanvas !== null && interactionRoot !== null}
			<ClientGameplayView
				statArtwork={{
					load: async () => STAT_ICON_FIXTURE,
					prepare: async () => {
						throw new Error("HUD stat icons must use their session repository");
					},
				}}
				platform="windows"
				{barber}
				lockInteractions={userSettings.lockInteractions}
				onLockInteractionsChange={(lockInteractions) =>
					(userSettings = { ...userSettings, lockInteractions })}
				chatSuppression={userSettings.chatSuppression}
				onChatSuppressionChange={(chatSuppression) =>
					(userSettings = { ...userSettings, chatSuppression })}
				{gameplayPreferences}
				gameplayEnabled={true}
				onGameplayOptionChange={async (option, enabled) => {
					const apply = () => {
						gameplayPreferences = {
							...gameplayPreferences,
							[option]: enabled,
						};
					};
					if (deferGameplayUpdate) {
						deferGameplayUpdate = false;
						pendingGameplayUpdate = apply;
					} else apply();
				}}
				{logopolisLaunchRevision}
				theme={fixtureTheme}
				canReturnToMenu={true}
				canDisconnect={true}
				onReturnToMainMenu={() => void interactionLifecycle.logout()}
				onDisconnect={() => void interactionLifecycle.disconnect()}
				bind:this={gameplayView}
				{emotesEnabled}
				nearby={nearbyOwner}
				onSelectKnownEntity={(guid) => selection.selectKnownEntity(guid)}
				onClearWaypoint={clearWaypoint}
				onSetWaypoint={setWaypoint}
				{partyHudPresent}
				readPartyHudDisplay={() =>
					presentPartyHud(
						interactionLifecycle.partySnapshot(),
						interactionLifecycle.state().playerGuid,
					)}
				onPartyHudDemand={(enabled) =>
					interactionLifecycle.setPartyUpdateDemand("hud", enabled)}
				party={socialParty}
				friends={interactionLifecycle.friends}
				contracts={interactionLifecycle.contracts}
				squelch={interactionLifecycle.squelch}
				allegiance={interactionLifecycle.allegiance}
				characterGuid={housingCharacterGuid}
				{houseCrystal}
				{housing}
				{housingManagement}
				onSearchHousing={async (houseType) => {
					housingSearches.push(houseType);
					housing = {
						...housing,
						search: { ...housing.search, pendingType: houseType },
					};
				}}
				onRefreshHousing={async () => {
					housingRefreshes += 1;
				}}
				readConnection={() => interactionLifecycle.connectionSample()}
				characterSheet={interactionLifecycle.characterSheet}
				{appearanceOptions}
				onAppearanceOptionChange={async (option, enabled) => {
					appearanceOptions = {
						...appearanceOptions,
						[option === "helmet" ? "showHelmet" : "showCloak"]: enabled,
					};
				}}
				inspectionPreviewHeight={userSettings.inspection.previewHeight}
				audio={userSettings.audio}
				onAudioChange={(audio) => (userSettings = { ...userSettings, audio })}
				graphics={userSettings.graphics}
				ui={userSettings.ui}
				clockFormat={userSettings.clockFormat}
				environmentOverrides={userSettings.environmentOverrides}
				weatherPresets={environmentPresets}
				{environmentIssue}
				readServerEnvironment={() => environmentServer.readout()}
				onClockFormatChange={(clockFormat) =>
					(userSettings = { ...userSettings, clockFormat })}
				onEnvironmentOverridesChange={changeEnvironmentOverrides}
				input={userSettings.input}
				textureFilteringCapabilities={{ maximumAnisotropy: 8 }}
				onGraphicsChange={(graphics) =>
					(userSettings = { ...userSettings, graphics })}
				onUiChange={(ui) => (userSettings = { ...userSettings, ui })}
				onInputChange={changeInput}
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
						replaceSource: async () => ({ kind: "installed" }),
						withdrawSource: async () => undefined,
						setViewport: () => undefined,
					}),
				}}
				itemSession={interactionLifecycle}
				hudLayout={userSettings.hudLayout}
				onHudPlacementChange={(surface, placement) =>
					(userSettings = {
						...userSettings,
						hudLayout: { ...userSettings.hudLayout, [surface]: placement },
					})}
				onHudReset={(hudLayout) =>
					(userSettings = { ...userSettings, hudLayout })}
				spellBarShape={userSettings.spellBarShape}
				onSpellBarShapeChange={(spellBarShape) =>
					(userSettings = { ...userSettings, spellBarShape })}
				minimapViewDiameters={userSettings.minimapViewDiameters}
				onMinimapViewDiametersChange={(minimapViewDiameters) =>
					(userSettings = { ...userSettings, minimapViewDiameters })}
				chatChannelFilters={userSettings.chatChannelFilters}
				onChatChannelFiltersChange={(chatChannelFilters) =>
					(userSettings = { ...userSettings, chatChannelFilters })}
				chatFilters={userSettings.chatFilters}
				chatTimestamps={userSettings.chatTimestamps}
				onChatTimestampsChange={(chatTimestamps) =>
					(userSettings = { ...userSettings, chatTimestamps })}
				onChatFiltersChange={(chatFilters) =>
					(userSettings = { ...userSettings, chatFilters })}
				actionBars={characterSettings?.actionBars ?? null}
				onActionBarsChange={(actionBars) => {
					if (characterSettings !== null)
						characterSettings = { ...characterSettings, actionBars };
				}}
				{hudMode}
				uiShowcase={new URLSearchParams(window.location.search).has(
					"hud-showcase",
				)}
				onHudModeChange={(mode) => (hudMode = mode)}
				{spellBar}
				onSpellBarChange={(state) => (spellBar = state)}
				{spellBarEnabled}
				onSelectSpellTab={selectSpellTab}
				onActivateSpellCell={activateSpellCell}
				onActivateCasterSpell={activateCasterSpell}
				combatMode={spellCombatMode}
				{combatStatus}
				{combatProfileSelectionRevision}
				combatControls={characterSettings?.combatControls ?? {
					melee: { height: "medium", power: 0.5 },
					missile: { height: "medium", accuracy: 0.5 },
				}}
				onCombatProfileSelect={selectCombatProfile}
				onStopCombat={() => {
					combatStatus = {
						desired: null,
						state: "idle",
						processedIntentSequence: 0,
						refill: null,
					};
				}}
				combatEnabled={true}
				onToggleCombat={() => {
					if (!showcase) return;
					spellCombatMode = spellCombatMode === "peace" ? "melee" : "peace";
					emitInteractionEvent("client-combat-mode-updated", {
						mode: spellCombatMode,
					});
				}}
				onCastSpell={(id) => void castSpell(id)}
				{itemInteractions}
				entityCollisionDisabled={false}
				onEntityCollisionDisabledChange={() => {}}
				cameraController={cameraEnabled ? cameraController : null}
				mouseMovement={mouseFixture.movement}
				{preciseJumpActive}
				onPreciseJumpAim={() => {
					preciseJumpAimCount += 1;
				}}
				onPreciseJumpPowerSet={(power) => {
					jumpExtent = Math.max(MINIMUM_JUMP_POWER, Math.min(1, power));
				}}
				onPreciseJumpPowerAdjust={(steps) => preciseJumpPowerSteps.push(steps)}
				onPreciseJumpActivate={() => {
					preciseJumpActivationCount += 1;
				}}
				readCanSetCorpsePermission={() => true}
				onCorpsePermission={(name, granted) => {
					toast = {
						id: 1,
						message: `corpse-permission:${name}:${granted}`,
						tone: "status",
					};
				}}
				onSocialNotice={(message) => {
					toast = { id: 1, message, tone: "warning" };
				}}
				onInventoryNotice={(message) => {
					toast = { id: 1, message, tone: "status" };
				}}
				onCoordinatesCopied={() => {
					toast = {
						id: 2,
						message: "Coordinates copied to clipboard.",
						tone: "status",
					};
				}}
				onPickInventoryTarget={(_x, _y, destination) => {
					if (inventoryWorldResult === null)
						pendingInventoryWorldPick = destination;
					else if (destination.isCurrent())
						destination.commit(inventoryWorldResult);
				}}
				onViewportSelect={(x, y, interact) => {
					viewportSelectionPoints.push({ x, y, interact });
					selectEntity(7);
				}}
				onViewportExamine={(x, y) => {
					viewportSelectionPoints.push({ x, y, interact: false });
					void inspectionOwner.examine(7);
				}}
				onViewportHover={() => {
					// The item-use fixture supplies explicit hit-test results through hoverWorld.
					if (activeItemUseProbe === null) hoveredGuid = 7;
				}}
				onViewportHoverClear={() => (hoveredGuid = null)}
				onMaintainEntitySelection={() => {}}
				onSelectPartyMember={(guid) => selection.selectKnownEntity(guid)}
				onSelectEntity={selectEntity}
				debugEnabled={true}
				{unrestrictedUse}
				onUnrestrictedUseChange={(enabled) => (unrestrictedUse = enabled)}
				{readMinimapFrame}
				worldMapSource={worldMapFixture.source}
				{canTeleportFromMap}
				recallDestinations={[]}
				onRecall={async () => {}}
				onTeleportToMapPosition={(position) =>
					interactionLifecycle.teleportToMapPosition(position)}
				{readDiagnostics}
				{readSelectedEntity}
				{readFrameRates}
				readTargetIndicatorFrame={() => null}
				readCombatTargetFrame={() => null}
				readLockFeedbackFrames={() => []}
				readSelectedEntityDisplay={() => interactions.display(unrestrictedUse)}
				{spells}
				{enchantments}
				{inventory}
				{worldContainer}
				{vendor}
				{locks}
				{salvage}
				{trade}
				onSelectContentsItem={(guid, mode) =>
					selection.selectContentsItem(guid, mode)}
				onInteractEntity={() =>
					itemInteractions.interactSelected(unrestrictedUse)}
				{inspection}
				{bookReader}
				onCloseBook={() => bookReaderOwner.close()}
				onRetryBook={() => bookReaderOwner.retry()}
				onExamineEntity={examineHarnessSelection}
				onExamineItem={examineHarnessItem}
				onExamineSpell={(spellId) => inspectionOwner.examineSpell(spellId)}
				onCloseInspection={() => inspectionOwner.close()}
				selectedEntityGuid={selectedGuid}
				hoveredEntityGuid={hoveredGuid}
				showRetailHiddenGeometry={false}
				onShowRetailHiddenGeometryChange={() => undefined}
				playerName={showcase ? "Wayfarer" : "Alice"}
				worldName={showcase ? "Dereth" : "ACE Emulator"}
				accountName="Fixture account"
				{vitalWarningsEnabled}
				vitals={warningVitals}
				{jumpChargeActive}
				jumpPowerKeys={["W", "S"]}
				readJumpExtent={() => jumpExtent}
				{toast}
				chatMessages={messages}
				{chatComposer}
				{sentChatHistory}
				onSendChat={async (message, resolution) => {
					const generation = chatComposer.generation;
					sentChatHistory = recordSentChat(
						sentChatHistory,
						message,
						chatHistoryLimit,
					);
					if (resolution.kind === "error") throw new Error(resolution.message);
					if (resolution.kind === "send" || resolution.kind === "sequence") {
						await emoteController.sendAll(
							resolution.kind === "send"
								? [resolution.request]
								: resolution.requests,
							{
								sendAll: (requests, send) =>
									chatComposer.sendAll(requests, async (request) => {
										await send(request);
										chatRequests.push(request);
									}),
							},
						);
					} else if (isLogopolisCommand(message)) {
						logopolisLaunchRevision += 1;
					} else if (runClientHelpCommand(message, appendChat)) {
						return;
					} else if (runClientVersionCommand(message, appendChat)) {
						return;
					} else if (
						await runClientCopyEntityCommand(
							message,
							readSelectedEntity,
							(notice) => {
								if (chatComposer.generation === generation) appendChat(notice);
							},
						)
					) {
						return;
					} else if (waypointProbeEnabled) submitWaypointChat(message);
					else if (message.startsWith("/"))
						throw new Error(
							"Unknown command. Use /help for supported commands.",
						);
					else await interactionLifecycle.sendChat({ kind: "speech", message });
				}}
				onChatNotice={(message) => {
					toast = { id: 1, message, tone: "warning" };
				}}
				onSendChatError={(message) => {
					appendChat({ kind: "error", message });
				}}
				canvasElement={gameplayCanvas}
				{interactionRoot}
			/>
		{/if}
	</div>
{/snippet}
{#if showcase}
	<UiShowcaseWorkbench
		session={showcaseSession}
		startupError={showcaseStartupError}
		themeSettings={fixtureTheme}
		preferences={userSettings}
		onSettingsChange={(settings) => (userSettings = settings)}
	>
		{@render client()}
	</UiShowcaseWorkbench>
{:else}
	{@render client()}
{/if}

<style>
	@layer components {
		.harness-appearance {
			display: contents;
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
