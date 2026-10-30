<script lang="ts">
	import { onMount } from "svelte";
	import UiDialog from "../app/UiDialog.svelte";
	import AddIcon from "../assets/icons/hud-add.svg?component";
	import SortIcon from "../assets/icons/sort.svg?component";
	import LoadingSpinner from "../assets/icons/loading-spinner.svg?component";
	import ClientPregameExpandableRow from "../client/ClientPregameExpandableRow.svelte";
	import { launcherTransport } from "./launcher-transport";
	import type { ServerDirectory } from "./server-directory-contract";

	interface Props {
		/** Refresh the picker after an immediate durable add; keep the browser open. */
		readonly onAdded: (id: string | null) => Promise<void>;
		readonly onCancel: () => void;
	}
	const { onAdded, onCancel }: Props = $props();
	const transport = launcherTransport();
	let catalog = $state<ServerDirectory | null>(null);
	let query = $state("");
	let selectedTypes = $state<string[]>([]);
	let selectedSoftware = $state<string[]>([]);
	const sortOptions = {
		name: { label: "Name", next: "population" },
		population: { label: "Population", next: "name" },
	} as const;
	let sort = $state<keyof typeof sortOptions>("name");
	let operation = $state<"idle" | "loading" | "importing">("idle");
	let failure = $state<string | null>(null);
	let disposed = false;
	const types = $derived(
		[...new Set(catalog?.servers.map((server) => server.kind))].sort(),
	);
	const software = $derived(
		[...new Set(catalog?.servers.map((server) => server.software))].sort(),
	);
	const filterCount = $derived(selectedTypes.length + selectedSoftware.length);
	const visible = $derived(
		catalog?.servers
			.filter(
				(server) =>
					[
						server.name,
						server.description,
						server.kind,
						server.software,
						server.endpoint.host,
					].some((value) =>
						value.toLowerCase().includes(query.trim().toLowerCase()),
					) &&
					(selectedTypes.length === 0 || selectedTypes.includes(server.kind)) &&
					(selectedSoftware.length === 0 ||
						selectedSoftware.includes(server.software)),
			)
			.sort((left, right) => {
				if (sort === "population") {
					// Reports are nonnegative; absent reports sort below a reported zero.
					const population =
						(right.players?.count ?? -1) - (left.players?.count ?? -1);
					if (population !== 0) return population;
				}
				return left.name.localeCompare(right.name);
			}) ?? [],
	);
	function diagnostic(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
	async function load(refresh: boolean): Promise<void> {
		operation = "loading";
		failure = null;
		try {
			const next = await transport.directory(refresh);
			if (disposed) return;
			catalog = next;
		} catch (error) {
			if (!disposed)
				failure = `Could not load TreeStats servers: ${diagnostic(error)}`;
		} finally {
			if (!disposed) operation = "idle";
		}
	}
	async function addServer(key: string): Promise<void> {
		operation = "importing";
		failure = null;
		try {
			const id = await transport.importServer(key);
			await onAdded(id);
			catalog = await transport.directory(false);
		} catch (error) {
			if (!disposed) failure = `Could not add server: ${diagnostic(error)}`;
		} finally {
			if (!disposed) operation = "idle";
		}
	}
	onMount(() => {
		void load(false);
		return () => {
			disposed = true;
		};
	});
</script>

<UiDialog
	className="server-directory-dialog"
	--ui-dialog-width="min(34rem, calc(100vw - 2rem))"
	title="Import from TreeStats"
	initialFocus="input[type=search]"
	onCancel={() => {
		if (operation !== "importing") onCancel();
	}}
	dismissOnBackdrop={operation !== "importing"}
>
	<label class="directory-search"
		>Search servers<input
			class="ui-input"
			type="search"
			bind:value={query}
			disabled={operation === "importing"}
		/></label
	>

	{#if catalog}
		<div class="directory-controls">
			<details class="directory-filter-disclosure">
				<summary
					>Filters{filterCount > 0 ? ` · ${filterCount} selected` : ""}</summary
				>
				<div class="directory-filter-groups">
					{@render filterGroup(
						"Type",
						types,
						selectedTypes,
						(values) => (selectedTypes = values),
					)}
					{@render filterGroup(
						"Software",
						software,
						selectedSoftware,
						(values) => (selectedSoftware = values),
					)}
				</div>
			</details>
			<button
				class="ui-button directory-sort"
				type="button"
				aria-label={`Sort servers: ${sortOptions[sort].label}`}
				title={`Sort: ${sortOptions[sort].label}${sort === "population" ? " (highest reported first)" : ""}. Click for ${sortOptions[sortOptions[sort].next].label}.`}
				disabled={operation !== "idle"}
				onclick={() => (sort = sortOptions[sort].next)}
				><SortIcon />{sortOptions[sort].label}</button
			>
		</div>
	{/if}

	{#if failure}<p role="alert" class="directory-error">{failure}</p>{/if}
	<div
		class="directory-results-region"
		class:directory-results-pending={operation === "loading"}
	>
		{#if catalog}
			{#if catalog.unavailableEntries > 0}
				<p>
					{catalog.unavailableEntries} invalid or duplicate directory entries omitted.
				</p>
			{/if}
			<div
				class="directory-results"
				aria-label="TreeStats servers"
				aria-busy={operation !== "idle"}
				inert={operation === "loading"}
			>
				{#each visible as server (server.key)}
					<ClientPregameExpandableRow className="directory-row">
						{#snippet summary()}
							<strong>{server.name}</strong>
							<span class="directory-labels"
								><span class="directory-tag">{server.kind}</span> ·
								<span class="directory-tag">{server.software}</span></span
							>
						{/snippet}
						{#snippet actions()}
							<div class="ui-icon-actions">
								<button
									class="ui-button ui-icon-button"
									type="button"
									disabled={server.alreadyAdded || operation !== "idle"}
									aria-label={`${server.alreadyAdded ? "Added" : "Add"} ${server.name}`}
									title={`${server.alreadyAdded ? "Added" : "Add"} ${server.name}`}
									onclick={() => void addServer(server.key)}><AddIcon /></button
								>
							</div>
						{/snippet}
						<div class="directory-details">
							<dl class="ui-facts">
								<dt>Host</dt>
								<dd class="ui-mono">{server.endpoint.host}</dd>
								<dt>Port</dt>
								<dd class="ui-mono">{server.endpoint.port}</dd>
								<dt>Reported players</dt>
								<dd>
									{server.players === null
										? "Not reported"
										: server.players.count}
								</dd>
								{#if server.players}<dt>Reported at</dt>
									<dd>{server.players.updatedAt}</dd>{/if}
							</dl>
							{#if server.description}
								<section
									class="directory-description"
									aria-label={`Description of ${server.name}`}
								>
									<h3 class="ui-section-heading">Description</h3>
									<p>{server.description}</p>
								</section>
							{/if}
						</div>
					</ClientPregameExpandableRow>
				{:else}<p>
						{catalog.servers.length === 0
							? "TreeStats returned no servers."
							: "No servers match your search."}
					</p>{/each}
			</div>
		{/if}
		{#if operation === "loading"}
			<div class="directory-loading" role="status">
				<span class="pregame-icon directory-spinner" aria-hidden="true"
					><LoadingSpinner /></span
				>
				<span class="sr-only">Loading TreeStats servers…</span>
			</div>
		{/if}
	</div>
	<div class="ui-dialog-actions">
		<button
			class="pregame-action ui-button"
			disabled={operation !== "idle"}
			onclick={() => void load(true)}>Refresh</button
		>
		<button
			class="pregame-action ui-button"
			disabled={operation === "importing"}
			onclick={onCancel}>Done</button
		>
	</div>
</UiDialog>

{#snippet filterGroup(
	label: string,
	options: readonly string[],
	selected: readonly string[],
	onChange: (values: string[]) => void,
)}
	<div class="directory-filters" role="group" aria-label={`${label} filters`}>
		<span>{label}</span>
		<button
			class="ui-filter-pill"
			aria-pressed={selected.length === 0}
			disabled={operation !== "idle"}
			onclick={() => onChange([])}>All</button
		>
		{#each options as option}
			<button
				class="ui-filter-pill"
				aria-pressed={selected.includes(option)}
				disabled={operation !== "idle"}
				onclick={() =>
					onChange(
						selected.includes(option)
							? selected.filter((value) => value !== option)
							: [...selected, option],
					)}>{option}</button
			>
		{/each}
	</div>
{/snippet}

<style>
	@layer components {
		p {
			margin: 0;
		}
		.directory-search {
			display: grid;
			gap: 6px;
		}
		.directory-controls {
			display: flex;
			align-items: start;
			gap: var(--ui-overlay-gap);
		}
		.directory-sort {
			display: flex;
			flex-shrink: 0;
			font-size: var(--ui-font-size-caption);
			align-items: center;
			gap: 6px;
			white-space: nowrap;
		}
		.directory-filter-disclosure {
			flex: 1;
			min-width: 0;
			max-height: var(--ui-filter-max-height);
			overflow: auto;
		}
		.directory-filter-disclosure summary {
			cursor: pointer;
			padding-block: var(--ui-filter-gap);
		}
		.directory-filter-groups {
			display: grid;
			gap: var(--ui-filter-gap);
		}
		.directory-results-region {
			position: relative;
		}
		.directory-results-pending {
			min-height: min(18rem, 35vh);
		}
		.directory-results-pending > :not(.directory-loading) {
			visibility: hidden;
		}
		.directory-loading {
			position: absolute;
			inset: 0;
			display: grid;
			place-items: center;
		}
		.directory-spinner {
			width: 32px;
			height: 32px;
			animation: directory-wait 1s linear infinite;
		}
		@keyframes directory-wait {
			to {
				transform: rotate(360deg);
			}
		}
		@media (prefers-reduced-motion: reduce) {
			.directory-spinner {
				animation: none;
			}
		}
		.directory-results {
			display: grid;
			gap: var(--ui-overlay-gap);
			max-height: 35vh;
			overflow: auto;
			padding-inline-end: var(--ui-overlay-gap);
			scrollbar-gutter: stable;
		}
		.directory-filters {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--ui-filter-gap);
		}
		.directory-labels {
			display: inline;
			margin-inline-start: 8px;
			font-size: var(--ui-font-size-caption);
			color: var(--ui-color-muted);
		}
		.directory-details {
			display: grid;
			gap: 16px;
		}
		dl {
			margin: 0;
		}
		.directory-error {
			color: var(--ui-color-danger);
			white-space: pre-wrap;
		}
	}
	/* Compact sorting intentionally overrides the shared pregame text-action dimensions. */
	@layer overrides {
		.directory-sort {
			min-height: 0;
			padding: 4px 8px;
		}
	}
</style>
