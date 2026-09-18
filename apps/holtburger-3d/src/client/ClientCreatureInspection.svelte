<script lang="ts">
	import type {
		CreatureInspection,
		ObjectInspection,
	} from "./client-object-inspection-contract";
	import {
		formatInspectionNumber,
		inspectionEnchantmentClass,
	} from "./client-object-inspection-format";

	interface Props {
		readonly inspection: ObjectInspection;
		readonly creature: CreatureInspection;
	}
	const { inspection, creature }: Props = $props();
	const profile = $derived(creature.attributesAndVitals);
	const maxHealthBonus = $derived(creature.maxHealthBonus);
	const armorLocations = $derived.by(() => {
		const armor = creature.armorCoverage;
		if (armor === null) return [];
		return [
			["Head", armor.head],
			["Chest", armor.chest],
			["Abdomen", armor.abdomen],
			["Upper arm", armor.upperArm],
			["Lower arm", armor.lowerArm],
			["Hand", armor.hand],
			["Upper leg", armor.upperLeg],
			["Lower leg", armor.lowerLeg],
			["Foot", armor.foot],
		] as const;
	});
	const ratingRows = $derived.by(() => {
		const ratings = creature.ratings;
		if (ratings === null) return [];
		const candidates: readonly (readonly [string, number | null, string])[] = [
			["Damage rating", ratings.damageRating, ""],
			["Damage resistance", ratings.damageResistanceRating, ""],
			["Critical rating", ratings.criticalRating, ""],
			["Critical damage", ratings.criticalDamageRating, ""],
			["Critical resistance", ratings.criticalResistanceRating, ""],
			[
				"Critical damage resistance",
				ratings.criticalDamageResistanceRating,
				"",
			],
			["PK damage rating", ratings.playerKillerDamageRating, ""],
			["PK damage resistance", ratings.playerKillerDamageResistanceRating, ""],
			["Overpower chance", ratings.overpowerChancePercent, "%"],
			["Overpower resistance", ratings.overpowerResistancePercent, "%"],
			["Healing boost", ratings.healingBoostRating, ""],
			["Nether resistance", ratings.netherResistanceRating, ""],
			["DoT resistance", ratings.damageOverTimeResistanceRating, ""],
			["Life magic resistance", ratings.lifeMagicResistanceRating, ""],
		];
		const rows: [string, number, string][] = [];
		for (const [label, value, suffix] of candidates) {
			if (value !== null) rows.push([label, value, suffix]);
		}
		return rows;
	});

	function formatCharacterAge(seconds: number): string {
		const total = Math.abs(Math.round(seconds));
		const sign = seconds < 0 ? "−" : "";
		const days = Math.floor(total / 86_400);
		const hours = Math.floor((total % 86_400) / 3_600);
		const minutes = Math.floor((total % 3_600) / 60);
		return `${sign}${days}d ${hours}h ${minutes}m`;
	}
</script>

<article class="inspection-body inspection-creature">
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

	{#if armorLocations.length > 0}
		<section>
			<h3>Protection</h3>
			<dl class="inspection-facts inspection-armor-coverage">
				{#each armorLocations as [label, armor]}
					<div>
						<dt>{label}</dt>
						<dd class="inspection-number">
							{armor.enchantable ? "" : "*"}{formatInspectionNumber(
								armor.level,
							)}
						</dd>
					</div>
				{/each}
			</dl>
			{#if armorLocations.some(([, armor]) => !armor.enchantable)}
				<p class="inspection-note">* Unenchantable</p>
			{/if}
		</section>
	{/if}

	{#if ratingRows.length > 0}
		<section>
			<h3>Combat ratings</h3>
			<dl class="inspection-facts">
				{#each ratingRows as [label, value, suffix]}
					<div>
						<dt>{label}</dt>
						<dd class="inspection-number">
							{formatInspectionNumber(value)}{suffix}
						</dd>
					</div>
				{/each}
			</dl>
		</section>
	{/if}

	{#if maxHealthBonus !== null}
		<section>
			<h3>Bonuses</h3>
			<dl class="inspection-facts">
				<div>
					<dt>Maximum health</dt>
					<dd class="inspection-number">
						{formatInspectionNumber(maxHealthBonus)}
					</dd>
				</div>
			</dl>
		</section>
	{/if}

	{#if creature.characterDetails !== null}
		{@const details = creature.characterDetails}
		{#if details.allegianceName !== null || details.patron !== null || details.monarch !== null || details.allegianceFollowers !== null || details.fellowship !== null}
			<section>
				<h3>Affiliation</h3>
				<dl class="inspection-facts">
					{#if details.allegianceName !== null}<div>
							<dt>Allegiance</dt>
							<dd>{details.allegianceName}</dd>
						</div>{/if}
					{#if details.monarch !== null}<div>
							<dt>Monarch</dt>
							<dd>{details.monarch}</dd>
						</div>{/if}
					{#if details.patron !== null}<div>
							<dt>Patron</dt>
							<dd>{details.patron}</dd>
						</div>{/if}
					{#if details.allegianceFollowers !== null}<div>
							<dt>Followers</dt>
							<dd>{formatInspectionNumber(details.allegianceFollowers)}</dd>
						</div>{/if}
					{#if details.fellowship !== null}<div>
							<dt>Fellowship</dt>
							<dd>{details.fellowship}</dd>
						</div>{/if}
				</dl>
			</section>
		{/if}
		{#if details.arrivedInDereth !== null || details.ageSeconds !== null || details.deaths !== null || details.titlesEarned !== null || details.chessRank !== null || details.fishingSkill !== null || details.enlightenment !== null}
			<section>
				<h3>Character details</h3>
				<dl class="inspection-facts">
					{#if details.arrivedInDereth !== null}<div>
							<dt>Arrived in Dereth</dt>
							<dd>{details.arrivedInDereth}</dd>
						</div>{/if}
					{#if details.ageSeconds !== null}<div>
							<dt>Time in Dereth</dt>
							<dd>{formatCharacterAge(details.ageSeconds)}</dd>
						</div>{/if}
					{#if details.deaths !== null}<div>
							<dt>Deaths</dt>
							<dd>
								{details.deaths === 0
									? "Never"
									: formatInspectionNumber(details.deaths)}
							</dd>
						</div>{/if}
					{#if details.titlesEarned !== null}<div>
							<dt>Titles earned</dt>
							<dd>{formatInspectionNumber(details.titlesEarned)}</dd>
						</div>{/if}
					{#if details.chessRank !== null}<div>
							<dt>Chess rank</dt>
							<dd>{formatInspectionNumber(details.chessRank)}</dd>
						</div>{/if}
					{#if details.fishingSkill !== null}<div>
							<dt>Fishing skill</dt>
							<dd>{formatInspectionNumber(details.fishingSkill)}</dd>
						</div>{/if}
					{#if details.enlightenment !== null}<div>
							<dt>Enlightenment</dt>
							<dd>{formatInspectionNumber(details.enlightenment)}</dd>
						</div>{/if}
				</dl>
			</section>
		{/if}
	{/if}
</article>
