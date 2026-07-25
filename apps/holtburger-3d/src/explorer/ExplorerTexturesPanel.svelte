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
	let purpose = $state("all");
	let sort = $state<PageSort>("efficiency");
	let selectedPageId = $state<string | null>(null);
	let inspection = $state<TexturePageInspection | null>(null);
	let inspectionError = $state<string | null>(null);

	const purposes = $derived(
		[
			...new Set(
				(diagnostics?.textureAtlasPages ?? []).map((page) => page.purpose),
			),
		].sort((left, right) => left.localeCompare(right)),
	);
	const filteredPages = $derived.by(() => {
		const normalizedQuery = query.trim().toLowerCase();
		return (diagnostics?.textureAtlasPages ?? [])
			.filter((page) => {
				if (purpose !== "all" && page.purpose !== purpose) return false;
				if (normalizedQuery.length === 0) return true;
				return (
					page.pageId.toLowerCase().includes(normalizedQuery) ||
					page.purpose.toLowerCase().includes(normalizedQuery) ||
					page.entries.some((entry) =>
						entry.key.toLowerCase().includes(normalizedQuery),
					)
				);
			})
			.sort((left, right) => comparePages(left, right, sort));
	});
	const selectedPage = $derived(
		filteredPages.find((page) => page.pageId === selectedPageId) ??
			filteredPages[0] ??
			null,
	);
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

	function selectPage(pageId: string): void {
		selectedPageId = pageId;
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
				<span>Filter</span>
				<input
					class="explorer-control"
					bind:value={query}
					placeholder="Page, purpose, or texture key"
				/>
			</label>
			<label class="explorer-form-field">
				<span>Purpose</span>
				<select
					class="explorer-control explorer-control--select"
					bind:value={purpose}
				>
					<option value="all">All purposes</option>
					{#each purposes as texturePurpose}
						<option value={texturePurpose}>{texturePurpose}</option>
					{/each}
				</select>
			</label>
			<label class="explorer-form-field">
				<span>Sort</span>
				<select
					class="explorer-control explorer-control--select"
					bind:value={sort}
				>
					<option value="efficiency">Canonical efficiency</option>
					<option value="entries">Canonical entries</option>
					<option value="memory">Byte cost</option>
					<option value="page-id">Page id</option>
				</select>
			</label>
		</div>

		{#if filteredPages.length === 0}
			<p>No active packed texture pages match this filter.</p>
		{:else}
			<div
				class="explorer-selectable-list explorer-texture-pages"
				aria-label="Packed texture pages"
			>
				{#each filteredPages as page}
					<button
						type="button"
						class:active={page.pageId === selectedPage?.pageId}
						class="explorer-selectable-row explorer-texture-page-row"
						onclick={() => selectPage(page.pageId)}
					>
						<span class="explorer-texture-page-name">{page.pageId}</span>
						<span>{page.purpose}</span>
						<span>{page.width} × {page.height}</span>
						<span
							>{page.canonicalEntryCount}/{page.candidateEntryCount} canonical</span
						>
						<span
							>{formatPercent(page.canonicalOccupiedPixelRatio)} occupied</span
						>
						<span>{formatBytes(page.byteLength)}</span>
					</button>
				{/each}
			</div>

			{#if selectedPage}
				<section
					class="explorer-texture-inspector"
					aria-label="Selected texture page"
				>
					<div class="explorer-texture-inspector-heading">
						<p class="ac-section-label">Page inspector</p>
						<button
							type="button"
							class="explorer-action"
							onclick={() => openInspector(selectedPage)}
						>
							View pixels
						</button>
					</div>
					<div class="ac-param-panel">
						<div class="ac-param-row">
							<span class="ac-param-key">Page / purpose</span>
							<code>{selectedPage.pageId} / {selectedPage.purpose}</code>
						</div>
						<div class="ac-param-row">
							<span class="ac-param-key">Dimensions / bytes</span>
							<code
								>{selectedPage.width} × {selectedPage.height} / {formatBytes(
									selectedPage.byteLength,
								)}</code
							>
						</div>
						<div class="ac-param-row">
							<span class="ac-param-key">Candidate occupancy</span>
							<code
								>{formatPercent(selectedPage.candidateOccupiedPixelRatio)}</code
							>
						</div>
						<div class="ac-param-row">
							<span class="ac-param-key">Canonical occupancy</span>
							<code
								>{formatPercent(selectedPage.canonicalOccupiedPixelRatio)}</code
							>
						</div>
					</div>
					{#if inspectionError}
						<p class="explorer-texture-readback-error" role="alert">
							{inspectionError}
						</p>
					{/if}
				</section>
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
		gap: 8px;
		margin: 14px 0;
	}

	.explorer-texture-pages {
		display: grid;
		gap: 4px;
		max-height: 235px;
		overflow: auto;
	}

	.explorer-texture-page-row {
		gap: 3px;
		font-size: 0.75rem;
	}

	.explorer-texture-page-name {
		color: var(--ac-gold-bright);
		font-family: var(--ac-monospace, monospace);
	}

	.explorer-texture-inspector {
		border-top: 1px solid rgb(162 117 33 / 45%);
		margin-top: 16px;
		padding-top: 16px;
	}

	.explorer-texture-inspector-heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 8px;
	}

	.explorer-texture-inspector-heading .ac-section-label {
		margin: 0 0 14px;
	}

	.explorer-texture-readback-error {
		color: #ffbf9b;
	}
</style>
