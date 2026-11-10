/** Focused browser check for the production Character panel and session quote path. */
export async function probeCharacterSheet(
	client,
	evaluateExpression,
	delay,
	characterGuid = 1,
) {
	await evaluateExpression(
		client,
		`(() => {
		const harness = globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__;
		const target = { Attribute: 'StrengthAttr' };
		const otherTarget = { Attribute: 'EnduranceAttr' };
		const formula = { modifiers: { contributions: [{ operation: 'additive', channel: 'ordinary', effective: { spellId: 123, layer: 0 }, overridden: [{ spellId: 456, layer: 0 }], value: 2 }], multiplier: 1, additive: 2 }, finalization: { before_rounding: 13, rounded: 13, minimum: 1, result: 13 } };
		const inheritedFormula = { first: { attribute: 'StrengthAttr', base: 11, effective: 13, modifiers: formula.modifiers.contributions }, second: { attribute: 'EnduranceAttr', base: 11, effective: 11, modifiers: [] }, divisor: 3, base_before_rounding: 22 / 3, effective_before_rounding: 24 / 3, base_result: 7, effective_result: 8 };
		const plain = { modifiers: { contributions: [], multiplier: 1, additive: 0 }, finalization: { before_rounding: 11, rounded: 11, minimum: 1, result: 11 } };
		const contribution = (spellId, value) => ({ contributions: [{ operation: 'additive', channel: 'ordinary', effective: { spellId, layer: 1 }, overridden: [], value }], multiplier: 1, additive: value });
		const sheet = {
			character: ${characterGuid},
			name: 'Delulu', title: 'Adventurer', maximumLuminance: '1000000',
            titleSelection: { selectedId: 1, entries: [{ id: 42, name: 'Warrior' }, { id: 1, name: 'Adventurer' }, { id: 999, name: null }, { id: 0, name: null }] },
			level: { level: 200, currentXp: '9007199254740993', unspentXp: '9007199254740993', unspentSkillPoints: 2, availableLuminance: '250000', nextLevelXp: '9007199254741993', xpIntoLevel: '100', xpForNextLevel: '1000' },
			attributes: [
				{ attr_type: 'StrengthAttr', ranks: 1, start: 10, spent_xp: 100, next_rank_xp: 300, base: 11, current: 13, breakdown: formula },
				{ attr_type: 'EnduranceAttr', ranks: 1, start: 10, spent_xp: 100, next_rank_xp: 300, base: 11, current: 11, breakdown: plain },
				{ attr_type: 'QuicknessAttr', ranks: 1, start: 10, spent_xp: 100, next_rank_xp: 300, base: 11, current: 11, breakdown: plain },
			],
			vitals: [
				{ vital_type: 'Health', ranks: 4, start: 100, spent_xp: 1000, next_rank_xp: null, base: 100, buffed_max: 102, current: 70, breakdown: { formula: null, modifiers: contribution(2305, 2), finalization: { before_rounding: 102, rounded: 102, minimum: 0, result: 102 } } },
				{ vital_type: 'Stamina', ranks: 0, start: 90, spent_xp: 0, next_rank_xp: null, base: 90, buffed_max: 90, current: 40, breakdown: { formula: null, modifiers: plain.modifiers, finalization: { before_rounding: 90, rounded: 90, minimum: 0, result: 90 } } },
				{ vital_type: 'Mana', ranks: 0, start: 80, spent_xp: 0, next_rank_xp: null, base: 80, buffed_max: 70, current: 30, breakdown: { formula: null, modifiers: contribution(2307, -10), finalization: { before_rounding: 70, rounded: 70, minimum: 0, result: 70 } } },
			],
			skills: [{ stat: { skill_type: 'HeavyWeapons', ranks: 1, init: 0, spent_xp: 100, next_rank_xp: 200, base: 10, current: 13, training: 'Specialized', trained_cost: 2, specialized_cost: 4, breakdown: { formula: { Applied: inheritedFormula }, base_bonuses: [], current_bonuses: [], vitae: 0.9, modifiers: contribution(2306, 4), wide_modifiers: [], wide_additive_rounded: 0, finalization: { before_rounding: 13, rounded: 13, minimum: 0, result: 13 } } }, description: 'A specialized skill', availableInEor: true }], armor: 1, vitae: 0.9,
			resistances: { slash: 0.9, pierce: 1, bludgeon: 1, fire: 1, cold: 1.2, acid: 1, electric: 1, nether: 1 },
			guardedTargets: [],
		};
		globalThis.__CHARACTER_SHEET_PROBE_BASE__ = sheet;
		harness.setCharacterSheet(sheet);
		const effect = (spellId, kind, statModValue, remainingSeconds = null, layer = 1) => ({ key: { spellId, layer }, spellCategory: 7, powerLevel: 5, kind, remainingSeconds, statModType: 1, statModKey: 1, statModValue });
		harness.setEnchantments({ cooldowns: [],
			instances: [effect(123, 'beneficial', 2, 90, 0), effect(456, 'beneficial', 1, 120, 0), effect(2303, 'beneficial', 0.9), effect(2304, 'beneficial', 0.9), effect(2305, 'beneficial', 2), effect(2306, 'beneficial', 4), effect(2307, 'harmful', -10), effect(666, 'vitae', 0.9)],
			groups: [
				{ affectedStat: { kind: 'attribute', key: 1 }, statName: 'Strength', operation: 'additive', channel: 'ordinary', spellCategory: 7, effective: { spellId: 123, layer: 0 }, overridden: [{ spellId: 456, layer: 0 }] },
				{ affectedStat: { kind: 'armor' }, operation: 'additive', channel: 'ordinary', spellCategory: 7, effective: { spellId: 2303, layer: 1 }, overridden: [] },
				{ affectedStat: { kind: 'floatProperty', key: 64 }, statName: 'ResistSlash', operation: 'multiplicative', channel: 'ordinary', spellCategory: 7, effective: { spellId: 2304, layer: 1 }, overridden: [] },
				{ affectedStat: { kind: 'vital', key: 1 }, statName: 'MaxHealth', operation: 'additive', channel: 'ordinary', spellCategory: 7, effective: { spellId: 2305, layer: 1 }, overridden: [] },
				{ affectedStat: { kind: 'vital', key: 3 }, statName: 'MaxMana', operation: 'additive', channel: 'ordinary', spellCategory: 7, effective: { spellId: 2307, layer: 1 }, overridden: [] },
				{ affectedStat: { kind: 'skill', key: 44 }, statName: 'HeavyWeapons', operation: 'additive', channel: 'ordinary', spellCategory: 7, effective: { spellId: 2306, layer: 1 }, overridden: [] },
			],
		});
		const request = harness.inventoryDragCommands().filter((entry) => entry.command === 'evaluate_client_progression').at(-1);
		if (!request) throw new Error('Character sheet did not request shared quotes.');
		harness.replyProgression({ requestId: request.args.requestId, evaluations: [{
			intent: { Raise: { target, ranks: 1 } },
			result: { Ok: { scope_id: 9, quote: { character: ${characterGuid}, intent: { Raise: { target, ranks: 1 } }, target_state: { training: null, ranks: 1, spent_xp: 100 }, resulting_ranks: 2, xp_spent: 200, credits_spent: 0, available_xp: '9007199254740993', available_credits: 2 } } },
		}, {
			intent: { Raise: { target: otherTarget, ranks: 10 } },
			result: { Ok: { scope_id: 9, quote: { character: ${characterGuid}, intent: { Raise: { target: otherTarget, ranks: 10 } }, target_state: { training: null, ranks: 1, spent_xp: 100 }, resulting_ranks: 11, xp_spent: 1000, credits_spent: 0, available_xp: '9007199254740993', available_credits: 2 } } },
		}].flatMap((evaluation) => {
			const intent = { RaiseMax: { target: evaluation.intent.Raise.target } };
			return [evaluation, { intent, result: { Ok: { ...evaluation.result.Ok, quote: { ...evaluation.result.Ok.quote, intent } } } }];
		}) });
		document.querySelector('nav[aria-label="Game shortcuts"] button[aria-label="Character"]').click();
	})()`,
	);

	await delay(250);
	await evaluateExpression(
		client,
		`(() => {

  const icons = [...document.querySelectorAll('.character-sheet .stat-icon')];
  if (icons.length === 0 || icons.some(cell => { const icon = cell.querySelector('img'); return !icon || !icon.complete || icon.naturalWidth === 0; })) throw new Error('Progression stat artwork did not prepare real images');
  const attribute = document.querySelector('[data-stat-icon=' + CSS.escape(JSON.stringify({Attribute: 'StrengthAttr'})) + '] img');
  const synergy = document.querySelector('[aria-label="Strength skill synergies"] .stat-icon img');
  const skill = document.querySelector('summary [data-stat-icon=' + CSS.escape(JSON.stringify({Skill: 'HeavyWeapons'})) + '] img');
  if (!attribute || !synergy || !skill || synergy.src !== skill.src) throw new Error('Stat rows and synergies did not share canonical artwork');
const synergies = document.querySelector('[aria-label="Strength skill synergies"]');
  if (!synergies || !synergies.textContent.includes('Heavy Weapons × 0.33')) throw new Error('Attribute disclosure did not show its trained skill formula coefficient');
  if (document.querySelector('[aria-label="Quickness skill synergies"]')) throw new Error('Unrelated attribute gained a skill synergy');
 })()`,
	);
	const titles = await evaluateExpression(
		client,
		`(() => {
        const harness = globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__;
        const select = document.querySelector('select[aria-label="Character title"]');
        if (!select || select.disabled || select.value !== '1') throw new Error('Initial title selection is missing.');
        const labels = [...select.options].map((option) => option.textContent.trim());
        if (JSON.stringify(labels) !== JSON.stringify(['Adventurer', 'Unknown title (ID 999)', 'Warrior'])) throw new Error('Title entries were not localized, sorted, or zero-filtered.');
        select.value = '42';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const requests = harness.inventoryDragCommands().filter((entry) => entry.command === 'set_client_character_title');
        if (requests.length !== 1 || requests[0].args.character !== ${characterGuid} || requests[0].args.titleId !== 42) throw new Error('Title selection did not dispatch the captured character and title.');
        return { initial: true, dispatched: true };
    })()`,
	);
	await delay(250);
	await evaluateExpression(
		client,
		`(() => {
        const select = document.querySelector('select[aria-label="Character title"]');
        if (select.value !== '42' || select.disabled) throw new Error('Optimistic title selection was not retained without confirmation.');
        if (document.querySelector('.character-sheet .character-title')) throw new Error('Optimistic title selection left a contradictory title readout.');
        globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setCharacterSheet(globalThis.__CHARACTER_SHEET_PROBE_BASE__);
    })()`,
	);
	await delay(250);
	await evaluateExpression(
		client,
		`(() => {
        if (document.querySelector('select[aria-label="Character title"]').value !== '1') throw new Error('Server title replacement did not reconcile selection.');
    })()`,
	);

	for (const [selection, expected, disabled] of [
		[null, "Loading titles…", true],
		[{ selectedId: 0, entries: [] }, "No earned titles", true],
		[
			{ selectedId: 777, entries: [{ id: 1, name: "Adventurer" }] },
			"Current title (ID 777)",
			false,
		],
	]) {
		await evaluateExpression(
			client,
			`globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setCharacterSheet({ ...globalThis.__CHARACTER_SHEET_PROBE_BASE__, titleSelection: ${JSON.stringify(selection)} })`,
		);
		await delay(250);
		await evaluateExpression(
			client,
			`(() => {
            const select = document.querySelector('select[aria-label="Character title"]');
            if (select.disabled !== ${disabled} || select.selectedOptions[0].textContent.trim() !== ${JSON.stringify(expected)}) throw new Error('Unavailable, empty, or unlisted title state silently selected a title.');
        })()`,
		);
	}
	await evaluateExpression(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setCharacterSheet(globalThis.__CHARACTER_SHEET_PROBE_BASE__)",
	);
	await delay(250);
	const first = await evaluateExpression(
		client,
		`(async () => {
		const harness = globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__;
		const panel = document.querySelector('[aria-label="Character"] .character-sheet');
		if (!panel) throw new Error('Character panel is missing.');
		const balance = panel.querySelector('.progression-balances strong [title]');
		if (balance?.title !== '9,007,199,254,740,993' || balance.querySelector('[aria-hidden="true"]')?.textContent !== '9007.2T') throw new Error('Character XP did not pair a compact balance with its exact tooltip.');
		if (panel.querySelector('.character-name')?.textContent !== 'Delulu' || panel.querySelector('select[aria-label="Character title"]')?.selectedOptions[0]?.textContent.trim() !== 'Adventurer') throw new Error('Character identity is missing.');
		if (panel.querySelector('progress[aria-label="Level experience"]')?.value !== 10 || panel.querySelector('progress[aria-label="Luminance capacity"]')?.value !== 25) throw new Error('Character progress bars did not reflect authoritative balances.');
		if (document.querySelector('.character-hud progress')?.value !== 10) throw new Error('HUD experience did not reflect authoritative level progress.');
		const headings = [...panel.querySelectorAll('.progression-scroll > h2')].map((heading) => heading.textContent.trim());
		if (!headings.includes('Specialized') || headings.includes('Trained') || headings.includes('Skills')) throw new Error('Specialized skills did not have their own major section.');
		if (!panel.textContent.includes('Armor') || !panel.textContent.includes('Slash resistance') || !panel.textContent.includes('Vitae penalty')) throw new Error('Character defenses or vitae are missing.');
		const effectRow = (label) => [...panel.querySelectorAll('details.stat-row')].find((candidate) => candidate.querySelector('summary')?.textContent.includes(label));
		for (const [label, value] of [['Slash resistance', '10%'], ['Pierce resistance', '0%'], ['Cold resistance', '-20%']]) {
			const resistance = effectRow(label)?.querySelector('summary strong');
			if (resistance?.textContent !== value || !resistance.title.includes('Excludes armor')) throw new Error(label + ' did not explain its resistance percentage.');
		}
		const strength = effectRow('Strength');
		if (!strength?.querySelector('summary > span .upgrade-indicator') || !effectRow('Endurance')?.querySelector('summary > span .upgrade-indicator') || effectRow('Quickness')?.querySelector('.upgrade-indicator')) throw new Error('Upgrade triangles did not match affordable quotes.');
		for (const [label, base, effective, current] of [['Max Health', 100, 102, 70], ['Max Stamina', 90, 90, 40], ['Max Mana', 80, 70, 30]]) {
			const summary = effectRow(label)?.querySelector('summary')?.textContent;
			if (!summary?.includes(String(base)) || (base !== effective && !summary.includes('→ ' + effective)) || summary.includes(String(current))) throw new Error(label + ' did not show its maximum instead of the current pool.');
		}
		const progression = panel.querySelector('[role="tabpanel"][id$="-progression"]');
		const defenses = panel.querySelector('[role="tabpanel"][id$="-defenses"]');
		const selectTab = async (name) => {
			[...panel.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === name).click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
		};
		const balances = progression.querySelector('.progression-balances');
		for (const [tab, labels] of [['Progression', ['Strength', 'Health', 'Heavy Weapons']], ['Defenses', ['Armor', 'Slash resistance', 'Vitae penalty']]]) {
			await selectTab(tab);
			for (const label of labels) {
				const effect = effectRow(label);
				if (!effect) throw new Error(label + ' row is missing.');
				effect.open = true;
				if (effect.closest('[role="tabpanel"]').querySelectorAll('details.stat-row[open]').length !== 1) throw new Error('Character tab rows did not behave as a single-selection accordion.');
			}
		}
		if (!progression.hidden || defenses.hidden || !balances.closest('[hidden]') || !effectRow('Heavy Weapons').open) throw new Error('Defenses did not retain the hidden progression tab and its balances.');
		if (!effectRow('Strength').textContent.includes(': +2') || effectRow('Strength').textContent.includes('Overridden:') || effectRow('Strength').textContent.includes('1:30')) throw new Error('Stat row did not show only its applied enchantment and bonus.');
		if (!effectRow('Heavy Weapons').textContent.includes('Formula: (Strength + Endurance) ÷ 3') || !effectRow('Heavy Weapons').textContent.includes('(via Strength): +2') || !effectRow('Heavy Weapons').textContent.includes('Vitae penalty: ×0.9') || effectRow('Heavy Weapons').textContent.includes('Starting value: 0') || effectRow('Heavy Weapons').querySelector('summary').textContent.includes('Specialized')) throw new Error('Specialized skill row repeated its section label or showed excess detail.');
		if (effectRow('Heavy Weapons').querySelector('.skill-description')?.textContent !== 'A specialized skill') throw new Error('Expanded skill description is missing.');
		if (!effectRow('Health').textContent.includes('+2') || !effectRow('Heavy Weapons').textContent.includes('+4')) throw new Error('Vital or skill effect values are missing from their rows.');
		if (!effectRow('Armor').textContent.includes('+0.9') || !effectRow('Slash resistance').textContent.includes('×0.9')) throw new Error('Applied effect values are missing from defense rows.');
		const plainDefense = effectRow('Pierce resistance');
		plainDefense.open = true;
		if (!plainDefense.textContent.includes('No active effects')) throw new Error('A plain resistance row has no clear empty state.');
		await selectTab('Progression');
		const row = strength;
		row.querySelector('summary').click();
		if (!row.open || !plainDefense.open || effectRow('Heavy Weapons').open) throw new Error('Progression drawers did not stay independent of the retained defenses.');
		const controls = [...row.querySelectorAll('.actions button')];
		if (controls.length !== 1 || controls[0].title.includes('Raise maximum')) throw new Error('Unavailable or duplicate one-rank controls remained visible.');
		const button = [...row.querySelectorAll('button')].find((candidate) => candidate.textContent.includes('+1'));
		if (!button || button.disabled) throw new Error('The one-rank quote is unavailable.');
		button.click(); button.click();
		const other = [...panel.querySelectorAll('details.stat-row')].find((candidate) => candidate.textContent.includes('Endurance'));
		other.querySelector('summary').click();
		const otherTen = [...other.querySelectorAll('button')].find((candidate) => candidate.textContent.includes('+10'));
		if (other.querySelectorAll('.actions button').length !== 2 || otherTen?.title.includes('Raise maximum')) throw new Error('Duplicate ten-rank maximum control remained visible.');
		if (!otherTen || otherTen.disabled) throw new Error('Another target was locked or its ten-rank quote was lost.');
		otherTen.dispatchEvent(new PointerEvent('pointerenter'));
		await new Promise((resolve) => setTimeout(resolve, 0));
		if (other.querySelector('.action-cost [title]')?.title !== '1,000') throw new Error('Hovered bulk action did not show its quoted cost.');
		otherTen.click();
		const submissions = harness.inventoryDragCommands().filter((entry) => entry.command === 'submit_client_progression');
		if (submissions.length !== 2 || submissions[0].args.quote.quote.xp_spent !== 200 || submissions[1].args.quote.quote.xp_spent !== 1000) throw new Error('Repeat click or quoted spend was incorrect.');
		document.querySelector('[aria-label="Close Character"]').click();
		document.querySelector('nav[aria-label="Game shortcuts"] button[aria-label="Character"]').click();
		return { exactXp: true, immediateSubmissions: submissions.length };
	})()`,
	);
	await delay(250);
	const reopened = await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Character"] .character-sheet');
		const row = [...panel.querySelectorAll('details.stat-row')].find((candidate) => candidate.querySelector('summary')?.textContent.includes('Strength'));
		if (row?.querySelector('.upgrade-indicator')) throw new Error('Pending stat still advertises an available upgrade.');
		if (!row?.querySelector('.actions button')?.disabled || row.querySelector('.action-cost [title]')?.title !== '200') throw new Error('Pending stat did not retain a disabled action and its quoted cost.');
		row.open = true;
		if (!row.textContent.includes('Starting value: 10') || !row.textContent.includes(': +2') || row.textContent.includes('Final rounding:') || row.textContent.includes('Overridden:') || row.textContent.includes('Purchased ranks:')) throw new Error('Expanded details did not stay focused on starting value and applied enchantments.');
		return { ...${JSON.stringify(first)}, pendingAfterReopen: true, expanded: true };
	})()`,
	);
	const skillEvaluations = await evaluateExpression(
		client,
		`(() => {
		const harness = globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__;
		const previous = globalThis.__CHARACTER_SHEET_PROBE_BASE__;
		const modifiers = { contributions: [], multiplier: 1, additive: 0 };
		const contribution = (spellId, value) => ({ contributions: [{ operation: 'additive', channel: 'ordinary', effective: { spellId, layer: 1 }, overridden: [], value }], multiplier: 1, additive: value });
		const finalization = (result) => ({ before_rounding: result, rounded: result, minimum: 0, result });
		const skillBreakdown = { formula: 'NoFormula', base_bonuses: [], current_bonuses: [], vitae: 0.8, modifiers, wide_modifiers: [], wide_additive_rounded: 0, finalization: finalization(9) };
		const sheet = {
			...previous,
			level: { ...previous.level, unspentXp: '100' },
			attributes: previous.attributes.map((stat) => stat.attr_type === 'StrengthAttr' ? { ...stat, current: 11, breakdown: { modifiers, finalization: { ...finalization(11), minimum: 1 } } } : stat.attr_type === 'QuicknessAttr' ? { ...stat, current: 9, breakdown: { modifiers: contribution(2308, -2), finalization: { ...finalization(9), minimum: 1 } } } : stat),
			armor: 321,
			resistances: { ...previous.resistances, slash: 0.75 },
			vitae: 0.8,
			vitals: [{ vital_type: 'Health', ranks: 4, start: 100, spent_xp: 1000, next_rank_xp: null, base: 104, buffed_max: 104, current: 70, breakdown: { formula: null, modifiers, finalization: finalization(104) } }],
			skills: [{
				stat: { skill_type: 'HeavyWeapons', ranks: 1, init: 0, spent_xp: 100, next_rank_xp: 200, base: 11, current: 9, training: 'Trained', trained_cost: 2, specialized_cost: 4, breakdown: skillBreakdown },
				description: 'A trained skill', availableInEor: true,
			}, {
				stat: { skill_type: 'MeleeDefense', ranks: 0, init: 0, spent_xp: 0, next_rank_xp: null, base: 0, current: 0, training: 'Untrained', trained_cost: 2, specialized_cost: 4, breakdown: { ...skillBreakdown, formula: 'Unusable', finalization: finalization(0) } },
				description: 'An untrained skill', availableInEor: true,
			}],
		};
		harness.setCharacterSheet(sheet);
		harness.setEnchantments({ cooldowns: [], instances: [{ key: { spellId: 666, layer: 1 }, spellCategory: 7, powerLevel: 5, kind: 'vitae', remainingSeconds: null, statModType: 1, statModKey: 1, statModValue: 0.8 }, { key: { spellId: 2308, layer: 1 }, spellCategory: 7, powerLevel: 5, kind: 'harmful', remainingSeconds: null, statModType: 1, statModKey: 3, statModValue: -2 }], groups: [{ affectedStat: { kind: 'attribute', key: 3 }, statName: 'Quickness', operation: 'additive', channel: 'ordinary', spellCategory: 7, effective: { spellId: 2308, layer: 1 }, overridden: [] }] });
		const request = harness.inventoryDragCommands().filter((entry) => entry.command === 'evaluate_client_progression').at(-1);
		if (!request) throw new Error('Resource change did not request fresh quotes.');
		const quickness = { Attribute: 'QuicknessAttr' };
		const health = { Vital: 'Health' };
		const heavy = { Skill: 'HeavyWeapons' };
		const rankCap = (intent) => ({ intent, result: { Err: { World: 'RankCap' } } });
		const evaluations = [
			{ intent: { Raise: { target: quickness, ranks: 1 } }, result: { Err: { World: { InsufficientXp: { required: 200, available: '100' } } } } },
			rankCap({ Raise: { target: health, ranks: 1 } }),
			rankCap({ Raise: { target: health, ranks: 10 } }),
			rankCap({ RaiseMax: { target: health } }),
			{ intent: { Train: { skill: 'MeleeDefense' } }, result: { Ok: { scope_id: 9, quote: { character: ${characterGuid}, intent: { Train: { skill: 'MeleeDefense' } }, target_state: { training: 'Untrained', ranks: 0, spent_xp: 0 }, resulting_ranks: 0, xp_spent: 0, credits_spent: 2, available_xp: '100', available_credits: 2 } } } },
			{ intent: { RaiseMax: { target: heavy } }, result: { Ok: { scope_id: 9, quote: { character: ${characterGuid}, intent: { RaiseMax: { target: heavy } }, target_state: { training: 'Trained', ranks: 1, spent_xp: 100 }, resulting_ranks: 5, xp_spent: 100, credits_spent: 0, available_xp: '100', available_credits: 2 } } } },
		];
		harness.replyProgression({ requestId: request.args.requestId, evaluations });
		return evaluations;
	})()`,
	);
	await delay(250);
	const actions = await evaluateExpression(
		client,
		`(async () => {
		const harness = globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__;
		const panel = document.querySelector('[aria-label="Character"] .character-sheet');
		const slash = [...panel.querySelectorAll('details.stat-row')].find((candidate) => candidate.querySelector('summary')?.textContent.includes('Slash resistance'));
		if (!panel.textContent.includes('321') || slash?.querySelector('summary strong')?.textContent !== '25%' || !panel.textContent.includes('20%')) throw new Error('External defense or vitae changes did not refresh the open Character panel.');
		const headings = [...panel.querySelectorAll('.progression-scroll > h2')].map((heading) => heading.textContent.trim());
		if (!headings.includes('Trained') || headings.includes('Specialized') || headings.includes('Skills')) throw new Error('Trained skills did not have their own major section.');
		const armor = [...panel.querySelectorAll('details.stat-row')].find((candidate) => candidate.querySelector('summary')?.textContent.includes('Armor'));
		armor.open = true;
		if (!armor.textContent.includes('No active effects')) throw new Error('Removed enchantments remained in the Character panel.');
		const untrained = panel.querySelector('details.skill-group');
		if (!untrained || untrained.open || !untrained.querySelector('summary > h2')?.textContent.includes('Untrained')) throw new Error('Untrained skills did not have a collapsed major section header.');
		untrained.open = true;
		const row = (name) => [...panel.querySelectorAll('details.stat-row')].find((candidate) => candidate.textContent.includes(name));
		if (row('Health').querySelector('.rank-cap')?.textContent !== 'Max' || row('Quickness').querySelector('.rank-cap') || row('Melee Defense').querySelector('.rank-cap') || row('Heavy Weapons').querySelector('.rank-cap')) throw new Error('Rank-cap marker confused capped vitals with unaffordable or untrained stats.');
		if (row('Heavy Weapons').querySelector('summary').textContent.includes('Trained') || row('Melee Defense').querySelector('summary').textContent.includes('Untrained')) throw new Error('Skill row repeated its section label.');
		const button = (stat, label) => [...row(stat).querySelectorAll('button')].find((candidate) => candidate.textContent.includes(label));
		if (row('Quickness').querySelector('.upgrade-indicator') || row('Health').querySelector('.upgrade-indicator') || !row('Melee Defense').querySelector('.upgrade-indicator') || !row('Heavy Weapons').querySelector('.upgrade-indicator')) throw new Error('Upgrade triangles did not follow refreshed quotes.');
		row('Quickness').open = true;
		if (!button('Quickness', '+1')?.disabled || row('Quickness').querySelector('.action-cost [title]')?.title !== '200') throw new Error('Unaffordable stat did not retain its disabled action and required XP cost.');
		row('Health').open = true;
		if (row('Health').querySelector('.actions') || !row('Health').querySelector('.action-status')?.textContent.includes('Rank cap')) throw new Error('Capped vital did not explain why it has no next-rank action.');
		row('Melee Defense').open = true;
		const train = button('Melee Defense', 'Train');
		if (train?.getClientRects().length === 0) throw new Error('Selected skill did not reveal its Train action.');
		if (!train || train.disabled || row('Melee Defense').querySelector('.action-cost [title]')?.title !== '2') throw new Error('Train did not show its quoted credit cost.');
		row('Heavy Weapons').open = true;
		const max = [...row('Heavy Weapons').querySelectorAll('button')].find((candidate) => candidate.title.includes('Raise maximum'));
		if (!max || max.disabled || !max.textContent.includes('+4')) throw new Error('Max quote did not show its rank gain.');
		max.dispatchEvent(new PointerEvent('pointerenter'));
		await new Promise((resolve) => setTimeout(resolve, 0));
		if (row('Heavy Weapons').querySelector('.action-cost [title]')?.title !== '100') throw new Error('Hovered action did not show its quoted XP cost.');
		const trainingDialog = () => document.querySelector('dialog.client-skill-training-dialog');
		const submitted = () => harness.inventoryDragCommands().filter((entry) => entry.command === 'submit_client_progression');
		const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
		const openTraining = async () => {
			button('Melee Defense', 'Train').click();
			await settle();
			const dialog = trainingDialog();
			if (!dialog?.open || !dialog.textContent.includes('Melee Defense') || !dialog.textContent.includes('skill credits?') || dialog.querySelector('[title]')?.title !== '2') throw new Error('Training confirmation lost its skill or quoted credit cost.');
			if (document.activeElement !== dialog.querySelector('[data-cancel-training]')) throw new Error('Training confirmation did not focus Cancel.');
			if (submitted().length !== 2) throw new Error('Training submitted before confirmation.');
			return dialog;
		};
		(await openTraining()).querySelector('[data-cancel-training]').click();
		await settle();
		if (trainingDialog() || submitted().length !== 2) throw new Error('Cancel submitted training or retained its dialog.');
		(await openTraining()).dispatchEvent(new Event('cancel', { cancelable: true }));
		await settle();
		if (trainingDialog() || submitted().length !== 2) throw new Error('Dialog cancellation did not retire training review.');
		await openTraining();
		document.querySelector('[aria-label="Close Character"]').click();
		await settle();
		document.querySelector('nav[aria-label="Game shortcuts"] button[aria-label="Character"]').click();
		await settle();
		if (trainingDialog() || submitted().length !== 2) throw new Error('Training review survived window closure.');
		const request = harness.inventoryDragCommands().filter((entry) => entry.command === 'evaluate_client_progression').at(-1);
		for (const confirmBeforePoll of [true, false]) {
			const dialog = await openTraining();
			harness.replyProgression({ requestId: request.args.requestId, evaluations: [] });
			if (confirmBeforePoll) dialog.querySelector('.ui-dialog-actions button:last-child').click();
			await new Promise((resolve) => setTimeout(resolve, 250));
			if (trainingDialog() || submitted().length !== 2) throw new Error('Invalidated training quote was submitted or retained for confirmation.');
			harness.replyProgression({ requestId: request.args.requestId, evaluations: ${JSON.stringify(skillEvaluations)} });
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		const confirm = (await openTraining()).querySelector('.ui-dialog-actions button:last-child');
		confirm.click(); confirm.click();
		await settle();
		if (trainingDialog() || submitted().length !== 3) throw new Error('Training confirmation did not submit exactly once.');
		button('Heavy Weapons', '+4').click();
		const submissions = harness.inventoryDragCommands().filter((entry) => entry.command === 'submit_client_progression');
		if (submissions.length !== 4 || submissions[2].args.quote.quote.credits_spent !== 2 || submissions[3].args.quote.quote.xp_spent !== 100) throw new Error('Train or Max did not submit the displayed quote once.');
		harness.replyProgressionFeedback({ DispatchFailed: { intent: { Train: { skill: 'MeleeDefense' } }, message: 'synthetic send failure' } });
		return { ...${JSON.stringify(reopened)}, lowXp: true, rankCap: true, trainAndMax: true, trainingConfirmation: true, staleTrainingQuote: true };
	})()`,
	);
	await delay(250);
	const failed = await evaluateExpression(
		client,
		`(() => {
		const harness = globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__;
		const panel = document.querySelector('[aria-label="Character"] .character-sheet');
		const trainRow = [...panel.querySelectorAll('details.stat-row')].find((candidate) => candidate.textContent.includes('Melee Defense'));
		const train = trainRow?.querySelector('.actions button');
		const warning = document.querySelector('.client-toast-warning[role="alert"]');
		if (!warning?.textContent.includes('synthetic send failure') || !train?.disabled || !train.title.includes('Awaiting') || trainRow.querySelector('.action-cost [title]')?.title !== '2') throw new Error('Ambiguous send failure did not show a warning toast and retain its disabled action and cost.');
		const neutral = globalThis.__CHARACTER_SHEET_PROBE_BASE__;
		harness.setCharacterSheet({ ...neutral, name: "Renamed", title: null, maximumLuminance: null, level: { ...neutral.level, xpForNextLevel: "0", xpIntoLevel: "0" }, vitae: 1, attributes: neutral.attributes.map((stat) => stat.attr_type === 'StrengthAttr' ? { ...stat, next_rank_xp: null } : stat), skills: neutral.skills.map((row) => ({ ...row, stat: { ...row.stat, next_rank_xp: null, breakdown: { ...row.stat.breakdown, vitae: 1 } } })) });
		return { ...${JSON.stringify(actions)}, sendFailure: true };
	})()`,
	);
	await delay(250);
	const neutral = await evaluateExpression(
		client,
		`(async () => {
		const panel = document.querySelector('[aria-label="Character"] .character-sheet');
		if (panel.querySelector('.character-name')?.textContent !== 'Renamed' || panel.querySelector('.character-title')) throw new Error('Character identity did not refresh.');
		if (panel.querySelector('progress[aria-label="Level experience"]') || panel.querySelector('progress[aria-label="Luminance capacity"]')) throw new Error('Capped experience or unknown luminance capacity is misleading.');
		const hudXp = document.querySelector('.character-hud progress');
		if (hudXp?.value !== 100 || hudXp.title !== 'Maximum level · 9,007,199,254,740,993 total XP' || hudXp.getAttribute('aria-valuetext') !== hudXp.title) throw new Error('HUD experience did not explain its completed bar at the level cap.');
		for (const label of ['Strength', 'Max Health', 'Heavy Weapons']) {
			const row = [...panel.querySelectorAll('details.stat-row')].find((candidate) => candidate.querySelector('summary')?.textContent.includes(label));
			if (row?.querySelector('.rank-cap')?.textContent !== 'Max' || row.querySelector('.upgrade-indicator')) throw new Error(label + ' did not indicate its rank cap after an external update.');
		}
		if ([...panel.querySelectorAll('details.stat-row > summary')].some((summary) => summary.textContent.includes('Vitae penalty'))) throw new Error('Zero vitae penalty still has a defense row.');
		const skill = [...panel.querySelectorAll('details.stat-row')].find((row) => row.querySelector('summary')?.textContent.includes('Heavy Weapons'));
		if (skill?.textContent.includes('Vitae penalty:')) throw new Error('Neutral vitae multiplier still appears in skill details.');
		const harness = globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__;
		const base = globalThis.__CHARACTER_SHEET_PROBE_BASE__;
		for (const [level, capacity, visible] of [[199, '1000000', false], [200, null, false], [200, '0', false], [200, '1000000', true]]) {
			harness.setCharacterSheet({ ...base, maximumLuminance: capacity, level: { ...base.level, level, xpForNextLevel: '0', xpIntoLevel: '0' } });
			await new Promise((resolve) => setTimeout(resolve, 250));
			const summary = panel.querySelector('.progression-summary');
			if (summary.textContent.includes('Luminance') !== visible || Boolean(summary.querySelector('progress[aria-label="Luminance capacity"]')) !== visible) throw new Error('Luminance visibility did not follow level and capacity.');
			if (visible && summary.querySelector('.luminance-track [title="1,000,000"] [aria-hidden="true"]')?.textContent !== '1M') throw new Error('Luminance capacity did not use compact quantity presentation.');
			if (summary.querySelector('progress[aria-label="Level experience"]') || panel.querySelector('.progression-balances strong [title]')?.title !== '9,007,199,254,740,993') throw new Error('Capped summary did not retain spendable XP without level progress.');
		}
		const untrained = { ...base.skills[0], stat: { ...base.skills[0].stat, training: 'Untrained', next_rank_xp: null } };
		harness.setCharacterSheet({ ...base, level: { ...base.level, unspentSkillPoints: 1 }, skills: [untrained] });
		const request = harness.inventoryDragCommands().filter((entry) => entry.command === 'evaluate_client_progression').at(-1);
		harness.replyProgression({ requestId: request.args.requestId, evaluations: [{ intent: { Train: { skill: untrained.stat.skill_type } }, result: { Err: { World: { InsufficientCredits: { required: untrained.stat.trained_cost, available: 1 } } } } }] });
		await new Promise((resolve) => setTimeout(resolve, 250));
		panel.querySelector('details.skill-group').open = true;
		const trainingRow = [...panel.querySelectorAll('details.stat-row')].find((row) => row.querySelector('summary')?.textContent.includes('Heavy Weapons'));
		trainingRow.open = true;
		const trainingButton = trainingRow.querySelector('.actions button');
		if (!trainingButton?.disabled || trainingRow.querySelector('.action-cost [title]')?.title !== String(untrained.stat.trained_cost)) throw new Error('Insufficient credits hid the Train action or its required cost.');
		const requests = () => harness.inventoryDragCommands().filter((entry) => entry.command === 'evaluate_client_progression');
		const beforePortal = requests().at(-1);
		harness.setCharacterPortalSpace(true);
		await new Promise((resolve) => setTimeout(resolve, 250));
		if (!panel.textContent.includes('Purchases unavailable during portal travel') || [...panel.querySelectorAll('.actions button')].some((button) => !button.disabled)) throw new Error('Portal travel retained interactive purchases.');
		if (requests().length === 0 || requests().at(-1) !== beforePortal) throw new Error('Portal travel requested unavailable quotes.');
		harness.setCharacterPortalSpace(false);
		const afterPortal = requests().at(-1);
		if (afterPortal.args.requestId === beforePortal.args.requestId) throw new Error('Portal return did not refresh unchanged character purchases.');
		const intent = { Raise: { target: { Attribute: 'QuicknessAttr' }, ranks: 1 } };
		harness.replyProgression({ requestId: afterPortal.args.requestId, evaluations: [{ intent, result: { Ok: { scope_id: 9, quote: { character: ${characterGuid}, intent, target_state: { training: null, ranks: 1, spent_xp: 100 }, resulting_ranks: 2, xp_spent: 200, credits_spent: 0, available_xp: base.level.unspentXp, available_credits: 1 } } } }] });
		harness.replyProgression({ requestId: beforePortal.args.requestId, evaluations: [{ intent, result: { Err: 'CharacterNotReady' } }] });
		await new Promise((resolve) => setTimeout(resolve, 250));
		const quicknessRow = [...panel.querySelectorAll('details.stat-row')].find((row) => row.querySelector('summary')?.textContent.includes('Quickness'));
		quicknessRow.open = true;
		const purchase = quicknessRow.querySelector('.actions button');
		if (!purchase || purchase.disabled) throw new Error('Portal return retained stale loading evaluations.');
		return { ...${JSON.stringify(failed)}, zeroVitaeHidden: true, insufficientCredits: true, tabIsolation: true, portalRecovery: true };
	})()`,
	);
	const spellNames = await probeCharacterSpellNames(client, evaluateExpression);
	await evaluateExpression(
		client,
		`(() => {
  if (!globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.retireCharacterSheet(globalThis.__CHARACTER_SHEET_PROBE_BASE__)) throw new Error('Retired character details survived the exit boundary.');
 })()`,
	);
	await delay(250);
	return await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Character"] .character-sheet');
		if (panel && !panel.textContent.includes('Waiting for character details')) throw new Error('Retired character details remained visible in the panel.');
		if (document.querySelector('.character-hud progress')?.value !== 0) throw new Error('Retired character experience remained visible in the HUD.');
		return { ...${JSON.stringify(neutral)}, titles: { ...${JSON.stringify(titles)}, optimistic: true, reconciled: true }, spellNames: ${JSON.stringify(spellNames)}, retired: true };
	})()`,
	);
}

/** Exercise changing modifier identities without reopening their retained disclosures. */
async function probeCharacterSpellNames(client, evaluateExpression) {
	return await evaluateExpression(
		client,
		`(async () => {
		const harness = globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__;
		const base = globalThis.__CHARACTER_SHEET_PROBE_BASE__;
		const panel = document.querySelector('.character-sheet');
		const { CLIENT_TUNING } = await import('/src/client/client-tuning.ts');
		const wait = async (predicate, detail) => {
			const deadline = performance.now() + 5000;
			while (!predicate()) {
				if (performance.now() > deadline) throw new Error(detail);
				await new Promise(requestAnimationFrame);
			}
		};
		const tab = (label) => [...panel.querySelectorAll('[role="tab"]')].find((node) => node.textContent === label).click();
		const row = (label) => [...panel.querySelectorAll('details.stat-row')].find((node) => node.querySelector('summary').textContent.includes(label));
		const named = (id) => 'Spell ' + String(id).padStart(4, '0') + (id % 2 === 0 ? ' Frost Protection Self' : ' Acid Protection Other');
		const modifier = (id, channel = 'ordinary') => ({ operation: 'additive', channel, effective: { spellId: id, layer: 1 }, overridden: [], value: 4 });
		const sheet = (direct, inherited = 123, wide = []) => {
			const result = structuredClone(base);
			const breakdown = result.skills[0].stat.breakdown;
			breakdown.modifiers.contributions = [modifier(direct)];
			breakdown.formula.Applied.first.modifiers = [modifier(inherited)];
			breakdown.wide_modifiers = wide;
			return result;
		};
		tab('Progression');
		harness.setCharacterSheet(base);
		await wait(() => row('Heavy Weapons')?.previousElementSibling?.textContent.trim() === 'Specialized', 'Specialized skill fixture did not mount');
		const skill = row('Heavy Weapons');
		skill.open = true;
		harness.setCharacterSheet(sheet(6115, 6116, [modifier(6117, 'attackSkills')]));
		await wait(() => [6115, 6116, 6117].every((id) => skill.textContent.includes(named(id))), 'Live direct, inherited, or wide modifier name did not resolve');
		if (!skill.open) throw new Error('Skill disclosure closed during name resolution');
		const requests = harness.spellReferenceRequests();
		const changedValue = sheet(6115, 6116, [modifier(6117, 'attackSkills')]);
		changedValue.skills[0].stat.breakdown.modifiers.contributions[0].value = 8;
		harness.setCharacterSheet(changedValue);
		await wait(() => skill.textContent.includes(': +8'), 'Modifier value did not update');
		if (harness.spellReferenceRequests() !== requests) throw new Error('Unchanged spell identities requested more metadata');

		harness.failNextSpellReferences();
		harness.setCharacterSheet(sheet(6120));
		await wait(() => skill.textContent.includes('lookup failed: Fixture spell-reference failure'), 'Lookup failure was hidden');
		const failedRequests = harness.spellReferenceRequests();
		await new Promise((resolve) => setTimeout(resolve, CLIENT_TUNING.characterSheet.displayIntervalMs * 2));
		if (harness.spellReferenceRequests() !== failedRequests) throw new Error('Failed names retried on display polling');
		[...panel.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Retry spell names').click();
		await wait(() => skill.textContent.includes(named(6120)), 'Explicit retry did not recover');
		if (panel.textContent.includes('Unable to load some spell names')) throw new Error('Recovered request retained its error');

		harness.deferEnchantmentReferences();
		harness.setCharacterSheet(sheet(6121));
		await wait(() => panel.textContent.includes('Loading spell names'), 'Delayed lookup did not start');
		harness.setCharacterSheet(sheet(999999));
		await wait(() => skill.textContent.includes('Spell 999999'), 'Replacement spell demand did not reach the view');
		harness.releaseEnchantmentReferences();
		await wait(() => skill.textContent.includes('Spell 999999 (definition missing)'), 'Missing definition was not distinguished from failure');
		if (skill.textContent.includes(named(6121))) throw new Error('Retired lookup overwrote current demand');

		const shortcut = document.querySelector('nav[aria-label="Game shortcuts"] button[aria-label="Character"]');
		shortcut.click();
		await new Promise(requestAnimationFrame);
		const hiddenRequests = harness.spellReferenceRequests();
		harness.setCharacterSheet(sheet(6122));
		await new Promise((resolve) => setTimeout(resolve, CLIENT_TUNING.characterSheet.displayIntervalMs * 2));
		if (harness.spellReferenceRequests() !== hiddenRequests) throw new Error('Hidden Character window requested spell names');
		shortcut.click();
		await wait(() => skill.textContent.includes(named(6122)), 'Retained window did not resolve current names on reopening');

		tab('Defenses');
		const armor = row('Armor');
		armor.open = true;
		const defense = (id) => ({ cooldowns: [], instances: [{ key: { spellId: id, layer: 1 }, spellCategory: 7, powerLevel: 5, kind: 'beneficial', remainingSeconds: null, statModType: 1, statModKey: 1, statModValue: 4 }], groups: [{ affectedStat: { kind: 'armor' }, operation: 'additive', channel: 'ordinary', spellCategory: 7, effective: { spellId: id, layer: 1 }, overridden: [] }] });
		harness.setEnchantments(defense(6123));
		await wait(() => armor.textContent.includes(named(6123)), 'Live armor name did not resolve');
		harness.deferEnchantmentReferences();
		harness.setEnchantments(defense(6124));
		await wait(() => panel.textContent.includes('Loading spell names'), 'Delayed defense lookup did not start');
		tab('Progression');
		await wait(() => skill.textContent.includes(named(6122)), 'Tab switch did not restore progression names');
		harness.releaseEnchantmentReferences();
		await new Promise((resolve) => setTimeout(resolve, CLIENT_TUNING.characterSheet.displayIntervalMs * 2));
		if (!skill.textContent.includes(named(6122))) throw new Error('Defense completion overwrote progression names');
		harness.setCharacterSheet(base);
		return { liveModifiers: true, stableDemand: true, retry: true, staleResults: true, missing: true, retainedWindow: true, defenses: true };
	})()`,
	);
}
