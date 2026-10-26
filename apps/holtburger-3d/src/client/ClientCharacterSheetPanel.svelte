<script lang="ts">
	import { untrack } from "svelte";
	import ClientSpellsPanel from "./ClientSpellsPanel.svelte";
	import UiQuantity from "../app/UiQuantity.svelte";
	import UiTabs from "../app/UiTabs.svelte";
	import UiTabPanel from "../app/UiTabPanel.svelte";
	import UpgradeTriangle from "../assets/icons/character-upgrade-triangle.svg?component";
	import { formatQuantity, progressPercent } from "../app/quantity-format";
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
		/** Retained window visibility pauses hidden display polling. */
		readonly visible: boolean;
		/** Confirmed magic stance permits the spellbook's existing cast action. */
		readonly castEnabled: boolean;
		/** Submit a cast through the app's existing command owner. */
		readonly onCastSpell: (spellId: number) => void;
		readonly spells: ClientSpellServices | null;
		readonly enchantments: ClientTimedEnchantments | null;
	}
	const {
		owner,
		spells,
		enchantments,
		visible,
		castEnabled,
		onCastSpell,
	}: Props = $props();
	const panelId = $props.id();
	/** App-local tab selection retains each panel's scroll and disclosure state. */
	let activeTab = $state<"progression" | "defenses" | "spells">("progression");
	/** Mount the resource-owning spellbook on its first selection and retain its local state. */
	let spellbookOpened = $state(false);
	const tabs = [
		{
			value: "progression",
			label: "Progression",
			id: `${panelId}-progression-tab`,
			panelId: `${panelId}-progression`,
		},
		{
			value: "defenses",
			label: "Defenses",
			id: `${panelId}-defenses-tab`,
			panelId: `${panelId}-defenses`,
		},
		{
			value: "spells",
			label: "Spells",
			id: `${panelId}-spells-tab`,
			panelId: `${panelId}-spells`,
		},
	] as const;
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
	$effect(() => {
		if (!visible) return;
		const source = owner;
		const refresh = () => {
			const next = source.read();
			if (next.revision !== display.revision) display = next;
		};
		// The comparison reads display; snapshots must not own this timer's lifetime.
		untrack(refresh);
		const timer = window.setInterval(
			refresh,
			CLIENT_TUNING.characterSheet.displayIntervalMs,
		);
		return () => window.clearInterval(timer);
	});

	const sheet = $derived(display.sheet);
	const titleSelection = $derived(sheet?.titleSelection ?? null);
	const titleEntries = $derived(
		(titleSelection?.entries ?? [])
			.filter((entry) => entry.id !== 0)
			.toSorted(
				(a, b) => titleLabel(a).localeCompare(titleLabel(b)) || a.id - b.id,
			),
	);
	const selectedTitleListed = $derived(
		titleEntries.some((entry) => entry.id === titleSelection?.selectedId),
	);
	function titleLabel(entry: {
		readonly id: number;
		readonly name: string | null;
	}): string {
		return entry.name ?? `Unknown title (ID ${entry.id})`;
	}
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
					return `Requires ${formatQuantity(world.InsufficientXp.required)} XP; ${formatQuantity(BigInt(world.InsufficientXp.available))} available`;
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
		readonly label: string;
		/** Structured cost lets the quantity component own display formatting. */
		readonly cost: {
			/** Exact amount quoted by progression evaluation. */
			readonly quantity: number;
			/** Currency consumed by this action. */
			readonly unit: "XP" | "credits";
		} | null;
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
		let cost: ReturnType<typeof action>["cost"] =
			quote === null
				? null
				: "Train" in intent
					? { quantity: quote.quote.credits_spent, unit: "credits" }
					: { quantity: quote.quote.xp_spent, unit: "XP" };
		if (
			cost === null &&
			evaluation?.result &&
			"Err" in evaluation.result &&
			typeof evaluation.result.Err === "object" &&
			"World" in evaluation.result.Err
		) {
			const reason = evaluation.result.Err.World;
			if (typeof reason === "object" && "InsufficientXp" in reason)
				cost = { quantity: reason.InsufficientXp.required, unit: "XP" };
			else if (typeof reason === "object" && "InsufficientCredits" in reason)
				cost = {
					quantity: reason.InsufficientCredits.required,
					unit: "credits",
				};
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
			label: actionLabel,
			cost,
			disabled: pending || quote === null,
			reason: pending
				? "Awaiting a server update for this stat"
				: evaluation?.result && "Err" in evaluation.result
					? unavailableReason(evaluation.result.Err)
					: cost === null
						? "Calculating cost…"
						: `${description} immediately for ${formatQuantity(cost.quantity)} ${cost.unit}`,
			purchase: () => {
				if (quote !== null) void owner.purchase(quote);
			},
		};
	}
	function raiseActions(target: StatTarget) {
		const single = action({ Raise: { target, ranks: 1 } }, target, "+1");
		const ten = action({ Raise: { target, ranks: 10 } }, target, "+10");
		// Keep the next-rank cost visible even when the player cannot afford it.
		const fixed = ten.disabled ? [single] : [single, ten];
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
	{#if buttons.length > 0 && buttons.every((button) => button.disabled && button.cost === null && button.reason === buttons[0].reason)}
		<span class="action-status">{buttons[0].reason}</span>
	{:else if buttons.length > 0}
		{@const selected =
			buttons.find((button) => button.key === hoveredAction) ??
			buttons.find((button) => button.key === focusedAction) ??
			buttons[0]}
		<span class="actions">
			{#each buttons as button}
				<button
					type="button"
					disabled={button.disabled}
					title={button.reason}
					aria-label={`${statName} ${button.label}: ${button.reason}`}
					class="ui-stat-action"
					class:active={selected.key === button.key}
					onpointerenter={() => (hoveredAction = button.key)}
					onpointerleave={() => (hoveredAction = null)}
					onfocus={() => (focusedAction = button.key)}
					onblur={() => (focusedAction = null)}
					onclick={button.purchase}
				>
					<span class="ui-stat-action-shape" aria-hidden="true"
						><UpgradeTriangle /></span
					>
					<span class="ui-stat-action-label">{button.label}</span>
				</button>
			{/each}
			<small class="action-cost">
				{#if selected.cost !== null}
					<UiQuantity value={selected.cost.quantity} /> {selected.cost.unit}
				{:else}—{/if}
			</small>
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

<section
	class="character-sheet ui-body ui-tabbed-panel"
	aria-label="Character sheet"
>
	<UiTabs
		label="Character sheet tabs"
		{tabs}
		selected={activeTab}
		onSelect={(value) => {
			activeTab = value;
			if (value === "spells") spellbookOpened = true;
		}}
	/>
	<UiTabPanel
		id={`${panelId}-progression`}
		labelledBy={`${panelId}-progression-tab`}
		active={activeTab === "progression"}
		scroll={false}
	>
		<div class="progression-page">
			<div class="progression-scroll">
				{#if sheet === null}
					<p role="status">
						{display.feedback ?? "Waiting for character details…"}
					</p>
				{:else}
					<header class="progression-summary">
						<div class="character-identity">
							<div
								class="level-emblem"
								aria-label={`Level ${sheet.level.level}`}
							>
								<small>Level</small><strong>{sheet.level.level}</strong>
							</div>
							<div class="identity-text">
								<strong class="character-name"
									>{sheet.name ?? "Character"}</strong
								>{#if titleSelection === null && sheet.title}<span
										class="character-title">{sheet.title}</span
									>{/if}
								<label
									>Title
									<select
										class="ui-input"
										aria-label="Character title"
										value={titleSelection?.selectedId ?? 0}
										disabled={titleSelection === null ||
											titleEntries.length === 0}
										onchange={(event) =>
											void owner.selectTitle(Number(event.currentTarget.value))}
									>
										{#if titleSelection === null}
											<option value={0} disabled>Loading titles…</option>
										{:else if !selectedTitleListed}
											<option value={titleSelection.selectedId} disabled>
												{titleEntries.length === 0
													? "No earned titles"
													: titleSelection.selectedId === 0
														? "No title selected"
														: `Current title (ID ${titleSelection.selectedId})`}
											</option>
										{/if}
										{#each titleEntries as entry (entry.id)}
											<option value={entry.id}>{titleLabel(entry)}</option>
										{/each}
									</select>
								</label>
							</div>
						</div>
						{#if BigInt(sheet.level.xpForNextLevel) > 0n}
							<div class="progress-track">
								<div class="track-label">
									<span>Level {sheet.level.level + 1}</span><span
										><UiQuantity value={BigInt(sheet.level.xpIntoLevel)} /> / <UiQuantity
											value={BigInt(sheet.level.xpForNextLevel)}
										/> XP</span
									>
								</div>
								<progress
									class="ui-progress"
									aria-label="Level experience"
									max="100"
									value={progressPercent(
										BigInt(sheet.level.xpIntoLevel),
										BigInt(sheet.level.xpForNextLevel),
									)}
								></progress>
							</div>
						{/if}

						<!-- Retail reveals luminance at level 200 with nonzero capacity (acclient.c:275180). -->
						{#if sheet.level.level >= 200 && sheet.maximumLuminance !== null && BigInt(sheet.maximumLuminance) > 0n}
							<div class="progress-track luminance-track">
								<div class="track-label">
									<span>Luminance</span><span
										><UiQuantity
											value={BigInt(sheet.level.availableLuminance)}
										/> / <UiQuantity
											value={BigInt(sheet.maximumLuminance)}
										/></span
									>
								</div>
								<progress
									class="ui-progress"
									aria-label="Luminance capacity"
									title="Available luminance versus storage capacity"
									max="100"
									value={progressPercent(
										BigInt(sheet.level.availableLuminance),
										BigInt(sheet.maximumLuminance),
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
					<h2 class="ui-section-heading">Attributes</h2>
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
					<h2 class="ui-section-heading">Vitals</h2>
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
						<h2 class="ui-section-heading">Specialized</h2>
						{@render skillRows(specializedSkills)}
					{/if}
					{#if trainedSkills.length > 0}
						<h2 class="ui-section-heading">Trained</h2>
						{@render skillRows(trainedSkills)}
					{/if}
					{#if untrainedSkills.length > 0}
						<details class="skill-group">
							<summary
								><h2 class="ui-section-heading">
									Untrained <small>({untrainedSkills.length})</small>
								</h2></summary
							>
							{@render skillRows(untrainedSkills)}
						</details>
					{/if}
				{/if}
			</div>
			{#if sheet !== null}
				<footer class="progression-balances">
					<div>
						<small>Available XP</small><strong
							><UiQuantity value={BigInt(sheet.level.unspentXp)} /></strong
						>
					</div>
					<div>
						<small>Skill credits</small><strong
							>{sheet.level.unspentSkillPoints}</strong
						>
					</div>
				</footer>
			{/if}
		</div>
	</UiTabPanel>
	<UiTabPanel
		id={`${panelId}-defenses`}
		labelledBy={`${panelId}-defenses-tab`}
		active={activeTab === "defenses"}
	>
		{#if sheet === null}
			<p role="status">
				{display.feedback ?? "Waiting for character details…"}
			</p>
		{:else}
			{#if spellLoadError !== null}<p role="status" class="feedback">
					{spellLoadError}
				</p>{/if}
			<h2 class="ui-section-heading">Defenses</h2>
			<details
				class="stat-row"
				name="character-defense"
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
					name="character-defense"
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
					name="character-defense"
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
	</UiTabPanel>
	<UiTabPanel
		id={`${panelId}-spells`}
		labelledBy={`${panelId}-spells-tab`}
		active={activeTab === "spells"}
		scroll={false}
	>
		{#if spellbookOpened}
			{#if spells !== null}
				{#key spells}
					<ClientSpellsPanel
						{spells}
						visible={visible && activeTab === "spells"}
						{castEnabled}
						{onCastSpell}
					/>
				{/key}
			{:else}
				<p role="status">Waiting for spellbook…</p>
			{/if}
		{/if}
	</UiTabPanel>
</section>

<style>
	@layer components {
		.character-sheet {
			overflow: hidden;
		}
		.progression-page {
			display: grid;
			grid-template-rows: minmax(0, 1fr) auto;
			height: 100%;
			min-height: 0;
		}
		.progression-scroll {
			min-height: 0;
			overflow: auto;
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
			width: max(3.3rem, 4em);
			min-height: max(3.3rem, 4em);
			border: 1px solid var(--ui-color-accent);
			border-radius: 50%;
			color: var(--ui-color-accent);
		}
		.level-emblem small {
			font-size: calc(var(--ui-font-size-micro) * var(--ui-text-scale));
			text-transform: uppercase;
			align-self: end;
		}
		.level-emblem strong {
			font-size: calc(var(--ui-font-size-heading-1) * var(--ui-text-scale));
			line-height: 1.2;
			align-self: start;
		}
		.identity-text {
			display: grid;
			flex: 1;
			gap: 0.2rem;
			min-width: 0;
		}
		.identity-text label {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			align-items: center;
			gap: 0.4rem;
		}
		.identity-text select {
			min-width: 0;
			width: 100%;
		}
		.character-name {
			font-size: calc(var(--ui-font-size-heading-1) * var(--ui-text-scale));
			overflow-wrap: anywhere;
		}
		.character-title {
			color: var(--ui-color-accent);
			font-size: calc(var(--ui-font-size-body) * var(--ui-text-scale));
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
			font-size: calc(var(--ui-font-size-micro) * var(--ui-text-scale));
			font-variant-numeric: tabular-nums;
		}
		.track-label span:first-child {
			font-weight: 600;
		}
		.luminance-track progress {
			color: var(--ui-character-luminance-color, var(--ui-color-success));
		}
		.progression-balances {
			padding-top: 0.6rem;
			border-top: 1px solid var(--ui-panel-border-color, var(--ui-color-border));
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.6rem;
		}
		.progression-balances > div {
			display: grid;
			gap: 0.2rem;
		}
		.progression-balances small {
			font-size: calc(var(--ui-font-size-micro) * var(--ui-text-scale));
			opacity: 0.75;
		}
		.progression-balances strong {
			font-size: calc(var(--ui-font-size-body) * var(--ui-text-scale));
			font-variant-numeric: tabular-nums;
			overflow-wrap: anywhere;
		}
		.character-sheet .ui-section-heading {
			margin-top: 0.9rem;
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
		.skill-group > summary .ui-section-heading {
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
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
			opacity: 0.7;
		}
		.action-cost {
			min-width: 0;
			margin-left: auto;
			font-size: calc(var(--ui-font-size-micro) * var(--ui-text-scale));
			font-variant-numeric: tabular-nums;
			line-height: 1.1;
			opacity: 0.9;
			overflow-wrap: anywhere;
		}
		ul {
			margin: 0.2rem 0 0.7rem;
			padding-left: 1.4rem;
			font-size: calc(var(--ui-font-size-body) * var(--ui-text-scale));
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
	}
</style>
