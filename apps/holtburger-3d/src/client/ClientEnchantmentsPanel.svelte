<script lang="ts">
	import SortIcon from "../assets/icons/sort.svg?component";
	import DurationIcon from "../assets/icons/duration.svg?component";
	import { onMount } from "svelte";
	import UiIcon from "../app/UiIcon.svelte";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import { CLIENT_TUNING } from "./client-tuning";
	import {
		prepareSpellRow,
		type ClientSpellServices,
		type SpellRow,
	} from "./client-spells";
	import {
		SPELL_FILTER_OPTIONS,
		type SpellFilterTag,
		type SpellSearch,
	} from "./client-spell-search";
	import {
		enchantmentKey,
		projectEnchantmentSections,
		type EnchantmentDisplayRow,
		type EnchantmentSortField,
	} from "./client-enchantments-view";
	import type { ClientTimedEnchantments } from "./client-lifecycle-session";

	interface Props {
		readonly enchantments: ClientTimedEnchantments | null;
		readonly spells: ClientSpellServices | null;
		/** Incremented by either tray button; a click resets text/school and selects its kind. */
		readonly launch: {
			readonly kind: "beneficial" | "harmful";
			readonly revision: number;
		} | null;
	}
	const { enchantments, spells, launch }: Props = $props();
	const filterOptions = SPELL_FILTER_OPTIONS.filter(
		([, , category]) => category === "disposition" || category === "school",
	);
	const sortOptions: Readonly<
		Record<
			EnchantmentSortField,
			{
				readonly label: string;
				readonly badge: string | null;
				readonly next: EnchantmentSortField;
			}
		>
	> = {
		name: { label: "Name (A–Z)", badge: "A-Z", next: "power" },
		power: {
			label: "Power, strongest first",
			badge: "Power",
			next: "duration",
		},
		duration: { label: "Duration, soonest first", badge: null, next: "name" },
	};
	let search = $state<SpellSearch>({ text: "", tags: [] });
	let showMoreFilters = $state(false);
	const visibleFilters = $derived(
		filterOptions.filter(
			([, , category]) => showMoreFilters || category === "disposition",
		),
	);
	const selectedSchoolCount = $derived(
		filterOptions.filter(
			([tag, , category]) => category === "school" && search.tags.includes(tag),
		).length,
	);
	let sortField = $state<EnchantmentSortField>("name");
	let expandedGroups = $state<ReadonlySet<string>>(new Set());
	let expandedDescription = $state<string | null>(null);
	let rows = $state<ReadonlyMap<number, SpellRow>>(new Map());
	let metadataStatus = $state<"ready" | "loading" | "failed">("ready");
	let metadataError = $state<string | null>(null);
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());
	let nowMs = $state(performance.now());
	let lastLaunchRevision = -1;
	$effect(() => {
		if (launch === null || launch.revision === lastLaunchRevision) return;
		lastLaunchRevision = launch.revision;
		search = { text: "", tags: [launch.kind] };
	});

	const sections = $derived(
		enchantments === null
			? []
			: projectEnchantmentSections(
					enchantments.resolved,
					rows,
					search,
					sortField,
				),
	);
	const visibleCount = $derived(
		sections.reduce((count, section) => count + section.groups.length, 0),
	);
	const totalCount = $derived(
		(enchantments?.resolved.groups.length ?? 0) +
			(enchantments?.resolved.instances.filter(
				(instance) => instance.kind === "vitae",
			).length ?? 0),
	);
	const spellIds = $derived(
		enchantments === null
			? []
			: [
					...new Set(
						enchantments.resolved.instances
							.filter(
								(instance) =>
									instance.kind === "beneficial" ||
									instance.kind === "harmful" ||
									instance.kind === "vitae",
							)
							.map((instance) => instance.key.spellId),
					),
				].sort((a, b) => a - b),
	);
	const spellIdSignature = $derived(spellIds.join(","));

	$effect(() => {
		const service = spells;
		const ids =
			spellIdSignature === "" ? [] : spellIdSignature.split(",").map(Number);
		let disposed = false;
		if (service === null || ids.length === 0) {
			rows = new Map();
			metadataStatus = "ready";
			metadataError = null;
			return;
		}
		const owner = service.icons.createOwner("display");
		rows = new Map();
		metadataStatus = "loading";
		metadataError = null;
		void service
			.load(ids)
			.then((references) => {
				if (disposed) return;
				rows = new Map(
					references.map((reference) => [
						reference.id,
						prepareSpellRow(reference, service.icons, owner),
					]),
				);
				metadataStatus = "ready";
			})
			.catch((error: unknown) => {
				if (disposed) return;
				metadataError = error instanceof Error ? error.message : String(error);
				metadataStatus = "failed";
			});
		return () => {
			disposed = true;
			service.icons.releaseOwner(owner);
		};
	});

	onMount(() => {
		let revision = -1;
		let sampledRows: ReadonlyMap<number, SpellRow> | null = null;
		let sampledService: ClientSpellServices | null = null;
		const refresh = () => {
			const service = spells;
			if (service === null) {
				displays = new Map();
				return;
			}
			if (
				sampledService === service &&
				sampledRows === rows &&
				revision === service.icons.revision
			)
				return;
			sampledService = service;
			sampledRows = rows;
			revision = service.icons.revision;
			displays = new Map(
				[...rows.values()].flatMap((row) =>
					row.artwork.kind === "icon"
						? [[row.artwork.key, service.icons.read(row.artwork.key)] as const]
						: [],
				),
			);
		};
		const iconTimer = window.setInterval(
			refresh,
			CLIENT_TUNING.spells.iconDisplayIntervalMs,
		);
		const clockTimer = window.setInterval(() => {
			nowMs = performance.now();
		}, 1000);
		refresh();
		return () => {
			window.clearInterval(iconTimer);
			window.clearInterval(clockTimer);
		};
	});

	function toggleTag(tag: SpellFilterTag): void {
		search = {
			...search,
			tags: search.tags.includes(tag)
				? search.tags.filter((selected) => selected !== tag)
				: [...search.tags, tag],
		};
	}
	function toggleGroup(id: string): void {
		const next = new Set(expandedGroups);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedGroups = next;
	}
	function toggleDescription(id: string): void {
		expandedDescription = expandedDescription === id ? null : id;
	}
	function duration(seconds: number): string {
		const elapsedSeconds = Math.max(
			0,
			(nowMs - (enchantments?.receivedAtMs ?? nowMs)) / 1000,
		);
		const remaining = Math.max(0, Math.ceil(seconds - elapsedSeconds));
		if (remaining === 0) return "0:00 · awaiting removal";
		const hours = Math.floor(remaining / 3600);
		const minutes = Math.floor((remaining % 3600) / 60);
		const tail = String(remaining % 60).padStart(2, "0");
		return hours > 0
			? `${hours}:${String(minutes).padStart(2, "0")}:${tail}`
			: `${minutes}:${tail}`;
	}
</script>

{#snippet spellRow(row: EnchantmentDisplayRow, id: string)}
	<div class="spell-entry" class:expanded={expandedDescription === id}>
		<button
			type="button"
			class="spell-header"
			aria-expanded={expandedDescription === id}
			onclick={() => toggleDescription(id)}
		>
			<span class="spell-icon">
				{#if row.spell?.artwork.kind === "icon"}
					<UiIcon
						display={displays.get(row.spell.artwork.key)}
						name="…"
						tooltipLabel={row.spell.name}
					/>
				{:else}<span
						title={row.spell?.artwork.kind === "failed"
							? row.spell.artwork.detail
							: "Loading spell artwork"}>?</span
					>{/if}
			</span>
			<span class="spell-name"
				>{row.spell?.name ??
					`Spell ${row.instance.key.spellId}`}{#if row.spell?.artwork.kind === "failed"}<small
						>{row.spell.artwork.detail}</small
					>{/if}</span
			>
			{#if row.instance.remainingSeconds === null}<span
					class="spell-duration"
					role="img"
					aria-label="Permanent duration"
					title="Permanent">∞</span
				>{:else}<span class="spell-duration"
					>{duration(row.instance.remainingSeconds)}</span
				>{/if}
			<span class="expansion-indicator" aria-hidden="true"
				>{expandedDescription === id ? "▾" : "▸"}</span
			>
		</button>
		{#if expandedDescription === id}<div class="spell-details">
				<p>
					{row.spell?.details?.description ?? "Spell description unavailable."}
				</p>
			</div>{/if}
	</div>
{/snippet}

<section class="enchantments-panel ui-body" aria-label="Active enchantments">
	<div class="controls">
		<div class="search-line">
			<input
				type="search"
				aria-label="Search enchantment and stat names"
				placeholder="Search spells or stats…"
				value={search.text}
				oninput={(event) => {
					search = { ...search, text: event.currentTarget.value };
				}}
			/>
			<button
				type="button"
				aria-label="Reset enchantment search and filters"
				disabled={search.text.length === 0 && search.tags.length === 0}
				onclick={() => {
					search = { text: "", tags: [] };
				}}>Reset</button
			>
		</div>
		<div class="filter-pills" role="group" aria-label="Enchantment filters">
			{#each visibleFilters as [tag, label, category]}
				<button
					type="button"
					data-filter-category={category}
					aria-pressed={search.tags.includes(tag)}
					class:active={search.tags.includes(tag)}
					onclick={() => toggleTag(tag)}>{label}</button
				>
			{/each}
			<button
				type="button"
				class="more-filters"
				aria-expanded={showMoreFilters}
				onclick={() => (showMoreFilters = !showMoreFilters)}
				>{showMoreFilters
					? "Less..."
					: `More...${selectedSchoolCount > 0 ? ` (${selectedSchoolCount})` : ""}`}</button
			>
		</div>
		<div class="sort-line">
			<span class="count" role="status"
				>{visibleCount} / {totalCount} effects</span
			>
			<button
				type="button"
				class="sort-button"
				data-sort-field={sortField}
				aria-label={`Sort enchantments: ${sortOptions[sortField].label}`}
				title={`Sort: ${sortOptions[sortField].label}. Click for ${sortOptions[sortOptions[sortField].next].label}.`}
				onclick={() => {
					sortField = sortOptions[sortField].next;
				}}
			>
				<SortIcon />
				{#if sortOptions[sortField].badge !== null}
					<span aria-hidden="true">{sortOptions[sortField].badge}</span>
				{:else}
					<DurationIcon />
				{/if}
			</button>
		</div>
	</div>
	<div class="results">
		{#if enchantments === null}<p role="status">
				Waiting for character enchantments…
			</p>
		{:else if totalCount === 0}<p>No active enchantments.</p>
		{:else}
			{#if metadataStatus === "loading"}<p role="status">
					Loading spell names and artwork…
				</p>{/if}
			{#if metadataStatus === "failed"}<p role="alert">
					Spell references could not be loaded: {metadataError}
				</p>{/if}
			{#if sections.length === 0}<p>
					No enchantments match your search and filters.
				</p>{/if}
			{#each sections as section (section.id)}
				<section class="stat-section" aria-label={section.label}>
					<h3>
						{section.label}{#if section.value !== undefined}
							· {section.value}{/if}
					</h3>
					<ul>
						{#each section.groups as group (group.id)}
							<li
								data-enchantment-key={enchantmentKey(
									group.effective.instance.key,
								)}
							>
								<div
									class="group-header"
									class:contextual={group.contextualParent}
								>
									{#if group.overridden.length > 0}<button
											type="button"
											class="tree-toggle"
											aria-label={`${group.contextualParent || expandedGroups.has(group.id) ? "Hide" : "Show"} overridden spells for ${group.effective.spell?.name ?? `Spell ${group.effective.instance.key.spellId}`}`}
											aria-expanded={group.contextualParent ||
												expandedGroups.has(group.id)}
											disabled={group.contextualParent}
											onclick={() => toggleGroup(group.id)}
											>{group.contextualParent || expandedGroups.has(group.id)
												? "▾"
												: "▸"}</button
										>
									{:else}<span class="tree-spacer"></span>{/if}
									{@render spellRow(group.effective, group.id)}
								</div>
								{#if group.contextualParent || expandedGroups.has(group.id)}
									<ul class="overridden">
										{#each group.overridden as child (enchantmentKey(child.instance.key))}
											<li
												data-enchantment-key={enchantmentKey(
													child.instance.key,
												)}
											>
												{@render spellRow(
													child,
													`${group.id}:${enchantmentKey(child.instance.key)}`,
												)}
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		{/if}
	</div>
</section>

<style>
	@layer components {
		.enchantments-panel {
			display: flex;
			flex-direction: column;
			height: 100%;
			min-height: 0;
			padding: var(--ui-spell-panel-padding);
			box-sizing: border-box;
		}
		.controls {
			flex-shrink: 0;
			border-bottom: 1px solid var(--ui-color-border);
			padding-bottom: var(--ui-spell-filter-gap);
		}
		.search-line,
		.sort-line {
			display: flex;
			align-items: center;
			gap: var(--ui-spell-filter-gap);
		}
		.search-line input {
			flex: 1;
			min-width: 0;
		}
		.controls input,
		.controls button {
			font: inherit;
			color: inherit;
			background: var(--ui-color-well);
			border: 1px solid var(--ui-color-border);
		}
		.controls button {
			cursor: pointer;
		}
		.controls button:disabled {
			opacity: var(--ui-spell-control-disabled-opacity);
			cursor: default;
		}
		.filter-pills {
			display: flex;
			flex-wrap: wrap;
			gap: var(--ui-spell-filter-gap);
			padding-block: var(--ui-spell-filter-gap);
		}
		.controls .more-filters {
			border: 0;
			background: transparent;
			padding-inline: var(--ui-spell-filter-gap);
			color: var(--ui-enchantments-filter-toggle-color);
			text-decoration: var(--ui-enchantments-filter-toggle-decoration);
			text-underline-offset: var(
				--ui-enchantments-filter-toggle-underline-offset
			);
		}
		.controls .more-filters:hover {
			color: var(--ui-enchantments-filter-toggle-hover-color);
		}
		[data-filter-category="disposition"] {
			--filter-color: var(--ui-spell-filter-disposition-color);
		}
		[data-filter-category="school"] {
			--filter-color: var(--ui-spell-filter-school-color);
		}
		.filter-pills button[data-filter-category] {
			border-color: var(--filter-color);
			background: color-mix(
				in srgb,
				var(--filter-color) var(--ui-spell-filter-tint),
				var(--ui-color-well)
			);
			border-radius: var(--ui-spell-filter-pill-radius);
			padding: var(--ui-spell-filter-pill-padding);
		}
		.filter-pills button.active[data-filter-category] {
			background: color-mix(
				in srgb,
				var(--filter-color) var(--ui-spell-filter-active-tint),
				var(--ui-color-well)
			);
			outline: 1px solid var(--filter-color);
		}
		.sort-line {
			justify-content: space-between;
		}
		.controls .sort-button {
			display: flex;
			align-items: center;
			gap: 3px;
			padding: 2px;
			border: 0;
			background: transparent;
		}
		.controls .sort-button:hover {
			color: var(--ui-color-highlight);
		}
		.results {
			min-height: 0;
			overflow: auto;
			flex: 1;
		}
		.stat-section h3 {
			margin: var(--ui-enchantments-heading-margin);
			font-size: var(--ui-enchantments-heading-font-size);
			text-transform: var(--ui-enchantments-heading-text-transform);
			letter-spacing: var(--ui-enchantments-heading-letter-spacing);
		}
		.stat-section ul {
			list-style: none;
			margin: 0;
			padding: 0;
		}
		.stat-section li {
			border-bottom: 1px solid
				color-mix(
					in srgb,
					var(--ui-color-border) var(--ui-spell-row-divider-tint),
					transparent
				);
		}
		.group-header {
			display: flex;
			align-items: flex-start;
		}
		.group-header.contextual {
			opacity: 0.7;
		}
		.tree-toggle,
		.tree-spacer {
			flex: 0 0 var(--ui-enchantments-tree-gutter);
			width: var(--ui-enchantments-tree-gutter);
			height: var(--ui-spell-icon-size);
		}
		.tree-toggle {
			font: inherit;
			color: inherit;
			background: transparent;
			border: 0;
			cursor: pointer;
		}
		.tree-toggle:disabled {
			cursor: default;
		}
		.spell-entry {
			flex: 1;
			min-width: 0;
		}
		.spell-entry.expanded {
			border: 1px solid var(--ui-color-border);
			background: var(--ui-color-well);
		}
		.spell-header {
			width: 100%;
			text-align: left;
			color: inherit;
			font: inherit;
			background: transparent;
			border: 0;
			cursor: pointer;
			display: flex;
			align-items: center;
			gap: var(--ui-spell-row-gap);
			padding: var(--ui-spell-row-padding);
		}
		.spell-entry.expanded .spell-header,
		.spell-header:hover {
			background: var(--ui-color-control);
		}
		.spell-icon {
			width: var(--ui-spell-icon-size);
			height: var(--ui-spell-icon-size);
			flex: 0 0 var(--ui-spell-icon-size);
			display: grid;
			place-items: center;
		}
		.spell-name {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.spell-name small {
			display: block;
		}
		.spell-duration {
			white-space: nowrap;
			color: var(--ui-color-muted);
		}
		.expansion-indicator {
			padding-left: var(--ui-spell-expansion-indicator-gap);
		}
		.spell-details {
			border-top: 1px solid
				color-mix(
					in srgb,
					var(--ui-color-border) var(--ui-spell-details-divider-tint),
					transparent
				);
			padding: var(--ui-spell-details-padding);
			line-height: var(--ui-spell-details-line-height);
		}
		.spell-details p {
			margin: 0;
			white-space: pre-wrap;
		}
		.stat-section ul.overridden {
			margin-left: var(--ui-enchantments-tree-gutter);
			border-left: 1px solid var(--ui-color-border);
		}
		.overridden .spell-entry {
			margin-left: var(--ui-enchantments-child-indent);
		}
		.spell-header:focus-visible,
		.tree-toggle:focus-visible,
		.more-filters:focus-visible,
		.sort-button:focus-visible {
			outline: 2px solid var(--ui-color-focus);
		}
	}
</style>
