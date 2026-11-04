<script lang="ts">
	import { entityDisplayName } from "../lib/game/entity-display-name";
	import ClientEntityCategoryIcon from "./ClientEntityCategoryIcon.svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import { findExactEntityAlert } from "./client-entity-alerts";
	import {
		filterNearbyRows,
		matchesNearbyFilter,
		NEARBY_FILTER_OPTIONS,
		NEARBY_CATEGORY_DETAILS,
		type NearbyQuery,
	} from "./client-nearby-policy";
	import type { ClientNearby } from "./client-nearby";
	import type { MapWaypointTarget } from "../lib/game/map/map-waypoint";
	const {
		view,
		tracked,
		selectedGuid,
		onSelectEntity,
		onExamineEntity,
		onSetWaypoint,
		toggleExactAlert,
		readCurrent,
		onError,
	}: {
		/** Both catalogs consume the same bounded, owner-produced display snapshot. */
		readonly view: ReturnType<ClientNearby["read"]>;
		/** The dedicated tracked catalog admits only enabled alert matches. */
		readonly tracked: boolean;
		readonly selectedGuid: number | null;
		readonly onSelectEntity: (guid: number) => boolean;
		readonly onExamineEntity: (guid: number) => void;
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
		/** Mutate character-owned alert settings through the parent owner. */
		readonly toggleExactAlert: (name: string) => void;
		/** Revalidate a sampled row before dispatching a right-click examination. */
		readonly readCurrent: () => ReturnType<ClientNearby["read"]>;
		/** Reuse the panel-wide feedback surface for stale rows. */
		readonly onError: (message: string | null) => void;
	} = $props();
	let query = $state<Omit<NearbyQuery, "tracked">>({
		text: "",
		categories: [],
		sort: "distance",
	});
	let expanded = $state<number | null>(null);
	const rows = $derived(filterNearbyRows(view.rows, { ...query, tracked }));
	$effect(() => {
		if (
			view.ready &&
			expanded !== null &&
			!view.rows.some((row) => row.guid === expanded)
		)
			expanded = null;
	});
</script>

<div class="entity-catalog">
	<div class="entity-controls">
		<div class="search-line">
			<input
				class="ui-input"
				type="search"
				aria-label="Search entity names"
				placeholder="Search entity names…"
				value={query.text}
				oninput={(event) =>
					(query = { ...query, text: event.currentTarget.value })}
			/>
			<button
				class="ui-button"
				type="button"
				disabled={query.text === "" && query.categories.length === 0}
				onclick={() => (query = { ...query, text: "", categories: [] })}
				>Reset</button
			>
		</div>
		<details class="entity-filters">
			<summary
				>Filters{query.categories.length > 0
					? ` · ${query.categories.length} selected`
					: ""}</summary
			>
			<div class="filter-pills" role="group" aria-label="Entity filters">
				{#each NEARBY_FILTER_OPTIONS as [category, label]}
					<button
						class="ui-filter-pill"
						data-entity-category={category}
						type="button"
						aria-pressed={query.categories.includes(category)}
						onclick={() =>
							(query = {
								...query,
								categories: query.categories.includes(category)
									? query.categories.filter((value) => value !== category)
									: [...query.categories, category],
							})}
						>{label} ({view.rows.filter(
							(row) =>
								(!tracked || row.matchingRules.length > 0) &&
								matchesNearbyFilter(row, category),
						).length})</button
					>
				{/each}
			</div>
		</details>
		<div class="sort-line">
			<label
				>Sort <select class="ui-input" bind:value={query.sort}>
					<option value="distance">Distance</option><option value="name"
						>Name</option
					><option value="category">Category</option>
				</select></label
			>
			<span role="status">{rows.length} of {view.rows.length} entities</span>
		</div>
	</div>
	<div class="entity-results">
		{#if !view.ready}<p role="status">Waiting for nearby entities…</p>
		{:else if rows.length === 0}<p>
				{tracked
					? "No nearby tracked entities match your filters."
					: "No nearby entities match your filters."}
			</p>{/if}
		<ul>
			{#each rows as row (row.guid)}
				{@const displayName = entityDisplayName(row.facts.name, row.guid)}
				{@const exactAlertEnabled =
					findExactEntityAlert(view.rules, row.facts.name)?.enabled === true}
				<li
					class="ui-catalog-row"
					class:expanded={expanded === row.guid}
					data-entity-guid={row.guid}
					class:selected={selectedGuid === row.guid}
					oncontextmenu={(event) => {
						event.preventDefault();
						if (
							readCurrent().rows.some((current) => current.guid === row.guid)
						) {
							onError(null);
							onExamineEntity(row.guid);
						} else onError("This entity is unavailable.");
					}}
				>
					<div class="entity-row">
						<button
							class="ui-catalog-trigger entity-disclosure"
							type="button"
							aria-label={`Details for ${displayName}`}
							aria-expanded={expanded === row.guid}
							onclick={() =>
								(expanded = expanded === row.guid ? null : row.guid)}
							>{expanded === row.guid ? "▾" : "▸"}</button
						>
						<span
							class="category-icon"
							data-entity-category={row.category}
							role="img"
							aria-label={NEARBY_CATEGORY_DETAILS[row.category].label}
							title={NEARBY_CATEGORY_DETAILS[row.category].label}
							><ClientEntityCategoryIcon category={row.category} /></span
						>
						<button
							class="ui-catalog-trigger entity-name"
							type="button"
							aria-pressed={selectedGuid === row.guid}
							onclick={() => onSelectEntity(row.guid)}>{displayName}</button
						>
						<span
							>{row.distance === null
								? "—"
								: `${row.distance.toFixed(1)} m`}</span
						>
						{#if row.matchingRules.length > 0}<span
								title={`Tracked by: ${view.rules
									.filter((rule) => row.matchingRules.includes(rule.id))
									.map((rule) => rule.match.pattern)
									.join(", ")}`}
								aria-label="Tracked">★</span
							>{/if}
					</div>
					{#if expanded === row.guid}
						<div class="ui-catalog-details entity-details">
							<span
								class="ui-pill"
								data-entity-category={row.category}
								title={NEARBY_CATEGORY_DETAILS[row.category].label}
							>
								{row.facts.vendor
									? "Vendor"
									: row.corpse !== null
										? `Corpse · ${row.corpse}`
										: NEARBY_CATEGORY_DETAILS[row.category].label}
							</span>
							{#if row.location.waypoint !== null}{@const waypoint =
									row.location.waypoint}<button
									class="ui-inline-button"
									type="button"
									onclick={() => onSetWaypoint(waypoint)}
									title="Set waypoint">{row.location.text}</button
								>{:else}<div>{row.location.text}</div>{/if}
							{#if row.facts.stackCount !== null}<div>
									Quantity: {row.facts.stackCount}
								</div>{/if}
							{#if row.facts.structure.current !== null || row.facts.structure.max !== null}<div
								>
									Structure: {row.facts.structure.current ?? "Unknown"} / {row
										.facts.structure.max ?? "Unknown"}
								</div>{/if}
							<div class="ui-icon-actions ui-list-actions">
								<button
									class="ui-button ui-icon-button"
									aria-label={`Exact-name alert for ${displayName}`}
									aria-pressed={exactAlertEnabled}
									title={exactAlertEnabled
										? "Disable exact-name alert"
										: "Enable exact-name alert"}
									type="button"
									disabled={!view.editable ||
										row.facts.name.trim().length === 0}
									onclick={() => toggleExactAlert(row.facts.name)}
									><ClientHudIcon
										name={exactAlertEnabled ? "bell-active" : "bell"}
									/></button
								>
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
</div>

<style>
	@layer components {
		.entity-catalog {
			display: flex;
			flex-direction: column;
			gap: var(--ui-filter-gap);
			height: 100%;
			min-height: 0;
		}
		.search-line,
		.sort-line,
		.sort-line label,
		.entity-row {
			display: flex;
			align-items: center;
			gap: var(--ui-filter-gap);
		}
		.search-line input,
		.entity-name {
			flex: 1;
			min-width: 0;
		}
		.sort-line {
			justify-content: space-between;
		}
		.filter-pills {
			display: flex;
			flex-wrap: wrap;
			gap: var(--ui-filter-gap);
			padding-bottom: var(--ui-filter-gap);
		}
		.entity-results {
			overflow: auto;
			min-height: 0;
			flex: 1;
		}
		.entity-results ul {
			list-style: none;
			margin: 0;
			padding: 0;
		}
		.entity-controls {
			flex-shrink: 0;
			border-bottom: 1px solid var(--ui-color-border);
			padding-bottom: var(--ui-filter-gap);
		}
		.entity-filters {
			max-height: var(
				--ui-filter-max-height,
				calc(var(--ui-viewport-height) * 0.4)
			);
			overflow: auto;
		}
		.entity-filters summary {
			cursor: pointer;
			padding-block: var(--ui-filter-gap);
		}
		.sort-line {
			flex-wrap: wrap;
		}
		.sort-line span {
			margin-left: auto;
		}
		.entity-row {
			gap: 0;
		}
		.entity-disclosure {
			align-self: stretch;
			color: var(--ui-color-accent);
		}
		.entity-name {
			align-self: stretch;
		}
		.entity-details {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: var(--ui-list-row-gap);
			padding: var(--ui-catalog-row-padding);
		}
		.entity-details > div:not(.ui-icon-actions) {
			min-width: 0;
			overflow-wrap: anywhere;
		}
		.entity-name {
			text-align: left;
			overflow-wrap: anywhere;
		}
		.category-icon {
			display: inline-flex;
			width: var(--ui-entity-category-icon-size);
			height: var(--ui-entity-category-icon-size);
			flex: 0 0 var(--ui-entity-category-icon-size);
			margin-right: var(--ui-list-icon-gap);
		}
		.selected {
			outline: 1px solid var(--ui-color-accent);
			outline-offset: -1px;
		}
	}
</style>
