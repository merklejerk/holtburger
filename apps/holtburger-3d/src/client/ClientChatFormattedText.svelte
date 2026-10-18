<script lang="ts">
	import type { ClientChatTextRow } from "./client-chat-policy";
	import ClientWaypointText from "./ClientWaypointText.svelte";
	import type { MapWaypointTarget } from "../lib/game/map/map-waypoint";

	interface Props {
		/** App-authored rows belonging to the containing message's single timestamp. */
		readonly rows: readonly ClientChatTextRow[];
		/** Coordinate links follow the containing chat buffer's interaction mode. */
		readonly interactive: boolean;
		/** Reuse the ordinary chat waypoint action. */
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
	}
	const { rows, interactive, onSetWaypoint }: Props = $props();
</script>

{#snippet text(value: string)}
	{#if interactive}<ClientWaypointText
			text={value}
			{onSetWaypoint}
		/>{:else}{value}{/if}
{/snippet}

{#each rows as row}
	<span class="chat-row" class:indented={row.indented}>
		{#each row.spans as span}{#if span.kind === "code"}<code class="ui-mono"
					>{@render text(span.text)}</code
				>{:else if span.kind === "emphasis"}<em>{@render text(span.text)}</em
				>{:else}{@render text(span.text)}{/if}{/each}
	</span>
{/each}

<style>
	.chat-row {
		display: block;
	}
	.chat-row:first-child:not(.indented) {
		display: inline;
	}
	.indented {
		padding-inline-start: 1.25em;
	}
	code {
		font-size: inherit;
	}
</style>
