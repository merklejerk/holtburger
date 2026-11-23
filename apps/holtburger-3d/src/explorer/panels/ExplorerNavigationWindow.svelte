<script lang="ts">
	import type { MinimapFrame } from "../../app/minimap/frame";
	import ToggleField from "../../app/ui/ToggleField.svelte";
	import UiRange from "../../app/ui/UiRange.svelte";
	import UiTabPanel from "../../app/ui/UiTabPanel.svelte";
	import UiTabs from "../../app/ui/UiTabs.svelte";
	import TeleportIcon from "../../assets/icons/hud-teleport.svg?component";
	import type { ExplorerCameraMode } from "../../lib/game/motion/host-physical-fly-path";
	import type { SceneInterestTarget } from "../../lib/game/runtime/scene-target";
	import type { WorldMapSource } from "../../lib/game/world-map/types";
	import type { ExplorerSceneContext } from "../camera/camera-authority";
	import type { PhysicalFlyStatus } from "../camera/physical-fly-session";
	import { parseResidenceInput } from "../camera/world-input";
	import { EXPLORER_TUNING } from "../explorer-tuning";
	import { EXPLORER_FLY_SPEED_RANGE } from "../settings/explorer-settings-defaults";
	import ExplorerWorldMapPanel from "./ExplorerWorldMapPanel.svelte";

	type NavigationTab = "location" | "camera";

	interface Props {
		readonly visible: boolean;
		readonly runtimeReady: boolean;
		readonly source: WorldMapSource;
		readonly readFrame: () => MinimapFrame;
		readonly onJumpToTarget: (
			target: SceneInterestTarget,
			label: string,
		) => void;
		readonly sceneContext: ExplorerSceneContext | null;
		readonly cameraResidencyLabel: string | null;
		readonly cameraMode: ExplorerCameraMode;
		readonly cameraModePending: boolean;
		readonly readPhysicalCameraStatus: () => PhysicalFlyStatus | null;
		readonly updateCameraMode: (mode: ExplorerCameraMode) => void;
		readonly flySpeed: number;
		readonly onFlySpeedChange: (speed: number) => void;
		readonly audioFollowsCamera: boolean;
		readonly updateAudioFollowsCamera: (enabled: boolean) => void;
	}

	const {
		visible,
		runtimeReady,
		source,
		readFrame,
		onJumpToTarget,
		sceneContext,
		cameraResidencyLabel,
		cameraMode,
		cameraModePending,
		readPhysicalCameraStatus,
		updateCameraMode,
		flySpeed,
		onFlySpeedChange,
		audioFollowsCamera,
		updateAudioFollowsCamera,
	}: Props = $props();

	let activeTab = $state<NavigationTab>("location");
	let physicalCameraStatus = $state<PhysicalFlyStatus | null>(null);
	let interestInput = $state("");

	const tabs = [
		{
			value: "location" as const,
			label: "Location",
			id: "explorer-nav-location-tab",
			panelId: "explorer-nav-location-panel",
		},
		{
			value: "camera" as const,
			label: "Camera",
			id: "explorer-nav-camera-tab",
			panelId: "explorer-nav-camera-panel",
		},
	] as const;

	const sceneContextLabel = $derived(
		sceneContext === "dungeon"
			? "Dungeon"
			: sceneContext === "outdoor"
				? "Outdoor"
				: "—",
	);
	const cellReadout = $derived(
		cameraResidencyLabel === null
			? "—"
			: cameraResidencyLabel.startsWith("Outdoor ")
				? cameraResidencyLabel.slice("Outdoor ".length)
				: cameraResidencyLabel,
	);

	const parsedInterest = $derived(parseResidenceInput(interestInput));

	$effect(() => {
		if (!visible || activeTab !== "camera" || cameraMode === "free-fly") return;
		const sample = (): void => {
			physicalCameraStatus = readPhysicalCameraStatus();
		};
		sample();
		const interval = window.setInterval(
			sample,
			EXPLORER_TUNING.diagnostics.frameRateDisplayIntervalMs,
		);
		return () => window.clearInterval(interval);
	});

	function submitInterest(event: SubmitEvent): void {
		event.preventDefault();
		if (!runtimeReady || !parsedInterest) return;
		onJumpToTarget(parsedInterest.target, parsedInterest.label);
	}

	function handleCameraModeChange(event: Event): void {
		updateCameraMode(
			(event.currentTarget as HTMLSelectElement).value as ExplorerCameraMode,
		);
	}
</script>

<div class="explorer-nav-window ui-tabbed-panel ui-body">
	<UiTabs
		{tabs}
		selected={activeTab}
		label="Navigation sections"
		onSelect={(value) => (activeTab = value)}
	/>

	<UiTabPanel
		id="explorer-nav-location-panel"
		labelledBy="explorer-nav-location-tab"
		active={activeTab === "location"}
		scroll={false}
	>
		<div class="explorer-nav-map-tab">
			<div class="explorer-nav-location">
				<span class="explorer-nav-meta">
					<span class="explorer-nav-location-label">Scene</span>
					<span>{sceneContextLabel}</span>
				</span>
				<span class="explorer-nav-meta">
					<span class="explorer-nav-location-label">Cell</span>
					<span class="explorer-nav-cell">{cellReadout}</span>
				</span>
			</div>
			<form class="explorer-nav-jump-bar" onsubmit={submitInterest}>
				<input
					class="ui-input explorer-nav-target-input"
					aria-label="Target landblock, cell, or coordinates"
					autocomplete="off"
					bind:value={interestInput}
					disabled={!runtimeReady}
					placeholder="da55, da550123, or 33.6N 40W"
					spellcheck="false"
				/>
				<button
					type="submit"
					class="ui-icon-button explorer-nav-jump-button"
					title="Jump to target"
					aria-label="Jump to target"
					disabled={!runtimeReady || parsedInterest === null}
				>
					<TeleportIcon />
				</button>
			</form>
			<div class="explorer-nav-map-surface">
				<ExplorerWorldMapPanel
					{source}
					visible={visible && activeTab === "location"}
					{runtimeReady}
					{readFrame}
					{onJumpToTarget}
				/>
			</div>
		</div>
	</UiTabPanel>

	<UiTabPanel
		id="explorer-nav-camera-panel"
		labelledBy="explorer-nav-camera-tab"
		active={activeTab === "camera"}
	>
		<div class="explorer-world-panel">
			<fieldset
				class="explorer-section"
				disabled={!runtimeReady || cameraModePending}
			>
				<label class="ui-label">
					<span>Position authority</span>
					<select
						class="ui-input"
						value={cameraMode}
						onchange={handleCameraModeChange}
					>
						<option value="free-fly">Frontend free fly</option>
						<option value="physical-fly">Host physical fly</option>
					</select>
				</label>
				<label class="explorer-environment-field">
					<span>Fly speed ({Math.round(flySpeed)} m/s)</span>
					<UiRange
						aria-label="Fly speed"
						min={EXPLORER_FLY_SPEED_RANGE.minimum}
						max={EXPLORER_FLY_SPEED_RANGE.maximum}
						step={5}
						value={flySpeed}
						oninput={(event) =>
							onFlySpeedChange(event.currentTarget.valueAsNumber)}
					/>
				</label>
				<ToggleField
					checked={audioFollowsCamera}
					label="Audio follows camera"
					checkedLabel="On"
					uncheckedLabel="Off"
					onCheckedChange={updateAudioFollowsCamera}
				/>
				{#if cameraModePending}
					<p class="explorer-control-note">
						Loading collision content and placing the physical camera.
					</p>
				{:else if cameraMode !== "free-fly"}
					<p class="explorer-control-note">
						{physicalCameraStatus?.tick ?? "awaiting-first-path"}; collision
						{physicalCameraStatus?.sceneResidency?.state ?? "unknown"}; cell
						{physicalCameraStatus?.cellId ?? "outdoor"};
						{physicalCameraStatus?.groundState ?? "unknown"};
						{physicalCameraStatus?.solveDurationMs.toFixed(2) ?? "0.00"} ms;
						{physicalCameraStatus?.droppedPaths ?? 0} dropped paths.
					</p>
				{/if}
				{#if physicalCameraStatus?.sceneResidency?.state === "missing-owner"}
					<p class="explorer-control-note invalid">
						Collision owner {physicalCameraStatus.sceneResidency.landblockId} is not
						resident.
					</p>
				{:else if physicalCameraStatus?.sceneResidency?.state === "outside-landscape"}
					<p class="explorer-control-note invalid">
						Camera is outside the authored landscape.
					</p>
				{/if}
			</fieldset>
		</div>
	</UiTabPanel>
</div>

<style>
	@layer components {
		.explorer-nav-window {
			height: 100%;
			min-height: 0;
		}
		.explorer-nav-map-tab {
			display: grid;
			grid-template-rows: auto auto minmax(0, 1fr);
			gap: 6px;
			height: 100%;
			min-height: 0;
		}
		.explorer-nav-location {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 8px;
			padding: 0 2px;
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
		}
		.explorer-nav-meta {
			display: inline-flex;
			align-items: baseline;
			gap: 6px;
		}
		.explorer-nav-location-label {
			color: var(--ui-color-muted);
		}
		.explorer-nav-cell {
			font-variant-numeric: tabular-nums;
			white-space: nowrap;
		}
		.explorer-nav-jump-bar {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 6px;
			align-items: center;
			min-width: 0;
		}
		.explorer-nav-target-input {
			min-width: 0;
			width: 100%;
		}
		.explorer-nav-jump-button {
			width: 30px;
			height: 30px;
			padding: 5px;
		}
		.explorer-nav-map-surface {
			min-height: 0;
			height: 100%;
		}
	}
</style>
