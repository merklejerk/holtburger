<script lang="ts">
	import UiIcon from "../app/UiIcon.svelte";
	import type { StatTarget } from "./client-character-sheet-contract";
	import { useStatIcons, type StatIconKind } from "./client-stat-artwork";
	const {
		target,
	}: {
		/** Use canonical progression identity or the creator's explicit category and allocation index. */
		readonly target:
			StatTarget | { readonly kind: StatIconKind; readonly id: number };
	} = $props();
	const icons = useStatIcons();
	const display = $derived(
		"kind" in target
			? icons.creation(target.kind, target.id)
			: icons.read(target),
	);
</script>

<span
	class="stat-icon"
	data-stat-icon={JSON.stringify(target)}
	aria-hidden="true"><UiIcon {display} /></span
>

<style>
	@layer components {
		.stat-icon {
			/* Retail stat artwork is 20–25px and needs smooth scaling at larger display sizes. */
			--ui-icon-rendering: auto;
			display: inline-block;
			vertical-align: middle;
			width: var(--ui-stat-icon-size);
			height: var(--ui-stat-icon-size);
			flex: none;
			border-radius: 50%;
			overflow: hidden;
			margin-inline-end: var(--ui-list-icon-gap);
		}
	}
</style>
