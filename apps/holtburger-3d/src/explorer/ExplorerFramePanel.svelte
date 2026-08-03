<script lang="ts">
	import type {
		FrameSelectionMetrics,
		RendererFrameProfile,
	} from "../lib/game/renderer/renderer";
	import type { GameRuntime } from "../lib/game/runtime/game-runtime";

	interface Props {
		/** Latest low-rate snapshot from the active renderer, if it exposes diagnostics. */
		readonly metrics: FrameSelectionMetrics | null;
		/** Latest opt-in CPU/GPU profile, or null before the first captured frame. */
		readonly profile: RendererFrameProfile | null;
		/** Whether the active renderer currently owns profiling resources. */
		readonly profilingEnabled: boolean;
		/** Explicitly create or tear down the renderer profiling session. */
		readonly setProfilingEnabled: (enabled: boolean) => void;
		/** Latest authored-dynamic residency diagnostics. */
		readonly dynamics: ReturnType<
			GameRuntime["getAuthoredDynamicRuntimeDiagnostics"]
		> | null;
	}

	let {
		metrics,
		profile,
		profilingEnabled,
		setProfilingEnabled,
		dynamics,
	}: Props = $props();
</script>

<div class="explorer-frame-panel">
	<button
		type="button"
		class="explorer-action"
		disabled={metrics === null}
		onclick={() => setProfilingEnabled(!profilingEnabled)}
	>
		{profilingEnabled ? "Disable frame profiling" : "Enable frame profiling"}
	</button>
	{#if profilingEnabled}
		{#if profile === null}
			<p>Waiting for the first profiled frame.</p>
		{:else}
			<div class="ac-param-panel">
				<div class="ac-param-row">
					<span class="ac-param-key">CPU frame / rolling samples</span>
					<code
						>{profile.cpu.latestFrameNumber} / {profile.cpu.sampleCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">CPU total latest / mean / p95 ms</span>
					<code
						>{profile.cpu.latestTotalMs.toFixed(2)} / {profile.cpu.mean.totalMs.toFixed(
							2,
						)} / {profile.cpu.p95TotalMs.toFixed(2)}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key"
						>CPU mean view / query / contributions / portal plan ms</span
					>
					<code
						>{profile.cpu.mean.viewPreparationMs.toFixed(2)} / {profile.cpu.mean.sceneQueryMs.toFixed(
							2,
						)} / {profile.cpu.mean.contributionPreparationMs.toFixed(2)} / {profile.cpu.mean.portalGraphPlanningMs.toFixed(
							2,
						)}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key"
						>CPU mean terrain / opaque / blended / other ms</span
					>
					<code
						>{profile.cpu.mean.terrainSubmissionMs.toFixed(2)} / {profile.cpu.mean.opaqueSubmissionMs.toFixed(
							2,
						)} / {profile.cpu.mean.blendedSubmissionMs.toFixed(2)} / {profile.cpu.mean.otherMs.toFixed(
							2,
						)}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">CPU mean setup / final ms</span>
					<code
						>{profile.cpu.mean.setupMs.toFixed(2)} / {profile.cpu.mean.finalizationMs.toFixed(
							2,
						)}</code
					>
				</div>
				{#if profile.gpu.kind === "available"}
					<div class="ac-param-row">
						<span class="ac-param-key"
							>GPU command span / terrain / opaque / blended / other ms</span
						>
						<code
							>{profile.gpu.totalMs.toFixed(2)} / {profile.gpu.terrainMs.toFixed(
								2,
							)} / {profile.gpu.opaqueMs.toFixed(2)} / {profile.gpu.blendedMs.toFixed(
								2,
							)} / {profile.gpu.otherMs.toFixed(2)}</code
						>
					</div>
					<div class="ac-param-row">
						<span class="ac-param-key">GPU source frame / pending frames</span>
						<code
							>{profile.gpu.frameNumber} / {profile.gpu.pendingFrameCount}</code
						>
					</div>
				{:else if profile.gpu.kind === "unsupported"}
					<p>GPU timestamp queries are unavailable on this device.</p>
				{:else if profile.gpu.kind === "disjoint"}
					<p>GPU clock was disjoint; invalid samples were discarded.</p>
				{:else}
					<p>Waiting on {profile.gpu.pendingFrameCount} GPU frame queries.</p>
				{/if}
			</div>
			<p class="explorer-frame-note">
				Profiling is opt-in and adds CPU clocks plus asynchronous GPU timestamp
				queries. GPU results arrive from an earlier frame.
			</p>
		{/if}
	{/if}
	{#if metrics === null}
		<p>Waiting for the renderer to produce a frame-selection snapshot.</p>
	{:else}
		<p>Latest sampled renderer selection counts.</p>
		<div class="ac-param-panel">
			{#if dynamics !== null}
				<div class="ac-param-row">
					<span class="ac-param-key"
						>Dynamic entities / templates / animations</span
					>
					<code
						>{dynamics.dynamics.entityCount} /
						{dynamics.dynamics.templates.templateCount} /
						{dynamics.dynamics.animationResources.animationCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key"
						>Animation sample / presentation publish ms</span
					>
					<code
						>{dynamics.animation.lastSamplingDurationMs.toFixed(2)} /
						{dynamics.dynamics.lastPresentationPublicationDurationMs.toFixed(
							2,
						)}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key"
						>Effect hooks executed / deferred / fallback</span
					>
					<code
						>{dynamics.effects.executedHookCount} /
						{dynamics.effects.deferredHookCount} /
						{dynamics.dynamics.staticFallbackEntityCount}</code
					>
				</div>
			{/if}
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
				<span class="ac-param-key">Generated fragments / compacted draws</span>
				<code
					>{metrics.selectedGeneratedInstanceFragmentCount} / {metrics.submittedCompactedGeneratedDrawCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key"
					>Generated selected / compacted instances</span
				>
				<code
					>{metrics.selectedGeneratedInstanceCount} / {metrics.submittedCompactedGeneratedInstanceCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Transparent candidates / runs</span>
				<code
					>{metrics.transparentObjectCandidateCount} / {metrics.transparentFrameRunCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Transparent far candidates / runs</span>
				<code
					>{metrics.farTransparentObjectCandidateCount} / {metrics.farTransparentFrameRunCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Transparent near candidates / runs</span>
				<code
					>{metrics.nearTransparentObjectCandidateCount} / {metrics.nearTransparentFrameRunCount}</code
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
					>{metrics.objectProgramChanges} / {metrics.objectTextureBinds}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Visible dynamics</span>
				<code
					>{metrics.visibleDynamicEntityCount} / {metrics.visibleDynamicPartCount}</code
				>
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
				<span class="ac-param-key">Portal node submissions / unique nodes</span>
				<code
					>{metrics.portalSubmittedRenderNodeCount} / {metrics.portalRenderNodeCount}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Portal scope-window states</span>
				<code>{metrics.portalAdmittedScopeWindowStateCount}</code>
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
		</div>
		<p class="explorer-frame-note">
			Counts are aggregated across views. Static, dynamic, and env-cell values
			are selection counts; terrain and static-object ranges become concrete
			draw submissions.
		</p>
	{/if}
</div>
