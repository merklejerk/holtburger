import assert from "node:assert/strict";

/** Drive the production selection, input, request owner, and floating window through real DOM events. */
export async function probeObjectInspection(
	client,
	evaluateExpression,
	onScreenshot,
) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const probe = api + ".objectInspectionProbe()";
	const read = (expression) => evaluateExpression(client, expression);
	const snapshot = () => read(probe + ".snapshot()");
	const settle = (milliseconds = 300) =>
		new Promise((resolve) => setTimeout(resolve, milliseconds));
	const waitFor = async (predicate, diagnostic) => {
		const deadline = Date.now() + 5_000;
		for (;;) {
			const value = await snapshot();
			if (predicate(value)) return value;
			if (Date.now() >= deadline)
				throw new Error(`${diagnostic}: ${JSON.stringify(value)}`);
			await settle(50);
		}
	};
	const waitForSelector = async (selector, diagnostic) => {
		const deadline = Date.now() + 5_000;
		for (;;) {
			if (
				await read(
					`document.querySelector(${JSON.stringify(selector)}) !== null`,
				)
			)
				return;
			if (Date.now() >= deadline) throw new Error(diagnostic);
			await settle(50);
		}
	};
	const point = (selector) =>
		read(`(() => {
			const element = document.querySelector(${JSON.stringify(selector)});
			if (!element) throw new Error('Missing inspection target: ' + ${JSON.stringify(selector)});
			const box = element.getBoundingClientRect();
			return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		})()`);
	const click = async (selector) => {
		const position = await point(selector);
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...position,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...position,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
	};
	const rightClick = async (selector) => {
		const position = await point(selector);
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
	const drag = async (source, target) => {
		const start = await point(source);
		const end = await point(target);
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...start,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...end,
			button: "left",
			buttons: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...end,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
	};
	const sendBinding = async (repeat = false) => {
		const binding = await read(probe + ".binding");
		const key = binding.key ?? "Unidentified";
		const code = binding.code ?? "";
		const modifiers =
			(binding.alt ? 1 : 0) |
			(binding.ctrl ? 2 : 0) |
			(binding.meta ? 4 : 0) |
			(binding.shift ? 8 : 0);
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key,
			code,
			modifiers,
			autoRepeat: repeat,
		});
		if (!repeat)
			await client.send("Input.dispatchKeyEvent", {
				type: "keyUp",
				key,
				code,
				modifiers,
			});
	};
	const select = async (guid) => {
		await read(`${probe}.select(${guid === null ? "null" : guid})`);
		await settle(300);
	};
	const respond = (kind, guid) =>
		read(`${probe}.respond(${JSON.stringify(kind)}, ${guid})`);
	const screenshot = async (name) => {
		if (!onScreenshot) return;
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await onScreenshot(name, shot.data);
	};

	await read(probe + ".begin()");
	try {
		// Earlier HUD probes may intentionally leave a system window open. Representative
		// inspection captures start clean; coexistence is exercised explicitly below.
		await read(
			"document.querySelector('button[aria-label=\"Close Inventory\"]')?.click()",
		);
		await settle(100);
		// No selection is a strict no-op through the configured shortcut.
		await sendBinding();
		assert.equal((await snapshot()).commandCount, 0);

		// Button captures the target, suppresses duplicates, and remains windowless while pending.
		await select(7);
		await click('button[aria-label="Examine"]');
		let pending = await snapshot();
		assert.equal(pending.commandCount, 1);
		assert.deepEqual(pending.commands[0]?.args, { guid: 7 });
		assert.deepEqual(pending.state, { kind: "pending", guid: 7 });
		assert.equal(pending.window, null);
		assert.equal(
			await read(
				"document.querySelector('button[aria-label=\"Examining selected entity\"]')?.disabled",
			),
			true,
		);
		await click('button[aria-label="Examining selected entity"]');
		assert.equal((await snapshot()).commandCount, 1);

		// Selection replacement cannot retarget an already captured request or resulting snapshot.
		await select(8);
		await respond("item", 7);
		let item = await waitFor(
			(value) => value.window?.title?.startsWith("Ancient Atlan") === true,
			"Item inspection did not open",
		);
		assert.equal(item.selectedGuid, 8);
		assert.equal(item.state.guid, 7);
		assert.equal(item.window.count, 1);
		assert.match(item.window.text, /Black Garnet/);
		assert.match(item.window.text, /125,000/);
		assert.match(item.window.text, /9,802 \/ 10,000/);
		assert.match(item.window.text, /Harm Other I \(active\)/);
		assert.match(item.window.text, /definition missing/);
		assert.ok(item.window.scrollHeight > item.window.clientHeight);
		await settle(400);
		item = await snapshot();
		assert.equal(
			await read(
				"document.querySelector('.inspection-artwork img, .inspection-artwork .inspection-diagnostic') !== null",
			),
			true,
		);
		const equipmentPresentation = await read(`(() => {
			const sections = [...document.querySelectorAll('.inspection-item section')];
			const sectionFor = (label) => sections.find((section) => section.querySelector('h3')?.textContent === label);
			return {
				armorInCombat: sectionFor('Combat')?.textContent.includes('Armor') ?? false,
				armorInProtections: sectionFor('Protections')?.textContent.includes('Armor') ?? false,
				beneficial: document.querySelectorAll('.inspection-enchantment-beneficial').length,
				harmful: document.querySelectorAll('.inspection-enchantment-harmful').length,
				unbuffed: document.querySelectorAll('.inspection-unbuffed').length,
			};
		})()`);
		assert.equal(equipmentPresentation.armorInCombat, false);
		assert.equal(equipmentPresentation.armorInProtections, true);
		assert.ok(equipmentPresentation.beneficial > 0);
		assert.ok(equipmentPresentation.harmful > 0);
		assert.ok(equipmentPresentation.unbuffed > 0);
		await screenshot("inspection-item");

		const commandsBeforeClose = item.commandCount;
		await click('button[aria-label^="Close Ancient Atlan Sword"]');
		assert.equal((await snapshot()).window, null);
		assert.equal((await snapshot()).selectedGuid, 8);
		assert.equal((await snapshot()).commandCount, commandsBeforeClose);

		// A failed artwork lease leaves the inspected identity and textual facts usable.
		await read(probe + ".setArtworkFailure(true)");
		await select(7);
		await click('button[aria-label="Examine"]');
		await respond("item", 7);
		await waitFor(
			(value) => value.window?.title?.startsWith("Ancient Atlan") === true,
			"Artwork-failure inspection did not open",
		);
		await settle(400);
		const artworkFailure = await snapshot();
		assert.match(artworkFailure.window.text, /Artwork unavailable/);
		assert.match(artworkFailure.window.text, /Ancient Atlan Sword/);
		await click('button[aria-label^="Close Ancient Atlan Sword"]');
		await read(probe + ".setArtworkFailure(false)");

		// Shortcut uses the same action; an auto-repeat edge is ignored.
		await select(8);
		const commandsBeforeCreature = (await snapshot()).commandCount;
		await sendBinding(true);
		await sendBinding();
		pending = await snapshot();
		assert.equal(pending.commandCount, commandsBeforeCreature + 1);
		assert.deepEqual(pending.commands.at(-1)?.args, { guid: 8 });
		assert.equal(pending.window, null);
		await respond("creature", 8);
		let creature = await waitFor(
			(value) => value.window?.title === "Olthoi Eviscerator",
			"Creature inspection did not open",
		);
		assert.match(creature.window.text, /Creature vitals|Health/);
		assert.match(creature.window.text, /attributes/i);
		assert.doesNotMatch(creature.window.text, /Wield requirements/);
		const creatureEnhancements = await read(`({
			beneficial: document.querySelectorAll('.inspection-creature .inspection-enchantment-beneficial').length,
			harmful: document.querySelectorAll('.inspection-creature .inspection-enchantment-harmful').length,
			unbuffed: document.querySelectorAll('.inspection-creature .inspection-unbuffed').length,
		})`);
		assert.deepEqual(creatureEnhancements, {
			beneficial: 2,
			harmful: 2,
			unbuffed: 0,
		});
		await screenshot("inspection-creature");

		// A newer target closes the old snapshot and filters the late prior response.
		await select(7);
		await click('button[aria-label="Examine"]');
		await select(8);
		await sendBinding();
		const latestCount = (await snapshot()).commandCount;
		await respond("item", 7);
		pending = await snapshot();
		assert.deepEqual(pending.state, { kind: "pending", guid: 8 });
		assert.equal(pending.window, null);
		await respond("creature", 8);
		creature = await waitFor(
			(value) => value.window?.title === "Olthoi Eviscerator",
			"Latest inspection response did not win",
		);
		assert.equal(creature.commandCount, latestCount);

		// Rejected and missing remain distinct user-visible failures and clear pending UI.
		await select(7);
		await click('button[aria-label="Examine"]');
		await respond("rejected", 7);
		let failure = await snapshot();
		assert.equal(failure.failure, "You could not examine that object.");
		assert.equal(failure.state.kind, "idle");
		assert.equal(failure.window, null);
		await click('button[aria-label="Examine"]');
		await respond("missing", 7);
		failure = await snapshot();
		assert.equal(failure.failure, "That object is no longer available.");
		assert.equal(failure.state.kind, "idle");

		// Re-open the long item, then exercise native drag and border resize.
		await click('button[aria-label="Examine"]');
		await respond("item", 7);
		item = await waitFor(
			(value) => value.window !== null,
			"Geometry item inspection did not open",
		);
		const initialRectangle = item.window.rectangle;
		const dragFrom = await point(
			'section[aria-label^="Ancient Atlan"] .hud-window-titlebar',
		);
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...dragFrom,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: dragFrom.x - 90,
			y: dragFrom.y - 55,
			button: "left",
			buttons: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: dragFrom.x - 90,
			y: dragFrom.y - 55,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
		let moved = await snapshot();
		assert.notEqual(moved.window.rectangle.left, initialRectangle.left);
		assert.notEqual(moved.window.rectangle.top, initialRectangle.top);

		const resizeFrom = await point(
			'section[aria-label^="Ancient Atlan"] .hud-window-resize-bottom-left',
		);
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...resizeFrom,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: resizeFrom.x - 60,
			y: resizeFrom.y + 45,
			button: "left",
			buttons: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: resizeFrom.x - 60,
			y: resizeFrom.y + 45,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
		const resized = await snapshot();
		assert.ok(resized.window.rectangle.width > moved.window.rectangle.width);
		assert.ok(resized.window.rectangle.height > moved.window.rectangle.height);

		// Existing container and system windows remain mounted alongside inspection.
		const debug = await read(
			'document.querySelector(\'button[aria-label="Debug"]\')?.getAttribute("aria-pressed")',
		);
		if (debug !== "true") await click('button[aria-label="Debug"]');
		const coexistence = await read(`({
			inspection: document.querySelectorAll('.inspection-scroll').length,
			worldContainer: document.querySelectorAll('.world-container-window').length,
			debug: Array.from(document.querySelectorAll('section[aria-label]')).some((node) => node.getAttribute('aria-label') === 'Client diagnostics')
		})`);
		assert.deepEqual(coexistence, {
			inspection: 1,
			worldContainer: 1,
			debug: true,
		});
		await click('button[aria-label="Debug"]');

		// Smaller than authored minima: fitting may relax size but cannot strand controls.
		await client.send("Emulation.setDeviceMetricsOverride", {
			width: 360,
			height: 320,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await settle(350);
		const narrow = await snapshot();
		assert.ok(narrow.window.rectangle.left >= 0);
		assert.ok(narrow.window.rectangle.top >= 0);
		assert.ok(
			narrow.window.rectangle.left + narrow.window.rectangle.width <= 360,
		);
		assert.ok(
			narrow.window.rectangle.top + narrow.window.rectangle.height <= 320,
		);
		await screenshot("inspection-small-viewport");
		await client.send("Emulation.setDeviceMetricsOverride", {
			width: 1280,
			height: 720,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await settle(350);

		// Item cells and item-backed action cells share the same select-and-examine policy.
		await read(
			"document.querySelector('button[aria-label^=\"Close Ancient Atlan Sword\"]').click()",
		);
		await read(
			"document.querySelector('button[aria-label=\"Inventory\"]').click()",
		);
		const inventoryItem =
			'.client-inventory .contents-scroll .item-grid-cell[data-item-guid="300"]';
		await waitForSelector(
			inventoryItem,
			"Inventory did not mount an authoritative item for right-click inspection",
		);
		const beforeInventoryCell = await snapshot();
		await rightClick(inventoryItem);
		const inventoryCell = await waitFor(
			(value) => value.commandCount === beforeInventoryCell.commandCount + 1,
			"Inventory cell right-click did not request inspection",
		);
		assert.equal(inventoryCell.selectedGuid, 300);
		assert.deepEqual(inventoryCell.commands.at(-1)?.args, { guid: 300 });
		await respond("missing", 300);

		const emptyActionCell = ".action-cell:not([data-action-item])";
		await drag(inventoryItem, emptyActionCell);
		await waitForSelector(
			'.action-cell[data-action-item="300"]',
			"Authoritative item did not bind to the action cell",
		);
		await read(
			"document.querySelector('button[aria-label=\"Close Inventory\"]').click()",
		);
		await select(8);
		const beforeActionCell = await snapshot();
		await rightClick('.action-cell[data-action-item="300"]');
		const actionCell = await waitFor(
			(value) => value.commandCount === beforeActionCell.commandCount + 1,
			"Action cell right-click did not request inspection",
		);
		assert.equal(actionCell.selectedGuid, 300);
		assert.deepEqual(actionCell.commands.at(-1)?.args, { guid: 300 });
		await respond("missing", 300);

		// Lifecycle reset owns teardown; no selection mutation is required.
		await read(probe + ".resync()");
		const reset = await snapshot();
		assert.equal(reset.window, null);
		assert.equal(reset.state.kind, "idle");
		await read(probe + ".restore()");
		await settle(100);

		// Right-click selects the viewport hit and examines that exact entity.
		const beforeRightClick = await snapshot();
		await rightClick(".client-canvas");
		const rightClicked = await waitFor(
			(value) => value.commandCount === beforeRightClick.commandCount + 1,
			"Right-click did not request inspection",
		);
		assert.equal(rightClicked.selectedGuid, 7);
		assert.deepEqual(rightClicked.commands.at(-1)?.args, { guid: 7 });

		return {
			buttonAndShortcutCommands: rightClicked.commandCount,
			capturedTarget: { requested: 7, selectedAfterRequest: 8 },
			coexistence,
			item: {
				scrollable: item.window.scrollHeight > item.window.clientHeight,
				title: item.window.title,
			},
			creature: { title: creature.window.title },
			creatureEnhancements,
			failures: [
				"You could not examine that object.",
				"That object is no longer available.",
			],
			geometry: {
				initial: initialRectangle,
				moved: moved.window.rectangle,
				resized: resized.window.rectangle,
				narrow: narrow.window.rectangle,
			},
			latestTargetFiltered: true,
			lifecycleReset: true,
			rightClickTargets: ["viewport", "inventory", "action"],
		};
	} finally {
		await client.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
		await read(probe + ".end()");
	}
}
