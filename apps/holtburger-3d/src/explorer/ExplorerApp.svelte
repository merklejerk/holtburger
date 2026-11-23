<script lang="ts">
	import { onMount, untrack } from "svelte";
	import {
		retainRendererFailure,
		retainStartupFailure,
	} from "../app/desktop/app-failure-report";
	import { APP_PERSISTENCE_TUNING } from "../app/desktop/app-tuning";
	import { bindClientAudioForeground } from "../app/desktop/audio-foreground";
	import HudCornerControls from "../app/hud/HudCornerControls.svelte";
	import HudFpsCounter from "../app/hud/HudFpsCounter.svelte";
	import HudJumpPowerBar from "../app/hud/HudJumpPowerBar.svelte";
	import HudPanel from "../app/hud/HudPanel.svelte";
	import HudSelectedEntityBar, {
		type HudSelectedEntityAction,
	} from "../app/hud/HudSelectedEntityBar.svelte";
	import HudToastOverlay from "../app/hud/HudToastOverlay.svelte";
	import HudWindow from "../app/hud/HudWindow.svelte";
	import {
		anchorHudPlacement,
		logicalHudViewport,
		resolveHudSquarePlacement,
		type HudPlacement,
		type HudViewport,
	} from "../app/hud/hud-geometry";
	import { provideHudGeometry } from "../app/hud/hud-geometry-context";
	import {
		HUD_TOAST_DURATION_MS,
		HudToastCenter,
		type HudToast,
	} from "../app/hud/toast-center";
	import Minimap from "../app/minimap/Minimap.svelte";
	import { startPresentationFrameLoop } from "../app/performance/presentation-frame-loop";
	import DisplayConfirmation from "../app/settings/DisplayConfirmation.svelte";
	import { SettingsPersistence } from "../app/settings/settings-persistence";
	import { observeEntitySelectionColors } from "../app/theme/entity-selection-theme";
	import { uiFontCss } from "../app/theme/ui-fonts";
	import { applyUiScale } from "../app/theme/ui-scale";
	import type {
		UiThemeSelection,
		UiThemeSettings,
	} from "../app/theme/ui-theme-selection";
	import UiTooltipHost from "../app/ui/UiTooltipHost.svelte";
	import EntitiesIcon from "../assets/icons/explorer-entities.svg?component";
	import RendererIcon from "../assets/icons/explorer-renderer.svg?component";
	import WorldControlsIcon from "../assets/icons/explorer-world-controls.svg?component";
	import DebugIcon from "../assets/icons/hud-debug.svg?component";
	import ExamineIcon from "../assets/icons/hud-examine.svg?component";
	import SettingsIcon from "../assets/icons/hud-settings.svg?component";
	import WorldMapIcon from "../assets/icons/hud-world.svg?component";
	import { presentClientBinding } from "../client/settings/binding-catalog";
	import type {
		ClientAudioSettings,
		ClientGraphicsSettings,
		ClientUiSettings,
	} from "../client/settings/settings-contract";
	import type {
		ExplorerUserSettings,
		ExplorerUserSettingsPatch,
	} from "./settings/explorer-settings-sections";
	import type { ExplorerLaunchConfig } from "../launcher/launcher-contract";
	import { returnToLauncher } from "../app/desktop/launcher-navigation";
	import type { ActiveRegionSource } from "../lib/assets/active-region-source";
	import { hostWorldMapSource } from "../lib/assets/world-map-source";
	import type { SceneEnvironmentSelection } from "../lib/game/environment/scene-environment";
	import type { ExplorerCameraMode } from "../lib/game/motion/host-physical-fly-path";
	import type { FrameSettings } from "../lib/game/renderer/renderer";
	import type { TextureFilteringCapabilities } from "../lib/game/renderer/webgl2/texture-filtering-policy";
	import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
	import { GamePresentationOwner } from "../lib/game/runtime/game-presentation-owner";
	import { refineEntitySelectionCandidates } from "../lib/game/selection/entity-selection-intersection";
	import { samplePresentedCameraRay } from "../lib/game/selection/presented-camera-ray";
	import type { GamePresentationRuntime } from "../lib/game/runtime/game-presentation-runtime";
	import { HostPresentationAssets } from "../lib/game/runtime/host-presentation-assets";
	import type { SceneInterestTarget } from "../lib/game/runtime/scene-target";
	import type { SceneInterestRadii } from "../lib/game/runtime/types";
	import {
		createElectronHostTransport,
		registerElectronClientClose,
		requestElectronClientClose,
	} from "../lib/host/electron-host-transport";
	import type { WeenieCatalogCapability } from "../lib/host/weenie-catalog-capability";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { matchesKey } from "../lib/input/input-context";
	import type { ClientInputConfiguration } from "../lib/input/input-contract";
	import type { InputPlatform } from "../lib/input/input-platform";
	import {
		ExplorerCameraAuthorityController,
		type ExplorerSceneContext,
	} from "./camera/camera-authority";
	import { parseResidenceInput } from "./camera/world-input";
	import { ExplorerDynamicEntityController } from "./entities/dynamic-entity-controller";
	import {
		EMPTY_EXPLORER_SELECTION_STATUS,
		type ExplorerSelectionStatus,
	} from "./entities/entity-commands";
	import ExplorerEntitiesPanel from "./entities/ExplorerEntitiesPanel.svelte";
	import ExplorerEntityInspector from "./entities/ExplorerEntityInspector.svelte";
	import {
		ExplorerTransformGizmoController,
		type TransformGizmoCursor,
		type TransformGizmoTarget,
	} from "./gizmo/transform-gizmo-controller";
	import {
		cycleNearbyExplorerEntity,
		findExplorerEntityWearer,
		findSelectedExplorerEntity,
		isExplorerEntityWithinSceneInterest,
		type ExplorerEntityOperation,
		type ExplorerEntitySelection,
	} from "./entities/entity-panel-state";
	import type { ExplorerSceneInterestSnapshot } from "./camera/camera-coordinator";
	import type {
		ExplorerPossession,
		ExplorerPossessionControls,
	} from "./entities/entity-possession";
	import { EXPLORER_TUNING } from "./explorer-tuning";
	import { provideExplorerToastPublisher } from "./explorer-toast-context";
	import ExplorerShortcutDock from "./hud/ExplorerShortcutDock.svelte";
	import {
		createDefaultExplorerHudLayout,
		EXPLORER_HUD_MINIMUMS,
		type ExplorerWindowId,
	} from "./hud/explorer-hud-layout";
	import ExplorerDiagnosticsWindow from "./panels/ExplorerDiagnosticsWindow.svelte";
	import ExplorerNavigationWindow from "./panels/ExplorerNavigationWindow.svelte";
	import ExplorerSceneWindow from "./panels/ExplorerSceneWindow.svelte";
	import ExplorerSettingsPanel from "./panels/ExplorerSettingsPanel.svelte";
	import ExplorerVisualsWindow from "./panels/ExplorerVisualsWindow.svelte";
	import type {
		ExplorerHudPlacementKey,
		ExplorerInputSettings,
		ExplorerWorldSettings,
	} from "./settings/explorer-settings-contract";
	import {
		EXPLORER_INPUT_DEFAULTS,
		EXPLORER_LAUNCHER_DEFAULTS,
		EXPLORER_WORLD_DEFAULTS,
	} from "./settings/explorer-settings-defaults";
	import type { ExplorerSettingsTransport } from "./settings/explorer-settings-transport";
	import { ExplorerDisplayDiagnosticsController } from "./world/display-diagnostics";
	import { presentExplorerPortalFrame } from "./world/portal-presentation";

	interface Props {
		platform: InputPlatform;
		contentLocation: string;
		themeSelection: UiThemeSelection;
		initialUserSettings: ExplorerUserSettings;
		initialSettingsIssue: string | null;
		settingsTransport: ExplorerSettingsTransport;
		launchConfig: ExplorerLaunchConfig;
	}

	const {
		platform,
		contentLocation: _contentLocation,
		themeSelection,
		initialUserSettings,
		initialSettingsIssue,
		settingsTransport,
		launchConfig,
	}: Props = $props();

	provideHudGeometry();

	let userSettings = $state<ExplorerUserSettings>(
		untrack(() => initialUserSettings),
	);
	let screenRoot: HTMLDivElement | null = $state(null);
	let canvasElement: HTMLCanvasElement | null = $state(null);
	let viewport = $state<HudViewport>({
		width: typeof window === "undefined" ? 1280 : window.innerWidth,
		height: typeof window === "undefined" ? 720 : window.innerHeight,
	});
	const logicalViewport = $derived(
		logicalHudViewport(viewport, userSettings.ui.uiScale),
	);

	// Clean launch: floating windows start closed and are mutually exclusive (matching Client).
	let activePanel = $state<ExplorerWindowId | null>(null);
	let panelFocusRevision = $state(0);
	let inspectOpen = $state(false);
	let inspectFocusRevision = $state(0);
	let hudEditMode = $state(false);
	let hudHidden = $state(false);
	let cornerControls = $state<
		HudCornerControls<"launcher" | "quit"> | undefined
	>(undefined);
	const launcherEnabled =
		typeof window === "undefined" ||
		window.holtburgerLauncher?.enabled !== false;
	const explorerSystemMenuItems = $derived(
		launcherEnabled
			? ([
					{
						action: "launcher",
						label: "Back to Explorer Launcher",
						disabled: false,
					},
					{ action: "quit", label: "Quit application", disabled: false },
				] as const)
			: ([
					{ action: "quit", label: "Quit application", disabled: false },
				] as const),
	);
	let toast = $state<HudToast | null>(null);
	let audioForeground = true;
	let unmounted = false;

	const { viewport: inputGate, keyboard } = useAppInputPolicy();
	let releaseSceneInput: (() => void) | null = null;
	function setSceneInputBlocked(blocked: boolean): void {
		if (blocked) {
			if (releaseSceneInput === null) releaseSceneInput = inputGate.block();
		} else {
			releaseSceneInput?.();
			releaseSceneInput = null;
		}
	}
	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	const toastCenter = new HudToastCenter({
		durationMs: HUD_TOAST_DURATION_MS,
		scheduler: {
			schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
			cancel: (handle) => window.clearTimeout(handle),
		},
	});
	provideExplorerToastPublisher((input) => toastCenter.publish(input));

	function mergeExplorerSettingsPatch(
		pending: ExplorerUserSettingsPatch,
		next: ExplorerUserSettingsPatch,
	): ExplorerUserSettingsPatch {
		return {
			...(pending.sections !== undefined || next.sections !== undefined
				? { sections: { ...pending.sections, ...next.sections } }
				: {}),
			...(pending.explorerHudPlacements !== undefined ||
			next.explorerHudPlacements !== undefined
				? {
						explorerHudPlacements: {
							...pending.explorerHudPlacements,
							...next.explorerHudPlacements,
						},
					}
				: {}),
		};
	}

	const settingsPersistence =
		new SettingsPersistence<ExplorerUserSettingsPatch>({
			delayMs: APP_PERSISTENCE_TUNING.windowGeometryWriteDelayMs,
			save: (patch) => settingsTransport.saveUserPatch(patch),
			report: (error) => {
				console.error("Explorer settings save failed.", error);
				toastCenter.publish({
					message: `Settings save failed: ${errorMessage(error)}`,
					tone: "warning",
				});
			},
			merge: mergeExplorerSettingsPatch,
		});

	function publishSectionPatch(
		sections: NonNullable<ExplorerUserSettingsPatch["sections"]>,
	): void {
		userSettings = { ...userSettings, ...sections };
		settingsPersistence.publish({ sections });
	}

	function updateHudPlacement(
		key: ExplorerHudPlacementKey,
		placement: HudPlacement,
	): void {
		userSettings = {
			...userSettings,
			explorerHudLayout: {
				...userSettings.explorerHudLayout,
				[key]: placement,
			},
		};
		settingsPersistence.publish({
			explorerHudPlacements: { [key]: placement },
		});
	}

	function syncAudioOutput(): void {
		const audio = userSettings.audio;
		const audible = !audio.muted && (audio.playInBackground || audioForeground);
		presentationOwner?.setOutputVolume(audible ? audio.masterVolume : 0);
		gameRuntime?.setAudioSettings({
			effectVolume: audio.effectVolume,
			ambientVolume: audio.ambientVolume,
		});
	}

	function buildFrameSettings(g: ClientGraphicsSettings): FrameSettings {
		return {
			...EXPLORER_TUNING.frameSettings,
			sealedInteriorAmbientLevel: g.sealedInteriorAmbientLevel,
			ambientOcclusion: {
				...EXPLORER_TUNING.frameSettings.ambientOcclusion,
				enabled: g.ambientOcclusionEnabled,
			},
			entityShadows: {
				...EXPLORER_TUNING.frameSettings.entityShadows,
				mode: g.entityShadowMode,
			},
			weatherEnabled: g.weatherEnabled,
			quality: {
				...EXPLORER_TUNING.frameSettings.quality,
				renderScale: g.renderScale,
				textureFiltering: g.textureFiltering,
			},
		};
	}

	function handleGraphicsChange(graphics: ClientGraphicsSettings): void {
		publishSectionPatch({ graphics });
		cameraAuthority.setVerticalFovDegrees(graphics.verticalFovDegrees);
		displayDiagnostics.updateSealedInteriorAmbientLevel(
			graphics.sealedInteriorAmbientLevel,
		);
		displayDiagnostics.updateAmbientOcclusionSettings({
			...frameSettings.ambientOcclusion,
			enabled: graphics.ambientOcclusionEnabled,
		});
		displayDiagnostics.updateEntityShadowSettings({
			...frameSettings.entityShadows,
			mode: graphics.entityShadowMode,
		});
		displayDiagnostics.updateTextureFiltering(graphics.textureFiltering);
		displayDiagnostics.updateRenderScale(graphics.renderScale);
		displayDiagnostics.updateWeather(graphics.weatherEnabled);
	}

	function persistExplorerWorld(patch: Partial<ExplorerWorldSettings>): void {
		const next: ExplorerWorldSettings = {
			...userSettings.explorerWorld,
			...patch,
		};
		publishSectionPatch({ explorerWorld: next });
	}

	function handleUiChange(ui: ClientUiSettings): void {
		publishSectionPatch({ ui });
	}

	function handleAudioChange(audio: ClientAudioSettings): void {
		publishSectionPatch({ audio });
		syncAudioOutput();
	}

	function syncCameraInputSettings(
		input: ClientInputConfiguration,
		explorerInput: ExplorerInputSettings,
	): void {
		cameraAuthority.applyInputSettings({
			flyBindings: explorerInput.fly,
			characterBindings: input.character,
			autoRunBindings: input.client.toggleAutoRun,
			mouseConfig: {
				mouseMovement: input.mouseMovement,
				invertCameraHorizontal: input.invertCameraHorizontal,
				invertCameraVertical: input.invertCameraVertical,
				invertSteeringHorizontal: input.invertSteeringHorizontal,
				invertSteeringVertical: input.invertSteeringVertical,
			},
			flyMouseConfig: {
				invertFlyHorizontal: explorerInput.invertFlyHorizontal,
				invertFlyVertical: explorerInput.invertFlyVertical,
			},
		});
	}

	function handleInputChange(input: ClientInputConfiguration): void {
		publishSectionPatch({ input });
		syncCameraInputSettings(input, userSettings.explorerInput);
	}

	function handleExplorerInputChange(
		explorerInput: ExplorerInputSettings,
	): void {
		publishSectionPatch({ explorerInput });
		syncCameraInputSettings(userSettings.input, explorerInput);
	}

	const themeSettings: UiThemeSettings = {
		owner: untrack(() => themeSelection),
		select: async (themeId) => {
			if (await themeSelection.select(themeId)) {
				handleUiChange({ ...userSettings.ui, themeId });
			}
		},
	};

	const toggleHudHint = $derived.by(() => {
		const first = userSettings.explorerInput.toggleHud[0];
		if (first === undefined) return "Unbound";
		const parts: string[] = [];
		if (first.ctrl) parts.push("Ctrl");
		if (first.shift) parts.push("Shift");
		if (first.alt) parts.push("Alt");
		if (first.meta) parts.push("Meta");
		const keyLabel =
			"code" in first && first.code !== undefined
				? first.code
				: "key" in first && first.key !== undefined
					? first.key
					: "?";
		parts.push(keyLabel.toUpperCase());
		return parts.join("+");
	});

	function setHudHidden(hidden: boolean): void {
		if (hudHidden === hidden) return;
		if (hidden) cameraAuthority.cancelPrimaryDrag();
		hudHidden = hidden;
		gizmoController.syncVisual();
		if (hidden) {
			toastCenter.publish({
				message: `Press ${toggleHudHint} (or Esc) to reveal the UI.`,
				tone: "status",
			});
		}
	}

	function notifyAutoRunChanged(enabled: boolean): void {
		toastCenter.publish({
			message: enabled ? "Auto-run enabled." : "Auto-run disabled.",
			tone: "status",
		});
	}

	function toggleWindow(id: ExplorerWindowId): void {
		if (activePanel === id) {
			activePanel = null;
			return;
		}
		activePanel = id;
		panelFocusRevision += 1;
	}

	function resetHudLayout(): void {
		const layout = createDefaultExplorerHudLayout();
		userSettings = { ...userSettings, explorerHudLayout: layout };
		settingsPersistence.publish({ explorerHudPlacements: layout });
		toastCenter.publish({
			message: "Explorer HUD layout reset.",
			tone: "status",
		});
	}

	function resetExplorerDefaults(): void {
		const layout = createDefaultExplorerHudLayout();
		const resetPayload = {
			explorerWorld: EXPLORER_WORLD_DEFAULTS,
			explorerInput: EXPLORER_INPUT_DEFAULTS,
			explorerHudLayout: layout,
		};
		userSettings = { ...userSettings, ...resetPayload };
		cameraAuthority.setFlySpeed(EXPLORER_WORLD_DEFAULTS.flySpeed);
		interestFollowsCamera = EXPLORER_WORLD_DEFAULTS.interestFollowsCamera;
		cameraAuthority.setInterestFollowsCamera(interestFollowsCamera);
		audioFollowsCamera = EXPLORER_WORLD_DEFAULTS.audioFollowsCamera;
		cameraAuthority.setAudioFollowsCamera(audioFollowsCamera);
		cameraAuthority.updateSceneInterestRadii(EXPLORER_WORLD_DEFAULTS.radii);
		syncCameraInputSettings(userSettings.input, EXPLORER_INPUT_DEFAULTS);
		void settingsPersistence
			.flush()
			.catch(() => undefined)
			.then(() => settingsTransport.resetExplorer(resetPayload))
			.then(() => {
				if (!unmounted) {
					toastCenter.publish({
						message: "Explorer defaults restored.",
						tone: "status",
					});
				}
			})
			.catch((error) => {
				if (!unmounted) {
					toastCenter.publish({
						message: `Reset failed: ${errorMessage(error)}`,
						tone: "warning",
					});
				}
			});
	}

	let presentationOwner: GamePresentationOwner | undefined;
	let gameRuntime: GamePresentationRuntime | undefined;
	const hostTransport = createElectronHostTransport();
	const worldMapSource = hostWorldMapSource(hostTransport);

	let startupError: string | null = $state(null);
	let runtimeReady = $state(false);
	let activeRegion = $state<ActiveRegionSource | undefined>(undefined);
	let textureFilteringCapabilities =
		$state<TextureFilteringCapabilities | null>(null);

	let cameraResidencyLabel = $state<string | null>(null);
	let sceneContext = $state<ExplorerSceneContext | null>(null);
	let cameraMode = $state<ExplorerCameraMode>("free-fly");
	let cameraModePending = $state(false);
	let lastPhysicalCameraError: string | null = null;
	let interestFollowsCamera = $state(
		untrack(() => initialUserSettings.explorerWorld.interestFollowsCamera),
	);
	let audioFollowsCamera = $state(
		untrack(() => initialUserSettings.explorerWorld.audioFollowsCamera),
	);

	let entityCatalog = $state<WeenieCatalogCapability | null>(null);
	let spawnedEntities = $state.raw<readonly DynamicEntityView[]>([]);
	let lastSpawnedEntityPresentationError: string | null = null;
	let explorerPossession = $state<ExplorerPossession | null>(null);
	let possessedControls = $state<ExplorerPossessionControls | null>(null);
	let selectedExplorerEntity = $state<ExplorerEntitySelection | null>(null);
	let selectionStatus = $state<ExplorerSelectionStatus>(
		EMPTY_EXPLORER_SELECTION_STATUS,
	);
	let gizmoCursor = $state<TransformGizmoCursor>(null);
	let entityPending = $state<ExplorerEntityOperation | null>(null);
	let runRateRequestSerial = 0;
	let jumpChargeActive = $state(false);

	const selectedEntity = $derived(
		findSelectedExplorerEntity(spawnedEntities, selectedExplorerEntity),
	);
	const selectedEntityWearer = $derived(
		findExplorerEntityWearer(spawnedEntities, selectedEntity),
	);
	const possessedSelection = $derived.by((): ExplorerEntitySelection | null => {
		if (explorerPossession === null || explorerPossession.guid === null) {
			return null;
		}
		return {
			guid: explorerPossession.guid,
			generation: explorerPossession.entityGeneration,
		};
	});
	const examineBindingDescription = $derived(
		presentClientBinding(
			userSettings.input,
			{ kind: "client", action: "examine" },
			platform,
		).description,
	);

	function openInspectWindow(): void {
		if (selectedEntity === null) return;
		inspectOpen = true;
		inspectFocusRevision += 1;
	}

	function reportPhysicalCameraError(error: string | null): void {
		if (error === lastPhysicalCameraError) return;
		lastPhysicalCameraError = error;
		if (error !== null) {
			toastCenter.publish({
				message: `Physical camera failed: ${error}`,
				tone: "warning",
			});
		}
	}

	function reportSpawnedEntityPresentationError(error: string | null): void {
		if (error === lastSpawnedEntityPresentationError) return;
		lastSpawnedEntityPresentationError = error;
		if (error !== null) {
			toastCenter.publish({ message: error, tone: "warning" });
		}
	}

	async function performEntityOperation(
		operation: ExplorerEntityOperation,
		action: () => Promise<unknown>,
	): Promise<void> {
		if (entityPending !== null) return;
		entityPending = operation;
		try {
			await action();
		} catch (error) {
			toastCenter.publish({ message: errorMessage(error), tone: "warning" });
		} finally {
			entityPending = null;
		}
	}

	function runEntitySpawn(wcid: number, distance: number): Promise<void> {
		return performEntityOperation({ kind: "spawn" }, async () => {
			const spawned = await entityController.spawnExplorerEntity(
				wcid,
				distance,
			);
			selectExplorerEntity(spawned);
		});
	}

	function runEntityDespawn(entity: DynamicEntityView): Promise<void> {
		return performEntityOperation(
			{
				kind: "despawn",
				target: { guid: entity.identity.guid, generation: entity.generation },
			},
			() => entityController.despawnExplorerEntity(entity),
		);
	}

	function runEntityResetAll(): Promise<void> {
		return performEntityOperation({ kind: "reset-all" }, () =>
			entityController.resetAllEntities(),
		);
	}

	function runEntityRelocate(entity: DynamicEntityView): Promise<void> {
		return performEntityOperation(
			{
				kind: "relocate",
				target: { guid: entity.identity.guid, generation: entity.generation },
			},
			() => entityController.relocateExplorerEntity(entity),
		);
	}

	function runEntityLaunch(entity: DynamicEntityView): Promise<void> {
		return performEntityOperation(
			{
				kind: "launch",
				target: { guid: entity.identity.guid, generation: entity.generation },
			},
			async () => {
				const result = await entityController.launchExplorerEntity(entity);
				if (result.queued) {
					toastCenter.publish({
						message: "Launch queued — deselect to fire.",
						tone: "status",
					});
				}
			},
		);
	}

	function runEntityReplacePhysicsState(
		entity: DynamicEntityView,
		flags: DynamicEntityView["physics"]["flags"],
		physicalMode: "pose-only" | "integrated",
	): Promise<void> {
		return performEntityOperation(
			{
				kind: "physics-state",
				target: { guid: entity.identity.guid, generation: entity.generation },
			},
			() =>
				entityController.replaceExplorerEntityPhysicsState(
					entity,
					flags,
					physicalMode,
				),
		);
	}

	function runEntityPossession(
		entity: DynamicEntityView,
		guid: number | null,
	): Promise<void> {
		return performEntityOperation(
			{
				kind: "possession",
				target: { guid: entity.identity.guid, generation: entity.generation },
			},
			() => entityController.possessExplorerEntity(guid),
		);
	}

	function runReleasePossession(): Promise<void> {
		if (possessedSelection === null) return Promise.resolve();
		return performEntityOperation(
			{
				kind: "possession",
				target: possessedSelection,
			},
			() => entityController.possessExplorerEntity(null),
		);
	}

	function runEntityStance(
		entity: DynamicEntityView,
		style: number,
	): Promise<void> {
		return performEntityOperation(
			{
				kind: "stance",
				target: { guid: entity.identity.guid, generation: entity.generation },
			},
			() => entityController.setExplorerEntityStance(style),
		);
	}

	async function runEntityRunRate(value: number): Promise<void> {
		const serial = ++runRateRequestSerial;
		try {
			await entityController.setExplorerEntityRunRate(value);
		} catch (error) {
			if (serial === runRateRequestSerial) {
				toastCenter.publish({ message: errorMessage(error), tone: "warning" });
			}
		}
	}

	const selectedEntityHudActions = $derived.by(
		(): readonly HudSelectedEntityAction[] => {
			if (
				selectedEntity === null ||
				selectedEntity.placement.kind !== "world"
			) {
				return [];
			}
			const entity = selectedEntity;
			const isPossessed =
				explorerPossession !== null &&
				explorerPossession.guid === entity.identity.guid &&
				explorerPossession.entityGeneration === entity.generation;
			const busy = !runtimeReady || entityPending !== null;
			const actions: HudSelectedEntityAction[] = [];
			if (entity.presentation.content.motionTableDid !== null) {
				actions.push({
					action: "possess",
					label: isPossessed ? "Release possession" : "Possess",
					disabled: busy,
					activate: () =>
						void runEntityPossession(
							entity,
							isPossessed ? null : entity.identity.guid,
						),
				});
			}
			actions.push(
				{
					action: "relocate",
					label: "Move to camera",
					disabled: busy,
					activate: () => void runEntityRelocate(entity),
				},
				{
					action: "launch",
					label:
						!isPossessed && selectionStatus.launchQueued
							? "Launch queued"
							: "Launch",
					disabled: busy,
					activate: () => void runEntityLaunch(entity),
				},
				{
					action: "despawn",
					label: "Despawn",
					disabled: busy,
					activate: () => void runEntityDespawn(entity),
				},
			);
			return actions;
		},
	);

	const autoDespawningEntities = new Set<string>();

	function pruneOutOfInterestEntities(
		interest: ExplorerSceneInterestSnapshot | null,
	): void {
		if (interest === null || spawnedEntities.length === 0) return;
		for (const entity of spawnedEntities) {
			if (entity.placement.kind !== "world") continue;
			if (isExplorerEntityWithinSceneInterest(entity, interest)) continue;
			const key = `${entity.identity.guid}:${entity.generation}`;
			if (autoDespawningEntities.has(key)) continue;
			autoDespawningEntities.add(key);
			void entityController
				.despawnExplorerEntity(entity)
				.catch((error: unknown) => {
					console.error(
						"Failed to auto-despawn out-of-interest entity.",
						error,
					);
				})
				.finally(() => {
					autoDespawningEntities.delete(key);
				});
		}
	}

	function cycleNearbyEntity(direction: 1 | -1): void {
		const next = cycleNearbyExplorerEntity(
			spawnedEntities,
			selectedExplorerEntity,
			explorerPossession?.guid ?? null,
			cameraAuthority.cameraLocation?.position ?? null,
			direction,
			EXPLORER_TUNING.entities.tabTargetMaxDistanceMeters,
		);
		if (next !== null) selectExplorerEntity(next);
	}

	let environmentSelection = $state<SceneEnvironmentSelection>({
		dayIndex: EXPLORER_TUNING.environment.defaultDayIndex,
		timeOfDay: EXPLORER_TUNING.environment.defaultTimeOfDay,
		dayGroupOverride: EXPLORER_TUNING.environment.defaultDayGroupOverride,
	});
	let clockFollowing = $state(false);
	let frameSettings = $state<FrameSettings>(
		untrack(() => buildFrameSettings(initialUserSettings.graphics)),
	);

	const minimapRect = $derived(
		resolveHudSquarePlacement(
			userSettings.explorerHudLayout.minimap,
			logicalViewport,
			EXPLORER_HUD_MINIMUMS.minimap.width,
		),
	);
	const minimapViewState = $derived({
		left: minimapRect.left,
		top: minimapRect.top,
		size: minimapRect.width,
		viewDiameters: userSettings.explorerWorld.minimapViewDiameters,
	});

	function selectExplorerEntity(
		selection: ExplorerEntitySelection | null,
	): void {
		const changed =
			selectedExplorerEntity?.guid !== selection?.guid ||
			selectedExplorerEntity?.generation !== selection?.generation;
		if (changed) {
			cameraAuthority.cancelPrimaryDrag();
			selectionStatus = EMPTY_EXPLORER_SELECTION_STATUS;
		}
		selectedExplorerEntity = selection;
		if (selection === null) inspectOpen = false;
		gameRuntime?.setSelectedEntityGuid(selection?.guid ?? null);
		if (changed) {
			void entityController.setSelectedExplorerEntity(selection);
		}
		gizmoController.syncVisual();
	}

	function selectMinimapEntity(guid: number | null): void {
		const entity =
			guid === null
				? null
				: spawnedEntities.find((candidate) => candidate.identity.guid === guid);
		selectExplorerEntity(
			entity
				? { guid: entity.identity.guid, generation: entity.generation }
				: null,
		);
	}

	function pickViewportEntity(
		clientX: number,
		clientY: number,
	):
		| { readonly kind: "unavailable" }
		| { readonly kind: "empty" }
		| { readonly kind: "entity"; readonly guid: number } {
		const runtime = gameRuntime;
		const canvas = canvasElement;
		const view = cameraAuthority.lastPrimaryView();
		if (runtime === undefined || canvas === null || view === null) {
			return { kind: "unavailable" };
		}
		if (spawnedEntities.length === 0) return { kind: "empty" };
		const sampled = samplePresentedCameraRay(view, canvas, clientX, clientY);
		if (sampled === null) return { kind: "unavailable" };
		const candidateGuids = spawnedEntities.map(
			(entity) => entity.identity.guid,
		);
		const guid = refineEntitySelectionCandidates(
			runtime,
			sampled.refinement,
			candidateGuids,
			view.camera.far,
		).selectedGuid;
		return guid === null ? { kind: "empty" } : { kind: "entity", guid };
	}

	function handleViewportClick(clientX: number, clientY: number): void {
		const picked = pickViewportEntity(clientX, clientY);
		if (picked.kind === "unavailable") return;
		selectMinimapEntity(picked.kind === "entity" ? picked.guid : null);
	}

	function handleViewportSecondaryClick(
		clientX: number,
		clientY: number,
	): void {
		const picked = pickViewportEntity(clientX, clientY);
		if (picked.kind !== "entity") return;
		selectMinimapEntity(picked.guid);
		openInspectWindow();
	}

	const gizmoController = new ExplorerTransformGizmoController({
		readTarget: (): TransformGizmoTarget | null => {
			if (hudHidden || selectedExplorerEntity === null) return null;
			if (
				explorerPossession !== null &&
				explorerPossession.guid === selectedExplorerEntity.guid &&
				explorerPossession.entityGeneration ===
					selectedExplorerEntity.generation
			) {
				return null;
			}
			const live = entityController.readExplorerEntity(selectedExplorerEntity);
			if (live === null || live.placement.kind !== "world") return null;
			return {
				guid: live.identity.guid,
				generation: live.generation,
				pose: live.placement.pose,
			};
		},
		readPrimaryView: () => cameraAuthority.lastPrimaryView(),
		readCanvas: () => canvasElement,
		setVisual: (visual) => gameRuntime?.setTransformGizmo(visual),
		onTransformPose: (guid, generation, pose) => {
			entityController.scheduleEntityTransform(guid, generation, pose);
		},
		onCancelTransform: (guid, generation, revertPose) => {
			entityController.scheduleEntityTransform(guid, generation, revertPose);
		},
		onCursorChange: (cursor) => {
			gizmoCursor = cursor;
		},
	});

	const cameraAuthority: ExplorerCameraAuthorityController =
		new ExplorerCameraAuthorityController({
			hostTransport,
			isRuntimeReady: () => runtimeReady,
			hasPossession: () => entityController.hasPossession(),
			hasPossessionInput: () => entityController.hasPossessionInput(),
			readPossessionOwnership: () => entityController.readPossessionOwnership(),
			readPossessedEntityFacingCameraYaw: () =>
				entityController.possessedEntityFacingCameraYaw(),
			onCharacterInput: (input) =>
				entityController.handleCameraCharacterInput(input),
			onPossessionForward: (source, down) =>
				entityController.applyPossessionForward(source, down),
			onPossessionToggleAutoRun: () =>
				entityController.togglePossessionAutoRun(),
			onPossessionTurn: (deltaRadians) =>
				entityController.applyPossessionTurn(deltaRadians),
			onPossessionCancelTurn: () => entityController.cancelPossessionTurn(),
			onFlyAutoRunChange: notifyAutoRunChanged,
			onViewportClick: handleViewportClick,
			onViewportSecondaryClick: handleViewportSecondaryClick,
			primaryPointerOverlay: {
				onHover: (clientX, clientY) => {
					gizmoController.handlePointerHover(clientX, clientY);
				},
				onHoverLeave: () => {
					gizmoController.clearHover();
				},
				tryBeginDrag: (clientX, clientY) =>
					gizmoController.tryBeginDrag(clientX, clientY),
				onDragMove: (clientX, clientY, shiftKey) => {
					gizmoController.updateDrag(clientX, clientY, shiftKey);
				},
				onDragEnd: (commit) => {
					gizmoController.endDrag(commit);
				},
			},
			onReleasePossession: () => entityController.possessExplorerEntity(null),
			onCameraFocusStatusChange: (status) => {
				if (
					status !== null &&
					/(failed|unavailable|ambiguous|missing)/i.test(status)
				) {
					toastCenter.publish({ message: status, tone: "warning" });
				}
			},
			onCameraResidencyLabelChange: (label) => {
				cameraResidencyLabel = label;
			},
			onSceneContextChange: (context) => {
				sceneContext = context;
			},
			onSceneInterestChange: (interest) => {
				pruneOutOfInterestEntities(interest);
			},
			onCameraModeChange: (mode) => {
				cameraMode = mode;
			},
			onCameraModePendingChange: (pending) => {
				cameraModePending = pending;
			},
			onPhysicalCameraErrorChange: reportPhysicalCameraError,
			onSceneInputBlockedChange: setSceneInputBlocked,
		});

	const entityController: ExplorerDynamicEntityController =
		new ExplorerDynamicEntityController({
			hostTransport,
			isActivationReady: () => cameraAuthority.activationReady(),
			hasPresentedCameraPlacement: () =>
				cameraAuthority.presentedPlacement() !== null,
			resolveSpawnAuthority: () => cameraAuthority.resolveSpawnAuthority(),
			onBeginPossessionCamera: (possession) =>
				cameraAuthority.beginBoomCamera(possession),
			onEndPossessionCamera: () => cameraAuthority.endBoomCamera(),
			onSetPossessedControlScheme: () =>
				cameraAuthority.setPossessedControlScheme(),
			onRestoreNonPossessionControlScheme: () =>
				cameraAuthority.restoreNonPossessionControlScheme(),
			onBoomFrame: (boom, durationMs, receivedAtMs) =>
				cameraAuthority.receiveBoomFrame(boom, durationMs, receivedAtMs),
			onBoomTranslationIntent: (active, nowMs) =>
				cameraAuthority.setBoomTranslationIntent(active, nowMs),
			onPhysicalCameraError: reportPhysicalCameraError,
			onEntityCatalogChange: (catalog) => {
				entityCatalog = catalog;
			},
			onSpawnedEntitiesChange: (entities) => {
				spawnedEntities = entities;
			},
			onSpawnedEntityPresentationErrorChange:
				reportSpawnedEntityPresentationError,
			onExplorerPossessionChange: (possession) => {
				explorerPossession = possession;
			},
			onPossessedControlsChange: (controls) => {
				possessedControls = controls;
			},
			readSelectedEntity: () => selectedExplorerEntity,
			onClearSelectedEntity: () => selectExplorerEntity(null),
			onSelectionStatusChange: (status) => {
				selectionStatus = status;
			},
			onJumpChargeActiveChange: (active) => {
				jumpChargeActive = active;
			},
			onAutoRunChange: notifyAutoRunChanged,
		});

	const displayDiagnostics = new ExplorerDisplayDiagnosticsController({
		initialFrameSettings: untrack(() => frameSettings),
		isRuntimeReady: () => runtimeReady,
		readCameraLocation: () => cameraAuthority.cameraLocation,
		readCameraYawRadians: () => cameraAuthority.cameraYawRadians,
		readCameraSnapshot: () => cameraAuthority.cameraSnapshotState(),
		readSceneInterest: () => cameraAuthority.sceneInterestSnapshot(),
		readPossessedGuid: () => entityController.readPossessedGuid(),
		readPossessedPlacement: () => entityController.possessedPlacement,
		readSelectedEntityGuid: () => selectedExplorerEntity?.guid ?? null,
		onFrameSettingsChange: (settings) => {
			frameSettings = settings;
		},
		onEnvironmentSelectionChange: (selection) => {
			environmentSelection = selection;
		},
		onClockFollowingChange: (enabled) => {
			clockFollowing = enabled;
		},
	});

	function observeSelectionTheme(element: HTMLElement) {
		return observeEntitySelectionColors(element, (colors) => {
			displayDiagnostics.updateEntitySelectionColors(colors);
		});
	}

	function jumpToWorldMapTarget(
		target: SceneInterestTarget,
		label: string,
	): void {
		if (!runtimeReady) return;
		cameraAuthority.requestSceneInterest(
			target,
			userSettings.explorerWorld.radii,
		);
		toastCenter.publish({ message: `Jumped to ${label}`, tone: "status" });
	}

	onMount(() => {
		const canvas = canvasElement;
		if (canvas === null) {
			startupError = "Explorer canvas was not mounted.";
			return;
		}

		const unsubscribeToast = toastCenter.subscribe((next) => {
			toast = next;
		});
		if (initialSettingsIssue !== null) {
			toastCenter.publish({ message: initialSettingsIssue, tone: "warning" });
		}

		const handleResize = () => {
			viewport = { width: window.innerWidth, height: window.innerHeight };
		};
		window.addEventListener("resize", handleResize);

		const handleShortcuts = (event: KeyboardEvent) => {
			if (event.repeat) return;
			if (matchesKey(event, userSettings.explorerInput.toggleHud)) {
				event.preventDefault();
				setHudHidden(!hudHidden);
				return;
			}
			if (
				event.key === "Tab" &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.metaKey
			) {
				event.preventDefault();
				cycleNearbyEntity(event.shiftKey ? -1 : 1);
				return;
			}
			if (
				selectedEntity !== null &&
				matchesKey(event, userSettings.input.client.examine)
			) {
				event.preventDefault();
				openInspectWindow();
				return;
			}
			if (event.key === "Escape" && !event.defaultPrevented) {
				if (cameraAuthority.cancelPrimaryDrag()) {
					event.preventDefault();
				} else if (hudHidden) {
					event.preventDefault();
					setHudHidden(false);
				} else if (hudEditMode) {
					event.preventDefault();
					hudEditMode = false;
				} else if (selectedExplorerEntity !== null) {
					event.preventDefault();
					selectExplorerEntity(null);
				} else {
					event.preventDefault();
					cornerControls?.show();
				}
			}
		};
		const unbindShortcuts = keyboard.bindShortcuts(handleShortcuts);

		let destroyed = false;
		let teardown: Promise<void> | undefined;
		const presentationAssets = new HostPresentationAssets(hostTransport);
		const construction = new AbortController();
		let stopFrameLoop: (() => void) | null = null;

		const destroySystems = (): Promise<void> => {
			if (teardown) return teardown;
			const presentation = presentationOwner;
			gameRuntime = undefined;
			runtimeReady = false;
			presentationOwner = undefined;
			textureFilteringCapabilities = null;
			activeRegion = undefined;
			displayDiagnostics.detach();
			gizmoController.reset();
			entityController.detach();
			teardown = (async () => {
				stopFrameLoop?.();
				setSceneInputBlocked(false);
				try {
					await cameraAuthority.detach();
				} finally {
					try {
						await presentation?.destroy();
					} finally {
						await presentationAssets.destroy();
					}
				}
			})();
			return teardown;
		};

		const start = async (): Promise<void> => {
			try {
				await entityController.start();
				if (destroyed) return;
				const presentation = await GamePresentationOwner.build({
					onRendererFailure: retainRendererFailure,
					canvas,
					hostTransport,
					presentationResources: await presentationAssets.resources(),
					signal: construction.signal,
					frameSettings: untrack(() =>
						displayDiagnostics.readFrameSettingsSnapshot(),
					),
					portalWarpDriveTuning: EXPLORER_TUNING.portalTransition.visual,
					audioTuning: {
						placementSmoothingSeconds:
							EXPLORER_TUNING.audio.placementSmoothingSeconds,
						loudnessCurveExponent: EXPLORER_TUNING.audio.loudnessCurveExponent,
					},
				});
				presentationOwner = presentation;
				activeRegion = presentation.activeRegion;
				gameRuntime = presentation.runtime;
				textureFilteringCapabilities =
					presentation.textureFilteringCapabilities;
				if (destroyed) return;
				displayDiagnostics.attachRuntime({ presentation, canvas });
				syncAudioOutput();
				cameraAuthority.attachRuntime({
					canvas,
					gameRuntime: presentation.runtime,
					profileSource: presentation.profileSource,
					inputGate,
					keyboard,
				});
				cameraAuthority.setVerticalFovDegrees(
					userSettings.graphics.verticalFovDegrees,
				);
				cameraAuthority.setFlySpeed(userSettings.explorerWorld.flySpeed);
				cameraAuthority.setInterestFollowsCamera(interestFollowsCamera);
				cameraAuthority.setAudioFollowsCamera(audioFollowsCamera);
				syncCameraInputSettings(userSettings.input, userSettings.explorerInput);
				entityController.attachRuntime(presentation.runtime);
				runtimeReady = true;

				const initialLocation =
					launchConfig.initialLocation ??
					EXPLORER_LAUNCHER_DEFAULTS.initialLocation;
				if (initialLocation !== null) {
					const parsed = parseResidenceInput(initialLocation);
					if (parsed !== null) {
						cameraAuthority.requestSceneInterest(
							parsed.target,
							userSettings.explorerWorld.radii,
						);
					}
				}

				const step = (animationFrameTimeMs: number): void => {
					if (gameRuntime === undefined) return;

					const tickStartedAt = performance.now();
					const physicalPlacement = cameraAuthority.pollPhysicalCamera();
					gameRuntime.tick(tickStartedAt);
					cameraAuthority.pollSceneActivation();
					const staticActivationReady = cameraAuthority.activationReady();
					const activationPending = cameraAuthority.activationPending();
					entityController.syncSceneActivationConvergence(
						activationPending,
						staticActivationReady,
					);
					setSceneInputBlocked(activationPending);
					const residencySync = cameraAuthority.syncFrameCamera(
						physicalPlacement,
						gameRuntime,
						canvas,
						tickStartedAt,
					);
					displayDiagnostics.setForcedFlatEnvCellRenderMode(
						residencySync.requiresFlatEnvCellRenderMode,
					);
					entityController.syncPossessedPlacement(gameRuntime);
					gizmoController.syncVisual();
					const updateAndDrawStartedAt = performance.now();
					const activationReady =
						staticActivationReady &&
						entityController.isActivationPresentationReady();
					const activeCameraCoordinator = cameraAuthority.cameraCoordinator;
					if (activeCameraCoordinator === undefined) {
						throw new Error(
							"Explorer camera coordinator is unavailable during portal presentation.",
						);
					}
					const reveal = presentExplorerPortalFrame({
						activationReady,
						coordinator: activeCameraCoordinator,
						extent: gameRuntime.resolveViewportExtent(
							canvas.clientWidth,
							canvas.clientHeight,
						),
						nowMs: tickStartedAt,
						runtime: gameRuntime,
						worldRenderable:
							residencySync.renderable &&
							(!activationPending || activationReady),
					});
					if (reveal !== null) {
						activeCameraCoordinator.completeSceneActivation();
						entityController.clearActivationConvergence();
						setSceneInputBlocked(false);
					}
					const frameFinishedAt = performance.now();
					displayDiagnostics.recordFrameSample(
						animationFrameTimeMs,
						tickStartedAt,
						updateAndDrawStartedAt,
						frameFinishedAt,
					);
				};

				stopFrameLoop = startPresentationFrameLoop(step, () => 0);
			} catch (error) {
				if (!destroyed) {
					retainStartupFailure(error);
					startupError = errorMessage(error);
				}
				await destroySystems();
			}
		};

		const stopAudioForeground = bindClientAudioForeground((foreground) => {
			audioForeground = foreground;
			syncAudioOutput();
		}, window);

		const startup = start();

		const shutdown = async () => {
			destroyed = true;
			unmounted = true;
			construction.abort();
			stopAudioForeground();
			window.removeEventListener("resize", handleResize);
			unbindShortcuts();
			displayDiagnostics.stopClockTimer();
			await startup.catch(() => undefined);
			await settingsPersistence.flush().catch(() => undefined);
			await themeSelection.retire();
			await destroySystems();
			unsubscribeToast();
			toastCenter.destroy();
		};
		const unregisterClose = registerElectronClientClose(async () => {
			try {
				await shutdown();
				return { kind: "prepared" };
			} catch (error) {
				return { kind: "failed", diagnostic: errorMessage(error) };
			}
		});

		return () => {
			unregisterClose();
			void shutdown().catch((error: unknown) =>
				console.error("Failed to shut down explorer systems.", error),
			);
		};
	});
</script>

<div
	bind:this={screenRoot}
	class="explorer-screen ui-theme"
	use:observeSelectionTheme
	style:--ui-text-scale={userSettings.ui.textScale}
	style:--ui-scale={userSettings.ui.uiScale}
	style:--ui-hud-window-opacity={userSettings.ui.hudWindowOpacity}
	style:--ui-font-body={uiFontCss(userSettings.ui.fonts.body)}
	style:--ui-font-heading={uiFontCss(userSettings.ui.fonts.heading)}
	style:--ui-font-mono={uiFontCss(userSettings.ui.fonts.mono)}
>
	{#if screenRoot !== null}<UiTooltipHost root={screenRoot} />{/if}
	<canvas
		bind:this={canvasElement}
		class="explorer-canvas"
		style:cursor={gizmoCursor ?? undefined}
		aria-label="Explorer render viewport"
		tabindex="-1"
		data-game-viewport
	></canvas>

	<div class="explorer-overlay" use:applyUiScale={userSettings.ui.uiScale}>
		<DisplayConfirmation />

		{#if startupError !== null}
			<section class="explorer-startup-error ui-error" role="alert">
				{startupError}
			</section>
		{/if}

		{#if toast !== null || (hudEditMode && !hudHidden)}
			<HudPanel
				label="Notifications"
				placement={userSettings.explorerHudLayout.toast}
				editable={hudEditMode && !hudHidden}
				snapId="toast"
				minWidth={EXPLORER_HUD_MINIMUMS.toast.width}
				minHeight={EXPLORER_HUD_MINIMUMS.toast.height}
				resizable={false}
				contentHitTesting="descendants"
				viewport={logicalViewport}
				onPlacementChange={(next) => updateHudPlacement("toast", next)}
			>
				<HudToastOverlay
					{toast}
					persistentMessage={hudEditMode && !hudHidden
						? { kind: "preview", message: "Notification lane" }
						: null}
				/>
			</HudPanel>
		{/if}

		{#if !hudHidden}
			<HudCornerControls
				bind:this={cornerControls}
				hudMode={hudEditMode ? "layout" : "runtime"}
				onToggleHudMode={() => (hudEditMode = !hudEditMode)}
				menuItems={explorerSystemMenuItems}
				onMenuSelect={(action) => {
					if (action === "launcher") void returnToLauncher(null);
					else
						void requestElectronClientClose().catch((error) =>
							console.error(error),
						);
				}}
				onHideHud={() => setHudHidden(true)}
				hideHudTooltip={`Hide UI (${toggleHudHint})`}
			/>

			{#if userSettings.ui.showFps || hudEditMode}
				<HudPanel
					label="Frames per second"
					placement={userSettings.explorerHudLayout.frameRate}
					editable={hudEditMode}
					snapId="frameRate"
					minWidth={EXPLORER_HUD_MINIMUMS.frameRate.width}
					minHeight={EXPLORER_HUD_MINIMUMS.frameRate.height}
					resizable={false}
					contentHitTesting="surface"
					viewport={logicalViewport}
					onPlacementChange={(next) => updateHudPlacement("frameRate", next)}
				>
					<HudFpsCounter
						readFrameRates={() => displayDiagnostics.readFrameRates()}
						diagnosticsTuning={EXPLORER_TUNING.diagnostics}
					/>
				</HudPanel>
			{/if}

			{#if startupError === null}
				<Minimap
					onClearWaypoint={null}
					readFrame={() => displayDiagnostics.readMinimapFrame()}
					viewState={minimapViewState}
					editable={hudEditMode}
					minSize={EXPLORER_HUD_MINIMUMS.minimap.width}
					resizeBounds={{ ...logicalViewport, footerWidth: 0 }}
					resizable={true}
					onGeometryChange={(geometry) => {
						updateHudPlacement(
							"minimap",
							anchorHudPlacement(
								{
									left: geometry.left,
									top: geometry.top,
									width: geometry.size,
									height: geometry.size,
								},
								logicalViewport,
								{ width: geometry.size, height: geometry.size },
							),
						);
					}}
					onViewDiametersChange={(minimapViewDiameters) => {
						persistExplorerWorld({ minimapViewDiameters });
					}}
					onSelectEntity={selectMinimapEntity}
				/>
			{/if}

			{#if selectedEntity !== null || hudEditMode}
				<HudPanel
					label="Selected entity"
					placement={userSettings.explorerHudLayout.selectedEntity}
					editable={hudEditMode}
					snapId="selectedEntity"
					minWidth={EXPLORER_HUD_MINIMUMS.selectedEntity.width}
					minHeight={EXPLORER_HUD_MINIMUMS.selectedEntity.height}
					resizable={false}
					contentHitTesting="surface"
					viewport={logicalViewport}
					onPlacementChange={(next) =>
						updateHudPlacement("selectedEntity", next)}
				>
					<HudSelectedEntityBar
						selectedKey={selectedEntity === null
							? null
							: `${selectedEntity.identity.guid}:${selectedEntity.generation}`}
						displayName={selectedEntity?.display.name ?? "Selected Entity"}
						actions={selectedEntityHudActions}
						examineLabel="Inspect selected entity"
						examineTitle={`Inspect (${examineBindingDescription})`}
						examineDisabled={selectedEntity === null}
						onExamine={openInspectWindow}
					/>
				</HudPanel>
			{/if}

			{#if jumpChargeActive || hudEditMode}
				<HudPanel
					label="Jump power"
					editable={hudEditMode}
					snapId="jumpPower"
					placement={userSettings.explorerHudLayout.jumpPower}
					minWidth={EXPLORER_HUD_MINIMUMS.jumpPower.width}
					minHeight={EXPLORER_HUD_MINIMUMS.jumpPower.height}
					resizable={false}
					contentHitTesting="surface"
					viewport={logicalViewport}
					onPlacementChange={(next) => updateHudPlacement("jumpPower", next)}
				>
					<HudJumpPowerBar
						active={jumpChargeActive}
						previewExtent={hudEditMode ? 0.65 : null}
						precise={false}
						readExtent={() => entityController.readJumpChargeExtent() ?? 0}
						powerKeys={["", ""]}
						powerControl={null}
					/>
				</HudPanel>
			{/if}

			{#if possessedSelection !== null || hudEditMode}
				<HudPanel
					label="Release possession"
					placement={userSettings.explorerHudLayout.possessionRelease}
					editable={hudEditMode}
					snapId="possessionRelease"
					minWidth={EXPLORER_HUD_MINIMUMS.possessionRelease.width}
					minHeight={EXPLORER_HUD_MINIMUMS.possessionRelease.height}
					resizable={false}
					contentHitTesting="surface"
					viewport={logicalViewport}
					onPlacementChange={(next) =>
						updateHudPlacement("possessionRelease", next)}
				>
					<button
						type="button"
						class="ui-button possession-release-button"
						disabled={possessedSelection === null || entityPending !== null}
						onclick={() => void runReleasePossession()}
					>
						Release
					</button>
				</HudPanel>
			{/if}

			<ExplorerShortcutDock
				placement={userSettings.explorerHudLayout.shortcuts}
				viewport={logicalViewport}
				editable={hudEditMode}
				{activePanel}
				onToggle={toggleWindow}
				onPlacementChange={(next) => updateHudPlacement("shortcuts", next)}
			/>
		{/if}

		<HudWindow
			title="Navigation"
			visible={activePanel === "navigation" && !hudHidden}
			focusRevision={panelFocusRevision}
			placement={userSettings.explorerHudLayout.navigation}
			minWidth={EXPLORER_HUD_MINIMUMS.navigation.width}
			minHeight={EXPLORER_HUD_MINIMUMS.navigation.height}
			viewport={logicalViewport}
			onClose={() => {
				if (activePanel === "navigation") activePanel = null;
			}}
			onPlacementChange={(next) => updateHudPlacement("navigation", next)}
		>
			{#snippet icon()}<WorldMapIcon />{/snippet}
			<ExplorerNavigationWindow
				visible={activePanel === "navigation" && !hudHidden}
				{runtimeReady}
				source={worldMapSource}
				readFrame={() => displayDiagnostics.readMinimapFrame()}
				onJumpToTarget={jumpToWorldMapTarget}
				{sceneContext}
				{cameraResidencyLabel}
				{cameraMode}
				{cameraModePending}
				readPhysicalCameraStatus={() =>
					cameraAuthority.readPhysicalCameraStatus()}
				updateCameraMode={(mode) => cameraAuthority.updateCameraMode(mode)}
				flySpeed={userSettings.explorerWorld.flySpeed}
				onFlySpeedChange={(flySpeed) => {
					cameraAuthority.setFlySpeed(flySpeed);
					persistExplorerWorld({ flySpeed });
				}}
				{audioFollowsCamera}
				updateAudioFollowsCamera={(enabled) => {
					audioFollowsCamera = enabled;
					cameraAuthority.setAudioFollowsCamera(enabled);
					persistExplorerWorld({ audioFollowsCamera: enabled });
				}}
			/>
		</HudWindow>

		<HudWindow
			title="Scene"
			visible={activePanel === "scene" && !hudHidden}
			focusRevision={panelFocusRevision}
			placement={userSettings.explorerHudLayout.scene}
			minWidth={EXPLORER_HUD_MINIMUMS.scene.width}
			minHeight={EXPLORER_HUD_MINIMUMS.scene.height}
			viewport={logicalViewport}
			onClose={() => {
				if (activePanel === "scene") activePanel = null;
			}}
			onPlacementChange={(next) => updateHudPlacement("scene", next)}
		>
			{#snippet icon()}<WorldControlsIcon />{/snippet}
			<ExplorerSceneWindow
				{runtimeReady}
				{environmentSelection}
				dayGroupNames={activeRegion?.data.sky?.dayGroups.map(
					({ dayName }) => dayName,
				) ?? []}
				updateEnvironment={(selection) =>
					displayDiagnostics.updateEnvironment(selection)}
				{clockFollowing}
				updateClockFollowing={(enabled) =>
					displayDiagnostics.updateClockFollowing(enabled)}
				radii={userSettings.explorerWorld.radii}
				onRadiiChange={(radii: SceneInterestRadii) => {
					cameraAuthority.updateSceneInterestRadii(radii);
					persistExplorerWorld({ radii });
				}}
				{interestFollowsCamera}
				updateInterestFollowsCamera={(enabled) => {
					interestFollowsCamera = enabled;
					cameraAuthority.setInterestFollowsCamera(enabled);
					persistExplorerWorld({ interestFollowsCamera: enabled });
				}}
			/>
		</HudWindow>

		<HudWindow
			title="Visuals"
			visible={activePanel === "visuals" && !hudHidden}
			focusRevision={panelFocusRevision}
			placement={userSettings.explorerHudLayout.visuals}
			minWidth={EXPLORER_HUD_MINIMUMS.visuals.width}
			minHeight={EXPLORER_HUD_MINIMUMS.visuals.height}
			viewport={logicalViewport}
			onClose={() => {
				if (activePanel === "visuals") activePanel = null;
			}}
			onPlacementChange={(next) => updateHudPlacement("visuals", next)}
		>
			{#snippet icon()}<RendererIcon />{/snippet}
			<ExplorerVisualsWindow
				{runtimeReady}
				distanceFogEnabled={frameSettings.distanceFogEnabled}
				updateDistanceFog={(enabled) =>
					displayDiagnostics.updateDistanceFog(enabled)}
				viewerLightEnabled={frameSettings.viewerLightEnabled}
				updateViewerLight={(enabled) =>
					displayDiagnostics.updateViewerLight(enabled)}
				staticLightsEnabled={frameSettings.staticLightsEnabled}
				updateStaticLights={(enabled) =>
					displayDiagnostics.updateStaticLights(enabled)}
				envCellRenderMode={frameSettings.envCellRenderMode}
				updateEnvCellRenderMode={(mode) =>
					displayDiagnostics.updateEnvCellRenderMode(mode)}
				layerVisibility={frameSettings.layerVisibility}
				updateLayerVisibility={(layer, visible) =>
					displayDiagnostics.updateLayerVisibility(layer, visible)}
				showRetailHiddenGeometry={frameSettings.showRetailHiddenGeometry}
				updateShowRetailHiddenGeometry={(visible) =>
					displayDiagnostics.updateShowRetailHiddenGeometry(visible)}
				nameplates={frameSettings.nameplates}
				updateNameplateCategory={(category, visible) =>
					displayDiagnostics.updateNameplateCategory(category, visible)}
				ambientOcclusion={frameSettings.ambientOcclusion}
				updateAmbientOcclusionSettings={(ao) =>
					displayDiagnostics.updateAmbientOcclusionSettings(ao)}
				entityShadows={frameSettings.entityShadows}
				updateEntityShadowSettings={(shadows) =>
					displayDiagnostics.updateEntityShadowSettings(shadows)}
				colorGrade={frameSettings.colorGrade}
				updateColorGrade={(colorGrade) =>
					displayDiagnostics.updateColorGradeSettings(colorGrade)}
			/>
		</HudWindow>

		<HudWindow
			title="Entities"
			visible={activePanel === "entities" && !hudHidden}
			focusRevision={panelFocusRevision}
			placement={userSettings.explorerHudLayout.entities}
			minWidth={EXPLORER_HUD_MINIMUMS.entities.width}
			minHeight={EXPLORER_HUD_MINIMUMS.entities.height}
			viewport={logicalViewport}
			onClose={() => {
				if (activePanel === "entities") activePanel = null;
			}}
			onPlacementChange={(next) => updateHudPlacement("entities", next)}
		>
			{#snippet icon()}<EntitiesIcon />{/snippet}
			<ExplorerEntitiesPanel
				selection={selectedExplorerEntity}
				possessed={possessedSelection}
				select={selectExplorerEntity}
				onInspect={(selection) => {
					selectExplorerEntity(selection);
					openInspectWindow();
				}}
				{runtimeReady}
				catalog={entityCatalog}
				entities={spawnedEntities}
				pending={entityPending}
				search={(request) => entityController.searchExplorerWeenies(request)}
				spawn={runEntitySpawn}
				clearAll={runEntityResetAll}
			/>
		</HudWindow>

		<HudWindow
			title="Inspect"
			visible={inspectOpen && selectedEntity !== null && !hudHidden}
			focusRevision={inspectFocusRevision}
			placement={userSettings.explorerHudLayout.inspection}
			minWidth={EXPLORER_HUD_MINIMUMS.inspection.width}
			minHeight={EXPLORER_HUD_MINIMUMS.inspection.height}
			viewport={logicalViewport}
			onClose={() => (inspectOpen = false)}
			onPlacementChange={(next) => updateHudPlacement("inspection", next)}
		>
			{#snippet icon()}<ExamineIcon />{/snippet}
			{#if selectedEntity !== null}
				<div class="explorer-window-scroll ui-body">
					<ExplorerEntityInspector
						visible={inspectOpen && !hudHidden}
						{runtimeReady}
						selected={selectedEntity}
						wearer={selectedEntityWearer}
						pending={entityPending}
						{selectionStatus}
						possession={explorerPossession}
						possessionControls={possessedControls}
						readPossessionMotionProbe={() =>
							entityController.readPossessionMotionProbe()}
						readExplorerEntity={(selection) =>
							entityController.readExplorerEntity(selection)}
						readBoomCameraStatus={() => cameraAuthority.readBoomCameraStatus()}
						select={selectExplorerEntity}
						despawn={runEntityDespawn}
						relocate={runEntityRelocate}
						launch={runEntityLaunch}
						replacePhysicsState={runEntityReplacePhysicsState}
						possess={runEntityPossession}
						setStance={runEntityStance}
						setRunRate={(value) => runEntityRunRate(value)}
					/>
				</div>
			{/if}
		</HudWindow>

		<HudWindow
			title="Diagnostics"
			visible={activePanel === "diagnostics" && !hudHidden}
			focusRevision={panelFocusRevision}
			placement={userSettings.explorerHudLayout.diagnostics}
			minWidth={EXPLORER_HUD_MINIMUMS.diagnostics.width}
			minHeight={EXPLORER_HUD_MINIMUMS.diagnostics.height}
			viewport={logicalViewport}
			onClose={() => {
				if (activePanel === "diagnostics") activePanel = null;
			}}
			onPlacementChange={(next) => updateHudPlacement("diagnostics", next)}
		>
			{#snippet icon()}<DebugIcon />{/snippet}
			<ExplorerDiagnosticsWindow
				visible={activePanel === "diagnostics" && !hudHidden}
				readPerformanceSession={() =>
					displayDiagnostics.readPerformanceSession()}
				readRendererFrameDiagnostics={() =>
					displayDiagnostics.readRendererFrameDiagnostics()}
				captureReport={() => displayDiagnostics.captureFrameDiagnosticReport()}
				readAuthoredDynamicRuntimeDiagnostics={() =>
					displayDiagnostics.readAuthoredDynamicRuntimeDiagnostics()}
				readStaticObjectRuntimeDiagnostics={() =>
					displayDiagnostics.readStaticObjectRuntimeDiagnostics()}
				readTextureAtlasPage={(pageId) =>
					displayDiagnostics.readTextureAtlasPage(pageId)}
			/>
		</HudWindow>

		<HudWindow
			title="Settings"
			visible={activePanel === "settings" && !hudHidden}
			focusRevision={panelFocusRevision}
			placement={userSettings.explorerHudLayout.settings}
			minWidth={EXPLORER_HUD_MINIMUMS.settings.width}
			minHeight={EXPLORER_HUD_MINIMUMS.settings.height}
			viewport={logicalViewport}
			onClose={() => {
				if (activePanel === "settings") activePanel = null;
			}}
			onPlacementChange={(next) => updateHudPlacement("settings", next)}
		>
			{#snippet icon()}<SettingsIcon />{/snippet}
			<ExplorerSettingsPanel
				visible={activePanel === "settings" && !hudHidden}
				{platform}
				theme={themeSettings}
				graphics={userSettings.graphics}
				{textureFilteringCapabilities}
				ui={userSettings.ui}
				audio={userSettings.audio}
				input={userSettings.input}
				explorerInput={userSettings.explorerInput}
				onGraphicsChange={handleGraphicsChange}
				onUiChange={handleUiChange}
				onAudioChange={handleAudioChange}
				onInputChange={handleInputChange}
				onExplorerInputChange={handleExplorerInputChange}
				onResetHudLayout={resetHudLayout}
				onResetExplorerDefaults={resetExplorerDefaults}
			/>
		</HudWindow>
	</div>
</div>

<style>
	@layer components {
		.explorer-window-scroll {
			height: 100%;
			overflow: auto;
		}

		.possession-release-button {
			width: 100%;
			height: 100%;
		}
	}
</style>
