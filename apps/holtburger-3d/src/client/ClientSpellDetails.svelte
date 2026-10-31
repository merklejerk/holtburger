<script lang="ts">
	import type { SpellDetails } from "../app/spell-references";
	import { untrack } from "svelte";
	import ClientSpellFormula from "./ClientSpellFormula.svelte";
	import type {
		ClientSpellServices,
		SpellInspectionDisplay,
	} from "./client-spells";
	const {
		spells,
		spellId,
		details,
		visible,
	}: {
		/** Existing local spell services shared by the spellbook and inspector. */
		readonly spells: ClientSpellServices;
		/** Static spell identity, independent of artwork availability. */
		readonly spellId: number;
		/** Available authored facts, shared by spellbook and inspector. */
		readonly details: SpellDetails | null;
		/** Hidden consumers release character-context subscriptions and formula displays. */
		readonly visible: boolean;
	} = $props();
	let inspection = $state<SpellInspectionDisplay>({ kind: "pending" });
	$effect(() => {
		const id = spellId;
		if (!visible || details === null) return;
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
</script>

{#if details !== null}
	<dl class="inspection-facts">
		<div
			title="Approximate level derived from the formula’s power component using the retail spellbook heuristic; may differ from the server’s power-based level."
		>
			<dt>Level</dt>
			<dd>
				{details.classification.level === null
					? "Unknown"
					: details.classification.level}
			</dd>
		</div>
		{#if inspection.kind === "ready" && inspection.rangeMetres !== 0}<div>
				<dt>Range</dt>
				<dd>{(inspection.rangeMetres / 0.9144).toFixed(1)} yds.</dd>
			</div>{/if}
		<div>
			<dt>School</dt>
			<dd>
				{schoolNames[details.school] ?? `Unknown school ${details.school}`}
			</dd>
		</div>
		<div>
			<dt>Mana</dt>
			<dd>
				{details.baseMana}{#if details.manaPerTarget > 0}
					{" + "}{details.manaPerTarget} per target{/if}
			</dd>
		</div>
		{#if details.durationSeconds !== null}<div>
				<dt>Duration</dt>
				<dd>
					{details.durationSeconds >= 60
						? `${Math.floor(details.durationSeconds / 60)} min.`
						: `${Math.floor(details.durationSeconds)} sec.`}
				</dd>
			</div>{/if}
		{#if details.classification.recipient !== null}<div
				title="Authored spell metadata; casting requirements and valid targets may differ."
			>
				<dt>Authored recipient</dt>
				<dd>
					{details.classification.recipient === "creature"
						? "Creature"
						: "Item"}
				</dd>
			</div>{/if}
	</dl>
	{#if inspection.kind === "failed"}<p class="inspection-diagnostic">
			{inspection.detail}
		</p>
	{:else if inspection.kind === "missing"}<p class="inspection-diagnostic">
			Runtime spell definition unavailable.
		</p>
	{:else if inspection.kind === "pending"}<p class="inspection-diagnostic">
			Waiting for character details…
		</p>{/if}
	<p class="inspection-description">{details.description}</p>
	{#if visible && inspection.kind === "ready"}
		{#if inspection.formula.kind === "ready"}
			{#key inspection.formula.components}<ClientSpellFormula
					{spells}
					{spellId}
					components={inspection.formula.components}
				/>{/key}
		{:else if inspection.formula.kind === "failed"}<p
				class="inspection-diagnostic"
			>
				{inspection.formula.detail}
			</p>
		{:else}<p class="inspection-diagnostic">
				Waiting for formula context…
			</p>{/if}
	{/if}
{:else}<p class="inspection-diagnostic">Spell details unavailable.</p>{/if}

<style>
	@layer components {
		dl {
			margin: 0;
		}
		dl > div {
			display: flex;
			flex-wrap: wrap;
			gap: 0.4em;
		}
		dd {
			margin: 0;
		}
		dt::after {
			content: ":";
		}
		p {
			white-space: pre-wrap;
		}
	}
</style>
