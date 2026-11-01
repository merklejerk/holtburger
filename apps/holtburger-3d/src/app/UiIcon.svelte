<script lang="ts">
	import ArtworkLoading from "../assets/icons/artwork-loading.svg?component";
	import ArtworkUnavailable from "../assets/icons/artwork-unavailable.svg?component";
	import type { UiIconDisplay } from "./ui-icon-repository";
	interface Props {
		/** Decorative artwork; the enclosing feature owns identity and actions in every state. */
		readonly display: UiIconDisplay | undefined;
	}
	const { display }: Props = $props();
</script>

{#if display?.kind === "ready" || display?.kind === "degraded"}
	<img
		class="ui-icon"
		data-drag-artwork
		src={display.url}
		alt=""
		draggable="false"
	/>
{:else}
	<span
		class="ui-icon-placeholder"
		data-drag-artwork
		data-artwork-state={display?.kind === "failed" ? "failed" : "loading"}
		aria-hidden="true"
	>
		{#if display?.kind === "failed"}<ArtworkUnavailable />{:else}<ArtworkLoading
			/>{/if}
	</span>
{/if}

<style>
	@layer components {
		.ui-icon,
		.ui-icon-placeholder {
			display: block;
			width: 100%;
			height: 100%;
			min-width: 0;
			min-height: 0;
			object-fit: contain;
		}
		.ui-icon {
			image-rendering: var(--ui-icon-rendering);
		}
		.ui-icon-placeholder {
			color: var(--ui-color-muted);
		}
		.ui-icon-placeholder :global(svg) {
			display: block;
			width: 100%;
			height: 100%;
		}
	}
</style>
