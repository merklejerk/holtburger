<script lang="ts" generics="Value extends string">
	import type { Snippet } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	interface Props {
		/** Accessible name for this group of tabs. */
		readonly label: string;
		/** Feature-owned values and explicit links to feature-owned content panels. */
		readonly tabs: readonly {
			/** Domain value passed back when this tab is activated. */
			readonly value: Value;
			/** Visible tab caption. */
			readonly label: string;
			/** Unique tab element ID, referenced by the content's aria-labelledby. */
			readonly id: string;
			/** Content element ID referenced by this tab's aria-controls. */
			readonly panelId: string;
			/** Unimplemented or unavailable domains remain visible but cannot be selected. */
			readonly disabled?: boolean;
		}[];
		/** The feature owns selection and content lifetime. */
		readonly selected: Value;
		/** Vertical workflows use Up/Down; ordinary panel tabs use Left/Right. */
		readonly orientation?: "horizontal" | "vertical";
		/** Optional feature-owned artwork or other label content, retaining shared tab behavior. */
		readonly tabLabel?: Snippet<[Value, string]>;
		/** Both clicks and keyboard navigation use the same feature selection policy. */
		readonly onSelect: (value: Value) => void;
	}
	const {
		label,
		tabs,
		selected,
		onSelect,
		orientation = "horizontal",
		tabLabel,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	function navigate(event: KeyboardEvent): void {
		if (!(event.target instanceof HTMLButtonElement)) return;
		const focusedId = event.target.id;
		const enabled = tabs.filter((tab) => !tab.disabled);
		const index = enabled.findIndex((tab) => tab.id === focusedId);
		if (index === -1) return;
		let destination: number;
		if (
			(orientation === "vertical" &&
				(event.key === "ArrowLeft" || event.key === "ArrowRight")) ||
			(orientation === "horizontal" &&
				(event.key === "ArrowUp" || event.key === "ArrowDown"))
		)
			return;
		switch (event.key) {
			case "ArrowLeft":
			case "ArrowUp":
				destination = (index + enabled.length - 1) % enabled.length;
				break;
			case "ArrowRight":
			case "ArrowDown":
				destination = (index + 1) % enabled.length;
				break;
			case "Home":
				destination = 0;
				break;
			case "End":
				destination = enabled.length - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		const tab = enabled[destination];
		onSelect(tab.value);
		document.getElementById(tab.id)?.focus();
	}
</script>

<div
	class="ui-tabs ui-panel-tabs"
	role="tablist"
	aria-label={label}
	aria-orientation={orientation}
	use:keyboard.scope={{ nativeControls: true, keydown: navigate }}
>
	{#each tabs as tab (tab.value)}
		<button
			class="ui-tab"
			type="button"
			role="tab"
			id={tab.id}
			aria-controls={tab.panelId}
			aria-selected={selected === tab.value}
			tabindex={!tab.disabled && selected === tab.value ? 0 : -1}
			disabled={tab.disabled}
			onclick={() => onSelect(tab.value)}
			>{#if tabLabel}{@render tabLabel(
					tab.value,
					tab.label,
				)}{:else}{tab.label}{/if}</button
		>
	{/each}
</div>
