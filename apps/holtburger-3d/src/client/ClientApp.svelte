<script lang="ts">
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
	import { ClientItemInteractions } from "./client-item-interactions";
	import { ClientInventoryState } from "./client-inventory-state";
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
	import { CLIENT_TUNING } from "./client-tuning";
	import { createElectronHostTransport } from "../lib/host/electron-host-transport";
	import type { HostTransport } from "../lib/host/host-transport";
	import {
		ClientLifecycleSession,
		hostClientLifecycleTransport,
		type ClientLifecycleSessionEvent,
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
	import type { MinimapFrame } from "../app/minimap-frame";
	import type {
		ClientCombatMode,
		ClientAttackProfile,
		ClientCombatStatus,
		ClientCharacterMotionCapabilities,
		ClientCharacterMotionEventRequest,
		ClientCharacterMotionRejection,
		ClientAppearanceOption,
		ClientAppearanceOptions,
		ClientChatMessage,
		ClientDriveRequest,
		ClientVital,
	} from "./client-host-contract";
	import type {
		ClientChatErrorMessage,
		ClientChatLine,
	} from "./client-chat-policy";
	import type { FrameSettings } from "../lib/game/renderer/renderer";
	import {
		resolveTextureFilteringPolicy,
		type TextureFilteringCapabilities,
	} from "../lib/game/renderer/texture-filtering-policy";
	import type {
		ClientCharacterSettings,
		ClientGraphicsSettings,
		ClientUiSettings,
		ClientUserSettings,
	} from "./client-settings-contract";
	import {
		clientGraphicsSettingsSchema,
		clientUiSettingsSchema,
	} from "./client-settings-contract";
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
		/** Bootstrap write failure captured before the app's toast owner exists. */
		readonly initialSettingsSaveFailure: string | null;
		readonly settingsTransport: ClientSettingsTransport;
	}

	const {
		initialUserSettings,
		initialSettingsSaveFailure,
		settingsTransport,
	}: Props = $props();
	// Bootstrap completes before mount; later prop replacement cannot own live settings lifetime.
	const startupUserSettings = untrack(() => initialUserSettings);
	const startupSettingsSaveFailure = untrack(() => initialSettingsSaveFailure);
	const startupSettingsTransport = untrack(() => settingsTransport);
	let userSettings = $state.raw<ClientUserSettings>(startupUserSettings);
	const clientInput = provideClientInput(
		new AppInput(clientInputConfiguration(startupUserSettings.input)),
	);

	let entityCollisionDisabled = $state(false);
	let lifecycle = $state<ClientLifecycleUiState>(
		initialClientLifecycleUiState(),
	);
	const debugEnabled = clientDebugEnabled(window.location.search);
	let session = $state<ClientLifecycleSession | null>(null);
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
			changeCharacterSettings({
				...characterSettings.settings,
				spellBarBindings: { tabs: value.tabs },
			});
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
		changeCharacterSettings({
			...characterSettings.settings,
			combatControls: controls,
		});
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
	let worldContainer = $state<ClientWorldContainerPanelState | null>(null);
	let hostTransport = $state<HostTransport | null>(null);
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
	let nextChatMessageId = 1;
	const MAXIMUM_CHAT_LINES = 250;
	let entryPending = $state(false);
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let cameraController = $state<ClientPresentationCameraController | null>(
		null,
	);
	/** Imperative presentation source sampled by the radar on its own bounded cadence. */
	let presentationSession: ClientPresentationSession | null = null;
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
	if (startupSettingsSaveFailure !== null)
		toastCenter.publish({
			message: `Settings could not be saved: ${startupSettingsSaveFailure}`,
			tone: "warning",
		});
	const userSettingsPersistence = new ClientSettingsPersistence({
		delayMs: 250,
		save: (settings: ClientUserSettings) =>
			startupSettingsTransport.saveUser(settings),
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
			if (state.kind !== "ready") selectedSpellTab = 0;
		},
		loadFailed: (error) =>
			(commandFailure = `Character settings could not be loaded: ${diagnostic(error)}`),
		saveFailed: (error) =>
			toastCenter.publish({
				message: `Character settings could not be saved: ${diagnostic(error)}`,
				tone: "warning",
			}),
		saveDelayMs: 250,
	});
	function changeUserSettings(settings: ClientUserSettings): void {
		userSettings = settings;
		userSettingsPersistence.publish(settings);
	}
	function changeUi(ui: ClientUiSettings): void {
		changeUserSettings({
			...userSettings,
			ui: clientUiSettingsSchema.parse(ui),
		});
	}
	function changeInput(input: ClientKeyboardConfiguration): void {
		const accepted = clientKeyboardSettingsSchema.parse(input);
		keyboard.cancel();
		characterInput.replaceBindings(accepted.character);
		clientInput.replaceConfiguration(clientInputConfiguration(accepted));
		changeUserSettings({ ...userSettings, input: accepted });
	}
	function fontCss(family: ClientFontFamily): string | undefined {
		return family === "theme" ? undefined : CLIENT_FONT_FAMILY_CSS[family];
	}
	function changeCharacterSettings(settings: ClientCharacterSettings): void {
		characterSettingsOwner.change(settings);
	}
	function acceptCharacterName(characterGuid: number, name: string): void {
		characterSettingsOwner.acceptName(characterGuid, name);
	}
	function retireCharacterSettings(): void {
		characterSettingsOwner.retire();
	}
	function acceptCharacterGuid(characterGuid: number | null): void {
		characterSettingsOwner.acceptGuid(characterGuid);
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
		changeUserSettings({ ...userSettings, graphics: accepted });
		if (accepted.viewDistance !== previous.viewDistance)
			presentationSession?.setSceneInterestRadii(
				clientSceneInterestRadii(accepted.viewDistance),
			);
		if (accepted.verticalFovDegrees !== previous.verticalFovDegrees)
			presentationSession?.setFieldOfView(accepted.verticalFovDegrees);
		if (
			accepted.ambientOcclusionEnabled !== previous.ambientOcclusionEnabled ||
			accepted.entityShadowMode !== previous.entityShadowMode ||
			accepted.textureFiltering !== previous.textureFiltering ||
			accepted.renderScale !== previous.renderScale ||
			accepted.weatherEnabled !== previous.weatherEnabled
		) {
			applyFrameGraphics(accepted);
		}
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
	let entitySelection: ClientEntitySelection | null = null;
	let pointerSelection: ClientPointerSelectionController | null = null;
	let selectionInput: ClientSelectionInput | null = null;
	let itemInteractions = $state<ClientItemInteractions | null>(null);
	let selectedEntityTracking: ClientSelectedEntityTracking | null = null;
	let selectedEntityGuid = $state<number | null>(null);
	let objectInspectionOwner: ClientObjectInspection | null = null;
	let objectInspection = $state<ClientObjectInspectionState>({ kind: "idle" });
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
		switch (event.type) {
			case "entity-collision-disabled":
				entityCollisionDisabled = event.disabled;
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
				acceptCharacterGuid(event.state.localPlayerGuid);
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
				appearanceOptions = null;
				return;
			case "lifecycle":
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
			case "server-controlled-motion":
				inputArbiter?.cancelAutoRun();
				return;
			case "world-name":
				worldName = event.name;
				return;
			case "local-player-established":
				acceptCharacterGuid(event.identity.playerGuid);
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
			case "chat": {
				appendChatLine(event.message);
				return;
			}
			case "exit-requested":
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

	function appendChatLine(
		message: ClientChatMessage | ClientChatErrorMessage,
	): void {
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

	async function sendChat(message: string): Promise<void> {
		if (session === null) throw new Error("Chat session is unavailable.");
		await session.sendChat(message);
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

	function handleGameKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented) return;
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
		if (characterInput.apply(event, false)) event.preventDefault();
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

	function readMinimapFrame(): MinimapFrame {
		return (
			presentationSession?.readMinimapFrame() ?? {
				cameraFovRadians: 0,
				cameraHeadingRadians: 0,
				presentedEntities: () => [],
				selectedGuid: selectedEntityGuid,
				source: null,
				subject: null,
			}
		);
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
		let frameHandle = 0;
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
			onTextureFilteringCapabilities: (capabilities) => {
				textureFilteringCapabilities = capabilities;
				if (capabilities !== null) applyFrameGraphics(userSettings.graphics);
			},
			enablePerformanceProfiling: debugEnabled,
		});
		// Frame settings are cold presentation policy, not renderer identity. The control handler
		// updates the live owner directly; this snapshot only initializes a genuinely new owner.
		presentation.setFrameSettings(untrack(() => frameSettings));
		presentation.setSceneInterestRadii(
			clientSceneInterestRadii(
				untrack(() => userSettings.graphics.viewDistance),
			),
		);
		presentation.setFieldOfView(
			untrack(() => userSettings.graphics.verticalFovDegrees),
		);
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

		const frame = (timeMs: number): void => {
			if (cancelled) return;
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
			frameHandle = window.requestAnimationFrame(frame);
		};
		void presentation
			.start()
			.then(() => {
				if (!cancelled) {
					// The imperative owner remains authoritative; this snapshot only closes the
					// race between marker publication and presentation startup.
					presentation.setPreciseJumpMarker(
						preciseJumpSession?.snapshot().marker ?? null,
					);
					frameHandle = window.requestAnimationFrame(frame);
				}
			})
			.catch(reportPresentationError);

		return () => {
			cancelled = true;
			window.cancelAnimationFrame(frameHandle);
			void presentation.destroy().catch((error: unknown) => {
				// The route is already leaving, so keep teardown failure visible to diagnostics
				// without mutating an unmounted chat surface.
				console.error(error);
			});
			if (cameraController === presentation.camera) cameraController = null;
			if (presentationSession === presentation) presentationSession = null;
			if (frameRateSampler === currentFrameRateSampler) frameRateSampler = null;
			const performanceWindow = window as ClientPerformanceWindow;
			if (
				performanceWindow.__holtburgerClientPerformance === performanceProbe
			) {
				delete performanceWindow.__holtburgerClientPerformance;
			}
		};
	});

	/** Raw browser ownership ends at the client shell; every edge publishes an idle replacement. */
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
			cancel: () => {
				itemInteractions?.cancelTargeting();
				selectionInput?.cancel();
				characterInput.reset();
				inputArbiter?.reset();
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
		const inspectionOwner = new ClientObjectInspection(owner, (message) =>
			toastCenter.publish({ message, tone: "warning" }),
		);
		objectInspectionOwner = inspectionOwner;
		const unsubscribeInspection = inspectionOwner.subscribe(
			(value) => (objectInspection = value),
		);
		const icons = browserUiIconRepository((requests) =>
			prepareUiIcons(transport, requests),
		);
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
		const spellReferences = new SpellReferences(transport);
		const spellState = new ClientSpellState(owner, spellReferences, icons);
		spells = spellState;
		const dialogOwner = new ClientDialogs(owner);
		dialogs = dialogOwner;
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
		const unbindItems = dialogOwner.bindItems(items);
		unrestrictedUse = false;
		const unsubscribeSelection = selection.subscribe((guid) => {
			selectedEntityGuid = guid;
			presentationSession?.setSelectedEntityGuid(guid);
		});
		const unsubscribeHover = pointer.subscribeHovered((guid) => {
			hoveredEntityGuid = guid;
			presentationSession?.setHoveredEntityGuid(guid);
		});
		const unsubscribePrecise = precise.subscribe((snapshot) => {
			if (preciseJumpActive !== snapshot.active)
				preciseJumpActive = snapshot.active;
			presentationSession?.setPreciseJumpMarker(snapshot.marker);
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
			inventoryOwner.destroy();
			containerOwner.destroy();
			worldContainer = null;
			inventory = null;
			icons.dispose();
			unbindItems();
			items.destroy();
			itemInteractions = null;
			dialogOwner.destroy();
			unsubscribeDialogs();
			dialogs = null;
			unsubscribeToast();
			unsubscribeInspection();
			inspectionOwner.destroy();
			if (objectInspectionOwner === inspectionOwner)
				objectInspectionOwner = null;
			objectInspection = { kind: "idle" };
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
			session = null;
			hostTransport = null;
		};
	});
</script>

<div
	class="client-font-scope"
	style:--ui-font-body={fontCss(userSettings.ui.fonts.body)}
	style:--ui-font-heading={fontCss(userSettings.ui.fonts.heading)}
	style:--ui-font-mono={fontCss(userSettings.ui.fonts.mono)}
>
	{#if dialogPresentation !== null}
		<ClientMessageDialog
			presentation={dialogPresentation}
			onDismiss={(id) => dialogs?.dismissPopup(id)}
			onRespond={(id, accepted) => {
				void dialogs?.respond(id, accepted);
			}}
		/>
	{/if}
	{#if !usesWorldPresentation}
		<ClientToastOverlay {toast} persistentMessage={null} />
	{/if}

	{#if usesWorldPresentation && startupError === null && commandFailure === null}
		<ClientWorldView
			itemSession={session}
			hudLayout={userSettings.hudLayout}
			onHudLayoutChange={(hudLayout) =>
				changeUserSettings({ ...userSettings, hudLayout })}
			spellBarShape={userSettings.spellBarShape}
			onSpellBarShapeChange={(spellBarShape) =>
				changeUserSettings({ ...userSettings, spellBarShape })}
			minimapViewDiameters={userSettings.minimapViewDiameters}
			onMinimapViewDiametersChange={(minimapViewDiameters) =>
				changeUserSettings({ ...userSettings, minimapViewDiameters })}
			chatFilters={userSettings.chatFilters}
			onChatFiltersChange={(chatFilters) =>
				changeUserSettings({ ...userSettings, chatFilters })}
			inspectionPreviewHeight={userSettings.inspection.previewHeight}
			graphics={userSettings.graphics}
			ui={userSettings.ui}
			input={userSettings.input}
			{textureFilteringCapabilities}
			onGraphicsChange={changeGraphics}
			onUiChange={changeUi}
			onInputChange={changeInput}
			onInspectionPreviewHeightChange={(previewHeight) =>
				changeUserSettings({
					...userSettings,
					inspection: { previewHeight },
				})}
			{hudMode}
			onHudModeChange={(mode) => (hudMode = mode)}
			{spellBar}
			onSpellBarChange={changeSpellBar}
			actionBars={characterSettings.kind === "ready"
				? characterSettings.settings.actionBars
				: null}
			onActionBarsChange={(actionBars) => {
				if (characterSettings.kind === "ready")
					changeCharacterSettings({
						...characterSettings.settings,
						actionBars,
					});
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
			onToggleCombat={() => void toggleCombatMode()}
			onCastSpell={(spellId) => void castSpell(spellId)}
			{entityMetadata}
			cameraController={lifecycle.kind === "in-world" ? cameraController : null}
			{debugEnabled}
			{readMinimapFrame}
			{readDiagnostics}
			{readSelectedEntity}
			{readFrameRates}
			{readTargetIndicatorFrame}
			{readSelectedEntityDisplay}
			{spells}
			{inventory}
			{worldContainer}
			{itemInteractions}
			{objectInspection}
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
			{appearanceOptions}
			onAppearanceOptionChange={setAppearanceOption}
			jumpChargeActive={activeJumpBeginSequence !== null}
			readJumpExtent={() => inputController?.chargeExtent() ?? 0}
			{toast}
			{preciseJumpActive}
			onPreciseJumpAim={aimPreciseJump}
			onPreciseJumpActivate={activatePreciseJump}
			onPreciseJumpEnter={enterPreciseJump}
			onInventoryNotice={(message) =>
				toastCenter.publish({ message, tone: "status" })}
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
			onSelectEntity={(guid) => entitySelection?.select(guid)}
			{chatMessages}
			onSendChat={sendChat}
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
		.client-font-scope {
			display: contents;
			font-family: var(--ui-font-body);
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
