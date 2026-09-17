<script lang="ts">
	import type {
		CreatureInspection,
		ObjectInspection,
	} from "./client-object-inspection-contract";
	import {
		formatInspectionNumber,
		humanizeInspectionName,
		inspectionEnchantmentClass,
	} from "./client-object-inspection-format";

	interface Props {
		readonly inspection: ObjectInspection;
		readonly creature: CreatureInspection;
	}
	const { inspection, creature }: Props = $props();
	const profile = $derived(creature.attributesAndVitals);
</script>

<article class="inspection-body inspection-creature">
	<header class="inspection-creature-hero">
		<div class="inspection-creature-mark" aria-hidden="true">◆</div>
		<div>
			<h2>{inspection.name}</h2>
			{#if inspection.level !== null || creature.creatureType !== null}
				<p class="inspection-kicker">
					{inspection.level === null
						? ""
						: `Level ${formatInspectionNumber(inspection.level)}`}{inspection.level !==
						null && creature.creatureType !== null
						? " · "
						: ""}{creature.creatureType === null
						? ""
						: humanizeInspectionName(creature.creatureType)}
				</p>
			{/if}
		</div>
	</header>
	{#if inspection.description !== null}<p
			class="inspection-description inspection-creature-description"
		>
			{inspection.description}
		</p>{/if}

	<section class="inspection-vitals" aria-label="Creature vitals">
		<div class="inspection-vital inspection-health">
			<div>
				<span>Health</span><strong
					class={inspectionEnchantmentClass(creature.health)}
					>{formatInspectionNumber(creature.health.effective.current)} / {formatInspectionNumber(
						creature.health.effective.max,
					)}</strong
				>
			</div>
			<progress
				value={creature.health.effective.current}
				max={Math.max(1, creature.health.effective.max)}
			></progress>
		</div>
		{#if profile !== null}
			<div class="inspection-vital inspection-stamina">
				<div>
					<span>Stamina</span><strong
						class={inspectionEnchantmentClass(profile.stamina)}
						>{formatInspectionNumber(profile.stamina.effective.current)} / {formatInspectionNumber(
							profile.stamina.effective.max,
						)}</strong
					>
				</div>
				<progress
					value={profile.stamina.effective.current}
					max={Math.max(1, profile.stamina.effective.max)}
				></progress>
			</div>
			<div class="inspection-vital inspection-mana">
				<div>
					<span>Mana</span><strong
						class={inspectionEnchantmentClass(profile.mana)}
						>{formatInspectionNumber(profile.mana.effective.current)} / {formatInspectionNumber(
							profile.mana.effective.max,
						)}</strong
					>
				</div>
				<progress
					value={profile.mana.effective.current}
					max={Math.max(1, profile.mana.effective.max)}
				></progress>
			</div>
		{/if}
	</section>

	{#if profile !== null}
		<section>
			<h3>Attributes</h3>
			<dl class="inspection-attributes">
				<div>
					<dt>Strength</dt>
					<dd class={inspectionEnchantmentClass(profile.attributes.strength)}>
						{formatInspectionNumber(profile.attributes.strength.effective)}
					</dd>
				</div>
				<div>
					<dt>Endurance</dt>
					<dd class={inspectionEnchantmentClass(profile.attributes.endurance)}>
						{formatInspectionNumber(profile.attributes.endurance.effective)}
					</dd>
				</div>
				<div>
					<dt>Coordination</dt>
					<dd
						class={inspectionEnchantmentClass(profile.attributes.coordination)}
					>
						{formatInspectionNumber(profile.attributes.coordination.effective)}
					</dd>
				</div>
				<div>
					<dt>Quickness</dt>
					<dd class={inspectionEnchantmentClass(profile.attributes.quickness)}>
						{formatInspectionNumber(profile.attributes.quickness.effective)}
					</dd>
				</div>
				<div>
					<dt>Focus</dt>
					<dd class={inspectionEnchantmentClass(profile.attributes.focus)}>
						{formatInspectionNumber(profile.attributes.focus.effective)}
					</dd>
				</div>
				<div>
					<dt>Self</dt>
					<dd class={inspectionEnchantmentClass(profile.attributes.selfAttr)}>
						{formatInspectionNumber(profile.attributes.selfAttr.effective)}
					</dd>
				</div>
			</dl>
		</section>
	{/if}
</article>
