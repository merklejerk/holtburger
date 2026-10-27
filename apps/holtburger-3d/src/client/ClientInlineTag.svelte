<script lang="ts">
	interface Props {
		/** Feature-specific class used to identify the entity or coordinate reference. */
		readonly class: string;
		/** Literal text participates in ordinary inline wrapping in both interaction modes. */
		readonly text: string;
		/** Accessible action description while the containing surface admits interaction. */
		readonly label: string;
		/** Inactive tags remain plain text without keyboard or pointer actions. */
		readonly interactive: boolean;
		/** Feature owners retain target admission, mutations, and refusal feedback. */
		readonly onActivate: () => void;
	}
	const {
		class: tagClass,
		text,
		label,
		interactive,
		onActivate,
	}: Props = $props();
	/** Space belongs to the pressed element; blur or replacing an inactive tag cancels it. */
	let spacePressed: HTMLSpanElement | null = null;

	function click(event: MouseEvent & { currentTarget: HTMLSpanElement }): void {
		const selection = document.getSelection();
		// A native text-selection drag can end in a pointer click.
		if (
			event.detail > 0 &&
			selection !== null &&
			!selection.isCollapsed &&
			selection.containsNode(event.currentTarget, true)
		)
			return;
		onActivate();
	}

	function keydown(
		event: KeyboardEvent & { currentTarget: HTMLSpanElement },
	): void {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		if (event.repeat) return;
		if (event.key === "Enter") onActivate();
		else spacePressed = event.currentTarget;
	}

	function keyup(
		event: KeyboardEvent & { currentTarget: HTMLSpanElement },
	): void {
		if (event.key !== " ") return;
		event.preventDefault();
		if (spacePressed !== event.currentTarget) return;
		spacePressed = null;
		onActivate();
	}
</script>

{#if interactive}
	<span
		class={`ui-inline-tag ${tagClass}`}
		role="button"
		tabindex="0"
		title={label}
		aria-label={label}
		onclick={click}
		onkeydown={keydown}
		onkeyup={keyup}
		onblur={() => {
			spacePressed = null;
		}}>{text}</span
	>
{:else}<span class={`ui-inline-tag ${tagClass}`}>{text}</span>{/if}
