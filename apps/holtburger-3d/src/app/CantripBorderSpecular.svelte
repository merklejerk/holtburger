<script lang="ts">
	import type { RankedCantripTier } from "./item-cantrips";

	interface Props {
		/** Resolved cantrip tier for the enclosing item cell; mounts only for legendary items. */
		readonly tier: RankedCantripTier | undefined;
	}
	const { tier }: Props = $props();
</script>

{#if tier === "legendary"}
	<span class="ui-cantrip-specular" aria-hidden="true"></span>
{/if}
