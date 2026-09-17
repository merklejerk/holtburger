/** Real CDP pointer events exercise production drag ownership with controlled core responses. */
export async function probeInventoryDrag(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const read = (expression) => evaluateExpression(client, expression);
	const commands = () => read(`${api}.inventoryDragCommands()`);
	const submissions = async () =>
		(await commands()).filter(
			(entry) => entry.command === "submit_client_inventory",
		);
	const lastPreview = async () => {
		const request = (await commands())
			.filter((entry) => entry.command === "preview_client_inventory")
			.at(-1)?.args?.request;
		if (!request) throw new Error("Inventory drag did not request a preview");
		return request;
	};
	const reply = (sequence, preview) =>
		read(
			`${api}.replyInventoryPreview(${JSON.stringify({ sequence, preview })})`,
		);
	const point = (selector) =>
		read(`(() => {
		const cell = document.querySelector(${JSON.stringify(selector)});
		if (!cell) throw new Error('Missing drag fixture cell');
		cell.scrollIntoView({ block: 'nearest' });
		const box = cell.getBoundingClientRect();
        if (cell.matches('[data-game-viewport]')) {
            for (let y = box.top + 20; y < box.bottom; y += 30) {
                for (let x = box.left + 20; x < box.right; x += 30) {
                    if (document.elementFromPoint(x, y) === cell) return { x, y };
                }
            }
            throw new Error('No uncovered viewport point');
        }
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
	})()`);
	const source = '.inventory-sections .item-grid-cell[data-item-guid="91"]';
	const target = '.inventory-sections .item-grid-cell[data-item-guid="94"]';
	const begin = async (sourceSelector, targetSelector) => {
		const from = await point(sourceSelector);
		const selected = await read(`${api}.capture().selectedGuid`);
		const submitted = (await submissions()).length;
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...from,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		if ((await read(`${api}.capture().selectedGuid`)) !== selected)
			throw new Error("Pointer press changed selection before dragging");
		const to = await point(targetSelector);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...to,
			button: "left",
			buttons: 1,
		});
		const item = await read(
			`Number(document.querySelector(${JSON.stringify(sourceSelector)}).dataset.itemGuid)`,
		);
		if ((await read(`${api}.capture().selectedGuid`)) !== item)
			throw new Error("Inventory drag did not select its source");
		if ((await submissions()).length !== submitted)
			throw new Error("Drag start submitted an inventory action");
		return to;
	};
	const release = (position) =>
		client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...position,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
	const countBefore = (await submissions()).length;
	const position = await begin(source, target);
	const ghost = await read(`(() => {
		const ghost = document.querySelector('.item-drag-ghost');
		const rect = ghost.getBoundingClientRect();
		return { x: rect.x, y: rect.y, visible: ghost.checkVisibility(), art: ghost.querySelector('.ui-icon, .ui-icon-fallback') !== null };
	})()`);
	if (
		!ghost.visible ||
		!ghost.art ||
		Math.abs(ghost.x - position.x - 12) > 1 ||
		Math.abs(ghost.y - position.y - 12) > 1
	)
		throw new Error(
			`Drag artwork is not visible beside the pointer: ${JSON.stringify({ ghost, position })}`,
		);
	const dimming = await read(
		`Array.from(document.querySelectorAll('[data-equipment-slot]'), (row) => ({ label: row.getAttribute('aria-label'), dimmed: row.dataset.inventoryDimmed }))`,
	);
	const candidates = dimming
		.filter((row) => row.dimmed === "false")
		.map((row) => row.label)
		.sort();
	if (
		JSON.stringify(candidates) !==
		JSON.stringify(["Chest armor", "Upper arm armor"])
	)
		throw new Error(
			"Inventory armor drag did not preserve only candidate equipment rows",
		);
	if (dimming.some((row) => row.dimmed === undefined))
		throw new Error(
			"Inventory armor drag left equipment rows without a dimming decision",
		);
	const hovered = await lastPreview();
	if (hovered.intent.target.kind !== "item")
		throw new Error("Native drag did not use positional item targeting");
	await reply(hovered.sequence, { kind: "move" });
	await release(position);
	if (await read(`document.querySelector('[data-inventory-dimmed]') !== null`))
		throw new Error("Equipment dimming survived pointer release");
	const dropped = await lastPreview();
	if (dropped.sequence === hovered.sequence)
		throw new Error("Drop reused its hover preview");
	await reply(hovered.sequence, { kind: "move" });
	if ((await submissions()).length !== countBefore)
		throw new Error("Stale preview authorized a drop");
	await reply(dropped.sequence, { kind: "move" });
	if ((await submissions()).length !== countBefore + 1)
		throw new Error("Confirmed native drop was not submitted once");
	if ((await read(`${api}.capture().selectedGuid`)) !== 91)
		throw new Error("Drag release changed selection away from its source");

	await read(`document.querySelector('.inventory-sort').click()`);
	const sortedPosition = await begin(source, target);
	if (
		await read(
			`document.querySelector('[data-item-dragging]') === null || !document.querySelector('.item-drag-ghost').checkVisibility()`,
		)
	)
		throw new Error(
			"Sorted inventory contents did not show the equip drag preview",
		);
	if (
		!(await read(`(() => {
		const source = document.querySelector(${JSON.stringify(source)});
		return Array.from(document.querySelectorAll('.inventory-sections .item-grid-cell')).every(cell => (cell.dataset.inventoryDimmed === 'true') === (cell !== source));
	})()`))
	)
		throw new Error(
			"Sorted equip drag did not dim only the other inventory cells",
		);
	const mergeHint = (await commands()).find(
		(entry) =>
			entry.command === "preview_client_inventory" &&
			entry.args.request.sequence > dropped.sequence &&
			entry.args.request.intent.target.kind === "stack" &&
			entry.args.request.intent.target.guid === 94,
	).args.request;
	await reply(mergeHint.sequence, { kind: "merge", amount: 1 });
	if (
		await read(
			`document.querySelector(${JSON.stringify(target)}).dataset.inventoryDimmed === 'true'`,
		)
	)
		throw new Error("Host-approved merge target remained dimmed");
	const sortedHover = await lastPreview();
	if (sortedHover.intent.target.kind !== "stack")
		throw new Error("Sorted drag did not request merge-only targeting");
	await release(sortedPosition);
	await reply((await lastPreview()).sequence, {
		kind: "rejected",
		reason: "These items cannot be merged",
	});
	if ((await submissions()).length !== countBefore + 1)
		throw new Error("Rejected merge submitted a move");
	// Restore native ordering for the remaining contents-source gestures.
	await read(
		`(async () => { const button = document.querySelector('.inventory-sort'); for (let i = 0; i < 10 && !button.getAttribute('aria-label').includes('Native'); i++) { button.click(); await new Promise(resolve => setTimeout(resolve, 0)); } })()`,
	);

	const cancelledPosition = await begin(target, source);
	if (
		!(await read(
			`Array.from(document.querySelectorAll('[data-equipment-slot]')).every(row => row.dataset.inventoryDimmed === 'true')`,
		))
	)
		throw new Error("Non-equippable item drag left equipment slots undimmed");
	const cancelled = await lastPreview();
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await release(cancelledPosition);
	if ((await read(`${api}.capture().selectedGuid`)) !== 94)
		throw new Error("Cancelled drag lost source selection");
	await reply(cancelled.sequence, { kind: "merge", amount: 10 });
	if ((await submissions()).length !== countBefore + 1)
		throw new Error("Cancelled gesture submitted a late preview");
	if (await read(`document.querySelector('[data-item-dragging]') !== null`))
		throw new Error("Cancelled drag retained pointer visuals");
	const header = '.inventory-header[data-item-guid="1"]';
	const headerPosition = await begin(source, header);
	await release(headerPosition);
	const headerDrop = await lastPreview();
	if (
		headerDrop.intent.target.kind !== "container" ||
		headerDrop.intent.target.guid !== 1
	)
		throw new Error("Header drop did not request native append");
	await reply(headerDrop.sequence, { kind: "move" });
	if ((await submissions()).length !== countBefore + 2)
		throw new Error("Header append was not submitted");

	const equipment = '.equipment-row[aria-label="Chest armor"]';
	await read(`document.querySelector('.inventory-sort').click()`);
	const equipmentPosition = await begin(source, equipment);
	const equipmentHover = await lastPreview();
	if (equipmentHover.intent.target.kind !== "equipment")
		throw new Error("Equipment row did not resolve to an equipment target");
	await reply(equipmentHover.sequence, { kind: "equip", displaced: [95] });
	const highlights = await read(
		`document.querySelectorAll('[data-inventory-displaced="true"]').length`,
	);
	if (highlights !== 2)
		throw new Error(
			"Multi-slot displaced armor did not highlight both occupied rows",
		);
	await release(equipmentPosition);
	await reply((await lastPreview()).sequence, {
		kind: "equip",
		displaced: [95],
	});
	if ((await submissions()).length !== countBefore + 3)
		throw new Error("Equipment drop was not submitted");

	const worn =
		'.equipment-row[aria-label="Chest armor"] .item-grid-cell[data-item-guid="95"]';
	const unequipPosition = await begin(worn, target);
	if (
		await read(
			`document.querySelector('.inventory-sections [data-inventory-dimmed="true"]') !== null`,
		)
	)
		throw new Error("Sorted unequip drag dimmed allowed inventory targets");
	await release(unequipPosition);
	const unequip = await lastPreview();
	if (unequip.intent.item !== 95 || unequip.intent.target.kind !== "container")
		throw new Error(
			"Equipped source did not preserve identity for container unequip",
		);
	await reply(unequip.sequence, { kind: "move" });
	if ((await submissions()).length !== countBefore + 4)
		throw new Error("Unequip drop was not submitted");
	if (
		(await read(
			`document.querySelectorAll('.equipment-row [data-item-guid="95"]').length`,
		)) !== 2
	)
		throw new Error(
			"Submission optimistically changed authoritative equipment display",
		);

	// Shift+click preflights capacity before opening a panel-local amount dialog.
	const shiftClick = async (selector = target) => {
		const location = await point(selector);
		for (const type of ["mousePressed", "mouseReleased"])
			await client.send("Input.dispatchMouseEvent", {
				type,
				...location,
				button: "left",
				buttons: type === "mousePressed" ? 1 : 0,
				clickCount: 1,
				modifiers: 8,
			});
		return lastPreview();
	};
	const deniedSplit = await shiftClick();
	if (deniedSplit.intent.target.kind !== "split")
		throw new Error("Shift+click did not preflight splitting");
	await reply(deniedSplit.sequence, {
		kind: "rejected",
		reason: "No open inventory slots",
	});
	if (await read(`document.querySelector('.inventory-split-dialog') !== null`))
		throw new Error("Full inventory opened a split dialog");
	if (
		!(await read(
			`Array.from(document.querySelectorAll('.client-toast')).some(node => node.textContent.includes('No open inventory slots'))`,
		))
	)
		throw new Error("No-space split rejection did not use a toast");
	await read(`document.querySelector(${JSON.stringify(target)}).click()`);
	await read(
		`document.querySelector('button[aria-label="Inventory"]').click()`,
	);
	if (await read(`document.querySelector('.client-inventory') !== null`))
		throw new Error("Inventory shortcut did not close the panel");
	await read(`new Promise((resolve, reject) => {
		const deadline = performance.now() + 1000;
		const poll = () => {
			const button = document.querySelector('button[aria-label="Split stack"]');
			if (button) { button.click(); resolve(); }
			else if (performance.now() >= deadline) reject(new Error('Selected stack did not expose its split action'));
			else requestAnimationFrame(poll);
		};
		poll();
	})`);
	if (!(await read(`document.querySelector('.client-inventory') !== null`)))
		throw new Error("Selected stack split action did not open inventory");
	const allowedSplit = await lastPreview();
	await reply(allowedSplit.sequence, { kind: "split", max_amount: 20 });
	if (
		!(await read(
			`document.querySelector('.inventory-layout').inert && document.querySelector('.inventory-split-dialog input') === document.activeElement`,
		))
	)
		throw new Error("Split dialog did not focus the amount or block inventory");
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9,
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9,
	});
	if (
		!(await read(
			`document.activeElement === document.querySelector('.inventory-split-dialog input[type="range"]')`,
		))
	)
		throw new Error("Split controls are not reachable by Tab");
	await read(`(() => {
		const slider = document.querySelector('.inventory-split-dialog input[type="range"]');
		if (!document.querySelector('.inventory-split-maximum').textContent.includes(slider.max)) throw new Error('Maximum split quantity is not visible');
		slider.value = '4'; slider.dispatchEvent(new Event('input', { bubbles: true }));
	})()`);
	await read(`(() => {
		const input = document.querySelector('.inventory-split-dialog input[type="number"]');
		if (input.value !== '4') throw new Error('Slider did not update the numeric amount');
		input.value = '7'; input.dispatchEvent(new Event('input', { bubbles: true }));
	})()`);
	await read(`(() => {
		if (document.querySelector('.inventory-split-dialog input[type="range"]').value !== '7') throw new Error('Numeric amount did not update the slider');
		document.querySelector('.inventory-split-dialog form').requestSubmit();
	})()`);
	const splitSubmit = (await submissions()).at(-1).args.intent;
	if (
		splitSubmit.item !== 94 ||
		splitSubmit.target.kind !== "split" ||
		splitSubmit.target.amount !== 7
	)
		throw new Error(
			`Split amount was not submitted: ${JSON.stringify(splitSubmit)}`,
		);
	if (
		await read(
			`document.querySelector('.inventory-split-dialog') !== null || document.querySelector('.inventory-layout').inert`,
		)
	)
		throw new Error("Split submission retained the modal");
	const cancelSplit = await shiftClick();
	await reply(cancelSplit.sequence, { kind: "split", max_amount: 20 });
	const beforeCancel = (await submissions()).length;
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	if (
		(await submissions()).length !== beforeCancel ||
		(await read(`document.querySelector('.inventory-split-dialog') !== null`))
	)
		throw new Error("Split cancellation submitted or retained the dialog");

	const checkingSelection = await shiftClick();
	await read(`${api}.selectInventoryItem(91)`);
	await reply(checkingSelection.sequence, { kind: "split", max_amount: 20 });
	if (await read(`document.querySelector('.inventory-split-dialog') !== null`))
		throw new Error("Selection change admitted a late split preview");
	await read(`${api}.selectInventoryItem(94)`);
	const editingSelection = await shiftClick();
	await reply(editingSelection.sequence, { kind: "split", max_amount: 20 });
	await read(`${api}.selectInventoryItem(91)`);
	if (
		await read(
			`document.querySelector('.inventory-split-dialog') !== null || document.querySelector('.inventory-layout').inert`,
		)
	)
		throw new Error("Selection change did not cancel the split modal");
	await read(`${api}.selectInventoryItem(94)`);
	const panelClose = await shiftClick();
	await reply(panelClose.sequence, { kind: "split", max_amount: 20 });
	await read(
		`document.querySelector('button[aria-label="Close Inventory"]').click()`,
	);
	if (
		await read(
			`document.querySelector('.inventory-split-dialog') !== null || document.querySelector('.client-inventory') !== null`,
		)
	)
		throw new Error("Closing inventory retained the split flow");
	if ((await submissions()).length !== beforeCancel)
		throw new Error(
			"Cancelling split through selection or panel closure submitted it",
		);
	await read(
		`document.querySelector('button[aria-label="Inventory"]').click()`,
	);

	await read(`${api}.deferNextInventorySubmission()`);
	const latePosition = await begin(source, equipment);
	await release(latePosition);
	await reply((await lastPreview()).sequence, { kind: "equip", displaced: [] });
	const nextPosition = await begin(source, target);
	await read(`${api}.rejectDeferredInventorySubmission()`);
	if (!(await read(`document.querySelector('[data-item-dragging]') !== null`)))
		throw new Error("Late submission failure cancelled a newer drag");
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await release(nextPosition);

	// Real pointer releases must distinguish the canvas from UI layered above it.
	const viewport = "[data-game-viewport]";
	for (const sourceSelector of [
		source,
		worn,
		'.inventory-pack-strip .item-grid-cell[data-item-guid="96"]',
	]) {
		const before = (await submissions()).length;
		const to = await begin(sourceSelector, viewport);
		await release(to);
		const preview = await lastPreview();
		if (preview.intent.target.kind !== "ground")
			throw new Error("Viewport release did not target ground");
		await reply(preview.sequence, { kind: "drop" });
		const submitted = await submissions();
		if (
			submitted.length !== before + 1 ||
			submitted.at(-1).args.intent.target.kind !== "ground"
		)
			throw new Error(
				"Ground drop was not submitted exactly once under sorted inventory",
			);
		if (
			!(await read(
				`document.querySelector(${JSON.stringify(sourceSelector)}) !== null`,
			))
		)
			throw new Error("Ground drop optimistically removed its source");
		if ((await read(`${api}.capture().selectedGuid`)) !== preview.intent.item)
			throw new Error("Ground drop changed selection away from its source");
	}
	const beforeOverlay = (await submissions()).length;
	const overlay = await begin(source, ".inventory-sort");
	await release(overlay);
	if ((await submissions()).length !== beforeOverlay)
		throw new Error("Overlay release dropped an item");
	await begin(source, viewport);
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: -10,
		y: -10,
		button: "left",
		buttons: 1,
	});
	await release({ x: -10, y: -10 });
	if ((await submissions()).length !== beforeOverlay)
		throw new Error("Outside release dropped an item");

	await read(`${api}.giveProbe.begin()`);
	await read(`${api}.giveProbe.setTarget({kind: "entity", guid: 7})`);
	const giveBefore = (await submissions()).length;
	const givePoint = await begin(source, viewport);
	await release(givePoint);
	const givePreview = await lastPreview();
	if (
		givePreview.intent.target.kind !== "give" ||
		givePreview.intent.target.guid !== 7
	)
		throw new Error("Entity release did not resolve give");
	await reply(givePreview.sequence, { kind: "give" });
	if ((await submissions()).length !== giveBefore + 1)
		throw new Error("Give release did not submit once");
	const binding = await read(`${api}.giveProbe.binding`);
	const giveKey = {
		key: binding.key ?? "Unidentified",
		code: binding.code ?? "",
		modifiers:
			(binding.alt ? 1 : 0) |
			(binding.ctrl ? 2 : 0) |
			(binding.meta ? 4 : 0) |
			(binding.shift ? 8 : 0),
	};
	await client.send("Input.dispatchKeyEvent", { type: "keyDown", ...giveKey });
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		...giveKey,
		autoRepeat: true,
	});
	await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...giveKey });
	const given = await submissions();
	if (
		given.length !== giveBefore + 2 ||
		given.at(-1).args.intent.target.guid !== 7 ||
		given.at(-1).args.intent.item !== 91
	)
		throw new Error(
			"Configured give key did not use selection history exactly once",
		);
	for (const result of [
		{ kind: "entity", guid: 94 },
		{ kind: "unavailable", reason: "Injected unavailable picking" },
	]) {
		await read(`${api}.giveProbe.setTarget(${JSON.stringify(result)})`);
		const p = await begin(source, viewport);
		await release(p);
		if ((await submissions()).length !== giveBefore + 2)
			throw new Error("Failed give became an inventory action");
		if (await read('document.querySelector("[data-item-dragging]") !== null'))
			throw new Error("Unavailable destination left a gesture pending");
	}
	await read(`${api}.giveProbe.setTarget(null)`);
	const delayed = await begin(source, viewport);
	await release(delayed);
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
	});
	await read(`${api}.giveProbe.reply({kind: "entity", guid: 7})`);
	if ((await submissions()).length !== giveBefore + 2)
		throw new Error("Cancelled world pick submitted give");
	const removedPoint = await begin(source, viewport);
	await release(removedPoint);
	const removedSource = await read(`${api}.giveProbe.removeSource(91)`);
	await read(`${api}.giveProbe.reply({kind: "entity", guid: 7})`);
	if ((await submissions()).length !== giveBefore + 2)
		throw new Error("Removed source submitted a late give");
	if (await read('document.querySelector("[data-item-dragging]") !== null'))
		throw new Error("Source removal left a world pick active");
	await read(
		`${api}.giveProbe.restoreSource(${JSON.stringify(removedSource)})`,
	);
	await read(`${api}.giveProbe.end()`);

	return {
		nativeSubmission: true,
		worldGive: true,
		configuredGiveHotkey: true,
		giveFailureNeverDrops: true,
		groundDrop: true,
		equippedGroundDrop: true,
		bagGroundDrop: true,
		overlayAndOutsideDropExcluded: true,
		splitDialog: true,
		lateSubmissionPreservesNewDrag: true,
		headerAppend: true,
		equipmentSubmission: true,
		multiSlotHighlight: true,
		unequipSubmission: true,
		authoritativeDisplay: true,
		stalePreviewRejected: true,
		sortedContentsMoveBlocked: true,
		mergeCandidateDimming: true,
		sortedEquipAllowed: true,
		sortedUnequipAppend: true,
		escapeCancellation: true,
		clickSuppressed: true,
	};
}
