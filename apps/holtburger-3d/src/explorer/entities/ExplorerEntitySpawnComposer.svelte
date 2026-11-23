<script lang="ts">
	import ResetIcon from "../../assets/icons/hud-reset.svg?component";
	import { useExplorerToastPublisher } from "../explorer-toast-context";
	import {
		EXPLORER_SPAWN_DISTANCE,
		EXPLORER_WEENIE_SEARCH_RESULT_LIMIT,
		type ExplorerWeenieSearchRequest,
		type ExplorerWeenieSearchResult,
	} from "./entity-commands";
	import {
		classifyExplorerWeenieInput,
		settleExplorerWeenieSearch,
	} from "./weenie-picker-state";

	const SEARCH_DELAY_MS = 160;

	interface Props {
		readonly enabled: boolean;
		readonly busy: boolean;
		readonly spawning: boolean;
		readonly recordCount: number | null;
		readonly search: (
			request: ExplorerWeenieSearchRequest,
		) => Promise<readonly ExplorerWeenieSearchResult[]>;
		readonly spawn: (wcid: number, distance: number) => Promise<void>;
	}

	let { enabled, busy, spawning, recordCount, search, spawn }: Props = $props();
	const publishToast = useExplorerToastPublisher();

	let query = $state("");
	let distance = $state(EXPLORER_SPAWN_DISTANCE.default);
	let results = $state<readonly ExplorerWeenieSearchResult[]>([]);
	let searchPending = $state(false);
	let searchFailed = $state(false);
	let queryRevision = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let inputElement: HTMLInputElement | undefined;

	const intent = $derived(classifyExplorerWeenieInput(query));
	const numericWcid = $derived(
		intent.kind === "numeric" && intent.result.kind === "valid"
			? intent.result.value
			: null,
	);
	const numericError = $derived(
		intent.kind === "numeric" && intent.result.kind === "invalid"
			? intent.result.message
			: null,
	);
	const placeholder = $derived(
		recordCount !== null
			? `Search ${recordCount.toLocaleString()} weenies…`
			: "Search weenies…",
	);

	$effect(() => () => {
		if (debounceTimer !== undefined) clearTimeout(debounceTimer);
	});

	function updateQuery(nextQuery: string): void {
		query = nextQuery;
		searchFailed = false;
		results = [];
		queryRevision += 1;
		if (debounceTimer !== undefined) clearTimeout(debounceTimer);
		const nextIntent = classifyExplorerWeenieInput(nextQuery);
		if (nextIntent.kind !== "search" || !enabled) {
			searchPending = false;
			return;
		}
		const revision = queryRevision;
		searchPending = true;
		debounceTimer = setTimeout(
			() => void runSearch(nextIntent.query, revision),
			SEARCH_DELAY_MS,
		);
	}

	async function runSearch(
		searchQuery: string,
		revision: number,
	): Promise<void> {
		try {
			const nextResults = await search({
				query: searchQuery,
				limit: EXPLORER_WEENIE_SEARCH_RESULT_LIMIT,
			});
			const settlement = settleExplorerWeenieSearch(
				queryRevision,
				revision,
				nextResults,
			);
			if (settlement.kind === "stale") return;
			results = settlement.value;
			searchFailed = false;
		} catch (error) {
			const settlement = settleExplorerWeenieSearch(
				queryRevision,
				revision,
				error instanceof Error ? error.message : String(error),
			);
			if (settlement.kind === "stale") return;
			results = [];
			searchFailed = true;
			publishToast({ message: settlement.value, tone: "warning" });
		} finally {
			if (revision === queryRevision) searchPending = false;
		}
	}

	function resetSearch(): void {
		updateQuery("");
		inputElement?.focus();
	}
</script>

<div class="spawn-composer">
	<div class="spawn-controls">
		<div class="search-line">
			<input
				bind:this={inputElement}
				type="search"
				class="ui-input"
				value={query}
				{placeholder}
				aria-label="Search weenies by name, class, or WCID"
				spellcheck="false"
				autocomplete="off"
				disabled={!enabled}
				oninput={(event) => updateQuery(event.currentTarget.value)}
			/>
			<button
				type="button"
				class="ui-button ui-icon-button reset-search-button"
				title="Reset search"
				aria-label="Reset weenie search"
				disabled={query.length === 0}
				onclick={resetSearch}
			>
				<ResetIcon />
			</button>
		</div>

		<details class="spawn-options">
			<summary>Options · {distance} m</summary>
			<div class="spawn-options-body">
				<label class="distance-field">
					<span>Spawn distance (m)</span>
					<input
						class="ui-input"
						bind:value={distance}
						type="number"
						min={EXPLORER_SPAWN_DISTANCE.minimum}
						step={EXPLORER_SPAWN_DISTANCE.step}
						disabled={!enabled || busy}
					/>
				</label>
			</div>
		</details>

		{#if numericError !== null}
			<p class="picker-message invalid">{numericError}</p>
		{:else if searchPending}
			<p class="picker-message" role="status">Searching catalog…</p>
		{:else if intent.kind === "search" && results.length === 0 && !searchFailed}
			<p class="picker-message">No matching weenies.</p>
		{/if}
	</div>

	<div class="spawn-results">
		{#if numericWcid !== null}
			<ul class="weenie-results">
				<li class="ui-catalog-row weenie-result-row">
					<div class="result-info">
						<strong>WCID {numericWcid}</strong>
						<span class="result-meta">Direct WCID</span>
					</div>
					<button
						type="button"
						class="ui-button result-spawn-button"
						disabled={!enabled || busy}
						onclick={() => void spawn(numericWcid, distance)}
					>
						{spawning ? "Spawning…" : "Spawn"}
					</button>
				</li>
			</ul>
		{:else if results.length > 0}
			<ul class="weenie-results">
				{#each results as result (`${result.wcid}-${result.className}`)}
					<li class="ui-catalog-row weenie-result-row">
						<div class="result-info">
							<strong>{result.name}</strong>
							<span class="result-meta"
								>WCID {result.wcid} · {result.className}</span
							>
						</div>
						<button
							type="button"
							class="ui-button result-spawn-button"
							disabled={!enabled || busy}
							onclick={() => void spawn(result.wcid, distance)}
						>
							{spawning ? "Spawning…" : "Spawn"}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	@layer components {
		.spawn-composer {
			display: grid;
			grid-template-rows: auto minmax(0, 1fr);
			gap: var(--ui-filter-gap);
			height: 100%;
			min-height: 0;
			min-width: 0;
		}
		.spawn-controls {
			display: grid;
			gap: var(--ui-filter-gap);
			padding-bottom: var(--ui-filter-gap);
			border-bottom: 1px solid var(--ui-color-border);
			min-width: 0;
		}
		.search-line {
			display: flex;
			gap: var(--ui-filter-gap);
		}
		.search-line input {
			min-width: 0;
			flex: 1;
		}
		.reset-search-button {
			width: 30px;
			height: 30px;
			padding: 5px;
		}
		.spawn-options summary {
			cursor: pointer;
			padding-block: 2px;
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
			color: var(--ui-color-muted);
		}
		.spawn-options-body {
			padding-top: 6px;
			padding-left: 14px;
		}
		.distance-field {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
			color: var(--ui-color-muted);
		}
		.distance-field input {
			width: 5.5rem;
		}
		.spawn-results {
			min-height: 0;
			overflow-y: auto;
		}
		.weenie-results {
			display: grid;
			gap: 4px;
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.weenie-result-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 8px;
			align-items: center;
			padding: 6px 8px;
			min-width: 0;
		}
		.result-info {
			display: grid;
			gap: 2px;
			min-width: 0;
		}
		.result-info strong,
		.result-meta {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.result-meta,
		.picker-message {
			color: var(--ui-color-muted);
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
		}
		.picker-message {
			margin: 0;
			overflow-wrap: anywhere;
		}
		.result-spawn-button {
			white-space: nowrap;
		}
		.invalid {
			color: var(--ui-color-danger);
		}
	}
</style>
