<script lang="ts">
	import { onMount } from "svelte";
	import type { PerformanceSession } from "./performance-session";
	import {
		RENDERER_GPU_SYSTEMS,
		type RendererGpuSystem,
	} from "../lib/game/renderer/renderer";
	import {
		serializePerformanceReport,
		type PerformanceReport,
	} from "./performance-report";

	interface Props {
		/** Cold read; the mode root owns recording independently of this component. */
		readonly readSession: () => PerformanceSession | null;
		/** A surrounding disclosure may already supply the section heading. */
		readonly showHeading?: boolean;
	}
	let { readSession, showHeading = true }: Props = $props();
	let session = $state<PerformanceSession | null>(null);
	let report = $state<PerformanceReport | null>(null);
	let busy = $state(false);
	let retired = $state(false);
	let status = $state<string | null>(null);
	const profile = $derived(report?.renderer ?? null);
	const presentation = $derived(report?.browser.presentation?.frame ?? null);
	const gpu = $derived(profile?.gpu ?? null);
	const recording = $derived(report?.capture.state === "recording");
	const native = $derived(report?.native);
	const gpuSystemLabels: Record<RendererGpuSystem, string> = {
		terrain: "Terrain",
		opaqueGeometry: "Opaque geometry",
		shadowMaps: "Shadow maps",
		ambientOcclusion: "Ambient occlusion",
		portalComposition: "Portal composition",
		transparencyAndEffects: "Transparency and effects",
		other: "Other renderer work",
	};
	const ms = (value: number | null | undefined): string =>
		value == null ? "—" : `${value.toFixed(2)} ms`;

	function sample(): void {
		session = readSession();
		retired = session?.retired ?? false;
		report = session?.snapshot() ?? null;
		void session?.refresh();
	}
	onMount(() => {
		sample();
		const interval = window.setInterval(sample, 250);
		return () => window.clearInterval(interval);
	});

	async function control(action: "start" | "reset" | "stop"): Promise<void> {
		const current = readSession();
		if (!current) return;
		busy = true;
		try {
			await current[action]();
			status = `Profiling ${action === "start" ? "started" : action === "stop" ? "stopped" : "reset"}.`;
		} catch (error) {
			status = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
			sample();
		}
	}

	async function exportReport(download: boolean): Promise<void> {
		try {
			const currentSession = readSession();
			await currentSession?.refresh();
			const current = currentSession?.snapshot();
			if (!current) throw new Error("Start a capture before exporting.");
			const json = serializePerformanceReport(current);
			if (download) {
				const url = URL.createObjectURL(
					new Blob([json], { type: "application/json" }),
				);
				const anchor = document.createElement("a");
				anchor.download = `holtburger-performance-${current.capture.startedAt.replaceAll(":", "-")}.json`;
				anchor.href = url;
				anchor.click();
				window.setTimeout(() => URL.revokeObjectURL(url), 0);
			} else await navigator.clipboard.writeText(json);
			status = download
				? "Downloaded performance report."
				: "Copied performance report.";
		} catch (error) {
			status = error instanceof Error ? error.message : String(error);
		}
	}
</script>

<section aria-label="Performance" class="performance-panel">
	{#if showHeading}<strong>Performance</strong>{/if}
	<div class="performance-actions">
		<button
			type="button"
			class="ui-button"
			data-performance-action={recording ? "stop" : "start"}
			disabled={session === null || busy || retired}
			onclick={() => void control(recording ? "stop" : "start")}
			>{recording ? "Stop profiling" : "Start profiling"}</button
		>
		<button
			type="button"
			class="ui-button"
			disabled={!recording || busy}
			data-performance-action="reset"
			onclick={() => void control("reset")}>Reset capture</button
		>
		<button
			type="button"
			class="ui-button"
			disabled={report === null || busy}
			data-performance-action="copy"
			onclick={() => void exportReport(false)}>Copy report</button
		>
		<button
			type="button"
			class="ui-button"
			disabled={report === null || busy}
			data-performance-action="download"
			onclick={() => void exportReport(true)}>Download JSON</button
		>
	</div>
	{#if status}<p role="status">{status}</p>{/if}
	{#if report}
		<div class="performance-output ui-well">
			<p class="ui-muted">
				{report.capture.state} · {(report.capture.elapsedMs / 1000).toFixed(1)} s
				· {report.browser.sampleCount} frames
			</p>
			<table>
				<tbody>
					<tr
						><th>Frame rate</th><td
							>{report.browser.frameRates
								? `${report.browser.frameRates.capped.toFixed(0)} FPS`
								: "—"}</td
						></tr
					>
					<tr
						><th>Browser work</th><td>{ms(report.browser.meanFrameWorkMs)}</td
						></tr
					>
					<tr
						><th title="Sum of sequential GPU timing segments"
							>GPU measured total</th
						><td
							>{gpu?.kind === "available"
								? ms(gpu.meanMs)
								: (gpu?.kind ?? "pending")}</td
						></tr
					>
				</tbody>
			</table>
			<details class="ui-disclosure">
				<summary>Browser systems</summary>
				<div class="performance-subsection">
					<table>
						<thead><tr><th>System</th><th>Mean</th></tr></thead><tbody>
							<tr
								><td>Content commits</td><td
									>{ms(
										report.browser.presentation?.work.contentCommit?.meanMs,
									)}</td
								></tr
							>
							<tr
								><td>Placement updates</td><td
									>{ms(
										report.browser.presentation?.work.placementAdvance?.meanMs,
									)}</td
								></tr
							>
							<tr><td>Effects</td><td>{ms(presentation?.mean.effects)}</td></tr>
							<tr
								><td>Animation</td><td>{ms(presentation?.mean.animation)}</td
								></tr
							>
							<tr><td>Audio</td><td>{ms(presentation?.mean.audio)}</td></tr>
							<tr
								><td>Render preparation &amp; draw</td><td
									>{ms(presentation?.mean.render)}</td
								></tr
							>
							<tr><td>↳ Renderer CPU</td><td>{ms(profile?.cpu.meanMs)}</td></tr>
						</tbody>
					</table>
				</div>
			</details>
			<details class="ui-disclosure">
				<summary>GPU systems</summary>
				<div class="performance-subsection">
					{#if gpu?.kind === "available"}
						<table>
							<thead><tr><th>System</th><th>Latest</th><th>Mean</th></tr></thead
							>
							<tbody>
								{#each RENDERER_GPU_SYSTEMS as system (system)}
									<tr data-gpu-system={system}
										><th>{gpuSystemLabels[system]}</th><td
											>{ms(gpu.latestSystemMs[system])}</td
										><td>{ms(gpu.meanSystemMs[system])}</td></tr
									>
								{/each}
							</tbody>
						</table>
						<p class="ui-muted">
							All systems use the same resolved frames. Frames without a system
							contribute zero.
						</p>
					{:else}<p class="ui-muted">{gpu?.kind ?? "pending"}</p>{/if}
				</div>
			</details>
			<details class="ui-disclosure">
				<summary>Native host</summary>
				<div class="performance-subsection">
					{#if native?.kind === "available"}
						<table>
							<thead
								><tr><th>Workload</th><th>Samples</th><th>Mean elapsed</th></tr
								></thead
							><tbody>
								{#each native.snapshot.authority as scope}<tr
										><td
											>{scope.scope === "physics_tick"
												? "World update"
												: scope.scope === "network_batch"
													? "Network dispatch"
													: "Commands"}</td
										><td>{scope.sampleCount}</td><td>{ms(scope.meanMs)}</td></tr
									>{/each}
								<tr
									><td>Event forwarding</td><td
										>{native.snapshot.forwarding.sampleCount}</td
									><td>{ms(native.snapshot.forwarding.meanMs)}</td></tr
								>
							</tbody>
						</table>
					{:else if native?.kind === "unavailable" || native?.kind === "failed"}<p
						>
							{native.reason}
						</p>
					{:else}<p>pending</p>{/if}
				</div>
			</details>
			<details class="ui-disclosure">
				<summary>Terrain worker</summary>
				<div class="performance-subsection">
					<table>
						<tbody>
							<tr
								><th>Active / queued</th><td
									>{report.terrainWorker.activeJobs} / {report.terrainWorker
										.queuedJobs}</td
								></tr
							>
							<tr
								><th>Completed</th><td>{report.terrainWorker.completedJobs}</td
								></tr
							>
							<tr
								><th>Queue delay total</th><td
									>{ms(report.terrainWorker.queueDelayMs)}</td
								></tr
							>
							<tr
								><th>Turnaround total</th><td
									>{ms(report.terrainWorker.jobTurnaroundMs)}</td
								></tr
							>
							<tr
								><th>Request bytes</th><td
									>{report.terrainWorker.transferredRequestBytes.toLocaleString()}</td
								></tr
							>
							<tr
								><th>Capture-start active / queued</th><td
									>{report.terrainWorker.activeJobsAtStart} / {report
										.terrainWorker.queuedJobsAtStart}</td
								></tr
							>
						</tbody>
					</table>
				</div>
			</details>
			<details class="ui-disclosure">
				<summary>Capture counts</summary>
				<div class="performance-subsection">
					<table>
						<tbody>
							<tr
								><th>Renderer CPU frames</th><td
									>{profile?.cpu.sampleCount ?? "—"}</td
								></tr
							>
							<tr
								><th>Recent renderer CPU p95</th><td
									>{ms(profile?.cpu.p95RecentMs)}</td
								></tr
							>
							<tr
								><th>GPU resolved / pending</th><td
									>{gpu?.kind === "available"
										? `${gpu.sampleCount} / ${gpu.pendingFrameCount}`
										: (gpu?.kind ?? "pending")}</td
								></tr
							>
							<tr
								><th>GPU skipped frames</th><td
									>{gpu && gpu.kind !== "unsupported"
										? gpu.skippedFrameCount
										: "—"}</td
								></tr
							>
							{#if report.workload}<tr
									><th>Scene entries</th><td>{report.workload.sceneEntries}</td
									></tr
								><tr
									><th>Static / dynamic draws</th><td
										>{report.workload.staticDraws} / {report.workload
											.dynamicDraws}</td
									></tr
								>{/if}
							<tr
								><th>Render scale</th><td
									>{report.context.graphics.quality.renderScale}</td
								></tr
							>
						</tbody>
					</table>
				</div>
			</details>
		</div>
	{:else}<p class="ui-muted">
			{session ? "Start profiling to capture timings." : "Runtime unavailable."}
		</p>{/if}
</section>

<style>
	@layer components {
		.performance-panel {
			display: grid;
			gap: 0.5rem;
		}
		.performance-output {
			display: grid;
			gap: 0.5rem;
			padding: 0.65rem;
			margin-inline-start: 0.5rem;
		}
		.performance-subsection {
			padding-inline-start: 0.75rem;
		}
		.performance-actions {
			display: flex;
			flex-wrap: wrap;
			gap: 0.35rem;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			font-variant-numeric: tabular-nums;
		}
		th,
		td {
			text-align: left;
			padding: 0.2rem;
		}
		th:last-child,
		td:last-child {
			text-align: right;
		}
		p {
			margin: 0;
		}
	}
</style>
