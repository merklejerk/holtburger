<script lang="ts">
	import ClientLoadoutVisual from "./ClientLoadoutVisual.svelte";
	import PopupMenu from "../app/PopupMenu.svelte";
	import DropdownChevron from "../assets/icons/dropdown-chevron.svg?component";
	import {
		LOADOUT_ICONS,
		loadoutTooltip,
		type LoadoutActionContent,
	} from "./client-loadout";
	import type { ClientItemDrag } from "./client-item-drag";

	interface Props {
		/** Draft icon, owned by the builder. */
		icon: (typeof LOADOUT_ICONS)[number];
		/** A valid draft can be dragged; an incomplete draft can still choose its icon. */
		content: LoadoutActionContent | null;
		/** Shared gesture owner distinguishes placement drags from selector clicks. */
		owner: ClientItemDrag | null;
		/** Closing the retained builder dismisses its transient picker. */
		visible: boolean;
		/** Replace the builder's selected emoji. */
		onIconChange: (icon: (typeof LOADOUT_ICONS)[number]) => void;
		/** Successful action-cell placement closes the builder. */
		onPlaced: () => void;
	}
	let { icon, content, owner, visible, onIconChange, onPlaced }: Props =
		$props();
	let open = $state(false);
	let button = $state<HTMLButtonElement>();
	const choices = LOADOUT_ICONS.map((choice) => ({
		action: choice,
		label: choice,
		disabled: false,
	}));
	$effect(() => {
		if (!visible) open = false;
	});
	function register(node: HTMLButtonElement, drag: ClientItemDrag | null) {
		// Read the current draft without making draft edits own the gesture registration's lifetime.
		let dispose = drag?.registerBindingSource(
			node,
			() => content,
			() => onPlaced(),
		);
		return {
			update(next: ClientItemDrag | null) {
				dispose?.();
				dispose = next?.registerBindingSource(
					node,
					() => content,
					() => onPlaced(),
				);
			},
			destroy() {
				dispose?.();
			},
		};
	}
</script>

<button
	type="button"
	class="ui-shortcut-cell ui-hud-button loadout-icon-dropdown"
	data-loadout-result
	bind:this={button}
	use:register={owner}
	aria-label="Choose loadout badge"
	aria-haspopup="menu"
	aria-expanded={open}
	title={`Click to choose a badge. ${content === null ? "Include at least one slot to drag and save." : `Drag to an action cell to save.\n${loadoutTooltip(content)}`}`}
	onclick={() => (open = !open)}
>
	<span
		class="icon-preview"
		data-drag-preview
		data-draggable={content !== null && owner !== null}
		><ClientLoadoutVisual {icon} /></span
	>
	<span class="icon-disclosure"><DropdownChevron /></span>
</button>
{#if open && button}
	<PopupMenu
		anchor={button}
		label="Loadout badge"
		items={choices}
		layout="grid"
		onclose={() => (open = false)}
		onselect={onIconChange}
	/>
{/if}

<style>
	@layer components {
		/* This modifier owns geometry over shared cell defaults, regardless of stylesheet order. */
		.ui-shortcut-cell.loadout-icon-dropdown {
			display: flex;
			padding: 0;
			width: auto;
			height: var(--ui-item-cell-min-size);
			flex-shrink: 0;
		}
		.icon-preview {
			width: var(--ui-item-cell-min-size);
			height: 100%;
		}
		.icon-preview[data-draggable="true"] {
			cursor: grab;
		}
		.icon-disclosure {
			display: grid;
			place-items: center;
			width: 1.2rem;
			border-left: 1px solid var(--ui-color-border);
			cursor: pointer;
		}
	}
</style>
