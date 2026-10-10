import assert from "node:assert/strict";

/** Verify indexed remapping against production HUD cells and scoped execution owners. */
export async function probeBindingControls(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const read = (expression) => evaluateExpression(client, expression);
	const settle = () =>
		read(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	const until = async (expression) => {
		const deadline = Date.now() + 5000;
		while (!(await read(expression))) {
			if (Date.now() > deadline)
				throw new Error(`Binding control did not settle: ${expression}`);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	};
	const key = async (name) => {
		for (const type of ["keyDown", "keyUp"])
			await client.send("Input.dispatchKeyEvent", {
				type,
				key: name,
				code: name,
			});
		await settle();
	};
	const initial = await read(`${api}.bindingSettings.read()`);
	const settings = {
		...initial,
		actionBars: {
			...initial.actionBars,
			focus: { ...initial.actionBars.focus, 0: [{ key: "F11" }] },
			cells: { ...initial.actionBars.cells, 0: [{ key: "F12" }] },
		},
		spellBar: {
			...initial.spellBar,
			tabs: { ...initial.spellBar.tabs, 9: [{ key: "F8" }] },
			cells: { ...initial.spellBar.cells, 0: [{ key: "F9" }] },
			caster: [{ key: "F10" }],
		},
		combatBar: {
			...initial.combatBar,
			heights: { ...initial.combatBar.heights, 0: [{ key: "F6" }] },
			breakpoints: { ...initial.combatBar.breakpoints, 4: [{ key: "F7" }] },
		},
	};
	let caster = null;
	let spellStarted = false;
	let combatStarted = false;
	try {
		await read(`${api}.bindingSettings.replace(${JSON.stringify(settings)})`);
		await settle();
		assert.match(
			await read(`document.querySelector('.action-menu-strip').title`),
			/focus: F11/,
		);
		assert.match(
			await read(`document.querySelector('[data-action-cell="1"]').title`),
			/F12/,
		);
		await key("F11");
		assert.equal(
			await read(`document.querySelector('.action-bar-focused') !== null`),
			true,
		);
		await key("Escape");
		await read(`${api}.spellBarProbe.begin()`);
		spellStarted = true;
		await settle();
		assert.match(
			await read(
				`document.querySelector('.spell-tabs button:nth-child(10)').title`,
			),
			/F8/,
		);
		await key("F8");
		assert.equal(await read(`${api}.spellBarProbe.bindings().selected`), 9);
		await read(
			`${api}.spellBarProbe.select(7); ${api}.spellBarProbe.bind(0,1); ${api}.spellBarProbe.bind(9,1); ${api}.spellBarProbe.bind(10,1)`,
		);
		await until(
			`document.querySelector('[data-spell-cell="0"] .ui-shortcut-hint')?.textContent === 'F9'`,
		);
		assert.match(
			await read(`document.querySelector('[data-spell-cell="0"]').title`),
			/key: F9/,
		);
		assert.equal(
			await read(
				`document.querySelector('[data-spell-cell="10"] .ui-shortcut-hint') === null`,
			),
			true,
		);
		const casts = await read(
			`${api}.inventoryDragCommands().filter(entry => entry.command === 'cast_client_spell').length`,
		);
		await key("F9");
		await until(
			`${api}.inventoryDragCommands().filter(entry => entry.command === 'cast_client_spell').length === ${casts + 1}`,
		);
		caster = await read(`${api}.spellBarProbe.caster(3,true)`);
		await until(
			`document.querySelector('[data-caster-spell] button')?.title.includes('F10')`,
		);
		await key("F10");
		await read(`${api}.spellBarProbe.resolveCaster()`);
		const cast = await read(
			`${api}.inventoryDragCommands().findLast(entry => entry.command === 'submit_client_item_use')`,
		);
		assert.equal(cast.args.request.intent.source, caster);
		assert.equal(cast.args.request.intent.target, 7);
		await read(
			`${api}.spellBarProbe.restoreCaster(); ${api}.spellBarProbe.end()`,
		);
		caster = null;
		spellStarted = false;
		await read(`${api}.combatBarProbe.begin('melee')`);
		combatStarted = true;
		await settle();
		assert.match(
			await read(`document.querySelector('.attack-height button.high').title`),
			/F6/,
		);
		assert.match(
			await read(`document.querySelector('.breakpoint-5').title`),
			/F7/,
		);
		await key("F6");
		assert.equal(
			await read(
				`document.querySelector('.attack-height button.high').getAttribute('aria-pressed')`,
			),
			"true",
		);
		await key("F7");
		assert.equal(
			await read(
				`Number(document.querySelector('.power-control').getAttribute('aria-valuenow'))`,
			),
			await read(`Math.round(${api}.combatBarProbe.breakpoints[4] * 100)`),
		);
		return {
			passed: true,
			actionFocus: true,
			actionCellHint: true,
			spellTab: true,
			spellCast: true,
			casterCast: true,
			overflowHasNoShortcut: true,
			combatHeight: true,
			combatBreakpoint: true,
		};
	} finally {
		if (caster !== null) await read(`${api}.spellBarProbe.restoreCaster()`);
		if (spellStarted) await read(`${api}.spellBarProbe.end()`);
		if (combatStarted) await read(`${api}.combatBarProbe.end()`);
		await read(`${api}.bindingSettings.replace(${JSON.stringify(initial)})`);
	}
}
