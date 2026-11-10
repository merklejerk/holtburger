<script lang="ts">
	import { formatItemType, formatObjectFlags } from "./client-entity-labels";
	import type { ClientSelectedEntity } from "./client-selected-entity";
	import type {
		ClientDiagnosticResidency,
		ClientGameplayPresentationDiagnostics,
	} from "./client-gameplay-presentation";
	import PerformancePanel from "../app/PerformancePanel.svelte";
	import type { PerformanceSession } from "../app/performance-session";
	import ToggleField from "../app/ToggleField.svelte";

	interface Props {
		/** Mode-owned profiler; panel mounting never owns collection. */
		readonly readPerformanceSession: () => PerformanceSession | null;
		readonly readDiagnostics: () => ClientGameplayPresentationDiagnostics | null;
		/** Selection is resolved in the client layer, independently of scene residency. */
		readonly readSelectedEntity: () => ClientSelectedEntity | null;
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
		readPerformanceSession,
		readDiagnostics,
		readSelectedEntity,
		entityCollisionDisabled,
		onEntityCollisionDisabledChange,
		unrestrictedUse,
		onUnrestrictedUseChange,
		showRetailHiddenGeometry,
		onShowRetailHiddenGeometryChange,
	}: Props = $props();
	let diagnostics = $state<ClientGameplayPresentationDiagnostics | null>(null);
	let selected = $state<ClientSelectedEntity | null>(null);

	/** Cold disclosure state controls which diagnostic snapshots are requested. */
	let performanceOpen = $state(true);
	let selectedOpen = $state(false);
	let worldOpen = $state(false);
	let renderingOpen = $state(false);

	$effect(() => {
		const inspectSelection = selectedOpen;
		const inspectWorld = worldOpen || renderingOpen;
		if (!inspectSelection && !inspectWorld) return;
		const sample = (): void => {
			if (inspectSelection) selected = readSelectedEntity();
			if (inspectWorld) diagnostics = readDiagnostics();
		};
		// Reads stay on the cold timer boundary; only disclosure visibility owns this effect.
		const initial = window.setTimeout(sample, 0);
		const interval = window.setInterval(sample, 250);
		return () => {
			window.clearTimeout(initial);
			window.clearInterval(interval);
		};
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
	<details
		class="ui-disclosure ui-disclosure-section"
		data-debug-section="performance"
		bind:open={performanceOpen}
	>
		<summary>Performance</summary>
		<div class="ui-disclosure-body">
			{#if performanceOpen}<PerformancePanel
					readSession={readPerformanceSession}
					showHeading={false}
				/>{/if}
		</div>
	</details>
	<details class="ui-disclosure ui-disclosure-section" bind:open={selectedOpen}>
		<summary>Selected entity</summary>
		<div class="debug-section-body ui-disclosure-body">
			{#if selected === null}
				<p class="ui-muted">Select an entity to inspect it.</p>
			{:else}
				<dl class="ui-well">
					{@render diagnosticRow("GUID", formatGuid(selected.guid))}
					{#if selected.facts !== null}
						{@const facts = selected.facts}
						{#if facts.description.kind === "known"}
							{@render diagnosticRow("Name", facts.description.name)}
							{@render diagnosticRow(
								"WCID",
								facts.description.wcid === null
									? "unavailable"
									: `${facts.description.wcid} (${formatGuid(facts.description.wcid)})`,
							)}
							{@render diagnosticRow(
								"Item type",
								formatItemType(facts.description.itemType),
							)}
							{@render diagnosticRow(
								"Object flags",
								formatObjectFlags(facts.description.objectFlags),
							)}
						{:else}
							{@render diagnosticRow("Description", "Loading…")}
						{/if}
						{@render diagnosticRow(
							"Owned by player",
							facts.ownedByPlayer ? "Yes" : "No",
						)}
						{@render diagnosticRow("Location", facts.location.kind)}
						{#if facts.location.kind === "contained"}
							{@render diagnosticRow(
								"Container",
								formatGuid(facts.location.parentGuid),
							)}
						{:else if facts.location.kind === "equipped"}
							{@render diagnosticRow(
								"Wearer",
								formatGuid(facts.location.wearerGuid),
							)}
						{/if}
					{/if}
					{#if selected.presentation !== null}
						{@const entity = selected.presentation}
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
				{#if selected.facts === null}<p class="ui-muted">
						Shared entity facts are unavailable.
					</p>{/if}
				{#if selected.presentation === null}<p class="ui-muted">
						No scene presentation for this entity.
					</p>{/if}
				{#if selected.facts !== null || selected.presentation !== null}
					<details class="ui-disclosure">
						<summary>Raw entity data (JSON)</summary>
						<textarea
							class="ui-mono"
							aria-label="Selected entity JSON"
							readonly
							rows="12"
							value={JSON.stringify(selected, null, 2)}
						></textarea>
					</details>
				{/if}
			{/if}
		</div>
	</details>
	<details class="ui-disclosure ui-disclosure-section">
		<summary>Overrides</summary>
		<div class="debug-section-body ui-disclosure-body">
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
		</div>
	</details>
	<details class="ui-disclosure ui-disclosure-section" bind:open={worldOpen}>
		<summary>Player &amp; camera</summary>
		<div class="ui-disclosure-body">
			{#if diagnostics === null}
				<p class="ui-muted">Presentation unavailable.</p>
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
				</dl>
			{/if}
		</div>
	</details>
	<details
		class="ui-disclosure ui-disclosure-section"
		bind:open={renderingOpen}
	>
		<summary>Rendering</summary>
		<div class="ui-disclosure-body">
			{#if diagnostics === null}
				<p class="ui-muted">Presentation unavailable.</p>
			{:else}
				<dl class="ui-well">
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
	</details>
</div>

<style>
	@layer components {
		.debug-section-body {
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
			text-align: right;
		}
		p {
			margin: 0;
		}
	}
</style>
