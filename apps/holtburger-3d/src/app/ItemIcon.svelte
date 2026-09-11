<script lang="ts">
	import type { ItemIconDisplay } from "./item-icon-repository";
	interface Props {
		/** Decorative art; the enclosing actionable cell owns its accessible name. */
		readonly display: ItemIconDisplay | undefined;
		/** Visible fallback while unavailable, without disabling selection or actions. */
		readonly name: string;
		/** Full cell label, including quantity, retained when diagnostics override its tooltip. */
		readonly tooltipLabel: string;
	}
	const { display, name, tooltipLabel }: Props = $props();
	const diagnosticTitle = $derived(
		display?.kind === "failed" || display?.kind === "degraded"
			? `${tooltipLabel}\n${display.issues.map((issue) => `${issue.code}: ${issue.detail}`).join("\n")}`
			: undefined,
	);
</script>

{#if display?.kind === "ready" || display?.kind === "degraded"}
	<img
		class="item-icon"
		src={display.url}
		alt=""
		draggable="false"
		title={diagnosticTitle}
	/>
{:else}
	<span class="item-icon-fallback" title={diagnosticTitle}>{name}</span>
{/if}

<style>
	@layer components {
		.item-icon {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: contain;
			image-rendering: var(--ui-item-icon-rendering);
		}
		.item-icon-fallback {
			display: block;
			min-width: 0;
			max-width: 100%;
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
		}
	}
</style>
