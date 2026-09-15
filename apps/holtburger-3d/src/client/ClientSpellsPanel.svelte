<script lang="ts">
	import { onMount, tick } from "svelte";
	import UiIcon from "../app/UiIcon.svelte";
	import type { UiIconDisplay, UiIconOwner } from "../app/ui-icon-repository";
	import type { ClientSpellServices } from "./client-spells";
	import { CLIENT_TUNING } from "./client-tuning";

	/** A list row retains identity even when its definition or artwork is unavailable. */
	interface SpellRow {
		/** Stable player-known spell identity. */
		readonly id: number;
		/** Authored name or explicit missing-definition label. */
		readonly name: string;
		/** Consumer-owned icon reference or an actionable diagnostic. */
		readonly artwork:
			| { readonly kind: "icon"; readonly key: string }
			| { readonly kind: "failed"; readonly detail: string };
	}
	const { spells }: { readonly spells: ClientSpellServices } = $props();
	let rows = $state<readonly SpellRow[]>([]);
	let status = $state<"pending" | "loading" | "ready">("pending");
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());

	onMount(() => {
		let disposed = false;
		let generation = 0;
		let membership: readonly number[] | null = null;
		const owners = new Set<UiIconOwner>();
		let currentOwner: UiIconOwner | null = null;
		let revision = -1;
		const release = (owner: UiIconOwner) => {
			if (owners.delete(owner)) spells.icons.releaseOwner(owner);
		};
		const sample = () => {
			if (revision === spells.icons.revision) return;
			revision = spells.icons.revision;
			displays = new Map(
				rows.flatMap((row) =>
					row.artwork.kind === "icon"
						? [[row.artwork.key, spells.icons.read(row.artwork.key)] as const]
						: [],
				),
			);
		};
		const refresh = async () => {
			const ids = spells.session.state().knownSpells;
			if (ids === membership) return;
			membership = ids;
			const version = ++generation;
			rows = [];
			status = ids === null ? "pending" : "loading";
			const priorOwner = currentOwner;
			currentOwner = null;
			await tick();
			if (priorOwner !== null) release(priorOwner);
			if (ids === null || disposed || version !== generation) return;
			const references = await spells.load(ids);
			if (disposed || version !== generation) return;
			const owner = spells.icons.createOwner("display");
			owners.add(owner);
			currentOwner = owner;
			rows = references
				.map((reference): SpellRow => {
					if (reference.kind !== "known")
						return {
							id: reference.id,
							name: `Spell ${reference.id}`,
							artwork: {
								kind: "failed",
								detail:
									reference.kind === "missing"
										? "Spell definition is missing."
										: reference.detail,
							},
						};
					return {
						id: reference.id,
						name: reference.name,
						artwork:
							reference.artwork.kind === "ready"
								? {
										kind: "icon",
										key: spells.icons.retain(owner, reference.artwork.spec),
									}
								: reference.artwork,
					};
				})
				.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
			status = "ready";
			revision = -1;
			sample();
		};
		const update = () => {
			void refresh();
		};
		const unsubscribe = spells.session.subscribe((event) => {
			if (
				event.type === "spells" ||
				event.type === "current-state" ||
				event.type === "lifecycle" ||
				event.type === "resyncing"
			)
				update();
		});
		update();
		const timer = setInterval(
			sample,
			CLIENT_TUNING.spells.iconDisplayIntervalMs,
		);
		return () => {
			disposed = true;
			generation++;
			unsubscribe();
			clearInterval(timer);
			void tick().then(() => {
				for (const owner of owners) release(owner);
			});
		};
	});
</script>

<section class="spells-panel ui-body" aria-label="Known spells">
	{#if status !== "ready"}
		<p role="status">
			{status === "pending" ? "Waiting for spellbook…" : "Loading spells…"}
		</p>
	{:else if rows.length === 0}
		<p>No spells known.</p>
	{:else}
		<ul>
			{#each rows as row (row.id)}
				<li data-spell-id={row.id}>
					<span class="spell-icon">
						{#if row.artwork.kind === "icon"}
							<UiIcon
								display={displays.get(row.artwork.key)}
								name="…"
								tooltipLabel={row.name}
							/>
						{:else}
							<span title={row.artwork.detail}>?</span>
						{/if}
					</span>
					<span
						>{row.name}{#if row.artwork.kind === "failed"}<small
								>{row.artwork.detail}</small
							>{/if}</span
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	@layer components {
		.spells-panel {
			height: 100%;
			min-height: 0;
			overflow: auto;
			padding: 8px;
			box-sizing: border-box;
		}
		ul {
			list-style: none;
			margin: 0;
			padding: 0;
		}
		li {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 3px 0;
		}
		.spell-icon {
			width: 32px;
			height: 32px;
			flex: 0 0 32px;
			display: grid;
			place-items: center;
		}
		small {
			display: block;
		}
	}
</style>
