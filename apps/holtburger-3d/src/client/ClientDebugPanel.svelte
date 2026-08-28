<script lang="ts">
	import { onMount } from "svelte";
	import type {
		ClientDiagnosticResidency,
		ClientPresentationDiagnostics,
	} from "./client-presentation-session";

	interface Props {
		readonly readDiagnostics: () => ClientPresentationDiagnostics | null;
	}

	const { readDiagnostics }: Props = $props();
	let diagnostics = $state<ClientPresentationDiagnostics | null>(null);

	onMount(() => {
		const sample = (): void => {
			diagnostics = readDiagnostics();
		};
		sample();
		const interval = window.setInterval(sample, 250);
		return () => window.clearInterval(interval);
	});

	function formatGuid(guid: number | null): string {
		return guid === null
			? "unavailable"
			: `0x${guid.toString(16).padStart(8, "0")}`;
	}

	function formatResidency(
		residency: ClientDiagnosticResidency | null,
	): string {
		if (residency === null) return "unavailable";
		return residency.envCellId ?? residency.landblockId;
	}
</script>

<div class="debug-panel-body ac-panel-body">
	{#if diagnostics === null}
		<p>Presentation unavailable.</p>
	{:else}
		<dl>
			<dt>Player</dt>
			<dd>{formatGuid(diagnostics.playerGuid)}</dd>
			<dt>Player residency</dt>
			<dd>{formatResidency(diagnostics.playerResidency)}</dd>
			<dt>Camera residency</dt>
			<dd>{formatResidency(diagnostics.cameraResidency)}</dd>
			<dt>Camera state</dt>
			<dd>{diagnostics.cameraStatus.kind}</dd>
			{#if diagnostics.cameraStatus.kind === "active"}
				<dt>Camera reach</dt>
				<dd>
					{diagnostics.cameraStatus.renderedReach.toFixed(2)} / {diagnostics.cameraStatus.desiredReach.toFixed(
						2,
					)}
				</dd>
				<dt>Camera sequence</dt>
				<dd>{diagnostics.cameraStatus.sequence}</dd>
				<dt>Dropped paths</dt>
				<dd>{diagnostics.cameraStatus.droppedPaths}</dd>
			{/if}
			<dt>Rendered frames</dt>
			<dd>{diagnostics.renderedFrameCount.toLocaleString()}</dd>
			<dt>Viewport</dt>
			<dd>
				{diagnostics.viewport.cssWidth} × {diagnostics.viewport.cssHeight}
			</dd>
			<dt>Draw buffer</dt>
			<dd>
				{diagnostics.viewport.drawingBufferWidth} × {diagnostics.viewport
					.drawingBufferHeight}
			</dd>
			{#if diagnostics.draw !== null}
				<dt>Views</dt>
				<dd>{diagnostics.draw.viewCount}</dd>
				<dt>Scene entries</dt>
				<dd>{diagnostics.draw.visibleSceneEntries}</dd>
				<dt>Static nodes</dt>
				<dd>{diagnostics.draw.visibleStaticNodes}</dd>
				<dt>Dynamic entities</dt>
				<dd>{diagnostics.draw.visibleDynamicEntities}</dd>
				<dt>Dynamic parts</dt>
				<dd>{diagnostics.draw.visibleDynamicParts}</dd>
				<dt>Object draws</dt>
				<dd>{diagnostics.draw.objectDrawCalls}</dd>
				<dt>Dynamic draws</dt>
				<dd>{diagnostics.draw.dynamicDrawCalls}</dd>
				<dt>Particle batches</dt>
				<dd>{diagnostics.draw.particleBatches}</dd>
			{/if}
		</dl>
	{/if}
</div>

<style>
	.debug-panel-body {
		height: 100%;
		min-height: 0;
		overflow: auto;
	}
	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		align-content: start;
		gap: 4px 12px;
		margin: 0;
	}
	dt {
		color: var(--ac-ink-muted);
	}
	dd {
		min-width: 0;
		margin: 0;
		color: var(--ac-ink);
		font-family: var(--ac-font-ui);
		overflow-wrap: anywhere;
		font-variant-numeric: tabular-nums;
	}
	p {
		margin: 0;
	}
</style>
