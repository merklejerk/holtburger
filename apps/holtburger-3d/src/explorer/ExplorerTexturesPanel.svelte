<script lang="ts">
	import { onMount } from "svelte";
	import type { StaticObjectRuntimeDiagnostics } from "../lib/game/runtime/game-presentation-runtime";
	import type { Texture2DReadback } from "../lib/game/renderer/webgl2-device";
	import type { TextureAtlasPageDiagnostics } from "../lib/game/textures/texture-manager";
	import type { TexturePageId } from "../lib/game/textures/texture-manager";
	import type { ClosedWorkerPoolDiagnostics } from "../lib/game/workers/closed-worker";
	import ExplorerTexturePageModal from "./ExplorerTexturePageModal.svelte";

	type PageSort = "efficiency" | "entries" | "memory" | "page-id";

	interface Props {
		/** Read the latest expensive runtime snapshot while this inspector is mounted. */
		readonly readDiagnostics: () => StaticObjectRuntimeDiagnostics | null;
		/** Explicit one-off GPU page readback requested only when opening an inspector. */
		readonly readTextureAtlasPage: (pageId: TexturePageId) => Texture2DReadback;
	}

	interface TexturePageInspection {
		readonly page: TextureAtlasPageDiagnostics;
		readonly preview: Texture2DReadback;
	}

	let { readDiagnostics, readTextureAtlasPage }: Props = $props();
	let diagnostics = $state<StaticObjectRuntimeDiagnostics | null>(null);
	let query = $state("");
	let sort = $state<PageSort>("efficiency");
	let inspection = $state<TexturePageInspection | null>(null);
	let inspectionError = $state<string | null>(null);

	onMount(() => {
		const sample = (): void => {
			diagnostics = readDiagnostics();
		};
		sample();
		const interval = window.setInterval(sample, 250);
		return () => window.clearInterval(interval);
	});

	const filteredPages = $derived.by(() => {
		const queryWords = query
			.toLowerCase()
			.trim()
			.split(/\s+/)
			.filter((word) => word.length > 0);
		return (diagnostics?.textureAtlasPages ?? [])
			.filter((page) => {
				return (
					queryWords.length === 0 ||
					queryWords.some((word) => page.pageId.toLowerCase().includes(word))
				);
			})
			.sort((left, right) => comparePages(left, right, sort));
	});
	const sortDescription = $derived(describeSort(sort));

	// Page IDs include an immutable generation. Close a stale readback rather than presenting an
	// old snapshot as though it were still an inspectable live resident page.
	$effect(() => {
		const currentInspection = inspection;
		if (currentInspection === null) return;
		const stillActive = (diagnostics?.textureAtlasPages ?? []).some(
			(page) => page.pageId === currentInspection.page.pageId,
		);
		if (stillActive) return;
		inspectionError = `Texture page ${currentInspection.page.pageId} was replaced or released.`;
		inspection = null;
	});

	function comparePages(
		left: TextureAtlasPageDiagnostics,
		right: TextureAtlasPageDiagnostics,
		pageSort: PageSort,
	): number {
		if (pageSort === "entries") {
			return (
				right.entryCount - left.entryCount ||
				left.pageId.localeCompare(right.pageId)
			);
		}
		if (pageSort === "memory") {
			return (
				right.byteLength - left.byteLength ||
				left.pageId.localeCompare(right.pageId)
			);
		}
		if (pageSort === "page-id") return left.pageId.localeCompare(right.pageId);
		return (
			right.occupiedPixelRatio - left.occupiedPixelRatio ||
			left.pageId.localeCompare(right.pageId)
		);
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1_024) return `${bytes} B`;
		if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
		return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`;
	}

	function formatPercent(ratio: number): string {
		return `${(ratio * 100).toFixed(1)}%`;
	}

	function formatDuration(milliseconds: number): string {
		return `${milliseconds.toFixed(1)} ms`;
	}

	function formatWorker(worker: ClosedWorkerPoolDiagnostics | null): string {
		if (worker === null) return "Unavailable";
		return `${worker.completedJobCount} jobs · ${formatDuration(worker.totalExecutionDurationMs)} work · ${formatDuration(worker.totalQueueDelayMs)} queued`;
	}

	function describeSort(pageSort: PageSort): string {
		switch (pageSort) {
			case "entries":
				return "resident entries";
			case "memory":
				return "byte cost";
			case "page-id":
				return "page ID";
			case "efficiency":
				return "resident occupancy";
		}
	}

	function cycleSort(): void {
		const order: readonly PageSort[] = [
			"efficiency",
			"entries",
			"memory",
			"page-id",
		];
		const currentIndex = order.indexOf(sort);
		sort = order[(currentIndex + 1) % order.length]!;
	}

	function openInspector(page: TextureAtlasPageDiagnostics): void {
		inspectionError = null;
		try {
			inspection = { page, preview: readTextureAtlasPage(page.pageId) };
		} catch (error) {
			inspectionError =
				error instanceof Error
					? error.message
					: "Texture page readback failed.";
		}
	}
</script>

<div class="explorer-textures-panel">
	{#if diagnostics === null}
		<p>Waiting for the runtime to publish a texture-atlas snapshot.</p>
	{:else}
		<p class="explorer-textures-summary">
			{diagnostics.texture.activeAtlasPages} active pages, {diagnostics.texture
				.residentAtlasBindings}
			resident bindings. Page pixels are not retained after upload.
		</p>

		<div class="ac-param-panel explorer-texture-totals">
			<div class="ac-param-row">
				<span class="ac-param-key">Page memory</span>
				<code
					>{formatBytes(diagnostics.texture.activeAtlasPageBytes)} active · {formatBytes(
						diagnostics.texture.peakAtlasPageBytes,
					)} peak</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Avoided preparations</span>
				<code>{diagnostics.texture.avoidedAtlasPreparations}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Hole reuses</span>
				<code>{diagnostics.texture.reusedAtlasInsertions}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Compactions</span>
				<code
					>{diagnostics.texture.acceptedAtlasCompactions}/{diagnostics.texture
						.attemptedAtlasCompactions}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Compaction fallbacks</span>
				<code>{diagnostics.texture.failedAtlasCompactions}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">In-place patches</span>
				<code
					>{diagnostics.texture.patchedAtlasPages} pages · {formatBytes(
						diagnostics.texture.patchedAtlasRegionBytes,
					)}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Metadata-only updates</span>
				<code>{diagnostics.texture.metadataOnlyAtlasPageUpdates}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Patch fallbacks</span>
				<code>{diagnostics.texture.atlasPatchFallbacks}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Page traffic</span>
				<code
					>{diagnostics.texture.uploadedAtlasPages} uploaded · {diagnostics
						.texture.releasedAtlasPages} released</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Page traffic bytes</span>
				<code
					>{formatBytes(diagnostics.texture.uploadedAtlasPageBytes)} uploaded · {formatBytes(
						diagnostics.texture.releasedAtlasPageBytes,
					)} released</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Worker source copies</span>
				<code>{formatBytes(diagnostics.texture.copiedAtlasSourceBytes)}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Publication work</span>
				<code
					>{formatDuration(diagnostics.texture.atlasPublicationDurationMs)} total
					· {formatDuration(
						diagnostics.texture.longestAtlasPublicationDurationMs,
					)} longest</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Discarded / failed plans</span>
				<code
					>{diagnostics.texture.staleAtlasTransactions} stale · {diagnostics
						.texture.failedAtlasTransactions} failed</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Layout worker</span>
				<code>{formatWorker(diagnostics.texture.atlasLayoutWorker)}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Page-build workers</span>
				<code>{formatWorker(diagnostics.texture.atlasPageBuildWorker)}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Requirement collection</span>
				<code
					>{diagnostics.textureFactCollectionCount} runs · {formatDuration(
						diagnostics.textureFactCollectionDurationMs,
					)}</code
				>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Resident sources</span>
				<code>{diagnostics.texture.residentSourceCount}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Source memory</span>
				<code>{formatBytes(diagnostics.texture.residentSourceBytes)}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Pending requirements</span>
				<code>{diagnostics.texture.pendingAtlasRequirements}</code>
			</div>
		</div>

		<div class="explorer-texture-controls">
			<label class="ac-form-field">
				<span>Filter page ID</span>
				<input
					class="ac-control"
					bind:value={query}
					placeholder="Any word in the page ID"
				/>
			</label>
			<button
				type="button"
				class="emoji-button explorer-texture-sort"
				aria-label={`Sort pages by ${sortDescription}; cycle sort mode`}
				title={`Sort: ${sortDescription}. Click to cycle.`}
				onclick={cycleSort}
			>
				⇅
			</button>
		</div>

		{#if filteredPages.length === 0}
			<p>No active packed texture pages match this filter.</p>
		{:else}
			<div
				class="explorer-selectable-list explorer-texture-pages"
				aria-label="Packed texture pages"
			>
				{#each filteredPages as page}
					<article class="explorer-data-row explorer-texture-page-row">
						<div class="explorer-texture-page-content">
							<strong class="explorer-texture-page-name">{page.pageId}</strong>
							<span>{page.purpose}</span>
							<span>{page.width} × {page.height}</span>
							<span>{page.entryCount} resident</span>
							<span>{formatPercent(page.occupiedPixelRatio)} occupied</span>
							<span>{formatPercent(page.allocatedPixelRatio)} allocated</span>
							<span
								>{formatPercent(page.largestFreePixelRatio)} largest hole</span
							>
							<span>{formatBytes(page.byteLength)}</span>
						</div>
						<button
							type="button"
							class="emoji-button explorer-texture-inspect"
							aria-label={`Inspect ${page.pageId}`}
							title="Inspect page pixels"
							onclick={() => openInspector(page)}
						>
							🔍
						</button>
					</article>
				{/each}
			</div>
		{/if}
		{#if inspectionError}
			<p class="explorer-texture-readback-error" role="alert">
				{inspectionError}
			</p>
		{/if}
	{/if}
</div>

{#if inspection}
	<ExplorerTexturePageModal
		page={inspection.page}
		preview={inspection.preview}
		onClose={() => (inspection = null)}
	/>
{/if}

<style>
	.explorer-textures-summary {
		margin-top: 0;
	}

	.explorer-texture-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		align-items: end;
		margin: 14px 0;
	}

	.explorer-texture-pages {
		display: grid;
		gap: 4px;
		max-height: 235px;
		overflow: auto;
	}

	.explorer-texture-page-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		font-size: 0.75rem;
	}

	.explorer-texture-page-content {
		display: grid;
		gap: 3px;
		min-width: 0;
	}

	.explorer-texture-page-name {
		color: var(--ac-gold-bright);
		font-family: var(--ac-monospace, monospace);
		overflow-wrap: anywhere;
	}

	.explorer-texture-sort,
	.explorer-texture-inspect {
		font-family: var(--ac-font-ui);
	}

	.explorer-texture-readback-error {
		color: #ffbf9b;
	}
</style>
