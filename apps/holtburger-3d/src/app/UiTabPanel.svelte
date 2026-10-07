<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		/** Content ID linked from its tab's aria-controls. */
		readonly id: string;
		/** Tab ID providing this panel's accessible name. */
		readonly labelledBy: string;
		/** Selection affects visibility, never content lifetime. */
		readonly active: boolean;
		/** Canvas and nested scroll layouts own their overflow explicitly. */
		readonly scroll?: boolean;
		/** Feature content remains mounted across tab switches. */
		readonly children: Snippet;
	}
	const { id, labelledBy, active, scroll = true, children }: Props = $props();
</script>

<div
	class="tab-panel"
	class:scroll
	{id}
	role="tabpanel"
	aria-labelledby={labelledBy}
	hidden={!active}
	inert={!active}
>
	{@render children()}
</div>

<style>
	@layer components {
		.tab-panel {
			min-width: 0;
			min-height: 0;
			overflow: hidden;
		}
		.tab-panel.scroll {
			overflow: auto;
		}
		.tab-panel[hidden] {
			display: none;
		}
	}
</style>
