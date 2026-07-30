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
				<span class="ac-param-key">EnvCell mode / scopes</span>
				<code
					>{metrics.envCellRenderMode} / {metrics.visibleEnvCellScopeCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Visible EnvCell shells / residents</span>
				<code
					>{metrics.visibleEnvCellShells} / {metrics.visibleEnvCellResidentNodes}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">EnvCell shell draws / triangles</span>
				<code
					>{metrics.submittedEnvCellShellDrawCount} / {metrics.submittedEnvCellShellTriangleCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">EnvCell resident draws / triangles</span>
				<code
					>{metrics.submittedEnvCellResidentDrawCount} / {metrics.submittedEnvCellResidentTriangleCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Shell back-cull overrides</span>
				<code>{metrics.envCellShellCullOverrideCount}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Portal nodes submitted / planned</span>
				<code
					>{metrics.portalSubmittedRenderNodeCount} / {metrics.portalRenderNodeCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Portal layers / mask edges / draws</span>
				<code
					>{metrics.portalRenderLayerCount} / {metrics.portalMaskEdgeCount} /
					{metrics.submittedPortalApertureDrawCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key"
					>Portal facing / same-domain / near-plane</span
				>
				<code
					>{metrics.portalRejectedFacingCrossingCount} /
					{metrics.portalSameDomainBoundaryCrossingCount} /
					{metrics.portalNearPlaneSeedCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Exterior renders / retained targets</span>
				<code
					>{metrics.portalExteriorRenderCount} /
					{metrics.sceneDomainTargetCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Retained portal target bytes</span>
				<code>{metrics.sceneDomainTargetBytes}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Portal planning / execution ms</span>
				<code
					>{metrics.portalPlanningDurationMs.toFixed(2)} /
					{metrics.portalExecutionDurationMs.toFixed(2)}</code
				>
			</div>
		</div>
		<p class="explorer-frame-note">
			Counts are aggregated across views. Static, dynamic, and env-cell values
			are selection counts; terrain and static-object ranges become concrete
			draw submissions.
		</p>
	{/if}
</div>
