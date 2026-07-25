<script lang="ts">
	import type { BuildingRuntimeDiagnostics } from "../lib/game/runtime/game-runtime";
	import type { Texture2DReadback } from "../lib/game/renderer/webgl2-device";
	import type { TextureAtlasPageDiagnostics } from "../lib/game/textures/texture-manager";
	import type { TexturePageId } from "../lib/game/textures/texture-manager";
	import ExplorerTexturePageModal from "./ExplorerTexturePageModal.svelte";

	type PageSort = "efficiency" | "entries" | "memory" | "page-id";

	interface Props {
		/** Latest resource-free texture atlas facts sampled by the active runtime. */
		readonly diagnostics: BuildingRuntimeDiagnostics | null;
		/** Explicit one-off GPU page readback requested only when opening an inspector. */
		readonly readTextureAtlasPage: (pageId: TexturePageId) => Texture2DReadback;
	}

	interface TexturePageInspection {
		readonly page: TextureAtlasPageDiagnostics;
		readonly preview: Texture2DReadback;
	}

	let { diagnostics, readTextureAtlasPage }: Props = $props();
	let query = $state("");
	let sort = $state<PageSort>("efficiency");
	let inspection = $state<TexturePageInspection | null>(null);
	let inspectionError = $state<string | null>(null);

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
	function comparePages(
		left: TextureAtlasPageDiagnostics,
		right: TextureAtlasPageDiagnostics,
		pageSort: PageSort,
	): number {
		if (pageSort === "entries") {
			return (
				right.canonicalEntryCount - left.canonicalEntryCount ||
				right.candidateEntryCount - left.candidateEntryCount ||
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
			right.canonicalOccupiedPixelRatio - left.canonicalOccupiedPixelRatio ||
			right.candidateOccupiedPixelRatio - left.candidateOccupiedPixelRatio ||
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

	function describeSort(pageSort: PageSort): string {
		switch (pageSort) {
			case "entries":
				return "canonical entries";
			case "memory":
				return "byte cost";
			case "page-id":
				return "page ID";
			case "efficiency":
				return "canonical efficiency";
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
				.canonicalAtlasBindings}
			canonical bindings. Page pixels are not retained after upload.
		</p>

		<div class="ac-param-panel explorer-texture-totals">
			<div class="ac-param-row">
				<span class="ac-param-key">Published candidates</span>
				<code>{diagnostics.texture.publishedAtlasCandidates}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Canonical replacements</span>
				<code>{diagnostics.texture.canonicalAtlasReplacements}</code>
			</div>
			<div class="ac-param-row">
				<span class="ac-param-key">Released pages</span>
				<code>{diagnostics.texture.releasedAtlasPages}</code>
			</div>
		</div>

		<div class="explorer-texture-controls">
			<label class="explorer-form-field">
				<span>Filter page ID</span>
				<input
					class="explorer-control"
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
							<span
								>{page.canonicalEntryCount}/{page.candidateEntryCount} canonical</span
							>
							<span
								>{formatPercent(page.canonicalOccupiedPixelRatio)} occupied</span
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
			{#if inspectionError}
				<p class="explorer-texture-readback-error" role="alert">
					{inspectionError}
				</p>
			{/if}
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
