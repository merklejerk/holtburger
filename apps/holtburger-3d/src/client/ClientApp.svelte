<script lang="ts">
	import { clientMinimapLandmark } from "./client-minimap-policy";
	import { launcherTransport } from "../launcher/launcher-transport";
	import type {
		ClientGameplayOption,
		ClientGameplayPreferences,
	} from "./client-gameplay-options-contract";
	import type {
		UiThemeSelection,
		UiThemeSettings,
	} from "../app/ui-theme-selection";
	import ClientPregameSettings from "./ClientPregameSettings.svelte";
	import { choosePregameLocation } from "./client-pregame-tuning";
	import PowerIcon from "../assets/icons/hud-power.svg?component";
	import { provideItemCooldowns } from "../app/item-cooldowns.svelte";
	import "./client-canvas.css";
	import { persistPlayerVisualCapture } from "./client-visual-capture";
	import type { ClientVisualCacheTransport } from "./client-visual-cache-transport";
	import { ClientFacingInputDispatch } from "./client-facing-input-dispatch";
	import type { ClientMouseMovementInput } from "./client-viewport-mouse-controller";
	import { loadSoulEmotes } from "./client-soul-emotes";
	import type { SceneInterestMembership } from "../lib/game/runtime/render-scene-interest-controller";
	import { startPresentationFrameLoop } from "../app/presentation-frame-loop";
	import { ClientNavigationWaypointOwner } from "./client-navigation-waypoint";
	import { runClientAssetsCommand } from "./client-assets-command";
	import { runClientVersionCommand } from "./client-version-command";
	import { isLogopolisCommand } from "./client-logopolis";
	import { runClientLocationCommand } from "./client-location-command";
	import { ClientDeathCommands } from "./client-death-commands";
	import { runRecallCommand } from "./client-recall-command";
	import { runClientHelpCommand } from "./client-command-help";
	import {
		compactInputHint,
		inputDisplayPlatform,
	} from "../lib/input/input-presentation";
	import { presentPartyHud } from "./client-party-hud";
	import { observeCombatEffectsAppearance } from "./client-combat-effects-appearance";
	import type { CombatEffectsAppearance } from "../lib/game/systems/combat-effects-system";
	import { ClientPartyState } from "./client-party-state";
	import { ClientHousingManagementState } from "./client-housing-management-state";
	import {
		emptyHousing,
		type HousingSnapshot,
	} from "./client-housing-contract";
	import { ClientVendorState } from "./client-vendor-state";
	import { sampleEntityDistanceMeters } from "./client-entity-distance";
	import { ClientHouseCrystalState } from "./client-house-crystal-state";
	import { ClientWorldContainerPanelState } from "./client-world-container-panel-state";
	import {
		initialSpellBarBindings,
		type ClientSpellBarState,
	} from "./client-spell-bar-state";
	import type {
		CombatBreakpointIndex,
		CombatHeightIndex,
		ClientInputConfiguration,
		InputDigitIndex,
	} from "../lib/input/input-contract";
	import { handleCombatBarKeydown } from "./client-combat-bar-input";
	import { handleSpellBarKeydown } from "./client-spell-bar-input";
	import {
		COMBAT_BREAKPOINTS,
		COMBAT_HEIGHTS,
	} from "./client-combat-bar-state";
	import { SpellReferences } from "../app/spell-references";
	import { ClientSpellState, type ClientSpellServices } from "./client-spells";
	import { ClientTradeState } from "./client-trade-state";
	import { ClientItemInteractions } from "./client-item-interactions";
	import { ClientLocksState } from "./client-locks-state";
	import { ClientSalvageState } from "./client-salvage-state";
	import { ClientInventoryState } from "./client-inventory-state";
	import {
		ClientBookReader,
		type ClientBookReaderState,
	} from "./client-book-reader";
	import { findWieldedCasterSpell } from "./client-inventory-equipment";
	import { browserUiIconRepository } from "../app/ui-icon-repository";
	import { prepareUiIcons } from "../app/ui-icon-source";
	import {
		clientSelectedEntity,
		type ClientSelectedEntity,
	} from "./client-selected-entity";
	import { z } from "zod";
	import ClientMessageDialog from "./ClientMessageDialog.svelte";
	import ClientToastOverlay from "./ClientToastOverlay.svelte";
	import { ClientContractNotifications } from "./client-contract-notifications";
	import {
		ClientDialogs,
		type ClientDialogPresentation,
	} from "./client-dialogs";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type { EscapeContextHandle } from "../lib/input/keyboard-input-policy";
	import { AppInput } from "../lib/input/app-input";
	import { provideClientInput } from "./client-input-context";
	import {
		clientInputConfiguration,
		clientInputSettingsSchema,
		clientKeyboardSettingsEqual,
	} from "./client-input-settings";
	import { clientFailureDiagnostic } from "./client-close-contract";
	import { onMount, untrack } from "svelte";
	import {
		createFrameRateSampler,
		type FrameRates,
		type FrameRateSampler,
	} from "../app/frame-rate-sampler";

	import {
		CharacterInputController,
		type CharacterDrive,
		type CharacterDriveIntent,
		type CharacterInputEdge,
	} from "../lib/game/controls/character-input-controller";
	import {
		CLIENT_TUNING,
		CLIENT_NEARBY_TUNING,
		CLIENT_WAYPOINT_NEAR_RADIUS_METERS,
	} from "./client-tuning";
	import { recordSentChat } from "./client-chat-input-history";
	import {
		createElectronHostTransport,
		startElectronClient,
		registerElectronClientClose,
		requestElectronClientClose,
	} from "../lib/host/electron-host-transport";
	import type { HostTransport } from "../lib/host/host-transport";
	import {
		ClientLifecycleSession,
		hostClientLifecycleTransport,
		type ClientLifecycleSessionEvent,
		type ClientTimedEnchantments,
	} from "./client-lifecycle-session";
	import {
		ClientGameplayPresentation,
		type ClientGameplayPresentationCameraController,
		type ClientGameplayPresentationDiagnostics,
		type ClientGameplayPresentationStatus,
	} from "./client-gameplay-presentation";
	import { StandardClientObjectPreviewService } from "./client-object-preview-service";
	import { HostPresentationAssets } from "../lib/game/runtime/host-presentation-assets";
	import { RuntimeTickProfiler } from "../lib/game/runtime/runtime-tick-profiler";
	import { ClientPresentationRoot } from "./client-presentation-root";

	import { GamePresentationOwner } from "../lib/game/runtime/game-presentation-owner";
	import { PresentationTeardownStack } from "../lib/game/runtime/presentation-teardown";
	import { clientDebugEnabled } from "./client-debug";
	import ClientCharacterSelect from "./ClientCharacterSelect.svelte";
	import ClientLoadingPage from "./ClientLoadingPage.svelte";
	import DisconnectIcon from "../assets/icons/pregame-disconnect.svg?component";
	import RetryIcon from "../assets/icons/hud-reset.svg?component";
	import {
		loadCharacterCreationCatalog,
		resolveCharacterCreationAppearance,
		resolveCharacterCreationStats,
	} from "./client-character-creation-contract";
	import type { CharacterCreationServices } from "./client-character-creation";
	import {
		ClientSelectedEntityTracking,
		type ClientSelectedEntityDisplay,
		EMPTY_CLIENT_SELECTED_DISPLAY,
	} from "./client-selected-entity-tracking";
	import ClientGameplayView from "./ClientGameplayView.svelte";
	import { hostWorldMapSource } from "../lib/assets/world-map-source";
	import type { MinimapFrame } from "../app/minimap-frame";
	import type {
		RecallDestination,
		CharacterManagementState,
		ClientCombatMode,
		ClientMapPosition,
		ClientAttackProfile,
		ClientCombatStatus,
		ClientCharacterMotionCapabilities,
		ClientCharacterMotionEventRequest,
		ClientCharacterMotionRejection,
		ClientAppearanceOption,
		ClientAppearanceOptions,
		ClientDriveRequest,
		ClientVital,
	} from "./client-host-contract";
	import {
		clientChatShouldSuppress,
		type ClientChatEntry,
		type ClientChatLine,
	} from "./client-chat-policy";
	import { ClientChatComposer } from "./client-chat-composer.svelte";
	import {
		selectedChatRecipient,
		type ChatComposeResolution,
	} from "./client-chat-compose";
	import type { FrameSettings } from "../lib/game/renderer/renderer";
	import {
		resolveTextureFilteringPolicy,
		type TextureFilteringCapabilities,
	} from "../lib/game/renderer/texture-filtering-policy";
	import type {
		ClientCharacterSettings,
		ClientAudioSettings,
		ClientGraphicsSettings,
		ClientUiSettings,
		ClientUserSettings,
	} from "./client-settings-contract";
	import {
		clientAudioSettingsSchema,
		clientGraphicsSettingsSchema,
		clientUiSettingsSchema,
	} from "./client-settings-contract";
	import type { ClientUserSettingsPatch } from "./client-settings-sections";
	import {
		clientClockFormatSchema,
		clientEnvironmentOverridesSchema,
		type ClientEnvironmentOverrides,
	} from "./client-environment-settings";
	import type { ClientWeatherPreset } from "./client-environment";
	import type {
		ClientHudLayout,
		ClientHudPlacement,
	} from "./client-hud-layout";
	import {
		CLIENT_FONT_FAMILY_CSS,
		type ClientFontFamily,
	} from "./client-settings-values";
	import {
		clientSceneInterestRadii,
		frameSettingsWithGraphics,
	} from "./client-settings-policy";
	import {
		ClientCharacterSettingsOwner,
		type ClientCharacterSettingsState,
	} from "./client-character-settings-owner";
	import type { ClientSettingsTransport } from "./client-settings-transport";
	import { ClientSettingsPersistence } from "./client-settings-persistence";
	import {
		ClientAppLifecycle,
		initialClientAppLifecycleState,
		clientAppPage,
	} from "./client-app-lifecycle";
	import { ClientInputArbiter } from "./client-input-arbiter";
	import { ClientPreciseJumpSession } from "./client-precise-jump-session";
	import { ClientNearby } from "./client-nearby";
	import { ClientEntitySelection } from "./client-entity-selection";
	import { ClientPointerSelectionController } from "./client-pointer-selection-controller";
	import { resolveClientSpellCastAim } from "./client-spell-casting";
	import {
		ClientCycleSelectionController,
		sampleCycleCandidates,
	} from "./client-cycle-selection-controller";
	import { ClientSelectionInput } from "./client-selection-input";
	import {
		CLIENT_TOAST_DURATION_MS,
		ClientToastCenter,
		type ClientToast,
	} from "./client-toast-center";
	import type { ClientTargetIndicatorFrame } from "./client-target-indicator";
	import {
		ClientObjectInspection,
		type ClientObjectInspectionState,
	} from "./client-object-inspection";

	interface Props {
		/** Canonical startup selection; injected diagnostic hosts can lack filesystem provenance. */
		readonly contentLocation: string | null;
		/** Already initialized once by bootstrap; this shell owns subsequent retirement. */
		readonly themeSelection: UiThemeSelection;
		readonly initialUserSettings: ClientUserSettings;
		/** Bootstrap settings issue captured before the app's toast owner exists. */
		readonly initialSettingsIssue: string | null;
		readonly settingsTransport: ClientSettingsTransport;
		readonly visualCacheTransport: ClientVisualCacheTransport;
	}

	const {
		contentLocation,
		themeSelection,
		initialUserSettings,
		initialSettingsIssue,
		settingsTransport,
		visualCacheTransport,
	}: Props = $props();
	// Bootstrap completes before mount; later prop replacement cannot own live settings lifetime.
	const startupThemeSelection = untrack(() => themeSelection);
	const startupUserSettings = untrack(() => initialUserSettings);
	const startupSettingsIssue = untrack(() => initialSettingsIssue);
	const startupSettingsTransport = untrack(() => settingsTransport);
	const startupVisualCacheTransport = untrack(() => visualCacheTransport);
	/** Capture staging must cross IPC before native close seals cache admission. */
	const pendingVisualCaptures = new Set<Promise<void>>();

	let userSettings = $state.raw<ClientUserSettings>(startupUserSettings);
	const clientInput = provideClientInput(
		new AppInput(clientInputConfiguration(startupUserSettings.input)),
	);

	let entityCollisionDisabled = $state(false);
	/** Cold core admission consumed by the World panel's click gesture. */
	let canTeleportFromMap = $state(false);
	/** Core-filtered standard recall attempts, replaced after event loss. */
	let recallDestinations = $state<readonly RecallDestination[]>([]);
	let appState = $state.raw(initialClientAppLifecycleState());
	const lifecycle = $derived(appState.phase);
	const appLifecycle = new ClientAppLifecycle({
		session: () => session,
		stopInput: async () => {
			inputGate.cancel("reset");
			await inputDispatch;
		},
		retireGameplay: async () => {
			await presentationRoot?.retireGameplay();
		},
		warn: (message) => toastCenter.publish({ message, tone: "warning" }),
		onChange: (state) => {
			appState = state;
		},
	});
	/** Cold authority-owned character-management admission and recoverable feedback. */
	let characterManagement = $state.raw<CharacterManagementState>({
		kind: "idle",
	});
	const debugEnabled = clientDebugEnabled(window.location.search);
	let deathCommands: ClientDeathCommands | null = null;
	let session = $state<ClientLifecycleSession | null>(null);
	const navigationWaypoint = new ClientNavigationWaypointOwner(
		CLIENT_WAYPOINT_NEAR_RADIUS_METERS,
	);
	const emptySpellBarBindings = initialSpellBarBindings();
	let selectedSpellTab = $state<InputDigitIndex>(0);
	let characterSettings = $state.raw<ClientCharacterSettingsState>({
		kind: "absent",
	});
	/** Cold configuration shared by keyboard dispatch and the mounted HUD. */
	const spellBar = $derived<ClientSpellBarState>({
		selected: selectedSpellTab,
		tabs:
			characterSettings.kind === "ready"
				? characterSettings.settings.spellBarBindings.tabs
				: emptySpellBarBindings.tabs,
	});
	let hudMode = $state<"runtime" | "layout">("runtime");
	function selectSpellTab(selected: InputDigitIndex): void {
		selectedSpellTab = selected;
	}
	function changeSpellBar(value: ClientSpellBarState): void {
		selectedSpellTab = value.selected;
		if (
			characterSettings.kind === "ready" &&
			value.tabs !== characterSettings.settings.spellBarBindings.tabs
		)
			changeCharacterSettings("spellBarBindings", { tabs: value.tabs });
	}
	function activateSpellCell(slot: number): void {
		if (!spellBarEnabled) return;
		const id = spellBar.tabs[spellBar.selected][slot];
		if (id !== null && session?.state().knownSpells?.includes(id))
			void castSpell(id);
	}
	function activateCasterSpell(): void {
		if (!spellBarEnabled || inventory === null || itemInteractions === null)
			return;
		const caster = findWieldedCasterSpell(inventory.readItems().items.values());
		if (caster !== null) itemInteractions.castWieldedSpell(caster.item);
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
	/** Event-driven stance consumed by combat controls and spell shortcuts. */
	let combatMode = $state<ClientCombatMode>("unknown");
	let combatStatus = $state<ClientCombatStatus>({
		desired: null,
		state: "idle",
		processedIntentSequence: 0,
		refill: null,
	});
	/** Accepted profile selections, including repeated selections of the current value. */
	let combatProfileSelectionRevision = $state(0);
	const defaultCombatControls: ClientCharacterSettings["combatControls"] = {
		melee: { height: "medium", power: 0.5 },
		missile: { height: "medium", accuracy: 0.5 },
	};
	const combatControls = $derived(
		characterSettings.kind === "ready"
			? characterSettings.settings.combatControls
			: defaultCombatControls,
	);
	function persistCombatProfile(profile: ClientAttackProfile): boolean {
		if (characterSettings.kind !== "ready") return false;
		const controls =
			profile.kind === "melee"
				? {
						...combatControls,
						melee: { height: profile.height, power: profile.power },
					}
				: {
						...combatControls,
						missile: { height: profile.height, accuracy: profile.accuracy },
					};
		changeCharacterSettings("combatControls", controls);
		return true;
	}
	function selectCombatProfile(profile: ClientAttackProfile): void {
		if (!persistCombatProfile(profile)) return;
		combatProfileSelectionRevision += 1;
		if (selectedEntityGuid === null && combatStatus.desired !== null) {
			void session?.updateCombatProfile(profile).catch(reportCommandFailure);
			return;
		}
		beginCombatEngagement(profile);
	}
	function selectCombatBreakpoint(index: CombatBreakpointIndex): void {
		const value = COMBAT_BREAKPOINTS[index];
		if (combatMode === "melee")
			selectCombatProfile({
				kind: "melee",
				...combatControls.melee,
				power: value,
			});
		else if (combatMode === "missile")
			selectCombatProfile({
				kind: "missile",
				...combatControls.missile,
				accuracy: value,
			});
	}
	function selectCombatHeight(index: CombatHeightIndex): void {
		const height = COMBAT_HEIGHTS[index];
		if (combatMode === "melee")
			selectCombatProfile({
				kind: "melee",
				...combatControls.melee,
				height,
			});
		else if (combatMode === "missile")
			selectCombatProfile({
				kind: "missile",
				...combatControls.missile,
				height,
			});
	}
	function beginCombatEngagement(profile: ClientAttackProfile): void {
		const currentSession = session;
		if (
			currentSession === null ||
			lifecycle.kind !== "in-world" ||
			characterSettings.kind !== "ready"
		)
			return;
		const target = selectedEntityGuid;
		if (target === null) {
			toastCenter.publish({
				message: "Select a target before attacking.",
				tone: "warning",
			});
			return;
		}
		// Selection is sampled only for this explicit begin; core retains the engaged target.
		retireCombatEscapeContext();
		const sequence = nextCombatIntentSequence();
		const context = keyboard.bindEscapeContext(stopCombat);
		combatEscapeContext = { sequence, context };
		void currentSession
			.beginCombatEngagement(target, profile, sequence)
			.catch((error: unknown) => {
				// A failed older begin must not retire a newer engagement's cancellation.
				if (combatEscapeContext?.context === context)
					retireCombatEscapeContext();
				reportCommandFailure(error);
			});
	}
	function stopCombat(): void {
		retireCombatEscapeContext();
		void session
			?.stopCombatEngagement(nextCombatIntentSequence())
			.catch(reportCommandFailure);
	}
	const spellBarEnabled = $derived(
		characterSettings.kind === "ready" &&
			lifecycle.kind === "in-world" &&
			combatMode === "magic" &&
			hudMode === "runtime",
	);

	let salvage = $state<ClientSalvageState | null>(null);
	let locks = $state<ClientLocksState | null>(null);
	$effect(() => {
		if (!userSettings.ui.useUnlockHelper) locks?.close();
	});
	let inventory = $state<ClientInventoryState | null>(null);
	let vendor = $state<ClientVendorState | null>(null);
	let houseCrystal = $state<ClientHouseCrystalState | null>(null);
	let housingManagement = $state<ClientHousingManagementState | null>(null);
	let party = $state<ClientPartyState | null>(null);
	let partyHudPresent = $state(false);
	let housing = $state<HousingSnapshot>(emptyHousing());
	let trade = $state<ClientTradeState | null>(null);
	let worldContainer = $state<ClientWorldContainerPanelState | null>(null);
	let hostTransport = $state<HostTransport | null>(null);
	const worldMapSource = $derived(
		hostTransport === null ? null : hostWorldMapSource(hostTransport),
	);
	function reportCommandFailure(error: unknown): void {
		appLifecycle.fail("command", diagnostic(error));
	}
	async function setGameplayOption(
		option: ClientGameplayOption,
		enabled: boolean,
	): Promise<void> {
		if (session === null)
			throw new Error("Gameplay settings require an active session.");
		await session.setGameplayOption(option, enabled);
	}
	let gameplayPreferences = $state<ClientGameplayPreferences | null>(null);
	async function setAppearanceOption(
		option: ClientAppearanceOption,
		enabled: boolean,
	): Promise<void> {
		const owner = session;
		if (owner === null) return;
		try {
			await owner.setAppearanceOption(option, enabled);
		} catch (error) {
			toastCenter.publish({ message: diagnostic(error), tone: "warning" });
		}
	}
	let playerName = $state<string | null>(null);
	let worldName = $state<string | null>(null);
	let vitals = $state<readonly ClientVital[]>([]);
	let appearanceOptions = $state<ClientAppearanceOptions | null>(null);
	let characterMotion = $state<ClientCharacterMotionCapabilities | null>(null);
	let activeJumpBeginSequence = $state<number | null>(null);
	let toast = $state<ClientToast | null>(null);
	let dialogPresentation = $state<ClientDialogPresentation | null>(null);
	let dialogs: ClientDialogs | null = null;
	let chatMessages = $state<readonly ClientChatLine[]>([]);
	/** Sent input survives world-view remounts until this client document retires. */
	let sentChatHistory = $state<readonly string[]>([]);
	const chatComposer = new ClientChatComposer({
		recentEmotes: startupUserSettings.recentEmotes,
		onRecentEmotesChange: (ids) => changeUserSection("recentEmotes", ids),
	});
	let chatCharacterGuid: number | null = null;
	let nextChatMessageId = 1;
	const MAXIMUM_CHAT_LINES = 250;
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let interactionRoot = $state<HTMLElement | null>(null);
	let presentationRoot =
		$state.raw<ClientPresentationRoot<GamePresentationOwner> | null>(null);
	const page = $derived(
		clientAppPage(appState, { worldName, playerName }, retryPregameScene),
	);
	const pregameSelection = $derived(
		page.kind === "selection" ? page.selection : null,
	);
	const pregameScene = $derived(
		presentationRoot === null || canvasElement === null
			? null
			: {
					canvas: canvasElement,
					characters: presentationRoot.pregameCharacters,
				},
	);

	function retryPregameScene(): void {
		appLifecycle.acceptScene({ kind: "loading" }, false);
		void presentationRoot?.retry();
	}

	/** View-owned inventory modal entry used by gameplay shortcuts. */
	let gameplayView = $state<ClientGameplayView | null>(null);
	let cameraController =
		$state<ClientGameplayPresentationCameraController | null>(null);
	/** Imperative presentation source sampled by the radar on its own bounded cadence. */
	let gameplayPresentation: ClientGameplayPresentation | null = null;
	/** Cold content catalog and validation issue consumed by Settings. */
	let weatherPresets = $state<readonly ClientWeatherPreset[]>([]);
	let environmentIssue = $state<string | null>(null);
	let presentationAssets: HostPresentationAssets | null = null;
	const presentationRootRetirements = new Set<Promise<void>>();
	/** Permanent close admission prevents effects from constructing replacement owners. */
	let compositionClosing = $state(false);
	/** The mounted composition owns one retirement, shared by preparation and unmount. */
	let retireClientComposition: (() => Promise<void>) | null = null;

	const objectPreviewService = new StandardClientObjectPreviewService({
		startFrameLoop: startPresentationFrameLoop,
		resolveResources: () => {
			const assets = presentationAssets;
			if (assets === null)
				throw new Error(
					"Presentation content is not available before client startup.",
				);
			return assets.resources();
		},
		onError: (error) => {
			console.error(error);
			if (presentationAssets !== null)
				appLifecycle.fail("command", diagnostic(error));
		},
	});

	const creationServices: CharacterCreationServices = {
		loadCatalog: async () => {
			const transport = hostTransport;
			if (transport === null)
				throw new Error("Character creation content is unavailable.");
			return loadCharacterCreationCatalog(transport);
		},
		resolveStats: async (request) => {
			const transport = hostTransport;
			if (transport === null)
				throw new Error("Character creation content is unavailable.");
			return resolveCharacterCreationStats(transport, request);
		},
		resolveAppearance: async (request) => {
			const transport = hostTransport;
			if (transport === null)
				throw new Error("Character creation content is unavailable.");
			return resolveCharacterCreationAppearance(transport, request);
		},
		submit: async (draft) => {
			const current = session;
			if (current === null)
				throw new Error("Character creation session is unavailable.");
			await current.createCharacter(draft);
		},
	};

	let frameRateSampler: FrameRateSampler | null = null;

	/** CDP-facing bridge for explicit live-client performance probes. */
	interface ClientPerformanceProbe {
		reset(): void;
		setRendererProfilingEnabled(enabled: boolean): void;
		snapshot(): {
			readonly diagnostics: ClientGameplayPresentationDiagnostics | null;
			readonly frameRates: FrameRates | null;
			readonly meanFrameWorkMs: number | null;
			readonly sampledFrameCount: number;
		};
	}
	type ClientPerformanceWindow = Window & {
		__holtburgerClientPerformance?: ClientPerformanceProbe;
	};
	const toastCenter = new ClientToastCenter({
		durationMs: CLIENT_TOAST_DURATION_MS,
		scheduler: {
			cancel: (handle) => window.clearTimeout(handle),
			schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
		},
	});
	const contractNotifications = new ClientContractNotifications({
		publish: (message) => toastCenter.publish({ message, tone: "status" }),
		batchMs: CLIENT_TUNING.journal.membershipToastBatchMs,
		scheduler: {
			cancel: (handle) => window.clearTimeout(handle),
			schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
		},
	});
	if (startupSettingsIssue !== null)
		toastCenter.publish({
			message: `Settings issue: ${startupSettingsIssue}`,
			tone: "warning",
		});
	const userSettingsPersistence =
		new ClientSettingsPersistence<ClientUserSettingsPatch>({
			delayMs: 250,
			save: (patch) => startupSettingsTransport.saveUserPatch(patch),
			merge: (pending, next) => ({
				sections: { ...pending.sections, ...next.sections },
				hudPlacements: { ...pending.hudPlacements, ...next.hudPlacements },
			}),
			report: (error) =>
				toastCenter.publish({
					message: `Settings could not be saved: ${diagnostic(error)}`,
					tone: "warning",
				}),
		});
	const characterSettingsOwner = new ClientCharacterSettingsOwner({
		transport: startupSettingsTransport,
		publish: (state) => {
			characterSettings = state;
			nearby?.acceptSettings(state);
			if (state.kind !== "ready") selectedSpellTab = 0;
		},
		loadFailed: (error) =>
			appLifecycle.fail(
				"command",
				`Character settings could not be loaded: ${diagnostic(error)}`,
			),
		unavailable: (reasons) =>
			toastCenter.publish({
				message: `Character settings: ${reasons.join("; ")}`,
				tone: "warning",
			}),
		saveFailed: (error) =>
			toastCenter.publish({
				message: `Character settings could not be saved: ${diagnostic(error)}`,
				tone: "warning",
			}),
		saveDelayMs: 250,
	});
	function changeUserSection<
		Key extends keyof Omit<ClientUserSettings, "hudLayout">,
	>(key: Key, value: ClientUserSettings[Key]): void {
		if (appState.operation === "quit") return;
		userSettings = { ...userSettings, [key]: value };
		userSettingsPersistence.publish({ sections: { [key]: value } });
	}
	function changeHudPlacement(
		surface: keyof ClientHudLayout,
		placement: ClientHudPlacement,
	): void {
		if (appState.operation === "quit") return;
		userSettings = {
			...userSettings,
			hudLayout: { ...userSettings.hudLayout, [surface]: placement },
		};
		userSettingsPersistence.publish({
			hudPlacements: { [surface]: placement },
		});
	}
	function resetHudLayout(layout: ClientHudLayout): void {
		if (appState.operation === "quit") return;
		userSettings = { ...userSettings, hudLayout: layout };
		userSettingsPersistence.publish({ hudPlacements: layout });
	}
	// Cold appearance snapshot seeds replacement presentations; updates never recreate their owners.
	let combatAppearance: CombatEffectsAppearance | null = null;
	function observeCombatAppearance(element: HTMLElement) {
		return observeCombatEffectsAppearance(
			element,
			(appearance) => {
				combatAppearance = appearance;
				gameplayPresentation?.setCombatEffectsAppearance(appearance);
			},
			() => gameplayPresentation?.refreshCombatEffectsFontAtlas(),
			(error) =>
				toastCenter.publish({ message: error.message, tone: "warning" }),
		);
	}

	const theme: UiThemeSettings = {
		owner: startupThemeSelection,
		async select(id) {
			if (await startupThemeSelection.select(id))
				changeUi({ ...userSettings.ui, themeId: id });
		},
	};
	function changeUi(ui: ClientUiSettings): void {
		changeUserSection("ui", clientUiSettingsSchema.parse(ui));
	}
	function changeEnvironmentOverrides(
		overrides: ClientEnvironmentOverrides,
	): void {
		const accepted = clientEnvironmentOverridesSchema.parse(overrides);
		changeUserSection("environmentOverrides", accepted);
		gameplayPresentation?.setEnvironmentOverrides(accepted);
	}
	function changeInput(input: ClientInputConfiguration): void {
		const accepted = clientInputSettingsSchema.parse(input);
		if (!clientKeyboardSettingsEqual(userSettings.input, accepted)) {
			gameplayView?.cancelMouseInput();
			keyboard.cancel();
			characterInput.replaceBindings(accepted.character);
			inputArbiter?.replacePowerBindings(accepted.preciseJump);
			clientInput.replaceConfiguration(clientInputConfiguration(accepted));
		}
		changeUserSection("input", accepted);
	}
	function fontCss(family: ClientFontFamily): string | undefined {
		return family === "theme" ? undefined : CLIENT_FONT_FAMILY_CSS[family];
	}
	function changeCharacterSettings<Key extends keyof ClientCharacterSettings>(
		key: Key,
		value: ClientCharacterSettings[Key],
	): void {
		characterSettingsOwner.change(key, value);
	}

	function acceptCharacterName(characterGuid: number, name: string): void {
		characterSettingsOwner.acceptName(characterGuid, name);
	}
	function retireCharacterSettings(): void {
		characterSettingsOwner.retire();
	}
	function acceptCharacterGuid(characterGuid: number | null): void {
		if (characterGuid !== null && characterGuid !== chatCharacterGuid) {
			chatComposer.reset();
			chatCharacterGuid = characterGuid;
			chatComposer.inParty =
				session !== null && session.partySnapshot() !== null;
		}
		characterSettingsOwner.acceptGuid(characterGuid);
	}

	function retireChatCharacter(): void {
		chatComposer.reset();
		chatCharacterGuid = null;
	}

	function refreshSelectedChatRecipient(): void {
		const guid = entitySelection?.selectedGuid() ?? null;
		const read = session?.entities.read();
		const record =
			guid !== null && read?.kind === "current"
				? read.level.entities.get(guid)
				: undefined;
		chatComposer.setSelection(selectedChatRecipient(guid, record));
	}
	onMount(() => {
		const prepareResources = async () => {
			compositionClosing = true;
			const themeRetirement = startupThemeSelection.retire();
			characterSettingsOwner.retire();
			// Withdrawal runs synchronously before flush takes its final producer snapshot.
			const retirements =
				retireClientComposition === null ? [] : [retireClientComposition()];
			const results = await Promise.allSettled([
				...retirements,
				themeRetirement,
				userSettingsPersistence.flush(),
				characterSettingsOwner.flush(),
				...pendingVisualCaptures,
			]);
			const errors = results.filter(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			if (errors.length)
				throw new AggregateError(
					errors.map((result) => result.reason),
					"Client resource preparation failed.",
				);
		};
		const unregister = registerElectronClientClose(async () => {
			try {
				await appLifecycle.prepareClose(prepareResources);
				return { kind: "prepared" };
			} catch (error) {
				return { kind: "failed", diagnostic: clientFailureDiagnostic(error) };
			}
		});
		return () => {
			unregister();
			// Native retirement has already awaited this operation; unmount joins the same owner.
			void appLifecycle
				.prepareClose(prepareResources)
				.catch((error) => console.error(error));
		};
	});

	// Controls replace this cold policy snapshot; frame-hot consumers must receive plain objects.
	const pregameLocation = choosePregameLocation();
	let frameSettings = $state.raw<FrameSettings>(
		frameSettingsWithGraphics(
			CLIENT_TUNING.frameSettings,
			startupUserSettings.graphics,
		),
	);
	let textureFilteringCapabilities =
		$state.raw<TextureFilteringCapabilities | null>(null);
	function applyFrameGraphics(graphics: ClientGraphicsSettings): void {
		const effective =
			textureFilteringCapabilities === null
				? graphics
				: {
						...graphics,
						textureFiltering: resolveTextureFilteringPolicy(
							graphics.textureFiltering,
							textureFilteringCapabilities,
						),
					};
		frameSettings = frameSettingsWithGraphics(frameSettings, effective);
		presentationRoot?.setFrameSettings(frameSettings);
	}
	function changeAudio(audio: ClientAudioSettings): void {
		const accepted = clientAudioSettingsSchema.parse(audio);
		changeUserSection("audio", accepted);
		presentationRoot?.setAudioSettings(accepted);
	}
	function changeGraphics(graphics: ClientGraphicsSettings): void {
		const accepted = clientGraphicsSettingsSchema.parse(graphics);
		const previous = userSettings.graphics;
		if (
			Object.keys(accepted).every(
				(key) =>
					accepted[key as keyof ClientGraphicsSettings] ===
					previous[key as keyof ClientGraphicsSettings],
			)
		)
			return;
		changeUserSection("graphics", accepted);
		if (accepted.viewDistance !== previous.viewDistance)
			gameplayPresentation?.setSceneInterestRadii(
				clientSceneInterestRadii(accepted.viewDistance),
			);
		if (accepted.verticalFovDegrees !== previous.verticalFovDegrees)
			gameplayPresentation?.setFieldOfView(accepted.verticalFovDegrees);
		applyFrameGraphics(accepted);
	}
	let inputController: CharacterInputController | null = null;
	const { viewport: inputGate, keyboard } = useAppInputPolicy();
	/** Explicit attack intent owns cancellation; passive status updates can only retire it. */
	let combatEscapeContext: {
		/** Begin request whose eventual idle status may retire this registration. */
		readonly sequence: number;
		/** Input-policy lease; rejection of another request cannot release it. */
		readonly context: EscapeContextHandle;
	} | null = null;
	/** Monotonic across character transitions; old acknowledgements must never reuse an identity. */
	let combatIntentSequence = 0;
	function nextCombatIntentSequence(): number {
		const next = combatIntentSequence + 1;
		if (!Number.isSafeInteger(next))
			throw new Error("Combat intent sequence exhausted");
		combatIntentSequence = next;
		return next;
	}
	/** Precise-jump entry owns registration; completion, cancellation and teardown retire it. */
	let preciseEscapeContext: EscapeContextHandle | null = null;
	function retireCombatEscapeContext(): void {
		combatEscapeContext?.context.release();
		combatEscapeContext = null;
	}
	function acceptCombatStatus(status: ClientCombatStatus): void {
		combatStatus = status;
		combatIntentSequence = Math.max(
			combatIntentSequence,
			status.processedIntentSequence,
		);
		if (
			status.desired === null &&
			status.processedIntentSequence === combatEscapeContext?.sequence
		)
			retireCombatEscapeContext();
	}
	let facingInput: ClientFacingInputDispatch | null = null;
	const mouseMovement: ClientMouseMovementInput = {
		onForward: (source, down) => {
			if (down) locks?.cancel();
			inputArbiter?.applyForward(source, down);
		},
		onTurn: (delta) => {
			if (delta !== 0) locks?.cancel();
			facingInput?.add(delta);
		},
		onCancelTurn: () => facingInput?.cancel(),
		onError: (message) => toastCenter.publish({ message, tone: "warning" }),
	};
	let inputArbiter: ClientInputArbiter | null = null;
	const characterInput = clientInput.characterContext((action, pressed) => {
		if (
			action === "jump" &&
			characterMotion === null &&
			!inputArbiter?.preciseActive
		)
			return;
		if (pressed) locks?.cancel();
		inputArbiter?.applyAction(action, pressed);
	});

	$effect(() => {
		if (!gameplayInputEnabled) return untrack(() => inputGate.block());
	});
	let preciseJumpSession: ClientPreciseJumpSession | null = null;
	let nearby = $state.raw<ClientNearby | null>(null);
	/** Presentation-owned demand, retained across ordinary Nearby window changes. */
	let nearbySceneMembership: SceneInterestMembership | null = null;
	let entitySelection: ClientEntitySelection | null = null;
	let pointerSelection: ClientPointerSelectionController | null = null;
	let selectionInput: ClientSelectionInput | null = null;
	let itemInteractions = $state<ClientItemInteractions | null>(null);
	let selectedEntityTracking: ClientSelectedEntityTracking | null = null;
	let selectedEntityGuid = $state<number | null>(null);
	let objectInspectionOwner: ClientObjectInspection | null = null;
	let objectInspection = $state<ClientObjectInspectionState>({ kind: "idle" });
	let bookReaderOwner: ClientBookReader | null = null;
	let bookReader = $state<ClientBookReaderState>({ kind: "idle" });
	/** Session-local diagnostic policy; each use captures the current value. */
	let unrestrictedUse = $state(false);
	/** A targeting click consumes its entire native double-click sequence. */
	let viewportTargetSequenceConsumed = false;
	let hoveredEntityGuid = $state<number | null>(null);
	let preciseJumpActive = $state(false);
	let inputDispatch: Promise<void> = Promise.resolve();
	const usesGameplayPresentation = $derived(
		appState.admission.mode === "gameplay",
	);
	const gameplayInputEnabled = $derived(appState.admission.gameplayInput);

	function queueCharacterMotionEdge(
		currentSession: ClientLifecycleSession,
		edge: CharacterInputEdge,
		active: () => boolean,
	): void {
		if (edge.kind === "reset") {
			facingInput?.cancel();
			cameraController?.setTranslationIntent(false, performance.now());
		}
		if (edge.kind !== "reset") facingInput?.flush();
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
				if (active()) appLifecycle.fail("command", diagnostic(error));
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
		intent: CharacterDriveIntent,
		active: () => boolean,
	): void {
		facingInput?.flush();
		cameraController?.setTranslationIntent(
			drive.longitudinal !== null ||
				drive.lateral !== null ||
				drive.turn !== null,
			performance.now(),
		);
		const request: ClientDriveRequest =
			intent === "release"
				? { kind: "release" }
				: {
						kind: intent,
						drive: {
							gait: drive.gait,
							longitudinal: drive.longitudinal,
							lateral: drive.lateral,
							turning: drive.turn,
						},
					};
		inputDispatch = inputDispatch
			.then(() => currentSession.replaceDrive(request))
			.catch((error: unknown) => {
				if (active()) appLifecycle.fail("command", diagnostic(error));
			});
	}

	function receive(event: ClientLifecycleSessionEvent): void {
		const staging = persistPlayerVisualCapture(
			event,
			startupVisualCacheTransport,
			(message) => toastCenter.publish({ message, tone: "warning" }),
		);
		if (staging !== null) {
			pendingVisualCaptures.add(staging);
			void staging.then(
				() => pendingVisualCaptures.delete(staging),
				() => pendingVisualCaptures.delete(staging),
			);
		}
		contractNotifications.receive(event);
		switch (event.type) {
			case "camera-error":
				appLifecycle.fail("command", event.message);
				return;
			case "character-management":
				characterManagement = event.state;
				return;

			case "entities":
				refreshSelectedChatRecipient();
				return;
			case "party-presence":
				chatComposer.inParty = event.inParty;
				partyHudPresent = event.hudPresent;
				return;
			case "party-updates-failed":
				toastCenter.publish({ message: event.message, tone: "warning" });
				return;
			case "housing-updated":
				housing = event.housing;
				return;
			case "housing-crystal-received":
				housing = { ...housing, crystal: event.crystal };
				return;
			case "entity-collision-disabled":
				entityCollisionDisabled = event.disabled;
				return;
			case "recall-destinations":
				recallDestinations = event.destinations;
				return;
			case "map-teleport-capability":
				canTeleportFromMap = event.allowed;
				return;
			case "combat-mode":
				combatMode = event.mode;
				return;
			case "combat":
				acceptCombatStatus(event.status);
				return;
			case "gameplay-preferences":
				gameplayPreferences = event.preferences;
				return;
			case "appearance-options":
				appearanceOptions = event.options;
				return;
			case "current-state":
				characterManagement = event.state.characterManagement;
				if (
					event.state.lifecycle.kind === "character-selection" ||
					event.state.lifecycle.kind === "exiting"
				)
					retireChatCharacter();
				navigationWaypoint.acceptCurrentState(event.state);
				housing = event.state.housing;
				canTeleportFromMap = event.state.canTeleportFromMap;
				recallDestinations = event.state.recallDestinations;
				enchantments = session?.state().enchantments ?? null;
				acceptCharacterGuid(event.state.localPlayerGuid);
				chatComposer.inParty = event.state.party !== null;
				refreshSelectedChatRecipient();
				combatMode = event.state.combatMode;
				acceptCombatStatus(event.state.combat);
				appearanceOptions = event.state.appearanceOptions;
				gameplayPreferences = event.state.gameplayPreferences;
				entityCollisionDisabled = event.state.entityCollisionDisabled;
				if (event.state.lifecycle.kind !== "in-world") {
					retireCombatEscapeContext();
					inputGate.cancel("reset");
				}
				playerName = event.state.playerName;
				if (
					event.state.localPlayerGuid !== null &&
					event.state.playerName !== null
				)
					acceptCharacterName(
						event.state.localPlayerGuid,
						event.state.playerName,
					);
				worldName = event.state.worldName;
				vitals = event.state.vitals;
				characterMotion = event.state.characterMotion;
				if (characterMotion !== null)
					inputController?.setFullChargeDurationMs(
						characterMotion.fullChargeDurationMs,
					);
				appLifecycle.acceptAuthority(event.state.lifecycle);
				return;
			case "resyncing":
				canTeleportFromMap = false;
				recallDestinations = [];
				enchantments = null;
				appearanceOptions = null;
				gameplayPreferences = null;
				return;
			case "lifecycle":
				if (
					event.lifecycle.kind === "character-selection" ||
					event.lifecycle.kind === "exiting"
				) {
					retireChatCharacter();
				}
				navigationWaypoint.acceptLifecycle(event.lifecycle);
				if (event.lifecycle.kind !== "in-world") {
					canTeleportFromMap = false;
					recallDestinations = [];
				}
				enchantments = session?.state().enchantments ?? null;
				appearanceOptions = session?.state().appearanceOptions ?? null;
				gameplayPreferences = session?.state().gameplayPreferences ?? null;
				if (event.lifecycle.kind !== "in-world") {
					retireCombatEscapeContext();
					inputGate.cancel("reset");
				}
				if (
					event.lifecycle.kind === "entering-world" ||
					event.lifecycle.kind === "character-selection"
				) {
					retireCharacterSettings();
				}
				appLifecycle.acceptAuthority(event.lifecycle);
				return;
			case "character-motion-capabilities":
				characterMotion = event.capabilities;
				if (event.capabilities !== null)
					inputController?.setFullChargeDurationMs(
						event.capabilities.fullChargeDurationMs,
					);
				return;
			case "transient-string":
				toastCenter.publish({ message: event.message, tone: "status" });
				return;
			case "contract-membership-change":
				return;
			case "action-feedback":
				toastCenter.publish(event.feedback);
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
			case "precise-jump-transaction-feedback":
				if (event.feedback.outcome.kind === "rejected") {
					toastCenter.publish({
						message:
							event.feedback.outcome.reason === "airborne" ||
							event.feedback.outcome.reason === "unsupported" ||
							event.feedback.outcome.reason === "overburdened"
								? jumpRejectionText(event.feedback.outcome.reason)
								: `Precise jump rejected (${event.feedback.outcome.reason}).`,
						tone: "warning",
					});
				}
				return;
			case "server-controlled-motion":
				inputArbiter?.cancelAutoRun();
				return;
			case "world-name":
				worldName = event.name;
				return;
			case "local-player-established":
				acceptCharacterGuid(event.identity.playerGuid);
				navigationWaypoint.acceptCharacter(event.identity.playerGuid);
				return;
			case "player-entered":
				if (event.player.playerGuid === session?.state().playerGuid) {
					playerName = event.player.name;
					acceptCharacterName(event.player.playerGuid, event.player.name);
				}
				return;
			case "vitals":
				vitals = event.vitals;
				return;
			case "enchantments":
				enchantments = event.enchantments;
				return;
			case "chat": {
				chatComposer.accept(event.message);
				appendChatLine(event.message);
				return;
			}
			case "exit-requested":
				retireChatCharacter();
				navigationWaypoint.acceptCharacter(null);
				inputGate.cancel("reset");
				appLifecycle.acceptExit(event.exit);
				return;
			case "presentation-discontinuity":
				inputGate.cancel("reset");
				return;
			default:
				return;
		}
	}

	function appendChatLine(message: ClientChatEntry): void {
		if (clientChatShouldSuppress(userSettings.chatSuppression, message)) return;
		const line: ClientChatLine = {
			...message,
			id: nextChatMessageId++,
			receivedAt: new Date(),
			generation: chatComposer.generation,
		};
		chatMessages = [...chatMessages, line].slice(-MAXIMUM_CHAT_LINES);
	}

	function appendChatError(error: unknown): void {
		appendChatLine({ kind: "error", message: diagnostic(error) });
	}

	function chooseCharacter(guid: number): void {
		appLifecycle.select(guid);
	}
	async function enterWorld(): Promise<void> {
		await appLifecycle.enter();
	}
	async function returnToMainMenu(): Promise<void> {
		await appLifecycle.returnToSelection();
	}
	async function returnToLauncher(): Promise<void> {
		// Reuse the lifecycle owner's page diagnostic rather than reconstructing a second error summary.
		const details =
			page.kind === "loading" && page.content.kind !== "pending"
				? page.content.details
				: null;
		await launcherTransport().back(details);
	}
	async function disconnect(): Promise<void> {
		await appLifecycle.disconnect();
		await returnToLauncher();
	}

	async function castSpell(spellId: number): Promise<void> {
		const currentSession = session;
		if (currentSession === null) return;
		const selection = entitySelection?.selectedGuid() ?? null;
		try {
			const reference =
				selection === null && spells !== null
					? await spells.reference(spellId)
					: null;
			const details = reference?.kind === "known" ? reference.details : null;
			await currentSession.castSpell(
				spellId,
				resolveClientSpellCastAim(details, selection),
			);
		} catch (error) {
			toastCenter.publish({ message: diagnostic(error), tone: "warning" });
		}
	}

	async function toggleCombatMode(): Promise<void> {
		if (session === null || lifecycle.kind !== "in-world") return;
		try {
			await session.toggleCombatMode();
		} catch (error) {
			toastCenter.publish({ message: diagnostic(error), tone: "warning" });
		}
	}

	/** Present waypoint activation feedback through the app status surface. */
	function notifyWaypoint(message: string): void {
		toastCenter.publish({ message, tone: "status" });
	}

	/** Explicit launches remain cold UI events; the board owns its run lifetime. */
	let logopolisLaunchRevision = $state(0);
	$effect(() => {
		if (lifecycle.kind !== "in-world") logopolisLaunchRevision = 0;
	});

	async function sendChat(
		message: string,
		resolution: ChatComposeResolution,
	): Promise<void> {
		sentChatHistory = recordSentChat(
			sentChatHistory,
			message,
			CLIENT_TUNING.chat.sentHistoryLimit,
		);
		if (resolution.kind === "error") throw new Error(resolution.message);
		if (resolution.kind === "send" || resolution.kind === "sequence") {
			const currentSession = session;
			if (currentSession === null || lifecycle.kind !== "in-world")
				throw new Error("Chat session is not in the world.");
			await chatComposer.sendAll(
				resolution.kind === "send" ? [resolution.request] : resolution.requests,
				(request) => currentSession.sendChat(request),
			);
			return;
		}
		if (isLogopolisCommand(message)) {
			logopolisLaunchRevision += 1;
			return;
		}
		if (/^[/@]fps$/i.test(message.trim())) {
			changeUi({ ...userSettings.ui, showFps: !userSettings.ui.showFps });
			return;
		}
		if (runClientHelpCommand(message, appendChatLine)) return;
		if (runClientVersionCommand(message, appendChatLine)) return;
		if (runClientAssetsCommand(message, contentLocation, appendChatLine))
			return;
		const currentSession = session;
		if (currentSession === null)
			throw new Error("Chat session is unavailable.");
		if (deathCommands === null)
			throw new Error("Command session is unavailable.");
		const generation = chatComposer.generation;
		const handled =
			(await deathCommands.run(message)) ||
			(await runRecallCommand(message, (destination) =>
				currentSession.recall(destination),
			)) ||
			navigationWaypoint.runCommand(
				message,
				() => readMinimapFrame().waypoint,
				appendChatLine,
				notifyWaypoint,
			) ||
			(await runClientLocationCommand(
				message,
				() => {
					if (gameplayPresentation === null)
						throw new Error("World presentation is unavailable.");
					return gameplayPresentation.readLocationReport();
				},
				appendChatLine,
			));
		if (!handled) {
			if (session !== currentSession || chatComposer.generation !== generation)
				throw new Error("Chat session changed before command dispatch.");
			if (message.startsWith("/"))
				throw new Error(
					`Unknown command: ${message.split(/\s/, 1)[0]}. Use /help for supported commands.`,
				);
			if (lifecycle.kind !== "in-world")
				throw new Error("Chat session is not in the world.");
			await currentSession.sendChat({ kind: "speech", message });
		}
	}

	async function recall(destination: RecallDestination): Promise<void> {
		try {
			if (session === null) throw new Error("Client session unavailable.");
			await session.recall(destination);
		} catch (error) {
			toastCenter.publish({ message: diagnostic(error), tone: "warning" });
		}
	}

	async function teleportToMapPosition(
		position: ClientMapPosition,
	): Promise<void> {
		try {
			if (session === null) throw new Error("Client session unavailable.");
			await session.teleportToMapPosition(position);
		} catch (error) {
			toastCenter.publish({ message: diagnostic(error), tone: "warning" });
		}
	}

	/** Keyboard and button activation capture the same selection before starting the request. */
	function examineSelectedEntity(): void {
		const guid = entitySelection?.selectedGuid() ?? null;
		if (guid === null) return;
		void objectInspectionOwner?.examine(guid);
	}

	/** Inspect the explicit HUD identity without changing the gameplay selection. */
	function examineItem(guid: number): void {
		void objectInspectionOwner?.examine(guid);
	}

	const jumpPowerKeys: readonly [string, string] = $derived.by(() => {
		const platform = inputDisplayPlatform(
			globalThis.navigator?.userAgent ?? "",
		);
		const input = userSettings.input.preciseJump;
		return [
			compactInputHint(input.increasePower, platform) ?? "—",
			compactInputHint(input.decreasePower, platform) ?? "—",
		];
	});

	function handleGameKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented) return;
		if (gameplayView?.handleSystemPanelKeydown(event)) return;
		if (preciseJumpActive && !event.isComposing) {
			if (
				inputArbiter?.applyPowerKey(event, true) ||
				characterInput.apply(event, true)
			) {
				event.preventDefault();
				return;
			}
		}
		if (
			handleCombatBarKeydown(
				clientInput,
				event,
				(combatMode === "melee" || combatMode === "missile") &&
					characterSettings.kind === "ready" &&
					lifecycle.kind === "in-world" &&
					hudMode === "runtime",
				selectCombatBreakpoint,
				selectCombatHeight,
			)
		)
			return;
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
		if (
			clientInput.shortcut("toggleAutoRun", event) &&
			!event.isComposing &&
			inputArbiter !== null
		) {
			event.preventDefault();
			locks?.cancel();
			if (!event.repeat) inputArbiter.toggleAutoRun();
			return;
		}
		if (clientInput.shortcut("toggleCombat", event) && !event.isComposing) {
			event.preventDefault();
			if (!event.repeat) void toggleCombatMode();
			return;
		}
		if (clientInput.shortcut("cancel", event) && itemInteractions?.cancel()) {
			event.preventDefault();
			return;
		}
		if (clientInput.shortcut("give", event) && !event.isComposing) {
			event.preventDefault();
			if (!event.repeat) itemInteractions?.giveSelected();
			return;
		}
		if (clientInput.shortcut("examine", event) && !event.isComposing) {
			event.preventDefault();
			if (!event.repeat) examineSelectedEntity();
			return;
		}
		if (clientInput.shortcut("splitStack", event) && !event.isComposing) {
			event.preventDefault();
			if (!event.repeat && canvasElement !== null)
				gameplayView?.splitSelectedEntity(canvasElement);
			return;
		}
		if (selectionInput?.keydown(event, performance.now())) return;
		if (clientInput.shortcut("preciseJump", event) && inputArbiter !== null) {
			event.preventDefault();
			if (!event.repeat) enterPreciseJump();
			return;
		}
		if (clientInput.shortcut("interact", event) && !event.isComposing) {
			event.preventDefault();
			if (!event.repeat) itemInteractions?.interactSelected(unrestrictedUse);
			return;
		}
		if (event.key === "Escape") {
			gameplayView?.openSystemMenu();
			event.preventDefault();
			return;
		}
		if (inputArbiter !== null && characterInput.apply(event, true))
			event.preventDefault();
	}

	function handleGameKeyup(event: KeyboardEvent): void {
		selectionInput?.keyup(event, performance.now());
		// A movement press may predate precise mode, so release both owners.
		const powerReleased = inputArbiter?.applyPowerKey(event, false) ?? false;
		if (characterInput.apply(event, false) || powerReleased)
			event.preventDefault();
	}

	function aimPreciseJump(clientX: number, clientY: number): void {
		const ray = gameplayPresentation?.samplePreciseJumpRay(clientX, clientY);
		if (ray !== null && ray !== undefined) preciseJumpSession?.aim(ray);
	}

	function activatePreciseJump(): void {
		inputArbiter?.activatePointer();
	}

	function enterPreciseJump(): void {
		const arbiter = inputArbiter;
		if (arbiter === null) return;
		itemInteractions?.cancel();
		if (!arbiter.enterPrecise()) preciseEscapeContext?.promote();
	}

	function diagnostic(error: unknown): string {
		if (error instanceof Error) return error.message;
		if (typeof error === "string" && error.trim().length > 0) return error;
		return "The client command failed.";
	}

	function presentationStatusText(
		status: ClientGameplayPresentationStatus,
	): string {
		switch (status.kind) {
			case "starting":
				return "Loading the world…";
			case "awaiting-snapshot":
				return "Waiting for the server…";
			case "loading-player":
				return "Loading your character…";
			case "loading-activation":
				return "Loading the world…";
			case "ready":
				return "World ready";
			case "error":
				return status.diagnostic ?? "World presentation failed.";
			case "stopped":
				return "World presentation stopped.";
		}
	}

	const EMPTY_TRACKED_GUIDS: ReadonlySet<number> = new Set();
	function readMinimapFrame(): MinimapFrame {
		const frame = gameplayPresentation?.readMinimapFrame() ?? {
			surfaceMapEligible: false,
			waypoint: null,
			cameraFovRadians: 0,
			cameraHeadingRadians: 0,
			presentedEntities: () => [],
			selectedGuid: selectedEntityGuid,
			source: null,
			subject: null,
		};
		const entities = session?.entities.read();
		const facts = entities?.kind === "current" ? entities.level.entities : null;
		const player =
			frame.subject?.kind === "controlled-entity"
				? facts?.get(frame.subject.guid)
				: undefined;
		const playerName =
			player?.description.kind === "known" ? player.description.name : null;
		return {
			...frame,
			landmarkCategory: (guid) =>
				clientMinimapLandmark(facts?.get(guid), playerName),
			trackedGuids: nearby?.trackedGuids() ?? EMPTY_TRACKED_GUIDS,
			waypoint: navigationWaypoint.read(
				frame.subject,
				lifecycle.kind === "in-world" &&
					session !== null &&
					!session.mirror.isAwaitingSnapshot() &&
					gameplayPresentation?.status().kind === "ready",
			),
		};
	}

	function readSelectedEntity(): ClientSelectedEntity | null {
		return session === null
			? null
			: clientSelectedEntity(
					entitySelection?.selectedGuid() ?? null,
					session.entities.read(),
					session.mirror.entities(),
				);
	}

	function readDiagnostics(): ClientGameplayPresentationDiagnostics | null {
		return gameplayPresentation?.readDiagnostics() ?? null;
	}

	function readFrameRates(): FrameRates | null {
		return frameRateSampler?.readFrameRates() ?? null;
	}

	function readCombatTargetFrame() {
		return gameplayPresentation?.readCombatTargetFrame() ?? null;
	}
	function readTargetIndicatorFrame(): ClientTargetIndicatorFrame | null {
		return gameplayPresentation?.readTargetIndicatorFrame() ?? null;
	}

	function readSelectedEntityDisplay(): ClientSelectedEntityDisplay {
		return (
			selectedEntityTracking?.display(unrestrictedUse) ??
			EMPTY_CLIENT_SELECTED_DISPLAY
		);
	}

	async function setEntityCollisionDisabled(disabled: boolean): Promise<void> {
		try {
			if (session === null) throw new Error("Client session unavailable.");
			await session.setEntityCollisionDisabled(disabled);
		} catch (error) {
			toastCenter.publish({ message: String(error), tone: "warning" });
		}
	}

	function setShowRetailHiddenGeometry(visible: boolean): void {
		frameSettings = { ...frameSettings, showRetailHiddenGeometry: visible };
		presentationRoot?.setFrameSettings(frameSettings);
	}

	/** World resources follow app/content identity; gameplay only borrows them. */
	$effect(() => {
		const currentSession = session;
		const currentTransport = hostTransport;
		const currentAssets = presentationAssets;
		const canvas = canvasElement;
		if (
			compositionClosing ||
			currentSession === null ||
			currentTransport === null ||
			currentAssets === null ||
			canvas === null
		)
			return;
		appLifecycle.acceptScene({ kind: "loading" }, false);
		let cancelled = false;
		let lastStatus: ClientGameplayPresentationStatus | null = null;
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
			nextStatus: ClientGameplayPresentationStatus,
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

		let ownedGameplay: ClientGameplayPresentation | null = null;
		const clearGameplay = () => {
			if (gameplayPresentation !== ownedGameplay) return;
			ownedGameplay = null;
			gameplayPresentation = null;
			cameraController = null;
			nearbySceneMembership = null;
			nearby?.setSceneMembership(null);
			weatherPresets = [];
			environmentIssue = null;
		};
		const root = new ClientPresentationRoot({
			canvas,
			pregameLocation,
			build: async (signal) =>
				GamePresentationOwner.build({
					canvas,
					hostTransport: currentTransport,
					presentationResources: await currentAssets.resources(),
					signal,
					frameSettings: untrack(() => frameSettings),
					portalWarpDriveTuning: CLIENT_TUNING.portalTransition.visual,
					audioTuning: CLIENT_TUNING.audio,
					tickProfiler: debugEnabled ? new RuntimeTickProfiler() : undefined,
				}),
			createGameplay: (resources) => {
				const presentation = new ClientGameplayPresentation({
					canvas,
					resources,
					session: currentSession,
					onError: reportPresentationError,
					onSceneMembership: (source) => {
						if (cancelled) return;
						nearbySceneMembership = source;
						nearby?.setSceneMembership(source);
					},
					onWeatherPresets: (presets) => {
						if (!cancelled) weatherPresets = presets;
					},
					onEnvironmentIssue: (issue) => {
						if (cancelled || issue === environmentIssue) return;
						environmentIssue = issue;
						if (issue !== null)
							toastCenter.publish({ message: issue, tone: "warning" });
					},
				});
				// Cold preferences seed each gameplay adapter; edits use the live setters above.
				presentation.setEnvironmentOverrides(
					untrack(() => userSettings.environmentOverrides),
				);
				presentation.setSceneInterestRadii(
					clientSceneInterestRadii(
						untrack(() => userSettings.graphics.viewDistance),
					),
				);
				presentation.setFieldOfView(
					untrack(() => userSettings.graphics.verticalFovDegrees),
				);
				if (combatAppearance !== null)
					presentation.setCombatEffectsAppearance(combatAppearance);
				ownedGameplay = presentation;
				gameplayPresentation = presentation;
				cameraController = presentation.camera;
				presentation.setSelectedEntityGuid(untrack(() => selectedEntityGuid));
				presentation.setHoveredEntityGuid(
					untrack(() => pointerSelection?.hoveredGuid() ?? null),
				);
				if (preciseJumpSession !== null)
					presentation.setPreciseJumpPresentation(
						preciseJumpSession.snapshot(),
					);
				return presentation;
			},
			onGameplayRetired: clearGameplay,
			onReady: (owner) => {
				if (cancelled) return;
				textureFilteringCapabilities = owner.textureFilteringCapabilities;
				root.setAudioSettings(userSettings.audio);
				applyFrameGraphics(userSettings.graphics);
			},
			onError: reportPresentationError,
		});
		presentationRoot = root;
		const sampler = createFrameRateSampler(
			CLIENT_TUNING.diagnostics.frameMetricsEmaWindowMs,
		);
		frameRateSampler = sampler;
		let previousFrameTime: number | null = null;
		let sampledFrameWorkMs = 0;
		let sampledFrameCount = 0;
		const performanceProbe: ClientPerformanceProbe = {
			reset: () => {
				sampledFrameWorkMs = 0;
				sampledFrameCount = 0;
				gameplayPresentation?.resetRendererFrameProfile();
			},
			setRendererProfilingEnabled: (enabled) =>
				gameplayPresentation?.setRendererFrameProfilingEnabled(enabled),
			snapshot: () => ({
				diagnostics: gameplayPresentation?.readDiagnostics() ?? null,
				frameRates: sampler.readFrameRates(),
				meanFrameWorkMs:
					sampledFrameCount === 0 ? 0 : sampledFrameWorkMs / sampledFrameCount,
				sampledFrameCount,
			}),
		};
		(window as ClientPerformanceWindow).__holtburgerClientPerformance =
			performanceProbe;
		const stopFrameLoop = startPresentationFrameLoop(
			(timeMs) => {
				if (cancelled) return;
				const elapsedSeconds =
					previousFrameTime === null
						? 0
						: Math.max(0, timeMs - previousFrameTime) / 1000;
				previousFrameTime = timeMs;
				if (usesGameplayPresentation)
					preciseJumpSession?.adjustHeldPower(
						inputArbiter?.precisePowerDirection ?? 0,
						elapsedSeconds,
					);
				const startedAtMs = performance.now();
				const result = root.frame(timeMs);
				const workMs = performance.now() - startedAtMs;
				sampledFrameWorkMs += workMs;
				sampledFrameCount++;
				sampler.recordFrame({
					animationFrameTimeMs: timeMs,
					startedAtMs,
					workMs,
				});
				if (result.kind === "gameplay")
					reportPresentationStatus(result.frame.status);
				appLifecycle.acceptPresentation(result);
			},
			() => 0,
		);
		return () => {
			cancelled = true;
			stopFrameLoop();
			appLifecycle.acceptScene({ kind: "stopped" }, false);
			const retirement = root.destroy();
			presentationRootRetirements.add(retirement);
			void retirement.then(
				() => presentationRootRetirements.delete(retirement),
				(error) => {
					presentationRootRetirements.delete(retirement);
					console.error(error);
				},
			);
			if (presentationRoot === root) presentationRoot = null;
			if (frameRateSampler === sampler) frameRateSampler = null;
			const performanceWindow = window as ClientPerformanceWindow;
			if (performanceWindow.__holtburgerClientPerformance === performanceProbe)
				delete performanceWindow.__holtburgerClientPerformance;
		};
	});

	/** Cold mode changes choose inputs without becoming resource-lifetime dependencies. */
	$effect(() => {
		void presentationRoot?.setMode(appState.admission.mode);
	});

	/** Owns one browser-to-host movement controller per active world-input lifetime. */
	$effect(() => {
		const currentSession = session;
		const shouldOwnInput = gameplayInputEnabled;
		if (currentSession === null || !shouldOwnInput) {
			inputController?.releaseOwnership();
			inputController = null;
			return;
		}

		let cancelled = false;
		const isActive = (): boolean => !cancelled && session === currentSession;
		const facing = new ClientFacingInputDispatch((deltaRadians, current) => {
			inputDispatch = inputDispatch
				.then(async () => {
					if (isActive() && current())
						await currentSession.replaceDrive({
							kind: "rotate-facing",
							deltaRadians,
						});
				})
				.catch((error: unknown) => {
					if (isActive()) appLifecycle.fail("command", diagnostic(error));
				});
			return inputDispatch;
		});
		facingInput = facing;
		const initialCharacterMotion = untrack(() => characterMotion);
		const controller = new CharacterInputController({
			// Jump remains gated until authority supplies capability; movement can start earlier.
			fullChargeDurationMs:
				initialCharacterMotion?.fullChargeDurationMs ?? 1000,
			now: () => performance.now(),
			onDrive: (drive, intent) =>
				replaceClientDrive(currentSession, drive, intent, isActive),
			onEdge: (edge) =>
				queueCharacterMotionEdge(currentSession, edge, isActive),
		});
		inputController = controller;
		const arbiter = new ClientInputArbiter({
			// Read accepted settings without making remaps own the controller lifetime.
			powerBindings: untrack(() => userSettings.input.preciseJump),
			ordinary: controller,
			onEnter: () => {
				selectionInput?.cancel();
				preciseJumpSession?.enter();
				preciseEscapeContext?.release();
				preciseEscapeContext = keyboard.bindEscapeContext(() => {
					preciseEscapeContext = null;
					selectionInput?.cancel();
					arbiter.cancelPrecise();
				});
				toastCenter.publish({
					message: "Precise jump enabled",
					tone: "status",
				});
			},
			onActivate: () => preciseJumpSession?.activate(),
			onCancel: () => {
				preciseEscapeContext?.release();
				preciseEscapeContext = null;
				preciseJumpSession?.cancel();
			},
			onAutoRunChanged: (enabled) =>
				toastCenter.publish({
					message: enabled ? "AutoRun ON" : "AutoRun OFF",
					tone: "status",
				}),
		});
		inputArbiter = arbiter;

		return () => {
			cancelled = true;
			facing.cancel();
			if (facingInput === facing) facingInput = null;
			activeJumpBeginSequence = null;
			preciseEscapeContext?.release();
			preciseEscapeContext = null;
			keyboard.cancel();
			controller.releaseOwnership();
			if (inputArbiter === arbiter) inputArbiter = null;
			if (inputController === controller) inputController = null;
		};
	});

	onMount(() =>
		keyboard.bindGame({
			keydown: handleGameKeydown,
			keyup: handleGameKeyup,
			cancel: (reason) => {
				gameplayView?.cancelMouseInput();
				itemInteractions?.cancelTargeting();
				selectionInput?.cancel();
				characterInput.reset();
				if (reason === "release-held") inputArbiter?.releaseHeldActions();
				else inputArbiter?.reset();
			},
		}),
	);

	onMount(() => {
		let disposed = false;
		const unsubscribeVisualCacheFailure =
			startupVisualCacheTransport.listenFailures((message) =>
				toastCenter.publish({ message, tone: "warning" }),
			);
		const unsubscribeToast = toastCenter.subscribe((next) => (toast = next));
		const transport = createElectronHostTransport();
		const assets = new HostPresentationAssets(transport);
		presentationAssets = assets;
		hostTransport = transport;
		void loadSoulEmotes(transport)
			.then((catalog) => {
				if (!disposed) chatComposer.setEmotes(catalog);
			})
			.catch((error: unknown) => {
				if (!disposed)
					appLifecycle.fail(
						"command",
						`Soul-emote catalog could not be loaded: ${diagnostic(error)}`,
					);
			});
		const owner = new ClientLifecycleSession(
			hostClientLifecycleTransport(transport),
		);
		session = owner;
		chatComposer.reset();
		chatCharacterGuid = null;
		partyHudPresent = owner.partyHudPresent();
		chatComposer.inParty = owner.partySnapshot() !== null;
		const inspectionOwner = new ClientObjectInspection(owner, (message) =>
			toastCenter.publish({ message, tone: "warning" }),
		);
		objectInspectionOwner = inspectionOwner;
		const readerOwner = new ClientBookReader(owner);
		bookReaderOwner = readerOwner;
		const unsubscribeReader = readerOwner.subscribe(
			(value) => (bookReader = value),
		);
		const unsubscribeInspection = inspectionOwner.subscribe(
			(value) => (objectInspection = value),
		);
		const icons = browserUiIconRepository((requests) =>
			prepareUiIcons(transport, requests),
		);
		const nearbyOwner = new ClientNearby({
			session: owner,
			now: () => Date.now(),
			timing: CLIENT_NEARBY_TUNING,
			appendChat: appendChatLine,
			saveRules: (rules) =>
				characterSettingsOwner.change("entityAlerts", rules),
		});
		nearbyOwner.setSceneMembership(nearbySceneMembership);
		nearby = nearbyOwner;
		nearbyOwner.acceptSettings(characterSettingsOwner.state());
		const inventoryOwner = new ClientInventoryState(owner, icons, (message) =>
			toastCenter.publish({ message, tone: "warning" }),
		);
		inventory = inventoryOwner;
		const containerOwner = new ClientWorldContainerPanelState(
			owner,
			icons,
			(message) => toastCenter.publish({ message, tone: "warning" }),
		);
		worldContainer = containerOwner;
		const vendorOwner = new ClientVendorState(
			owner,
			icons,
			(message) => toastCenter.publish({ message, tone: "warning" }),
			(vendorGuid) =>
				sampleEntityDistanceMeters(owner.entities, owner.mirror, vendorGuid),
		);
		vendor = vendorOwner;
		const houseCrystalOwner = new ClientHouseCrystalState(
			owner,
			icons,
			(message) => toastCenter.publish({ message, tone: "warning" }),
			(crystal) =>
				sampleEntityDistanceMeters(owner.entities, owner.mirror, crystal),
			() => {
				vendorOwner.close();
				const read = owner.entities.read();
				if (
					read.kind === "current" &&
					read.level.worldContainer.kind === "open"
				)
					containerOwner.close(read.level.worldContainer.root);
			},
		);
		houseCrystal = houseCrystalOwner;
		const housingManagementOwner = new ClientHousingManagementState(
			owner,
			(message) => toastCenter.publish({ message, tone: "warning" }),
		);
		housingManagement = housingManagementOwner;
		const partyOwner = new ClientPartyState(
			owner,
			(message) => toastCenter.publish({ message, tone: "warning" }),
			(message) => toastCenter.publish({ message, tone: "status" }),
		);
		party = partyOwner;
		const tradeOwner = new ClientTradeState(owner, icons, appendChatError);
		trade = tradeOwner;
		const spellReferences = new SpellReferences(transport);
		const spellState = new ClientSpellState(owner, spellReferences, icons);
		spells = spellState;
		const deathOwner = new ClientDeathCommands(owner, appendChatLine);
		deathCommands = deathOwner;
		const dialogOwner = new ClientDialogs(owner);
		const unbindDeathDialogs = dialogOwner.bindLocal(deathOwner);
		dialogs = dialogOwner;
		const unbindHousingDialogs = dialogOwner.bindLocal(housingManagementOwner);
		const unbindPartyDialogs = dialogOwner.bindLocal(partyOwner);
		const unbindContractDialogs = dialogOwner.bindLocal(owner.contracts);
		const unsubscribeDialogs = dialogOwner.subscribe(
			(value) => (dialogPresentation = value),
		);
		const unsubscribe = owner.subscribe(receive);
		const precise = new ClientPreciseJumpSession(owner, (error) => {
			appLifecycle.fail("command", diagnostic(error));
		});
		preciseJumpSession = precise;
		const selection = new ClientEntitySelection({
			lifecycle: owner,
			presentation: () => gameplayPresentation,
		});
		entitySelection = selection;
		// Focus/modal cancellation must retire pending picks even if input resumes before their reply.
		const detachSelectionGate = inputGate.attach(() => {
			selection.beginAcquisition("external");
		});
		const pointer = new ClientPointerSelectionController({
			selection,
			lifecycle: owner,
			presentation: () => gameplayPresentation,
			onSelectionSubmissionFailed: appendChatError,
		});
		pointerSelection = pointer;
		const cycle = new ClientCycleSelectionController({
			selection,
			policy: CLIENT_TUNING.entitySelection.cycle,
			sample: () =>
				sampleCycleCandidates(
					owner.entities,
					owner.mirror,
					gameplayPresentation?.targetingView() ?? null,
					CLIENT_TUNING.entitySelection.cycle,
					userSettings.input.targetOnlyInView,
				),
		});
		const input = new ClientSelectionInput({
			keyboard,
			input: clientInput,
			selection,
			cycle,
			holdDelayMs: CLIENT_TUNING.entitySelection.holdDelayMs,
		});
		selectionInput = input;
		const interactions = new ClientSelectedEntityTracking({
			selection,
			lifecycle: owner,
			onFailure: appendChatError,
		});
		selectedEntityTracking = interactions;
		const salvageOwner = new ClientSalvageState(
			owner,
			(message) => toastCenter.publish({ message, tone: "status" }),
			() => {
				itemInteractions?.cancelTargeting();
				gameplayView?.showInventory();
			},
		);
		salvage = salvageOwner;
		const unbindSalvage = dialogOwner.bindLocal(salvageOwner);
		const items = new ClientItemInteractions({
			beginSalvage: (tool) => salvageOwner.openTool(tool),
			beginTrade: (partner) => tradeOwner.open(partner),
			session: owner,
			selection,
			reportNotice: (message) =>
				toastCenter.publish({ message, tone: "status" }),
			reportFailure: (message) =>
				toastCenter.publish({ message, tone: "warning" }),
			beginAcquisition: () => {
				// A newer tool-targeting intent supersedes any pending viewport action.
				locks?.cancel();
				selection.beginAcquisition("external");
				inputArbiter?.cancelPrecise();
				keyboard.returnToGame();
			},
		});
		const locksOwner = new ClientLocksState(
			owner,
			keyboard,
			() => {
				items.cancel();
				inputArbiter?.cancelPrecise();
			},
			(message, tone) => toastCenter.publish({ message, tone }),
			() => ({
				enabled: userSettings.ui.useUnlockHelper,
				autoUseKeys: userSettings.lockInteractions.autoUseKeys,
			}),
			(message) => appendChatLine({ kind: "system", message }),
			selection,
		);
		locks = locksOwner;
		itemInteractions = items;
		const unbindItems = dialogOwner.bindLocal(items);
		unrestrictedUse = false;
		const unsubscribeSelection = selection.subscribe((guid) => {
			selectedEntityGuid = guid;
			refreshSelectedChatRecipient();
			gameplayPresentation?.setSelectedEntityGuid(guid);
		});
		const unsubscribeHover = pointer.subscribeHovered((guid) => {
			hoveredEntityGuid = guid;
			gameplayPresentation?.setHoveredEntityGuid(guid);
		});
		const unsubscribePrecise = precise.subscribe((snapshot) => {
			if (preciseJumpActive !== snapshot.active)
				preciseJumpActive = snapshot.active;
			gameplayPresentation?.setPreciseJumpPresentation(snapshot);
			if (!snapshot.active) {
				preciseEscapeContext?.release();
				preciseEscapeContext = null;
				inputArbiter?.deactivate();
			}
		});
		void appLifecycle.start(() =>
			owner.start({ startAuthority: startElectronClient }),
		);

		let completion: Promise<void> | null = null;
		const retireComposition = (): Promise<void> => {
			if (completion !== null) return completion;
			disposed = true;
			unsubscribeVisualCacheFailure();
			presentationAssets = null;
			if (presentationRoot !== null) {
				const retirement = presentationRoot.destroy();
				presentationRootRetirements.add(retirement);
			}
			const retirement = new PresentationTeardownStack();
			retirement.add("presentation-assets", () => assets.destroy());
			retirement.add("presentation-roots", async () => {
				const results = await Promise.allSettled([
					...presentationRootRetirements,
				]);
				const failures = results.filter(
					(result): result is PromiseRejectedResult =>
						result.status === "rejected",
				);
				if (failures.length > 0)
					throw new AggregateError(
						failures.map((result) => result.reason),
						"Presentation root retirement failed.",
					);
			});
			retirement.add("object-previews", () => objectPreviewService.destroy());
			// Include synchronous controller cleanup in the same retained failure outcome.
			retirement.add("client-controllers", () => {
				spellState.destroy();
				retireCombatEscapeContext();
				spellReferences.dispose();
				spells = null;
				retireCharacterSettings();
				navigationWaypoint.acceptCharacter(null);
				nearbyOwner.destroy();
				nearby = null;
				unbindSalvage();
				locksOwner.destroy();
				locks = null;
				salvageOwner.destroy();
				salvage = null;
				inventoryOwner.destroy();
				containerOwner.destroy();
				tradeOwner.destroy();
				trade = null;
				vendorOwner.destroy();
				partyOwner.destroy();
				party = null;
				unbindPartyDialogs();
				unbindContractDialogs();
				housingManagementOwner.destroy();
				housingManagement = null;
				houseCrystalOwner.destroy();
				houseCrystal = null;
				vendor = null;
				worldContainer = null;
				inventory = null;
				icons.dispose();
				unbindHousingDialogs();
				unbindItems();
				items.destroy();
				itemInteractions = null;
				unbindDeathDialogs();
				deathOwner.destroy();
				deathCommands = null;
				dialogOwner.destroy();
				unsubscribeDialogs();
				dialogs = null;
				unsubscribeToast();
				unsubscribeInspection();
				unsubscribeReader();
				readerOwner.destroy();
				if (bookReaderOwner === readerOwner) bookReaderOwner = null;
				bookReader = { kind: "idle" };
				inspectionOwner.destroy();
				if (objectInspectionOwner === inspectionOwner)
					objectInspectionOwner = null;
				objectInspection = { kind: "idle" };
				contractNotifications.reset();
				toastCenter.destroy();
				unsubscribePrecise();
				unsubscribeSelection();
				pointer.clearViewportHover();
				unsubscribeHover();
				interactions.destroy();
				if (selectedEntityTracking === interactions)
					selectedEntityTracking = null;
				input.destroy();
				cycle.destroy();
				detachSelectionGate();
				pointer.destroy();
				if (selectionInput === input) selectionInput = null;
				if (pointerSelection === pointer) pointerSelection = null;
				selection.destroy();
				if (entitySelection === selection) entitySelection = null;
				precise.destroy();
				if (preciseJumpSession === precise) preciseJumpSession = null;
				unsubscribe();
				owner.stop();
				enchantments = null;
				session = null;
				chatComposer.reset();
				chatCharacterGuid = null;
				housing = emptyHousing();
				canTeleportFromMap = false;
				recallDestinations = [];
				hostTransport = null;
			});
			completion = retirement.close();
			return completion;
		};
		retireClientComposition = retireComposition;
		return () => {
			void retireComposition().catch((error: unknown) => console.error(error));
		};
	});
</script>

<div
	bind:this={interactionRoot}
	class="client-appearance-scope ui-theme"
	use:observeCombatAppearance
	style:--ui-text-scale={userSettings.ui.textScale}
	style:--ui-icon-scale={userSettings.ui.iconScale}
	style:--ui-font-body={fontCss(userSettings.ui.fonts.body)}
	style:--ui-font-heading={fontCss(userSettings.ui.fonts.heading)}
	style:--ui-font-mono={fontCss(userSettings.ui.fonts.mono)}
>
	<!-- A mounted dialog receives a non-null item until teardown, including nested snippets. -->
	{#each dialogPresentation === null ? [] : [dialogPresentation] as presentation}
		<ClientMessageDialog
			{presentation}
			onDismiss={(id) => dialogs?.dismissPopup(id)}
			onRespond={(id, accepted, suppress) => {
				void dialogs?.respond(id, accepted, suppress);
			}}
		/>
	{/each}
	<canvas
		bind:this={canvasElement}
		class="client-canvas"
		class:gameplay={usesGameplayPresentation}
		aria-label={usesGameplayPresentation ? "Game world" : "Pre-game backdrop"}
		tabindex="-1"
		data-game-viewport={usesGameplayPresentation ? true : undefined}
		style:visibility={appState.admission.canvasVisible ? "visible" : "hidden"}
	></canvas>
	{#if pregameSelection !== null}
		<div class="pregame-notices">
			<ClientToastOverlay {toast} persistentMessage={null} />
		</div>
	{/if}

	{#if page.kind === "gameplay" && canvasElement !== null && interactionRoot !== null}
		<ClientGameplayView
			{theme}
			onReturnToMainMenu={() => void returnToMainMenu()}
			onDisconnect={() => void disconnect()}
			canReturnToMenu={appState.admission.canReturn}
			canDisconnect={appState.admission.canDisconnect}
			bind:this={gameplayView}
			{mouseMovement}
			itemSession={session}
			{partyHudPresent}
			readPartyHudDisplay={() =>
				session === null
					? null
					: presentPartyHud(
							session.partySnapshot(),
							session.state().playerGuid,
						)}
			onPartyHudDemand={(enabled) =>
				session?.setPartyUpdateDemand("hud", enabled)}
			characterSheet={session?.characterSheet ?? null}
			hudLayout={userSettings.hudLayout}
			onHudPlacementChange={changeHudPlacement}
			onHudReset={resetHudLayout}
			spellBarShape={userSettings.spellBarShape}
			onSpellBarShapeChange={(spellBarShape) =>
				changeUserSection("spellBarShape", spellBarShape)}
			minimapViewDiameters={userSettings.minimapViewDiameters}
			onMinimapViewDiametersChange={(minimapViewDiameters) =>
				changeUserSection("minimapViewDiameters", minimapViewDiameters)}
			chatFilters={userSettings.chatFilters}
			onChatFiltersChange={(chatFilters) =>
				changeUserSection("chatFilters", chatFilters)}
			inspectionPreviewHeight={userSettings.inspection.previewHeight}
			audio={userSettings.audio}
			onAudioChange={changeAudio}
			graphics={userSettings.graphics}
			ui={userSettings.ui}
			clockFormat={userSettings.clockFormat}
			environmentOverrides={userSettings.environmentOverrides}
			{weatherPresets}
			{environmentIssue}
			readServerEnvironment={() =>
				gameplayPresentation?.readServerEnvironment() ?? null}
			onClockFormatChange={(format) =>
				changeUserSection("clockFormat", clientClockFormatSchema.parse(format))}
			onEnvironmentOverridesChange={changeEnvironmentOverrides}
			input={userSettings.input}
			{textureFilteringCapabilities}
			onGraphicsChange={changeGraphics}
			onUiChange={changeUi}
			onInputChange={changeInput}
			onInspectionPreviewHeightChange={(previewHeight) =>
				changeUserSection("inspection", { previewHeight })}
			{hudMode}
			onHudModeChange={(mode) => (hudMode = mode)}
			{spellBar}
			onSpellBarChange={changeSpellBar}
			actionBars={characterSettings.kind === "ready"
				? characterSettings.settings.actionBars
				: null}
			onActionBarsChange={(actionBars) => {
				if (characterSettings.kind === "ready")
					changeCharacterSettings("actionBars", actionBars);
			}}
			{spellBarEnabled}
			onSelectSpellTab={selectSpellTab}
			onActivateSpellCell={activateSpellCell}
			onActivateCasterSpell={activateCasterSpell}
			{combatMode}
			{combatStatus}
			{combatControls}
			{combatProfileSelectionRevision}
			onCombatProfileSelect={selectCombatProfile}
			onStopCombat={stopCombat}
			combatEnabled={lifecycle.kind === "in-world"}
			emotesEnabled={gameplayInputEnabled}
			onToggleCombat={() => void toggleCombatMode()}
			onCastSpell={(spellId) => void castSpell(spellId)}
			cameraController={lifecycle.kind === "in-world" ? cameraController : null}
			{debugEnabled}
			{nearby}
			onSelectKnownEntity={(guid) =>
				entitySelection?.selectKnownEntity(guid) === true}
			{readMinimapFrame}
			onClearWaypoint={() => navigationWaypoint.clear()}
			onSetWaypoint={(target) => navigationWaypoint.set(target, notifyWaypoint)}
			characterGuid={characterSettings.kind === "absent"
				? null
				: characterSettings.characterGuid}
			{worldMapSource}
			{housing}
			{housingManagement}
			{party}
			friends={session?.friends ?? null}
			contracts={session?.contracts ?? null}
			squelch={session?.squelch ?? null}
			allegiance={session?.allegiance ?? null}
			onSearchHousing={async (houseType) => {
				if (session === null) return;
				try {
					await session.searchHousing(houseType);
				} catch (error) {
					toastCenter.publish({ message: diagnostic(error), tone: "warning" });
				}
			}}
			onRefreshHousing={async () => {
				if (session === null) return;
				try {
					await session.refreshHousing();
				} catch (error) {
					toastCenter.publish({ message: diagnostic(error), tone: "warning" });
				}
			}}
			{canTeleportFromMap}
			{recallDestinations}
			onRecall={recall}
			onTeleportToMapPosition={teleportToMapPosition}
			{readDiagnostics}
			{readSelectedEntity}
			{readFrameRates}
			{readTargetIndicatorFrame}
			{readCombatTargetFrame}
			{readSelectedEntityDisplay}
			{spells}
			{enchantments}
			{locks}
			{salvage}
			{inventory}
			{worldContainer}
			{vendor}
			{houseCrystal}
			{trade}
			{itemInteractions}
			{objectInspection}
			{bookReader}
			onCloseBook={() => bookReaderOwner?.close()}
			onRetryBook={() => bookReaderOwner?.retry()}
			{objectPreviewService}
			onSelectContentsItem={(guid, mode) =>
				entitySelection?.selectContentsItem(guid, mode)}
			onInteractEntity={() =>
				itemInteractions?.interactSelected(unrestrictedUse)}
			onExamineEntity={examineSelectedEntity}
			onExamineItem={examineItem}
			onCloseInspection={() => objectInspectionOwner?.close()}
			{selectedEntityGuid}
			{hoveredEntityGuid}
			showRetailHiddenGeometry={frameSettings.showRetailHiddenGeometry}
			onShowRetailHiddenGeometryChange={setShowRetailHiddenGeometry}
			{entityCollisionDisabled}
			onEntityCollisionDisabledChange={setEntityCollisionDisabled}
			{unrestrictedUse}
			onUnrestrictedUseChange={(enabled) => (unrestrictedUse = enabled)}
			{playerName}
			{worldName}
			{vitals}
			vitalWarningsEnabled={lifecycle.kind === "in-world"}
			readConnection={() => session?.connectionSample() ?? null}
			{appearanceOptions}
			{gameplayPreferences}
			lockInteractions={userSettings.lockInteractions}
			onLockInteractionsChange={(settings) =>
				changeUserSection("lockInteractions", settings)}
			chatSuppression={userSettings.chatSuppression}
			onChatSuppressionChange={(settings) =>
				changeUserSection("chatSuppression", settings)}
			gameplayEnabled={lifecycle.kind === "in-world"}
			onGameplayOptionChange={setGameplayOption}
			onAppearanceOptionChange={setAppearanceOption}
			jumpChargeActive={activeJumpBeginSequence !== null}
			{jumpPowerKeys}
			readJumpExtent={() =>
				preciseJumpActive
					? (preciseJumpSession?.power() ??
						CLIENT_TUNING.preciseJump.initialPower)
					: (inputController?.chargeExtent() ?? 0)}
			{toast}
			{preciseJumpActive}
			onPreciseJumpAim={aimPreciseJump}
			onPreciseJumpPowerSet={(power) => preciseJumpSession?.setPower(power)}
			onPreciseJumpPowerAdjust={(steps) =>
				preciseJumpSession?.adjustPower(steps)}
			onPreciseJumpActivate={activatePreciseJump}
			readCanSetCorpsePermission={() =>
				session?.state().lifecycle?.kind === "in-world"}
			onCorpsePermission={(name, granted) => {
				const current = session;
				if (current === null || current.state().lifecycle?.kind !== "in-world")
					return;
				void current
					.setCorpsePermission(name, granted)
					.catch((error: unknown) =>
						toastCenter.publish({
							message: diagnostic(error),
							tone: "warning",
						}),
					);
			}}
			onSocialNotice={(message) =>
				toastCenter.publish({ message, tone: "warning" })}
			onInventoryNotice={(message) =>
				toastCenter.publish({ message, tone: "status" })}
			onCoordinatesCopied={() =>
				toastCenter.publish({
					message: "Coordinates copied to clipboard.",
					tone: "status",
				})}
			onPickInventoryTarget={(x, y, destination) => {
				if (pointerSelection === null)
					destination.commit({
						kind: "unavailable",
						reason: "World picking is unavailable.",
					});
				else pointerSelection.acquireTarget(x, y, destination);
			}}
			onViewportSelect={(clientX, clientY, interact) => {
				if (!interact) viewportTargetSequenceConsumed = false;
				else if (viewportTargetSequenceConsumed) return;
				const state = itemInteractions?.snapshot();
				if (state?.kind === "acquiring") {
					viewportTargetSequenceConsumed = true;
					const current = itemInteractions;
					pointerSelection?.acquireTarget(clientX, clientY, {
						isCurrent: () => {
							const latest = current?.snapshot();
							return (
								latest?.kind === "acquiring" &&
								latest.generation === state.generation
							);
						},
						commit: (result) => {
							if (result.kind === "unavailable")
								toastCenter.publish({ message: result.reason, tone: "status" });
							else
								current?.target(
									result.kind === "entity" ? result.guid : null,
									state.generation,
								);
						},
					});
				} else if (interact) {
					pointerSelection?.acquireViewportPoint(clientX, clientY, (guid) =>
						itemInteractions?.interactIfPossible(guid, unrestrictedUse),
					);
				} else pointerSelection?.acquireViewportPoint(clientX, clientY);
			}}
			onViewportExamine={(clientX, clientY) => {
				const pointer = pointerSelection;
				if (pointer === null) return;
				pointer.acquireTarget(clientX, clientY, {
					isCurrent: () => pointerSelection === pointer,
					commit: (result) => {
						if (result.kind === "entity")
							void objectInspectionOwner?.examine(result.guid);
						else if (result.kind === "unavailable")
							toastCenter.publish({ message: result.reason, tone: "warning" });
					},
				});
			}}
			onViewportHover={(clientX, clientY) =>
				pointerSelection?.acquireViewportHover(clientX, clientY)}
			onViewportHoverClear={() => pointerSelection?.clearViewportHover()}
			onMaintainEntitySelection={() => entitySelection?.maintainSelection()}
			onSelectPartyMember={(guid) => entitySelection?.selectKnownEntity(guid)}
			onSelectEntity={(guid) => entitySelection?.select(guid)}
			{chatMessages}
			{chatComposer}
			{sentChatHistory}
			{logopolisLaunchRevision}
			onSendChat={sendChat}
			onChatNotice={(message) =>
				toastCenter.publish({ message, tone: "warning" })}
			onSendChatError={appendChatError}
			{canvasElement}
			{interactionRoot}
		/>
	{:else if pregameSelection !== null}
		{#each [pregameSelection] as selection}
			<ClientCharacterSelect
				state={selection}
				entryPending={appState.operation === "enter"}
				management={characterManagement}
				creation={creationServices}
				characterActions={{
					delete: async (guid) => {
						if (session === null)
							throw new Error("Character session is unavailable.");
						await session.deleteCharacter(guid);
					},
					restore: async (guid) => {
						if (session === null)
							throw new Error("Character session is unavailable.");
						await session.restoreCharacter(guid);
					},
				}}
				scene={pregameScene}
				visualCache={startupVisualCacheTransport}
				onChoose={chooseCharacter}
				onEnter={enterWorld}
				onDisconnect={disconnect}
			>
				{#snippet settings()}
					<ClientPregameSettings
						{theme}
						graphics={userSettings.graphics}
						audio={userSettings.audio}
						ui={userSettings.ui}
						{textureFilteringCapabilities}
						onGraphicsChange={changeGraphics}
						onAudioChange={changeAudio}
						onUiChange={changeUi}
					/>
				{/snippet}
			</ClientCharacterSelect>
		{/each}
	{:else if page.kind === "loading"}
		<ClientLoadingPage state={page.content} {contentLocation} {toast}>
			{#snippet footer()}
				{#if page.content.kind !== "ended"}
					<button
						class="pregame-action pregame-quiet ui-button"
						type="button"
						disabled={session === null || !appState.admission.canDisconnect}
						onclick={() => void disconnect()}
					>
						<span class="pregame-icon" aria-hidden="true"
							><DisconnectIcon /></span
						>
						Disconnect</button
					>
				{/if}
			{/snippet}
			{#snippet actions()}
				{#if page.content.kind === "ended" || page.content.kind === "failed"}
					{#if window.holtburgerLauncher?.enabled !== false}
						<button
							class="pregame-primary pregame-action ui-button"
							type="button"
							onclick={() => void returnToLauncher().catch(console.error)}
							>Back to launcher</button
						>
					{/if}
					<button
						class="pregame-primary pregame-action ui-button"
						type="button"
						onclick={() =>
							void requestElectronClientClose().catch(console.error)}
						><span class="pregame-icon" aria-hidden="true"><PowerIcon /></span
						><span>Quit application</span></button
					>
				{/if}
				{#if page.content.kind === "failed" && page.content.retry !== null}
					<button
						class="pregame-action ui-button"
						type="button"
						onclick={page.content.retry}
					>
						<span class="pregame-icon" aria-hidden="true"><RetryIcon /></span>
						Try again</button
					>
				{/if}
			{/snippet}
		</ClientLoadingPage>
	{/if}
</div>

<style>
	@layer components {
		.client-appearance-scope {
			display: contents;
		}
		.pregame-notices {
			position: fixed;
			inset: 24px 24px auto auto;
			z-index: 2;
			width: min(420px, calc(100vw - 48px));
			pointer-events: none;
		}
	}
</style>
