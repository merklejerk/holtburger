<script lang="ts">
	import type { EntryParam } from "./entry-params";

	interface Props {
		/** Short route label shown above the title. */
		eyebrow: string;
		/** Primary page title for this entrypoint. */
		title: string;
		/** Concise route purpose text. */
		summary: string;
		/** Parsed launch parameters for this entrypoint. */
		params: readonly EntryParam[];
	}

	let { eyebrow, title, summary, params }: Props = $props();
</script>

<main class="ac-screen" aria-label={title}>
	<section class="ac-panel ac-route-panel">
		<header class="ac-titlebar">
			<span>{eyebrow}</span>
		</header>

		<div class="ac-panel-body">
			<p class="ac-section-label">General Options</p>
			<h1>{title}</h1>
			<p class="ac-summary">{summary}</p>
		</div>
	</section>

	{#if params.length > 0}
		<section class="ac-panel ac-param-panel" aria-label="Launch parameters">
			<header class="ac-titlebar">
				<span>Launch Parameters</span>
			</header>

			{#each params as param}
				<div class="ac-param-row">
					<span class="ac-param-key">
						<i aria-hidden="true"></i>
						{param.key}
					</span>
					<code>{param.value}</code>
				</div>
			{/each}
		</section>
	{/if}
</main>
