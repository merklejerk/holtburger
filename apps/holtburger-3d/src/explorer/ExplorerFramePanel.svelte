<script lang="ts">
	import type { RendererFrameDiagnosticsSnapshot } from "../lib/game/renderer/renderer";
	import type { GameRuntime } from "../lib/game/runtime/game-runtime";
	import {
		explorerFrameDiagnosticReportFilename,
		serializeExplorerFrameDiagnosticReport,
		type ExplorerFrameDiagnosticReport,
	} from "./explorer-frame-diagnostic-report";

	interface Props {
		/** Latest atomic renderer diagnostic read, or null until a renderer is available. */
		readonly diagnostics: RendererFrameDiagnosticsSnapshot | null;
		/** Latest authored-dynamic residency diagnostics. */
		readonly dynamics: ReturnType<
			GameRuntime["getAuthoredDynamicRuntimeDiagnostics"]
		> | null;
		/** Explicitly create or tear down the renderer profiling session. */
		readonly setProfilingEnabled: (enabled: boolean) => void;
		/** Compose one current, versioned Explorer and renderer evidence bundle. */
		readonly captureReport: () => ExplorerFrameDiagnosticReport | null;
	}

	let { diagnostics, dynamics, setProfilingEnabled, captureReport }: Props =
		$props();
	let exportStatus = $state<string | null>(null);

	const metrics = $derived(diagnostics?.selectionMetrics ?? null);
	const profile = $derived(diagnostics?.profile ?? null);
	const profilingEnabled = $derived(diagnostics?.profilingEnabled ?? false);

	function requireReport(): ExplorerFrameDiagnosticReport {
		const report = captureReport();
		if (!report) throw new Error("Frame diagnostics are unavailable.");
		return report;
	}

	async function copyReport(): Promise<void> {
		try {
			const report = requireReport();
			await navigator.clipboard.writeText(
				serializeExplorerFrameDiagnosticReport(report),
			);
			exportStatus = report.frame.profile
				? `Copied profile frame ${report.frame.profile.cpu.latestFrameNumber}.`
				: "Copied diagnostic snapshot; profiling was off.";
		} catch (error) {
			exportStatus = error instanceof Error ? error.message : String(error);
		}
	}

	function downloadReport(): void {
		try {
			const report = requireReport();
			const url = URL.createObjectURL(
				new Blob([serializeExplorerFrameDiagnosticReport(report)], {
					type: "application/json",
				}),
			);
			const anchor = document.createElement("a");
			anchor.download = explorerFrameDiagnosticReportFilename(report);
			anchor.href = url;
			anchor.click();
			window.setTimeout(() => URL.revokeObjectURL(url), 0);
			exportStatus = `Downloaded ${anchor.download}.`;
		} catch (error) {
			exportStatus = error instanceof Error ? error.message : String(error);
		}
	}
</script>

<div class="explorer-frame-panel">
	<div class="explorer-frame-actions">
		<button
			type="button"
			class="explorer-action explorer-frame-profile-toggle"
			disabled={diagnostics === null}
			onclick={() => setProfilingEnabled(!profilingEnabled)}
		>
			{profilingEnabled ? "Stop profiling" : "Start profiling"}
		</button>
		<button
			type="button"
			class="explorer-action"
			disabled={diagnostics === null}
			onclick={() => void copyReport()}
		>
			Copy snapshot
		</button>
		<button
			type="button"
			class="explorer-action"
			disabled={diagnostics === null}
			onclick={downloadReport}
		>
			Download JSON
		</button>
	</div>
	{#if exportStatus !== null}
		<p class="explorer-frame-status" role="status">{exportStatus}</p>
	{/if}

	{#if profilingEnabled}
		<fieldset class="explorer-section">
			<legend>Performance</legend>
			{#if profile === null}
				<p>Waiting for the first profiled frame.</p>
			{:else}
				<div class="explorer-frame-summary">
					<div>
						<span>CPU mean</span>
						<strong>{profile.cpu.mean.totalMs.toFixed(2)} ms</strong>
					</div>
					<div>
						<span>CPU p95</span>
						<strong>{profile.cpu.p95TotalMs.toFixed(2)} ms</strong>
					</div>
					<div>
						<span>Latest</span>
						<strong>{profile.cpu.latestTotalMs.toFixed(2)} ms</strong>
					</div>
					<div>
						<span>Samples</span>
						<strong>{profile.cpu.sampleCount}</strong>
					</div>
				</div>
				{#if profile.gpu.kind === "available"}
					<div class="ac-param-row">
						<span class="ac-param-key">GPU command span</span>
						<code>{profile.gpu.totalMs.toFixed(2)} ms</code>
					</div>
				{:else if profile.gpu.kind === "unsupported"}
					<p class="explorer-frame-note">
						GPU timestamp queries are unavailable on this device.
					</p>
				{:else if profile.gpu.kind === "disjoint"}
					<p class="explorer-frame-note">
						GPU clock was disjoint; invalid samples were discarded.
					</p>
				{:else}
					<p class="explorer-frame-note">
						Waiting on {profile.gpu.pendingFrameCount} GPU frame queries.
					</p>
				{/if}
				<details class="explorer-frame-details">
					<summary>Phase timings</summary>
					<div class="ac-param-panel">
						<div class="ac-param-row">
							<span class="ac-param-key">View / scene query</span>
							<code
								>{profile.cpu.mean.viewPreparationMs.toFixed(2)} / {profile.cpu.mean.sceneQueryMs.toFixed(
									2,
								)} ms</code
							>
						</div>
						<div class="ac-param-row">
							<span class="ac-param-key">Contribution resolve / merge</span>
							<code
								>{profile.cpu.mean.sceneContributionResolutionMs.toFixed(2)} / {profile.cpu.mean.contributionMergeMs.toFixed(
									2,
								)} ms</code
							>
						</div>
						<div class="ac-param-row">
							<span class="ac-param-key">Portal plan / object prepare</span>
							<code
								>{profile.cpu.mean.portalGraphPlanningMs.toFixed(2)} / {profile.cpu.mean.objectPreparationMs.toFixed(
									2,
								)} ms</code
							>
						</div>
						<div class="ac-param-row">
							<span class="ac-param-key">Generated cull / runs / upload</span>
							<code
								>{profile.cpu.mean.generatedInstanceCullingMs.toFixed(2)} / {profile.cpu.mean.instanceRunPreparationMs.toFixed(
									2,
								)} / {profile.cpu.mean.instanceUploadMs.toFixed(2)} ms</code
							>
						</div>
						<div class="ac-param-row">
							<span class="ac-param-key">Terrain / opaque / blended submit</span
							>
							<code
								>{profile.cpu.mean.terrainSubmissionMs.toFixed(2)} / {profile.cpu.mean.opaqueSubmissionMs.toFixed(
									2,
								)} / {profile.cpu.mean.blendedSubmissionMs.toFixed(2)} ms</code
							>
						</div>
						<div class="ac-param-row">
							<span class="ac-param-key">Blended order / other</span>
							<code
								>{profile.cpu.mean.blendedOrderingMs.toFixed(2)} / {profile.cpu.mean.otherMs.toFixed(
									2,
								)} ms</code
							>
						</div>
					</div>
				</details>
				<details class="explorer-frame-details">
					<summary>Contribution reuse</summary>
					<div class="ac-param-panel">
						<div class="ac-param-row">
							<span class="ac-param-key">Static / dynamic prepared</span>
							<code
								>{profile.cpu.contribution.mean.staticObjectPreparationCount.toFixed(
									1,
								)} / {profile.cpu.contribution.mean.dynamicObjectPreparationCount.toFixed(
									1,
								)}</code
							>
						</div>
						<div class="ac-param-row">
							<span class="ac-param-key">Nodes prepared / used / reused</span>
							<code
								>{profile.cpu.contribution.mean.portalNodePreparationCount.toFixed(
									1,
								)} / {profile.cpu.contribution.mean.portalNodeUseCount.toFixed(
									1,
								)} / {profile.cpu.contribution.mean.repeatedPortalNodeUseCount.toFixed(
									1,
								)}</code
							>
						</div>
						<div class="ac-param-row">
							<span class="ac-param-key">Sets / uses / reused</span>
							<code
								>{profile.cpu.contribution.mean.portalContributionSetCount.toFixed(
									1,
								)} / {profile.cpu.contribution.mean.portalContributionSetUseCount.toFixed(
									1,
								)} / {profile.cpu.contribution.mean.repeatedPortalContributionSetUseCount.toFixed(
									1,
								)}</code
							>
						</div>
					</div>
				</details>
				<p class="explorer-frame-note">
					Profiling adds CPU clocks and asynchronous GPU queries. GPU values may
					describe an earlier frame.
				</p>
			{/if}
		</fieldset>
	{/if}

	{#if metrics === null}
		<p>Waiting for renderer diagnostics.</p>
	{:else}
		<fieldset class="explorer-section">
			<legend>Workload</legend>
			<div class="explorer-frame-summary">
				<div>
					<span>Scene entries</span><strong
						>{metrics.visibleSceneEntries}</strong
					>
				</div>
				<div>
					<span>Static draws</span><strong
						>{metrics.submittedStaticObjectDrawCount}</strong
					>
				</div>
				<div>
					<span>Triangles</span><strong
						>{metrics.submittedStaticObjectTriangleCount}</strong
					>
				</div>
				<div>
					<span>Texture binds</span><strong>{metrics.objectTextureBinds}</strong
					>
				</div>
			</div>
			<div class="ac-param-panel">
				<div class="ac-param-row">
					<span class="ac-param-key">Views / terrain inputs</span>
					<code>{metrics.viewCount} / {metrics.terrainFrameInputs}</code>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Static layers / nodes</span>
					<code
						>{metrics.visibleStaticLayerCount} / {metrics.visibleStaticNodeCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Generated instances / draws</span>
					<code
						>{metrics.submittedCompactedGeneratedInstanceCount} / {metrics.submittedCompactedGeneratedDrawCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Visible dynamics / parts</span>
					<code
						>{metrics.visibleDynamicEntityCount} / {metrics.visibleDynamicPartCount}</code
					>
				</div>
			</div>
		</fieldset>

		<details class="explorer-frame-details">
			<summary>Object pipeline</summary>
			<div class="ac-param-panel">
				<div class="ac-param-row">
					<span class="ac-param-key">Generated fragments / selected</span>
					<code
						>{metrics.selectedGeneratedInstanceFragmentCount} / {metrics.selectedGeneratedInstanceCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key"
						>Generated tested / retained / rejected</span
					>
					<code
						>{metrics.testedGeneratedInstanceCount} / {metrics.retainedGeneratedInstanceCount}
						/ {metrics.rejectedGeneratedInstanceCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Transparent total candidates / runs</span>
					<code
						>{metrics.transparentObjectCandidateCount} / {metrics.transparentFrameRunCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Transparent far / near runs</span>
					<code
						>{metrics.farTransparentFrameRunCount} / {metrics.nearTransparentFrameRunCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Dynamic draws / instances</span>
					<code
						>{metrics.submittedDynamicDrawCount} / {metrics.submittedDynamicInstanceCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Programs / texture binds</span>
					<code
						>{metrics.objectProgramChanges} / {metrics.objectTextureBinds}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Instance upload count / bytes</span>
					<code
						>{metrics.frameInstanceUploadCount} / {metrics.frameInstanceUploadBytes}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Arena capacity / high water / growth</span>
					<code
						>{metrics.frameInstanceCapacity} / {metrics.frameInstanceViewHighWaterMark}
						/ {metrics.frameInstanceGrowthCount}</code
					>
				</div>
			</div>
		</details>

		<details class="explorer-frame-details">
			<summary>Portal and EnvCell</summary>
			<div class="ac-param-panel">
				<div class="ac-param-row">
					<span class="ac-param-key">Mode / visible scopes</span>
					<code
						>{metrics.envCellRenderMode} / {metrics.visibleEnvCellScopeCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Shells / residents</span>
					<code
						>{metrics.visibleEnvCellShells} / {metrics.visibleEnvCellResidentNodes}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Shell draws / triangles</span>
					<code
						>{metrics.submittedEnvCellShellDrawCount} / {metrics.submittedEnvCellShellTriangleCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Resident draws / triangles</span>
					<code
						>{metrics.submittedEnvCellResidentDrawCount} / {metrics.submittedEnvCellResidentTriangleCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Node submissions / nodes</span>
					<code
						>{metrics.portalSubmittedRenderNodeCount} / {metrics.portalRenderNodeCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Layers / mask edges / aperture draws</span>
					<code
						>{metrics.portalRenderLayerCount} / {metrics.portalMaskEdgeCount} / {metrics.submittedPortalApertureDrawCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key"
						>Scope-window states / exterior renders</span
					>
					<code
						>{metrics.portalAdmittedScopeWindowStateCount} / {metrics.portalExteriorRenderCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Facing / footprint rejects</span>
					<code
						>{metrics.portalRejectedFacingCrossingCount} / {metrics.portalRejectedFootprintCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Retained targets / bytes</span>
					<code
						>{metrics.sceneDomainTargetCount} / {metrics.sceneDomainTargetBytes}</code
					>
				</div>
			</div>
		</details>
	{/if}

	{#if dynamics !== null}
		<details class="explorer-frame-details">
			<summary>Runtime lifetime counters</summary>
			<div class="ac-param-panel">
				<div class="ac-param-row">
					<span class="ac-param-key">Entities / templates / animations</span>
					<code
						>{dynamics.dynamics.entityCount} / {dynamics.dynamics.templates
							.templateCount} / {dynamics.dynamics.animationResources
							.animationCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key"
						>Animation advance / sample / publish ms</span
					>
					<code
						>{dynamics.animation.lastAdvancementDurationMs.toFixed(2)} / {dynamics.animation.lastSamplingDurationMs.toFixed(
							2,
						)} / {dynamics.dynamics.lastPresentationPublicationDurationMs.toFixed(
							2,
						)}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Hooks executed / deferred / fallback</span>
					<code
						>{dynamics.effects.executedHookCount} / {dynamics.effects
							.deferredHookCount} / {dynamics.dynamics
							.staticFallbackEntityCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key">Visible / offscreen / skipped samples</span
					>
					<code
						>{dynamics.presentationCadence.lastVisibleSampleCount} / {dynamics
							.presentationCadence.lastOffscreenSampleCount} / {dynamics
							.presentationCadence.lastSkippedSampleCount}</code
					>
				</div>
				<div class="ac-param-row">
					<span class="ac-param-key"
						>Offscreen interval / visible pose age ms</span
					>
					<code
						>{(
							dynamics.presentationCadence.offscreenSampleIntervalSeconds * 1000
						).toFixed(0)} / {(
							dynamics.presentationCadence
								.lastMaximumVisiblePresentationAgeSeconds * 1000
						).toFixed(1)}</code
					>
				</div>
			</div>
		</details>
	{/if}
</div>
