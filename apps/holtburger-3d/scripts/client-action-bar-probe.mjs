import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

/** Real pointer/key events cover local binding edits and the typed equipment boundary. */
export async function probeActionBars(
	client,
	evaluateExpression,
	screenshotPath,
) {
	const read = (expression) => evaluateExpression(client, expression);
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	// Stable identities belong to mounted bars, not their sequence labels or prior sessions.
	const barIds = [
		await read(
			`document.querySelector('[data-action-bar-surface]').dataset.actionBarSurface`,
		),
	];
	const cell = (bar, digit) => {
		const id = barIds[bar - 1];
		assert.notEqual(id, undefined, "Probe bar has not been created");
		return `[data-action-bar="${id}"][data-action-cell="${digit}"]`;
	};
	const item = (bar, digit) =>
		read(
			`document.querySelector(${JSON.stringify(cell(bar, digit))}).dataset.actionItem ?? null`,
		);
	const commands = () => read(`${api}.inventoryDragCommands()`);
	const equipCount = async () =>
		(await commands()).filter((entry) => entry.command === "equip_client_item")
			.length;
	const point = (selector) =>
		read(`(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) throw new Error('Missing action probe element: ' + ${JSON.stringify(selector)});
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = element.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
 })()`);
	const mouse = (type, p, buttons) =>
		client.send("Input.dispatchMouseEvent", {
			type,
			...p,
			button: "left",
			buttons,
			clickCount: 1,
		});
	const key = async (key, code, modifiers = 0) => {
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key,
			code,
			modifiers,
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key,
			code,
			modifiers,
		});
	};
	const drag = async (from, to, cancel = false) => {
		const start = await point(from);
		const selectionBefore = await read(`${api}.capture().selectedGuid`);
		const bindingSource = await read(
			`document.querySelector(${JSON.stringify(from)}).matches("[data-action-cell]")`,
		);
		const end = typeof to === "string" ? await point(to) : to;
		await mouse("mousePressed", start, 1);
		await mouse("mouseMoved", end, 1);
		if (cancel) await key("Escape", "Escape");
		await mouse("mouseReleased", end, 0);
		if (bindingSource)
			assert.equal(
				await read(`${api}.capture().selectedGuid`),
				selectionBefore,
				"Binding drag changed entity selection",
			);
	};

	const click = async (position) => {
		await mouse("mousePressed", position, 1);
		await mouse("mouseReleased", position, 0);
	};
	const menu = async (sequence, operation) => {
		await click(
			await point(`button[aria-label^="Action bar ${sequence} menu"]`),
		);
		const position = await read(`(() => {
   const menu = document.querySelector('[role="menu"]:popover-open');
   if (!menu) throw new Error('Action menu did not open');
   const button = Array.from(menu.querySelectorAll('button')).find((button) => button.textContent === ${JSON.stringify(operation)});
   const r = button.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
		await click(position);
	};

	const selected = () =>
		read(
			`document.querySelector('.action-cell[aria-pressed="true"]')?.dataset.actionCell ?? null`,
		);

	const assertStrip = async (orientation) => {
		const geometry = await read(`(() => {
   const bar = document.querySelector('[data-action-bar-surface="${barIds[0]}"]');
   const bounds = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
   const strip = bar.querySelector('.action-menu-strip');
   return { gap: Number.parseFloat(getComputedStyle(bar).gap), strip: bounds(strip), grid: bounds(bar.querySelector('.action-grid')), label: strip.textContent.trim() };
  })()`);
		assert.equal(geometry.label, "C1");
		if (orientation === "horizontal") {
			assert.equal(geometry.strip.right + geometry.gap, geometry.grid.left);
			assert.equal(geometry.strip.top, geometry.grid.top);
			assert.equal(geometry.strip.height, geometry.grid.height);
		} else {
			assert.equal(geometry.strip.bottom + geometry.gap, geometry.grid.top);
			assert.equal(geometry.strip.left, geometry.grid.left);
			assert.equal(geometry.strip.width, geometry.grid.width);
		}
	};

	const assertThemeGap = async (orientation) => {
		const dimensions = () =>
			read(`(() => {
   const bar = document.querySelector('[data-action-bar-surface="${barIds[0]}"]');
   const r = bar.getBoundingClientRect();
   return { width: r.width, height: r.height, gap: Number.parseFloat(getComputedStyle(bar).gap) };
  })()`);
		const before = await dimensions();
		const theme = (value) =>
			read(`(async () => {
   const root = document.querySelector('.client-world');
   const value = ${JSON.stringify(value)};
   if (value === null) root.style.removeProperty('--ui-action-bar-strip-gap');
   else root.style.setProperty('--ui-action-bar-strip-gap', value);
   for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
  })()`);
		await theme(`calc(${before.gap}px + 0.5rem)`);
		try {
			const after = await dimensions();
			assert.ok(
				after.gap > before.gap,
				"Theme CSS controls the live strip gap",
			);
			const axis = orientation === "horizontal" ? "width" : "height";
			assert.equal(
				after[axis] - before[axis],
				after.gap - before.gap,
				"Anchored extent follows resolved CSS spacing",
			);
			await assertStrip(orientation);
		} finally {
			await theme(null);
		}
	};
	await assertThemeGap("horizontal");
	const openMenu = () =>
		read(`document.querySelector('[role="menu"]:popover-open') !== null`);
	const activeCommand = () =>
		read(`(() => {
  const menu = document.querySelector('[role="menu"]:popover-open');
  return document.getElementById(menu.getAttribute('aria-activedescendant')).textContent;
 })()`);
	const trigger = await point(".action-menu-strip");
	assert.deepEqual(
		await read(
			`(() => { const menu = document.querySelector('.action-menu-strip'); return { hint: menu.textContent, title: menu.title }; })()`,
		),
		{ hint: "C1", title: "Action bar 1 menu (focus: Ctrl + 1)" },
	);
	await click(trigger);
	assert.equal(await openMenu(), true);
	assert.equal(await activeCommand(), "Clone");
	await key("ArrowDown", "ArrowDown");
	assert.equal(await activeCommand(), "Clone");
	await key("ArrowDown", "ArrowDown");
	assert.equal(await activeCommand(), "Clone");
	await key("Escape", "Escape");
	assert.equal(await openMenu(), false);
	await click(trigger);
	await click(trigger);
	assert.equal(await openMenu(), false);
	await click(trigger);
	await click({ x: 1, y: 1 });
	assert.equal(await openMenu(), false);

	await assertStrip("horizontal");
	const source =
		'.client-inventory .contents-scroll .item-grid-cell[data-item-guid="91"]';
	const mutations = async () =>
		(await commands()).filter((entry) =>
			["submit_client_inventory", "equip_client_item"].includes(entry.command),
		).length;
	const before = await mutations();
	await drag(source, cell(1, 3));
	assert.equal(await item(1, 3), "91", "Inventory drag binds equipment");
	assert.equal(
		await mutations(),
		before,
		"Binding sends no inventory or equipment command",
	);
	const assertEquipped = async (expected) => {
		const marked = await read(`(async () => {
   const deadline = performance.now() + 5000;
   while (performance.now() < deadline) {
    const cell = document.querySelector(${JSON.stringify(cell(1, 0))});
    const marked = cell.querySelector('.item-equipped') !== null;
    if (marked === ${expected}) return { marked, label: cell.getAttribute('aria-label') };
    await new Promise(requestAnimationFrame);
   }
   throw new Error('Equipped action indicator did not update');
  })()`);
		assert.equal(marked.marked, expected);
		assert.equal(marked.label.includes("(Equipped)"), expected);
	};
	await drag(
		'.equipment-row[aria-label="Chest armor"] .item-grid-cell[data-item-guid="95"]',
		cell(1, 0),
	);
	await assertEquipped(true);
	await drag(source, cell(1, 0));
	await assertEquipped(false);
	await drag(cell(1, 0), { x: 500, y: 300 });
	const count = await equipCount();
	await key("1", "Digit1", 2);
	assert.equal(await selected(), "1", "Focus begins at the first empty slot");
	await key("3", "Digit3");
	assert.equal(await selected(), null);
	assert.equal(await equipCount(), count + 1);
	assert.deepEqual((await commands()).at(-1), {
		command: "equip_client_item",
		args: { guid: 91, alternate: false },
	});
	await drag(cell(1, 3), cell(1, 6));
	assert.equal(await item(1, 3), null);
	assert.equal(await item(1, 6), "91");
	await key("1", "Digit1", 2);
	await drag(cell(1, 6), { x: 500, y: 300 }, true);
	assert.equal(await item(1, 6), "91", "Escape preserves the binding");
	const bounds = () =>
		read(`Array.from(document.querySelectorAll('[data-action-bar-surface]'), (element) => {
  const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
 })`);
	const assertNoOverlap = (rectangles) => {
		for (const [index, a] of rectangles.entries())
			for (const b of rectangles.slice(index + 1))
				assert.ok(
					a.right <= b.left ||
						b.right <= a.left ||
						a.bottom <= b.top ||
						b.bottom <= a.top,
					"Clones must not overlap existing bars",
				);
	};
	await menu(1, "Clone");
	barIds.push(
		await read(
			`document.querySelectorAll("[data-action-bar-surface]")[1].dataset.actionBarSurface`,
		),
	);
	await key("1", "Digit1", 2);
	await key("2", "Digit2", 2);
	assert.equal(
		await read(`document.activeElement.dataset.actionBarSurface`),
		barIds[1],
		"Focus chords switch bars without activating a cell",
	);
	await key("Escape", "Escape");
	const horizontalClones = await bounds();
	assert.equal(horizontalClones[0].left, horizontalClones[1].left);
	assert.ok(
		horizontalClones[1].bottom < horizontalClones[0].top,
		"Horizontal clone stacks above source",
	);
	assertNoOverlap(horizontalClones);
	assert.equal(await item(2, 6), "91");
	await drag(cell(1, 6), cell(2, 3));
	assert.equal(await item(1, 6), null);
	assert.equal(await item(2, 3), "91");
	await drag(cell(2, 3), source);
	assert.equal(
		await item(2, 3),
		null,
		"Release over inventory clears rather than moving an item",
	);
	assert.equal(await item(2, 6), "91", "Sparse slots retain their addresses");
	await menu(2, "Cycle");
	await key("1", "Digit1", 2);
	assert.equal(
		await read(`document.activeElement.dataset.actionBarSurface`),
		barIds[1],
		"Cycling changes hotkeys without identity churn",
	);
	await key("Escape", "Escape");
	await menu(1, "Delete");
	assert.equal(
		await read(`document.querySelectorAll('[data-action-bar-surface]').length`),
		1,
	);
	await menu(1, "Delete");
	assert.equal(
		await read(`document.querySelectorAll('[data-action-bar-surface]').length`),
		1,
	);
	// Disabled deletion leaves the menu open.
	await key("Escape", "Escape");
	await read(
		`document.querySelector('button[aria-label="Unlock UI layout"]').click()`,
	);
	const toggleShape = async () => {
		const handle = await point(
			'button[aria-label="Toggle action bar shape 1"]',
		);
		await mouse("mousePressed", handle, 1);
		await mouse("mouseReleased", handle, 0);
	};
	await toggleShape();
	const positions = () =>
		read(
			`Array.from(document.querySelectorAll('.action-cell'), (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y }; })`,
		);
	await assertStrip("horizontal");
	let grid = await positions();
	assert.equal(grid[0].x, grid[5].x);
	assert.ok(
		grid[5].y > grid[0].y,
		"Double horizontal shape has two five-cell rows",
	);
	await toggleShape();
	grid = await positions();
	assert.equal(new Set(grid.map((cell) => cell.y)).size, 1);
	await toggleShape();
	await key("1", "Digit1", 2);
	await key("ArrowUp", "ArrowUp");
	assert.equal(await selected(), "6");
	await key("Enter", "Enter");
	await menu(1, "Rotate");
	await assertStrip("vertical");
	await assertThemeGap("vertical");
	grid = await positions();
	assert.equal(grid[0].y, grid[5].y);
	assert.ok(
		grid[5].x > grid[0].x,
		"Double vertical shape has two five-cell columns",
	);
	await key("1", "Digit1", 2);
	await key("ArrowLeft", "ArrowLeft");
	assert.equal(await selected(), "6");
	await read(`window.dispatchEvent(new Event('blur'))`);
	assert.equal(await selected(), null);
	await key("6", "Digit6");
	assert.equal(
		await equipCount(),
		count + 1,
		"Blur relinquishes one-shot command ownership",
	);
	await read(
		`document.querySelector('button[aria-label="Lock UI layout"]').click()`,
	);
	await menu(1, "Clone");
	const verticalClones = await bounds();
	assert.equal(verticalClones[0].top, verticalClones[1].top);
	assertNoOverlap(verticalClones);
	await menu(1, "Clone");
	assertNoOverlap(await bounds());
	await menu(2, "Delete");
	await menu(2, "Delete");
	// Earlier swap coverage emptied the surviving bar; bind a fresh activation target.
	await drag(source, cell(1, 6));
	const modifierCommands = await equipCount();
	await key("1", "Digit1", 2);
	await key("^", "Digit6", 8);
	assert.deepEqual((await commands()).at(-1), {
		command: "equip_client_item",
		args: { guid: 91, alternate: true },
	});
	assert.equal(await selected(), null);
	await key("1", "Digit1", 2);
	// Move from the first slot to the populated sixth slot in the double vertical grid.
	await key("ArrowLeft", "ArrowLeft");
	await key("Enter", "Enter", 8);
	assert.deepEqual((await commands()).at(-1), {
		command: "equip_client_item",
		args: { guid: 91, alternate: true },
	});
	const actionPoint = await point(cell(1, 6));
	for (const modifiers of [8, 0]) {
		for (const [type, buttons] of [
			["mousePressed", 1],
			["mouseReleased", 0],
		])
			await client.send("Input.dispatchMouseEvent", {
				type,
				...actionPoint,
				button: "left",
				buttons,
				clickCount: 1,
				modifiers,
			});
		assert.deepEqual((await commands()).at(-1), {
			command: "equip_client_item",
			args: { guid: 91, alternate: modifiers === 8 },
		});
	}
	assert.equal(await equipCount(), modifierCommands + 4);
	// A targeted stack has an alternate target; the armor in slot 6 and empty cells do not.
	await drag(
		'.client-inventory .contents-scroll .item-grid-cell[data-item-guid="94"]',
		cell(1, 3),
	);
	await read(`(async () => {
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
            const cell = document.querySelector(${JSON.stringify(cell(1, 3))});
            if (cell.dataset.actionItem === '94' && cell.dataset.dimmed === 'false') return;
            await new Promise(requestAnimationFrame);
        }
        throw new Error('Alternate-action binding did not become available');
    })()`);
	const alternateHints = () =>
		read(`Array.from(document.querySelectorAll('.action-alternate')).map(marker => ({
        digit: marker.closest('.action-cell').dataset.actionCell,
        label: marker.closest('.action-cell').getAttribute('aria-label'),
        visible: marker.matches(':popover-open') && marker.getBoundingClientRect().width > 0,
        above: marker.getBoundingClientRect().bottom <= marker.closest('.action-cell').getBoundingClientRect().top
    }))`);
	const shift = (down) =>
		client.send("Input.dispatchKeyEvent", {
			type: down ? "keyDown" : "keyUp",
			key: "Shift",
			code: "ShiftLeft",
			modifiers: down ? 8 : 0,
		});
	await key("1", "Digit1", 2);
	assert.deepEqual(await alternateHints(), []);
	await shift(true);
	assert.deepEqual(
		(await alternateHints()).map((hint) => hint.digit),
		["3"],
	);
	assert.equal((await alternateHints())[0].visible, true);
	assert.equal(
		(await alternateHints())[0].above,
		true,
		"Graphic floats above the cell outside scroll clipping",
	);
	if (screenshotPath) {
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await writeFile(
			`${screenshotPath}.action-alternate.png`,
			Buffer.from(shot.data, "base64"),
		);
	}
	assert.ok(
		(await alternateHints())[0].label.includes("Use on selected target"),
	);
	// Top-layer graphics still inherit theme tokens from the client UI subtree.
	const themed = await read(`(async () => {
        const root = document.querySelector('.client-world');
        const marker = document.querySelector('.action-alternate');
        const measure = () => {
            const style = getComputedStyle(marker);
            const foreground = getComputedStyle(marker.querySelector('path:last-child'));
            const outline = getComputedStyle(marker.querySelector('.alternate-outline'));
            const rect = marker.getBoundingClientRect();
            const cell = marker.closest('.action-cell').getBoundingClientRect();
            return { width: rect.width, height: rect.height, gap: cell.top - rect.bottom,
                color: foreground.stroke, stroke: foreground.strokeWidth,
                outlineColor: outline.stroke, outline: outline.strokeWidth, filter: style.filter };
        };
        const overrides = {
            '--ui-action-alternate-width': '48px',
            '--ui-action-alternate-height': '40px',
            '--ui-action-alternate-gap': '8px',
            '--ui-action-alternate-color': '#00ff00',
            '--ui-action-alternate-stroke-width': '2',
            '--ui-action-alternate-outline-width': '5',
            '--ui-action-alternate-outline-color': '#0000ff',
            '--ui-action-alternate-filter': 'none',
        };
        const baseline = measure();
        const previous = Object.keys(overrides).map(key => [key, root.style.getPropertyValue(key), root.style.getPropertyPriority(key)]);
        let overridden;
        try {
            for (const [key, value] of Object.entries(overrides)) root.style.setProperty(key, value);
            await new Promise(requestAnimationFrame);
            overridden = measure();
        } finally {
            for (const [key, value, priority] of previous) {
                if (value) root.style.setProperty(key, value, priority);
                else root.style.removeProperty(key);
            }
        }
        await new Promise(requestAnimationFrame);
        return { baseline, overridden, restored: measure() };
    })()`);
	assert.deepEqual(themed.overridden, {
		width: 48,
		height: 40,
		gap: 8,
		color: "rgb(0, 255, 0)",
		stroke: "2px",
		outlineColor: "rgb(0, 0, 255)",
		outline: "5px",
		filter: "none",
	});
	assert.deepEqual(
		themed.restored,
		themed.baseline,
		"Removing theme overrides restores the marker",
	);
	await shift(false);
	assert.deepEqual(
		await alternateHints(),
		[],
		"Passthrough modifier release clears the hint",
	);
	await shift(true);
	await key("Escape", "Escape", 8);
	assert.deepEqual(
		await alternateHints(),
		[],
		"Leaving the bar clears modifier hints",
	);
	await shift(false);
	assert.deepEqual(await alternateHints(), []);
	await drag(cell(1, 3), { x: 500, y: 300 });
	return {
		alternateHints: true,
		clonePlacement: true,
		menuStrip: true,
		binding: true,
		typedEquipmentActivation: true,
		sparseTransfer: true,
		crossBarSwap: true,
		outsideClear: true,
		cancellation: true,
		sequencing: true,
		mandatoryBar: true,
		shapeToggle: true,
		rotation: true,
		gridNavigation: true,
		blurCancellation: true,
	};
}
