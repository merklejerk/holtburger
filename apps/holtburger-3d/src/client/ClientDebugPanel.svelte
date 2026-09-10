<script lang="ts">
	import type { WeenieCatalogCapability } from "../lib/host/weenie-catalog-capability";
	import { onMount } from "svelte";
	import type {
		ClientDiagnosticResidency,
		ClientPresentationDiagnostics,
	} from "./client-presentation-session";
	import ToggleField from "../app/ToggleField.svelte";

	interface Props {
		/** Startup catalog availability for switch classification diagnostics. */
		readonly entityMetadata: WeenieCatalogCapability | null;
		readonly readDiagnostics: () => ClientPresentationDiagnostics | null;
		/** Runtime-confirmed local player response override. */
		readonly entityCollisionDisabled: boolean;
		readonly onEntityCollisionDisabledChange: (disabled: boolean) => void;
		/** Explicit local override of authored useability for diagnostic requests. */
		readonly unrestrictedUse: boolean;
		readonly onUnrestrictedUseChange: (enabled: boolean) => void;
		readonly showRetailHiddenGeometry: boolean;
		readonly onShowRetailHiddenGeometryChange: (visible: boolean) => void;
	}

	const {
		entityMetadata,
		readDiagnostics,
		entityCollisionDisabled,
		onEntityCollisionDisabledChange,
		unrestrictedUse,
		onUnrestrictedUseChange,
		showRetailHiddenGeometry,
		onShowRetailHiddenGeometryChange,
	}: Props = $props();
	let diagnostics = $state<ClientPresentationDiagnostics | null>(null);
	const selected = $derived(diagnostics?.selectedEntity ?? null);

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
	<div class="diagnostic-row">
		<dt class="ui-muted">{label}</dt>
		<dd><code class="ui-mono">{value}</code></dd>
	</div>
{/snippet}

<div class="debug-panel-body ui-body">
	<section aria-label="Entity metadata">
		<strong>Entity metadata</strong>
		{#if entityMetadata === null}<p class="ui-muted">Loading catalog status…</p>
		{:else if entityMetadata.status === "available"}<p class="ui-muted">
				{entityMetadata.recordCount.toLocaleString()} templates available
			</p>
		{:else}<p class="ui-muted">
				Switch classification unavailable: {entityMetadata.reason}
			</p>{/if}
	</section>
	<section class="selected-details" aria-label="Selected entity details">
		<strong>Selected entity</strong>
		{#if selected === null}
			<p class="ui-muted">
				Select an entity in the world or minimap to inspect it.
			</p>
		{:else}
			<dl class="ui-well">
				{@render diagnosticRow("GUID", formatGuid(selected.guid))}
				{#if selected.view !== null}
					{@const entity = selected.view}
					{@render diagnosticRow("Name", entity.display.name)}
					{@render diagnosticRow(
						"WCID",
						`${entity.identity.wcid} (${formatGuid(entity.identity.wcid)})`,
					)}
					{@render diagnosticRow(
						"Presentation class",
						entity.presentation.entityClass,
					)}
					{@render diagnosticRow(
						"Radar category",
						entity.presentation.radar.category,
					)}
					{@render diagnosticRow(
						"Radar behavior",
						entity.presentation.radar.behavior ?? "unspecified",
					)}
					{@render diagnosticRow(
						"Setup",
						formatGuid(entity.presentation.content.setupDid),
					)}
					{@render diagnosticRow(
						"Motion table",
						formatGuid(entity.presentation.content.motionTableDid),
					)}
				{/if}
			</dl>
			{#if selected.view === null}
				<p class="ui-muted">Selected entity data is unavailable.</p>
			{:else}
				<details>
					<summary>Received entity snapshot (JSON)</summary>
					<textarea
						class="ui-mono"
						aria-label="Selected entity JSON"
						readonly
						rows="12"
						value={JSON.stringify(selected.view, null, 2)}
					></textarea>
				</details>
			{/if}
		{/if}
	</section>
	<ToggleField
		checked={unrestrictedUse}
		label="Unrestricted use"
		checkedLabel="On"
		uncheckedLabel="Off"
		onCheckedChange={onUnrestrictedUseChange}
	/>
	<ToggleField
		checked={entityCollisionDisabled}
		label="Disable entity collision"
		checkedLabel="On"
		uncheckedLabel="Off"
		onCheckedChange={onEntityCollisionDisabledChange}
	/>
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
		<dl class="ui-well">
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
	@layer components {
		.selected-details {
			display: grid;
			gap: 8px;
			user-select: text;
		}
		textarea {
			box-sizing: border-box;
			width: 100%;
			margin-top: 8px;
			resize: vertical;
		}
		.diagnostic-row {
			display: grid;
			grid-template-columns: minmax(90px, 0.8fr) minmax(0, 1.2fr);
			gap: 6px;
			padding: 3px 0;
			overflow-wrap: anywhere;
		}
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
	}
</style>
