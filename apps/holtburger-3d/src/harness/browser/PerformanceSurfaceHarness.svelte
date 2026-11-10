<script lang="ts">
	import { onMount, tick } from "svelte";
	import ClientDebugPanel from "../../client/ClientDebugPanel.svelte";
	import ExplorerFramePanel from "../../explorer/ExplorerFramePanel.svelte";
	import type { RendererFrameDiagnosticsSnapshot } from "../../lib/game/renderer/renderer";
	import { PerformanceSession } from "../../app/performance-session";
	import { EXPLORER_TUNING } from "../../explorer/explorer-tuning";

	/** Optional real diagnostic facts with a controlled capability outcome for UI coverage. */
	let {
		diagnostics = null,
	}: { diagnostics?: RendererFrameDiagnosticsSnapshot | null } = $props();
	let visible = $state(true);
	const canvas = document.createElement("canvas");
	const enabled = { client: false, explorer: false };
	function build(mode: "client" | "explorer"): PerformanceSession {
		return new PerformanceSession({
			mode,
			canvas,
			native: {
				kind: "unavailable",
				reason: "Synthetic lifecycle fixture has no native host.",
			},
			readGraphics: () => EXPLORER_TUNING.frameSettings,
			readFrameRates: () => null,
			readDevice: () => ({
				renderer: "synthetic",
				vendor: "synthetic",
				version: "fixture",
				shadingLanguageVersion: "fixture",
				unmaskedVendor: null,
				unmaskedRenderer: null,
			}),
			runtime: {
				setFrameProfilingEnabled: (value) => {
					enabled[mode] = value;
				},
				resetFrameProfile: () => {},
				getRendererFrameDiagnostics: () => (enabled[mode] ? diagnostics : null),
				getPresentationProfile: () => null,
				getTerrainWorkerDiagnostics: () => ({
					activeJobCount: 0,
					queuedJobCount: 0,
					peakQueuedJobCount: 0,
					completedJobCount: 0,
					totalQueueDelayMs: 0,
					totalJobTurnaroundMs: 0,
					transferredBytes: 0,
					workerCount: 1,
				}),
			},
		});
	}
	const sessions = { client: build("client"), explorer: build("explorer") };

	async function waitFor(condition: () => boolean): Promise<void> {
		const deadline = performance.now() + 5000;
		while (!condition()) {
			if (performance.now() > deadline)
				throw new Error("Performance surface did not settle.");
			await new Promise((resolve) => window.setTimeout(resolve, 20));
		}
	}
	function findButton(
		mode: string,
		text: string,
	): HTMLButtonElement | undefined {
		return [
			...document.querySelectorAll<HTMLButtonElement>(
				`[data-mode="${mode}"] button`,
			),
		].find((item) => item.textContent?.trim() === text);
	}
	function button(mode: string, text: string): HTMLButtonElement {
		const result = findButton(mode, text);
		if (!result) throw new Error(`Missing ${mode} performance action: ${text}`);
		return result;
	}

	/** Exercise production panel compositions; fixture timings are not performance evidence. */
	export async function probe(): Promise<{ passed: true; modes: string[] }> {
		const modes = ["client", "explorer"] as const;
		for (const mode of modes) {
			const session = sessions[mode];
			await waitFor(
				() => findButton(mode, "Start profiling")?.disabled === false,
			);
			button(mode, "Start profiling").click();
			await waitFor(() => session.recording);
			if (!enabled[mode])
				throw new Error("Panel did not enable its collector.");
			session.recordFrame(1);
			if (diagnostics?.profile?.gpu.kind === "unsupported") {
				await waitFor(() =>
					Boolean(
						document
							.querySelector(`[data-mode="${mode}"] .performance-panel`)
							?.textContent?.includes("unsupported"),
					),
				);
			}
			await waitFor(
				() => findButton(mode, "Reset capture")?.disabled === false,
			);
			if (mode === "client") {
				const disclosure = document.querySelector(
					'[data-mode="client"] [data-debug-section="performance"]',
				);
				if (!(disclosure instanceof HTMLDetailsElement))
					throw new Error("Client performance disclosure is missing.");
				disclosure.open = false;
				await waitFor(
					() =>
						document.querySelector(
							'[data-mode="client"] .performance-panel',
						) === null,
				);
				if (!session.recording)
					throw new Error("Collapsing performance stopped its capture.");
				disclosure.open = true;
				await waitFor(
					() => findButton(mode, "Reset capture")?.disabled === false,
				);
			}
			button(mode, "Reset capture").click();
			await waitFor(() => session.snapshot()?.browser.sampleCount === 0);
			visible = false;
			await tick();
			session.recordFrame(1);
			if (!session.recording || session.snapshot()?.browser.sampleCount !== 1)
				throw new Error("Panel visibility changed recording ownership.");
			visible = true;
			await tick();
			await waitFor(
				() => findButton(mode, "Stop profiling")?.disabled === false,
			);
			button(mode, "Stop profiling").click();
			await waitFor(() => !session.recording);
			if (enabled[mode] || session.snapshot()?.capture.state !== "stopped")
				throw new Error(
					"Stop did not release collection and preserve its report.",
				);
			await waitFor(
				() => findButton(mode, "Start profiling")?.disabled === false,
			);
			button(mode, "Start profiling").click();
			await waitFor(() => session.recording);
			session.retire();
			if (enabled[mode] || !session.snapshot()?.capture.retired)
				throw new Error("Retirement did not freeze the capture.");
		}
		return { passed: true, modes: [...modes] };
	}

	onMount(() => {
		const fixture = window as Window & {
			__HOLTBURGER_PERFORMANCE_SURFACES__?: typeof probe;
		};
		fixture.__HOLTBURGER_PERFORMANCE_SURFACES__ = probe;
		return () => {
			delete fixture.__HOLTBURGER_PERFORMANCE_SURFACES__;
			for (const session of Object.values(sessions)) session.retire();
		};
	});
</script>

{#if visible}
	<div data-mode="client">
		<ClientDebugPanel
			readPerformanceSession={() => sessions.client}
			readDiagnostics={() => null}
			readSelectedEntity={() => null}
			entityCollisionDisabled={false}
			onEntityCollisionDisabledChange={() => {}}
			unrestrictedUse={false}
			onUnrestrictedUseChange={() => {}}
			showRetailHiddenGeometry={false}
			onShowRetailHiddenGeometryChange={() => {}}
		/>
	</div>
	<div data-mode="explorer">
		<ExplorerFramePanel
			readPerformanceSession={() => sessions.explorer}
			readRendererFrameDiagnostics={() => null}
			readAuthoredDynamicRuntimeDiagnostics={() => null}
			captureReport={() => null}
		/>
	</div>
{/if}
