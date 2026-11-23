<script lang="ts">
	import ExamineIcon from "../../assets/icons/hud-examine.svg?component";
	import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
	import {
		explorerEntitySelection,
		type ExplorerEntitySelection,
	} from "./entity-panel-state";
	import { buildExplorerEntityTree } from "./entity-tree";

	interface Props {
		readonly entities: readonly DynamicEntityView[];
		readonly selected: ExplorerEntitySelection | null;
		readonly possessed: ExplorerEntitySelection | null;
		readonly select: (selection: ExplorerEntitySelection) => void;
		readonly onInspect?: (selection: ExplorerEntitySelection) => void;
	}

	let { entities, selected, possessed, select, onInspect }: Props = $props();
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
	{@const rowSelection = explorerEntitySelection(entity)}
	<div
		class="entity-row"
		class:selected={isSelected(entity)}
		class:possessed={isPossessed(entity)}
	>
		<button
			type="button"
			class="ui-catalog-trigger entity-trigger"
			aria-pressed={isSelected(entity)}
			onclick={() => select(rowSelection)}
			ondblclick={() => {
				select(rowSelection);
				onInspect?.(rowSelection);
			}}
			oncontextmenu={(event) => {
				if (onInspect === undefined) return;
				event.preventDefault();
				select(rowSelection);
				onInspect(rowSelection);
			}}
		>
			<span class="entity-heading">
				<strong>{entity.display.name}</strong>
				<span>WCID {entity.identity.wcid}</span>
			</span>
			<span class="entity-detail">
				{formatGuid(entity.identity.guid)}
				{#if isPossessed(entity)}
					<span class="possession-label"> · possessed</span>
				{/if}
				· {detail}
			</span>
		</button>
		{#if onInspect !== undefined}
			<button
				type="button"
				class="ui-catalog-trigger entity-inspect-button"
				title={`Inspect ${entity.display.name}`}
				aria-label={`Inspect ${entity.display.name}`}
				onclick={() => {
					select(rowSelection);
					onInspect(rowSelection);
				}}
			>
				<ExamineIcon />
			</button>
		{/if}
	</div>
{/snippet}

{#if entities.length === 0}
	<p class="entity-note">No Explorer-spawned entities.</p>
{:else}
	<ul class="entity-list">
		{#each tree.roots as root (`${root.entity.identity.guid}-${root.entity.generation}`)}
			<li class="ui-catalog-row entity-node">
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
		<ul class="entity-list orphan-list">
			{#each tree.orphans as orphan (`${orphan.identity.guid}-${orphan.generation}`)}
				<li class="ui-catalog-row entity-node orphan">
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
	@layer components {
		.entity-note {
			margin: 0;
			color: var(--ui-color-muted);
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
		}

		.invalid {
			color: var(--ui-color-danger);
		}

		.entity-list {
			overflow: auto;
			margin: 0;
			padding: 0;
			list-style: none;
		}

		.entity-node,
		.entity-children,
		.entity-child {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
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
			top: 0;
			bottom: 0;
			left: 6px;
			border-left: 1px solid var(--ui-color-border);
		}

		.entity-child:last-child::before {
			bottom: auto;
			height: 50%;
		}

		.entity-child::after {
			content: "";
			position: absolute;
			top: 50%;
			left: 6px;
			width: 7px;
			border-top: 1px solid var(--ui-color-border);
		}

		.entity-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			min-width: 0;
		}

		.entity-row.selected {
			background: var(--ui-color-selection);
		}

		.entity-row.possessed {
			box-shadow: inset 3px 0 0 var(--ui-color-success);
		}

		.entity-trigger {
			display: grid;
			gap: 2px;
			min-width: 0;
			text-align: left;
		}

		.entity-inspect-button {
			display: grid;
			place-items: center;
			width: 28px;
			height: 28px;
			padding: 5px;
			color: var(--ui-color-muted);
		}

		.entity-inspect-button:hover {
			color: var(--ui-color-text);
		}

		.entity-inspect-button :global(svg) {
			width: 16px;
			height: 16px;
		}

		.possession-label {
			color: var(--ui-color-success);
			font-weight: 600;
		}

		.entity-heading {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 8px;
			align-items: baseline;
		}

		.entity-heading strong,
		.entity-heading span,
		.entity-detail {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.entity-heading span,
		.entity-detail {
			color: var(--ui-color-muted);
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
		}

		.orphan {
			border-color: var(--ui-color-danger);
		}

		.orphan-list {
			max-height: 150px;
		}
	}
</style>
