import assert from "node:assert/strict";

/** Production builder and shortcut gestures exercised through real browser pointer events. */
export async function probeLoadouts(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const read = (expression) => evaluateExpression(client, expression);
	const point = (selector) =>
		read(`(() => {
		const element = document.querySelector(${JSON.stringify(selector)});
		if (!element) throw new Error('Missing loadout probe element: ' + ${JSON.stringify(selector)});
		element.scrollIntoView({ block: 'nearest' });
		const r = element.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	})()`);
	const mouse = (type, position, buttons) =>
		client.send("Input.dispatchMouseEvent", {
			type,
			...position,
			button: "left",
			buttons,
			clickCount: 1,
		});
	const click = async (selector) => {
		const position = await point(selector);
		await mouse("mousePressed", position, 1);
		await mouse("mouseReleased", position, 0);
	};
	const key = async (key, code) => {
		await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
		await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
	};
	const drag = async (from, to, cancel = false) => {
		const start = await point(from);
		const end = typeof to === "string" ? await point(to) : to;
		await mouse("mousePressed", start, 1);
		await mouse("mouseMoved", end, 1);
		if (cancel) await key("Escape", "Escape");
		await mouse("mouseReleased", end, 0);
	};
	const originalSettings = await read(`${api}.loadoutProbe.settings()`);
	const settings = structuredClone(originalSettings);
	const capture = await read(`${api}.loadoutProbe.capture()`);
	assert.equal(capture.kind, "ready");
	const occupied = capture.bindings.filter((binding) => binding.item !== null);
	const empty = capture.bindings.find((binding) => binding.item === null);
	assert.ok(
		occupied.length > 0 && empty !== undefined,
		"Loadout probe needs occupied and empty slots",
	);
	settings.actionBars[0].slots[0] = {
		kind: "loadout",
		name: "Existing",
		icon: "⭐",
		bindings: [occupied[0]],
	};
	const bar = settings.actionBars[0].id;
	const target = `[data-action-bar="${bar}"][data-action-cell="0"]`;
	const result = "[data-loadout-result]";
	const count = async () =>
		(await read(`${api}.inventoryDragCommands()`)).filter(
			(entry) => entry.command === "apply_client_equipment_set",
		).length;
	const originalThemeBasis = await read(
		`document.querySelector('.client-world').style.getPropertyValue('--ui-item-cell-min-size')`,
	);
	try {
		await read(`${api}.loadoutProbe.restore(${JSON.stringify(settings)})`);
		await click('button[aria-label="Create loadout"]');
		assert.equal(
			await read(`document.querySelector(${JSON.stringify(result)}).disabled`),
			false,
		);
		const initialIcon = await read(
			`document.querySelector(${JSON.stringify(result)}).querySelector('.loadout-badge').textContent`,
		);
		assert.notEqual(initialIcon, "⭐", "New draft reused a saved loadout icon");
		const originalDragGap = await read(
			`document.querySelector('.client-world').style.getPropertyValue('--ui-drag-ghost-offset')`,
		);
		await read(
			`document.querySelector('.client-world').style.setProperty('--ui-drag-ghost-offset', '1.25rem')`,
		);
		try {
			for (const [source, visual] of [
				[result, `${result} [data-drag-preview]`],
				[
					'[aria-label="Inventory"] .contents-grid .item-grid-cell[data-item-guid]:not(:disabled)',
					'[aria-label="Inventory"] .contents-grid .item-grid-cell[data-item-guid]:not(:disabled) [data-drag-preview]',
				],
			]) {
				const start = await point(source);
				const end = { x: start.x + 30, y: start.y + 30 };
				const expected = await read(
					`(() => { const r=document.querySelector(${JSON.stringify(visual)}).getBoundingClientRect(); return {width:r.width,height:r.height,gap:parseFloat(getComputedStyle(document.documentElement).fontSize)*1.25}; })()`,
				);
				await mouse("mousePressed", start, 1);
				await mouse("mouseMoved", end, 1);
				const actual = await read(
					`(() => { const ghost=document.querySelector('.item-drag-ghost:not([hidden])'); const r=ghost?.getBoundingClientRect(); return {shown:ghost!==null,width:r?.width,height:r?.height,x:r?.left,y:r?.top}; })()`,
				);
				assert.equal(
					actual.shown,
					true,
					`Preview missing for ${source}; ${JSON.stringify(await read(`(() => { const hit=document.elementFromPoint(${start.x},${start.y}); return {tag:hit?.tagName,classes:hit?.className,label:hit?.closest('section[aria-label]')?.getAttribute('aria-label')}; })()`))}`,
				);
				assert.ok(
					Math.abs(actual.width - expected.width) < 0.1 &&
						Math.abs(actual.height - expected.height) < 0.1,
					"Drag preview included surrounding controls",
				);
				assert.ok(
					Math.abs(actual.x - end.x - expected.gap) < 0.1 &&
						Math.abs(actual.y - end.y - expected.gap) < 0.1,
					"Drag preview ignored the shared theme cursor gap",
				);
				if (source === result) {
					assert.equal(
						await read(
							`(() => { const artwork = document.querySelector('.item-drag-ghost [data-drag-artwork]'); return artwork?.querySelector('svg') != null && artwork?.querySelector('.loadout-badge')?.textContent === ${JSON.stringify(initialIcon)}; })()`,
						),
						true,
						"Loadout drag preview must retain both the silhouette and personal badge",
					);
				}
				await key("Escape", "Escape");
				await mouse("mouseReleased", end, 0);
			}
		} finally {
			await read(
				`document.querySelector('.client-world').style.setProperty('--ui-drag-ghost-offset', ${JSON.stringify(originalDragGap)})`,
			);
		}
		const inspection = `${api}.objectInspectionProbe()`;
		const inspectedBefore = await read(`${inspection}.snapshot().commandCount`);
		const includedBefore = await read(
			`document.querySelector('[data-loadout-slot="${occupied[0].slot}"]').getAttribute('aria-pressed')`,
		);
		const examine = async (slot) => {
			const position = await point(`[data-loadout-slot="${slot}"]`);
			await client.send("Input.dispatchMouseEvent", {
				type: "mousePressed",
				...position,
				button: "right",
				buttons: 2,
				clickCount: 1,
			});
			await client.send("Input.dispatchMouseEvent", {
				type: "mouseReleased",
				...position,
				button: "right",
				buttons: 0,
				clickCount: 1,
			});
		};
		await examine(occupied[0].slot);
		const inspectionState = await read(`${inspection}.snapshot()`);
		assert.equal(inspectionState.commandCount, inspectedBefore + 1);
		assert.equal(inspectionState.commands.at(-1).args.guid, occupied[0].item);
		assert.equal(
			await read(
				`document.querySelector('[data-loadout-slot="${occupied[0].slot}"]').getAttribute('aria-pressed')`,
			),
			includedBefore,
		);
		await read(`${inspection}.end()`);
		await examine(empty.slot);
		assert.equal(
			await read(`${inspection}.snapshot().commandCount`),
			inspectedBefore + 1,
		);
		const assertNoHorizontalOverflow = async () => {
			const overflow = await read(
				`(() => { const root=document.querySelector('[data-loadout-builder]'); return [...root.querySelectorAll('*'),root].filter(e=>e.clientWidth>0 && e.scrollWidth>e.clientWidth && ['auto','scroll'].includes(getComputedStyle(e).overflowX)).map(e=>({class:e.className,client:e.clientWidth,scroll:e.scrollWidth,escaping:[...e.querySelectorAll('*')].filter(child=>child.getBoundingClientRect().right>e.getBoundingClientRect().left+e.clientWidth).map(child=>({tag:child.tagName,class:child.className,width:child.getBoundingClientRect().width}))})); })()`,
			);
			assert.deepEqual(overflow, [], JSON.stringify(overflow));
		};
		await read(
			`(() => { const style=document.createElement('style'); style.id='loadout-theme-probe'; style.textContent='@layer theme { .loadout-builder { --ui-font-size-caption: 15px; } .loadout-slot-label { line-height: 1.5; } .loadout-icon-dropdown { width: 80px; } }'; document.head.append(style); })()`,
		);
		try {
			const theme = await read(
				`(() => { const label=getComputedStyle(document.querySelector('.loadout-slot-label')); const hint=getComputedStyle(document.querySelector('.loadout-result-details span')); const icon=document.querySelector('[data-loadout-result]').getBoundingClientRect(); return {caption:label.fontSize,hint:hint.fontSize,lineHeight:label.lineHeight,iconWidth:icon.width}; })()`,
			);
			assert.deepEqual(
				theme,
				{ caption: "15px", hint: "15px", lineHeight: "22.5px", iconWidth: 80 },
				"Theme rules could not override loadout component defaults",
			);
		} finally {
			await read(`document.getElementById('loadout-theme-probe').remove()`);
		}
		// Client and harness import order differ; component geometry must also win when shared CSS loads last.
		await read(
			`(() => { const base=document.querySelector('style[data-vite-dev-id$="/src/app/ui-base.css"]'); if (!base) throw new Error('Shared UI stylesheet unavailable for order probe'); const late=base.cloneNode(true); late.id='loadout-style-order-probe'; document.head.append(late); })()`,
		);
		try {
			assert.equal(
				await read(
					`(() => { const button=document.querySelector('[data-loadout-result]'); const css=getComputedStyle(button); const name=document.querySelector('[aria-label="Loadout name"]').getBoundingClientRect(); const icon=button.getBoundingClientRect(); return css.display==='flex' && icon.height===parseFloat(css.getPropertyValue('--ui-item-cell-min-size')) && name.width>icon.width && name.right<=icon.left; })()`,
				),
				true,
				"Late shared CSS broke the loadout footer geometry",
			);
			await assertNoHorizontalOverflow();
		} finally {
			await read(
				`document.getElementById('loadout-style-order-probe').remove()`,
			);
		}
		// Resize across column breakpoints, measuring overflow and its escaping children.
		const panel = 'section[aria-label="Create loadout"]';
		const initialWidth = await read(
			`document.querySelector(${JSON.stringify(panel)}).getBoundingClientRect().width`,
		);
		const initialHandle = await point(`${panel} .hud-window-resize-right`);
		await drag(`${panel} .hud-window-resize-right`, {
			x: initialHandle.x - initialWidth,
			y: initialHandle.y,
		});
		await read(`new Promise(resolve=>requestAnimationFrame(resolve))`);
		const minimumWidth = await read(
			`document.querySelector(${JSON.stringify(panel)}).getBoundingClientRect().width`,
		);
		const widths = Array.from(
			{ length: 141 },
			(_, index) => minimumWidth + index,
		);
		for (const width of widths) {
			const handle = await point(`${panel} .hud-window-resize-right`);
			const current = await read(
				`document.querySelector(${JSON.stringify(panel)}).getBoundingClientRect().width`,
			);
			await drag(`${panel} .hud-window-resize-right`, {
				x: handle.x + width - current,
				y: handle.y,
			});
			await read(`new Promise(resolve=>requestAnimationFrame(resolve))`);
			assert.equal(
				await read(
					`document.querySelector(${JSON.stringify(panel)}).getBoundingClientRect().width`,
				),
				width,
				"Resize probe missed requested width",
			);
			await assertNoHorizontalOverflow();
		}
		const handle = await point(`${panel} .hud-window-resize-right`);
		const current = await read(
			`document.querySelector(${JSON.stringify(panel)}).getBoundingClientRect().width`,
		);
		await drag(`${panel} .hud-window-resize-right`, {
			x: handle.x + initialWidth - current,
			y: handle.y,
		});
		await assertNoHorizontalOverflow();
		const chooser = result;
		const nameInput = '[data-loadout-builder] input[aria-label="Loadout name"]';
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(nameInput)}).closest('.loadout-result') !== null && document.querySelector(${JSON.stringify(nameInput)}).labels.length === 0 && document.querySelector(${JSON.stringify(nameInput)}).placeholder.includes('optional')`,
			),
			true,
		);
		assert.equal(
			await read(
				`(() => { const footer=document.querySelector('.loadout-result').getBoundingClientRect(); const input=document.querySelector(${JSON.stringify(nameInput)}).getBoundingClientRect(); const icon=document.querySelector(${JSON.stringify(result)}).getBoundingClientRect(); return input.width>0 && input.right<=icon.left && icon.right<=footer.right+1 && icon.right>=footer.right-1; })()`,
			),
			true,
			"Footer controls overlap or extend beyond the window",
		);
		const menu = '[role="menu"][aria-label="Loadout badge"]';
		assert.equal(
			await read(`document.querySelector(${JSON.stringify(menu)}) === null`),
			true,
		);
		await click(chooser);
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(chooser)}).getAttribute('aria-expanded')`,
			),
			"true",
		);
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(menu)}).scrollHeight > document.querySelector(${JSON.stringify(menu)}).clientHeight`,
			),
			true,
		);
		await key("End", "End");
		assert.equal(
			await read(
				`(async () => { for(let i=0;i<100;i++) { if(document.querySelector(${JSON.stringify(menu)}).scrollTop > 0) return true; await new Promise(resolve=>requestAnimationFrame(resolve)); } return false; })()`,
			),
			true,
		);
		await key("Escape", "Escape");
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(menu)}) === null && document.querySelector('[data-loadout-builder]').checkVisibility()`,
			),
			true,
		);
		await click(chooser);
		const selectedIcon = "❤️";
		await click(`${menu} [role="menuitem"][title="❤️"]`);
		assert.equal(
			await read(`document.querySelector(${JSON.stringify(menu)}) === null`),
			true,
		);
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(chooser)}).querySelector('.loadout-badge').textContent`,
			),
			selectedIcon,
		);
		const listMenuLabel = await read(
			`(() => { const button=document.querySelector('[data-action-bar-surface="${bar}"] .action-menu-strip'); if (!button) throw new Error('Loadout action bar menu is unavailable'); const label=button.getAttribute('aria-label').split(' menu')[0]+' menu'; if (button.getAttribute('aria-expanded')!=='true') button.click(); return label; })()`,
		);
		const listMenu = `[role="menu"][aria-label="${listMenuLabel}"]`;
		const enabledCommands = await read(
			`Array.from(document.querySelector(${JSON.stringify(listMenu)}).querySelectorAll('[role="menuitem"]:not(:disabled)'), e=>e.textContent.trim())`,
		);
		assert.equal(
			await read(
				`getComputedStyle(document.querySelector(${JSON.stringify(listMenu)})).display`,
			),
			"flex",
		);
		const activeCommand = () =>
			read(
				`(() => { const menu=document.querySelector(${JSON.stringify(listMenu)}); return document.getElementById(menu.getAttribute('aria-activedescendant')).textContent.trim(); })()`,
			);
		assert.equal(await activeCommand(), enabledCommands[0]);
		await key("ArrowDown", "ArrowDown");
		assert.equal(
			await activeCommand(),
			enabledCommands[1 % enabledCommands.length],
		);
		await key("ArrowUp", "ArrowUp");
		assert.equal(await activeCommand(), enabledCommands[0]);
		await key("Escape", "Escape");
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(listMenu)}) === null`,
			),
			true,
		);
		const checkGridDensity = async () => {
			assert.equal(
				await read(
					`Array.from(document.querySelectorAll('.loadout-slots, .contents-grid')).filter(e=>e.clientWidth>0).every(e=>{ const css=getComputedStyle(e); const basis=parseFloat(css.getPropertyValue('--ui-item-cell-min-size')); const gap=parseFloat(css.columnGap); return css.gridTemplateColumns.split(' ').length===Math.max(1,Math.floor((e.clientWidth+gap)/(basis+gap))); })`,
				),
				true,
				"Item grids ignored shared cell density",
			);
		};
		await checkGridDensity();
		// A larger test-owned theme basis exercises overflow even when the compact grid fits.
		const originalBasis = await read(
			`document.querySelector('.client-world').style.getPropertyValue('--ui-item-cell-min-size')`,
		);
		await read(
			`document.querySelector('.client-world').style.setProperty('--ui-item-cell-min-size', '64px')`,
		);
		await checkGridDensity();
		const footerTop = await read(
			`document.querySelector(${JSON.stringify(nameInput)}).getBoundingClientRect().top`,
		);

		const scroll = "[data-loadout-scroll]";
		assert.equal(
			await read(
				`(() => { const e=document.querySelector('[data-loadout-scroll]'); return e.scrollHeight > e.clientHeight; })()`,
			),
			true,
		);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			...(await point(scroll)),
			deltaX: 0,
			deltaY: 200,
		});
		assert.equal(
			await read(
				`(async () => { for(let i=0;i<100;i++) { if(document.querySelector('[data-loadout-scroll]').scrollTop > 0) return true; await new Promise(resolve=>requestAnimationFrame(resolve)); } return false; })()`,
			),
			true,
		);
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(nameInput)}).getBoundingClientRect().top`,
			),
			footerTop,
			"Scrolling moved the footer name input",
		);
		await read(
			`document.querySelector('.client-world').style.setProperty('--ui-item-cell-min-size', ${JSON.stringify(originalBasis)})`,
		);
		const checked =
			await read(`Array.from(document.querySelectorAll('[data-loadout-builder] input[type="checkbox"]'))
			.filter((input) => input.checked).map((input) => input.getAttribute('aria-label'))`);
		assert.equal(checked.length, occupied.length);
		if (checked.length > 1)
			await click(`input[aria-label="${checked.at(-1)}"]`);
		await click(`[data-loadout-slot="${empty.slot}"]`);
		await click(nameInput);
		await client.send("Input.insertText", { text: "Travel" });
		await drag(result, target, true);
		assert.deepEqual(
			await read(`${api}.loadoutProbe.bars()`),
			settings.actionBars,
			"Cancelled draft drag changed saved cells",
		);
		assert.ok(
			await read(
				`document.querySelector('[data-loadout-builder]')?.checkVisibility()`,
			),
			"Cancelled drag closed the builder",
		);
		assert.equal(
			await read(`document.querySelector(${JSON.stringify(menu)}) === null`),
			true,
			"Cancelled drag opened the icon picker",
		);
		await drag(result, target);
		const stored = (await read(`${api}.loadoutProbe.bars()`))[0].slots[9];
		assert.equal(stored.kind, "loadout");
		assert.equal(stored.name, "Travel");
		const savedTooltip = await read(
			`document.querySelector(${JSON.stringify(target)}).title`,
		);
		assert.equal(savedTooltip.split("\n")[0], '0: Loadout "Travel"');
		assert.equal(savedTooltip.split("Travel").length - 1, 1);
		assert.equal(stored.icon, selectedIcon);
		assert.ok(
			stored.bindings.some(
				(binding) => binding.item === null && binding.slot === empty.slot,
			),
		);
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(target)}).querySelector('.loadout-badge').textContent`,
			),
			selectedIcon,
		);
		assert.equal(stored.bindings.length, Math.max(1, occupied.length - 1) + 1);
		assert.equal(
			await read(
				`document.querySelector('[data-loadout-builder]')?.checkVisibility()`,
			),
			false,
		);
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(target)}).dataset.actionItem ?? null`,
			),
			null,
		);
		const before = await count();
		await click(target);
		assert.equal(await count(), before + 1);
		const command = (await read(`${api}.inventoryDragCommands()`))
			.filter((entry) => entry.command === "apply_client_equipment_set")
			.at(-1);
		assert.deepEqual(
			command.args.bindings,
			stored.bindings.map((binding) => ({
				item: binding.item,
				target: binding.slot,
			})),
		);
		await drag(target, { x: 500, y: 300 });
		assert.equal((await read(`${api}.loadoutProbe.bars()`))[0].slots[9], null);
		await read(
			`${api}.loadoutProbe.fail(${JSON.stringify(command.args.bindings)})`,
		);
		const warnings = await read(
			`Array.from(document.querySelectorAll('.client-toast'), (element) => ({ text: element.textContent, role: element.getAttribute('role') }))`,
		);
		assert.ok(
			warnings.some(
				(warning) =>
					warning.role === "alert" &&
					warning.text.includes("Could not equip") &&
					warning.text.includes(
						stored.bindings.find((binding) => binding.item !== null).name,
					),
			),
			`Failure lost saved name after cell removal: ${JSON.stringify({ warnings, bindings: stored.bindings })}`,
		);
		// The existing toast owner presents one current warning, so exercise clear feedback separately.
		await read(
			`${api}.loadoutProbe.fail(${JSON.stringify(command.args.bindings.filter((binding) => binding.item === null))})`,
		);
		assert.equal(
			await read(
				`Array.from(document.querySelectorAll('.client-toast')).some((element) => element.getAttribute('role') === 'alert' && element.textContent.includes('Could not clear'))`,
			),
			true,
		);
		return {
			sharedDragPreview: true,
			stylesheetOrder: true,
			themeOverrides: true,
			resizeWithoutHorizontalOverflow: true,
			unusedDefaultIcon: true,
			sharedCellDensity: true,
			itemExamination: true,
			loadoutTooltip: true,
			fixedFooterIdentity: true,
			combinedIconControl: true,
			iconDropdown: true,
			listMenuNavigation: true,
			horizontalOverflow: false,
			namePersistence: true,
			emojiIcon: true,
			emptySlot: true,
			scrolling: true,
			captured: true,
			sparse: true,
			cancellation: true,
			placement: true,
			typedActivation: true,
			deletion: true,
			namedFailureAfterRemoval: true,
		};
	} finally {
		await read(
			`document.querySelector('.client-world').style.setProperty('--ui-item-cell-min-size', ${JSON.stringify(originalThemeBasis)})`,
		);
		await read(
			`${api}.loadoutProbe.restore(${JSON.stringify(originalSettings)})`,
		);
	}
}
