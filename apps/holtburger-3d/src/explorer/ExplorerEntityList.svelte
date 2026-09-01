<script lang="ts">
	import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
	import {
		explorerEntitySelection,
		type ExplorerEntitySelection,
	} from "./explorer-entity-panel-state";
	import { buildExplorerEntityTree } from "./explorer-entity-tree";

	interface Props {
		readonly entities: readonly DynamicEntityView[];
		readonly selected: ExplorerEntitySelection | null;
		readonly possessed: ExplorerEntitySelection | null;
		readonly select: (selection: ExplorerEntitySelection) => void;
	}

	let { entities, selected, possessed, select }: Props = $props();
	const tree = $derived(buildExplorerEntityTree(entities));

	function isSelected(entity: DynamicEntityView): boolean {
		return (
			selected?.guid === entity.identity.guid &&
			selected.generation === entity.generation
		);
	}

	function isPossessed(entity: DynamicEntityView): boolean {
		return (
			possessed?.guid === entity.identity.guid &&
			possessed.generation === entity.generation
		);
	}

	function formatGuid(guid: number): string {
		return `0x${guid.toString(16).padStart(8, "0")}`;
	}
</script>

{#snippet entityRow(entity: DynamicEntityView, detail: string)}
	<button
		type="button"
		class="explorer-selectable-row"
		class:active={isSelected(entity)}
		class:possessed={isPossessed(entity)}
		onclick={() => select(explorerEntitySelection(entity))}
	>
		<span class="entity-heading">
			<strong>{entity.display.name}</strong>
			<span>WCID {entity.identity.wcid}</span>
		</span>
		<span>
			{formatGuid(entity.identity.guid)}
			{#if isPossessed(entity)}
				<span class="possession-label"> · possessed</span>
			{/if}
			· {detail}
		</span>
	</button>
{/snippet}

{#if entities.length === 0}
	<p class="entity-note">No Explorer-spawned entities.</p>
{:else}
	<ul class="explorer-selectable-list entity-list">
		{#each tree.roots as root (`${root.entity.identity.guid}-${root.entity.generation}`)}
			<li class="entity-node">
				{@render entityRow(
					root.entity,
					`${root.entity.physics.participation} · ${root.entity.placement.kind}`,
				)}
				{#if root.children.length > 0}
					<ul class="entity-children">
						{#each root.children as child (`${child.identity.guid}-${child.generation}`)}
							<li class="entity-child">
								{@render entityRow(
									child,
									`held at ${child.placement.parentLocation}`,
								)}
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
	{#if tree.orphans.length > 0}
		<p class="entity-note invalid" role="alert">
			{tree.orphans.length} held item(s) reference a wearer absent from this feed
			generation.
		</p>
		<ul class="explorer-selectable-list entity-list orphan-list">
			{#each tree.orphans as orphan (`${orphan.identity.guid}-${orphan.generation}`)}
				<li class="entity-node orphan">
					{@render entityRow(
						orphan,
						`missing wearer ${formatGuid(orphan.placement.parent)}`,
					)}
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.entity-note {
		margin: 0;
		color: var(--ac-ink-muted);
		font-size: 0.76rem;
	}

	.invalid {
		color: #ff9c8f;
	}

	.entity-list {
		max-height: clamp(170px, 34dvh, 390px);
		overflow: auto;
		margin: 0;
		padding: 0;
		list-style: none;
		--tree-gap: 4px;
	}

	.entity-node,
	.entity-children,
	.entity-child {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}

	.entity-node,
	.entity-children {
		gap: var(--tree-gap);
	}

	.entity-children {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entity-child {
		position: relative;
		padding-left: 15px;
	}

	.entity-child::before {
		content: "";
		position: absolute;
		top: calc(-1 * var(--tree-gap));
		bottom: 0;
		left: 4px;
		border-left: 1px solid rgb(162 117 33 / 45%);
	}

	.entity-child:last-child::before {
		bottom: auto;
		height: calc(50% + var(--tree-gap));
	}

	.entity-child::after {
		content: "";
		position: absolute;
		top: 50%;
		left: 4px;
		width: 7px;
		border-top: 1px solid rgb(162 117 33 / 45%);
	}

	.explorer-selectable-row {
		gap: 2px;
		min-width: 0;
	}

	.explorer-selectable-row.possessed {
		box-shadow: inset 3px 0 0 var(--ac-green);
	}

	.possession-label {
		color: #b9ee8c;
		font-weight: 600;
	}

	.entity-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		align-items: baseline;
	}

	.entity-heading strong,
	.entity-heading span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.explorer-selectable-row > span {
		color: var(--ac-ink-muted);
		font-size: 0.73rem;
	}

	.orphan .explorer-selectable-row {
		border-color: #ff9c8f;
	}

	.orphan-list {
		max-height: 150px;
	}
</style>
