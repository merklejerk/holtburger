<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { z } from "zod";
	import "../../client/client-canvas.css";
	import { applyUiScale } from "../../app/theme/ui-scale";
	import { provideItemCooldowns } from "../../client/widgets/item-cooldowns.svelte";
	import { SpellReferences } from "../../client/magic/spell-references";
	import { browserUiIconRepository } from "../../client/widgets/ui-icon-repository";
	import type { FrameRates } from "../../app/performance/frame-rate-sampler";
	import type { MinimapFrame } from "../../app/minimap/frame";
	import { AppInput } from "../../lib/input/app-input";
	import { provideAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import type {
		CombatBreakpointIndex,
		CombatHeightIndex,
		InputDigitIndex,
		ClientInputConfiguration,
	} from "../../lib/input/input-contract";
	import { Mat4 } from "../../lib/game/math/types";
	import type { MapEntity } from "../../lib/game/map/map-blips";
	import type { MapWaypointTarget } from "../../lib/game/map/map-waypoint";
	import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
	import { RenderSceneInterestController } from "../../lib/game/runtime/render-scene-interest-controller";
	import type { ScenePlacement } from "../../lib/game/scene";
	import ClientGameplayView from "../../client/session/ClientGameplayView.svelte";
	import type {
		ClientGameplayCharacterSurface,
		ClientGameplayCombatMagicSurface,
		ClientGameplayInventorySurface,
		ClientGameplaySettingsSurface,
		ClientGameplayShellSurface,
		ClientGameplaySocialSurface,
		ClientGameplayWorldSurface,
	} from "../../client/session/gameplay-surfaces";
	import ClientMessageDialog from "../../client/hud/ClientMessageDialog.svelte";
	import { createClientShortcuts } from "../../client/hud/ClientShortcutDock.svelte";
	import { ClientBarberState } from "../../client/character/barber-state";
	import {
		ClientBookReader,
		type ClientBookReaderState,
	} from "../../client/inventory/book-reader";
	import { serverCommandRequest } from "../../client/social/chat-compose";
	import { ClientChatComposer } from "../../client/social/chat-composer.svelte";
	import { recordSentChat } from "../../client/social/chat-input-history";
	import {
		clientChatShouldSuppress,
		type ClientChatEntry,
		type ClientChatLine,
	} from "../../client/social/chat-policy";
	import { handleCombatBarKeydown } from "../../client/combat/combat-bar-input";
	import {
		COMBAT_BREAKPOINTS,
		COMBAT_HEIGHTS,
	} from "../../client/combat/combat-bar-state";
	import { runClientHelpCommand } from "../../client/session/command-help";
	import { runClientCopyEntityCommand } from "../../client/session/copy-entity-command";
	import {
		ClientDialogs,
		type ClientDialogPresentation,
	} from "../../client/hud/dialogs";
	import { ClientEmoteController } from "../../client/social/emote-controller";
	import type { ClientEntityFacts } from "../../client/world/entity-mirror";
	import { entityFacts } from "../../client/world/entity-mirror.test-support";
	import { ClientEntitySelection } from "../../client/world/entity-selection";
	import {
		bindClientPresentationEnvironment,
		clientWeatherPresets,
		createClientServerEnvironmentSource,
	} from "../../client/settings/environment";
	import type { ClientEnvironmentOverrides } from "../../client/settings/environment-settings";
	import {
		clientEnvironmentFixture,
		ENVIRONMENT_FIXTURE_DAY_SECONDS,
	} from "../../client/settings/environment.test-support";
	import type { ClientGameplayPresentationDiagnostics } from "../../client/session/gameplay-presentation";
	import {
		MINIMUM_JUMP_POWER,
		type ClientAttackProfile,
		type ClientCombatMode,
		type ClientCombatStatus,
		type ClientVital,
	} from "../../client/session/host-contract";
	import {
		emptyHousing,
		type HousingSnapshot,
	} from "../../client/housing/housing-contract";
	import { ClientHouseCrystalState } from "../../client/housing/house-crystal-state";
	import { ClientHousingManagementState } from "../../client/housing/housing-management-state";
	import { provideHudGeometry as provideClientHudGeometry } from "../../app/hud/hud-geometry-context";
	import { provideClientInput } from "../../client/session/input-context";
	import {
		clientInputConfiguration,
		clientInputSettingsSchema,
		clientKeyboardSettingsEqual,
	} from "../../client/settings/input-settings";
	import {
		ClientInspection,
		type ClientInspectionState,
	} from "../../client/inventory/inspection";
	import {
		EQUIPMENT_SLOTS,
		findWieldedCasterSpell,
	} from "../../client/inventory/inventory-equipment";
	import { ClientInventoryState } from "../../client/inventory/inventory-state";
	import { ClientItemInteractions } from "../../client/inventory/item-interactions";
	import {
		ClientLifecycleSession,
		type ClientTimedEnchantments,
	} from "../../client/session/lifecycle-session";
	import { ClientLocksState } from "../../client/inventory/locks-state";
	import { isLogopolisCommand } from "../../client/hud/logopolis";
	import { clientMinimapLandmark } from "../../client/hud/minimap-policy";
	import { ClientNavigationWaypointOwner } from "../../client/world/navigation-waypoint";
	import { ClientNearby } from "../../client/world/nearby";
	import { nearbySceneInterest } from "../../client/world/nearby.test-support";
	import {
		decodeObjectInspectionResult,
		type ObjectInspectionResult,
	} from "../../client/inventory/object-inspection-contract";
	import {
		PARTY_HUD_PREVIEW,
		presentPartyHud,
	} from "../../client/social/party-hud";
	import { ClientPartyState } from "../../client/social/party-state";
	import { ClientSalvageState } from "../../client/inventory/salvage-state";
	import { runClientScanCommand } from "../../client/session/scan-command";
	import { clientSelectedEntity } from "../../client/world/selected-entity";
	import { ClientSelectedEntityTracking } from "../../client/world/selected-entity-tracking";
	import type { ClientUserSettings } from "../../client/settings/settings-contract";
	import {
		createDefaultClientCharacterSettings,
		createDefaultClientUserSettings,
	} from "../../client/settings/settings-defaults";
	import { soulEmoteFixture } from "../../client/social/soul-emotes.test-support";
	import { pulseSpellBarCell } from "../../client/magic/spell-bar-feedback";
	import { handleSpellBarKeydown } from "../../client/magic/spell-bar-input";
	import {
		bindSpellCell,
		cycleSpellTab,
		initialSpellBar,
		swapSpellTabs,
	} from "../../client/magic/spell-bar-state";
	import { resolveClientSpellCastAim } from "../../client/magic/spell-casting";
	import {
		ClientSpellState,
		spellInspectionQuerySchema,
		type ClientSpellServices,
	} from "../../client/magic/spells";
	import { ClientSummonPresentation } from "../../client/combat/summon-presentation";
	import {
		HUD_TOAST_DURATION_MS as CLIENT_TOAST_DURATION_MS,
		HudToastCenter as ClientToastCenter,
		type HudToast as ClientToast,
	} from "../../app/hud/toast-center";
	import { ClientTradeState } from "../../client/inventory/trade-state";
	import {
		CLIENT_NEARBY_TUNING,
		CLIENT_TUNING,
		CLIENT_WAYPOINT_NEAR_RADIUS_METERS,
	} from "../../client/settings/tuning";
	import { ClientVendorState } from "../../client/inventory/vendor-state";
	import { runClientVersionCommand } from "../../client/session/version-command";
	import { ClientWorldContainerPanelState } from "../../client/inventory/world-container-panel-state";
	import { createSalvageFixture } from "./client-salvage-fixture";
	import { createTradeFixture } from "./client-trade-fixture";
	import { createVendorFixture } from "./client-vendor-fixture";
	import gameplayPreferencesFixture from "../../client/fixtures/gameplay-preferences.json";
	import { STAT_ICON_FIXTURE } from "./stat-icon-fixture";
	import UiShowcaseWorkbench from "./UiShowcaseWorkbench.svelte";
	import {
		SHOWCASE_CHARACTER_SHEET,
		SHOWCASE_ENCHANTMENTS,
		SHOWCASE_ITEM_GUID_BASE,
		SHOWCASE_VITAL_KINDS,
		SHOWCASE_WAYPOINT,
		showcaseActionBars,
		type ShowcasePanel,
		type UiShowcaseSession,
	} from "./ui-showcase-fixture";
	import { createFixtureThemeSettings } from "./ui-showcase-themes";
	import { createWorldMapFixture } from "./world-map-fixture";

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

	let gameplayView = $state<ClientGameplayView | null>(null);
	let gameplayCanvas = $state<HTMLCanvasElement | null>(null);
	let interactionRoot = $state<HTMLElement | null>(null);
	let warningVitals = $state<readonly ClientVital[]>(
		SHOWCASE_VITAL_KINDS.map((kind) => ({
			kind,
			current: 100,
			maximum: 100,
		})),
	);
	let vitalWarningsEnabled = $state(true);
	let partyHudPresent = $state(false);
	let spellBar = $state(initialSpellBar());
	const environmentRegion = clientEnvironmentFixture();
	const environmentServer = createClientServerEnvironmentSource(
		environmentRegion,
		() => ENVIRONMENT_FIXTURE_DAY_SECONDS * 1.9,
	);
	environmentServer.refresh(0);
	const environmentPresets = clientWeatherPresets(environmentRegion);
	let environmentIssue = $state<string | null>(null);
	const initialUserSettings = createDefaultClientUserSettings(
		{ width: window.innerWidth, height: window.innerHeight },
		9,
		"windows",
	);
	let userSettings = $state.raw<ClientUserSettings>({
		...initialUserSettings,
		ui: { ...initialUserSettings.ui, themeId: null },
	});
	const { keyboard } = provideAppInputPolicy();
	provideClientHudGeometry();
	const clientInput = provideClientInput(
		new AppInput(
			clientInputConfiguration(
				untrack(() => userSettings.input),
				"windows",
			),
		),
	);
	let environmentBinding = bindClientPresentationEnvironment(
		environmentServer,
		environmentRegion,
		untrack(() => userSettings.environmentOverrides),
	);
	environmentIssue = environmentBinding.issue;
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
		) {
			if (interactionRoot !== null)
				pulseSpellBarCell(interactionRoot, { tab: spellBar.selected, slot });
			void castSpell(id);
		}
	}
	function activateCasterSpell(): void {
		if (!spellBarEnabled || inventory === null) return;
		const caster = findWieldedCasterSpell(inventory.readItems().items.values());
		if (caster !== null) {
			if (interactionRoot !== null) pulseSpellBarCell(interactionRoot, null);
			itemInteractions.castWieldedSpell(caster.item);
		}
	}
	async function castSpell(id: number): Promise<void> {
		const spellState = spells;
		const currentSelection = selectedGuid;
		const reference =
			currentSelection === null && spellState !== null
				? await spellState.reference(id)
				: null;
		const details = reference?.kind === "known" ? reference.details : null;
		await interactionLifecycle.castSpell(
			id,
			resolveClientSpellCastAim(details, currentSelection),
		);
	}
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
	function activateCombatBar(mode: "melee" | "missile"): void {
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
	}
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
		activateCombatBar(profile.kind);
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

	const worldMapFixture = createWorldMapFixture();
	let housingCharacterGuid = $state<number | null>(1);
	let housing = $state<HousingSnapshot>(emptyHousing());
	let gameplayPreferences = $state({ ...gameplayPreferencesFixture });
	let appearanceOptions = $state({ showHelmet: true, showCloak: true });
	let unrestrictedUse = $state(false);
	let logopolisLaunchRevision = $state(0);
	let jumpChargeActive = $state(true);
	let jumpExtent = $state(0.65);
	let toast = $state<ClientToast | null>(null);
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
	let selectedGuid = $state<number | null>(null);
	let hoveredGuid = $state<number | null>(null);
	const interactionHandlers = new Map<string, (payload: unknown) => void>();
	const interactionCommands: {
		command: string;
		args: Record<string, unknown> | undefined;
	}[] = [];
	let canTeleportFromMap = $state(false);

	function emitInteractionBaseline(playerGuid = 1): void {
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
			worldName: "Dereth",
			accountName: "Fixture account",
			playerName,
			knownSpells: null,
			enchantments: null,
			party: null,
			friends: null,
			contracts: null,
			squelch: null,
			allegiance: {
				playerGuid: null,
				profile: null,
				refreshing: false,
				canSwear: false,
			},
			characterPreferences: {
				appearance: appearanceOptions,
				gameplay: gameplayPreferences,
				party: { shareXp: false, shareLoot: false, ignoreRequests: false },
				friends: { appearOffline: false },
				allegiance: { showLogons: false },
			},
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
			vendor: null,
			characterMotion: null,
			activeConfirmation: null,
			dynamic: { hostTime: { seconds: 10 }, entities: [] },
			entities: {
				projectileSupply: { kind: "not-applicable" },
				player: {
					pyrealBalance: null,
					aetheriaActivation: null,
					burden: null,
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
						equipLocations: null,
						consumable: null,
						useCapability: "direct",
						cooldown: null,
						stackCount: null,
						structure: { current: null, max: null },
						icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
						equipmentCantrip: null,
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
					isHostile: false,
					summon: null,
					corpse: null,
					health: null,
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

	let spellInspectionRevision = 1;
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
						rangeMetres: 25,
						formula: {
							kind: "ready",
							components: [1, 188, 0, 0, 0, 0, 0, 0],
						},
					},
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
		appendChat: (entry) => appendChat(entry),
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
	const inspectionOwner = new ClientInspection(
		interactionLifecycle,
		(message) => {
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
			toast = { id: 1, message, tone: "warning" };
		},
		beginAcquisition: () => keyboard.returnToGame(),
	});
	const unsubscribeSelection = selection.subscribe((guid) => {
		selectedGuid = guid;
	});

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

	const itemDescriptionPrefix = "Archived appraisal context. ";
	const longItemDescription = `${itemDescriptionPrefix.repeat(
		Math.floor(
			CLIENT_TUNING.objectInspection.collapsedDescriptionCharacters /
				itemDescriptionPrefix.length,
		) + 1,
	)}This final archival sentence must remain hidden until the reader explicitly expands the description.`;

	function showcaseItemInspection(guid: number): ObjectInspectionResult {
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
							progression: {
								level: 2,
								maxLevel: 5,
								totalXp: "350000000",
								advancement: {
									kind: "advancing",
									levelStartXp: "300000000",
									nextLevelXp: "700000000",
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
							coverage: [],
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
									data: { attribute: "SelfAttr", minimum: 295 },
								},
							],
							wieldRequirements: [
								{ type: "level", data: { level: 80 } },
								{
									type: "training",
									data: { skill: "HeavyWeapons", level: "Specialized" },
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
							augmentationCost: null,
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

	let dialogPresentation = $state<ClientDialogPresentation | null>(null);
	let dialogOwner: ClientDialogs | null = null;

	const chatHistoryLimit = 2;
	let savedRecentEmotes: readonly string[] = [];
	function createChatComposer(): ClientChatComposer {
		const composer = new ClientChatComposer({
			recentEmotes: savedRecentEmotes,
			onRecentEmotesChange: (ids) => (savedRecentEmotes = ids),
		});
		composer.setEmotes(soulEmoteFixture());
		return composer;
	}
	const chatComposer = $state.raw(createChatComposer());
	const emoteController = new ClientEmoteController(
		interactionLifecycle,
		keyboard,
		(error) => appendChat({ kind: "error", message: String(error) }),
	);
	let sentChatHistory = $state<readonly string[]>([]);
	let messages = $state<readonly ClientChatLine[]>([
		line(1, {
			kind: "system",
			message:
				"Welcome to the Holtburger UI showcase.\nEmbedded chat line breaks remain visible.",
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
	waypointOwner.acceptCharacter(1);
	let showcaseWaypointEnabled = $state(false);
	function notifyWaypoint(target: MapWaypointTarget): void {
		const message = `Waypoint set: ${target.label}.`;
		gameplayView?.revealWaypoint(target);
		toast = { id: performance.now(), message, tone: "status" };
	}
	function setWaypoint(target: MapWaypointTarget): void {
		waypointOwner.set(target, notifyWaypoint);
		showcaseWaypointEnabled = true;
	}
	function clearWaypoint(): void {
		waypointOwner.clear();
		showcaseWaypointEnabled = false;
	}

	function minimapEntity(): MapEntity {
		const transform = Mat4.identity();
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
					radar: { behavior: "ShowAlways", category: "mob" },
				},
				physics: { hidden: false, noDraw: false },
			} as unknown as DynamicEntityView,
		};
	}

	function readMinimapFrame(): MinimapFrame {
		const read = interactionLifecycle.entities.read();
		const facts = read.kind === "current" ? read.level.entities : null;
		const player = facts?.get(1);
		const playerName =
			player?.description.kind === "known" ? player.description.name : null;
		const second = minimapEntity();
		second.placement.localTransform.m41 += 20;
		const frame: MinimapFrame = {
			landmarkCategory: (guid) =>
				clientMinimapLandmark(facts?.get(guid), playerName),
			surfaceMapEligible: true,
			waypoint: null,
			cameraFovRadians: Math.PI / 3,
			cameraHeadingRadians: Math.PI / 6,
			presentedEntities: () => [
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
			],
			selectedGuid,
			trackedGuids: nearbyOwner.trackedGuids(),
			source: null,
			subject: {
				kind: "controlled-entity",
				guid: 1,
				anchor: {
					headingRadians: 0,
					residency: { landblockId: "0x0102ffff", envCellId: null },
					worldX: 100,
					worldY: 20,
					worldZ: -200,
				},
			},
		};
		return {
			...frame,
			waypoint: waypointOwner.read(frame, true),
		};
	}

	function readSelectedEntity() {
		return clientSelectedEntity(
			selection.selectedGuid(),
			interactionLifecycle.entities.read(),
			[minimapEntity().view],
		);
	}

	function readDiagnostics(): ClientGameplayPresentationDiagnostics {
		return {
			renderer: null,
			residentResources: null,
			playerGuid: 0x5000_0001,
			playerResidency: { landblockId: "0xda55ffff", envCellId: null },
			cameraResidency: { landblockId: "0xda55ffff", envCellId: null },
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
		const image = Uint8Array.from(
			atob(
				"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAM0lEQVR4nO3OQQEAMAjEsGN+Zm1ysDtk8EkNNHVf/yx2NucAAAAAAAAAAAAAAAAAAABJMlWEAnCwXL+/AAAAAElFTkSuQmCC",
			),
			(character) => character.charCodeAt(0),
		);
		const icons = browserUiIconRepository(async (requests) =>
			requests.map(({ key }) => ({ kind: "ready" as const, key, image })),
		);
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
		const summonOwner = new ClientSummonPresentation(
			interactionLifecycle,
			(message) => {
				appendChat({ kind: "combat-notice", message });
				inventoryToasts.publish({ message, tone: "status" });
			},
			(error) => {
				throw error;
			},
		);
		const inventoryOwner = new ClientInventoryState(
			{
				entities: interactionLifecycle.entities,
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
			() => 0,
		);
		vendor = vendorOwner;
		const houseCrystalOwner = new ClientHouseCrystalState(
			interactionLifecycle,
			icons,
			(message) => inventoryToasts.publish({ message, tone: "warning" }),
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
			(message) => inventoryToasts.publish({ message, tone: "warning" }),
		);
		trade = tradeOwner;
		const references = new SpellReferences({
			invoke: async (command, args) => {
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
									school: {
										kind: "known",
										school:
											id === 666
												? "creature-enchantment"
												: id === 2000
													? "void-magic"
													: id % 2 === 0
														? "life-magic"
														: "item-enchantment",
									},
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
		const unsubscribePanelAuthority = interactionLifecycle.subscribe(
			(event) => {
				if (event.type === "party-presence") {
					partyHudPresent = event.hudPresent;
					chatComposer.inParty = event.inParty;
				}
				if (event.type === "party-updates-failed")
					throw new Error(event.message);
				if (event.type === "housing-updated") housing = event.housing;
				if (event.type === "current-state") {
					housing = event.state.housing;
					housingCharacterGuid = event.state.localPlayerGuid;
					canTeleportFromMap = event.state.canTeleportFromMap;
				}
				if (event.type === "map-teleport-capability")
					canTeleportFromMap = event.allowed;
			},
		);

		const vendorFixture = createVendorFixture({
			emit: emitInteractionEvent,
			baseline: emitInteractionBaseline,
			commands: interactionCommands,
		});
		const tradeFixture = createTradeFixture({
			emit: emitInteractionEvent,
			baseline: emitInteractionBaseline,
			select: (guid) => selection.select(guid),
		});
		const salvageFixture = createSalvageFixture({
			emit: emitInteractionEvent,
			baseline: emitInteractionBaseline,
			commands: interactionCommands,
			showInventory: () => gameplayView?.showInventory(),
			select: (guid) => selection.select(guid),
			activateBound: (guid) => itemInteractions.activate(guid, "direct", false),
		});

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
				player: null,
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
			const current = interactionLifecycle.entities.read();
			const target7 =
				current.kind === "current" ? current.level.entities.get(7) : undefined;
			if (target7 !== undefined) {
				emitInteractionEvent("client-entity-facts-changed", {
					projectileSupply: null,
					player: null,
					worldContainer: null,
					removed: [],
					upserts: [
						{
							...target7,
							health: {
								instanceSequence: 1,
								fraction: 0.68,
								observedAtSeconds: (target7.health?.observedAtSeconds ?? 0) + 1,
							},
						},
					],
				});
			}
		}

		async function openShowcasePanel(panel: ShowcasePanel): Promise<void> {
			if (gameplayView === null)
				throw new Error("Showcase client fixture did not mount");
			if (panel === "inventory") {
				gameplayView.showInventory();
			} else if (panel === "vendor") {
				vendorFixture.begin();
				await vendorFixture.settle();
				vendorFixture.reply({
					buys: [],
					sells: [],
					currencies: vendorFixture.currencies,
					affordable: true,
				});
			} else if (panel === "trade") {
				tradeFixture.begin();
				tradeFixture.register();
				tradeFixture.acknowledge();
			} else if (panel === "inspection") {
				await inspectionOwner.examine(7);
				emitInteractionEvent(
					"client-object-inspection-result",
					showcaseItemInspection(7),
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
				for (const [slot, spell] of [
					[0, 1],
					[1, 2],
					[2, 3],
					[spellBar.tabs[spellBar.selected].length - 1, 1],
				] as const) {
					spellBar = bindSpellCell(
						spellBar,
						{ tab: spellBar.selected, slot },
						spell,
					);
				}
			} else if (panel === "combat") {
				activateCombatBar("melee");
				emitInteractionEvent("client-combat-mode-updated", { mode: "melee" });
			} else if (panel === "salvage") {
				salvageFixture.begin();
				salvageFixture.activateBound();
				salvageFixture.reply();
				salvageOwner.add(9201);
				salvageFixture.reply();
			}
			seedShowcaseHud();
			await tick();
		}

		void interactionLifecycle
			.start()
			.then(async () => {
				if (!mounted) return;
				await fixtureTheme.applyPreview(initialUserSettings.ui.themeId, false);
				if (!mounted) return;
				selection.select(7);
				seedShowcaseHud();
				setWaypoint(SHOWCASE_WAYPOINT);
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
						if (
							handleSpellBarKeydown(
								clientInput,
								event,
								spellBarEnabled,
								selectSpellTab,
								activateSpellCell,
								activateCasterSpell,
								(direction) =>
									selectSpellTab(cycleSpellTab(spellBar, direction)),
							)
						)
							return;
						handleCombatBarKeydown(
							clientInput,
							event,
							hudMode === "runtime" &&
								(spellCombatMode === "melee" || spellCombatMode === "missile"),
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
						if (enabled) setWaypoint(SHOWCASE_WAYPOINT);
						else clearWaypoint();
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

		return () => {
			mounted = false;
			showcaseActions = null;
			releaseShowcaseKeys?.();
			retireKeyboard();
			unsubscribeChat();
			unsubscribePanelAuthority();
			unsubscribeInspection();
			unsubscribeBookReader();
			bookReaderOwner.destroy();
			inspectionOwner.destroy();
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
			summonOwner.destroy();
			unsubscribeInventoryToasts();
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
		};
	});

	const hudShowcaseEnabled = new URLSearchParams(window.location.search).has(
		"hud-showcase",
	);

	const gameplayShell: ClientGameplayShellSurface = {
		platform: "windows",
		get canvasElement() {
			if (gameplayCanvas === null) {
				throw new Error("Showcase shell requires a mounted canvas element.");
			}
			return gameplayCanvas;
		},
		get interactionRoot() {
			if (interactionRoot === null) {
				throw new Error("Showcase shell requires a mounted interaction root.");
			}
			return interactionRoot;
		},
		get hudMode() {
			return hudMode;
		},
		uiShowcase: hudShowcaseEnabled,
		onHudModeChange(mode) {
			hudMode = mode;
		},
		debugEnabled: true,
		canReturnToMenu: true,
		canDisconnect: true,
		onReturnToMainMenu() {
			void interactionLifecycle.logout();
		},
		onDisconnect() {
			void interactionLifecycle.disconnect();
		},
		readPerformanceSession: () => null,
		readDiagnostics,
		readFrameRates,
		entityCollisionDisabled: false,
		onEntityCollisionDisabledChange: () => {},
		get unrestrictedUse() {
			return unrestrictedUse;
		},
		onUnrestrictedUseChange(enabled) {
			unrestrictedUse = enabled;
		},
		showRetailHiddenGeometry: false,
		onShowRetailHiddenGeometryChange: () => undefined,
		get logopolisLaunchRevision() {
			return logopolisLaunchRevision;
		},
		get toast() {
			return toast;
		},
	};

	const gameplaySettings: ClientGameplaySettingsSurface = {
		get hudLayout() {
			return userSettings.hudLayout;
		},
		onHudPlacementChange(surface, placement) {
			userSettings = {
				...userSettings,
				hudLayout: { ...userSettings.hudLayout, [surface]: placement },
			};
		},
		onHudReset(hudLayout) {
			userSettings = { ...userSettings, hudLayout };
		},
		get spellBarShape() {
			return userSettings.spellBarShape;
		},
		onSpellBarShapeChange(spellBarShape) {
			userSettings = { ...userSettings, spellBarShape };
		},
		get minimapViewDiameters() {
			return userSettings.minimapViewDiameters;
		},
		onMinimapViewDiametersChange(minimapViewDiameters) {
			userSettings = { ...userSettings, minimapViewDiameters };
		},
		get audio() {
			return userSettings.audio;
		},
		onAudioChange(audio) {
			userSettings = { ...userSettings, audio };
		},
		get graphics() {
			return userSettings.graphics;
		},
		onGraphicsChange(graphics) {
			userSettings = { ...userSettings, graphics };
		},
		textureFilteringCapabilities: { maximumAnisotropy: 8 },
		theme: fixtureTheme,
		get ui() {
			return userSettings.ui;
		},
		onUiChange(ui) {
			userSettings = { ...userSettings, ui };
		},
		get nameplates() {
			return userSettings.nameplates;
		},
		onNameplatesChange(nameplates) {
			userSettings = { ...userSettings, nameplates };
		},
		get input() {
			return userSettings.input;
		},
		onInputChange: changeInput,
		get lockInteractions() {
			return userSettings.lockInteractions;
		},
		onLockInteractionsChange(lockInteractions) {
			userSettings = { ...userSettings, lockInteractions };
		},
		get camera() {
			return userSettings.camera;
		},
		onCameraChange(camera) {
			userSettings = { ...userSettings, camera };
		},
		get chatSuppression() {
			return userSettings.chatSuppression;
		},
		onChatSuppressionChange(chatSuppression) {
			userSettings = { ...userSettings, chatSuppression };
		},
		get chatChannelFilters() {
			return userSettings.chatChannelFilters;
		},
		onChatChannelFiltersChange(chatChannelFilters) {
			userSettings = { ...userSettings, chatChannelFilters };
		},
		get chatFilters() {
			return userSettings.chatFilters;
		},
		onChatFiltersChange(chatFilters) {
			userSettings = { ...userSettings, chatFilters };
		},
		get chatTimestamps() {
			return userSettings.chatTimestamps;
		},
		onChatTimestampsChange(chatTimestamps) {
			userSettings = { ...userSettings, chatTimestamps };
		},
		get clockFormat() {
			return userSettings.clockFormat;
		},
		onClockFormatChange(clockFormat) {
			userSettings = { ...userSettings, clockFormat };
		},
		get environmentOverrides() {
			return userSettings.environmentOverrides;
		},
		onEnvironmentOverridesChange: changeEnvironmentOverrides,
		weatherPresets: environmentPresets,
		get environmentIssue() {
			return environmentIssue;
		},
		readServerEnvironment: () => environmentServer.readout(),
		get inspectionPreviewHeight() {
			return userSettings.inspection.previewHeight;
		},
		onInspectionPreviewHeightChange(previewHeight) {
			userSettings = {
				...userSettings,
				inspection: { previewHeight },
			};
		},
	};

	const gameplayCharacter: ClientGameplayCharacterSurface = {
		get characterGuid() {
			return housingCharacterGuid;
		},
		playerName: "Wayfarer",
		worldName: "Dereth",
		accountName: "Fixture account",
		readConnection: () => interactionLifecycle.connectionSample(),
		get vitals() {
			return warningVitals;
		},
		get vitalWarningsEnabled() {
			return vitalWarningsEnabled;
		},
		get characterSheet() {
			return interactionLifecycle.characterSheet;
		},
		statArtwork: {
			load: async () => STAT_ICON_FIXTURE,
			prepare: async () => {
				throw new Error("HUD stat icons must use their session repository");
			},
		},
		get enchantments() {
			return enchantments;
		},
		get appearanceOptions() {
			return appearanceOptions;
		},
		async onAppearanceOptionChange(option, enabled) {
			appearanceOptions = {
				...appearanceOptions,
				[option === "helmet" ? "showHelmet" : "showCloak"]: enabled,
			};
		},
		get gameplayPreferences() {
			return gameplayPreferences;
		},
		gameplayEnabled: true,
		async onGameplayOptionChange(option, enabled) {
			gameplayPreferences = {
				...gameplayPreferences,
				[option]: enabled,
			};
		},
		get jumpChargeActive() {
			return jumpChargeActive;
		},
		readJumpExtent: () => jumpExtent,
		jumpPowerKeys: ["W", "S"],
		preciseJumpActive: false,
		onPreciseJumpAim: () => {},
		onPreciseJumpPowerAdjust: () => {},
		onPreciseJumpPowerSet(power) {
			jumpExtent = Math.max(MINIMUM_JUMP_POWER, Math.min(1, power));
		},
		onPreciseJumpActivate: () => {},
	};

	const gameplayInventory: ClientGameplayInventorySurface = {
		get inventory() {
			return inventory;
		},
		itemSession: interactionLifecycle,
		itemInteractions,
		get actionBars() {
			return characterSettings?.actionBars ?? null;
		},
		onActionBarsChange(actionBars) {
			if (characterSettings !== null)
				characterSettings = { ...characterSettings, actionBars };
		},
		get worldContainer() {
			return worldContainer;
		},
		get vendor() {
			return vendor;
		},
		get houseCrystal() {
			return houseCrystal;
		},
		get salvage() {
			return salvage;
		},
		get locks() {
			return locks;
		},
		get barber() {
			return barber;
		},
		get trade() {
			return trade;
		},
		onSelectContentsItem(guid, mode) {
			selection.selectContentsItem(guid, mode);
		},
		onPickInventoryTarget(_x, _y, destination) {
			if (destination.isCurrent()) destination.commit({ kind: "empty" });
		},
		onInventoryNotice(message) {
			toast = { id: 1, message, tone: "status" };
		},
	};

	const gameplayCombatMagic: ClientGameplayCombatMagicSurface = {
		get combatMode() {
			return spellCombatMode;
		},
		get combatStatus() {
			return combatStatus;
		},
		get combatControls() {
			return (
				characterSettings?.combatControls ?? {
					melee: { height: "medium", power: 0.5 },
					missile: { height: "medium", accuracy: 0.5 },
				}
			);
		},
		get combatProfileSelectionRevision() {
			return combatProfileSelectionRevision;
		},
		onCombatProfileSelect: selectCombatProfile,
		onStopCombat() {
			combatStatus = {
				desired: null,
				state: "idle",
				processedIntentSequence: 0,
				refill: null,
			};
		},
		combatEnabled: true,
		onToggleCombat() {
			spellCombatMode = spellCombatMode === "peace" ? "melee" : "peace";
			emitInteractionEvent("client-combat-mode-updated", {
				mode: spellCombatMode,
			});
		},
		get spells() {
			return spells;
		},
		get spellBar() {
			return spellBar;
		},
		onSpellBarChange(state) {
			spellBar = state;
		},
		onSwapSpellTabs(source, target) {
			const swapped = swapSpellTabs(spellBar, source, target);
			if (swapped === spellBar) return;
			spellBar = swapped;
			toast = {
				id: (toast?.id ?? 0) + 1,
				message: `Swapped spell tabs ${(source + 1) % 10} and ${(target + 1) % 10}.`,
				tone: "status",
			};
		},
		get spellBarEnabled() {
			return spellBarEnabled;
		},
		onSelectSpellTab: selectSpellTab,
		onActivateSpellCell: activateSpellCell,
		onActivateCasterSpell: activateCasterSpell,
		onCastSpell(id) {
			void castSpell(id);
		},
		spellCastTarget: null,
		readCombatTargetFrame: () => null,
		readLockFeedbackFrames: () => [],
		hasActiveLockFeedback: () => false,
		lockFeedbackWakeRevision: 0,
	};

	const gameplayWorld: ClientGameplayWorldSurface = {
		cameraController: {
			setOrbitHeld() {},
			pitch() {},
			followRear() {},
			orbit() {},
			zoom() {},
		},
		mouseMovement: {
			onForward() {},
			onTurn() {},
			onCancelTurn() {},
			onError() {},
		},
		readMinimapFrame,
		onCoordinatesCopied() {
			toast = {
				id: 2,
				message: "Coordinates copied to clipboard.",
				tone: "status",
			};
		},
		onSetWaypoint: setWaypoint,
		onClearWaypoint: clearWaypoint,
		nearby: nearbyOwner,
		get selectedEntityGuid() {
			return selectedGuid;
		},
		get hoveredEntityGuid() {
			return hoveredGuid;
		},
		readSelectedEntity,
		readSelectedEntityDisplay: () => interactions.display(unrestrictedUse),
		readTargetIndicatorFrame: () => null,
		onViewportSelect() {
			selection.select(7);
		},
		onViewportExamine() {
			void inspectionOwner.examine(7);
		},
		onViewportHover() {
			hoveredGuid = 7;
		},
		onViewportHoverClear() {
			hoveredGuid = null;
		},
		onMaintainEntitySelection: () => {},
		onSelectEntity(guid) {
			selection.select(guid);
		},
		onSelectKnownEntity(guid) {
			return selection.selectKnownEntity(guid);
		},
		onInteractEntity() {
			itemInteractions.interactSelected(unrestrictedUse);
		},
		get inspection() {
			return inspection;
		},
		inspectionItemSelection: selection,
		objectPreviewService: {
			open: () => ({
				dispose: async () => undefined,
				diagnostics: () => null,
				ready: Promise.resolve(),
				replaceSource: async () => ({ kind: "installed" }),
				withdrawSource: async () => undefined,
				setViewport: () => undefined,
			}),
		},
		onExamineEntity() {
			const guid = selection.selectedGuid();
			if (guid !== null) void inspectionOwner.examine(guid);
		},
		onExamineItem(guid) {
			void inspectionOwner.examine(guid);
		},
		onExamineSpell(spellId) {
			inspectionOwner.examineSpell(spellId);
		},
		onCloseInspection() {
			inspectionOwner.close();
		},
		get bookReader() {
			return bookReader;
		},
		onCloseBook() {
			bookReaderOwner.close();
		},
		onRetryBook() {
			bookReaderOwner.retry();
		},
		worldMapSource: worldMapFixture.source,
		get housing() {
			return housing;
		},
		get housingManagement() {
			return housingManagement;
		},
		onRefreshHousing: async () => {},
		async onSearchHousing(houseType) {
			housing = {
				...housing,
				search: { ...housing.search, pendingType: houseType },
			};
		},
		get canTeleportFromMap() {
			return canTeleportFromMap;
		},
		recallDestinations: [],
		onRecall: async () => {},
		onTeleportToMapPosition(position) {
			return interactionLifecycle.teleportToMapPosition(position);
		},
	};

	const gameplaySocial: ClientGameplaySocialSurface = {
		get chatMessages() {
			return messages;
		},
		get chatComposer() {
			return chatComposer;
		},
		get sentChatHistory() {
			return sentChatHistory;
		},
		async onSendChat(message, resolution) {
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
				runClientScanCommand(
					message,
					() => nearbyOwner.read().rows,
					(guid) => selection.selectKnownEntity(guid),
					appendChat,
				)
			) {
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
			} else {
				await interactionLifecycle.sendChat(serverCommandRequest(message));
			}
		},
		onSendChatError(message) {
			appendChat({ kind: "error", message });
		},
		onChatNotice(message) {
			toast = { id: 1, message, tone: "warning" };
		},
		emotesEnabled: true,
		party: socialParty,
		get partyHudPresent() {
			return partyHudPresent;
		},
		readPartyHudDisplay: () =>
			presentPartyHud(
				interactionLifecycle.partySnapshot(),
				interactionLifecycle.state().playerGuid,
			),
		onPartyHudDemand(enabled) {
			interactionLifecycle.setPartyUpdateDemand("hud", enabled);
		},
		onSelectPartyMember(guid) {
			selection.selectKnownEntity(guid);
		},
		get friends() {
			return interactionLifecycle.friends;
		},
		get contracts() {
			return interactionLifecycle.contracts;
		},
		get squelch() {
			return interactionLifecycle.squelch;
		},
		get allegiance() {
			return interactionLifecycle.allegiance;
		},
		readCanSetCorpsePermission: () => true,
		onCorpsePermission(name, granted) {
			toast = {
				id: 1,
				message: `corpse-permission:${name}:${granted}`,
				tone: "status",
			};
		},
		onSocialNotice(message) {
			toast = { id: 1, message, tone: "warning" };
		},
	};
</script>

<UiShowcaseWorkbench
	session={showcaseSession}
	startupError={showcaseStartupError}
	themeSettings={fixtureTheme}
	preferences={userSettings}
	onSettingsChange={(settings) => (userSettings = settings)}
>
	<div
		bind:this={interactionRoot}
		class="harness-appearance ui-theme"
		style:--ui-text-scale={userSettings.ui.textScale}
		style:--ui-scale={userSettings.ui.uiScale}
	>
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
				bind:this={gameplayView}
				shell={gameplayShell}
				settings={gameplaySettings}
				character={gameplayCharacter}
				inventory={gameplayInventory}
				combatMagic={gameplayCombatMagic}
				world={gameplayWorld}
				social={gameplaySocial}
			/>
		{/if}
	</div>
</UiShowcaseWorkbench>

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
