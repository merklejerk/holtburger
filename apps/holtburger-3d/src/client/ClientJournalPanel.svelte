<script lang="ts">
	import ClientWaypointText from "./ClientWaypointText.svelte";
	import type { MapWaypointTarget } from "../lib/game/map/map-waypoint";
	import ClientWaypointLink from "./ClientWaypointLink.svelte";
	import { contractLocationWaypoint } from "./client-contracts-map";
	import type { ContractLocation } from "./client-contracts-contract";
	import AvailableIcon from "../assets/icons/contract-available.svg?component";
	import CompletedIcon from "../assets/icons/contract-completed.svg?component";
	import UnresolvedIcon from "../assets/icons/contract-unresolved.svg?component";
	import ProgressIcon from "../assets/icons/contract-in-progress.svg?component";
	import ClockIcon from "../assets/icons/duration.svg?component";
	import { formatDuration } from "../app/duration-format";
	import {
		contractName,
		type ClientContractsState,
		type ContractFilter,
	} from "./client-contracts-state";
	import {
		contractLocationText,
		contractStatusLabel,
	} from "./client-contracts-view";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		/** Set the current local destination without submitting chat. */
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
		/** Session-owned facts and local journal controls. */
		readonly owner: ClientContractsState;
		/** Retained visibility owns display cadence and transient confirmation. */
		readonly visible: boolean;
		/** Existing app notice presentation for dispatch failures. */
		readonly onNotice: (message: string) => void;
	}
	const { owner, visible, onNotice, onSetWaypoint }: Props = $props();
	const { keyboard } = useAppInputPolicy();
	/** Markup-only snapshot pulled at a bounded cadence; scene/network producers do not own it. */
	let view = $state<ReturnType<ClientContractsState["read"]> | null>(null);
	const filters: readonly {
		readonly value: ContractFilter;
		readonly label: string;
	}[] = [
		{ value: "available", label: "Available" },
		{ value: "inProgress", label: "In progress" },
		{ value: "completed", label: "Completed" },
		{ value: "waitingToRepeat", label: "Waiting to repeat" },
		{ value: "unresolved", label: "Definition unavailable" },
	];
	function refresh(): void {
		view = owner.read();
	}
	$effect(() => {
		const source = owner;
		if (!visible) {
			source.dismissQuestion();
			return;
		}
		view = source.read();
		const timer = setInterval(() => {
			view = source.read();
		}, CLIENT_TUNING.journal.displayIntervalMs);
		return () => {
			clearInterval(timer);
			source.dismissQuestion();
		};
	});
</script>

{#snippet locationLink(location: ContractLocation)}
	{@const target = contractLocationWaypoint(location)}
	{#if target === null}{contractLocationText(
			location,
		)}{:else}<ClientWaypointLink
			interactive
			text={contractLocationText(location)}
			{target}
			{onSetWaypoint}
		/>{/if}
{/snippet}

<div
	class="ui-body journal-panel"
	use:keyboard.scope={{ nativeControls: true, keydown: () => {} }}
>
	{#if view !== null}
		<div class="journal-controls">
			<input
				class="ui-input"
				type="search"
				aria-label="Search contracts"
				placeholder="Search contracts"
				value={view.search}
				oninput={(event) => {
					owner.setSearch(event.currentTarget.value);
					refresh();
				}}
			/>
			<details class="journal-filters">
				<summary
					>Filters{view.filters.length > 0
						? ` · ${view.filters.length} selected`
						: ""}</summary
				>
				<div
					class="filter-pills"
					role="group"
					aria-label="Contract status filters"
				>
					<button
						type="button"
						class="ui-filter-pill"
						aria-label="All statuses"
						title="All statuses"
						aria-pressed={view.filters.length === 0}
						onclick={() => {
							owner.setFilters([]);
							refresh();
						}}>All</button
					>
					{#each filters as filter}
						<button
							type="button"
							class="ui-filter-pill"
							data-status={filter.value}
							aria-label={filter.label}
							title={filter.label}
							aria-pressed={view.filters.includes(filter.value)}
							onclick={() => {
								const selected = owner.read().filters;
								owner.setFilters(
									selected.includes(filter.value)
										? selected.filter((value) => value !== filter.value)
										: [...selected, filter.value],
								);
								refresh();
							}}
						>
							{filter.label}
						</button>
					{/each}
				</div>
			</details>
		</div>

		{#key view.character}
			<div class="journal-list">
				{#if view.journal === null}
					<p>Journal unavailable outside an active character.</p>
				{:else}
					{#if view.journal.total === 0}
						<p>Your contract journal is empty.</p>
					{:else if view.journal.rows.length === 0}
						<p>No contracts match your filters.</p>
					{/if}

					{#each view.journal.rows as row (row.id)}
						{@const label = contractStatusLabel(row)}
						<details
							class="ui-disclosure contract-row"
							open={view.expanded.has(row.id)}
						>
							<summary
								onclick={(event) => {
									event.preventDefault();
									owner.toggleExpanded(row.id);
									refresh();
								}}
							>
								<span class="contract-summary">
									<span
										class="contract-status"
										data-status={row.kind === "resolved"
											? row.status.kind
											: row.kind}
										title={label}
										role="img"
										aria-label={label}
									>
										{#if row.kind === "unresolved"}
											<UnresolvedIcon />
										{:else if row.status.kind === "available"}
											<AvailableIcon />
										{:else if row.status.kind === "completed"}
											<CompletedIcon />
										{:else if row.status.kind === "waitingToRepeat"}
											<ClockIcon />
										{:else}
											<ProgressIcon />
										{/if}
									</span>
									<span class="contract-name">{contractName(row)}</span>

									{#if row.kind === "resolved"}
										{#if row.status.kind === "inProgress" && row.status.progress !== null}
											<span class="contract-progress"
												>{row.status.progress}</span
											>
										{:else if row.status.kind === "waitingToRepeat"}
											<span
												class="contract-progress"
												title="Repeat available in"
												>{formatDuration(
													Math.ceil(row.status.remainingSeconds),
												)}</span
											>
										{/if}

										{#if row.deadline?.kind === "running"}
											<span class="deadline-badge" title="Time remaining"
												><ClockIcon />{formatDuration(
													Math.ceil(row.deadline.remainingSeconds),
												)}</span
											>
										{/if}
									{/if}
								</span>
							</summary>
							<div class="ui-disclosure-body contract-details">
								{#if row.kind === "unresolved"}
									<p>
										Contract definition #{row.id} is missing from client content.
									</p>
								{:else}
									<p>
										<ClientWaypointText
											interactive
											text={row.description}
											{onSetWaypoint}
										/>
									</p>
									<dl>
										<dt>Status</dt>
										<dd>{label}</dd>

										{#if row.status.kind === "inProgress" && row.status.progress !== null}
											<dt>Progress</dt>
											<dd>
												<ClientWaypointText
													interactive
													text={row.status.progress}
													{onSetWaypoint}
												/>
											</dd>
										{/if}

										{#if row.status.kind === "waitingToRepeat"}
											<dt>Repeat available in</dt>
											<dd>
												{formatDuration(Math.ceil(row.status.remainingSeconds))}
											</dd>
										{/if}

										{#if row.contact === null}
											<dt>Contact</dt>
											<dd>Not provided</dd>
										{:else}
											<dt>
												{row.contact.role === "start"
													? "Start contact"
													: "End contact"}
											</dt>
											<dd>{row.contact.name}</dd>
											<dt>Contact location</dt>
											<dd>{@render locationLink(row.contact.location)}</dd>
										{/if}

										<dt>Quest area</dt>
										<dd>{@render locationLink(row.area)}</dd>

										{#if row.deadline !== null}
											<dt>Time remaining</dt>
											<dd>
												{row.deadline.kind === "finished"
													? "Finished"
													: formatDuration(
															Math.ceil(row.deadline.remainingSeconds),
														)}
											</dd>
										{/if}
									</dl>
								{/if}

								<div class="ui-action-row">
									<button
										class="ui-button"
										disabled={!view.enabled}
										onclick={() => owner.requestRemove(row.id, onNotice)}
										>Remove from journal</button
									>
								</div>
							</div>
						</details>
					{/each}
				{/if}
			</div>
		{/key}
	{/if}
</div>

<style>
	@layer components {
		.journal-panel {
			display: flex;
			flex-direction: column;
			gap: 10px;
			height: 100%;
			min-height: 0;
		}
		.journal-controls {
			display: flex;
			flex-direction: column;
			flex-shrink: 0;
			gap: 8px;
		}
		.journal-filters {
			max-height: var(--ui-filter-max-height);
			overflow: auto;
		}
		.journal-filters summary {
			cursor: pointer;
			padding-block: var(--ui-filter-gap);
		}
		.filter-pills {
			display: flex;
			flex-wrap: wrap;
			gap: var(--ui-filter-gap);
		}
		[data-status="available"] {
			--filter-color: var(--ui-color-text);
		}
		[data-status="inProgress"] {
			--filter-color: var(--ui-color-accent);
		}
		[data-status="completed"] {
			--filter-color: var(--ui-color-success);
		}
		[data-status="waitingToRepeat"],
		[data-status="unresolved"] {
			--filter-color: var(--ui-color-warning);
		}

		.journal-list {
			overflow: auto;
			min-height: 0;
			flex: 1;
		}
		.contract-row > summary {
			padding: 8px 0;
		}
		.contract-summary {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			width: calc(100% - 20px);
			vertical-align: middle;
		}
		.contract-status {
			display: inline-flex;
			flex: 0 0 18px;
			width: 18px;
			height: 18px;
		}
		.contract-status[data-status="inProgress"] {
			color: var(--ui-color-accent);
		}
		.contract-status[data-status="completed"] {
			color: var(--ui-color-success);
		}
		.contract-status[data-status="waitingToRepeat"],
		.contract-status[data-status="unresolved"] {
			color: var(--ui-color-warning);
		}
		.contract-status :global(svg) {
			width: 100%;
			height: 100%;
		}
		.contract-name {
			flex: 1;
			min-width: 0;
			overflow-wrap: anywhere;
		}
		.contract-progress,
		.deadline-badge {
			font-size: 0.85em;
		}
		.deadline-badge {
			display: inline-flex;
			align-items: center;
			gap: 4px;
		}
		.contract-details p {
			margin: 0 0 8px;
		}
		.contract-details dl {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: 4px 12px;
			margin: 0 0 12px;
		}
		.contract-details dd {
			margin: 0;
			overflow-wrap: anywhere;
		}
	}
</style>
