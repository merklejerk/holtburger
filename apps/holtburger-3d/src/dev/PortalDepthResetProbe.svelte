<script lang="ts">
	import { onDestroy, onMount } from "svelte";

	import {
		runPortalDepthResetProbe,
		type PortalDepthResetProbeResult,
	} from "./portal-depth-reset-probe";

	let canvasHost = $state<HTMLDivElement | null>(null);
	let result = $state<PortalDepthResetProbeResult | null>(null);

	onMount(() => {
		if (!canvasHost) {
			return;
		}
		result = runPortalDepthResetProbe(canvasHost);
	});

	onDestroy(() => {
		if (!canvasHost) {
			return;
		}
		canvasHost.replaceChildren();
	});
</script>

<main class="portal-depth-reset-probe">
	<section class="portal-depth-reset-probe__panel">
		<p class="portal-depth-reset-probe__kicker">Developer Probe</p>
		<h1>Portal aperture depth reset</h1>
		<p class="portal-depth-reset-probe__lede">
			Synthetic WebGL fixture for the outdoor portal stencil plan. It does not
			load DAT/HBA data.
		</p>
		<div bind:this={canvasHost} class="portal-depth-reset-probe__canvas-host">
		</div>
	</section>

	<section class="portal-depth-reset-probe__panel">
		<h2>Result</h2>
		{#if result}
			<dl class="portal-depth-reset-probe__rows">
				<div>
					<dt>Verdict</dt>
					<dd class:portal-depth-reset-probe__ok={result.verdict === "go"}>
						{result.verdict}
					</dd>
				</div>
				<div>
					<dt>Route</dt>
					<dd>{result.selectedProductionRoute}</dd>
				</div>
				<div>
					<dt>WebGL</dt>
					<dd>{result.webglVersion}</dd>
				</div>
				<div>
					<dt>Fragment depth</dt>
					<dd>{result.fragmentDepthPath}</dd>
				</div>
				<div>
					<dt>Stencil bits</dt>
					<dd>{result.stencilBits}</dd>
				</div>
				<div>
					<dt>Renderer</dt>
					<dd>{result.renderer}</dd>
				</div>
				<div>
					<dt>Vendor</dt>
					<dd>{result.vendor}</dd>
				</div>
				<div>
					<dt>Control reveal</dt>
					<dd>{result.withoutDepthResetRevealed ? "failed" : "blocked"}</dd>
				</div>
				<div>
					<dt>Reset reveal</dt>
					<dd>{result.withDepthResetRevealed ? "visible" : "blocked"}</dd>
				</div>
				<div>
					<dt>Exterior preserved</dt>
					<dd>{result.cornerPreserved ? "yes" : "no"}</dd>
				</div>
			</dl>

			<ul class="portal-depth-reset-probe__notes">
				{#each result.notes as note}
					<li>{note}</li>
				{/each}
			</ul>
		{:else}
			<p>Running probe...</p>
		{/if}
	</section>
</main>
