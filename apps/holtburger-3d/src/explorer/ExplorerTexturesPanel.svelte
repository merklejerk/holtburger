<script lang="ts">
	import type { BuildingRuntimeDiagnostics } from "../lib/game/runtime/game-runtime";
	import type { TextureAtlasPageDiagnostics } from "../lib/game/textures/texture-manager";

	type PageSort = "efficiency" | "entries" | "memory" | "page-id";

	interface Props {
		/** Latest resource-free texture atlas facts sampled by the active runtime. */
		readonly diagnostics: BuildingRuntimeDiagnostics | null;
	}

	let { diagnostics }: Props = $props();
	let query = $state("");
	let purpose = $state("all");
	let sort = $state<PageSort>("efficiency");
	let selectedPageId = $state<string | null>(null);
	let selectedEntryKey = $state<string | null>(null);

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
	const selectedEntry = $derived(
		selectedPage?.entries.find((entry) => entry.key === selectedEntryKey) ??
			selectedPage?.entries[0] ??
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
		selectedEntryKey = null;
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
			<label>
				<span>Filter</span>
				<input bind:value={query} placeholder="Page, purpose, or texture key" />
			</label>
			<label>
				<span>Purpose</span>
				<select bind:value={purpose}>
					<option value="all">All purposes</option>
					{#each purposes as texturePurpose}
						<option value={texturePurpose}>{texturePurpose}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>Sort</span>
				<select bind:value={sort}>
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
			<div class="explorer-texture-pages" aria-label="Packed texture pages">
				{#each filteredPages as page}
					<button
						type="button"
						class:active={page.pageId === selectedPage?.pageId}
						class="explorer-texture-page-row"
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
					<p class="ac-section-label">Page inspector</p>
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

					<div
						class="explorer-texture-placement-map"
						style={`aspect-ratio: ${selectedPage.width} / ${selectedPage.height}`}
						aria-label={`Placement map for ${selectedPage.pageId}`}
					>
						{#each selectedPage.entries as entry}
							<button
								type="button"
								class:canonical={entry.canonical}
								class:selected={entry.key === selectedEntry?.key}
								class="explorer-texture-placement"
								style={`left: ${(entry.x / selectedPage.width) * 100}%; top: ${(entry.y / selectedPage.height) * 100}%; width: ${(entry.width / selectedPage.width) * 100}%; height: ${(entry.height / selectedPage.height) * 100}%`}
								aria-label={`${entry.key}, ${entry.canonical ? "canonical" : "candidate only"}`}
								title={`${entry.key}\n${entry.canonical ? "Canonical binding" : "Candidate only"}`}
								onclick={() => (selectedEntryKey = entry.key)}
							></button>
						{/each}
					</div>

					{#if selectedEntry}
						<div class="explorer-texture-entry-details">
							<strong>{selectedEntry.key}</strong>
							<span
								>{selectedEntry.canonical
									? "Canonical binding"
									: "Candidate only"}</span
							>
							<span
								>{selectedEntry.x}, {selectedEntry.y} · {selectedEntry.width} × {selectedEntry.height}px</span
							>
						</div>
					{/if}
					<p class="explorer-texture-legend">
						Gold regions are canonical bindings; muted regions were supplied by
						this page but lost arbitration to another active page.
					</p>
				</section>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.explorer-textures-summary,
	.explorer-texture-legend {
		margin-top: 0;
	}

	.explorer-texture-controls {
		display: grid;
		gap: 8px;
		margin: 14px 0;
	}

	.explorer-texture-controls label {
		display: grid;
		gap: 3px;
		color: var(--ac-gold-bright);
		font-size: 0.8rem;
	}

	.explorer-texture-controls input,
	.explorer-texture-controls select {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid color-mix(in srgb, var(--ac-gold) 55%, transparent);
		background: rgb(15 12 7 / 84%);
		color: var(--ac-parchment);
		font: inherit;
		padding: 5px 7px;
	}

	.explorer-texture-pages {
		display: grid;
		gap: 4px;
		max-height: 235px;
		overflow: auto;
	}

	.explorer-texture-page-row {
		display: grid;
		gap: 3px;
		border: 1px solid rgb(162 117 33 / 45%);
		background: rgb(37 28 12 / 74%);
		color: var(--ac-parchment);
		cursor: pointer;
		font: inherit;
		font-size: 0.75rem;
		padding: 7px;
		text-align: left;
	}

	.explorer-texture-page-row:hover,
	.explorer-texture-page-row.active {
		border-color: var(--ac-gold-bright);
		background: rgb(83 57 16 / 82%);
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

	.explorer-texture-placement-map {
		position: relative;
		width: 100%;
		margin: 14px 0 8px;
		outline: 1px solid rgb(162 117 33 / 70%);
		background-color: rgb(20 16 8 / 90%);
		background-image:
			linear-gradient(45deg, rgb(255 255 255 / 4%) 25%, transparent 25%),
			linear-gradient(-45deg, rgb(255 255 255 / 4%) 25%, transparent 25%);
		background-size: 12px 12px;
		overflow: hidden;
	}

	.explorer-texture-placement {
		position: absolute;
		box-sizing: border-box;
		border: 1px solid rgb(144 148 150 / 75%);
		background: rgb(106 111 112 / 42%);
		cursor: pointer;
	}

	.explorer-texture-placement.canonical {
		border-color: var(--ac-gold-bright);
		background: rgb(234 183 53 / 52%);
	}

	.explorer-texture-placement.selected {
		z-index: 1;
		box-shadow:
			inset 0 0 0 1px #fff,
			0 0 8px #fff;
	}

	.explorer-texture-entry-details {
		display: grid;
		gap: 3px;
		padding: 7px;
		border: 1px solid rgb(162 117 33 / 45%);
		font-size: 0.78rem;
	}

	.explorer-texture-entry-details strong {
		color: var(--ac-gold-bright);
		font-family: var(--ac-monospace, monospace);
		overflow-wrap: anywhere;
	}
</style>
