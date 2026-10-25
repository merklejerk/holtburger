<script lang="ts">
	import type { Snippet } from "svelte";
	import { dismissDialogOnBackdrop } from "./dialog-backdrop-dismiss";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	interface Props {
		/** Visible accessible heading for this modal. */
		readonly title: string;
		/** Selector inside the dialog to focus on opening; otherwise focus the dialog itself. */
		readonly initialFocus?: string;
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
		initialFocus,
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
	use:keyboard.modal={initialFocus}
	use:dismissDialogOnBackdrop={() => {
		if (dismissOnBackdrop) onCancel();
	}}
	class={`ui-dialog ui-overlay-surface ${className}`}
	tabindex="-1"
	aria-labelledby={headingId}
	aria-describedby={describedBy}
	oncancel={(event) => {
		event.preventDefault();
		onCancel();
	}}
>
	<header class="ui-frame">
		<h2 id={headingId}>{title}</h2>
	</header>
	<div class="ui-dialog-body ui-body">
		{@render children()}
	</div>
</dialog>

<style>
	@layer components {
		.ui-dialog {
			width: fit-content;
			min-width: min(18rem, calc(100vw - 2rem));
			max-width: min(34rem, calc(100vw - 2rem));
			max-height: calc(100vh - 2rem);
			box-sizing: border-box;
			overflow: auto;
			padding: 0;
		}
		.ui-dialog-body {
			/* The theme resets paragraph margins, so the shell owns separation. */
			display: grid;
			gap: var(--ui-overlay-gap);
			padding: var(--ui-dialog-padding, var(--ui-overlay-padding));
		}
		.ui-dialog:has(:global(input), :global(select)) {
			/* Editors keep a useful working width even before a draft or error exists. */
			min-width: min(22rem, calc(100vw - 2rem));
		}
		.ui-dialog :global(.ui-dialog-actions) {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			gap: var(--ui-overlay-gap);
			/* Separate the decision controls from prose and form fields. */
			margin-top: var(--ui-overlay-gap);
		}
		h2 {
			margin: 0;
			font: inherit;
		}
		.ui-dialog-body > :global(p) {
			margin: 0;
		}
	}
</style>
