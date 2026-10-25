<script lang="ts">
	import PopupMenu from "./PopupMenu.svelte";

	interface Props {
		/** Accessible control and menu name; numbered shades retain distinct labels. */
		readonly label: string;
		/** Host-resolved CSS colors in authored order. */
		readonly colors: readonly string[];
		/** Selected ordinal in the supplied palette. */
		readonly value: number;
		/** Retained panels dismiss transient menus when hidden. */
		readonly visible: boolean;
		/** Submission locks the control and closes its menu. */
		readonly disabled: boolean;
		/** The feature owner translates ordinals into its domain value. */
		readonly onchange: (index: number) => void;
	}
	let { label, colors, value, visible, disabled, onchange }: Props = $props();
	let open = $state(false);
	let button = $state<HTMLButtonElement>();
	const choices = $derived(
		colors.map((color, index) => ({
			action: String(index),
			label: `${label} ${index + 1}${index === value ? " (selected)" : ""}`,
			disabled: false,
			color,
		})),
	);
	$effect(() => {
		if (!visible || disabled) open = false;
	});
</script>

<button
	bind:this={button}
	type="button"
	class="ui-button ui-icon-button palette-dropdown"
	aria-label={`${label}: ${value + 1}`}
	title={`${label}: ${value + 1}`}
	aria-haspopup="menu"
	aria-expanded={open}
	{disabled}
	onclick={() => (open = !open)}
>
	<span
		class="palette-swatch"
		style:background-color={colors[value]}
		aria-hidden="true"
	></span>
</button>
{#if open && button}
	<PopupMenu
		anchor={button}
		{label}
		items={choices}
		layout="grid"
		onclose={() => (open = false)}
		onselect={(choice) => onchange(Number(choice))}
	>
		{#snippet icon(choice)}
			<span
				class="palette-swatch"
				class:selected={Number(choice.action) === value}
				style:background-color={choice.color}
				aria-hidden="true"
			></span>
		{/snippet}
	</PopupMenu>
{/if}

<style>
	@layer components {
		.palette-dropdown {
			width: calc(
				(var(--ui-menu-grid-icon-size) + 2 * var(--ui-menu-grid-padding)) *
					var(--ui-icon-scale)
			);
			height: calc(
				(var(--ui-menu-grid-icon-size) + 2 * var(--ui-menu-grid-padding)) *
					var(--ui-icon-scale)
			);
			justify-self: start;
		}
		.palette-dropdown > .palette-swatch {
			width: calc(var(--ui-menu-grid-icon-size) * var(--ui-icon-scale));
			height: calc(var(--ui-menu-grid-icon-size) * var(--ui-icon-scale));
		}
		.palette-swatch.selected {
			outline: 2px solid currentColor;
			outline-offset: 2px;
		}
		.palette-swatch {
			display: inline-block;
			width: calc(var(--ui-overlay-icon-size) * var(--ui-icon-scale));
			height: calc(var(--ui-overlay-icon-size) * var(--ui-icon-scale));
			border: 1px solid var(--ui-color-border);
			border-radius: 0;
			flex-shrink: 0;
		}
	}
</style>
