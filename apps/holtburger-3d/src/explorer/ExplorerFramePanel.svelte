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
				<span class="ac-param-key">Visible static layers / nodes</span>
				<code
					>{metrics.visibleStaticLayerCount} / {metrics.visibleStaticNodeCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Static draws / triangles</span>
				<code
					>{metrics.submittedStaticObjectDrawCount} / {metrics.submittedStaticObjectTriangleCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Persistent draws / instances</span>
				<code
					>{metrics.submittedPersistentInstancedDrawCount} / {metrics.submittedPersistentInstanceCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Transparent candidates / runs</span>
				<code
					>{metrics.transparentStaticCandidateCount} / {metrics.transparentFrameRunCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Transparent far candidates / runs</span>
				<code
					>{metrics.farTransparentStaticCandidateCount} / {metrics.farTransparentFrameRunCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Transparent near candidates / runs</span>
				<code
					>{metrics.nearTransparentStaticCandidateCount} / {metrics.nearTransparentFrameRunCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Frame arena capacity / high water</span>
				<code
					>{metrics.frameInstanceCapacity} / {metrics.frameInstanceViewHighWaterMark}</code
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
			are selection counts; terrain and static-object ranges become concrete
			draw submissions.
		</p>
	{/if}
</div>
