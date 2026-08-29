<script lang="ts">
	import {
		ENTITY_SHADOW_MODES,
		type EntityGroundingSettings,
		type EntityShadowMode,
		type EntityShadowSettings,
		type OutdoorPssmSettings,
	} from "../lib/game/renderer/entity-shadow-policy";

	interface Props {
		/** Complete validated shadow policy presented by the Explorer. */
		readonly settings: EntityShadowSettings;
		/** Replace the complete policy so interdependent fields cross the runtime atomically. */
		readonly updateSettings: (settings: EntityShadowSettings) => void;
	}

	let { settings, updateSettings }: Props = $props();

	function numberValue(event: Event): number {
		return Number(
			(event.currentTarget as HTMLInputElement | HTMLSelectElement).value,
		);
	}

	function updatePssm(field: keyof OutdoorPssmSettings, event: Event): void {
		updateSettings({
			...settings,
			pssm: { ...settings.pssm, [field]: numberValue(event) },
		});
	}

	function updateGrounding(
		field: keyof EntityGroundingSettings,
		event: Event,
	): void {
		updateSettings({
			...settings,
			grounding: { ...settings.grounding, [field]: numberValue(event) },
		});
	}

	function updateMode(event: Event): void {
		const mode = (event.currentTarget as HTMLSelectElement).value;
		if (!ENTITY_SHADOW_MODES.includes(mode as EntityShadowMode)) {
			throw new Error(`Explorer selected unknown entity-shadow mode ${mode}.`);
		}
		updateSettings({ ...settings, mode: mode as EntityShadowMode });
	}
</script>

<label class="ac-form-field">
	<span>Entity shadows</span>
	<select
		class="ac-control ac-control--select"
		value={settings.mode}
		onchange={updateMode}
	>
		<option value="none">None</option>
		<option value="simple">Simple</option>
		<option value="shadow-maps">Shadow maps</option>
	</select>
</label>

{#if settings.mode === "shadow-maps"}
	<p class="ac-section-label">Outdoor PSSM</p>
	<div class="shadow-grid">
		<label class="ac-form-field">
			<span>Cascades</span>
			<select
				class="ac-control ac-control--select"
				value={settings.pssm.cascadeCount}
				onchange={(event) => updatePssm("cascadeCount", event)}
			>
				{#each [1, 2, 3, 4] as count}
					<option value={count}>{count}</option>
				{/each}
			</select>
		</label>
		<label class="ac-form-field">
			<span>Map resolution</span>
			<select
				class="ac-control ac-control--select"
				value={settings.pssm.mapResolution}
				onchange={(event) => updatePssm("mapResolution", event)}
			>
				{#each [256, 512, 1024, 2048] as resolution}
					<option value={resolution}>{resolution}px</option>
				{/each}
			</select>
		</label>
		<label class="ac-form-field"
			><span>Maximum distance</span><input
				class="ac-control"
				min="1"
				max="2048"
				step="1"
				type="number"
				value={settings.pssm.maximumDistance}
				onchange={(event) => updatePssm("maximumDistance", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Minimum light elevation</span><input
				class="ac-control"
				min="0"
				max="90"
				step="1"
				type="number"
				value={settings.pssm.minimumLightElevationDegrees}
				onchange={(event) => updatePssm("minimumLightElevationDegrees", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Split lambda</span><input
				class="ac-control"
				min="0"
				max="1"
				step="0.01"
				type="number"
				value={settings.pssm.splitLambda}
				onchange={(event) => updatePssm("splitLambda", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Blend fraction</span><input
				class="ac-control"
				min="0"
				max="0.5"
				step="0.01"
				type="number"
				value={settings.pssm.transitionFraction}
				onchange={(event) => updatePssm("transitionFraction", event)}
			/></label
		>
		<label class="ac-form-field">
			<span>PCF radius</span>
			<select
				class="ac-control ac-control--select"
				value={settings.pssm.pcfRadius}
				onchange={(event) => updatePssm("pcfRadius", event)}
			>
				<option value="0">0</option><option value="1">1</option><option
					value="2">2</option
				>
			</select>
		</label>
		<label class="ac-form-field"
			><span>Strength</span><input
				class="ac-control"
				min="0"
				max="1"
				step="0.01"
				type="number"
				value={settings.pssm.strength}
				onchange={(event) => updatePssm("strength", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Receiver depth bias</span><input
				class="ac-control"
				min="0"
				max="0.05"
				step="0.0001"
				type="number"
				value={settings.pssm.receiverDepthBias}
				onchange={(event) => updatePssm("receiverDepthBias", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Normal offset bias</span><input
				class="ac-control"
				min="0"
				max="4"
				step="0.01"
				type="number"
				value={settings.pssm.normalOffsetBias}
				onchange={(event) => updatePssm("normalOffsetBias", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Caster slope bias</span><input
				class="ac-control"
				min="0"
				max="8"
				step="0.1"
				type="number"
				value={settings.pssm.casterPolygonOffsetFactor}
				onchange={(event) => updatePssm("casterPolygonOffsetFactor", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Caster unit bias</span><input
				class="ac-control"
				min="0"
				max="16"
				step="0.1"
				type="number"
				value={settings.pssm.casterPolygonOffsetUnits}
				onchange={(event) => updatePssm("casterPolygonOffsetUnits", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Caster-depth padding</span><input
				class="ac-control"
				min="0"
				max="512"
				step="1"
				type="number"
				value={settings.pssm.casterSearchPadding}
				onchange={(event) => updatePssm("casterSearchPadding", event)}
			/></label
		>
	</div>
{/if}

{#if settings.mode !== "none"}
	<p class="ac-section-label">Analytic grounding</p>
	<div class="shadow-grid">
		<label class="ac-form-field"
			><span>Strength</span><input
				class="ac-control"
				min="0"
				max="1"
				step="0.01"
				type="number"
				value={settings.grounding.strength}
				onchange={(event) => updateGrounding("strength", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Radius scale</span><input
				class="ac-control"
				min="0.1"
				max="4"
				step="0.05"
				type="number"
				value={settings.grounding.radiusScale}
				onchange={(event) => updateGrounding("radiusScale", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Softness</span><input
				class="ac-control"
				min="0.01"
				max="1"
				step="0.01"
				type="number"
				value={settings.grounding.softness}
				onchange={(event) => updateGrounding("softness", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Drop spread</span><input
				class="ac-control"
				min="0"
				max="2"
				step="0.05"
				type="number"
				value={settings.grounding.dropSpread}
				onchange={(event) => updateGrounding("dropSpread", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Maximum drop</span><input
				class="ac-control"
				min="0.01"
				max="16"
				step="0.05"
				type="number"
				value={settings.grounding.maximumDrop}
				onchange={(event) => updateGrounding("maximumDrop", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Minimum up-facing</span><input
				class="ac-control"
				min="0"
				max={settings.grounding.fullStrengthUpFacing - 0.01}
				step="0.01"
				type="number"
				value={settings.grounding.minimumUpFacing}
				onchange={(event) => updateGrounding("minimumUpFacing", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Full-strength up-facing</span><input
				class="ac-control"
				min={settings.grounding.minimumUpFacing + 0.01}
				max="1"
				step="0.01"
				type="number"
				value={settings.grounding.fullStrengthUpFacing}
				onchange={(event) => updateGrounding("fullStrengthUpFacing", event)}
			/></label
		>
		<label class="ac-form-field"
			><span>Contact bias</span><input
				class="ac-control"
				min="0"
				max="1"
				step="0.01"
				type="number"
				value={settings.grounding.contactBias}
				onchange={(event) => updateGrounding("contactBias", event)}
			/></label
		>
	</div>
{/if}

<style>
	.shadow-grid {
		display: grid;
		gap: 0.45rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.shadow-grid input,
	.shadow-grid select {
		box-sizing: border-box;
		min-width: 0;
		width: 100%;
	}
</style>
