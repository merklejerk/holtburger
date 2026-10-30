<script lang="ts">
	import type { ClientContractsState } from "./client-contracts-state";
	import { ContractMapOverlay } from "./client-contracts-map-overlay";
	import { CLIENT_TUNING } from "./client-tuning";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import PopupMenu, { type PopupMenuItem } from "../app/PopupMenu.svelte";
	import { RECALL_LABELS } from "./client-recall";
	import UiTabs from "../app/UiTabs.svelte";
	import UiTabPanel from "../app/UiTabPanel.svelte";
	import type { ClientHousingManagementState } from "./client-housing-management-state";
	import ClientHousingTab from "./ClientHousingTab.svelte";
	import type { HousingSnapshot } from "./client-housing-contract";
	import { housingMapPosition } from "./client-housing-map";
	import WorldMapHomeIcon from "../assets/icons/world-map-home.svg?component";
	import { projectWorldMapPoint } from "../lib/game/world-map/view";
	import { onMount, untrack } from "svelte";
	import type { MinimapFrame } from "../app/minimap-frame";
	import { trackWorldMapGesture } from "../lib/game/world-map/pointer-gesture";
	import type {
		ClientMapPosition,
		RecallDestination,
	} from "./client-host-contract";
	import {
		WorldMapOwner,
		type WorldMapState,
	} from "../lib/game/world-map/owner";
	import type { WorldMapSource } from "../lib/game/world-map/types";
	import { worldMapPlayer, worldMapPosition } from "../lib/game/world-map/view";
	import { WORLD_MAP_SETTLEMENTS } from "../lib/game/world-map/world-map-settlements";
	import { WorldMapSettlementOverlay } from "../lib/game/world-map/settlement-overlay";
	import { SHARED_FRONTEND_TUNING } from "../lib/frontend-tuning";
	import {
		formatWorldMapCoordinates,
		sceneMapPoint,
	} from "../lib/game/map/map-coordinates";
	import MapWaypointPinIcon from "../assets/icons/map-waypoint-pin.svg?component";
	import {
		waypointFromMapPoint,
		type MapWaypointTarget,
	} from "../lib/game/map/map-waypoint";
	import WorldMapPlayerIcon from "../assets/icons/world-map-player.svg?component";
	import ClientHudIcon from "./ClientHudIcon.svelte";

	import { HousingSearchOverlay } from "./client-housing-search-overlay";

	interface Props {
		/** Session-owned unfiltered facts, independent of Journal window state. */
		readonly contracts: ClientContractsState | null;
		/** Cold character identity resets the search filter independently of transport lifetime. */
		readonly characterGuid: number | null;
		readonly housing: HousingSnapshot;
		readonly housingManagement: ClientHousingManagementState | null;
		readonly onRefreshHousing: () => Promise<void>;
		readonly onSearchHousing: (houseType: number) => Promise<void>;
		/** One mounted transport's static map capability. */
		readonly source: WorldMapSource;
		/** Core admission is rechecked at menu selection and command dispatch. */
		readonly canTeleportFromMap: boolean;
		/** Reuse the app-owned waypoint setter and status toast. */
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
		/** Attempts offered by core; the server validates undisclosed prerequisites. */
		readonly recallDestinations: readonly RecallDestination[];
		/** Dispatch the selected standard recall through the app shell. */
		readonly onRecall: (destination: RecallDestination) => Promise<void>;
		/** App shell owns visible request-error feedback. */
		readonly onTeleportToMapPosition: (
			position: ClientMapPosition,
		) => Promise<void>;
		/** Visibility never owns canvas or dataset lifetime. */
		readonly visible: boolean;
		/** Coherent player placement, pulled at bounded overlay cadence. */
		readonly readFrame: () => MinimapFrame;
	}
	const {
		contracts,
		characterGuid,
		housing,
		housingManagement,
		onRefreshHousing,
		onSearchHousing,
		source,
		canTeleportFromMap,
		onSetWaypoint,
		recallDestinations,
		onRecall,
		onTeleportToMapPosition,
		visible,
		readFrame,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	let searchRoot: SVGGElement;
	let searchOverlay: HousingSearchOverlay | null = null;
	/** Filter intent belongs to a character, even while the transport/map survives. */
	let searchSelection = $state<{ character: number | null; type: number }>({
		character: null,
		type: 0,
	});
	const searchType = $derived(
		searchSelection.character === characterGuid ? searchSelection.type : 0,
	);
	const searchTypes = [
		{ value: 1, label: "Cottage", action: "housing-1" },
		{ value: 2, label: "Villa", action: "housing-2" },
		{ value: 3, label: "Mansion", action: "housing-3" },
	] as const;
	$effect(() => {
		searchSelection = { character: characterGuid, type: 0 };
	});
	$effect(() => {
		const cells =
			searchType !== 0 && housing.search.results?.houseType === searchType
				? housing.search.results.areas
				: null;
		untrack(() => {
			searchOverlay?.setAreas(cells);
			drawOverlays();
		});
	});
	function selectHousing(type: number): void {
		if (type !== 0 && housing.search.pendingType !== null) return;
		searchSelection = { character: characterGuid, type };
		if (type !== 0) void onSearchHousing(type);
	}

	/** A single open menu belongs to this character and visible map tab. */
	let menu = $state<
		| {
				readonly kind: "recall" | "visibility";
				readonly anchor: HTMLButtonElement;
		  }
		| {
				readonly kind: "context";
				readonly anchor: { readonly x: number; readonly y: number };
				readonly target: MapWaypointTarget;
		  }
		| null
	>(null);
	const recallAnchor = $derived(menu?.kind === "recall" ? menu.anchor : null);
	function toggleMenu(
		kind: "recall" | "visibility",
		anchor: HTMLButtonElement,
	): void {
		menu = menu?.kind === kind ? null : { kind, anchor };
	}
	const contextItems = $derived<
		readonly PopupMenuItem<"waypoint" | "teleport">[]
	>([
		...(characterGuid === null
			? []
			: [
					{
						action: "waypoint" as const,
						label: "Set waypoint",
						disabled: false,
					},
				]),
		...(canTeleportFromMap
			? [{ action: "teleport" as const, label: "Teleport", disabled: false }]
			: []),
	]);
	const recallItems = $derived(
		recallDestinations.map((action) => ({
			action,
			label: RECALL_LABELS[action],
			disabled: false,
		})),
	);
	$effect(() => {
		if (
			!visible ||
			activeTab !== "world" ||
			(menu?.kind === "recall" && recallDestinations.length === 0)
		)
			menu = null;
	});

	let contractRoot: SVGGElement;
	/** Cold mount identity ensures default-on facts are prepared after the SVG owner exists. */
	let contractOverlay = $state.raw<ContractMapOverlay | null>(null);
	/** Defaults on for each character; panel/tab closure retains that character's choice. */
	let contractsChoice = $state<{ character: number | null; enabled: boolean }>({
		character: null,
		enabled: false,
	});
	const showContracts = $derived(
		contractsChoice.character === characterGuid && contractsChoice.enabled,
	);
	$effect(() => {
		contractsChoice = {
			character: characterGuid,
			enabled: characterGuid !== null,
		};
		clearHover();
	});
	$effect(() => {
		const source = contracts;
		const overlay = contractOverlay;
		if (
			source === null ||
			overlay === null ||
			!visible ||
			activeTab !== "world" ||
			!showContracts
		) {
			overlay?.clear();
			drawTooltip();
			return;
		}
		const refresh = () => {
			overlay.setFacts(source.readFacts());
			drawOverlays();
		};
		// Overlay drawing reads independent display choices; they must not own this subscription.
		untrack(refresh);
		const unsubscribe = source.subscribeFacts(refresh);
		// Repeat expiry can reveal a quest area without a new server snapshot.
		const timer = setInterval(refresh, CLIENT_TUNING.journal.displayIntervalMs);
		return () => {
			unsubscribe();
			clearInterval(timer);
			overlay.clear();
			drawTooltip();
		};
	});

	let canvas: HTMLCanvasElement;
	let playerMarker: SVGGElement;
	let waypointMarker: SVGGElement;
	/** Last completed overlay placement, used by stationary hover as well as pointer events. */
	let waypointPlacement: {
		readonly target: MapWaypointTarget;
		readonly x: number;
		readonly y: number;
	} | null = null;
	let homeMarker: SVGGElement;
	let settlementRoot: SVGGElement;
	let settlementOverlay: WorldMapSettlementOverlay | null = null;
	let resetButton: HTMLButtonElement;
	let positionTooltip: HTMLDivElement;
	/** Last canvas hover in viewport pixels, reprojected after every map draw. */
	let hover: { readonly x: number; readonly y: number } | null = null;
	const panelId = $props.id();
	/** Tab choice only controls presentation; the image and current view stay retained. */
	let activeTab = $state<"world" | "housing">("world");
	/** Cold toggle markup; defaults to names shown only in the tooltip. */
	let showAllLabels = $state(false);
	/** World map presentation only; navigation intent and minimap guidance remain active. */
	let showWaypoints = $state(true);
	$effect(() => {
		// All filter choices and open menus belong to the current character.
		void characterGuid;
		showAllLabels = false;
		showWaypoints = true;
		menu = null;
		untrack(() => {
			settlementOverlay?.showLabels(false);
			drawOverlays();
		});
	});
	/** Stable intents for the three map layers and exclusive housing search choices. */
	type VisibilityAction =
		| "names"
		| "contracts"
		| "waypoints"
		| "housing"
		| "housing-0"
		| "housing-1"
		| "housing-2"
		| "housing-3";
	const visibilityItems = $derived<readonly PopupMenuItem<VisibilityAction>[]>([
		{
			action: "names",
			label: "Town names",
			disabled: false,
			selection: { kind: "checkbox", checked: showAllLabels },
		},
		{
			action: "contracts",
			label: "Contracts",
			disabled: contracts === null || characterGuid === null,
			selection: { kind: "checkbox", checked: showContracts },
		},
		{
			action: "waypoints",
			label: "Waypoints",
			disabled: false,
			selection: { kind: "checkbox", checked: showWaypoints },
		},
		{
			action: "housing",
			label: "Housing",
			disabled: characterGuid === null,
			selection: { kind: "summary", checked: searchType !== 0 },
			children: [
				{
					action: "housing-0",
					label: "None",
					disabled: false,
					selection: { kind: "radio", checked: searchType === 0 },
				},
				...searchTypes.map((type) => ({
					action: type.action,
					label: `${type.label}${housing.search.pendingType === type.value ? " — Searching…" : housing.search.results?.houseType === type.value && housing.search.results.totalAvailable === 0 ? " (0)" : ""}`,
					disabled: housing.search.pendingType !== null,
					selection: {
						kind: "radio" as const,
						checked: searchType === type.value,
					},
				})),
			],
		},
	]);
	function selectVisibility(action: VisibilityAction): void {
		switch (action) {
			case "names":
				showAllLabels = !showAllLabels;
				settlementOverlay?.showLabels(showAllLabels);
				break;
			case "contracts":
				contractsChoice = { character: characterGuid, enabled: !showContracts };
				break;
			case "waypoints":
				showWaypoints = !showWaypoints;
				drawPositionMarkers();
				break;
			case "housing-0":
				selectHousing(0);
				break;
			case "housing-1":
				selectHousing(1);
				break;
			case "housing-2":
				selectHousing(2);
				break;
			case "housing-3":
				selectHousing(3);
				break;
			case "housing":
				break;
		}
		drawTooltip();
	}
	const tabs = [
		{
			value: "world",
			label: "World",
			id: `${panelId}-world-tab`,
			panelId: `${panelId}-world`,
		},
		{
			value: "housing",
			label: "Housing",
			id: `${panelId}-housing-tab`,
			panelId: `${panelId}-housing`,
		},
	] as const;
	// Only status markup is reactive. Dataset arrays and input-rate view state stay imperative.
	let mapState = $state.raw<WorldMapState>({ kind: "idle" });
	let owner: WorldMapOwner | null = null;
	let cancelPan: (() => void) | null = null;

	/** Demand-read owner access for the focused browser lifecycle diagnostic. */
	export function readOwner(): WorldMapOwner | null {
		return owner;
	}

	onMount(() => {
		contractOverlay = new ContractMapOverlay(contractRoot);
		const settlements = new WorldMapSettlementOverlay(
			settlementRoot,
			WORLD_MAP_SETTLEMENTS,
		);
		settlementOverlay = settlements;
		searchOverlay = new HousingSearchOverlay(searchRoot);
		const mounted = new WorldMapOwner(source, canvas);
		owner = mounted;
		mounted.setVisible(visible && activeTab === "world");
		const unsubscribeDraw = mounted.subscribeDraw(drawOverlays);
		const unsubscribe = mounted.subscribe((next) => {
			mapState = next;
			if (next.kind === "load-failed" || next.kind === "unavailable")
				drawOverlays();
		});
		const resize = new ResizeObserver(() => {
			mounted.resize();
		});
		resize.observe(canvas);
		void mounted.load();
		return () => {
			cancelPan?.();
			resize.disconnect();
			unsubscribe();
			unsubscribeDraw();
			mounted.destroy();
			settlements.destroy();
			contractOverlay?.clear();
			contractOverlay = null;
			searchOverlay?.destroy();
			searchOverlay = null;
			settlementOverlay = null;
			owner = null;
		};
	});
	$effect(() => {
		owner?.setVisible(visible && activeTab === "world");
		if (!visible || activeTab !== "world") {
			cancelPan?.();
			cancelPan = null;
			clearHover();
			return;
		}
		// Player motion and waypoint changes are sampled between image draws; gestures reproject both in the image RAF.
		const update = () => {
			drawPositionMarkers();
			drawTooltip();
		};
		// Initial marker/hover data must not become dependencies of the visibility-owned timer.
		untrack(update);
		const timer = setInterval(update, 1000 / 30);
		return () => clearInterval(timer);
	});

	function drawOverlays(): void {
		drawPositionMarkers();
		if (!owner) return;
		const view = owner.readView();
		if (view) {
			settlementOverlay?.draw(view, canvas.clientWidth, canvas.clientHeight);
			searchOverlay?.draw(view, canvas.clientWidth, canvas.clientHeight);
			contractOverlay?.draw(view, canvas.clientWidth, canvas.clientHeight);
		} else {
			settlementOverlay?.clear();
			searchOverlay?.clear();
			contractOverlay?.hide();
		}
		resetButton.hidden = !owner.readView() || owner.isResetView();
		drawTooltip();
	}
	function clearHover(): void {
		hover = null;
		positionTooltip.hidden = true;
	}
	function moveHover(event: PointerEvent): void {
		hover = { x: event.clientX, y: event.clientY };
		drawTooltip();
	}
	function drawTooltip(): void {
		const state = owner?.read();
		const view = owner?.readView();
		if (
			!hover ||
			!view ||
			!state ||
			(state.kind !== "ready" && state.kind !== "streaming")
		) {
			positionTooltip.hidden = true;
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const x = hover.x - rect.left,
			y = hover.y - rect.top;
		const position = worldMapPosition(
			x,
			y,
			view,
			state.manifest.bounds,
			rect.width,
			rect.height,
		);
		positionTooltip.hidden = position === null;
		const settlement =
			position && settlementOverlay ? settlementOverlay.hit(x, y) : null;
		if (!position) return;
		const contractText = contractOverlay?.hit(x, y);
		const waypoint = waypointPlacement;
		// The 15 px pin rises above its geographic tip; hover follows the pin body.
		const waypointText =
			waypoint !== null &&
			Math.abs(waypoint.x - x) <= 8 &&
			Math.abs(waypoint.y - 7.5 - y) <= 8
				? `Waypoint · ${waypoint.target.label}`
				: "";
		const settlementText =
			settlement === null
				? ""
				: `${settlement.name} · ${formatWorldMapCoordinates({ x: settlement.position[0], z: settlement.position[2] })}`;
		const text =
			[waypointText, contractText, settlementText]
				.filter(Boolean)
				.join("\n\n") || formatWorldMapCoordinates(position);
		if (positionTooltip.textContent !== text)
			positionTooltip.textContent = text;
		// Flip away from the lower/right edges so the tooltip stays inside the surface.
		const left =
			x + 12 + positionTooltip.offsetWidth <= rect.width
				? x + 12
				: x - 12 - positionTooltip.offsetWidth;
		const top =
			y + 12 + positionTooltip.offsetHeight <= rect.height
				? y + 12
				: y - 12 - positionTooltip.offsetHeight;
		positionTooltip.style.left = `${Math.max(0, left)}px`;
		positionTooltip.style.top = `${Math.max(0, top)}px`;
	}

	function drawPositionMarkers(): void {
		if (!visible || activeTab !== "world" || !owner) return;
		const view = owner.readView();
		if (!view) {
			playerMarker.style.display = "none";
			homeMarker.style.display = "none";
			waypointMarker.style.display = "none";
			waypointPlacement = null;
			return;
		}
		const home = housingMapPosition(housing);
		homeMarker.style.display = home === null ? "none" : "";
		if (home !== null) {
			const point = projectWorldMapPoint(
				home,
				view,
				canvas.clientWidth,
				canvas.clientHeight,
			);
			homeMarker.setAttribute(
				"transform",
				`translate(${point[0]} ${point[1]})`,
			);
		}
		const frame = readFrame();
		const target = showWaypoints ? (frame.waypoint?.target ?? null) : null;
		waypointPlacement = null;
		if (target !== null) {
			const [x, y] = projectWorldMapPoint(
				target.position,
				view,
				canvas.clientWidth,
				canvas.clientHeight,
			);
			if (
				x >= 0 &&
				y >= 0 &&
				x <= canvas.clientWidth &&
				y <= canvas.clientHeight
			) {
				waypointPlacement = { target, x, y };
				waypointMarker.setAttribute("transform", `translate(${x} ${y})`);
			}
		}
		waypointMarker.style.display = waypointPlacement === null ? "none" : "";
		const player = worldMapPlayer(
			frame,
			view,
			canvas.clientWidth,
			canvas.clientHeight,
		);
		playerMarker.style.display = player ? "" : "none";
		if (player) {
			playerMarker.setAttribute(
				"transform",
				`translate(${player.position[0]} ${player.position[1]}) rotate(${player.headingDegrees})`,
			);
		}
	}

	function pan(event: PointerEvent): void {
		const view = owner?.readView();
		if (!view || event.button !== 0 || !owner) return;
		event.preventDefault();
		event.stopPropagation();
		menu = null;
		const mounted = owner;
		const scale = view.spanMeters / Math.max(1, canvas.clientWidth);
		cancelPan?.();
		cancelPan = trackWorldMapGesture(
			window,
			event,
			SHARED_FRONTEND_TUNING.worldMap.panThresholdPixels,
			(deltaX, deltaY) => {
				mounted.setView({
					...view,
					centerX: view.centerX - deltaX * scale,
					centerZ: view.centerZ - deltaY * scale,
				});
			},
		);
	}
	function openContextMenu(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		cancelPan?.();
		cancelPan = null;
		menu = null;
		clearHover();
		if (!visible || activeTab !== "world" || !owner) return;
		const state = owner.read(),
			view = owner.readView();
		if (!view || (state.kind !== "streaming" && state.kind !== "ready")) return;
		const rect = canvas.getBoundingClientRect();
		const position = worldMapPosition(
			event.clientX - rect.left,
			event.clientY - rect.top,
			view,
			state.manifest.bounds,
			rect.width,
			rect.height,
		);
		if (!position || contextItems.length === 0) return;
		const target = waypointFromMapPoint(sceneMapPoint(position.x, position.z));
		if (target === null) return;
		menu = {
			kind: "context",
			anchor: { x: event.clientX, y: event.clientY },
			target,
		};
	}
	/** Capture geometry before PopupMenu dismisses and retires the reactive menu intent. */
	function mapActionSelection(
		target: MapWaypointTarget,
	): (action: "waypoint" | "teleport") => void {
		return (action) => {
			if (!visible || activeTab !== "world") return;
			if (action === "waypoint" && characterGuid !== null)
				onSetWaypoint(target);
			if (action === "teleport" && canTeleportFromMap) {
				// RETAIL DIVERGENCE: acclient.c:208815 uses fixed local X/Y=10 for map clicks.
				// Preserve clicked X/Y instead; ACE resolves terrain/building height at that point.
				// Scope: the privileged map action only; no authored content placement changes.
				void onTeleportToMapPosition(target.position);
			}
		};
	}

	function zoom(event: WheelEvent): void {
		menu = null;
		event.preventDefault();
		event.stopPropagation();
		cancelPan?.();
		cancelPan = null;
		if (!owner) return;
		// Normalize browser wheel units before applying the app's zoom policy.
		const pixels =
			event.deltaY *
			(event.deltaMode === 1
				? 16
				: event.deltaMode === 2
					? canvas.clientHeight
					: 1);
		const rect = canvas.getBoundingClientRect();
		// Match the renderer's client dimensions even when layout has fractional CSS pixels.
		owner.zoomAt(
			((event.clientX - rect.left) * canvas.clientWidth) / rect.width,
			((event.clientY - rect.top) * canvas.clientHeight) / rect.height,
			Math.exp(pixels * SHARED_FRONTEND_TUNING.worldMap.wheelZoomRate),
		);
	}
</script>

<div
	class="world-panel ui-body ui-tabbed-panel"
	use:keyboard.scope={{ nativeControls: true, keydown: () => {} }}
>
	<UiTabs
		label="World tabs"
		{tabs}
		selected={activeTab}
		onSelect={(value) => (activeTab = value)}
	/>
	<UiTabPanel
		id={`${panelId}-world`}
		labelledBy={`${panelId}-world-tab`}
		active={activeTab === "world"}
		scroll={false}
	>
		<div class="world-map-page">
			<div class="world-map-surface">
				<canvas
					bind:this={canvas}
					aria-label="World terrain map"
					onpointermove={moveHover}
					onpointerleave={(event) => {
						if (
							event.relatedTarget instanceof Node &&
							positionTooltip.contains(event.relatedTarget)
						)
							return;
						clearHover();
					}}
					onpointerdown={pan}
					oncontextmenu={openContextMenu}
					onwheel={zoom}
				></canvas>
				<svg class="world-map-overlay" aria-hidden="true">
					<g bind:this={searchRoot} class="world-housing-search" />
					<g
						bind:this={homeMarker}
						class="world-home-target"
						style:display="none"><WorldMapHomeIcon /></g
					>
					<g
						bind:this={settlementRoot}
						class="world-settlements ui-world-map-settlements"
					/>
					<g bind:this={contractRoot} class="world-contracts" />
					<g
						bind:this={waypointMarker}
						class="world-waypoint-target ui-waypoint-marker"
						style:display="none"><MapWaypointPinIcon /></g
					>
					<g
						bind:this={playerMarker}
						class="world-player-target"
						style:display="none"
					>
						<WorldMapPlayerIcon />
					</g>
				</svg>
				<button
					class="ui-hud-button ui-icon-button world-map-recall"
					type="button"
					aria-label="Recall destinations"
					aria-haspopup="menu"
					aria-expanded={recallAnchor !== null}
					title="Recall destinations"
					disabled={recallDestinations.length === 0}
					onclick={(event) => {
						toggleMenu("recall", event.currentTarget);
						if (recallAnchor !== null && housing.home.kind === "unqueried")
							void onRefreshHousing();
					}}><ClientHudIcon name="teleport" /></button
				>
				<button
					class="ui-hud-button ui-icon-button world-map-visibility"
					type="button"
					aria-label="Map visibility"
					aria-haspopup="menu"
					aria-expanded={menu?.kind === "visibility"}
					title="Map visibility"
					onclick={(event) => toggleMenu("visibility", event.currentTarget)}
					><ClientHudIcon name="eye" /></button
				>

				<button
					bind:this={resetButton}
					hidden
					class="ui-hud-button ui-icon-button world-map-reset"
					type="button"
					aria-label="Reset view"
					title="Reset view — show the whole world"
					disabled={mapState.kind !== "ready" && mapState.kind !== "streaming"}
					onclick={() => {
						cancelPan?.();
						cancelPan = null;
						owner?.fit();
					}}><ClientHudIcon name="reset" /></button
				>
				<div
					bind:this={positionTooltip}
					class="world-map-tooltip ui-tooltip"
					onpointerleave={clearHover}
					role="tooltip"
					hidden
				></div>
				{#if mapState.kind === "idle" || mapState.kind === "opening"}
					<div class="world-map-status" role="status" aria-live="polite">
						<p>Preparing world map…</p>
						<progress aria-label="World map loading progress"></progress>
					</div>
				{:else if mapState.kind === "load-failed"}
					<div class="world-map-status" role="alert">
						<p>{mapState.diagnostic}</p>
						<button
							class="ui-button"
							type="button"
							onclick={() => void owner?.load()}>Retry</button
						>
					</div>
				{:else if mapState.kind === "unavailable"}
					<div class="world-map-status" role="alert">{mapState.diagnostic}</div>
				{/if}
			</div>
			{#if mapState.kind === "streaming"}
				<div class="world-map-progress" role="status" aria-live="polite">
					<span
						>{mapState.appliedTiles === mapState.manifest.tiles.length
							? "Saving world map…"
							: `World map: ${mapState.appliedTiles}/${mapState.manifest.tiles.length} tiles`}</span
					>
					<progress
						aria-label="World map loading progress"
						value={mapState.appliedTiles}
						max={mapState.manifest.tiles.length}
					></progress>
				</div>
			{/if}
		</div>
	</UiTabPanel>
	<UiTabPanel
		id={`${panelId}-housing`}
		labelledBy={`${panelId}-housing-tab`}
		active={activeTab === "housing"}
		scroll={false}
	>
		<div class="world-housing-page">
			<ClientHousingTab
				{housing}
				management={housingManagement}
				onRefresh={onRefreshHousing}
			/>
		</div>
	</UiTabPanel>
</div>

{#if recallAnchor !== null}
	<PopupMenu
		anchor={recallAnchor}
		label="Recall destinations"
		items={recallItems}
		onselect={(destination) => {
			void onRecall(destination);
		}}
		onclose={() => {
			menu = null;
		}}
	/>
{/if}

{#if menu?.kind === "visibility"}
	<PopupMenu
		anchor={menu.anchor}
		label="Map visibility"
		items={visibilityItems}
		onselect={selectVisibility}
		onclose={() => {
			menu = null;
		}}
	/>
{:else if menu?.kind === "context"}
	{#key menu}
		<PopupMenu
			anchor={menu.anchor}
			label="Map actions"
			items={contextItems}
			onselect={mapActionSelection(menu.target)}
			onclose={() => {
				menu = null;
			}}
		/>
	{/key}
{/if}

<style>
	@layer components {
		.world-map-page {
			height: 100%;
			display: grid;
			min-height: 0;
			grid-template-rows: minmax(0, 1fr) auto;
		}
		.world-housing-page {
			height: 100%;
			display: grid;
			min-width: 0;
			min-height: 0;
			overflow: hidden;
		}
		.world-map-recall {
			position: absolute;
			top: 8px;
			right: 8px;
			width: 30px;
			height: 30px;
		}
		.world-map-visibility,
		.world-map-reset {
			position: absolute;
			bottom: 8px;
			width: 30px;
			height: 30px;
			display: grid;
			place-items: center;
		}
		.world-contracts {
			color: var(--ui-color-accent);
		}
		.world-map-visibility {
			left: 8px;
		}
		.world-map-reset {
			right: 8px;
		}
		.world-map-reset[hidden],
		.world-map-tooltip[hidden] {
			display: none;
		}
		.world-map-tooltip {
			position: absolute;
			pointer-events: auto;
			white-space: pre-line;
			max-width: calc(100% - 16px);
			max-height: calc(100% - 16px);
			overflow: auto;
			overflow-wrap: anywhere;
		}
		.world-map-surface {
			position: relative;
			min-height: 0;
			overflow: hidden;
		}
		canvas,
		.world-map-overlay {
			position: absolute;
			width: 100%;
			height: 100%;
			touch-action: none;
		}
		canvas {
			cursor: grab;
		}
		canvas:active {
			cursor: grabbing;
		}
		.world-map-overlay {
			pointer-events: none;
		}
		.world-map-progress {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 6px;
		}
		.world-map-status {
			position: absolute;
			inset: 0;
			display: grid;
			place-content: center;
			padding: 20px;
			background: var(--ui-color-surface);
			overflow: auto;
		}
	}
</style>
