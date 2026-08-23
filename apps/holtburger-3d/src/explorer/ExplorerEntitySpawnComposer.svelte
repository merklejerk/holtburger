<script lang="ts">
	import {
		EXPLORER_SPAWN_DISTANCE,
		EXPLORER_WEENIE_SEARCH_RESULT_LIMIT,
		type ExplorerWeenieSearchRequest,
		type ExplorerWeenieSearchResult,
	} from "./explorer-entity-commands";
	import {
		classifyExplorerWeenieInput,
		editExplorerWeeniePicker,
		resolveExplorerWeenieSpawnTarget,
		selectExplorerWeenie,
		settleExplorerWeenieSearch,
		type ExplorerWeeniePickerState,
	} from "./explorer-weenie-picker-state";

	const SEARCH_DELAY_MS = 160;
	const LISTBOX_ID = "explorer-weenie-results";

	interface Props {
		readonly enabled: boolean;
		readonly busy: boolean;
		readonly spawning: boolean;
		readonly operationError: string | null;
		readonly search: (
			request: ExplorerWeenieSearchRequest,
		) => Promise<readonly ExplorerWeenieSearchResult[]>;
		readonly spawn: (wcid: number, distance: number) => Promise<void>;
	}

	let { enabled, busy, spawning, operationError, search, spawn }: Props =
		$props();
	let picker = $state<ExplorerWeeniePickerState>(editExplorerWeeniePicker(""));
	let distance = $state(EXPLORER_SPAWN_DISTANCE.default);
	let results = $state<readonly ExplorerWeenieSearchResult[]>([]);
	let highlightedIndex = $state<number | null>(null);
	let resultsVisible = $state(false);
	let searchPending = $state(false);
	let searchError = $state<string | null>(null);
	let targetError = $state<string | null>(null);
	let queryRevision = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let inputElement: HTMLInputElement | undefined;

	const intent = $derived(classifyExplorerWeenieInput(picker.input));
	const numericError = $derived(
		picker.kind === "editing" && intent.kind === "numeric"
			? intent.result.kind === "invalid"
				? intent.result.message
				: null
			: null,
	);
	const listOpen = $derived(
		picker.kind === "editing" && resultsVisible && results.length > 0,
	);

	$effect(() => () => {
		if (debounceTimer !== undefined) clearTimeout(debounceTimer);
	});

	function editInput(input: string): void {
		picker = editExplorerWeeniePicker(input);
		targetError = null;
		searchError = null;
		results = [];
		highlightedIndex = null;
		resultsVisible = false;
		queryRevision += 1;
		if (debounceTimer !== undefined) clearTimeout(debounceTimer);
		const nextIntent = classifyExplorerWeenieInput(input);
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

	async function runSearch(query: string, revision: number): Promise<void> {
		try {
			const nextResults = await search({
				query,
				limit: EXPLORER_WEENIE_SEARCH_RESULT_LIMIT,
			});
			const settlement = settleExplorerWeenieSearch(
				queryRevision,
				revision,
				nextResults,
			);
			if (settlement.kind === "stale") return;
			results = settlement.value;
			highlightedIndex = settlement.value.length > 0 ? 0 : null;
			resultsVisible = true;
			searchError = null;
		} catch (error) {
			const settlement = settleExplorerWeenieSearch(
				queryRevision,
				revision,
				errorMessage(error),
			);
			if (settlement.kind === "stale") return;
			results = [];
			highlightedIndex = null;
			resultsVisible = false;
			searchError = settlement.value;
		} finally {
			if (revision === queryRevision) searchPending = false;
		}
	}

	function selectResult(result: ExplorerWeenieSearchResult): void {
		queryRevision += 1;
		picker = selectExplorerWeenie(result);
		results = [];
		highlightedIndex = null;
		resultsVisible = false;
		searchPending = false;
		searchError = null;
		targetError = null;
	}

	function clearPicker(): void {
		editInput("");
		inputElement?.focus();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			queryRevision += 1;
			resultsVisible = false;
			searchPending = false;
			if (debounceTimer !== undefined) clearTimeout(debounceTimer);
			return;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			if (results.length === 0) return;
			event.preventDefault();
			resultsVisible = true;
			const direction = event.key === "ArrowDown" ? 1 : -1;
			const current = highlightedIndex ?? (direction > 0 ? -1 : 0);
			const next = (current + direction + results.length) % results.length;
			highlightedIndex = next;
			queueMicrotask(() =>
				document
					.getElementById(resultId(next))
					?.scrollIntoView({ block: "nearest" }),
			);
			return;
		}
		if (event.key === "Enter" && listOpen && highlightedIndex !== null) {
			event.preventDefault();
			selectResult(results[highlightedIndex]);
		}
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (busy || !enabled) return;
		try {
			const wcid = resolveExplorerWeenieSpawnTarget(picker);
			targetError = null;
			await spawn(wcid, distance);
		} catch (error) {
			targetError = errorMessage(error);
		}
	}

	function resultId(index: number): string {
		return `${LISTBOX_ID}-${index}`;
	}

	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
</script>

<form class="spawn-composer" onsubmit={submit}>
	<fieldset class="explorer-section" disabled={!enabled || busy}>
		<legend>Spawn entity</legend>
		<label class="explorer-form-field">
			<span>Weenie</span>
			<div class="weenie-picker">
				<input
					bind:this={inputElement}
					class="explorer-control weenie-input"
					value={picker.input}
					placeholder="Name, class, or WCID"
					spellcheck="false"
					autocomplete="off"
					role="combobox"
					aria-autocomplete="list"
					aria-expanded={listOpen}
					aria-controls={LISTBOX_ID}
					aria-activedescendant={listOpen && highlightedIndex !== null
						? resultId(highlightedIndex)
						: undefined}
					oninput={(event) => editInput(event.currentTarget.value)}
					onkeydown={handleKeydown}
					onfocus={() => (resultsVisible = results.length > 0)}
					onblur={() => (resultsVisible = false)}
				/>
				{#if picker.input.length > 0}
					<button
						type="button"
						class="picker-clear"
						aria-label="Clear weenie"
						title="Clear weenie"
						onclick={clearPicker}>×</button
					>
				{/if}
				{#if listOpen}
					<ul id={LISTBOX_ID} class="weenie-results" role="listbox">
						{#each results as result, index (`${result.wcid}-${result.className}`)}
							<li
								id={resultId(index)}
								role="option"
								aria-selected={index === highlightedIndex}
								class:highlighted={index === highlightedIndex}
								onpointerdown={(event) => {
									event.preventDefault();
									selectResult(result);
								}}
							>
								<span class="result-heading">
									<strong>{result.name}</strong>
									<span>WCID {result.wcid}</span>
								</span>
								<span class="result-class">{result.className}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</label>

		{#if picker.kind === "selected"}
			<p class="picker-receipt">
				WCID {picker.selection.wcid} · {picker.selection.className}
			</p>
		{:else if numericError !== null}
			<p class="picker-message invalid">{numericError}</p>
		{:else if searchPending}
			<p class="picker-message">Searching catalog…</p>
		{:else if intent.kind === "search" && resultsVisible && results.length === 0 && searchError === null}
			<p class="picker-message">No matching weenies.</p>
		{/if}
		{#if searchError !== null}
			<p class="picker-message invalid" role="alert">{searchError}</p>
		{/if}

		<div class="spawn-actions">
			<label class="explorer-form-field distance-field">
				<span>Distance</span>
				<input
					class="explorer-control"
					bind:value={distance}
					type="number"
					min={EXPLORER_SPAWN_DISTANCE.minimum}
					step={EXPLORER_SPAWN_DISTANCE.step}
				/>
			</label>
			<button class="explorer-action" type="submit">
				{spawning ? "Spawning…" : "Spawn in front"}
			</button>
		</div>
		{#if targetError !== null}
			<p class="picker-message invalid" role="alert">{targetError}</p>
		{/if}
		{#if operationError !== null}
			<p class="picker-message invalid" role="alert">{operationError}</p>
		{/if}
	</fieldset>
</form>

<style>
	.spawn-composer,
	.spawn-composer fieldset {
		min-width: 0;
	}

	.weenie-picker {
		position: relative;
		min-width: 0;
	}

	.weenie-input {
		width: 100%;
		padding-right: 30px;
	}

	.picker-clear {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 25px;
		min-height: 24px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--ac-ink-muted);
		font-size: 1.1rem;
		z-index: 2;
	}

	.weenie-results {
		position: absolute;
		top: calc(100% + 3px);
		left: 0;
		right: 0;
		z-index: 5;
		display: grid;
		max-height: min(260px, 42dvh);
		margin: 0;
		padding: 3px;
		overflow-y: auto;
		list-style: none;
		border: 1px solid var(--ac-gold-bright);
		background: var(--ac-panel-deep);
		box-shadow: 0 8px 18px rgb(0 0 0 / 70%);
	}

	.weenie-results li {
		display: grid;
		gap: 2px;
		min-width: 0;
		padding: 6px 7px;
		border: 1px solid transparent;
		cursor: pointer;
	}

	.weenie-results li.highlighted {
		border-color: var(--ac-gold-bright);
		background: rgb(83 57 16 / 92%);
	}

	.result-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		align-items: baseline;
	}

	.result-heading strong,
	.result-class {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.result-heading span,
	.result-class,
	.picker-message,
	.picker-receipt {
		color: var(--ac-ink-muted);
		font-size: 0.73rem;
	}

	.picker-message,
	.picker-receipt {
		margin: 5px 0 0;
		overflow-wrap: anywhere;
	}

	.invalid {
		color: #ff9c8f;
	}

	.spawn-actions {
		display: grid;
		grid-template-columns: minmax(0, 7rem) minmax(0, 1fr);
		gap: 8px;
		align-items: end;
		margin-top: 9px;
	}

	.spawn-actions button {
		width: 100%;
	}
</style>
