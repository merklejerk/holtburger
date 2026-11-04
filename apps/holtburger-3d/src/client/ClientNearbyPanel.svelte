<script lang="ts">
	import ClientNearbyEntities from "./ClientNearbyEntities.svelte";
	import { untrack } from "svelte";
	import UiPanelDialog from "../app/UiPanelDialog.svelte";
	import UiTabs from "../app/UiTabs.svelte";
	import UiTabPanel from "../app/UiTabPanel.svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import type { ClientNearby } from "./client-nearby";
	import {
		compileEntityAlert,
		findExactEntityAlert,
		entityAlertRuleSchema,
		entityAlertRulesSchema,
		type EntityAlertRule,
	} from "./client-entity-alerts";

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
		/** Inspect the clicked identity independently of the current selection. */
		readonly onExamineEntity: (guid: number) => void;
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
	} = $props();
	// Cold initial markup; only this visible consumer's bounded timer publishes later rows.
	let view = $state(untrack(() => owner.read()));
	let tab = $state("entities");

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
			value: "tracked",
			label: "Tracked",
			id: "nearby-tracked-tab",
			panelId: "nearby-tracked-panel",
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
	/** Left-click selection retains its existing admission feedback. */
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
		<ClientNearbyEntities
			{view}
			tracked={false}
			{selectedGuid}
			onSelectEntity={selectEntity}
			{onExamineEntity}
			{onSetWaypoint}
			{toggleExactAlert}
			readCurrent={() => owner.read()}
			onError={(message) => (error = message)}
		/>
	</UiTabPanel>
	<UiTabPanel
		id="nearby-tracked-panel"
		labelledBy="nearby-tracked-tab"
		active={tab === "tracked"}
		scroll={false}
	>
		<ClientNearbyEntities
			{view}
			tracked={true}
			{selectedGuid}
			onSelectEntity={selectEntity}
			{onExamineEntity}
			{onSetWaypoint}
			{toggleExactAlert}
			readCurrent={() => owner.read()}
			onError={(message) => (error = message)}
		/>
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
		.alert-rules {
			list-style: none;
			margin: 0;
			padding: 0;
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
