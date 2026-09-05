<script lang="ts">
	import { onMount } from "svelte";
	import type {
		ClientDiagnosticResidency,
		ClientPresentationDiagnostics,
	} from "./client-presentation-session";
	import ToggleField from "../app/ToggleField.svelte";

	interface Props {
		readonly readDiagnostics: () => ClientPresentationDiagnostics | null;
		readonly showRetailHiddenGeometry: boolean;
		readonly onShowRetailHiddenGeometryChange: (visible: boolean) => void;
	}

	const {
		readDiagnostics,
		showRetailHiddenGeometry,
		onShowRetailHiddenGeometryChange,
	}: Props = $props();
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

{#snippet diagnosticRow(label: string, value: string | number)}
	<div class="ac-param-row">
		<dt class="ac-param-key">{label}</dt>
		<dd><code>{value}</code></dd>
	</div>
{/snippet}

<div class="debug-panel-body ac-panel-body">
	<ToggleField
		checked={showRetailHiddenGeometry}
		label="Retail-hidden geometry"
		checkedLabel="Shown"
		uncheckedLabel="Hidden"
		onCheckedChange={onShowRetailHiddenGeometryChange}
	/>
	{#if diagnostics === null}
		<p>Presentation unavailable.</p>
	{:else}
		<dl class="ac-param-panel">
			{@render diagnosticRow("Player", formatGuid(diagnostics.playerGuid))}
			{@render diagnosticRow(
				"Player residency",
				formatResidency(diagnostics.playerResidency),
			)}
			{@render diagnosticRow(
				"Camera residency",
				formatResidency(diagnostics.cameraResidency),
			)}
			{@render diagnosticRow("Camera state", diagnostics.cameraStatus.kind)}
			{#if diagnostics.cameraStatus.kind === "active"}
				{@render diagnosticRow(
					"Camera reach",
					`${diagnostics.cameraStatus.renderedReach.toFixed(2)} / ${diagnostics.cameraStatus.desiredReach.toFixed(2)}`,
				)}
				{@render diagnosticRow(
					"Camera sequence",
					diagnostics.cameraStatus.sequence,
				)}
				{@render diagnosticRow(
					"Dropped paths",
					diagnostics.cameraStatus.droppedPaths,
				)}
			{/if}
			{@render diagnosticRow(
				"Rendered frames",
				diagnostics.renderedFrameCount.toLocaleString(),
			)}
			{@render diagnosticRow(
				"Viewport",
				`${diagnostics.viewport.cssWidth} × ${diagnostics.viewport.cssHeight}`,
			)}
			{@render diagnosticRow(
				"Draw buffer",
				`${diagnostics.viewport.drawingBufferWidth} × ${diagnostics.viewport.drawingBufferHeight}`,
			)}
			{#if diagnostics.draw !== null}
				{@render diagnosticRow("Views", diagnostics.draw.viewCount)}
				{@render diagnosticRow(
					"Scene entries",
					diagnostics.draw.visibleSceneEntries,
				)}
				{@render diagnosticRow(
					"Static nodes",
					diagnostics.draw.visibleStaticNodes,
				)}
				{@render diagnosticRow(
					"Dynamic entities",
					diagnostics.draw.visibleDynamicEntities,
				)}
				{@render diagnosticRow(
					"Dynamic source ranges",
					diagnostics.draw.visibleDynamicSourceRanges,
				)}
				{@render diagnosticRow(
					"Object draws",
					diagnostics.draw.objectDrawCalls,
				)}
				{@render diagnosticRow(
					"Dynamic draws",
					diagnostics.draw.dynamicDrawCalls,
				)}
				{@render diagnosticRow(
					"Particle batches",
					diagnostics.draw.particleBatches,
				)}
				{@render diagnosticRow(
					"Selection mask",
					diagnostics.draw.entitySelection.skippedReason ??
						`${diagnostics.draw.entitySelection.selectedPartCount} parts / ${diagnostics.draw.entitySelection.selectedSphereProxyCount} sphere proxies / ${diagnostics.draw.entitySelection.selectedTriangleCount} triangles`,
				)}
				{@render diagnosticRow(
					"Selection storage",
					`${diagnostics.draw.entitySelection.activeMaskBytes.toLocaleString()} bytes`,
				)}
			{/if}
		</dl>
	{/if}
</div>

<style>
	.debug-panel-body {
		display: grid;
		align-content: start;
		gap: 12px;
		height: 100%;
		min-height: 0;
		overflow: auto;
	}
	dl {
		margin: 0;
	}
	dd {
		min-width: 0;
		margin: 0;
	}
	p {
		margin: 0;
	}
</style>
