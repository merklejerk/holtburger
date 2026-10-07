<script lang="ts">
	import type { Snippet } from "svelte";
	import { dismissDialogOnBackdrop } from "./dialog-backdrop-dismiss";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	interface Props {
		/** Visible accessible heading for this modal. */
		readonly title: string;
		/** Feature hook for focused diagnostics and body styling. */
		readonly className: string;
		/** Body and actions remain owned by the feature. */
		readonly children: Snippet;
		/** Escape and optional backdrop dismissal share the feature cancellation policy. */
		readonly onCancel: () => void;
		/** Outside clicks cancel by default; opt out while an answer is already being submitted. */
		readonly dismissOnBackdrop?: boolean;
		/** Optional explanatory body used by screen readers. */
		readonly describedBy?: string;
	}
	const {
		title,
		className,
		children,
		onCancel,
		dismissOnBackdrop = true,
		describedBy,
	}: Props = $props();
	const id = $props.id();
	const headingId = `${id}-title`;
	const { keyboard } = useAppInputPolicy();
</script>

<dialog
	use:keyboard.modal
	use:dismissDialogOnBackdrop={() => {
		if (dismissOnBackdrop) onCancel();
	}}
	class={`ui-dialog ui-panel ${className}`}
	tabindex="-1"
	aria-labelledby={headingId}
	aria-describedby={describedBy}
	oncancel={(event) => {
		event.preventDefault();
		onCancel();
	}}
>
	<h2 id={headingId}>{title}</h2>
	{@render children()}
</dialog>

<style>
	@layer components {
		.ui-dialog {
			width: min(34rem, calc(100vw - 2rem));
			max-height: calc(100vh - 2rem);
			box-sizing: border-box;
			overflow: auto;
			padding: 1.25rem;
			color: var(--ui-color-text);
		}
		.ui-dialog::backdrop {
			background: rgb(0 0 0 / 55%);
		}
		.ui-dialog :global(.ui-dialog-actions) {
			display: flex;
			justify-content: flex-end;
			gap: 0.75rem;
		}
		h2 {
			margin-top: 0;
			font-size: 1.1rem;
		}
	}
</style>
