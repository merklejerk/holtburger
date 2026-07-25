<script lang="ts">
	import type { FrameSelectionMetrics } from "../lib/game/renderer/renderer";

	interface Props {
		/** Latest low-rate snapshot from the active renderer, if it exposes diagnostics. */
		readonly metrics: FrameSelectionMetrics | null;
	}

	let { metrics }: Props = $props();
</script>

<div class="explorer-frame-panel">
	{#if metrics === null}
		<p>Waiting for the renderer to produce a frame-selection snapshot.</p>
	{:else}
		<p>Latest sampled renderer selection counts.</p>
		<div class="ac-param-panel">
			<div class="ac-param-row">
				<span class="ac-param-key">Views</span>
				<code>{metrics.viewCount}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Visible scene entries</span>
				<code>{metrics.visibleSceneEntries}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Terrain frame inputs</span>
				<code>{metrics.terrainFrameInputs}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Visible static objects</span>
				<code>{metrics.visibleStaticObjects}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Building ranges / triangles</span>
				<code
					>{metrics.submittedBuildingRanges} / {metrics.submittedBuildingTriangles}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Object program / texture bind calls</span>
				<code
					>{metrics.objectProgramChanges} / {metrics.objectTexturePageBinds}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Visible dynamics</span>
				<code>{metrics.visibleDynamics}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Visible env-cell shells</span>
				<code>{metrics.visibleEnvCellShells}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Visible portal crossings</span>
				<code>{metrics.visiblePortalCrossings}</code>
			</div>
		</div>
		<p class="explorer-frame-note">
			Counts are aggregated across views. Static, dynamic, and env-cell values
			are selection counts; terrain and opaque/alpha-test building ranges become
			concrete draw submissions.
		</p>
	{/if}
</div>
