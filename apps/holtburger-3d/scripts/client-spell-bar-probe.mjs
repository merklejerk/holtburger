import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

/** Exercise production spell cells, pointer owner, keyboard policy and session cast requests. */
export async function probeSpellBar(
	client,
	evaluateExpression,
	screenshotPath,
) {
	const read = (expression) => evaluateExpression(client, expression);
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const probe = `${api}.spellBarProbe`;
	const cell = (slot) => `[data-spell-cell="${slot}"]`;
	const point = (selector) =>
		read(`(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) throw new Error('Missing spell probe element: ' + ${JSON.stringify(selector)});
  element.scrollIntoView({block:'nearest',inline:'nearest'});
  const r=element.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};
 })()`);
	const mouse = (type, p, buttons) =>
		client.send("Input.dispatchMouseEvent", {
			type,
			...p,
			button: "left",
			buttons,
			clickCount: 1,
		});
	const click = async (selector) => {
		const p = await point(selector);
		await mouse("mousePressed", p, 1);
		await mouse("mouseReleased", p, 0);
	};
	const key = async (key, code, modifiers = 0, autoRepeat = false) => {
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key,
			code,
			modifiers,
			autoRepeat,
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key,
			code,
			modifiers,
		});
	};
	const drag = async (source, target, cancel = false) => {
		const start = await point(source);
		const end = typeof target === "string" ? await point(target) : target;
		await mouse("mousePressed", start, 1);
		await mouse("mouseMoved", { x: start.x + 16, y: start.y + 16 }, 1);
		await mouse("mouseMoved", end, 1);
		if (cancel) await key("Escape", "Escape");
		await mouse("mouseReleased", end, 0);
	};
	const binding = (slot) =>
		read(`${probe}.bindings().tabs[${probe}.bindings().selected][${slot}]`);
	const casts = () =>
		read(
			`${api}.inventoryDragCommands().filter(c=>c.command==='cast_client_spell')`,
		);
	await read(`${probe}.begin()`);
	// Spell browser probe leaves its panel mounted; reopen if necessary.
	await read(
		`(() => { if (!document.querySelector('[aria-label="Known spells"]')) document.querySelector('[aria-label="Spells"]').click(); })()`,
	);
	await read(`new Promise((resolve,reject)=>{ const start=performance.now(); const timer=setInterval(()=>{
  if(document.querySelector('[data-spell-drag-source="1"] img')) {clearInterval(timer);resolve(true);}
  else if(performance.now()-start>5000){clearInterval(timer);reject(new Error('Spell sources did not load'));}
 },20); })`);
	assert.equal(
		await read(`document.querySelectorAll('[data-spell-cell]').length`),
		10,
	);
	const settled = () =>
		read(
			`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
		);
	const fits = () =>
		read(
			`(() => { const bar=document.querySelector('.spell-bar-scroll'); return {width:bar.clientWidth,scrollWidth:bar.scrollWidth,height:bar.clientHeight,scrollHeight:bar.scrollHeight}; })()`,
		);
	await settled();
	const geometry = await fits();
	assert.equal(
		geometry.width,
		geometry.scrollWidth,
		"Normal strip must not scroll horizontally",
	);
	assert.equal(
		geometry.height,
		geometry.scrollHeight,
		"Normal strip must not scroll vertically",
	);
	const initialCasts = (await casts()).length;
	await drag('[data-spell-drag-source="1"]', cell(0));
	assert.equal(await binding(0), 1);
	assert.equal((await casts()).length, initialCasts, "Binding must not cast");
	await drag('[data-spell-drag-source="2"]', cell(1));
	await drag(cell(0), cell(1));
	assert.equal(await binding(0), 2);
	assert.equal(await binding(1), 1);
	await drag(cell(0), { x: 30, y: 180 }, true);
	assert.equal(await binding(0), 2, "Escape preserves source");
	await drag(cell(0), { x: 30, y: 180 });
	assert.equal(await binding(0), null);
	// Pointer interruptions must never commit removal or a transfer.
	const interrupt = async (operation) => {
		const start = await point(cell(1));
		const end = { x: 30, y: 180 };
		await mouse("mousePressed", start, 1);
		await mouse("mouseMoved", end, 1);
		await operation();
		await mouse("mouseReleased", end, 0);
	};
	await interrupt(() => read(`window.dispatchEvent(new Event('blur'))`));
	assert.equal(await binding(1), 1, "Blur preserves source");
	await interrupt(() => read(`${probe}.mode('peace')`));
	await read(`${probe}.mode('magic')`);
	assert.equal(await binding(1), 1, "Stance hiding preserves source");
	await interrupt(() => key("@", "Digit2", 8));
	await key("!", "Digit1", 8);
	assert.equal(await binding(1), 1, "Tab change preserves source");
	await interrupt(() => read(`${probe}.modal(true)`));
	await key("2", "Digit2");
	assert.equal((await casts()).length, initialCasts, "Modal owns digits");
	await read(`${probe}.modal(false)`);
	assert.equal(await binding(1), 1, "Modal interruption preserves source");
	// Removing a panel-origin element while pressed cannot populate a cell.
	const source = await point('[data-spell-drag-source="3"]');
	const destination = await point(cell(3));
	await mouse("mousePressed", source, 1);
	await mouse("mouseMoved", destination, 1);
	await read(`document.querySelector('[aria-label="Close Spells"]').click()`);
	await mouse("mouseReleased", destination, 0);
	assert.equal(await binding(3), null, "Source removal cancels transfer");
	await click('[aria-label="Spells"]');
	await read(`${probe}.select(7)`);
	await key("2", "Digit2");
	assert.equal((await casts()).length, initialCasts + 1);
	assert.deepEqual((await casts()).at(-1).args, {
		spellId: 1,
		aim: { kind: "normal", selection: 7 },
	});
	await key("2", "Digit2", 0, true);
	assert.equal(
		(await casts()).length,
		initialCasts + 1,
		"Repeat does not cast",
	);
	await key("@", "Digit2", 8);
	assert.equal(await read(`${probe}.bindings().selected`), 1);
	assert.equal(await binding(1), null);
	await key("!", "Digit1", 8);
	assert.equal(await binding(1), 1);
	// Existing action bar gets first refusal, including shifted digit alternate activation.
	await key("1", "Digit1", 2);
	await key("2", "Digit2");
	assert.equal(
		(await casts()).length,
		initialCasts + 1,
		"Focused action bar consumes digit",
	);
	await key("1", "Digit1", 2);
	await key("@", "Digit2", 8);
	assert.equal(
		await read(`${probe}.bindings().selected`),
		0,
		"Focused action bar consumes shifted digit",
	);
	await read(
		`document.querySelector('[aria-label="Search spell names"]').focus()`,
	);
	await key("2", "Digit2");
	assert.equal((await casts()).length, initialCasts + 1, "Editor owns digits");
	await click('[aria-label="Close Spells"]');
	await read(`${probe}.mode('peace')`);
	assert.equal(
		await read(`document.querySelector('[data-spell-bar-surface]') === null`),
		true,
	);
	await read(`${probe}.mode('magic')`);
	assert.equal(await binding(1), 1);
	await read(`${probe}.select(null)`);
	await click(cell(1));
	assert.equal((await casts()).length, initialCasts + 2);
	assert.equal((await casts()).at(-1).args.aim.selection, null);
	await click('[aria-label="Unlock UI layout"]');
	await click(cell(1));
	await key("2", "Digit2");
	assert.equal(
		(await casts()).length,
		initialCasts + 2,
		"Layout preview cannot cast",
	);
	const before = await read(
		`document.querySelector('[data-spell-bar-surface]').getBoundingClientRect().toJSON()`,
	);
	const handle = await point('[aria-label="Move Spell bar"]');
	await mouse("mousePressed", handle, 1);
	await mouse("mouseMoved", { x: handle.x + 40, y: handle.y - 60 }, 1);
	await mouse("mouseReleased", { x: handle.x + 40, y: handle.y - 60 }, 0);
	const after = await read(
		`document.querySelector('[data-spell-bar-surface]').getBoundingClientRect().toJSON()`,
	);
	assert.ok(
		Math.abs(after.x - before.x - 40) < 1 &&
			Math.abs(after.y - before.y + 60) < 1,
		"Spell surface uses layout movement",
	);
	const toggleShape = async () => {
		const handle = await point('[aria-label="Toggle spell bar shape"]');
		await mouse("mousePressed", handle, 1);
		await mouse("mouseReleased", handle, 0);
		await settled();
	};
	await toggleShape();
	assert.equal(
		await read(
			`document.querySelector('[data-spell-bar-surface]').dataset.spellBarShape`,
		),
		"double",
	);
	const folded = await read(`(() => {
  const cells=[...document.querySelectorAll('[data-spell-cell]')];
  return cells.map(cell=>{const r=cell.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,slot:cell.dataset.spellCell};});
 })()`);
	assert.equal(
		new Set(folded.map((cell) => cell.x)).size,
		5,
		"Folded bar has five columns",
	);
	assert.equal(
		new Set(folded.map((cell) => cell.y)).size,
		2,
		"Folded bar has two rows",
	);
	assert.equal(folded[0].y, folded[4].y);
	assert.ok(folded[5].y > folded[0].y);
	assert.equal(await binding(1), 1, "Shape toggle preserves spell binding");
	await key("@", "Digit2", 8);
	// Tab clicks remain usable while editing; keyboard tab commands stay gated.
	await click('[aria-label="Spell tab 2"]');
	assert.equal(
		await read(
			`document.querySelector('[data-spell-bar-surface]').dataset.spellBarShape`,
		),
		"double",
	);
	for (let tab = 0; tab < 10; tab++) {
		await click(`[aria-label="Spell tab ${(tab + 1) % 10}"]`);
		assert.equal(
			await read(`${probe}.bindings().selected`),
			tab,
			"Layout handles leave every tab clickable",
		);
	}
	await click('[aria-label="Spell tab 1"]');
	await click('[aria-label="Lock UI layout"]');
	await read(`${probe}.mode('peace')`);
	await read(`${probe}.mode('magic')`);
	assert.equal(
		await read(
			`document.querySelector('[data-spell-bar-surface]').dataset.spellBarShape`,
		),
		"double",
		"Shape survives stance hiding",
	);
	if (screenshotPath) {
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await writeFile(
			`${screenshotPath}.spell-bar-double.png`,
			Buffer.from(shot.data, "base64"),
		);
	}
	await click('[aria-label="Unlock UI layout"]');
	await toggleShape();
	assert.equal(
		await read(
			`document.querySelector('[data-spell-bar-surface]').dataset.spellBarShape`,
		),
		"single",
	);
	await click('[aria-label="Lock UI layout"]');
	await read(`${probe}.knowledge([])`);
	await click(cell(1));
	await key("2", "Digit2");
	assert.equal(
		(await casts()).length,
		initialCasts + 2,
		"Unknown spell cannot cast",
	);
	assert.equal(await binding(1), 1, "Knowledge loss preserves binding");
	await read(`${probe}.knowledge([1,2,3])`);
	await read(`${probe}.deferBoundSpell()`);
	await key("@", "Digit2", 8);
	await read(`${probe}.releaseBoundSpell()`);
	await settled();
	assert.equal(
		await binding(9),
		null,
		"Late reference does not replace another tab",
	);
	assert.equal(
		await read(`document.querySelector('${cell(9)} img') === null`),
		true,
		"Late reference does not publish artwork into another tab",
	);
	await key("!", "Digit1", 8);
	await settled();
	assert.equal(
		await binding(9),
		1800,
		"Switching tabs preserves deferred binding",
	);
	await read(`new Promise((resolve,reject)=>{ const start=performance.now(); const timer=setInterval(()=>{
  if(document.querySelector('${cell(9)} img')) {clearInterval(timer);resolve(true);}
  else if(performance.now()-start>5000){clearInterval(timer);reject(new Error('Deferred binding artwork did not load'));}
 },20); })`);
	const viewport = await read(`({width:innerWidth,height:innerHeight})`);
	await client.send("Emulation.setDeviceMetricsOverride", {
		width: 300,
		height: viewport.height,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await settled();
	const last = await point(cell(9));
	assert.ok(
		last.x >= 0 && last.x <= 300,
		"Last cell stays reachable in a narrow viewport",
	);
	await client.send("Emulation.setDeviceMetricsOverride", {
		...viewport,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await settled();
	await read(`document.querySelector('.spell-bar-scroll').scrollTo(0,0)`);
	const backgrounds = [];
	for (const standard of [false, true]) {
		await read(`${probe}.theme(${standard})`);
		await settled();
		const colors = await read(`(() => {
   const empty=document.querySelector('${cell(0)}'); const full=document.querySelector('${cell(1)}');
   const expected=document.createElement('div'); expected.style.background='color-mix(in srgb, var(--ui-spell-bar-color) var(--ui-spell-cell-background-opacity), transparent)'; document.body.append(expected);
   const tint=getComputedStyle(expected).backgroundColor; expected.remove();
   const action=document.querySelector('[data-action-cell]');
   const tabs=document.querySelector('.spell-tabs').getBoundingClientRect();
   const bar=document.querySelector('[data-spell-bar-surface]').getBoundingClientRect();
   return {empty:getComputedStyle(empty,'::before').backgroundColor, full:getComputedStyle(full,'::before').backgroundColor,
    flat:getComputedStyle(full).backgroundColor, mask:getComputedStyle(full,'::before').maskImage,actionMask:getComputedStyle(action,'::before').maskImage,
    tint,tabHeight:tabs.height,cellHeight:full.getBoundingClientRect().height,tabWidth:tabs.width,barWidth:bar.width};
  })()`);
		assert.equal(
			colors.empty,
			colors.tint,
			"Empty cells consume spell backing",
		);
		assert.equal(
			colors.full,
			colors.tint,
			"Populated cells consume spell backing",
		);
		assert.equal(
			colors.flat,
			"rgba(0, 0, 0, 0)",
			"Cell face remains transparent",
		);
		assert.equal(
			colors.mask,
			colors.actionMask,
			"Spell cells reuse action cell feathering",
		);
		assert.ok(
			colors.tabHeight < colors.cellHeight && colors.tabWidth < colors.barWidth,
			"Compact tabs occupy less than the full strip",
		);
		backgrounds.push(colors.tint);
	}
	assert.notEqual(
		backgrounds[0],
		backgrounds[1],
		"Theme change updates spell tint",
	);
	const backing = () =>
		read(
			`getComputedStyle(document.querySelector('${cell(1)}'),'::before').backgroundColor`,
		);
	const original = await backing();
	await read(
		`document.documentElement.style.setProperty('--ui-color-mana','#ff00ff')`,
	);
	assert.equal(
		await backing(),
		original,
		"Mana palette does not own spell bar palette",
	);
	await read(
		`document.documentElement.style.removeProperty('--ui-color-mana');document.documentElement.style.setProperty('--ui-spell-bar-color','#00ff00')`,
	);
	assert.notEqual(
		await backing(),
		original,
		"Dedicated spell palette updates backing",
	);
	await read(
		`document.documentElement.style.removeProperty('--ui-spell-bar-color');document.documentElement.style.setProperty('--ui-spell-cell-background','rgba(10, 20, 30, 0.25)')`,
	);
	assert.equal(
		await backing(),
		"rgba(10, 20, 30, 0.25)",
		"Theme can replace the complete backing",
	);
	await read(
		`document.documentElement.style.removeProperty('--ui-spell-cell-background');document.documentElement.style.setProperty('--ui-spell-tab-height','20px')`,
	);
	await settled();
	assert.equal(
		await read(
			`document.querySelector('.spell-tabs').getBoundingClientRect().height`,
		),
		20,
		"Theme controls tab height",
	);
	const themedFit = await fits();
	assert.equal(
		themedFit.height,
		themedFit.scrollHeight,
		"Layout follows theme tab height",
	);
	await read(
		`document.documentElement.style.removeProperty('--ui-spell-tab-height')`,
	);
	await settled();
	if (screenshotPath) {
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await writeFile(
			`${screenshotPath}.spell-bar.png`,
			Buffer.from(shot.data, "base64"),
		);
	}
	await read(`${probe}.end()`);
	return {
		drag: true,
		casting: true,
		focusPriority: true,
		layout: true,
		knowledge: true,
	};
}
