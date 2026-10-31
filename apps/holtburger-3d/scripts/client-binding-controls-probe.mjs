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
	const key = async (name, modifiers = 0) => {
		for (const type of ["keyDown", "keyUp"])
			await client.send("Input.dispatchKeyEvent", {
				type,
				key: name,
				code: name,
				modifiers,
			});
		await settle();
	};
	const initial = await read(`${api}.bindingSettings.read()`);
	// Explicit fixture bindings keep behavior checks independent of product defaults.
	const panelSettings = {
		...initial,
		client: {
			...initial.client,
			toggleInventory: [
				{ key: "b", shift: false, ctrl: false, alt: false, meta: false },
			],
			toggleCharacter: [
				{ key: "f", shift: false, ctrl: false, alt: false, meta: false },
			],
			toggleSocial: [
				{ key: "o", shift: false, ctrl: false, alt: false, meta: false },
			],
			toggleWorld: [
				{ key: "m", shift: false, ctrl: false, alt: false, meta: false },
			],
			toggleJournal: [
				{ key: "j", shift: false, ctrl: false, alt: false, meta: false },
			],
			toggleSettings: [
				{ key: "F10", shift: false, ctrl: false, alt: false, meta: false },
			],
			toggleNearby: [
				{ key: "f", shift: false, ctrl: true, alt: false, meta: false },
			],
		},
	};

	await read(
		`globalThis.__releaseSystemPanelKeys = ${api}.bindSystemPanelKeys()`,
	);
	try {
		await read(
			`${api}.bindingSettings.replace(${JSON.stringify(panelSettings)})`,
		);
		await settle();
		const pressed = (label) =>
			`document.querySelector('button[aria-label="${label}"]').getAttribute('aria-pressed') === 'true'`;
		for (const [label, name] of [
			["Inventory", "b"],
			["Character", "f"],
			["Social", "o"],
			["World", "m"],
			["Journal", "j"],
			["Settings", "F10"],
		]) {
			await key(name);
			assert.equal(await read(pressed(label)), true, `${label} opens`);
			await client.send("Input.dispatchKeyEvent", {
				type: "keyDown",
				key: name,
				code: name,
				autoRepeat: true,
			});
			await client.send("Input.dispatchKeyEvent", {
				type: "keyUp",
				key: name,
				code: name,
			});
			await settle();
			assert.equal(await read(pressed(label)), true, `${label} ignores repeat`);
			await key(name);
			assert.equal(await read(pressed(label)), false, `${label} closes`);
		}
		const nearbyPressed = pressed("Nearby entities and alerts");
		await key("b");
		await key("f", 2);
		assert.equal(
			await read(nearbyPressed),
			true,
			"Ctrl+F opens the entity list",
		);
		assert.equal(
			await read(pressed("Inventory")),
			true,
			"entity list preserves the main panel",
		);
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "f",
			code: "KeyF",
			modifiers: 2,
			autoRepeat: true,
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "f",
			code: "KeyF",
			modifiers: 2,
		});
		await settle();
		assert.equal(await read(nearbyPressed), true, "entity list ignores repeat");
		await key("f", 2);
		assert.equal(
			await read(nearbyPressed),
			false,
			"Ctrl+F closes the entity list",
		);
		await key("b");
		const remappedNearby = {
			...panelSettings,
			client: {
				...panelSettings.client,
				toggleNearby: [
					{ key: "h", ctrl: true, shift: false, alt: false, meta: false },
				],
			},
		};
		await read(
			`${api}.bindingSettings.replace(${JSON.stringify(remappedNearby)})`,
		);
		await settle();
		await key("f", 2);
		assert.equal(await read(nearbyPressed), false, "remapping retires Ctrl+F");
		await key("h", 2);
		assert.equal(
			await read(nearbyPressed),
			true,
			"remapped chord opens the entity list",
		);
		await key("h", 2);
		await read(
			`${api}.bindingSettings.replace(${JSON.stringify({ ...remappedNearby, client: { ...remappedNearby.client, toggleNearby: [] } })})`,
		);
		await settle();
		await key("h", 2);
		assert.equal(
			await read(nearbyPressed),
			false,
			"entity list can be unbound",
		);
		await read(
			`${api}.bindingSettings.replace(${JSON.stringify(panelSettings)})`,
		);
		await settle();
		await key("F10");
		await read(`document.querySelector('#settings-tab-input').click()`);
		await settle();
		assert.equal(
			await read(
				`document.querySelector('[aria-label="Add key for Toggle entity list"]') !== null`,
			),
			true,
			"entity list is configurable in Input settings",
		);
		await key("F10");
		await key("b");
		await key("f");
		assert.equal(
			await read(pressed("Inventory")),
			false,
			"switch closes prior panel",
		);
		assert.equal(await read(pressed("Character")), true);
		await key("f");
		await read(
			`${api}.bindingSettings.replace({...${api}.bindingSettings.read(), client: {...${api}.bindingSettings.read().client, toggleInventory: [{key: 'F8'}]}})`,
		);
		await settle();
		assert.match(
			await read(
				`document.querySelector('button[aria-label="Inventory"]').title`,
			),
			/F8/,
		);
		await key("b");
		assert.equal(
			await read(pressed("Inventory")),
			false,
			"old binding retired",
		);
		await key("F8");
		assert.equal(await read(pressed("Inventory")), true, "remapped key opens");
		await key("F8");
		await read(
			`${api}.bindingSettings.replace({...${api}.bindingSettings.read(), client: {...${api}.bindingSettings.read().client, toggleInventory: []}})`,
		);
		await settle();
		await key("F8");
		assert.equal(
			await read(pressed("Inventory")),
			false,
			"unbound panel ignores old key",
		);
		await read(
			`document.querySelector('button[aria-label="Inventory"]').click()`,
		);
		await settle();
		assert.equal(
			await read(pressed("Inventory")),
			true,
			"dock opens unbound panel",
		);
		await read(
			`document.querySelector('button[aria-label="Inventory"]').click()`,
		);
		await settle();
		// Native editors retain letter input instead of toggling a panel.
		await read(
			`${api}.bindingSettings.replace(${JSON.stringify(panelSettings)}); globalThis.__panelEditor = document.createElement('input'); document.body.append(globalThis.__panelEditor); globalThis.__panelEditor.focus()`,
		);
		await key("b");
		assert.equal(
			await read(pressed("Inventory")),
			false,
			"editor owns text input",
		);
		await read(
			`globalThis.__panelEditor.remove(); delete globalThis.__panelEditor`,
		);
		await key("b");
		assert.equal(await read(pressed("Inventory")), true);
		await key("b");
	} finally {
		await read(
			`globalThis.__panelEditor?.remove(); delete globalThis.__panelEditor; globalThis.__releaseSystemPanelKeys(); delete globalThis.__releaseSystemPanelKeys; ${api}.bindingSettings.replace(${JSON.stringify(initial)})`,
		);
		await settle();
	}

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
			entityList: {
				toggles: true,
				preservesMainPanel: true,
				ignoresRepeat: true,
				remaps: true,
				unbinds: true,
				settingsRow: true,
			},
			systemPanels: {
				toggles: true,
				ignoresRepeat: true,
				switches: true,
				remaps: true,
				unbinds: true,
				editorOwnership: true,
			},
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
