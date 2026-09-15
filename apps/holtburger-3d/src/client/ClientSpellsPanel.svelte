<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import type { SpellDetails } from "../app/spell-references";
	import ClientSpellFormula from "./ClientSpellFormula.svelte";
	import UiIcon from "../app/UiIcon.svelte";
	import type { UiIconDisplay, UiIconOwner } from "../app/ui-icon-repository";
	import type {
		ClientSpellServices,
		SpellInspectionDisplay,
	} from "./client-spells";
	import { CLIENT_TUNING } from "./client-tuning";

	/** A list row retains identity even when its definition or artwork is unavailable. */
	interface SpellRow {
		/** Stable player-known spell identity. */
		readonly id: number;
		/** Authored name or explicit missing-definition label. */
		readonly name: string;
		/** Available static examination facts, independent of artwork. */
		readonly details: SpellDetails | null;
		/** Consumer-owned icon reference or an actionable diagnostic. */
		readonly artwork:
			| { readonly kind: "icon"; readonly key: string }
			| { readonly kind: "failed"; readonly detail: string };
	}
	const { spells }: { readonly spells: ClientSpellServices } = $props();
	/** The expanded spell identity survives unrelated list refreshes. */
	let expandedId = $state<number | null>(null);
	/** Cold detail presentation from inspection replies. */
	let inspection = $state<SpellInspectionDisplay>({ kind: "pending" });
	$effect(() => {
		const id = expandedId;
		if (id === null) return;
		// Reads inside callbacks cannot own this consumer's subscription lifetime.
		return untrack(() =>
			spells.inspect(id, (value) => {
				inspection = value;
			}),
		);
	});
	const schoolNames: Readonly<Record<number, string>> = {
		0: "None",
		1: "War Magic",
		2: "Life Magic",
		3: "Item Enchantment",
		4: "Creature Enchantment",
		5: "Void Magic",
	};
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
			if (ids === null || (expandedId !== null && !ids.includes(expandedId)))
				expandedId = null;
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
							details: null,
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
						details: reference.details,
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
				<li data-spell-id={row.id} class:expanded={expandedId === row.id}>
					<button
						class="spell-header"
						type="button"
						aria-expanded={expandedId === row.id}
						onclick={() => {
							expandedId = expandedId === row.id ? null : row.id;
						}}
					>
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
						<span class="expansion-indicator" aria-hidden="true"
							>{expandedId === row.id ? "▾" : "▸"}</span
						>
					</button>
					{#if expandedId === row.id}
						<div class="spell-details">
							{#if row.details !== null}
								{#if inspection.kind === "ready"}
									{#if inspection.rangeMetres !== 0}<div>
											Range: {(inspection.rangeMetres / 0.9144).toFixed(1)} yds.
										</div>{/if}
								{:else if inspection.kind === "failed"}<div>
										{inspection.detail}
									</div>
								{:else if inspection.kind === "missing"}<div>
										Runtime spell definition unavailable.
									</div>
								{:else}<div>Waiting for character details…</div>{/if}
								<div>
									School: {schoolNames[row.details.school] ??
										`Unknown school ${row.details.school}`}
								</div>
								<div>
									Mana: {row.details
										.baseMana}{#if row.details.manaPerTarget > 0}
										+ {row.details.manaPerTarget} per target{/if}
								</div>
								{#if row.details.durationSeconds !== null}
									<div>
										Duration: {row.details.durationSeconds >= 60
											? `${Math.floor(row.details.durationSeconds / 60)} min.`
											: `${Math.floor(row.details.durationSeconds)} sec.`}
									</div>
								{/if}
								<p>{row.details.description}</p>
								{#if inspection.kind === "ready"}
									{#if inspection.formula.kind === "ready"}
										{#key inspection.formula.components}
											<ClientSpellFormula
												{spells}
												spellId={row.id}
												components={inspection.formula.components}
											/>
										{/key}
									{:else if inspection.formula.kind === "failed"}<p>
											{inspection.formula.detail}
										</p>
									{:else}<p>Waiting for formula context…</p>{/if}
								{/if}
							{:else}
								<p>Spell details unavailable.</p>
							{/if}
						</div>
					{/if}
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
			border: 1px solid transparent;
			border-bottom-color: color-mix(
				in srgb,
				var(--ui-color-border) 20%,
				transparent
			);
		}
		li.expanded {
			border-color: var(--ui-color-border);
			background: var(--ui-color-well);
		}
		.spell-details {
			border-top: 1px solid
				color-mix(in srgb, var(--ui-color-border) 30%, transparent);
			padding: 10px 12px;
			line-height: 1.5;
		}
		.expanded .spell-header,
		.spell-header:hover {
			background: var(--ui-color-control);
		}
		.expansion-indicator {
			margin-left: auto;
			padding-left: 8px;
		}
		.spell-details p {
			white-space: pre-wrap;
		}
		.spell-header {
			width: 100%;
			text-align: left;
			color: inherit;
			font: inherit;
			background: transparent;
			border: 0;
			cursor: pointer;
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 4px 6px;
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
