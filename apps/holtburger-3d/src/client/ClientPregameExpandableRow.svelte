<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		/** Feature hook for row identity and focused diagnostics. */
		readonly className: string;
		/** Compact native disclosure label; expansion does not activate adjacent actions. */
		readonly summary: Snippet;
		/** Independent controls beside the summary, such as skill actions or import selection. */
		readonly actions: Snippet;
		/** Expanded explanatory content, initially collapsed. */
		readonly children: Snippet;
	}
	const { className, summary, actions, children }: Props = $props();
</script>

<div class={`pregame-expandable-row ${className}`}>
	<details>
		<summary>{@render summary()}</summary>
		<div class="pregame-expandable-content">{@render children()}</div>
	</details>
	<div class="pregame-expandable-actions">{@render actions()}</div>
</div>

<style>
	@layer components {
		.pregame-expandable-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			column-gap: 12px;
		}
		details {
			min-width: 0;
		}
		summary {
			min-height: 36px;
			padding-block: 8px;
			overflow-wrap: anywhere;
			cursor: pointer;
		}
		.pregame-expandable-content {
			display: grid;
			gap: 8px;
			padding: 0 0 12px 14px;
		}
		.pregame-expandable-content :global(p) {
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}
		.pregame-expandable-actions {
			display: flex;
			align-self: start;
			align-items: center;
			gap: calc(8px * var(--ui-icon-scale));
			margin-block: 4px;
		}
	}
</style>
