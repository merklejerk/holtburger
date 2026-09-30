<script lang="ts">
	import { onMount, untrack } from "svelte";
	import {
		progressionIntentKey,
		progressionTargetKey,
		type CharacterSheet,
		type ProgressionIntent,
		type ProgressionUnavailable,
		type StatTarget,
	} from "./client-character-sheet-contract";
	import type { ClientCharacterSheetState } from "./client-character-sheet-state";
	import type { ClientTimedEnchantments } from "./client-lifecycle-session";
	import { enchantmentKey } from "./client-enchantments-view";
	import type { ClientSpellServices } from "./client-spells";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		readonly owner: ClientCharacterSheetState;
		readonly spells: ClientSpellServices | null;
		readonly enchantments: ClientTimedEnchantments | null;
	}
	const { owner, spells, enchantments }: Props = $props();
	type EffectStat =
		| { readonly kind: "floatProperty"; readonly key: number }
		| { readonly kind: "armor" | "vitae" };
	// Shared float-property IDs for resistance enchantments; the displayed values remain sheet-owned.
	const RESISTANCE_ROWS = [
		{ label: "Slash resistance", field: "slash", key: 64 },
		{ label: "Pierce resistance", field: "pierce", key: 65 },
		{ label: "Bludgeon resistance", field: "bludgeon", key: 66 },
		{ label: "Fire resistance", field: "fire", key: 67 },
		{ label: "Cold resistance", field: "cold", key: 68 },
		{ label: "Acid resistance", field: "acid", key: 69 },
		{ label: "Electric resistance", field: "electric", key: 70 },
		{ label: "Nether resistance", field: "nether", key: 166 },
	] as const;
	type Stat =
		| CharacterSheet["attributes"][number]
		| CharacterSheet["vitals"][number]
		| CharacterSheet["skills"][number]["stat"];
	type Modifier =
		CharacterSheet["attributes"][number]["breakdown"]["modifiers"]["contributions"][number];
	type Formula = NonNullable<
		CharacterSheet["vitals"][number]["breakdown"]["formula"]
	>;
	type SkillRow = CharacterSheet["skills"][number];
	// The panel is keyed to its session owner; this initial read closes the mount-to-poll gap.
	let display = $state.raw(untrack(() => owner.read()));
	let spellNames = $state<Record<number, string>>({});
	let spellLoadError = $state<string | null>(null);
	// Only purchase-control hover and keyboard focus drive the shared cost readout.
	let hoveredAction = $state<string | null>(null);
	let focusedAction = $state<string | null>(null);
	onMount(() => {
		const timer = window.setInterval(() => {
			const next = owner.read();
			if (next.revision !== display.revision) display = next;
		}, CLIENT_TUNING.characterSheet.displayIntervalMs);
		return () => {
			window.clearInterval(timer);
		};
	});

	const sheet = $derived(display.sheet);
	const skills = $derived(
		(sheet?.skills ?? [])
			.filter((row) => row.availableInEor)
			.toSorted((a, b) =>
				name(a.stat.skill_type).localeCompare(name(b.stat.skill_type)),
			),
	);
	const specializedSkills = $derived(
		skills.filter((row) => row.stat.training === "Specialized"),
	);
	const trainedSkills = $derived(
		skills.filter((row) => row.stat.training === "Trained"),
	);
	const untrainedSkills = $derived(
		skills.filter(
			(row) =>
				row.stat.training === "Untrained" || row.stat.training === "Unusable",
		),
	);

	function name(value: string): string {
		return value.replace(/Attr$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
	}
	function xp(value: string | number): string {
		return BigInt(value).toLocaleString();
	}
	// Keep exact large balances in bigint arithmetic; only the bounded fill becomes a number.
	function progressPercent(value: string, maximum: string): number {
		const limit = BigInt(maximum);
		if (limit === 0n) return 0;
		const amount = BigInt(value);
		return Number(((amount > limit ? limit : amount) * 10000n) / limit) / 100;
	}
	function effectGroups(stat: EffectStat) {
		if (enchantments === null) return [];
		if (stat.kind === "vitae") {
			return enchantments.resolved.instances
				.filter((instance) => instance.kind === "vitae")
				.map((instance) => ({ effective: instance.key, overridden: [] }));
		}
		return enchantments.resolved.groups.filter(
			(group) =>
				group.affectedStat.kind === stat.kind &&
				("key" in stat
					? "key" in group.affectedStat && group.affectedStat.key === stat.key
					: true),
		);
	}
	function effectLines(stat: EffectStat): string[] {
		if (enchantments === null) return [];
		const instances = new Map(
			enchantments.resolved.instances.map((instance) => [
				enchantmentKey(instance.key),
				instance,
			]),
		);
		const describe = (
			key: { readonly spellId: number; readonly layer: number },
			operation: "additive" | "multiplicative" | "other",
		): string => {
			const instance = instances.get(enchantmentKey(key));
			const label = spellNames[key.spellId] ?? `Spell ${key.spellId}`;
			if (instance === undefined) return label;
			const modifier =
				operation === "additive"
					? `${instance.statModValue >= 0 ? "+" : ""}${instance.statModValue}`
					: operation === "multiplicative"
						? `×${instance.statModValue}`
						: `modifier ${instance.statModValue}`;
			return `${label}: ${modifier}`;
		};
		return effectGroups(stat).map((group) => {
			const operation =
				"operation" in group ? group.operation : "multiplicative";
			return describe(group.effective, operation);
		});
	}
	function defenseEffectLines(stat: EffectStat): string[] {
		if (enchantments === null) return ["Effect details are unavailable"];
		const lines = effectLines(stat);
		return lines.length > 0 ? lines : ["No active effects"];
	}
	async function resolveEffectSpells(stat: EffectStat): Promise<void> {
		await resolveSpellIds(
			effectGroups(stat).map((group) => group.effective.spellId),
		);
	}
	function targetPending(target: StatTarget): boolean {
		const key = progressionTargetKey(target);
		return (
			display.pendingTargets.has(key) ||
			(sheet?.guardedTargets.some(
				(candidate) => progressionTargetKey(candidate) === key,
			) ??
				false)
		);
	}
	function unavailableReason(value: ProgressionUnavailable): string {
		if (value === "AwaitingTargetUpdate")
			return "Awaiting a server update for this stat";
		if (value === "CharacterNotReady") return "Character is still loading";
		if (typeof value === "object" && value !== null && "World" in value) {
			const world = value.World;
			if (world === "RankCap") return "Rank cap reached";
			if (world === "SkillNotTrained") return "Train this skill first";
			if (world === "NotTrainable") return "This skill cannot be trained";
			if (world === "AlreadyTrained") return "Already trained";
			if (typeof world === "object" && world !== null) {
				if ("InsufficientXp" in world)
					return `Requires ${xp(world.InsufficientXp.required)} XP; ${xp(world.InsufficientXp.available)} available`;
				if ("InsufficientCredits" in world)
					return `Requires ${world.InsufficientCredits.required} skill credits; ${world.InsufficientCredits.available} available`;
			}
		}
		return "Purchase is unavailable from current character facts";
	}
	function action(
		intent: ProgressionIntent,
		target: StatTarget,
		label: string,
	): {
		readonly key: string;
		readonly raisesRanks: boolean;
		readonly label: string;
		readonly cost: string;
		readonly disabled: boolean;
		readonly reason: string;
		readonly purchase: () => void;
	} {
		const evaluation = display.evaluations.get(progressionIntentKey(intent));
		const pending = targetPending(target);
		const quote =
			evaluation?.result && "Ok" in evaluation.result
				? evaluation.result.Ok
				: null;
		let cost =
			quote === null
				? ""
				: "Train" in intent
					? `${quote.quote.credits_spent} credits`
					: `${xp(quote.quote.xp_spent)} XP`;
		if (
			cost === "" &&
			evaluation?.result &&
			"Err" in evaluation.result &&
			typeof evaluation.result.Err === "object" &&
			"World" in evaluation.result.Err
		) {
			const reason = evaluation.result.Err.World;
			if (typeof reason === "object" && "InsufficientXp" in reason)
				cost = `${xp(reason.InsufficientXp.required)} XP`;
			else if (typeof reason === "object" && "InsufficientCredits" in reason)
				cost = `${reason.InsufficientCredits.required} credits`;
		}
		const rankGain =
			quote !== null && "RaiseMax" in intent
				? quote.quote.resulting_ranks - quote.quote.target_state.ranks
				: null;
		const actionLabel = rankGain === null ? label : `+${rankGain}`;
		const description =
			"RaiseMax" in intent ? `Raise maximum (${actionLabel})` : actionLabel;
		return {
			key: progressionIntentKey(intent),
			raisesRanks: !("Train" in intent),
			label: actionLabel,
			cost,
			disabled: pending || quote === null,
			reason: pending
				? "Awaiting a server update for this stat"
				: evaluation?.result && "Err" in evaluation.result
					? unavailableReason(evaluation.result.Err)
					: quote === null
						? "Calculating cost…"
						: `${description} immediately for ${cost}`,
			purchase: () => {
				if (quote !== null) void owner.purchase(quote);
			},
		};
	}
	function raiseActions(target: StatTarget) {
		const fixed = [
			action({ Raise: { target, ranks: 1 } }, target, "+1"),
			action({ Raise: { target, ranks: 10 } }, target, "+10"),
		].filter((button) => !button.disabled);
		const max = action({ RaiseMax: { target } }, target, "+MAX");
		// A maximum purchase needs its own control only when its quoted gain is distinct.
		return max.disabled || fixed.some((button) => button.label === max.label)
			? fixed
			: [...fixed, max];
	}
	function appliedFormula(stat: Stat): Formula | null {
		if (!("formula" in stat.breakdown)) return null;
		const formula = stat.breakdown.formula;
		if (formula === null || typeof formula === "string") return null;
		return "Applied" in formula ? formula.Applied : formula;
	}
	function modifierLine(modifier: Modifier, source?: string): string {
		const label =
			spellNames[modifier.effective.spellId] ??
			`Spell ${modifier.effective.spellId}`;
		const value =
			modifier.operation === "additive"
				? `${modifier.value >= 0 ? "+" : ""}${modifier.value}`
				: modifier.operation === "multiplicative"
					? `×${modifier.value}`
					: `modifier ${modifier.value}`;
		return `${label}${source === undefined ? "" : ` (via ${source})`}: ${value}`;
	}
	function detailLines(stat: Stat): string[] {
		const lines: string[] = [];
		const formula = appliedFormula(stat);
		if (formula !== null) {
			const numerator =
				formula.second === null
					? name(formula.first.attribute)
					: `(${name(formula.first.attribute)} + ${name(formula.second.attribute)})`;
			lines.push(`Formula: ${numerator} ÷ ${formula.divisor}`);
		}
		const startingValue = "start" in stat ? stat.start : stat.init;
		if (startingValue !== 0) lines.push(`Starting value: ${startingValue}`);
		if (formula !== null) {
			for (const input of [
				formula.first,
				...(formula.second === null ? [] : [formula.second]),
			]) {
				for (const modifier of input.modifiers)
					lines.push(modifierLine(modifier, name(input.attribute)));
			}
		}
		for (const modifier of stat.breakdown.modifiers.contributions)
			lines.push(modifierLine(modifier));
		if ("wide_modifiers" in stat.breakdown) {
			if (stat.breakdown.vitae !== 1)
				lines.push(`Vitae penalty: ×${stat.breakdown.vitae}`);
			for (const modifier of stat.breakdown.wide_modifiers)
				lines.push(
					modifierLine(
						modifier,
						modifier.channel === "attackSkills"
							? "attack skills"
							: "defense skills",
					),
				);
		}
		return lines;
	}
	function modifierSpellIds(stat: Stat): number[] {
		const ids: number[] = [];
		const add = (modifiers: readonly Modifier[]) => {
			for (const modifier of modifiers) ids.push(modifier.effective.spellId);
		};
		add(stat.breakdown.modifiers.contributions);
		const formula = appliedFormula(stat);
		if (formula !== null) {
			add(formula.first.modifiers);
			if (formula.second !== null) add(formula.second.modifiers);
		}
		if ("wide_modifiers" in stat.breakdown) add(stat.breakdown.wide_modifiers);
		return [...new Set(ids)];
	}
	async function resolveSpells(stat: Stat): Promise<void> {
		await resolveSpellIds(modifierSpellIds(stat));
	}
	async function resolveSpellIds(ids: readonly number[]): Promise<void> {
		if (spells === null) return;
		for (const id of new Set(ids)) {
			if (spellNames[id] !== undefined) continue;
			try {
				const reference = await spells.reference(id);
				spellNames = {
					...spellNames,
					[id]: reference.kind === "known" ? reference.name : `Spell ${id}`,
				};
			} catch (error) {
				spellLoadError = `Unable to load spell details: ${String(error)}`;
				spellNames = { ...spellNames, [id]: `Spell ${id}` };
			}
		}
	}
</script>

{#snippet actionButtons(
	statName: string,
	buttons: ReturnType<typeof raiseActions>,
)}
	{#if buttons.length > 0 && buttons.every((button) => button.disabled && button.reason === buttons[0].reason)}
		<span class="action-status">{buttons[0].reason}</span>
	{:else if buttons.length > 0}
		{@const selected =
			buttons.find((button) => button.key === hoveredAction) ??
			buttons.find((button) => button.key === focusedAction) ??
			buttons.find((button) => !button.disabled) ??
			buttons[0]}
		<span class="actions">
			{#each buttons as button}
				<button
					type="button"
					disabled={button.disabled}
					title={button.reason}
					aria-label={`${statName} ${button.label}: ${button.reason}`}
					class:active={selected.key === button.key}
					onpointerenter={() => (hoveredAction = button.key)}
					onpointerleave={() => (hoveredAction = null)}
					onfocus={() => (focusedAction = button.key)}
					onblur={() => (focusedAction = null)}
					onclick={button.purchase}
				>
					{#if button.raisesRanks}<span
							class="action-triangle"
							aria-hidden="true">▲</span
						>{/if}
					<span class="action-label">{button.label}</span>
				</button>
			{/each}
			<small class="action-cost">{selected.cost || "—"}</small>
		</span>
	{/if}
{/snippet}

{#snippet progressionHint(stat: Stat, buttons: ReturnType<typeof raiseActions>)}
	{#if stat.next_rank_xp === null && (!("training" in stat) || stat.training === "Trained" || stat.training === "Specialized")}
		<small class="rank-cap" title="Purchased rank cap reached">Max</small>
	{:else if buttons.some((button) => !button.disabled)}
		<span class="upgrade-indicator" aria-hidden="true">▲</span>
		<span class="sr-only">Upgrade available</span>
	{/if}
{/snippet}

{#snippet statValue(base: number, effective: number)}
	<strong
		>{base}{#if effective !== base}<span
				class="stat-effect"
				class:increased={effective > base}
				class:decreased={effective < base}
			>
				→ {effective}</span
			>{/if}</strong
	>
{/snippet}

{#snippet skillRows(rows: readonly SkillRow[])}
	{#each rows as row (row.stat.skill_type)}
		{@const stat = row.stat}
		{@const target = { Skill: stat.skill_type } as const}
		{@const actions =
			stat.training === "Untrained"
				? [action({ Train: { skill: stat.skill_type } }, target, "Train")]
				: stat.training === "Unusable"
					? []
					: raiseActions(target)}
		{@const details = detailLines(stat)}
		<details
			class="stat-row"
			name="character-stat"
			ontoggle={(event) => {
				if (event.currentTarget.open) void resolveSpells(stat);
			}}
		>
			<summary>
				<span
					>{name(stat.skill_type)}{@render progressionHint(
						stat,
						actions,
					)}{#if stat.training === "Unusable"}
						<small>Unusable</small>
					{/if}</span
				>
				{@render statValue(stat.base, stat.current)}
			</summary>
			{@render actionButtons(name(stat.skill_type), actions)}
			{#if details.length > 0}
				<ul>
					{#each details as line}<li>{line}</li>{/each}
				</ul>
			{/if}
		</details>
	{/each}
{/snippet}

<section class="character-sheet ui-body" aria-label="Character sheet">
	{#if sheet === null}
		<p role="status">{display.feedback ?? "Waiting for character details…"}</p>
	{:else}
		<header class="progression-summary">
			<div class="character-identity">
				<div class="level-emblem" aria-label={`Level ${sheet.level.level}`}>
					<small>Level</small><strong>{sheet.level.level}</strong>
				</div>
				<div class="identity-text">
					<strong class="character-name">{sheet.name ?? "Character"}</strong
					>{#if sheet.title}<span class="character-title">{sheet.title}</span
						>{/if}
				</div>
			</div>
			{#if BigInt(sheet.level.xpForNextLevel) > 0n}
				<div class="progress-track">
					<div class="track-label">
						<span>Level {sheet.level.level + 1}</span><span
							>{xp(sheet.level.xpIntoLevel)} / {xp(sheet.level.xpForNextLevel)} XP</span
						>
					</div>
					<progress
						aria-label="Level experience"
						max="100"
						value={progressPercent(
							sheet.level.xpIntoLevel,
							sheet.level.xpForNextLevel,
						)}
					></progress>
				</div>
			{/if}
			<div class="progression-balances">
				<div>
					<small>Available XP</small><strong>{xp(sheet.level.unspentXp)}</strong
					>
				</div>
				<div>
					<small>Skill credits</small><strong
						>{sheet.level.unspentSkillPoints}</strong
					>
				</div>
			</div>
			<!-- Retail reveals luminance at level 200 with nonzero capacity (acclient.c:275180). -->
			{#if sheet.level.level >= 200 && sheet.maximumLuminance !== null && BigInt(sheet.maximumLuminance) > 0n}
				<div class="progress-track luminance-track">
					<div class="track-label">
						<span>Luminance</span><span
							>{xp(sheet.level.availableLuminance)} / {xp(
								sheet.maximumLuminance,
							)}</span
						>
					</div>
					<progress
						aria-label="Luminance capacity"
						title="Available luminance versus storage capacity"
						max="100"
						value={progressPercent(
							sheet.level.availableLuminance,
							sheet.maximumLuminance,
						)}
					></progress>
				</div>
			{/if}
		</header>
		{#if display.feedback !== null}<p role="status" class="feedback">
				{display.feedback}
			</p>{/if}
		{#if spellLoadError !== null}<p role="status" class="feedback">
				{spellLoadError}
			</p>{/if}
		<h2>Attributes</h2>
		{#each sheet.attributes as stat (stat.attr_type)}
			{@const target = { Attribute: stat.attr_type } as const}
			{@const actions = raiseActions(target)}
			{@const details = detailLines(stat)}
			<details
				class="stat-row"
				name="character-stat"
				ontoggle={(event) => {
					if (event.currentTarget.open) void resolveSpells(stat);
				}}
			>
				<summary>
					<span
						>{name(stat.attr_type)}{@render progressionHint(
							stat,
							actions,
						)}</span
					>
					{@render statValue(stat.base, stat.current)}
				</summary>
				{@render actionButtons(name(stat.attr_type), actions)}
				{#if details.length > 0}
					<ul>
						{#each details as line}<li>{line}</li>{/each}
					</ul>
				{/if}
			</details>
		{/each}
		<h2>Vitals</h2>
		{#each sheet.vitals as stat (stat.vital_type)}
			{@const target = { Vital: stat.vital_type } as const}
			{@const actions = raiseActions(target)}
			{@const details = detailLines(stat)}
			<details
				class="stat-row"
				name="character-stat"
				ontoggle={(event) => {
					if (event.currentTarget.open) void resolveSpells(stat);
				}}
			>
				<summary>
					<span
						>Max {name(stat.vital_type)}{@render progressionHint(
							stat,
							actions,
						)}</span
					>
					{@render statValue(stat.base, stat.buffed_max)}
				</summary>
				{@render actionButtons(`Max ${name(stat.vital_type)}`, actions)}
				{#if details.length > 0}
					<ul>
						{#each details as line}<li>{line}</li>{/each}
					</ul>
				{/if}
			</details>
		{/each}
		{#if specializedSkills.length > 0}
			<h2>Specialized</h2>
			{@render skillRows(specializedSkills)}
		{/if}
		{#if trainedSkills.length > 0}
			<h2>Trained</h2>
			{@render skillRows(trainedSkills)}
		{/if}
		{#if untrainedSkills.length > 0}
			<details class="skill-group">
				<summary
					><h2>Untrained <small>({untrainedSkills.length})</small></h2></summary
				>
				{@render skillRows(untrainedSkills)}
			</details>
		{/if}
		<h2>Defenses</h2>
		<details
			class="stat-row"
			name="character-stat"
			ontoggle={(event) => {
				if (event.currentTarget.open)
					void resolveEffectSpells({ kind: "armor" });
			}}
		>
			<summary><span>Armor</span><strong>{sheet.armor}</strong></summary>
			<ul>
				{#each defenseEffectLines({ kind: "armor" }) as line}<li>
						{line}
					</li>{/each}
			</ul>
		</details>
		{#each RESISTANCE_ROWS as resistance (resistance.key)}
			{@const resistancePercent = Math.round(
				(1 - sheet.resistances[resistance.field]) * 100,
			)}
			<details
				class="stat-row"
				name="character-stat"
				ontoggle={(event) => {
					if (event.currentTarget.open)
						void resolveEffectSpells({
							kind: "floatProperty",
							key: resistance.key,
						});
				}}
			>
				<summary
					><span>{resistance.label}</span><strong
						title="Damage reduction from this resistance. Negative values indicate vulnerability. Excludes armor and other damage modifiers; some attacks can bypass resistance."
						>{resistancePercent}%</strong
					></summary
				>
				<ul>
					{#each defenseEffectLines( { kind: "floatProperty", key: resistance.key } ) as line}<li
						>
							{line}
						</li>{/each}
				</ul>
			</details>
		{/each}
		{@const vitaePenaltyPercent = Math.round((1 - sheet.vitae) * 100)}
		{#if vitaePenaltyPercent !== 0}<details
				class="stat-row"
				name="character-stat"
				ontoggle={(event) => {
					if (event.currentTarget.open)
						void resolveEffectSpells({ kind: "vitae" });
				}}
			>
				<summary
					><span>Vitae penalty</span><strong>{vitaePenaltyPercent}%</strong
					></summary
				>
				<ul>
					{#each defenseEffectLines({ kind: "vitae" }) as line}<li>
							{line}
						</li>{/each}
				</ul>
			</details>{/if}
	{/if}
</section>

<style>
	.character-sheet {
		height: 100%;
		overflow: auto;
		padding: 0.75rem;
	}
	.progression-summary {
		display: grid;
		gap: 0.75rem;
		padding: 0.85rem;
		margin-bottom: 1rem;
		border: 1px solid var(--ui-panel-border-color, var(--ui-color-border));
		border-top: 2px solid var(--ui-color-accent);
		border-radius: 0.35rem;
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--ui-color-accent) 14%, transparent),
			transparent
		);
	}
	.character-identity {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.level-emblem {
		display: grid;
		flex-shrink: 0;
		place-items: center;
		width: 3.3rem;
		height: 3.3rem;
		border: 1px solid var(--ui-color-accent);
		border-radius: 50%;
		color: var(--ui-color-accent);
	}
	.level-emblem small {
		font-size: 0.6rem;
		text-transform: uppercase;
		align-self: end;
	}
	.level-emblem strong {
		font-size: 1.4rem;
		line-height: 1.2;
		align-self: start;
	}
	.identity-text {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}
	.character-name {
		font-size: 1.3rem;
		overflow-wrap: anywhere;
	}
	.character-title {
		color: var(--ui-color-accent);
		font-size: 0.8rem;
	}
	.progress-track {
		display: grid;
		gap: 0.3rem;
	}
	.track-label {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.2rem 0.5rem;
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
	}
	.track-label span:first-child {
		font-weight: 600;
	}
	.progress-track progress {
		width: 100%;
		height: 0.45rem;
		appearance: none;
		border: 0;
		border-radius: 0.2rem;
		overflow: hidden;
		background: color-mix(in srgb, var(--ui-color-well) 30%, transparent);
		color: var(--ui-character-xp-color, var(--ui-color-accent));
	}
	.progress-track progress::-webkit-progress-bar {
		background: color-mix(in srgb, var(--ui-color-well) 30%, transparent);
	}
	.progress-track progress::-webkit-progress-value {
		background: currentColor;
	}
	.progress-track progress::-moz-progress-bar {
		background: currentColor;
	}
	.luminance-track progress {
		color: var(--ui-character-luminance-color, var(--ui-color-success));
	}
	.progression-balances {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.6rem;
	}
	.progression-balances > div {
		display: grid;
		gap: 0.2rem;
	}
	.progression-balances small {
		font-size: 0.65rem;
		opacity: 0.75;
	}
	.progression-balances strong {
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	h2 {
		margin: 0.9rem 0 0.3rem;
		font-size: 0.9rem;
		text-transform: uppercase;
	}
	.stat-row {
		border-top: 1px solid var(--ui-panel-border-color, var(--ui-color-border));
		interpolate-size: allow-keywords;
	}
	.skill-group > summary {
		grid-template-columns: minmax(0, 1fr) auto;
		margin: 0.9rem 0 0.3rem;
		padding: 0;
	}
	.skill-group > summary h2 {
		margin: 0;
	}
	.stat-row::details-content {
		block-size: 0;
		overflow: hidden;
		transition:
			block-size 180ms ease,
			content-visibility 180ms allow-discrete;
	}
	.stat-row[open]::details-content {
		block-size: auto;
	}
	summary {
		display: grid;
		grid-template-columns: minmax(6rem, 1fr) auto 1rem;
		gap: 0.4rem;
		align-items: center;
		padding: 0.45rem 0.35rem;
		cursor: pointer;
	}
	summary:hover,
	.stat-row[open] summary {
		background: color-mix(in srgb, var(--ui-color-text) 6%, transparent);
	}
	summary::marker {
		content: "";
	}
	summary::after {
		content: "⌄";
		font-size: 1rem;
		line-height: 1;
		opacity: 0.7;
		transition: transform 180ms ease;
	}
	.stat-row[open] summary::after,
	.skill-group[open] > summary::after {
		transform: rotate(180deg);
	}
	summary:focus-visible {
		outline: 2px solid var(--ui-color-focus);
		outline-offset: -2px;
	}
	summary strong {
		text-align: right;
	}
	summary small {
		font-weight: normal;
		opacity: 0.7;
	}
	.stat-row summary small {
		margin-left: 0.3rem;
	}
	.stat-effect.increased {
		color: var(--ui-character-buff-color, var(--ui-color-success));
	}
	.stat-effect.decreased {
		color: var(--ui-character-debuff-color, var(--ui-color-danger));
	}
	.upgrade-indicator {
		margin-left: 0.3rem;
		color: var(--ui-character-upgrade-color, var(--ui-color-success));
		font-size: 0.7rem;
		line-height: 1;
		text-shadow:
			0 0 0.3rem currentColor,
			0 0 0.7rem currentColor;
		vertical-align: 0.1em;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: 0.15rem 0.35rem 0.55rem;
	}
	.action-status {
		display: block;
		margin: 0.15rem 0.35rem 0.55rem;
		font-size: 0.75rem;
		opacity: 0.7;
	}
	.actions button {
		display: flex;
		min-width: 0;
		flex-shrink: 0;
		align-items: center;
		gap: 0.2rem;
		padding: 0.2rem 0.3rem;
		border: 1px solid var(--ui-panel-border-color, var(--ui-color-border));
		border-radius: 0.2rem;
		background: color-mix(in srgb, var(--ui-color-text) 8%, transparent);
		color: inherit;
		font: inherit;
		font-size: 0.75rem;
		text-align: left;
		cursor: pointer;
	}
	.actions button:hover:not(:disabled) {
		background: color-mix(in srgb, var(--ui-color-text) 16%, transparent);
	}
	.actions button.active:not(:disabled) {
		border-color: var(--ui-character-upgrade-color, var(--ui-color-success));
	}
	.action-triangle {
		color: var(--ui-character-upgrade-color, var(--ui-color-success));
		font-size: 0.65rem;
	}
	.actions button:focus-visible {
		outline: 2px solid var(--ui-color-focus);
		outline-offset: 1px;
	}
	.action-label {
		font-weight: 600;
	}
	.action-cost {
		min-width: 0;
		margin-left: auto;
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
		opacity: 0.9;
		overflow-wrap: anywhere;
	}
	.actions button:disabled {
		cursor: not-allowed;
		opacity: 0.75;
	}
	ul {
		margin: 0.2rem 0 0.7rem;
		padding-left: 1.4rem;
		font-size: 0.84rem;
	}
	li {
		margin: 0.2rem 0;
	}
	.feedback {
		color: var(--ui-color-warning);
	}
	@media (prefers-reduced-motion: reduce) {
		.stat-row::details-content,
		summary::after {
			transition: none;
		}
	}
</style>
