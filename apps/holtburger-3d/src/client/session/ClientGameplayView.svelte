<script lang="ts">
	import ClientLockFeedback from "../inventory/ClientLockFeedback.svelte";
	import { applyUiScale } from "../../app/theme/ui-scale";
	import { logicalClientHudViewport } from "../hud/hud-layout";
	import { presentClientBinding } from "../settings/binding-catalog";
	import { ClientCombineCells } from "../inventory/combine-cells";
	import ClientEmoteWheel from "../social/ClientEmoteWheel.svelte";
	import type { ClientWaypointReveal } from "../world/navigation-waypoint";
	import type { MapWaypointTarget } from "../../lib/game/map/map-waypoint";
	import ClientLoadoutBuilder from "../inventory/ClientLoadoutBuilder.svelte";
	import {
		captureLoadout,
		chooseLoadoutIcon,
		type LoadoutDraft,
	} from "../inventory/loadout";
	import ClientPartyHud from "../social/ClientPartyHud.svelte";
	import ClientJournalPanel from "../world/ClientJournalPanel.svelte";
	import ClientSalvageWindow from "../inventory/ClientSalvageWindow.svelte";
	import ClientTradeWindow from "../inventory/ClientTradeWindow.svelte";
	import ClientBarberWindow from "../character/ClientBarberWindow.svelte";
	import ClientHouseCrystalWindow from "../housing/ClientHouseCrystalWindow.svelte";
	import ClientVendorWindow from "../inventory/ClientVendorWindow.svelte";
	import ClientWorldContainerWindow from "../inventory/ClientWorldContainerWindow.svelte";
	import ClientInspectionWindow from "../inventory/ClientInspectionWindow.svelte";
	import ClientBookWindow from "../inventory/ClientBookWindow.svelte";
	import { ClientSpellDrag } from "../magic/spell-drag";
	import type { ClientItemDrag } from "../inventory/item-drag";
	import { bindSpellCell, swapSpellCells } from "../magic/spell-bar-state";
	import { CLIENT_PANEL_SHORTCUT_ACTIONS } from "../../lib/input/input-contract";

	import ClientSpellBar from "../magic/ClientSpellBar.svelte";
	import ClientCombatBar from "../combat/ClientCombatBar.svelte";
	import type { ItemInteractionState } from "../inventory/item-interactions";
	import { selectedPlayerTarget } from "../world/selected-entity";
	import { useAppInputPolicy } from "../../lib/input/app-input-policy-context";

	import { useClientInput } from "./input-context";
	import { onMount, onDestroy, untrack } from "svelte";
	import { CLIENT_UI_DEFAULTS } from "../hud/ui-defaults";
	import Minimap from "../../app/minimap/Minimap.svelte";
	import ClientMinimapEnvironment from "../hud/ClientMinimapEnvironment.svelte";
	import type {
		MinimapState,
		MinimapGeometry,
		MinimapFooterExtent,
	} from "../../app/minimap/frame";
	import ClientVitalWarningOverlay from "../combat/ClientVitalWarningOverlay.svelte";
	import ClientCharacterHud from "../character/ClientCharacterHud.svelte";
	import ClientCharacterSheetPanel from "../character/ClientCharacterSheetPanel.svelte";
	import ClientStatusTray from "../character/ClientStatusTray.svelte";
	import ClientEnchantmentsPanel from "../magic/ClientEnchantmentsPanel.svelte";
	import { presentEnchantmentTray } from "../magic/enchantments-view";
	import HudJumpPowerBar from "../../app/hud/HudJumpPowerBar.svelte";
	import { MINIMUM_JUMP_POWER } from "./host-contract";
	import ClientRuntimeConsole from "../hud/ClientRuntimeConsole.svelte";
	import ClientChat from "../social/ClientChat.svelte";
	import ClientActionBars from "../hud/ClientActionBars.svelte";
	import { provideHudGeometry as provideClientHudGeometry } from "../../app/hud/hud-geometry-context";
	import ClientSocialPanel from "../social/ClientSocialPanel.svelte";
	import ClientNearbyPanel from "../world/ClientNearbyPanel.svelte";
	import ClientInventoryPanel from "../inventory/ClientInventoryPanel.svelte";
	import {
		isSplittableInventoryItem,
		type InventorySplitStart,
	} from "../inventory/inventory-split";
	import ClientDebugPanel from "../hud/ClientDebugPanel.svelte";
	import ClientLogopolisWindow from "../hud/ClientLogopolisWindow.svelte";
	import ClientLocksWindow from "../inventory/ClientLocksWindow.svelte";
	import ClientHudWindow from "../hud/ClientHudWindow.svelte";
	import ClientWorldPanel from "../world/ClientWorldPanel.svelte";
	import HudFpsCounter from "../../app/hud/HudFpsCounter.svelte";
	import ClientHudIcon from "../hud/ClientHudIcon.svelte";
	import ClientHudPanel from "../../app/hud/HudPanel.svelte";
	import ClientSelectedEntityHud from "../hud/ClientSelectedEntityHud.svelte";
	import ClientShortcutDock, {
		createClientShortcuts,
		PANEL_SHORTCUTS,
		type ClientSystemPanel,
	} from "../hud/ClientShortcutDock.svelte";
	import HudToastOverlay from "../../app/hud/HudToastOverlay.svelte";
	import ClientCombatTargetIndicator from "../combat/ClientCombatTargetIndicator.svelte";
	import ClientTargetIndicator from "../combat/ClientTargetIndicator.svelte";
	import ClientSettingsPanel, {
		type SettingsTab,
	} from "../settings/ClientSettingsPanel.svelte";
	import { CLIENT_NEARBY_TUNING, CLIENT_TUNING } from "../settings/tuning";
	import {
		anchorClientHudPlacement,
		createClientHudLayout,
		resolveClientMinimapPlacement,
		type ClientHudLayout,
		type ClientHudViewport,
	} from "../hud/hud-layout";
	import { ClientViewportMouseController } from "./viewport-mouse-controller";
	import type {
		ClientGameplayCharacterSurface,
		ClientGameplayCombatMagicSurface,
		ClientGameplayInventorySurface,
		ClientGameplaySettingsSurface,
		ClientGameplayShellSurface,
		ClientGameplaySocialSurface,
		ClientGameplayWorldSurface,
	} from "./gameplay-surfaces";

	import HudCornerControls from "../../app/hud/HudCornerControls.svelte";
	import { requestElectronClientClose } from "../../lib/host/electron-host-transport";

	interface Props {
		readonly shell: ClientGameplayShellSurface;
		readonly settings: ClientGameplaySettingsSurface;
		readonly character: ClientGameplayCharacterSurface;
		readonly inventory: ClientGameplayInventorySurface;
		readonly combatMagic: ClientGameplayCombatMagicSurface;
		readonly world: ClientGameplayWorldSurface;
		readonly social: ClientGameplaySocialSurface;
	}

	let systemMenu = $state<
		HudCornerControls<"logout" | "disconnect" | "quit"> | undefined
	>(undefined);
	let {
		shell,
		settings,
		character,
		inventory,
		combatMagic,
		world,
		social,
	}: Props = $props();
	const systemMenuItems = $derived([
		{
			action: "logout",
			label: "Return to main menu",
			disabled: !shell.canReturnToMenu,
		},
		{
			action: "disconnect",
			label: "Disconnect",
			disabled: !shell.canDisconnect,
		},
		{ action: "quit", label: "Quit application", disabled: false },
	] as const);
	provideClientHudGeometry();
	const { viewport: inputGate, keyboard } = useAppInputPolicy();
	const clientInput = useClientInput();
	/** Preview visibility is independent of layout editing controls. */
	const previewHud = $derived(
		shell.hudMode === "layout" || (shell.uiShowcase ?? false),
	);

	/** The wheel owns a disposable physical-key lifetime while its activation key is held. */
	let emoteWheel = $state<{ readonly release: () => void } | null>(null);
	function closeEmotes(): void {
		const activation = emoteWheel;
		emoteWheel = null;
		activation?.release();
	}
	onDestroy(closeEmotes);
	$effect(() => {
		// Lifecycle/configuration edges retire the transient interaction; opening itself is untracked.
		social.chatComposer.generation;
		social.emotesEnabled;
		shell.hudMode;
		untrack(() => {
			closeEmotes();
		});
	});
	function openEmotes(press: KeyboardEvent): void {
		if (
			!social.emotesEnabled ||
			shell.hudMode !== "runtime" ||
			social.chatComposer.emotes === null
		)
			return;
		closeEmotes();
		emoteWheel = { release: keyboard.bindKeyRelease(press, closeEmotes) };
	}
	function executeEmote(token: string): void {
		void social
			.onSendChat(`*${token}*`, {
				kind: "send",
				label: "Emote · Local",
				buttonLabel: "Emote",
				buttonIcon: "speech",
				request: { kind: "soul-emote", token },
			})
			.catch((error) =>
				social.onSendChatError(
					error instanceof Error ? error.message : String(error),
				),
			);
	}
	/** Pointer surface changes are cold; world geometry still uses the existing hover picker. */
	let combineSurface = $state<number | "world" | null>(null);
	function considerPointer(event: PointerEvent): void {
		const element = event.target instanceof Element ? event.target : null;
		const cell = element?.closest<HTMLElement>(
			".item-grid-cell[data-item-guid]:not(:disabled), .action-cell[data-action-item]:not(:disabled)",
		);
		combineSurface = cell
			? Number(cell.dataset.itemGuid ?? cell.dataset.actionItem)
			: element?.closest(".client-canvas")
				? "world"
				: null;
	}
	let itemInteraction = $state<ItemInteractionState>({ kind: "idle" });
	const combining = $derived(itemInteraction.kind === "acquiring");
	const combineEligibility = $derived(
		itemInteraction.kind === "acquiring"
			? (itemInteraction.considered?.eligibility ?? "neutral")
			: "neutral",
	);
	$effect(() => {
		if (combining)
			inventory.itemInteractions?.consider(
				combineSurface === "world" ? world.hoveredEntityGuid : combineSurface,
			);
	});

	$effect(() => {
		const owner = inventory.itemInteractions;
		itemInteraction = owner?.snapshot() ?? { kind: "idle" };
		return owner?.subscribe((state) => {
			itemInteraction = state;
		});
	});
	let itemDrag = $state<ClientItemDrag | null>(null);
	/** Opening snapshots are cold drafts, independent of subsequent entity updates. */
	let loadoutCapture = $state<LoadoutDraft | null>(null);
	function openLoadoutBuilder() {
		if (inventory.itemSession === null || inventory.actionBars === null) return;
		const capture = captureLoadout(inventory.itemSession.entities.read());
		if (capture.kind === "unavailable") {
			inventory.onInventoryNotice(capture.reason);
			return;
		}
		loadoutCapture = {
			...capture,
			icon: chooseLoadoutIcon(inventory.actionBars),
		};
	}
	$effect(() => {
		if (!combatMagic.combatEnabled || inventory.itemSession === null)
			loadoutCapture = null;
	});
	let spellDrag: ClientSpellDrag | null = null;
	onMount(() =>
		keyboard.bindEscapeCancellation(
			() =>
				spellDrag?.cancel() ||
				itemDrag?.cancel() ||
				inventory.itemInteractions?.cancel() ||
				false,
		),
	);
	$effect(() => {
		const root = shell.interactionRoot;
		const owner = new ClientSpellDrag(root, {
			read: (cell) => combatMagic.spellBar.tabs[cell.tab][cell.slot],
			bind: (cell, spell) =>
				combatMagic.onSpellBarChange(
					bindSpellCell(combatMagic.spellBar, cell, spell),
				),
			transfer: (source, target) =>
				combatMagic.onSpellBarChange(
					target === null
						? bindSpellCell(combatMagic.spellBar, source, null)
						: swapSpellCells(combatMagic.spellBar, source, target),
				),
			swapTabs: combatMagic.onSwapSpellTabs,
			begin: () => {
				itemDrag?.cancel();
				inventory.itemInteractions?.cancel();
			},
			available: () =>
				combatMagic.spellBarEnabled || shell.hudMode === "layout",
		});
		spellDrag = owner;
		return () => {
			owner.destroy();
			if (spellDrag === owner) spellDrag = null;
		};
	});
	$effect(() => {
		// Cold identity/visibility changes cancel before a hidden tab or retired source can commit.
		combatMagic.spellBar;
		combatMagic.spellBarEnabled;
		shell.hudMode;
		combatMagic.spells;
		spellDrag?.cancel();
	});
	$effect(() => {
		// Scale invalidates both pointer coordinate spaces; spell edits only retire spell gestures.
		settings.ui.uiScale;
		itemDrag?.cancel();
		spellDrag?.cancel();
	});
	onMount(() =>
		inputGate.attach(() => {
			spellDrag?.cancel();
		}),
	);

	const initialViewport: ClientHudViewport = {
		width: window.innerWidth,
		height: window.innerHeight,
	};
	let nearbyOpen = $state(false);
	/** Launcher attention samples current matches at the nearby panel's bounded display cadence. */
	let nearbyAlertActive = $state(false);
	$effect(() => {
		const owner = world.nearby;
		const pull = () => {
			nearbyAlertActive = owner !== null && owner.trackedGuids().size > 0;
		};
		pull();
		if (owner === null) return;
		const timer = setInterval(pull, CLIENT_NEARBY_TUNING.displayIntervalMs);
		return () => clearInterval(timer);
	});
	const nearbyShortcut = $derived(
		presentClientBinding(
			settings.input,
			{ kind: "client", action: "toggleNearby" },
			shell.platform,
		),
	);
	let chatEditor = $state<ClientChat>();
	let activePanel = $state<ClientSystemPanel | null>(null);
	/** Latest cold activation survives the World window's lazy first mount. */
	let waypointReveal = $state.raw<ClientWaypointReveal | null>(null);
	$effect(() => {
		// A new character or map source starts a new presentation lifetime.
		void character.characterGuid;
		void world.worldMapSource;
		waypointReveal = null;
	});
	/** Explicit activations also promote an already visible World window. */
	let waypointFocusRevision = $state(0);
	/** Open, promote, and reveal through the existing single-panel presentation policy. */
	export function revealWaypoint(target: MapWaypointTarget): void {
		if (character.characterGuid === null || world.worldMapSource === null)
			return;
		waypointReveal = { characterGuid: character.characterGuid, target };
		waypointFocusRevision++;
		activePanel = "world";
	}
	/** Salvage entry opens inventory through the same single-open-panel owner as the dock. */
	export function showInventory(): void {
		activePanel = "inventory";
	}
	/** Dock and keyboard share the single-open-panel policy. */
	function toggleSystemPanel(panel: ClientSystemPanel): void {
		activePanel = activePanel === panel ? null : panel;
	}
	let consoleOpen = $state(false);
	/** UI panel commands remain available while world controls are suspended. */
	function handleSystemPanelKeydown(event: KeyboardEvent): boolean {
		if (
			event.defaultPrevented ||
			event.isComposing ||
			shell.hudMode !== "runtime"
		)
			return false;
		if (world.nearby !== null && clientInput.shortcut("toggleNearby", event)) {
			event.preventDefault();
			if (!event.repeat) nearbyOpen = !nearbyOpen;
			return true;
		}
		const action = CLIENT_PANEL_SHORTCUT_ACTIONS.find((action) =>
			clientInput.shortcut(action, event),
		);
		if (action === undefined) return false;
		event.preventDefault();
		if (!event.repeat) toggleSystemPanel(PANEL_SHORTCUTS[action]);
		return true;
	}
	onMount(() =>
		keyboard.bindShortcuts((event) => {
			if (
				shell.hudMode === "runtime" &&
				!event.isComposing &&
				clientInput.shortcut("toggleConsole", event)
			) {
				event.preventDefault();
				if (!event.repeat) consoleOpen = !consoleOpen;
				return;
			}
			if (handleSystemPanelKeydown(event)) return;
			if (event.key === "Escape" && shell.hudMode === "runtime") {
				// The router has already offered Escape to editors and cancellation contexts.
				systemMenu?.show();
				event.preventDefault();
			}
		}),
	);
	let enchantmentsOpen = $state(false);
	let enchantmentLaunch = $state<{
		kind: "beneficial" | "harmful";
		revision: number;
	} | null>(null);
	const enchantmentTray = $derived(
		presentEnchantmentTray(character.enchantments?.resolved ?? null),
	);
	function openEnchantments(kind: "beneficial" | "harmful"): void {
		enchantmentsOpen = true;
		enchantmentLaunch = {
			kind,
			revision: (enchantmentLaunch?.revision ?? 0) + 1,
		};
	}
	let settingsTab = $state<SettingsTab>("graphics");
	/** One selected-HUD request retained only until the inventory panel accepts it. */
	let requestedInventorySplit = $state<InventorySplitStart | null>(null);
	$effect(() => social.onPartyHudDemand(social.partyHudPresent));
	onDestroy(() => social.onPartyHudDemand(false));

	let worldElement = $state<HTMLElement | null>(null);
	let uiElement = $state<HTMLElement | null>(null);
	$effect(() => {
		if (worldElement === null || inventory.itemInteractions === null) return;
		const cells = new ClientCombineCells(
			worldElement,
			inventory.itemInteractions,
		);
		return () => cells.destroy();
	});
	// Mount snapshot only; the scaled DOM observer owns subsequent viewport updates.
	let viewport = $state<ClientHudViewport>(
		untrack(() =>
			logicalClientHudViewport(initialViewport, settings.ui.uiScale),
		),
	);
	// The launch capability is immutable; snapshotting it avoids resetting edited HUD layout.
	const shortcuts = untrack(() => createClientShortcuts(shell.debugEnabled));
	let resetActionBars = $state<(() => boolean) | null>(null);
	function resetHudPlacements(): void {
		if (resetActionBars === null || !resetActionBars()) return;
		settings.onHudReset(
			createClientHudLayout(CLIENT_UI_DEFAULTS, viewport, shortcuts.length),
		);
	}
	/** Cold measured geometry: updated on footer/font changes, never scene cadence. */
	let minimapFooterExtent = $state<MinimapFooterExtent>({
		width: 0,
		height: 0,
	});
	/** Intrinsic character text/bar height, published only when its CSS rows change size. */
	let characterContentHeight = $state(0);
	const minimapViewport = $derived({
		...viewport,
		height: Math.max(0, viewport.height - minimapFooterExtent.height),
	});
	const resolvedMapPlacement = $derived(
		resolveClientMinimapPlacement(
			settings.hudLayout.minimap,
			minimapViewport,
			CLIENT_UI_DEFAULTS.minimap.minSize,
			minimapFooterExtent.width,
		),
	);
	const minimap = $derived<MinimapState>({
		left: resolvedMapPlacement.left,
		top: resolvedMapPlacement.top,
		size: resolvedMapPlacement.width,
		viewDiameters: settings.minimapViewDiameters,
	});
	let viewportMouse: ClientViewportMouseController | null = null;
	let pointerX = 0;
	let pointerY = 0;
	let hasPointerPosition = false;
	let pointerInsideCanvas = false;
	const HUD_PREVIEW_JUMP_EXTENT = 0.45;
	const HUD_PREVIEW_TOAST_MESSAGE = "Notification preview";

	/** App-owned target classification shared by selected-player shortcuts. */
	function selectedPlayer() {
		return selectedPlayerTarget(
			world.readSelectedEntity(),
			character.characterGuid,
		);
	}
	function inviteTarget(): number | null {
		const target = selectedPlayer();
		return target !== null && social.party?.canInvite(target.guid)
			? target.guid
			: null;
	}
	function swearTarget(): number | null {
		const target = selectedPlayer();
		return target !== null && social.allegiance?.canSwear(target.guid)
			? target.guid
			: null;
	}
	function friendTarget() {
		const target = selectedPlayer();
		return target !== null && social.friends?.canAdd(target.guid, target.name)
			? target
			: null;
	}
	function ignoreTarget() {
		const target = selectedPlayer();
		return target !== null &&
			social.squelch?.canIgnoreAccount(target.guid, target.name)
			? target
			: null;
	}
	function addSelectedFriend(): void {
		const target = friendTarget();
		if (target !== null)
			void social.friends?.request(
				{ kind: "add", name: target.name },
				social.onSocialNotice,
			);
	}
	function ignoreSelectedAccount(): void {
		const target = ignoreTarget();
		if (target !== null)
			void social.squelch?.request(
				{ kind: "add", name: target.name, scope: "account" },
				social.onSocialNotice,
			);
	}
	function canAutoMergeSelectedContainer(): boolean {
		return (
			world.selectedEntityGuid !== null &&
			inventory.inventory?.canAutoMergeContainer(world.selectedEntityGuid) ===
				true
		);
	}
	function autoMergeSelectedContainer(): void {
		if (world.selectedEntityGuid !== null)
			inventory.inventory?.requestAutoMergeContainer(world.selectedEntityGuid);
	}

	function canSplitSelectedEntity(): boolean {
		return (
			world.selectedEntityGuid !== null &&
			inventory.inventory !== null &&
			isSplittableInventoryItem(
				inventory.inventory.readItem(world.selectedEntityGuid),
			)
		);
	}

	/** Shared entry for the selected-item menu and gameplay keyboard dispatch. */
	export function splitSelectedEntity(source: HTMLElement): void {
		if (!canSplitSelectedEntity() || world.selectedEntityGuid === null) return;
		requestedInventorySplit = { item: world.selectedEntityGuid, source };
		activePanel = "inventory";
	}

	$effect(() => {
		if (activePanel !== "inventory") requestedInventorySplit = null;
	});

	// Isolate the cancellation dependency from unrelated input preference replacements.
	const mouseMovementEnabled = $derived(settings.input.mouseMovement);
	$effect(() => {
		mouseMovementEnabled;
		untrack(cancelMouseInput);
	});

	$effect(() => {
		const precise = character.preciseJumpActive;
		untrack(() => {
			cancelMouseInput();
			if (precise && inputGate.allowed && hasPointerPosition)
				character.onPreciseJumpAim(pointerX, pointerY);
		});
	});

	$effect(() => {
		if (world.cameraController !== null) return;
		untrack(cancelMouseInput);
	});

	$effect(() => {
		const canvas = shell.canvasElement;
		canvas.addEventListener("pointerenter", handlePointerEnter);
		canvas.addEventListener("pointerleave", handlePointerLeave);
		canvas.addEventListener("pointermove", handlePointerMove);
		canvas.addEventListener("wheel", handleWheel, { passive: false });
		canvas.addEventListener("contextmenu", handleContextMenu);
		canvas.addEventListener("pointerover", considerPointer);
		return () => {
			canvas.removeEventListener("pointerenter", handlePointerEnter);
			canvas.removeEventListener("pointerleave", handlePointerLeave);
			canvas.removeEventListener("pointermove", handlePointerMove);
			canvas.removeEventListener("wheel", handleWheel);
			canvas.removeEventListener("contextmenu", handleContextMenu);
			canvas.removeEventListener("pointerover", considerPointer);
		};
	});
	$effect(() => {
		shell.canvasElement.toggleAttribute(
			"data-entity-hovered",
			world.hoveredEntityGuid !== null,
		);
		return () => shell.canvasElement.removeAttribute("data-entity-hovered");
	});
	$effect(() => {
		if (combining) {
			shell.canvasElement.dataset.combining = combineEligibility;
		} else delete shell.canvasElement.dataset.combining;
		return () => {
			delete shell.canvasElement.dataset.combining;
		};
	});

	$effect(() => {
		if (shell.canvasElement === null) return;
		const handle = window.setInterval(() => {
			world.onMaintainEntitySelection();
			if (
				!inputGate.allowed ||
				!pointerInsideCanvas ||
				!hasPointerPosition ||
				viewportMouse?.active
			) {
				world.onViewportHoverClear();
				return;
			}
			world.onViewportHover(pointerX, pointerY);
		}, CLIENT_TUNING.entitySelection.sampleIntervalMs);
		return () => window.clearInterval(handle);
	});

	$effect(() => {
		if (uiElement === null) return;
		settings.ui.uiScale;
		const observer = new ResizeObserver(([entry]) => {
			if (entry === undefined) return;
			viewport = {
				width: entry.contentRect.width,
				height: entry.contentRect.height,
			};
		});
		observer.observe(uiElement);
		return () => observer.disconnect();
	});

	function updateMinimapGeometry(next: MinimapGeometry): void {
		const sizeChanged = next.size !== resolvedMapPlacement.width;
		const preferredSize = sizeChanged
			? next.size
			: settings.hudLayout.minimap.preferredWidth;
		const minimapPlacement = anchorClientHudPlacement(
			{ left: next.left, top: next.top, width: next.size, height: next.size },
			minimapViewport,
			{ width: preferredSize, height: preferredSize },
		);
		changeHudPlacement("minimap", minimapPlacement);
	}

	function changeHudPlacement<Surface extends keyof ClientHudLayout>(
		surface: Surface,
		placement: ClientHudLayout[Surface],
	): void {
		settings.onHudPlacementChange(surface, placement);
	}

	$effect(() => {
		const canvas = shell.canvasElement;
		if (canvas === null) return;
		const owner = new ClientViewportMouseController({
			canvas,
			gate: inputGate,
			input: () => settings.input,
			camera: () => world.cameraController,
			precise: () => character.preciseJumpActive,
			yawRadiansPerPixel: CLIENT_TUNING.camera.orbit.yawRadiansPerPixel,
			movement: world.mouseMovement,
			onSelect: world.onViewportSelect,
			onExamine: world.onViewportExamine,
			onJump: character.onPreciseJumpActivate,
			onPosition: (x, y, aiming) => {
				pointerX = x;
				pointerY = y;
				hasPointerPosition = true;
				if (character.preciseJumpActive && aiming)
					character.onPreciseJumpAim(x, y);
			},
		});
		viewportMouse = owner;
		return () => {
			owner.destroy();
			if (viewportMouse === owner) viewportMouse = null;
		};
	});

	function handlePointerMove(event: PointerEvent): void {
		if (!inputGate.allowed || viewportMouse?.active) return;
		pointerX = event.clientX;
		pointerY = event.clientY;
		hasPointerPosition = true;
		if (character.preciseJumpActive)
			character.onPreciseJumpAim(event.clientX, event.clientY);
	}

	function handlePointerEnter(event: PointerEvent): void {
		pointerInsideCanvas = true;
		pointerX = event.clientX;
		pointerY = event.clientY;
		hasPointerPosition = true;
	}

	function handlePointerLeave(): void {
		pointerInsideCanvas = false;
		world.onViewportHoverClear();
	}

	/** Cancel pointer ownership on keyboard/editor handoff or settings replacement. */
	export function cancelMouseInput(): void {
		viewportMouse?.cancel();
	}

	function handleWheel(event: WheelEvent): void {
		if (!inputGate.allowed || world.cameraController === null) return;
		event.preventDefault();
		if (character.preciseJumpActive && event.shiftKey) {
			character.onPreciseJumpPowerAdjust(
				-Math.sign(event.deltaY === 0 ? event.deltaX : event.deltaY),
			);
			return;
		}
		world.cameraController.zoom(event.deltaY * 0.01);
	}

	/** Explorer-wide context-click policy for entity-bearing HUD cells and the viewport. */
	function handleContextMenu(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest(".client-canvas")) {
			event.preventDefault();
			return;
		}
		const cell = target?.closest<HTMLElement>(
			".item-grid-cell[data-item-guid]:not(:disabled), .loadout-item-cell[data-item-guid], [data-action-cell][data-action-item]",
		);
		if (cell === undefined || cell === null || !worldElement?.contains(cell))
			return;
		const encodedGuid = cell.dataset.itemGuid ?? cell.dataset.actionItem;
		const guid = Number(encodedGuid);
		if (!Number.isSafeInteger(guid) || guid < 0)
			throw new Error(`Invalid item cell GUID ${encodedGuid ?? "missing"}`);
		event.preventDefault();
		world.onExamineItem(guid);
	}
	let logopolisVisible = $state(false);
	$effect(() => {
		if (shell.logopolisLaunchRevision > 0) logopolisVisible = true;
	});
</script>

<main
	bind:this={worldElement}
	class="client-world ui-theme"
	class:combining
	data-combine-eligibility={combineEligibility}
	onpointerover={considerPointer}
	onpointerleave={() => (combineSurface = null)}
	oncontextmenu={handleContextMenu}
	onpointerdowncapture={(event) => {
		if (
			event.target instanceof Element &&
			event.target.closest(".layout-handle")
		)
			inventory.itemInteractions?.cancel();
	}}
	aria-label="Holtburger client world"
>
	{#if consoleOpen && shell.hudMode === "runtime"}
		<ClientRuntimeConsole
			onClose={() => (consoleOpen = false)}
			onToggle={() => (consoleOpen = !consoleOpen)}
		/>
	{/if}
	{#key character.characterGuid}
		<ClientVitalWarningOverlay
			vitals={character.vitals}
			enabled={character.vitalWarningsEnabled}
			thresholds={settings.ui.vitalWarningThresholds}
		/>
	{/key}
	<ClientCombatTargetIndicator
		readFrame={combatMagic.readCombatTargetFrame}
		active={combatMagic.combatStatus.desired !== null ||
			combatMagic.spellCastTarget !== null}
	/>
	<ClientLockFeedback
		readFrames={combatMagic.readLockFeedbackFrames}
		isActive={combatMagic.hasActiveLockFeedback}
		wakeRevision={combatMagic.lockFeedbackWakeRevision}
	/>
	<ClientTargetIndicator
		readFrame={world.readTargetIndicatorFrame}
		selectedGuid={world.selectedEntityGuid}
	/>
	<div
		class="gameplay-controls"
		bind:this={uiElement}
		use:applyUiScale={settings.ui.uiScale}
	>
		<HudCornerControls
			bind:this={systemMenu}
			hudMode={shell.hudMode}
			onToggleHudMode={() =>
				shell.onHudModeChange(
					shell.hudMode === "runtime" ? "layout" : "runtime",
				)}
			menuItems={systemMenuItems}
			canShowMenu={shell.canReturnToMenu || shell.canDisconnect}
			onMenuSelect={(action) => {
				if (action === "logout") shell.onReturnToMainMenu();
				else if (action === "disconnect") shell.onDisconnect();
				else
					void requestElectronClientClose().catch((error) =>
						console.error(error),
					);
			}}
		/>

		<Minimap
			readFrame={world.readMinimapFrame}
			onClearWaypoint={world.onClearWaypoint}
			viewState={minimap}
			minSize={CLIENT_UI_DEFAULTS.minimap.minSize}
			resizeBounds={{
				...minimapViewport,
				footerWidth: minimapFooterExtent.width,
			}}
			resizable={CLIENT_UI_DEFAULTS.minimap.resizable}
			editable={shell.hudMode === "layout"}
			onGeometryChange={updateMinimapGeometry}
			onViewDiametersChange={settings.onMinimapViewDiametersChange}
			onFooterExtentChange={(extent) => {
				if (
					extent.width !== minimapFooterExtent.width ||
					extent.height !== minimapFooterExtent.height
				)
					minimapFooterExtent = extent;
			}}
			onSelectEntity={world.onSelectEntity}
			onCoordinatesCopied={world.onCoordinatesCopied}
		>
			{#snippet actions()}
				<button
					class="ui-button ui-icon-button ui-minimap-button"
					class:nearby-alert-active={nearbyAlertActive}
					type="button"
					aria-label="Nearby entities and alerts"
					title={`Nearby entities and alerts (${nearbyShortcut.description})`}
					aria-pressed={nearbyOpen}
					disabled={world.nearby === null}
					onclick={() => (nearbyOpen = !nearbyOpen)}
					><ClientHudIcon name="nearby" /></button
				>
			{/snippet}
			{#snippet coordinateDetails()}<ClientMinimapEnvironment
					readEnvironment={settings.readServerEnvironment}
					clockFormat={settings.clockFormat}
				/>{/snippet}
		</Minimap>
		{#if inventory.actionBars !== null && inventory.inventory !== null && inventory.itemSession !== null && worldElement !== null && inventory.itemInteractions !== null}
			{#key inventory.inventory}
				<ClientActionBars
					input={settings.input}
					displayPlatform={shell.platform}
					bars={inventory.actionBars}
					onBarsChange={inventory.onActionBarsChange}
					onResetOwner={(reset) => (resetActionBars = reset)}
					session={inventory.itemSession}
					worldContainer={inventory.worldContainer}
					vendor={inventory.vendor}
					houseCrystal={inventory.houseCrystal}
					salvage={inventory.salvage}
					trade={inventory.trade}
					onDragOwner={(owner) => (itemDrag = owner)}
					onPickInventoryTarget={inventory.onPickInventoryTarget}
					onInventoryNotice={inventory.onInventoryNotice}
					interactions={inventory.itemInteractions}
					onSelectDragItem={(guid) =>
						inventory.onSelectContentsItem(guid, "select")}
					root={shell.interactionRoot}
					inventory={inventory.inventory}
					{viewport}
					editable={shell.hudMode === "layout"}
				/>
				<ClientLoadoutBuilder
					inventory={inventory.inventory}
					capture={loadoutCapture}
					owner={itemDrag}
					{viewport}
					onClose={() => (loadoutCapture = null)}
				/>
			{/key}
		{/if}

		{#if inventory.actionBars !== null && combatMagic.spells !== null && (combatMagic.spellBarEnabled || (previewHud && combatMagic.combatMode !== "melee" && combatMagic.combatMode !== "missile"))}
			<ClientSpellBar
				input={settings.input}
				displayPlatform={shell.platform}
				spells={combatMagic.spells}
				inventory={inventory.inventory}
				itemInteractions={inventory.itemInteractions}
				configuration={combatMagic.spellBar}
				enabled={combatMagic.spellBarEnabled}
				placement={settings.hudLayout.spellBar}
				shape={settings.spellBarShape}
				editable={shell.hudMode === "layout"}
				{viewport}
				onPlacementChange={(placement) =>
					changeHudPlacement("spellBar", placement)}
				onShapeChange={settings.onSpellBarShapeChange}
				onSelectTab={combatMagic.onSelectSpellTab}
				onActivateCell={combatMagic.onActivateSpellCell}
				onActivateCaster={combatMagic.onActivateCasterSpell}
				onExamineSpell={world.onExamineSpell}
			/>
		{/if}
		{#if combatMagic.combatMode === "melee" || combatMagic.combatMode === "missile"}
			<ClientCombatBar
				characterSheet={character.characterSheet}
				showHelpLabels={settings.ui.showHelpLabels}
				inventory={inventory.inventory}
				input={settings.input}
				displayPlatform={shell.platform}
				placement={settings.hudLayout.combatBar}
				editable={shell.hudMode === "layout"}
				{viewport}
				status={combatMagic.combatStatus}
				selectionRevision={combatMagic.combatProfileSelectionRevision}
				profile={combatMagic.combatMode === "melee"
					? { kind: "melee", ...combatMagic.combatControls.melee }
					: { kind: "missile", ...combatMagic.combatControls.missile }}
				enabled={combatMagic.combatEnabled && shell.hudMode === "runtime"}
				onPlacementChange={(placement) =>
					changeHudPlacement("combatBar", placement)}
				onProfileSelect={combatMagic.onCombatProfileSelect}
				onStopCombat={combatMagic.onStopCombat}
			/>
		{/if}

		<ClientHudPanel
			label="Character HUD"
			placement={settings.hudLayout.character}
			editable={shell.hudMode === "layout"}
			minWidth={CLIENT_UI_DEFAULTS.character.minSize.width}
			minHeight={CLIENT_UI_DEFAULTS.character.minSize.height}
			contentHeight={characterContentHeight}
			resizable={CLIENT_UI_DEFAULTS.character.resizable}
			contentHitTesting="surface"
			{viewport}
			onPlacementChange={(placement) =>
				changeHudPlacement("character", placement)}
		>
			<ClientCharacterHud
				onContentHeightChange={(height) => (characterContentHeight = height)}
				playerName={character.playerName}
				worldName={character.worldName}
				accountName={character.accountName}
				vitals={character.vitals}
				readConnection={character.readConnection}
				characterSheet={character.characterSheet}
			/>
		</ClientHudPanel>
		{#if social.partyHudPresent || previewHud}
			<ClientPartyHud
				readPartyHudDisplay={social.readPartyHudDisplay}
				onSelectEntity={social.onSelectPartyMember}
				preview={!social.partyHudPresent}
				placement={settings.hudLayout.partyHud}
				editable={shell.hudMode === "layout"}
				resizable={CLIENT_UI_DEFAULTS.partyHud.resizable}
				{viewport}
				onPlacementChange={(placement) =>
					changeHudPlacement("partyHud", placement)}
			/>
		{/if}

		<ClientStatusTray
			preview={previewHud}
			placement={settings.hudLayout.statusTray}
			editable={shell.hudMode === "layout"}
			{viewport}
			inventory={inventory.inventory}
			enchantments={enchantmentTray}
			onOpenEnchantments={openEnchantments}
			onOpenInventory={() => (activePanel = "inventory")}
			onPlacementChange={(placement) =>
				changeHudPlacement("statusTray", placement)}
		/>

		{#if character.jumpChargeActive || character.preciseJumpActive || previewHud}
			<ClientHudPanel
				label="Jump power"
				placement={settings.hudLayout.jumpPower}
				editable={shell.hudMode === "layout"}
				minWidth={CLIENT_UI_DEFAULTS.jumpPower.minSize.width}
				minHeight={CLIENT_UI_DEFAULTS.jumpPower.minSize.height}
				resizable={CLIENT_UI_DEFAULTS.jumpPower.resizable}
				contentHitTesting="descendants"
				{viewport}
				onPlacementChange={(placement) =>
					changeHudPlacement("jumpPower", placement)}
			>
				<HudJumpPowerBar
					active={character.jumpChargeActive || character.preciseJumpActive}
					previewExtent={previewHud ? HUD_PREVIEW_JUMP_EXTENT : null}
					precise={character.preciseJumpActive}
					readExtent={character.readJumpExtent}
					powerKeys={character.jumpPowerKeys}
					powerControl={shell.hudMode === "runtime" &&
					character.preciseJumpActive
						? {
								setPower: character.onPreciseJumpPowerSet,
								minimumPower: MINIMUM_JUMP_POWER,
							}
						: null}
				/>
			</ClientHudPanel>
		{/if}
		{#if shell.toast !== null || combining || previewHud}
			<ClientHudPanel
				label="Notifications"
				placement={settings.hudLayout.toast}
				editable={shell.hudMode === "layout"}
				minWidth={CLIENT_UI_DEFAULTS.toast.minSize.width}
				minHeight={CLIENT_UI_DEFAULTS.toast.minSize.height}
				resizable={CLIENT_UI_DEFAULTS.toast.resizable}
				contentHitTesting="descendants"
				{viewport}
				onPlacementChange={(placement) =>
					changeHudPlacement("toast", placement)}
			>
				<HudToastOverlay
					toast={shell.toast}
					persistentMessage={itemInteraction.kind === "acquiring"
						? {
								kind: "status",
								message: `Use ${itemInteraction.name} on… (Escape to cancel)`,
							}
						: previewHud
							? { kind: "preview", message: HUD_PREVIEW_TOAST_MESSAGE }
							: null}
				/>
			</ClientHudPanel>
		{/if}
		<ClientHudPanel
			label="Chat"
			placement={settings.hudLayout.chat}
			editable={shell.hudMode === "layout"}
			minWidth={CLIENT_UI_DEFAULTS.chat.minSize.width}
			minHeight={CLIENT_UI_DEFAULTS.chat.minSize.height}
			resizable={CLIENT_UI_DEFAULTS.chat.resizable}
			contentHitTesting="descendants"
			{viewport}
			onPlacementChange={(placement) => changeHudPlacement("chat", placement)}
		>
			{#key social.chatComposer.generation}
				<ClientChat
					bind:this={chatEditor}
					composer={social.chatComposer}
					onSetWaypoint={world.onSetWaypoint}
					messages={social.chatMessages}
					clockFormat={settings.clockFormat}
					sentHistory={social.sentChatHistory}
					onSend={social.onSendChat}
					onSendError={social.onSendChatError}
					onSelectEntity={world.onSelectKnownEntity}
					onNotice={social.onChatNotice}
					channelFilters={settings.chatChannelFilters}
					onChannelFiltersChange={settings.onChatChannelFiltersChange}
					enabledTags={settings.chatFilters}
					showTimestamps={settings.chatTimestamps}
					onShowTimestampsChange={settings.onChatTimestampsChange}
					onEnabledTagsChange={settings.onChatFiltersChange}
				/>
			{/key}
		</ClientHudPanel>
		{#if settings.ui.showFps}
			<ClientHudPanel
				label="Frame rate"
				placement={settings.hudLayout.frameRate}
				editable={shell.hudMode === "layout"}
				minWidth={CLIENT_UI_DEFAULTS.frameRate.minSize.width}
				minHeight={CLIENT_UI_DEFAULTS.frameRate.minSize.height}
				resizable={CLIENT_UI_DEFAULTS.frameRate.resizable}
				contentHitTesting="descendants"
				{viewport}
				onPlacementChange={(placement) =>
					changeHudPlacement("frameRate", placement)}
			>
				<HudFpsCounter
					readFrameRates={shell.readFrameRates}
					diagnosticsTuning={CLIENT_TUNING.diagnostics}
				/>
			</ClientHudPanel>
		{/if}
		{#if world.selectedEntityGuid !== null || previewHud}
			<ClientHudPanel
				label="Selected entity"
				placement={settings.hudLayout.selectedEntity}
				editable={shell.hudMode === "layout"}
				minWidth={CLIENT_UI_DEFAULTS.selectedEntity.minSize.width}
				minHeight={CLIENT_UI_DEFAULTS.selectedEntity.minSize.height}
				resizable={CLIENT_UI_DEFAULTS.selectedEntity.resizable}
				contentHitTesting="descendants"
				{viewport}
				onPlacementChange={(placement) =>
					changeHudPlacement("selectedEntity", placement)}
			>
				<ClientSelectedEntityHud
					tell={{
						available: () =>
							chatEditor !== undefined &&
							social.chatComposer.selection.kind === "target",
						activate: () => {
							void chatEditor?.tellSelected();
						},
					}}
					input={settings.input}
					displayPlatform={shell.platform}
					selectedGuid={world.selectedEntityGuid}
					readCanCorpsePermission={() =>
						social.readCanSetCorpsePermission() && selectedPlayer() !== null}
					onCorpsePermission={(granted) => {
						const target = selectedPlayer();
						if (target !== null && social.readCanSetCorpsePermission())
							social.onCorpsePermission(target.name, granted);
					}}
					readCanSalvage={() =>
						world.selectedEntityGuid !== null &&
						inventory.salvage?.canQueue(world.selectedEntityGuid) === true}
					onSalvage={() => {
						if (world.selectedEntityGuid !== null)
							inventory.salvage?.add(world.selectedEntityGuid);
					}}
					readCanSplit={canSplitSelectedEntity}
					readCanAutoMerge={canAutoMergeSelectedContainer}
					onAutoMerge={autoMergeSelectedContainer}
					readCanAddFriend={() => friendTarget() !== null}
					readCanIgnoreAccount={() => ignoreTarget() !== null}
					onAddFriend={addSelectedFriend}
					onIgnoreAccount={ignoreSelectedAccount}
					readCanSwear={() => swearTarget() !== null}
					onSwear={() => {
						const guid = swearTarget();
						if (guid !== null)
							void social.allegiance?.request({ kind: "swear", guid });
					}}
					readCanInvite={() => inviteTarget() !== null}
					onInvite={() => {
						const target = inviteTarget();
						if (target !== null)
							social.party?.request({ kind: "invite", target });
					}}
					readSelectedDisplay={() => {
						const display = world.readSelectedEntityDisplay();
						return itemInteraction.kind === "acquiring" &&
							world.selectedEntityGuid !== null
							? { ...display, canInteract: true, interactionLabel: "Interact" }
							: display;
					}}
					onInteract={world.onInteractEntity}
					onExamine={world.onExamineEntity}
					examinePending={world.inspection.kind === "pending" &&
						world.inspection.guid === world.selectedEntityGuid}
					onSplit={splitSelectedEntity}
				/>
			</ClientHudPanel>
		{/if}
		<div
			class="emote-activation"
			tabindex="-1"
			use:keyboard.scope={{
				transient: true,
				activation: (event) => {
					if (
						event.repeat ||
						!social.emotesEnabled ||
						shell.hudMode !== "runtime" ||
						social.chatComposer.emotes === null ||
						!clientInput.shortcut("openEmotes", event)
					)
						return false;
					openEmotes(event);
					return true;
				},
				keydown: () => {},
			}}
		></div>
		{#if emoteWheel !== null && social.chatComposer.emotes !== null}
			<ClientEmoteWheel
				catalog={social.chatComposer.emotes}
				recent={social.chatComposer.recentEmotes}
				onClose={() => {
					closeEmotes();
				}}
				onExecute={executeEmote}
			/>
		{/if}

		<ClientShortcutDock
			session={inventory.itemSession}
			inventory={inventory.inventory}
			placement={settings.hudLayout.shortcuts}
			editable={shell.hudMode === "layout"}
			{viewport}
			onPlacementChange={(placement) =>
				changeHudPlacement("shortcuts", placement)}
			input={settings.input}
			displayPlatform={shell.platform}
			combatMode={combatMagic.combatMode}
			combatEnabled={combatMagic.combatEnabled}
			onToggleCombat={combatMagic.onToggleCombat}
			{shortcuts}
			{activePanel}
			onToggle={toggleSystemPanel}
		/>
		{#if inventory.worldContainer !== null && inventory.itemInteractions !== null}
			{#key inventory.worldContainer}
				<ClientWorldContainerWindow
					model={inventory.worldContainer}
					interactions={inventory.itemInteractions}
					selectedGuid={world.selectedEntityGuid}
					onSelectItem={(guid) =>
						inventory.onSelectContentsItem(guid, "select")}
					placement={settings.hudLayout.worldContainer}
					{viewport}
					onPlacementChange={(placement) =>
						changeHudPlacement("worldContainer", placement)}
				/>
			{/key}
		{/if}
		{#if inventory.locks !== null && inventory.inventory !== null}
			{#key inventory.locks}
				<ClientLocksWindow
					model={inventory.locks}
					inventory={inventory.inventory}
					placement={settings.hudLayout.locks}
					{viewport}
					onPlacementChange={(placement) =>
						changeHudPlacement("locks", placement)}
					onExamineItem={world.onExamineItem}
				/>
			{/key}
		{/if}
		{#if inventory.salvage !== null && inventory.inventory !== null}
			{#key inventory.salvage}
				<ClientSalvageWindow
					model={inventory.salvage}
					inventory={inventory.inventory}
					placement={settings.hudLayout.salvage}
					{viewport}
					onPlacementChange={(placement) =>
						changeHudPlacement("salvage", placement)}
					selectedGuid={world.selectedEntityGuid}
					onSelectItem={world.onSelectEntity}
					onExamineItem={world.onExamineItem}
				/>
			{/key}
		{/if}
		{#if inventory.barber !== null}
			{#key inventory.barber}<ClientBarberWindow
					model={inventory.barber}
					placement={settings.hudLayout.barber}
					{viewport}
					onPlacementChange={(placement) =>
						changeHudPlacement("barber", placement)}
				/>{/key}
		{/if}
		{#if inventory.trade !== null}
			{#key inventory.trade}
				<ClientTradeWindow
					inputSettings={settings.input}
					displayPlatform={shell.platform}
					model={inventory.trade}
					selectedGuid={world.selectedEntityGuid}
					placement={settings.hudLayout.trade}
					{viewport}
					onPlacementChange={(placement) =>
						changeHudPlacement("trade", placement)}
					onSelectItem={(guid) =>
						inventory.onSelectContentsItem(guid, "select")}
					onExamineItem={world.onExamineItem}
				/>
			{/key}
		{/if}
		{#if inventory.vendor !== null}
			{#key inventory.vendor}
				<ClientVendorWindow
					inputSettings={settings.input}
					displayPlatform={shell.platform}
					model={inventory.vendor}
					placement={settings.hudLayout.vendor}
					{viewport}
					onPlacementChange={(placement) =>
						changeHudPlacement("vendor", placement)}
					onExamineItem={world.onExamineItem}
				/>
			{/key}
		{/if}
		{#if inventory.houseCrystal !== null}
			{#key inventory.houseCrystal}
				<ClientHouseCrystalWindow
					model={inventory.houseCrystal}
					placement={settings.hudLayout.houseCrystal}
					{viewport}
					onPlacementChange={(placement) =>
						changeHudPlacement("houseCrystal", placement)}
					onExamineItem={world.onExamineItem}
				/>
			{/key}
		{/if}
		{#if world.inspection.kind === "ready" || world.inspection.kind === "spell"}
			{#key world.inspection.kind === "spell" ? `spell:${world.inspection.spellId}` : `object:${world.inspection.guid}`}
				<ClientInspectionWindow
					itemInteractions={inventory.itemInteractions}
					itemSelection={world.inspectionItemSelection}
					selectedGuid={world.selectedEntityGuid}
					onSetWaypoint={world.onSetWaypoint}
					subject={world.inspection}
					objectPreviewService={world.objectPreviewService}
					spells={combatMagic.spells}
					icons={combatMagic.spells?.icons ??
						inventory.inventory?.icons ??
						null}
					placement={settings.hudLayout.inspection}
					{viewport}
					previewHeight={settings.inspectionPreviewHeight}
					onClose={world.onCloseInspection}
					onPlacementChange={(placement) =>
						changeHudPlacement("inspection", placement)}
					onPreviewHeightChange={settings.onInspectionPreviewHeightChange}
				/>
			{/key}
		{/if}
		<ClientLogopolisWindow
			launchRevision={shell.logopolisLaunchRevision}
			visible={logopolisVisible}
			placement={settings.hudLayout.logopolis}
			{viewport}
			onClose={() => (logopolisVisible = false)}
			onPlacementChange={(placement) =>
				changeHudPlacement("logopolis", placement)}
		/>
		{#if world.bookReader.kind !== "idle"}
			{#key world.bookReader.revision}
				<ClientBookWindow
					onSetWaypoint={world.onSetWaypoint}
					reader={world.bookReader}
					placement={settings.hudLayout.book}
					{viewport}
					onClose={world.onCloseBook}
					onRetry={world.onRetryBook}
					onPlacementChange={(placement) =>
						changeHudPlacement("book", placement)}
				/>
			{/key}
		{/if}

		{#if character.characterSheet !== null && inventory.inventory !== null}
			{#key character.characterSheet}
				<ClientHudWindow
					icon="training"
					title="Character"
					visible={activePanel === "characterSheet"}
					placement={settings.hudLayout.characterSheet}
					minWidth={CLIENT_UI_DEFAULTS.characterSheet.minSize.width}
					minHeight={CLIENT_UI_DEFAULTS.characterSheet.minSize.height}
					{viewport}
					onClose={() => (activePanel = null)}
					onPlacementChange={(placement) =>
						changeHudPlacement("characterSheet", placement)}
				>
					<ClientCharacterSheetPanel
						statArtwork={character.statArtwork}
						icons={inventory.inventory.icons}
						owner={character.characterSheet}
						visible={activePanel === "characterSheet"}
						spells={combatMagic.spells}
						enchantments={character.enchantments}
						castEnabled={combatMagic.combatEnabled &&
							combatMagic.combatMode === "magic"}
						onCastSpell={combatMagic.onCastSpell}
					/>
				</ClientHudWindow>
			{/key}
		{/if}

		{#if world.worldMapSource !== null}
			{#key world.worldMapSource}
				<ClientHudWindow
					icon="world"
					title="World"
					focusRevision={waypointFocusRevision}
					visible={activePanel === "world"}
					placement={settings.hudLayout.world}
					minWidth={CLIENT_UI_DEFAULTS.world.minSize.width}
					minHeight={CLIENT_UI_DEFAULTS.world.minSize.height}
					{viewport}
					onClose={() => (activePanel = null)}
					onPlacementChange={(placement) =>
						changeHudPlacement("world", placement)}
				>
					<ClientWorldPanel
						{waypointReveal}
						contracts={social.contracts}
						source={world.worldMapSource}
						characterGuid={character.characterGuid}
						housing={world.housing}
						housingManagement={world.housingManagement}
						onRefreshHousing={world.onRefreshHousing}
						onSearchHousing={world.onSearchHousing}
						canTeleportFromMap={world.canTeleportFromMap}
						onSetWaypoint={world.onSetWaypoint}
						recallDestinations={world.recallDestinations}
						onRecall={world.onRecall}
						onTeleportToMapPosition={world.onTeleportToMapPosition}
						visible={activePanel === "world"}
						readFrame={world.readMinimapFrame}
					/>
				</ClientHudWindow>
			{/key}
		{/if}

		{#if social.party !== null && social.friends !== null && social.squelch !== null && social.allegiance !== null}
			{#key social.party}
				<ClientHudWindow
					icon="party"
					title="Social"
					visible={activePanel === "social"}
					placement={settings.hudLayout.social}
					minWidth={CLIENT_UI_DEFAULTS.social.minSize.width}
					minHeight={CLIENT_UI_DEFAULTS.social.minSize.height}
					{viewport}
					onClose={() => (activePanel = null)}
					onPlacementChange={(placement) =>
						changeHudPlacement("social", placement)}
				>
					<ClientSocialPanel
						owner={social.party}
						onSelectEntity={social.onSelectPartyMember}
						friends={social.friends}
						squelch={social.squelch}
						allegiance={social.allegiance}
						visible={activePanel === "social"}
					/>
				</ClientHudWindow>
			{/key}
		{/if}

		{#if social.contracts !== null}
			{#key social.contracts}
				<ClientHudWindow
					icon="journal"
					title="Journal"
					visible={activePanel === "journal"}
					placement={settings.hudLayout.journal}
					minWidth={CLIENT_UI_DEFAULTS.journal.minSize.width}
					minHeight={CLIENT_UI_DEFAULTS.journal.minSize.height}
					{viewport}
					onClose={() => (activePanel = null)}
					onPlacementChange={(placement) =>
						changeHudPlacement("journal", placement)}
				>
					<ClientJournalPanel
						onSetWaypoint={world.onSetWaypoint}
						owner={social.contracts}
						visible={activePanel === "journal"}
						onNotice={social.onSocialNotice}
					/>
				</ClientHudWindow>
			{/key}
		{/if}

		{#if world.nearby !== null}{#key world.nearby}{#key character.characterGuid}
					<ClientHudWindow
						icon="nearby"
						title="Nearby"
						visible={nearbyOpen}
						placement={settings.hudLayout.nearby}
						minWidth={CLIENT_UI_DEFAULTS.nearby.minSize.width}
						minHeight={CLIENT_UI_DEFAULTS.nearby.minSize.height}
						{viewport}
						onClose={() => (nearbyOpen = false)}
						onPlacementChange={(placement) =>
							changeHudPlacement("nearby", placement)}
					>
						<ClientNearbyPanel
							owner={world.nearby}
							visible={nearbyOpen}
							selectedGuid={world.selectedEntityGuid}
							onSelectEntity={world.onSelectKnownEntity}
							onExamineEntity={world.onExamineItem}
							onSetWaypoint={world.onSetWaypoint}
						/>
					</ClientHudWindow>
				{/key}{/key}{/if}

		{#if activePanel !== null && activePanel !== "world" && activePanel !== "social" && activePanel !== "journal" && activePanel !== "characterSheet"}
			{@const panel = activePanel}
			{#key panel}
				<ClientHudWindow
					icon={panel}
					title={panel === "inventory"
						? "Inventory"
						: panel === "settings"
							? "Settings"
							: "Client diagnostics"}
					placement={settings.hudLayout[panel]}
					minWidth={CLIENT_UI_DEFAULTS[panel].minSize.width}
					minHeight={CLIENT_UI_DEFAULTS[panel].minSize.height}
					{viewport}
					onClose={() => (activePanel = null)}
					onPlacementChange={(placement) =>
						changeHudPlacement(panel, placement)}
				>
					{#if panel === "inventory"}
						{#if inventory.inventory !== null && inventory.itemInteractions !== null}
							{#key inventory.inventory}
								<ClientInventoryPanel
									onSaveLoadout={openLoadoutBuilder}
									input={settings.input}
									displayPlatform={shell.platform}
									interactions={inventory.itemInteractions}
									inventory={inventory.inventory}
									vendor={inventory.vendor}
									trade={inventory.trade}
									salvage={inventory.salvage}
									selectedGuid={world.selectedEntityGuid}
									onSelectItem={(guid) =>
										inventory.onSelectContentsItem(guid, "toggle")}
									requestedSplit={requestedInventorySplit}
									appearanceOptions={character.appearanceOptions}
									onAppearanceOptionChange={character.onAppearanceOptionChange}
									onRequestedSplitConsumed={(request) => {
										if (requestedInventorySplit === request)
											requestedInventorySplit = null;
									}}
								/>
							{/key}
						{/if}
					{:else if panel === "settings"}
						{#key character.characterGuid}
							<ClientSettingsPanel
								lockInteractions={settings.lockInteractions}
								onLockInteractionsChange={settings.onLockInteractionsChange}
								camera={settings.camera}
								onCameraChange={settings.onCameraChange}
								chatSuppression={settings.chatSuppression}
								onChatSuppressionChange={settings.onChatSuppressionChange}
								gameplayPreferences={character.gameplayPreferences}
								gameplayEnabled={character.gameplayEnabled}
								onGameplayOptionChange={character.onGameplayOptionChange}
								theme={settings.theme}
								displayPlatform={shell.platform}
								audio={settings.audio}
								onAudioChange={settings.onAudioChange}
								graphics={settings.graphics}
								ui={settings.ui}
								input={settings.input}
								textureFilteringCapabilities={settings.textureFilteringCapabilities}
								selectedTab={settingsTab}
								onSelectTab={(tab) => (settingsTab = tab)}
								onGraphicsChange={settings.onGraphicsChange}
								nameplates={settings.nameplates}
								onNameplatesChange={settings.onNameplatesChange}
								onUiChange={settings.onUiChange}
								clockFormat={settings.clockFormat}
								environmentOverrides={settings.environmentOverrides}
								weatherPresets={settings.weatherPresets}
								environmentIssue={settings.environmentIssue}
								onClockFormatChange={settings.onClockFormatChange}
								onEnvironmentOverridesChange={settings.onEnvironmentOverridesChange}
								onInputChange={settings.onInputChange}
								canResetHudPlacements={resetActionBars !== null}
								onResetHudPlacements={resetHudPlacements}
							/>
						{/key}
					{:else}
						<ClientDebugPanel
							readPerformanceSession={shell.readPerformanceSession}
							readDiagnostics={shell.readDiagnostics}
							readSelectedEntity={world.readSelectedEntity}
							entityCollisionDisabled={shell.entityCollisionDisabled}
							onEntityCollisionDisabledChange={shell.onEntityCollisionDisabledChange}
							unrestrictedUse={shell.unrestrictedUse}
							onUnrestrictedUseChange={shell.onUnrestrictedUseChange}
							showRetailHiddenGeometry={shell.showRetailHiddenGeometry}
							onShowRetailHiddenGeometryChange={shell.onShowRetailHiddenGeometryChange}
						/>
					{/if}
				</ClientHudWindow>
			{/key}
		{/if}
		{#if enchantmentsOpen}
			<ClientHudWindow
				icon="buffed"
				title="Enchantments"
				placement={settings.hudLayout.enchantments}
				minWidth={CLIENT_UI_DEFAULTS.enchantments.minSize.width}
				minHeight={CLIENT_UI_DEFAULTS.enchantments.minSize.height}
				{viewport}
				focusRevision={enchantmentLaunch?.revision ?? 0}
				onClose={() => (enchantmentsOpen = false)}
				onPlacementChange={(placement) =>
					changeHudPlacement("enchantments", placement)}
			>
				<ClientEnchantmentsPanel
					enchantments={character.enchantments}
					spells={combatMagic.spells}
					launch={enchantmentLaunch}
				/>
			</ClientHudWindow>
		{/if}
	</div>
</main>

<style>
	@layer components {
		:global(.client-canvas[data-combining="neutral"]) {
			cursor:
				url("../inventory/combine-cursor.svg") 12 12,
				crosshair;
		}
		:global(.client-canvas[data-combining="eligible"]) {
			cursor:
				url("../inventory/combine-cursor-eligible.svg") 12 12,
				crosshair;
		}
		:global(.client-canvas[data-combining="ineligible"]) {
			cursor:
				url("../inventory/combine-cursor-ineligible.svg") 12 12,
				crosshair;
		}
		.combining {
			--combine-cursor: url("../inventory/combine-cursor.svg") 12 12, crosshair;
		}
		.combining[data-combine-eligibility="eligible"] {
			--combine-cursor:
				url("../inventory/combine-cursor-eligible.svg") 12 12, crosshair;
		}
		.combining[data-combine-eligibility="ineligible"] {
			--combine-cursor:
				url("../inventory/combine-cursor-ineligible.svg") 12 12, crosshair;
		}
		.client-world.combining :global(.item-grid-cell:not(:disabled)),
		.client-world.combining :global(.action-cell:not(:disabled)) {
			cursor: var(--combine-cursor);
		}
	}
	@layer components {
		.client-world {
			position: fixed;
			inset: 0;
			overflow: hidden;
			pointer-events: none;
		}
		.gameplay-controls {
			position: absolute;
			inset: 0;
			pointer-events: none;
		}
		/* The scaling boundary has a real box; only its surfaces may intercept the world.
		 * Low specificity preserves each surface's explicit pass-through policy. */
		:where(.gameplay-controls) > :global(*) {
			pointer-events: auto;
		}

		.nearby-alert-active {
			--ui-hud-pulse-intensity: 0.7;
			color: var(--ui-minimap-alert-color);
			border-color: var(--ui-minimap-alert-color);
			box-shadow: 0 0 4px var(--ui-minimap-alert-color);
			animation-name: var(--ui-hud-pulse-animation), nearby-alert-glow;
			animation-duration: 1000ms;
			animation-timing-function: var(--ui-hud-pulse-easing);
			animation-iteration-count: infinite;
		}
		@keyframes nearby-alert-glow {
			0%,
			100% {
				box-shadow: 0 0 4px var(--ui-minimap-alert-color);
			}
			50% {
				box-shadow: 0 0 14px 4px var(--ui-minimap-alert-color);
			}
		}
		@media (prefers-reduced-motion: reduce) {
			.nearby-alert-active {
				animation: none;
			}
		}
	}
</style>
