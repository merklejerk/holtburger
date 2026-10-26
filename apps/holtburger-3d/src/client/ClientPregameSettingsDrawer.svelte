<script lang="ts">
	import type { Snippet } from "svelte";
	import type { TransitionConfig } from "svelte/transition";
	import { cubicOut } from "svelte/easing";
	import { dismissDialogOnBackdrop } from "../app/dialog-backdrop-dismiss";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";

	interface Props {
		/** Settings controls supplied by the client preference owner. */
		readonly children: Snippet;
		readonly onClose: () => void;
	}
	const { children, onClose }: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const id = $props.id();
	/** Animate relative to the drawer width and respect the operating system's motion preference. */
	function reveal(_element: HTMLElement): TransitionConfig {
		return {
			duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? 0
				: 220,
			easing: cubicOut,
			css: (t) => `transform: translateX(${(1 - t) * 100}%);`,
		};
	}
</script>

<!-- A native modal shares app focus/keyboard ownership; its edge layout needs a dedicated shell. -->
<dialog
	class="pregame-settings-drawer"
	aria-labelledby={`${id}-title`}
	tabindex="-1"
	use:keyboard.modal
	use:dismissDialogOnBackdrop={onClose}
	oncancel={(event) => {
		event.preventDefault();
		onClose();
	}}
	transition:reveal
>
	<header class="pregame-settings-heading">
		<h2 id={`${id}-title`}>Settings</h2>
		<button type="button" class="ui-button pregame-quiet" onclick={onClose}
			>Close</button
		>
	</header>
	{@render children()}
</dialog>

<style>
	@layer components {
		.pregame-settings-drawer {
			position: fixed;
			inset: 0 0 0 auto;
			margin: 0;
			width: min(30rem, 100vw);
			max-width: 100vw;
			height: 100dvh;
			max-height: 100dvh;
			padding: 0;
			box-sizing: border-box;
			overflow: hidden;
			border: 0;
			border-left: 1px solid;
			/* The modal shell receives initial focus; controls retain their own focus cues. */
			outline: none;
		}
		.pregame-settings-drawer[open] {
			display: grid;
			grid-template-rows: auto minmax(0, 1fr);
		}
		.pregame-settings-heading {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 16px;
			padding: 16px 24px;
		}
		.pregame-settings-heading h2 {
			margin: 0;
		}
	}
</style>
