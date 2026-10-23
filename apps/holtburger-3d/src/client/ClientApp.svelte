<script lang="ts">
	import { loadSoulEmotes } from "./client-soul-emotes";
	import type { SceneInterestMembership } from "../lib/game/runtime/render-scene-interest-controller";
	import { startPresentationFrameLoop } from "../app/presentation-frame-loop";
	import { ClientNavigationWaypointOwner } from "./client-navigation-waypoint";
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
		ClientKeyboardConfiguration,
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
	import {
		weenieCatalogCapabilitySchema,
		type WeenieCatalogCapability,
	} from "../lib/host/weenie-catalog-capability";
	import ClientMessageDialog from "./ClientMessageDialog.svelte";
	import ClientToastOverlay from "./ClientToastOverlay.svelte";
	import { ClientContractNotifications } from "./client-contract-notifications";
	import {
		ClientDialogs,
		type ClientDialogPresentation,
	} from "./client-dialogs";
	import { provideAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type { EscapeContextHandle } from "../lib/input/keyboard-input-policy";
	import { AppInput } from "../lib/input/app-input";
	import { provideClientInput } from "./client-input-context";
	import {
		clientInputConfiguration,
		clientKeyboardSettingsSchema,
	} from "./client-input-settings";
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
	import { createElectronHostTransport } from "../lib/host/electron-host-transport";
	import type { HostTransport } from "../lib/host/host-transport";
	import {
		ClientLifecycleSession,
		hostClientLifecycleTransport,
		type ClientLifecycleSessionEvent,
		type ClientTimedEnchantments,
	} from "./client-lifecycle-session";
	import {
		ClientPresentationSession,
		type ClientPresentationCameraController,
		type ClientPresentationDiagnostics,
		type ClientPresentationStatus,
	} from "./client-presentation-session";
	import type { ClientObjectPreviewService } from "./client-object-preview-service";
	import { clientDebugEnabled } from "./client-debug";
	import ClientCharacterSelect from "./ClientCharacterSelect.svelte";
	import {
		ClientSelectedEntityTracking,
		type ClientSelectedEntityDisplay,
		EMPTY_CLIENT_SELECTED_DISPLAY,
	} from "./client-selected-entity-tracking";
	import ClientWorldView from "./ClientWorldView.svelte";
	import { hostWorldMapSource } from "../lib/assets/world-map-source";
	import type { MinimapFrame } from "../app/minimap-frame";
	import type {
		RecallDestination,
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
	import type { ClientChatEntry, ClientChatLine } from "./client-chat-policy";
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
		clientLifecycleEnablesWorldInput,
		clientLifecycleUsesWorldPresentation,
		initialClientLifecycleUiState,
		reduceClientLifecycleUiState,
		type ClientLifecycleUiState,
	} from "./client-lifecycle-state";
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
		readonly initialUserSettings: ClientUserSettings;
		/** Bootstrap settings issue captured before the app's toast owner exists. */
		readonly initialSettingsIssue: string | null;
		readonly settingsTransport: ClientSettingsTransport;
	}

	const {
		initialUserSettings,
		initialSettingsIssue,
		settingsTransport,
	}: Props = $props();
	// Bootstrap completes before mount; later prop replacement cannot own live settings lifetime.
	const startupUserSettings = untrack(() => initialUserSettings);
	const startupSettingsIssue = untrack(() => initialSettingsIssue);
	const startupSettingsTransport = untrack(() => settingsTransport);
	let userSettings = $state.raw<ClientUserSettings>(startupUserSettings);
	const clientInput = provideClientInput(
		new AppInput(clientInputConfiguration(startupUserSettings.input)),
	);

	let entityCollisionDisabled = $state(false);
	/** Cold core admission consumed by the World panel's click gesture. */
	let canTeleportFromMap = $state(false);
	/** Core-filtered standard recall attempts, replaced after event loss. */
	let recallDestinations = $state<readonly RecallDestination[]>([]);
	let lifecycle = $state<ClientLifecycleUiState>(
		initialClientLifecycleUiState(),
	);
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
	/** Event-driven stance consumed by combat controls and spell shortcuts. */
	let combatMode = $state<ClientCombatMode>("unknown");
	let combatStatus = $state<ClientCombatStatus>({
		desired: null,
		state: "idle",
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
		if (selectedEntityGuid !== null) beginCombatEngagement(profile);
		else if (combatStatus.desired !== null)
			void session?.updateCombatProfile(profile).catch(reportCommandFailure);
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
			selectedEntityGuid === null ||
			characterSettings.kind !== "ready"
		)
			return;
		// Selection is sampled only for this explicit begin; core retains the engaged target.
		retireCombatEscapeContext();
		const context = keyboard.bindEscapeContext(stopCombat);
		combatEscapeContext = context;
		void currentSession
			.beginCombatEngagement(selectedEntityGuid, profile)
			.catch((error: unknown) => {
				// A failed older begin must not retire a newer engagement's cancellation.
				if (combatEscapeContext === context) retireCombatEscapeContext();
				reportCommandFailure(error);
			});
	}
	function stopCombat(): void {
		retireCombatEscapeContext();
		void session?.stopCombatEngagement().catch(reportCommandFailure);
	}
	const spellBarEnabled = $derived(
		characterSettings.kind === "ready" &&
			lifecycle.kind === "in-world" &&
			combatMode === "magic" &&
			hudMode === "runtime",
	);

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
	let startupError = $state<string | null>(null);
	let commandFailure = $state<string | null>(null);
	function reportCommandFailure(error: unknown): void {
		commandFailure = diagnostic(error);
	}
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
	/** Sent input survives world-view remounts until this app closes. */
	let sentChatHistory = $state<readonly string[]>([]);
	const chatComposer = new ClientChatComposer({
		recentEmotes: startupUserSettings.recentEmotes,
		onRecentEmotesChange: (ids) => changeUserSection("recentEmotes", ids),
	});
	let chatCharacterGuid: number | null = null;
	let nextChatMessageId = 1;
	const MAXIMUM_CHAT_LINES = 250;
	let entryPending = $state(false);
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	/** View-owned inventory modal entry used by gameplay shortcuts. */
	let worldView = $state<ClientWorldView | null>(null);
	let cameraController = $state<ClientPresentationCameraController | null>(
		null,
	);
	/** Imperative presentation source sampled by the radar on its own bounded cadence. */
	let presentationSession: ClientPresentationSession | null = null;
	/** Cold content catalog and validation issue consumed by Settings. */
	let weatherPresets = $state<readonly ClientWeatherPreset[]>([]);
	let environmentIssue = $state<string | null>(null);
	const objectPreviewService: ClientObjectPreviewService = {
		open: (request) => {
			const presentation = presentationSession;
			if (!presentation)
				throw new Error(
					"Creature preview is unavailable before presentation starts.",
				);
			return presentation.objectPreviews.open(request);
		},
	};
	let frameRateSampler: FrameRateSampler | null = null;

	/** CDP-facing bridge for explicit live-client performance probes. */
	interface ClientPerformanceProbe {
		reset(): void;
		setRendererProfilingEnabled(enabled: boolean): void;
		snapshot(): {
			readonly diagnostics: ClientPresentationDiagnostics;
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
			(commandFailure = `Character settings could not be loaded: ${diagnostic(error)}`),
		unavailable: (reasons) =>
			toastCenter.publish({
				message: `Character settings unavailable: ${reasons.join("; ")}`,
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
		userSettings = { ...userSettings, [key]: value };
		userSettingsPersistence.publish({ sections: { [key]: value } });
	}
	function changeHudPlacement(
		surface: keyof ClientHudLayout,
		placement: ClientHudPlacement,
	): void {
		userSettings = {
			...userSettings,
			hudLayout: { ...userSettings.hudLayout, [surface]: placement },
		};
		userSettingsPersistence.publish({
			hudPlacements: { [surface]: placement },
		});
	}
	function resetHudLayout(layout: ClientHudLayout): void {
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
				presentationSession?.setCombatEffectsAppearance(appearance);
			},
			() => presentationSession?.refreshCombatEffectsFontAtlas(),
		);
	}

	function changeUi(ui: ClientUiSettings): void {
		changeUserSection("ui", clientUiSettingsSchema.parse(ui));
	}
	function changeEnvironmentOverrides(
		overrides: ClientEnvironmentOverrides,
	): void {
		const accepted = clientEnvironmentOverridesSchema.parse(overrides);
		changeUserSection("environmentOverrides", accepted);
		presentationSession?.setEnvironmentOverrides(accepted);
	}
	function changeInput(input: ClientKeyboardConfiguration): void {
		const accepted = clientKeyboardSettingsSchema.parse(input);
		keyboard.cancel();
		characterInput.replaceBindings(accepted.character);
		inputArbiter?.replacePowerBindings(accepted.preciseJump);
		clientInput.replaceConfiguration(clientInputConfiguration(accepted));
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
		const flush = () => {
			void Promise.all([
				userSettingsPersistence.flush(),
				characterSettingsOwner.flush(),
			]).catch(() => undefined);
		};
		window.addEventListener("beforeunload", flush);
		return () => {
			window.removeEventListener("beforeunload", flush);
			flush();
		};
	});
	// Controls replace this cold policy snapshot; frame-hot consumers must receive plain objects.
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
		presentationSession?.setFrameSettings(frameSettings);
	}
	function changeAudio(audio: ClientAudioSettings): void {
		const accepted = clientAudioSettingsSchema.parse(audio);
		changeUserSection("audio", accepted);
		presentationSession?.setAudioSettings(accepted);
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
			presentationSession?.setSceneInterestRadii(
				clientSceneInterestRadii(accepted.viewDistance),
			);
		if (accepted.verticalFovDegrees !== previous.verticalFovDegrees)
			presentationSession?.setFieldOfView(accepted.verticalFovDegrees);
		applyFrameGraphics(accepted);
	}
	let inputController: CharacterInputController | null = null;
	const { viewport: inputGate, keyboard } = provideAppInputPolicy();
	/** Explicit attack intent owns cancellation; passive status updates can only retire it. */
	let combatEscapeContext: EscapeContextHandle | null = null;
	/** Precise-jump entry owns registration; completion, cancellation and teardown retire it. */
	let preciseEscapeContext: EscapeContextHandle | null = null;
	function retireCombatEscapeContext(): void {
		combatEscapeContext?.release();
		combatEscapeContext = null;
	}
	function acceptCombatStatus(status: ClientCombatStatus): void {
		combatStatus = status;
		if (status.desired === null) retireCombatEscapeContext();
	}
	let inputArbiter: ClientInputArbiter | null = null;
	const characterInput = clientInput.characterContext((action, pressed) => {
		if (
			action === "jump" &&
			characterMotion === null &&
			!inputArbiter?.preciseActive
		)
			return;
		inputArbiter?.applyAction(action, pressed);
	});

	$effect(() => {
		if (!worldInputEnabled) return untrack(() => inputGate.block());
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
	let hoveredEntityGuid = $state<number | null>(null);
	let preciseJumpActive = $state(false);
	let inputDispatch: Promise<void> = Promise.resolve();
	const usesWorldPresentation = $derived(
		clientLifecycleUsesWorldPresentation(lifecycle),
	);
	const worldInputEnabled = $derived(
		clientLifecycleEnablesWorldInput(lifecycle),
	);

	function queueCharacterMotionEdge(
		currentSession: ClientLifecycleSession,
		edge: CharacterInputEdge,
		active: () => boolean,
	): void {
		if (edge.kind === "reset") {
			cameraController?.setTranslationIntent(false, performance.now());
		}
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
				if (active()) commandFailure = diagnostic(error);
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
				if (active()) commandFailure = diagnostic(error);
			});
	}

	function receive(event: ClientLifecycleSessionEvent): void {
		contractNotifications.receive(event);
		switch (event.type) {
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
			case "appearance-options":
				appearanceOptions = event.options;
				return;
			case "current-state":
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
				entityCollisionDisabled = event.state.entityCollisionDisabled;
				if (event.state.lifecycle.kind !== "in-world") {
					retireCombatEscapeContext();
					inputGate.cancel();
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
				lifecycle = reduceClientLifecycleUiState(lifecycle, {
					type: "authority",
					lifecycle: event.state.lifecycle,
				});
				return;
			case "resyncing":
				canTeleportFromMap = false;
				recallDestinations = [];
				enchantments = null;
				appearanceOptions = null;
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
				if (event.lifecycle.kind !== "in-world") {
					retireCombatEscapeContext();
					inputGate.cancel();
				}
				if (
					event.lifecycle.kind === "entering-world" ||
					event.lifecycle.kind === "character-selection"
				) {
					retireCharacterSettings();
				}
				lifecycle = reduceClientLifecycleUiState(lifecycle, {
					type: "authority",
					lifecycle: event.lifecycle,
				});
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
				inputGate.cancel();
				lifecycle = reduceClientLifecycleUiState(lifecycle, {
					type: "exit",
					exit: event.exit,
				});
				return;
			case "presentation-discontinuity":
				inputGate.cancel();
				return;
			default:
				return;
		}
	}

	function appendChatLine(message: ClientChatEntry): void {
		const line: ClientChatLine = {
			...message,
			id: nextChatMessageId++,
			receivedAt: new Date(),
		};
		chatMessages = [...chatMessages, line].slice(-MAXIMUM_CHAT_LINES);
	}

	function appendChatError(error: unknown): void {
		appendChatLine({ kind: "error", message: diagnostic(error) });
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
			inputGate.cancel();
			await inputDispatch;
			await session.disconnect();
		} catch (error) {
			commandFailure = diagnostic(error);
		}
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
		if (runClientHelpCommand(message, appendChatLine)) return;
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
					if (presentationSession === null)
						throw new Error("World presentation is unavailable.");
					return presentationSession.readLocationReport();
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

	/** HUD item identities are already resolved; select and inspect that exact target. */
	function examineItem(guid: number): void {
		entitySelection?.selectContentsItem(guid, "select");
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
		if (worldView?.handleSystemPanelKeydown(event)) return;
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
				worldView?.splitSelectedEntity(canvasElement);
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
		const ray = presentationSession?.samplePreciseJumpRay(clientX, clientY);
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

	const EMPTY_TRACKED_GUIDS: ReadonlySet<number> = new Set();
	function readMinimapFrame(): MinimapFrame {
		const frame = presentationSession?.readMinimapFrame() ?? {
			waypoint: null,
			cameraFovRadians: 0,
			cameraHeadingRadians: 0,
			presentedEntities: () => [],
			selectedGuid: selectedEntityGuid,
			source: null,
			subject: null,
		};
		return {
			...frame,
			trackedGuids: nearby?.trackedGuids() ?? EMPTY_TRACKED_GUIDS,
			waypoint: navigationWaypoint.read(
				frame.subject,
				lifecycle.kind === "in-world" &&
					session !== null &&
					!session.mirror.isAwaitingSnapshot() &&
					presentationSession?.status().kind === "ready",
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

	function readDiagnostics(): ClientPresentationDiagnostics | null {
		return presentationSession?.readDiagnostics() ?? null;
	}

	function readFrameRates(): FrameRates | null {
		return frameRateSampler?.readFrameRates() ?? null;
	}

	function readTargetIndicatorFrame(): ClientTargetIndicatorFrame | null {
		return presentationSession?.readTargetIndicatorFrame() ?? null;
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
		presentationSession?.setFrameSettings(frameSettings);
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
		let stopFrameLoop: (() => void) | null = null;
		let lastStatus: ClientPresentationStatus | null = null;
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
			nextStatus: ClientPresentationStatus,
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
		const presentation = new ClientPresentationSession({
			canvas,
			hostTransport: currentTransport,
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
			onTextureFilteringCapabilities: (capabilities) => {
				textureFilteringCapabilities = capabilities;
				if (capabilities !== null) applyFrameGraphics(userSettings.graphics);
			},
			enablePerformanceProfiling: debugEnabled,
		});
		// Frame settings are cold presentation policy, not renderer identity. The control handler
		// updates the live owner directly; this snapshot only initializes a genuinely new owner.
		presentation.setFrameSettings(untrack(() => frameSettings));
		// Audio preferences are initialization snapshots, never presentation lifecycle dependencies.
		presentation.setAudioSettings(untrack(() => userSettings.audio));
		// Cold preferences seed a new owner once; edits use the live setter above.
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
		const currentFrameRateSampler = createFrameRateSampler(
			CLIENT_TUNING.diagnostics.frameMetricsEmaWindowMs,
		);
		let sampledFrameWorkMs = 0;
		let sampledFrameCount = 0;
		const performanceProbe: ClientPerformanceProbe = {
			reset: (): void => {
				sampledFrameWorkMs = 0;
				sampledFrameCount = 0;
				presentation.resetRendererFrameProfile();
			},
			setRendererProfilingEnabled: (enabled): void => {
				presentation.setRendererFrameProfilingEnabled(enabled);
			},
			snapshot: () => ({
				diagnostics: presentation.readDiagnostics(),
				frameRates: currentFrameRateSampler.readFrameRates(),
				meanFrameWorkMs:
					sampledFrameCount === 0
						? null
						: sampledFrameWorkMs / sampledFrameCount,
				sampledFrameCount,
			}),
		};
		presentationSession = presentation;
		presentation.setSelectedEntityGuid(untrack(() => selectedEntityGuid));
		// Seed a replacement presentation once; hover changes must not own its lifecycle.
		presentation.setHoveredEntityGuid(
			untrack(() => pointerSelection?.hoveredGuid() ?? null),
		);
		frameRateSampler = currentFrameRateSampler;
		(window as ClientPerformanceWindow).__holtburgerClientPerformance =
			performanceProbe;
		cameraController = presentation.camera;
		reportPresentationStatus({ kind: "starting", diagnostic: null });

		let previousFrameTime: number | null = null;
		const frame = (timeMs: number): void => {
			if (cancelled) return;
			const elapsedSeconds =
				previousFrameTime === null
					? 0
					: Math.max(0, timeMs - previousFrameTime) / 1000;
			previousFrameTime = timeMs;
			preciseJumpSession?.adjustHeldPower(
				inputArbiter?.precisePowerDirection ?? 0,
				elapsedSeconds,
			);
			const frameStartedAt = performance.now();
			const nextStatus = presentation.frame(timeMs).status;
			const frameFinishedAt = performance.now();
			sampledFrameWorkMs += frameFinishedAt - frameStartedAt;
			sampledFrameCount += 1;
			currentFrameRateSampler.recordFrame({
				animationFrameTimeMs: timeMs,
				startedAtMs: frameStartedAt,
				workMs: frameFinishedAt - frameStartedAt,
			});
			reportPresentationStatus(nextStatus);
		};
		void presentation
			.start()
			.then(() => {
				if (!cancelled) {
					// The imperative owner remains authoritative; this snapshot only closes the
					// race between marker publication and presentation startup.
					if (preciseJumpSession !== null) {
						presentation.setPreciseJumpPresentation(
							preciseJumpSession.snapshot(),
						);
					}
					stopFrameLoop = startPresentationFrameLoop(frame);
				}
			})
			.catch(reportPresentationError);

		return () => {
			cancelled = true;
			weatherPresets = [];
			environmentIssue = null;
			stopFrameLoop?.();
			void presentation.destroy().catch((error: unknown) => {
				// The route is already leaving, so keep teardown failure visible to diagnostics
				// without mutating an unmounted chat surface.
				console.error(error);
			});
			if (cameraController === presentation.camera) cameraController = null;
			if (presentationSession === presentation) {
				presentationSession = null;
				nearbySceneMembership = null;
				nearby?.setSceneMembership(null);
			}
			if (frameRateSampler === currentFrameRateSampler) frameRateSampler = null;
			const performanceWindow = window as ClientPerformanceWindow;
			if (
				performanceWindow.__holtburgerClientPerformance === performanceProbe
			) {
				delete performanceWindow.__holtburgerClientPerformance;
			}
		};
	});

	/** Owns one browser-to-host movement controller per active world-input lifetime. */
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
				itemInteractions?.cancelTargeting();
				selectionInput?.cancel();
				characterInput.reset();
				if (reason === "focus-transfer") inputArbiter?.releaseHeldActions();
				else inputArbiter?.reset();
			},
		}),
	);

	/** One startup result consumed only by the diagnostics panel. */
	let entityMetadata = $state<WeenieCatalogCapability | null>(null);
	onMount(() => {
		let disposed = false;
		const unsubscribeToast = toastCenter.subscribe((next) => (toast = next));
		const transport = createElectronHostTransport();
		hostTransport = transport;
		void loadSoulEmotes(transport)
			.then((catalog) => {
				if (!disposed) chatComposer.setEmotes(catalog);
			})
			.catch((error: unknown) => {
				if (!disposed)
					commandFailure = `Soul-emote catalog could not be loaded: ${diagnostic(error)}`;
			});
		void transport
			.invoke("host_status")
			.then((value) => {
				const status = z
					.object({ entityMetadata: weenieCatalogCapabilitySchema })
					.parse(value);
				if (!disposed) entityMetadata = status.entityMetadata;
			})
			.catch((error: unknown) => {
				if (!disposed) commandFailure = diagnostic(error);
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
			commandFailure = diagnostic(error);
		});
		preciseJumpSession = precise;
		const selection = new ClientEntitySelection({
			lifecycle: owner,
			presentation: () => presentationSession,
		});
		entitySelection = selection;
		const pointer = new ClientPointerSelectionController({
			selection,
			lifecycle: owner,
			presentation: () => presentationSession,
			onSelectionSubmissionFailed: appendChatError,
		});
		pointerSelection = pointer;
		const cycle = new ClientCycleSelectionController({
			selection,
			policy: CLIENT_TUNING.entitySelection.cycle,
			sample: (category) =>
				sampleCycleCandidates(
					owner.entities,
					owner.mirror,
					presentationSession?.targetingView() ?? null,
					category,
					CLIENT_TUNING.entitySelection.cycle,
				),
		});
		const input = new ClientSelectionInput({
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
		const items = new ClientItemInteractions({
			beginTrade: (partner) => tradeOwner.open(partner),
			session: owner,
			selection,
			reportNotice: (message) =>
				toastCenter.publish({ message, tone: "status" }),
			reportFailure: (message) =>
				toastCenter.publish({ message, tone: "warning" }),
			beginAcquisition: () => {
				inputArbiter?.cancelPrecise();
				keyboard.returnToGame();
			},
		});
		itemInteractions = items;
		const unbindItems = dialogOwner.bindLocal(items);
		unrestrictedUse = false;
		const unsubscribeSelection = selection.subscribe((guid) => {
			selectedEntityGuid = guid;
			refreshSelectedChatRecipient();
			presentationSession?.setSelectedEntityGuid(guid);
		});
		const unsubscribeHover = pointer.subscribeHovered((guid) => {
			hoveredEntityGuid = guid;
			presentationSession?.setHoveredEntityGuid(guid);
		});
		const unsubscribePrecise = precise.subscribe((snapshot) => {
			if (preciseJumpActive !== snapshot.active)
				preciseJumpActive = snapshot.active;
			presentationSession?.setPreciseJumpPresentation(snapshot);
			if (!snapshot.active) {
				preciseEscapeContext?.release();
				preciseEscapeContext = null;
				inputArbiter?.deactivate();
			}
		});
		void owner.start().catch((error: unknown) => {
			startupError = diagnostic(error);
		});

		return () => {
			disposed = true;
			spellState.destroy();
			retireCombatEscapeContext();
			spellReferences.dispose();
			spells = null;
			retireCharacterSettings();
			navigationWaypoint.acceptCharacter(null);
			nearbyOwner.destroy();
			nearby = null;
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
		};
	});
</script>

<div
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
	{#if !usesWorldPresentation}
		<ClientToastOverlay {toast} persistentMessage={null} />
	{/if}

	{#if usesWorldPresentation && startupError === null && commandFailure === null}
		<ClientWorldView
			bind:this={worldView}
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
				presentationSession?.readServerEnvironment() ?? null}
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
			combatEnabled={lifecycle.kind === "in-world"}
			emotesEnabled={worldInputEnabled}
			onToggleCombat={() => void toggleCombatMode()}
			onCastSpell={(spellId) => void castSpell(spellId)}
			{entityMetadata}
			cameraController={lifecycle.kind === "in-world" ? cameraController : null}
			{debugEnabled}
			{nearby}
			onSelectNearbyEntity={(guid) =>
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
			{readSelectedEntityDisplay}
			{spells}
			{enchantments}
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
			onViewportSelect={(clientX, clientY) => {
				const state = itemInteractions?.snapshot();
				if (state?.kind === "acquiring") {
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
				} else pointerSelection?.acquireViewportPoint(clientX, clientY);
			}}
			onViewportExamine={(clientX, clientY) => {
				if (entitySelection === null || pointerSelection === null) return;
				const selection = entitySelection;
				const intent = selection.beginAcquisition("external");
				pointerSelection.acquireViewportSelection(clientX, clientY, {
					isCurrent: () => selection.isCurrentAcquisition(intent),
					commit: (result) => {
						if (result.kind === "unavailable") return;
						const guid = result.kind === "entity" ? result.guid : null;
						selection.commitAcquisition(intent, guid);
						if (guid !== null) void objectInspectionOwner?.examine(guid);
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
			onSendChat={sendChat}
			onSendChatError={appendChatError}
			onCanvas={(canvas) => (canvasElement = canvas)}
		/>
	{:else}
		<main class="client-screen ui-theme" aria-label="Holtburger client">
			<section class="client-panel ui-panel">
				<header class="ui-frame">
					<span>Client</span>
				</header>

				<div class="client-panel-body ui-body">
					<p class="ui-muted">Holtburger 3D Client</p>
					{#if startupError !== null}
						<h1>Client unavailable</h1>
						<p class="client-status ui-error" role="alert">
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
</div>

<style>
	@layer components {
		.client-appearance-scope {
			display: contents;
		}
		.client-screen {
			display: grid;
			min-height: 100vh;
			place-items: start center;
			padding: clamp(16px, 5vw, 48px);
			background: var(--ui-color-well);
		}
		.client-panel {
			width: min(100%, 640px);
		}
		.client-panel-body {
			display: grid;
			gap: 12px;
			padding: clamp(12px, 3vw, 24px);
		}
	}
</style>
