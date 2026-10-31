<script module lang="ts">
	import type { UiIconSpec } from "../app/ui-icon-source";

	/** Consumer-selected icon recipe or an explicit reason no recipe is available. */
	export type InspectionArtwork =
		| { readonly kind: "ready"; readonly spec: UiIconSpec }
		| { readonly kind: "failed"; readonly detail: string };
</script>

<script lang="ts">
	import { tick } from "svelte";
	import UiIcon from "../app/UiIcon.svelte";
	import type {
		UiIconDisplay,
		UiIconRepository,
	} from "../app/ui-icon-repository";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		/** The item or spell view owns which recipe, or unavailable reason, to present. */
		readonly artwork: InspectionArtwork;
		/** Shared repository; this mounted display owns only its own lease. */
		readonly icons: UiIconRepository | null;
		/** Accessible artwork identity, independent of preparation success. */
		readonly name: string;
	}
	const { artwork, icons, name }: Props = $props();
	let display = $state<UiIconDisplay | undefined>();
	$effect(() => {
		const repository = icons;
		const source = artwork;
		display = undefined;
		if (source.kind !== "ready" || repository === null) return;
		const owner = repository.createOwner("display");
		const key = repository.retain(owner, source.spec);
		const refresh = () => {
			display = repository.read(key);
		};
		refresh();
		const timer = window.setInterval(
			refresh,
			CLIENT_TUNING.inventory.displayIntervalMs,
		);
		return () => {
			window.clearInterval(timer);
			void tick().then(() => repository.releaseOwner(owner));
		};
	});

	const issue = $derived(
		display?.kind === "failed" || display?.kind === "degraded"
			? display.issues.map(({ detail }) => detail).join(" ")
			: null,
	);
</script>

<div class="inspection-artwork" aria-label={`${name} artwork`}>
	{#if artwork.kind === "ready" && icons !== null}
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
	{:else if artwork.kind === "failed"}
		<div
			class="inspection-artwork-image inspection-artwork-empty"
			aria-hidden="true"
		>
			?
		</div>
		<p class="inspection-diagnostic">{artwork.detail}</p>
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
