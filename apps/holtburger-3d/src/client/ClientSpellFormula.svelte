<script lang="ts">
	import { onMount, tick } from "svelte";
	import UiIcon from "../app/UiIcon.svelte";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { ClientSpellServices } from "./client-spells";
	import type { SpellComponentReference } from "../app/spell-references";
	import { CLIENT_TUNING } from "./client-tuning";

	const {
		spells,
		spellId,
		components,
	}: {
		readonly spells: ClientSpellServices;
		readonly spellId: number;
		readonly components: readonly number[];
	} = $props();
	/** Ordered slots retain duplicates; image displays are sampled at the shared icon cadence. */
	let rows = $state<
		readonly { reference: SpellComponentReference; key: string | null }[]
	>([]);
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());
	let failure = $state<string | null>(null);
	let loaded = $state(false);
	onMount(() => {
		let disposed = false;
		const owner = spells.icons.createOwner("display");
		let revision = -1;
		const sample = () => {
			if (revision === spells.icons.revision) return;
			revision = spells.icons.revision;
			displays = new Map(
				rows.flatMap((row) =>
					row.key === null
						? []
						: [[row.key, spells.icons.read(row.key)] as const],
				),
			);
		};
		void spells
			.components(
				spellId,
				components.filter((id) => id !== 0),
			)
			.then((references) => {
				if (disposed) return;
				rows = references.map((reference) => ({
					reference,
					key:
						reference.artwork.kind === "ready"
							? spells.icons.retain(owner, reference.artwork.spec)
							: null,
				}));
				loaded = true;
				revision = -1;
				sample();
			})
			.catch((error: unknown) => {
				if (!disposed)
					failure = error instanceof Error ? error.message : String(error);
			});
		const timer = setInterval(
			sample,
			CLIENT_TUNING.spells.iconDisplayIntervalMs,
		);
		return () => {
			disposed = true;
			clearInterval(timer);
			void tick().then(() => spells.icons.releaseOwner(owner));
		};
	});
</script>

<section aria-label="Spell formula">
	{#if failure !== null}<p>{failure}</p>
	{:else if !loaded}<p>Loading components…</p>
	{:else if rows.length > 0}
		<h3>Components</h3>
		<ul>
			{#each rows as row}
				<li>
					<span class="component-icon">
						{#if row.key !== null}
							<UiIcon
								display={displays.get(row.key)}
								name="…"
								tooltipLabel={row.reference.name}
							/>
						{:else}<span title={row.reference.name}>?</span>{/if}
					</span>
					<span
						>{row.reference
							.name}{#if row.reference.artwork.kind === "failed"}<small
								>{row.reference.artwork.detail}</small
							>{/if}</span
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	@layer components {
		ul {
			list-style: none;
			padding: 0;
			margin: 0;
			display: grid;
			gap: var(--ui-spell-component-row-gap);
		}
		small {
			display: block;
		}
		section {
			border-top: 1px solid
				color-mix(in srgb, var(--ui-color-border) 30%, transparent);
			padding-top: 10px;
		}
		h3 {
			font: inherit;
			font-weight: 600;
			margin: 0 0 6px;
		}
		li {
			display: flex;
			align-items: center;
			gap: var(--ui-spell-component-label-gap);
		}
		.component-icon {
			flex: 0 0 var(--ui-spell-component-icon-size);
			width: var(--ui-spell-component-icon-size);
			height: var(--ui-spell-component-icon-size);
			display: grid;
			place-items: center;
		}
	}
</style>
