<script lang="ts">
	import type { SpellReference } from "../app/spell-references";
	import type { UiIconRepository } from "../app/ui-icon-repository";
	import type { HexRgbaColor } from "../lib/frontend-color";
	import ClientInspectionArtwork from "./ClientInspectionArtwork.svelte";
	import { summarizeItemCantrips } from "./client-item-cantrips";
	import type { ClientSpellServices } from "./client-spells";
	import { CLIENT_TUNING } from "./client-tuning";
	import type {
		ItemInspection,
		ObjectInspection,
	} from "./client-object-inspection-contract";
	import {
		formatInspectionDamageTypes,
		formatInspectionDuration,
		formatInspectionEffect,
		formatInspectionImbuedEffects,
		formatInspectionNumber,
		formatInspectionPercent,
		formatItemStatuses,
		formatWieldRequirement,
		humanizeInspectionName,
		inspectionBonusLabel,
		inspectionEnchantmentClass,
		truncateInspectionDescription,
	} from "./client-object-inspection-format";

	interface Props {
		readonly inspection: ObjectInspection;
		readonly nameColor: HexRgbaColor | null;
		readonly item: ItemInspection;
		readonly spells: ClientSpellServices | null;
		readonly icons: UiIconRepository | null;
	}

	const { inspection, nameColor, item, spells, icons }: Props = $props();
	const statuses = $derived(formatItemStatuses(item.status));
	const imbues = $derived(formatInspectionImbuedEffects(item.imbuedEffects));
	const collapsedDescription = $derived(
		inspection.description === null
			? null
			: truncateInspectionDescription(
					inspection.description,
					CLIENT_TUNING.objectInspection.collapsedDescriptionCharacters,
				),
	);
	let descriptionExpanded = $state(false);
	let spellReferences = $state<readonly SpellReference[] | null>(null);
	let spellFailure = $state<string | null>(null);
	const spellGroups = $derived(
		[
			{
				heading: "Spells",
				indexes: item.spells.flatMap((spell, index) =>
					spell.activeEnchantment ? [] : [index],
				),
			},
			{
				heading: "Active Spells",
				indexes: item.spells.flatMap((spell, index) =>
					spell.activeEnchantment ? [index] : [],
				),
			},
		].filter(({ indexes }) => indexes.length > 0),
	);
	const cantripSummary = $derived(
		summarizeItemCantrips(item.spells, spellReferences, spellFailure !== null),
	);

	$effect(() => {
		spellReferences = null;
		spellFailure = null;
		if (item.spells.length === 0) return;
		if (spells === null) {
			spellFailure = "Spell-reference service is unavailable.";
			return;
		}
		let active = true;
		void spells
			.load(item.spells.map(({ id }) => id))
			.then((references) => {
				if (active) spellReferences = references;
			})
			.catch((error: unknown) => {
				if (active)
					spellFailure = error instanceof Error ? error.message : String(error);
			});
		return () => {
			active = false;
		};
	});

	function spellLabel(index: number): string {
		const spell = item.spells[index];
		const reference = spellReferences?.[index];
		if (spell === undefined) return "Unknown spell";
		if (reference?.kind === "known") return reference.name;
		if (reference?.kind === "failed")
			return `Spell ${spell.id} (lookup failed: ${reference.detail})`;
		if (reference?.kind === "missing")
			return `Spell ${spell.id} (definition missing)`;
		return `Spell ${spell.id}`;
	}

	function formatDamageRange(range: {
		readonly min: number;
		readonly max: number;
	}): string {
		return range.min === range.max
			? formatInspectionNumber(range.max)
			: `${formatInspectionNumber(range.min)} – ${formatInspectionNumber(range.max)}`;
	}
</script>

{#snippet spellList(indexes: readonly number[])}
	<ul class="inspection-spells">
		{#each indexes as index}
			{@const reference = spellReferences?.[index]}
			<li>
				<details class="inspection-spell">
					<summary>{spellLabel(index)}</summary>
					<div class="inspection-spell-description">
						{#if reference?.kind === "known"}
							<p>
								{reference.details.description.length > 0
									? reference.details.description
									: "No description available."}
							</p>
						{:else if reference?.kind === "missing"}
							<p class="inspection-diagnostic">
								Spell definition is unavailable.
							</p>
						{:else if reference?.kind === "failed"}
							<p class="inspection-diagnostic">
								Spell description unavailable: {reference.detail}
							</p>
						{:else if spellFailure !== null}
							<p class="inspection-diagnostic">
								Spell description unavailable.
							</p>
						{:else}
							<p class="inspection-diagnostic">Loading description…</p>
						{/if}
					</div>
				</details>
			</li>
		{/each}
	</ul>
{/snippet}

<article class="inspection-body inspection-item">
	<header class="inspection-hero">
		<div class="inspection-hero-aside">
			<ClientInspectionArtwork
				artwork={item.artwork}
				{icons}
				name={inspection.name}
			/>
			{#if cantripSummary.kind === "loading"}
				<div
					class="inspection-cantrip-pills"
					aria-label="Loading cantrip summary"
				>
					<span class="inspection-cantrip-pill inspection-cantrip-pending"
						>Cantrips…</span
					>
				</div>
			{:else if cantripSummary.kind === "ready" && (cantripSummary.pills.length > 0 || cantripSummary.incompleteCount > 0)}
				<ul class="inspection-cantrip-pills" aria-label="Cantrips">
					{#each cantripSummary.pills as pill}
						<li
							class="inspection-cantrip-pill"
							data-tier={pill.tier}
							aria-label={`${pill.label} cantrip${pill.count === 1 ? "" : "s"}: ${pill.count}`}
						>
							{pill.abbreviatedLabel}{pill.count === 1 ? "" : ` ×${pill.count}`}
						</li>
					{/each}
					{#if cantripSummary.incompleteCount > 0}
						<li
							class="inspection-cantrip-pill inspection-cantrip-incomplete"
							title={`${cantripSummary.incompleteCount} intrinsic spell definition${cantripSummary.incompleteCount === 1 ? " is" : "s are"} unavailable`}
						>
							Incomplete
						</li>
					{/if}
				</ul>
			{/if}
		</div>
		<div>
			<h2 class="inspection-name" style:color={nameColor}>{inspection.name}</h2>
			{#if inspection.level !== null}<p class="inspection-kicker">
					Level {formatInspectionNumber(inspection.level)}
				</p>{/if}
			{#if item.portalDestination !== null}
				<p class="inspection-description" data-inspection-portal-destination>
					Destination: {item.portalDestination}
				</p>
			{/if}
			{#if inspection.description !== null}<p class="inspection-description">
					{#if collapsedDescription !== null && !descriptionExpanded}
						{collapsedDescription}…
					{:else}
						{inspection.description}
					{/if}
					{#if collapsedDescription !== null}
						{" "}<button
							type="button"
							class="inspection-description-toggle"
							aria-expanded={descriptionExpanded}
							onclick={() => (descriptionExpanded = !descriptionExpanded)}
						>
							{descriptionExpanded ? "[Hide]" : "[See more]"}
						</button>
					{/if}
				</p>{/if}
		</div>
	</header>

	{#if item.value !== null || item.burden !== null || item.material !== null || item.tinkering !== null || item.spellcraft !== null}
		<section>
			<h3>Item</h3>
			<dl class="inspection-facts">
				{#if item.value !== null}<div>
						<dt>Value</dt>
						<dd>{formatInspectionNumber(item.value)}</dd>
					</div>{/if}
				{#if item.burden !== null}<div>
						<dt>Burden</dt>
						<dd>{formatInspectionNumber(item.burden)} bu</dd>
					</div>{/if}
				{#if item.material !== null}<div>
						<dt>Material</dt>
						<dd>
							{humanizeInspectionName(item.material.materialType)} ({formatInspectionNumber(
								item.material.workmanship,
							)})
						</dd>
					</div>{/if}
				{#if item.tinkering !== null}<div>
						<dt>Tinkered</dt>
						<dd>{formatInspectionNumber(item.tinkering.count)} times</dd>
					</div>{/if}
				{#if item.spellcraft !== null}<div>
						<dt>Spellcraft</dt>
						<dd>{formatInspectionNumber(item.spellcraft)}</dd>
					</div>{/if}
			</dl>
		</section>
	{/if}

	{#if item.mana !== null || item.stack !== null || item.uses !== null || item.capacity.items !== null || item.capacity.containers !== null || statuses.length > 0}
		<section>
			<h3>State</h3>
			<dl class="inspection-facts">
				{#if item.mana !== null}<div class="inspection-wide">
						<dt>{item.mana.kind === "mana" ? "Mana" : "Charge"}</dt>
						<dd>
							{formatInspectionNumber(item.mana.current)}{item.mana.max === null
								? ""
								: ` / ${formatInspectionNumber(item.mana.max)}`}{item.mana
								.secondsLeft === null
								? ""
								: ` (${formatInspectionDuration(item.mana.secondsLeft)} left)`}
						</dd>
					</div>{/if}
				{#if item.stack !== null}<div>
						<dt>Count</dt>
						<dd>
							{item.stack.current === null
								? "?"
								: formatInspectionNumber(item.stack.current)} / {formatInspectionNumber(
								item.stack.max,
							)}
						</dd>
					</div>{/if}
				{#if item.uses !== null}<div>
						<dt>Uses</dt>
						<dd>
							{item.uses.current === null
								? "?"
								: formatInspectionNumber(item.uses.current)} / {formatInspectionNumber(
								item.uses.max,
							)}
						</dd>
					</div>{/if}
				{#if item.capacity.items !== null}<div>
						<dt>Item capacity</dt>
						<dd>{formatInspectionNumber(item.capacity.items)}</dd>
					</div>{/if}
				{#if item.capacity.containers !== null}<div>
						<dt>Container capacity</dt>
						<dd>{formatInspectionNumber(item.capacity.containers)}</dd>
					</div>{/if}
				{#if statuses.length > 0}<div class="inspection-wide">
						<dt>Status</dt>
						<dd>{statuses.join(", ")}</dd>
					</div>{/if}
			</dl>
		</section>
	{/if}

	{#if item.weapon !== null}
		<section>
			<h3>Combat</h3>
			<dl class="inspection-facts">
				{#if item.weapon !== null}
					<div class="inspection-wide">
						<dt>Damage</dt>
						<dd>
							<span class={inspectionEnchantmentClass(item.weapon.damage)}
								>{formatDamageRange(item.weapon.damage.effective)}</span
							>
							{formatInspectionDamageTypes(item.weapon.damageType)}
							{#if item.weapon.damage.unbuffed !== null}<span
									class="inspection-unbuffed"
								>
									(base {formatDamageRange(item.weapon.damage.unbuffed)})
								</span>{/if}
						</dd>
					</div>
					{#if item.weapon.speed !== null}<div>
							<dt>Speed</dt>
							<dd>
								<span class={inspectionEnchantmentClass(item.weapon.speed)}
									>{formatInspectionNumber(item.weapon.speed.effective)}</span
								>{#if item.weapon.speed.unbuffed !== null}<span
										class="inspection-unbuffed"
									>
										(base {formatInspectionNumber(item.weapon.speed.unbuffed)})
									</span>{/if}
							</dd>
						</div>{/if}
					{#if item.weapon.weaponSkill !== null}<div>
							<dt>Weapon skill</dt>
							<dd>{humanizeInspectionName(item.weapon.weaponSkill)}</dd>
						</div>{/if}
					{#if item.weapon.weaponType !== null && item.weapon.weaponType !== "Undef"}<div
						>
							<dt>Type</dt>
							<dd>{humanizeInspectionName(item.weapon.weaponType)}</dd>
						</div>{/if}
				{/if}
			</dl>
		</section>
	{/if}

	{#if item.armor !== null || item.protections !== null}
		<section>
			<h3>Protections</h3>
			<dl class="inspection-facts inspection-protections">
				{#if item.armor !== null}<div class="inspection-wide">
						<dt>Armor</dt>
						<dd>
							<span class={inspectionEnchantmentClass(item.armor)}
								>{formatInspectionNumber(item.armor.effective)}</span
							>
							{#if item.armor.unbuffed !== null}<span
									class="inspection-unbuffed"
								>
									(base {formatInspectionNumber(item.armor.unbuffed)})
								</span>{/if}
						</dd>
					</div>{/if}
				{#each Object.entries(item.protections ?? {}) as [kind, value]}
					<div>
						<dt>{humanizeInspectionName(kind)}</dt>
						<dd>
							<span class={inspectionEnchantmentClass(value)}
								>{value.effective.toFixed(2)}</span
							>{#if value.unbuffed !== null}<span class="inspection-unbuffed">
									(base {value.unbuffed.toFixed(2)})
								</span>{/if}
						</dd>
					</div>
				{/each}
			</dl>
		</section>
	{/if}

	{#if item.wieldRequirements.length > 0}
		<section>
			<h3>Wield requirements</h3>
			<ul>
				{#each item.wieldRequirements as requirement}<li>
						{formatWieldRequirement(requirement)}
					</li>{/each}
			</ul>
		</section>
	{/if}
	{#if item.bonuses.length > 0}
		<section>
			<h3>Bonuses</h3>
			<dl class="inspection-facts">
				{#each item.bonuses as bonus}<div>
						<dt>{inspectionBonusLabel(bonus.kind)}</dt>
						<dd>
							<span class={inspectionEnchantmentClass(bonus.value)}
								>{bonus.value.effective >= 0
									? "+"
									: ""}{formatInspectionPercent(bonus.value.effective)}</span
							>{#if bonus.value.unbuffed !== null}<span
									class="inspection-unbuffed"
								>
									(base {bonus.value.unbuffed >= 0
										? "+"
										: ""}{formatInspectionPercent(bonus.value.unbuffed)})
								</span>{/if}
						</dd>
					</div>{/each}
			</dl>
		</section>
	{/if}
	{#if imbues.length > 0 || item.effects.length > 0}
		<section>
			<h3>Effects</h3>
			<ul>
				{#each imbues as effect}<li>
						{effect}
					</li>{/each}{#each item.effects as effect}<li>
						{formatInspectionEffect(effect)}
					</li>{/each}
			</ul>
		</section>
	{/if}
	{#if item.useText !== null}<section>
			<h3>Use</h3>
			<p>{item.useText}</p>
		</section>{/if}
	{#each spellGroups as group}
		<section aria-busy={spellReferences === null && spellFailure === null}>
			<h3>{group.heading}</h3>
			{#if spellFailure !== null}<p class="inspection-diagnostic">
					Spell names unavailable: {spellFailure}
				</p>{/if}
			{@render spellList(group.indexes)}
		</section>
	{/each}
	{#if item.inscription !== null}
		<section>
			<h3>Inscription</h3>
			<blockquote>{item.inscription.text}</blockquote>
			{#if item.inscription.scribe !== null && item.inscription.scribe.length > 0}<p
					class="inspection-scribe"
				>
					— {item.inscription.scribe}
				</p>{/if}
		</section>
	{/if}
</article>

<style>
	@layer components {
		.inspection-description-toggle {
			appearance: none;
			padding: 0;
			border: 0;
			background: transparent;
			color: var(--ui-color-accent);
			font: inherit;
			text-decoration: underline;
			cursor: pointer;
		}
	}
</style>
