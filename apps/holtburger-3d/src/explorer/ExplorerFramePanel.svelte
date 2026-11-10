<script lang="ts">
	import PerformancePanel from "../app/PerformancePanel.svelte";
	import type { PerformanceSession } from "../app/performance-session";
	import { onMount } from "svelte";
	import type { RendererFrameDiagnosticsSnapshot } from "../lib/game/renderer/renderer";
	import type { GamePresentationRuntime } from "../lib/game/runtime/game-presentation-runtime";
	import {
		explorerFrameDiagnosticReportFilename,
		serializeExplorerFrameDiagnosticReport,
		type ExplorerFrameDiagnosticReport,
	} from "./explorer-frame-diagnostic-report";
	import { EXPLORER_TUNING } from "./explorer-tuning";

	interface Props {
		/** Pull the latest atomic renderer diagnostic read. */
		readonly readRendererFrameDiagnostics: () => RendererFrameDiagnosticsSnapshot | null;
		/** Pull the latest authored-dynamic residency diagnostics. */
		readonly readAuthoredDynamicRuntimeDiagnostics: () => ReturnType<
			GamePresentationRuntime["getAuthoredDynamicRuntimeDiagnostics"]
		> | null;
		/** Borrow the mode-owned profiling session without owning its lifetime. */
		readonly readPerformanceSession: () => PerformanceSession | null;
		/** Compose one current, versioned Explorer and renderer evidence bundle. */
		readonly captureReport: () => ExplorerFrameDiagnosticReport | null;
	}

	let {
		readRendererFrameDiagnostics,
		readAuthoredDynamicRuntimeDiagnostics,
		readPerformanceSession,
		captureReport,
	}: Props = $props();
	let diagnostics = $state<RendererFrameDiagnosticsSnapshot | null>(null);
	let dynamics = $state<ReturnType<
		GamePresentationRuntime["getAuthoredDynamicRuntimeDiagnostics"]
	> | null>(null);
	let exportStatus = $state<string | null>(null);

	function sampleDiagnostics(): void {
		diagnostics = readRendererFrameDiagnostics();
		dynamics = readAuthoredDynamicRuntimeDiagnostics();
	}

	onMount(() => {
		sampleDiagnostics();
		const interval = window.setInterval(
			sampleDiagnostics,
			EXPLORER_TUNING.diagnostics.frameRateDisplayIntervalMs,
		);
		return () => window.clearInterval(interval);
	});

	const metrics = $derived(diagnostics?.selectionMetrics ?? null);
	const shadowTargets = $derived(
		diagnostics?.entityShadows.outdoorTargets ?? null,
	);

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
			exportStatus = "Copied scene inspection snapshot.";
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
			class="explorer-action ui-button"
			disabled={diagnostics === null}
			onclick={() => void copyReport()}
		>
			Copy scene snapshot
		</button>
		<button
			type="button"
			class="explorer-action ui-button"
			disabled={diagnostics === null}
			onclick={downloadReport}
		>
			Download scene JSON
		</button>
	</div>
	{#if exportStatus !== null}
		<p class="explorer-frame-status" role="status">{exportStatus}</p>
	{/if}

	<PerformancePanel readSession={readPerformanceSession} />

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
			<div class="explorer-param-panel">
				<div class="explorer-param-row">
					<span class="explorer-param-key">Views / terrain inputs</span>
					<code>{metrics.viewCount} / {metrics.terrainFrameInputs}</code>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Static layers / nodes</span>
					<code
						>{metrics.visibleStaticLayerCount} / {metrics.visibleStaticNodeCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Visible dynamics / source ranges</span
					>
					<code
						>{metrics.visibleDynamicEntityCount} / {metrics.visibleDynamicSourceRangeCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Particle batches / instances / unresolved</span
					>
					<code
						>{metrics.submittedParticleBatchCount} / {metrics.submittedParticleInstanceCount}
						/ {metrics.unresolvedParticleBatchCount}</code
					>
				</div>
			</div>
		</fieldset>

		<details class="explorer-frame-details ui-disclosure">
			<summary>Nameplates</summary>
			<div class="explorer-param-panel">
				<div class="explorer-param-row">
					<span class="explorer-param-key">Eligible / budget rejected</span>
					<code
						>{diagnostics?.nameplates.eligibleCandidateCount ?? 0} / {diagnostics
							?.nameplates.budgetRejectedCandidateCount ?? 0}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Submitted instances / draws</span>
					<code
						>{diagnostics?.nameplates.submittedInstanceCount ?? 0} / {diagnostics
							?.nameplates.submittedDrawCount ?? 0}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Live textures / cache bytes</span>
					<code
						>{diagnostics?.nameplates.cache.liveEntryCount ?? 0} / {diagnostics
							?.nameplates.cache.byteCount ?? 0}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Rasterized / rejected / released</span
					>
					<code
						>{diagnostics?.nameplates.cache.rasterizationCount ?? 0} / {diagnostics
							?.nameplates.cache.rejectedRasterCount ?? 0} / {diagnostics
							?.nameplates.cache.releaseCount ?? 0}</code
					>
				</div>
			</div>
		</details>

		<details class="explorer-frame-details ui-disclosure">
			<summary>Entity shadows</summary>
			<div class="explorer-param-panel">
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Outdoor target resolution / cascades</span
					>
					<code
						>{shadowTargets?.resolution ?? "—"} / {shadowTargets?.cascadeCount ??
							"—"}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Outdoor target bytes</span>
					<code>{shadowTargets?.activeBytes ?? 0}</code>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Allocated / disposed generations</span
					>
					<code
						>{shadowTargets?.allocatedGenerationCount ?? 0} / {shadowTargets?.disposedGenerationCount ??
							0}</code
					>
				</div>
			</div>
		</details>

		<details class="explorer-frame-details ui-disclosure">
			<summary>Object pipeline</summary>
			<div class="explorer-param-panel">
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Transparent total candidates / runs</span
					>
					<code
						>{metrics.transparentObjectCandidateCount} / {metrics.transparentFrameRunCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Transparent far / near runs</span>
					<code
						>{metrics.farTransparentFrameRunCount} / {metrics.nearTransparentFrameRunCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Dynamic draws</span>
					<code>{metrics.submittedDynamicDrawCount}</code>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Object roots tested / retained / rejected</span
					>
					<code
						>{metrics.testedObjectPresentationCount} / {metrics.retainedObjectPresentationCount}
						/ {metrics.rejectedObjectPresentationCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Programs / texture binds</span>
					<code
						>{metrics.objectProgramChanges} / {metrics.objectTextureBinds}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Instance upload count / bytes</span>
					<code
						>{metrics.frameInstanceUploadCount} / {metrics.frameInstanceUploadBytes}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Arena capacity / high water / growth</span
					>
					<code
						>{metrics.frameInstanceCapacity} / {metrics.frameInstanceViewHighWaterMark}
						/ {metrics.frameInstanceGrowthCount}</code
					>
				</div>
			</div>
		</details>

		<details class="explorer-frame-details ui-disclosure">
			<summary>Portal and EnvCell</summary>
			<div class="explorer-param-panel">
				<div class="explorer-param-row">
					<span class="explorer-param-key">Mode / visible scopes</span>
					<code
						>{metrics.envCellRenderMode} / {metrics.visibleEnvCellScopeCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Shells / residents</span>
					<code
						>{metrics.visibleEnvCellShells} / {metrics.visibleEnvCellResidentNodes}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Shell draws / triangles</span>
					<code
						>{metrics.submittedEnvCellShellDrawCount} / {metrics.submittedEnvCellShellTriangleCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Resident draws / triangles</span>
					<code
						>{metrics.submittedEnvCellResidentDrawCount} / {metrics.submittedEnvCellResidentTriangleCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Selected scopes / crossings</span>
					<code
						>{metrics.portalSelectedScopeCount} / {metrics.portalSelectedCrossingCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Cull depth / propagation draws</span>
					<code
						>{metrics.portalCompletedCullDepth} / {metrics.portalPropagationDrawCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Projection work / atlas pixels</span>
					<code
						>{metrics.portalProjectionPrimitiveCount} / {metrics.portalAtlasTilePixelCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Truncated views / frontier retreats</span
					>
					<code
						>{metrics.portalTruncatedViewCount} / {metrics.portalFrontierRetreatCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Portal framebuffers / bytes</span>
					<code
						>{metrics.portalFramebufferCount} / {metrics.portalTargetBytes}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">Flat framebuffers / bytes</span>
					<code
						>{metrics.flatSceneFramebufferCount} / {metrics.flatSceneTargetBytes}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Flat target allocations / disposals</span
					>
					<code
						>{metrics.flatSceneAllocatedGenerationCount} / {metrics.flatSceneDisposedGenerationCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>AO bytes / allocations / disposals</span
					>
					<code
						>{metrics.ambientOcclusion.activeBytes} / {metrics.ambientOcclusion
							.allocatedGenerationCount} / {metrics.ambientOcclusion
							.disposedGenerationCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key">AO effective full / disabled</span>
					<code
						>{metrics.ambientOcclusion.effectiveDistanceFade
							? `${metrics.ambientOcclusion.effectiveDistanceFade.fullStrengthUntil} / ${metrics.ambientOcclusion.effectiveDistanceFade.disabledAt}`
							: "disabled"}</code
					>
				</div>
			</div>
		</details>
	{/if}

	{#if dynamics !== null}
		<details class="explorer-frame-details ui-disclosure">
			<summary>Runtime lifetime counters</summary>
			<div class="explorer-param-panel">
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Entities / templates / animations</span
					>
					<code
						>{dynamics.dynamics.entityCount} / {dynamics.dynamics.templates
							.templateCount} / {dynamics.dynamics.animationResources
							.assetCount}</code
					>
				</div>

				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Commands executed / unconsumed / fallback</span
					>
					<code
						>{dynamics.behavior.outcomeCounts.executed ?? 0} / {dynamics
							.behavior.outcomeCounts["no-consumer"] ?? 0} / {dynamics.dynamics
							.staticFallbackEntityCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key"
						>Visible / offscreen / skipped samples</span
					>
					<code
						>{dynamics.presentationCadence.lastVisibleSampleCount} / {dynamics
							.presentationCadence.lastOffscreenSampleCount} / {dynamics
							.presentationCadence.lastSkippedSampleCount}</code
					>
				</div>
				<div class="explorer-param-row">
					<span class="explorer-param-key"
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
