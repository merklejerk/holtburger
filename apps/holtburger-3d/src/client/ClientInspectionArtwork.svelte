<script lang="ts">
	import { onMount, tick } from "svelte";
	import UiIcon from "../app/UiIcon.svelte";
	import type {
		UiIconDisplay,
		UiIconRepository,
	} from "../app/ui-icon-repository";
	import { CLIENT_TUNING } from "./client-tuning";
	import type { ItemInspection } from "./client-object-inspection-contract";

	interface Props {
		readonly artwork: ItemInspection["artwork"];
		readonly icons: UiIconRepository | null;
		readonly name: string;
	}

	const { artwork, icons, name }: Props = $props();
	const authored = $derived(
		artwork.base !== null ||
			artwork.overlay !== null ||
			artwork.underlay !== null ||
			artwork.uiEffects !== 0,
	);
	let display = $state<UiIconDisplay | undefined>();

	onMount(() => {
		if (!authored || icons === null) return;
		const owner = icons.createOwner("display");
		const key = icons.retain(owner, {
			kind: "item",
			base: artwork.base,
			itemType: artwork.itemType,
			overlay: artwork.overlay,
			underlay: artwork.underlay,
			uiEffects: artwork.uiEffects,
		});
		const refresh = () => (display = icons.read(key));
		refresh();
		const timer = window.setInterval(
			refresh,
			CLIENT_TUNING.inventory.displayIntervalMs,
		);
		return () => {
			window.clearInterval(timer);
			void tick().then(() => icons.releaseOwner(owner));
		};
	});

	const issue = $derived(
		display?.kind === "failed" || display?.kind === "degraded"
			? display.issues.map(({ detail }) => detail).join(" ")
			: null,
	);
</script>

<div class="inspection-artwork" aria-label={`${name} artwork`}>
	{#if authored && icons !== null}
		<div class="inspection-artwork-image">
			<UiIcon {display} {name} tooltipLabel={`${name} artwork`} />
		</div>
		{#if issue !== null}
			<p
				class:inspection-warning={display?.kind === "degraded"}
				class="inspection-diagnostic"
			>
				{display?.kind === "failed"
					? "Artwork unavailable"
					: "Artwork incomplete"}: {issue}
			</p>
		{/if}
	{:else if !authored}
		<div
			class="inspection-artwork-image inspection-artwork-empty"
			aria-hidden="true"
		>
			?
		</div>
		<p class="inspection-diagnostic">No item artwork was disclosed.</p>
	{:else}
		<div
			class="inspection-artwork-image inspection-artwork-empty"
			aria-hidden="true"
		>
			?
		</div>
		<p class="inspection-diagnostic">Artwork service is unavailable.</p>
	{/if}
</div>
