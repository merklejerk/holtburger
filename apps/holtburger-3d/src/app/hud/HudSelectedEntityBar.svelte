<script module lang="ts">
	export interface HudSelectedEntityAction {
		readonly action: string;
		readonly label: string;
		readonly description?: string;
		readonly disabled?: boolean;
		readonly activate: (source: HTMLButtonElement) => void;
	}
</script>

<script lang="ts" generics="T extends HudSelectedEntityAction">
	import type { Snippet } from "svelte";
	import ExamineIcon from "../../assets/icons/hud-examine.svg?component";
	import MoreActionsIcon from "../../assets/icons/hud-more-actions.svg?component";
	import PopupMenu from "../ui/PopupMenu.svelte";
	import { hudAttention } from "./hud-attention";

	interface Props {
		readonly selectedKey: string | number | null;
		readonly displayName: string;
		readonly nameColor?: string | null;
		readonly actions: readonly T[];
		readonly examineLabel: string;
		readonly examineTitle: string;
		readonly examineDisabled?: boolean;
		readonly examinePending?: boolean;
		readonly onExamine: () => void;
		readonly actionIcon?: Snippet<[T]>;
		readonly footer?: Snippet;
	}

	const {
		selectedKey,
		displayName,
		nameColor = null,
		actions,
		examineLabel,
		examineTitle,
		examineDisabled = false,
		examinePending = false,
		onExamine,
		actionIcon,
		footer,
	}: Props = $props();

	let menuAnchor = $state<HTMLButtonElement | null>(null);

	const useActionMenu = $derived(
		actions.length > 1 || (actions.length === 1 && actionIcon === undefined),
	);
	const singleAction = $derived(
		actions.length === 1 && actionIcon !== undefined ? actions[0] : undefined,
	);

	$effect(() => {
		void selectedKey;
		menuAnchor = null;
	});

	$effect(() => {
		if (!useActionMenu) menuAnchor = null;
	});

	function selectMenuAction(
		source: HTMLButtonElement,
	): (actionId: string) => void {
		return (actionId) => {
			actions
				.find((candidate) => candidate.action === actionId)
				?.activate(source);
		};
	}
</script>

<section
	class="selected-entity"
	aria-label={`Selected entity: ${displayName}`}
	use:hudAttention={selectedKey}
>
	<div class="selected-entity__heading ui-hud-group">
		{#if useActionMenu}
			<button
				class="ui-hud-button ui-icon-button"
				type="button"
				aria-label="Selected entity actions"
				title="Selected entity actions"
				aria-haspopup="menu"
				aria-expanded={menuAnchor !== null}
				onclick={(event) => {
					menuAnchor = menuAnchor === null ? event.currentTarget : null;
				}}><MoreActionsIcon /></button
			>
		{:else if singleAction !== undefined && actionIcon !== undefined}
			<button
				class="ui-hud-button ui-icon-button"
				type="button"
				disabled={singleAction.disabled === true}
				aria-label={singleAction.label}
				title={singleAction.description ?? singleAction.label}
				onclick={(event) => singleAction.activate(event.currentTarget)}
				>{@render actionIcon(singleAction)}</button
			>
		{/if}
		<strong title={displayName} style:color={nameColor ?? undefined}
			><span>{displayName}</span></strong
		>
		<button
			class="ui-hud-button ui-icon-button"
			type="button"
			disabled={examineDisabled || examinePending}
			onclick={onExamine}
			aria-label={examineLabel}
			title={examineTitle}
			aria-busy={examinePending}
		>
			<ExamineIcon />
		</button>
	</div>
	{#if footer !== undefined}
		{@render footer()}
	{/if}
</section>

{#if menuAnchor !== null && useActionMenu}
	{@const source = menuAnchor}
	<PopupMenu
		anchor={source}
		label="Selected entity actions"
		items={actions.map((action) => ({
			...action,
			label: action.description ?? action.label,
			disabled: action.disabled === true,
		}))}
		onselect={selectMenuAction(source)}
		onclose={() => {
			menuAnchor = null;
		}}
	>
		{#snippet icon(item)}
			{#if actionIcon !== undefined}
				{@const original = actions.find((a) => a.action === item.action)}
				{#if original !== undefined}{@render actionIcon(original)}{/if}
			{/if}
		{/snippet}
	</PopupMenu>
{/if}

<style>
	@layer components {
		.selected-entity {
			/* Scale the shared pulse's growth down for this wider surface. */
			--ui-hud-pulse-intensity: var(--ui-selected-entity-pulse-intensity);
			/* Header priority stays local to this HUD. */
			isolation: isolate;
			/* One dimension keeps header controls and their reserved grid column aligned. */
			--selected-action-size: 32px;
			display: grid;
			box-sizing: border-box;
			width: 100%;
			height: 100%;
			grid-template-rows: auto 5px;
			align-content: start;
			gap: 3px;
		}
		.selected-entity__heading {
			/* Header controls and their painted edges must stay above the following footer row. */
			z-index: 1;
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) var(--selected-action-size);
			min-height: var(--selected-action-size);
			gap: 4px;
			align-items: center;
		}
		.selected-entity__heading strong {
			/* Keep the name centered when no left-side action is available. */
			grid-column: 2;
			font-weight: 600;
			font-size: calc(var(--ui-font-size-heading-2) * var(--ui-text-scale));
			line-height: 1.25;
			text-align: center;
			white-space: nowrap;
			min-width: 0;
		}
		.selected-entity__heading strong span {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.selected-entity__heading button {
			display: grid;
			width: var(--selected-action-size);
			height: var(--selected-action-size);
			padding: 6px;
			place-items: center;
			pointer-events: auto;
		}
		.selected-entity__heading button :global(svg) {
			width: 20px;
			height: 20px;
		}
	}
</style>
