<script lang="ts">
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { mountUiTooltip } from "./ui-tooltip-dom";
	interface Props {
		/** The themed frontend boundary whose explicitly marked cells participate. */
		readonly root: HTMLElement;
	}
	const { root }: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const id = $props.id();
	$effect(() => {
		// This surface moves into the target's modal to escape implicit inertness.
		// Its imperative owner, rather than Svelte's template, owns that DOM lifetime.
		const surface = root.ownerDocument.createElement("div");
		surface.id = id;
		surface.className = "cell-tooltip ui-tooltip ui-scale-surface";
		surface.setAttribute("popover", "manual");
		surface.setAttribute("role", "tooltip");
		root.append(surface);
		const retire = mountUiTooltip(root, surface, keyboard);
		return () => {
			retire();
			surface.remove();
		};
	});
</script>

<style>
	@layer components {
		:global(.cell-tooltip) {
			position: fixed;
			inset: auto;
			margin: 0;
			width: max-content;
			max-width: min(360px, calc(var(--ui-viewport-width) - 16px));
			max-height: calc(var(--ui-viewport-height) - 16px);
			overflow: hidden;
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}
	}
</style>
