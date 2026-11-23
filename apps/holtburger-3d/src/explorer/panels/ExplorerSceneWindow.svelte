<script lang="ts">
	import ToggleField from "../../app/ui/ToggleField.svelte";
	import UiRange from "../../app/ui/UiRange.svelte";
	import UiTabPanel from "../../app/ui/UiTabPanel.svelte";
	import UiTabs from "../../app/ui/UiTabs.svelte";
	import type { SceneEnvironmentSelection } from "../../lib/game/environment/scene-environment";
	import type { SceneInterestRadii } from "../../lib/game/runtime/types";
	import { EXPLORER_TUNING } from "../explorer-tuning";
	import {
		formatResidencyRadius,
		updateExplorerResidencyRadius,
		type ExplorerRadiusKind,
	} from "../world/residency-radius";

	type SceneTab = "environment" | "streaming";

	interface Props {
		readonly runtimeReady: boolean;
		readonly environmentSelection: SceneEnvironmentSelection;
		readonly dayGroupNames: readonly string[];
		readonly updateEnvironment: (selection: SceneEnvironmentSelection) => void;
		readonly clockFollowing: boolean;
		readonly updateClockFollowing: (enabled: boolean) => void;
		readonly radii: SceneInterestRadii;
		readonly onRadiiChange: (radii: SceneInterestRadii) => void;
		readonly interestFollowsCamera: boolean;
		readonly updateInterestFollowsCamera: (enabled: boolean) => void;
	}

	const {
		runtimeReady,
		environmentSelection,
		dayGroupNames,
		updateEnvironment,
		clockFollowing,
		updateClockFollowing,
		radii,
		onRadiiChange,
		interestFollowsCamera,
		updateInterestFollowsCamera,
	}: Props = $props();

	let activeTab = $state<SceneTab>("environment");

	const tabs = [
		{
			value: "environment" as const,
			label: "Environment",
			id: "explorer-scene-environment-tab",
			panelId: "explorer-scene-environment-panel",
		},
		{
			value: "streaming" as const,
			label: "Streaming",
			id: "explorer-scene-streaming-tab",
			panelId: "explorer-scene-streaming-panel",
		},
	] as const;

	function updateRadius(kind: ExplorerRadiusKind, event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		onRadiiChange(
			updateExplorerResidencyRadius(
				radii,
				kind,
				input.value === "-1" ? null : Number(input.value),
			),
		);
	}

	function updateEnvironmentSelection(
		field: "dayIndex" | "timeOfDay" | "dayGroupOverride",
		event: Event,
	): void {
		const input = event.currentTarget as HTMLInputElement | HTMLSelectElement;
		const value = input.value;
		updateEnvironment({
			...environmentSelection,
			[field]:
				field === "dayGroupOverride"
					? value === "auto"
						? null
						: Number(value)
					: Number(value),
		});
	}
</script>

<div class="explorer-scene-window ui-tabbed-panel ui-body">
	<UiTabs
		{tabs}
		selected={activeTab}
		label="Scene sections"
		onSelect={(value) => (activeTab = value)}
	/>

	<UiTabPanel
		id="explorer-scene-environment-panel"
		labelledBy="explorer-scene-environment-tab"
		active={activeTab === "environment"}
	>
		<div class="explorer-world-panel">
			{#if dayGroupNames.length > 0}
				<fieldset class="explorer-section" disabled={!runtimeReady}>
					<label class="explorer-environment-field">
						<span>Day</span>
						<input
							class="ui-input"
							min="0"
							step="1"
							type="number"
							value={environmentSelection.dayIndex}
							oninput={(event) => updateEnvironmentSelection("dayIndex", event)}
						/>
					</label>
					<label class="explorer-environment-field">
						<span>Time</span>
						<UiRange
							aria-label="Time of day"
							min={0}
							max={0.999}
							step={0.01}
							value={environmentSelection.timeOfDay}
							oninput={(event) =>
								updateEnvironmentSelection("timeOfDay", event)}
						/>
					</label>
					<label class="explorer-environment-field">
						<span>Sky group</span>
						<select
							class="ui-input"
							value={environmentSelection.dayGroupOverride ?? "auto"}
							onchange={(event) =>
								updateEnvironmentSelection("dayGroupOverride", event)}
						>
							<option value="auto">Auto</option>
							{#each dayGroupNames as name, index}
								<option value={index}>{name}</option>
							{/each}
						</select>
					</label>
					<ToggleField
						checked={clockFollowing}
						label="Follow clock"
						checkedLabel="On"
						uncheckedLabel="Off"
						onCheckedChange={updateClockFollowing}
					/>
				</fieldset>
			{:else}
				<p class="explorer-control-note">
					Regional sky data is not loaded yet.
				</p>
			{/if}
		</div>
	</UiTabPanel>

	<UiTabPanel
		id="explorer-scene-streaming-panel"
		labelledBy="explorer-scene-streaming-tab"
		active={activeTab === "streaming"}
	>
		<div class="explorer-world-panel">
			<fieldset class="explorer-section" disabled={!runtimeReady}>
				<ToggleField
					checked={interestFollowsCamera}
					label="Interest follows camera"
					checkedLabel="On"
					uncheckedLabel="Off"
					onCheckedChange={updateInterestFollowsCamera}
				/>
				<div
					class="explorer-lod-controls"
					aria-label="Scene interest level of detail"
				>
					<p class="explorer-section-label">Outdoor residency</p>
					<div class="explorer-lod-control">
						<label for="explorer-residency-terrain">Terrain</label>
						<strong>{formatResidencyRadius(radii.terrainRadius)}</strong>
						<UiRange
							id="explorer-residency-terrain"
							max={EXPLORER_TUNING.residency.maximumRadius}
							min={EXPLORER_TUNING.residency.minimumRadius}
							step={1}
							value={radii.terrainRadius}
							oninput={(event) => updateRadius("terrain", event)}
						/>
					</div>
					<div class="explorer-lod-control">
						<label for="explorer-residency-buildings">Buildings</label>
						<strong>{formatResidencyRadius(radii.buildingRadius)}</strong>
						<UiRange
							id="explorer-residency-buildings"
							max={radii.terrainRadius}
							min={-1}
							step={1}
							value={radii.buildingRadius ?? -1}
							oninput={(event) => updateRadius("buildings", event)}
						/>
					</div>
					<div class="explorer-lod-control">
						<label for="explorer-residency-objects">Explicit objects</label>
						<strong>{formatResidencyRadius(radii.explicitObjectRadius)}</strong>
						<UiRange
							id="explorer-residency-objects"
							disabled={radii.buildingRadius === null}
							max={radii.buildingRadius ?? -1}
							min={-1}
							step={1}
							value={radii.explicitObjectRadius ?? -1}
							oninput={(event) => updateRadius("explicitObjects", event)}
						/>
					</div>
					<div class="explorer-lod-control">
						<label for="explorer-residency-generated">Generated scenery</label>
						<strong>{formatResidencyRadius(radii.generatedObjectRadius)}</strong
						>
						<UiRange
							id="explorer-residency-generated"
							disabled={radii.buildingRadius === null}
							max={radii.buildingRadius ?? -1}
							min={-1}
							step={1}
							value={radii.generatedObjectRadius ?? -1}
							oninput={(event) => updateRadius("generatedObjects", event)}
						/>
					</div>
					<div class="explorer-lod-control">
						<label for="explorer-residency-env-cells">Env cells</label>
						<strong>{formatResidencyRadius(radii.envCellRadius)}</strong>
						<UiRange
							id="explorer-residency-env-cells"
							max={radii.terrainRadius}
							min={-1}
							step={1}
							value={radii.envCellRadius ?? -1}
							oninput={(event) => updateRadius("envCells", event)}
						/>
					</div>
				</div>
			</fieldset>
		</div>
	</UiTabPanel>
</div>

<style>
	@layer components {
		.explorer-scene-window {
			height: 100%;
			min-height: 0;
		}
	}
</style>
