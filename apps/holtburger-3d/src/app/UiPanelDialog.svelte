<script lang="ts">
	import type { Snippet } from "svelte";
	import { dismissDialogOnBackdrop } from "./dialog-backdrop-dismiss";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";

	interface Props {
		/** Accessible name; the feature owns its visible heading and fields. */
		readonly title: string;
		/** Feature hooks for dialog and backdrop diagnostics. */
		readonly className: string;
		readonly overlayClassName: string;
		/** Feature-owned form, initial field focus, and submission policy. */
		readonly children: Snippet;
		/** Escape and backdrop clicks cancel the same local operation. */
		readonly onCancel: () => void;
	}
	const { title, className, overlayClassName, children, onCancel }: Props =
		$props();
	const { keyboard } = useAppInputPolicy();
	let dialog: HTMLDialogElement;

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			onCancel();
		} else if (event.key === "Tab") {
			event.preventDefault();
			const controls = [
				...dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
					"input:not(:disabled), button:not(:disabled)",
				),
			];
			const current = controls.findIndex(
				(control) => control === document.activeElement,
			);
			const next =
				(current + (event.shiftKey ? -1 : 1) + controls.length) %
				controls.length;
			controls[next]?.focus();
		} else if (
			(event.key === "Enter" || event.key === " ") &&
			event.target instanceof HTMLButtonElement
		) {
			event.preventDefault();
			if (!event.repeat) event.target.click();
		}
	}
</script>

<div
	class={`panel-dialog-overlay ui-dialog-backdrop ${overlayClassName}`}
	use:dismissDialogOnBackdrop={onCancel}
>
	<dialog
		open
		bind:this={dialog}
		class={`panel-dialog ui-overlay-surface ${className}`}
		aria-label={title}
		use:keyboard.scope={{ nativeControls: true, keydown: handleKeydown }}
	>
		{@render children()}
	</dialog>
</div>

<style>
	@layer components {
		.panel-dialog-overlay {
			position: absolute;
			inset: 0;
			z-index: 5;
			display: grid;
			place-items: center;
			pointer-events: auto;
		}
		.panel-dialog {
			position: relative;
			margin: 8px;
			/* The form owns the inset; native dialog padding would double it. */
			padding: 0;
			max-width: calc(100% - 16px);
		}
		.panel-dialog :global(form) {
			display: grid;
			gap: var(--ui-overlay-gap);
			padding: var(--ui-dialog-padding, var(--ui-overlay-padding));
		}
		.panel-dialog :global(.ui-dialog-actions) {
			display: flex;
			justify-content: end;
			gap: var(--ui-overlay-gap);
		}
	}
</style>
