<script lang="ts">
	import { entityDisplayName } from "../lib/game/entity-display-name";
	import { untrack } from "svelte";
	import UiPanelDialog from "../app/UiPanelDialog.svelte";
	import UiTabs from "../app/UiTabs.svelte";
	import UiTabPanel from "../app/UiTabPanel.svelte";
	import ClientEntityCategoryIcon from "./ClientEntityCategoryIcon.svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import type { ClientNearby } from "./client-nearby";
	import {
		compileEntityAlert,
		findExactEntityAlert,
		entityAlertRuleSchema,
		entityAlertRulesSchema,
		type EntityAlertRule,
	} from "./client-entity-alerts";
	import {
		filterNearbyRows,
		matchesNearbyFilter,
		NEARBY_FILTER_OPTIONS,
		NEARBY_CATEGORY_DETAILS,
		type NearbyQuery,
	} from "./client-nearby-policy";
	import { CLIENT_NEARBY_TUNING } from "./client-tuning";
	import type { MapWaypointTarget } from "../lib/game/map/map-waypoint";

	const {
		owner,
		visible,
		selectedGuid,
		onSelectEntity,
		onExamineEntity,
		onSetWaypoint,
	}: {
		readonly owner: ClientNearby;
		readonly visible: boolean;
		readonly selectedGuid: number | null;
		readonly onSelectEntity: (guid: number) => boolean;
		/** Examine the current selection only after this panel successfully selects its row. */
		readonly onExamineEntity: () => void;
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
	} = $props();
	// Cold initial markup; only this visible consumer's bounded timer publishes later rows.
	let view = $state(untrack(() => owner.read()));
	let tab = $state("entities");
	let query = $state<NearbyQuery>({
		text: "",
		categories: [],
		tracked: false,
		sort: "distance",
	});
	let expanded = $state<number | null>(null);
	let error = $state<string | null>(null);
	/** Draft belongs to this session's panel and survives ordinary tab changes. */
	let editor = $state<{
		id: string;
		pattern: string;
		mode: EntityAlertRule["match"]["mode"];
		enabled: boolean;
	} | null>(null);
	const preview = $derived.by(() => {
		if (editor === null) return null;
		const result = entityAlertRuleSchema.safeParse({
			id: editor.id,
			enabled: editor.enabled,
			match: { mode: editor.mode, pattern: editor.pattern },
		});
		return result.success ? compileEntityAlert(result.data.match) : null;
	});
	const rows = $derived(filterNearbyRows(view.rows, query));
	const previewCount = $derived.by(() => {
		const matches = preview;
		return matches === null
			? null
			: view.rows.filter((row) => matches(row.facts.name)).length;
	});
	const tabs = [
		{
			value: "entities",
			label: "Entities",
			id: "nearby-entities-tab",
			panelId: "nearby-entities-panel",
		},
		{
			value: "alerts",
			label: "Alerts",
			id: "nearby-alerts-tab",
			panelId: "nearby-alerts-panel",
		},
	];
	function pull(): void {
		view = owner.read();
		if (
			view.ready &&
			expanded !== null &&
			!view.rows.some((row) => row.guid === expanded)
		)
			expanded = null;
		if (!view.editable) editor = null;
	}
	$effect(() => {
		if (!visible) {
			editor = null;
			error = null;
			return;
		}
		untrack(pull);
		const timer = setInterval(pull, CLIENT_NEARBY_TUNING.displayIntervalMs);
		return () => clearInterval(timer);
	});
	function change(rules: readonly EntityAlertRule[]): boolean {
		const result = entityAlertRulesSchema.safeParse(rules);
		if (!result.success) {
			error = result.error.issues.map((issue) => issue.message).join(" ");
			return false;
		}
		if (
			view.characterGuid === null ||
			!owner.changeRules(view.characterGuid, result.data)
		) {
			pull();
			error = "Character alerts are unavailable or the character has changed.";
			return false;
		}
		error = null;
		pull();
		return true;
	}
	function cancelEditor(): void {
		editor = null;
		error = null;
	}
	/** Both pointer actions share selection admission and unavailable-target feedback. */
	function selectEntity(guid: number): boolean {
		const selected = onSelectEntity(guid);
		error = selected
			? null
			: "This entity is currently outside selection range or unavailable.";
		return selected;
	}
	function focusPattern(input: HTMLInputElement): void {
		input.focus();
		input.select();
	}
	function save(): void {
		if (editor === null) return;
		const { id, mode, pattern, enabled } = editor;
		const rule: EntityAlertRule = { id, enabled, match: { mode, pattern } };
		if (change([...view.rules.filter((existing) => existing.id !== id), rule]))
			editor = null;
	}
	function toggleExactAlert(name: string): void {
		const existing = findExactEntityAlert(view.rules, name);
		change(
			existing === undefined
				? [
						...view.rules,
						{
							id: crypto.randomUUID(),
							enabled: true,
							match: { mode: "exact", pattern: name },
						},
					]
				: view.rules.map((rule) =>
						rule.id === existing.id
							? { ...rule, enabled: !rule.enabled }
							: rule,
					),
		);
	}
</script>

<div class="ui-body ui-tabbed-panel nearby-panel">
	<UiTabs
		label="Nearby tabs"
		{tabs}
		selected={tab}
		onSelect={(value) => {
			tab = value;
			error = null;
		}}
	/>
	{#if error !== null && editor === null}<p class="ui-error" role="alert">
			{error}
		</p>{/if}
	<UiTabPanel
		id="nearby-entities-panel"
		labelledBy="nearby-entities-tab"
		active={tab === "entities"}
		scroll={false}
	>
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
						disabled={query.text === "" &&
							query.categories.length === 0 &&
							!query.tracked}
						onclick={() =>
							(query = { ...query, text: "", categories: [], tracked: false })}
						>Reset</button
					>
				</div>
				<details class="entity-filters">
					<summary
						>Filters{query.categories.length + Number(query.tracked) > 0
							? ` · ${query.categories.length + Number(query.tracked)} selected`
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
								>{label} ({view.rows.filter((row) =>
									matchesNearbyFilter(row, category),
								).length})</button
							>
						{/each}
						<button
							class="ui-filter-pill"
							type="button"
							aria-pressed={query.tracked}
							onclick={() => (query = { ...query, tracked: !query.tracked })}
							>Tracked</button
						>
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
					<span role="status">{rows.length} of {view.rows.length} entities</span
					>
				</div>
			</div>
			<div class="entity-results">
				{#if !view.ready}<p role="status">Waiting for nearby entities…</p>
				{:else if rows.length === 0}<p>
						No nearby entities match your filters.
					</p>{/if}
				<ul>
					{#each rows as row (row.guid)}
						{@const displayName = entityDisplayName(row.facts.name, row.guid)}
						{@const exactAlertEnabled =
							findExactEntityAlert(view.rules, row.facts.name)?.enabled ===
							true}
						<li
							class="ui-catalog-row"
							class:expanded={expanded === row.guid}
							data-entity-guid={row.guid}
							class:selected={selectedGuid === row.guid}
							oncontextmenu={(event) => {
								event.preventDefault();
								if (selectEntity(row.guid)) onExamineEntity();
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
									onclick={() => selectEntity(row.guid)}>{displayName}</button
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
	</UiTabPanel>
	<UiTabPanel
		id="nearby-alerts-panel"
		labelledBy="nearby-alerts-tab"
		active={tab === "alerts"}
	>
		<div class="ui-action-row alert-toolbar">
			<button
				class="ui-button"
				aria-label="Add entity alert"
				title="Add entity alert"
				type="button"
				disabled={!view.editable}
				onclick={() => {
					editor = {
						id: crypto.randomUUID(),
						pattern: "",
						mode: "substring",
						enabled: true,
					};
					error = null;
				}}>Add alert</button
			>
		</div>
		{#if !view.editable}<p role="status">
				Waiting for character alert settings…
			</p>
		{:else if view.rules.length === 0}<p>No entity alerts configured.</p>{/if}
		<ul class="alert-rules">
			{#each view.rules as rule (rule.id)}
				<li class="ui-list-row ui-list-row-nowrap" data-alert-id={rule.id}>
					<label class="ui-list-content alert-rule-toggle">
						<input
							type="checkbox"
							aria-label={`Alert for ${rule.match.pattern}`}
							checked={rule.enabled}
							disabled={!view.editable}
							onchange={(event) =>
								change(
									view.rules.map((value) =>
										value.id === rule.id
											? { ...value, enabled: event.currentTarget.checked }
											: value,
									),
								)}
						/>
						<span class="ui-list-content" class:ui-muted={!rule.enabled}>
							<span class="ui-list-name" title={rule.match.pattern}
								>{rule.match.pattern}</span
							>
							<span class="ui-list-name ui-muted">
								{{ substring: "Substring", exact: "Exact", glob: "Glob" }[
									rule.match.mode
								]} · {#if view.ready}{view.rows.filter((row) =>
										row.matchingRules.includes(rule.id),
									).length} current matches{:else}Matches unavailable{/if}
							</span>
						</span>
					</label>
					<div class="ui-icon-actions ui-list-actions">
						<button
							class="ui-button ui-icon-button"
							type="button"
							aria-label={`Edit alert for ${rule.match.pattern}`}
							title={`Edit alert for ${rule.match.pattern}`}
							disabled={!view.editable}
							onclick={() => {
								editor = { id: rule.id, enabled: rule.enabled, ...rule.match };
								error = null;
							}}><ClientHudIcon name="edit" /></button
						>
						<button
							class="ui-button ui-icon-button"
							type="button"
							aria-label={`Delete alert for ${rule.match.pattern}`}
							title={`Delete alert for ${rule.match.pattern}`}
							disabled={!view.editable}
							onclick={() =>
								change(view.rules.filter((value) => value.id !== rule.id))}
							><ClientHudIcon name="remove" /></button
						>
					</div>
				</li>
			{/each}
		</ul>
	</UiTabPanel>
	{#if editor !== null}
		{@const editingId = editor.id}
		{@const heading = view.rules.some((rule) => rule.id === editingId)
			? "Edit entity alert"
			: "Add entity alert"}
		<UiPanelDialog
			title={heading}
			className="nearby-alert-dialog"
			overlayClassName="nearby-alert-overlay"
			onCancel={cancelEditor}
		>
			<form
				class="alert-editor"
				onsubmit={(event) => {
					event.preventDefault();
					save();
				}}
			>
				<strong>{heading}</strong>
				<label
					>Name or pattern <input
						class="ui-input"
						bind:value={editor.pattern}
						use:focusPattern
						required
					/></label
				>
				<label
					>Match <select class="ui-input" bind:value={editor.mode}>
						<option value="substring">Substring</option><option value="exact"
							>Exact name</option
						><option value="glob">Name glob</option>
					</select></label
				>
				<p class="ui-muted">
					Names ignore case.{#if editor.mode === "substring"}
						Substrings match literal text anywhere in a name.
					{:else if editor.mode === "glob"}
						Globs match the whole name: * matches any text, ? matches one
						character. Use \ to escape a literal *, ? or \.{/if}
				</p>
				<p role="status">
					{#if !view.ready}Waiting for nearby entities…
					{:else if previewCount === null}Enter a valid pattern to preview
						matches.
					{:else}{previewCount} current matches{/if}
				</p>
				{#if error !== null}<p class="ui-error" role="alert">{error}</p>{/if}
				<div class="ui-dialog-actions">
					<button class="ui-button" type="button" onclick={cancelEditor}
						>Cancel</button
					>
					<button class="ui-button" type="submit" disabled={preview === null}
						>Save</button
					>
				</div>
			</form>
		</UiPanelDialog>
	{/if}
</div>

<style>
	@layer components {
		.nearby-panel {
			position: relative;
		}
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
		.entity-results ul,
		.alert-rules {
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
			max-height: var(--ui-filter-max-height);
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
			width: calc(var(--ui-entity-category-icon-size) * var(--ui-icon-scale));
			height: calc(var(--ui-entity-category-icon-size) * var(--ui-icon-scale));
			flex: 0 0 calc(var(--ui-entity-category-icon-size) * var(--ui-icon-scale));
			margin-right: var(--ui-list-icon-gap);
		}
		.selected {
			outline: 1px solid var(--ui-color-accent);
			outline-offset: -1px;
		}
		.alert-rule-toggle {
			display: flex;
			align-items: flex-start;
			gap: calc(2 * var(--ui-list-icon-gap));
		}
		.alert-rule-toggle .ui-list-name {
			display: block;
		}
		.alert-toolbar {
			padding-bottom: var(--ui-filter-gap);
		}
		.alert-editor label {
			display: grid;
			gap: var(--ui-list-detail-gap);
		}
		.alert-editor :is(input, select) {
			box-sizing: border-box;
			width: 100%;
			min-width: 0;
		}
	}
</style>
