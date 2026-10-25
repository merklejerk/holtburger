/** Production HUD/session, real pointer drops, and controlled typed authority replies. */
export async function probeSalvage(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const fixture = `${api}.salvageProbe`;
	const read = (expression) => evaluateExpression(client, expression);
	const wait = async (expression) => {
		const deadline = Date.now() + 5000;
		while (!(await read(expression))) {
			if (Date.now() > deadline)
				throw new Error(`Salvage UI did not settle: ${expression}`);
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
	};
	const assert = async (expression, message) => {
		if (!(await read(expression))) throw new Error(message);
	};
	const count = (command) =>
		`${api}.inventoryDragCommands().filter(entry => entry.command === '${command}').length`;
	const appraisalCount = (guid) =>
		`${api}.inventoryDragCommands().filter(entry => entry.command === 'examine_client_entity' && entry.args?.guid === ${guid}).length`;
	const rightClick = async (selector) => {
		const position = await point(selector);
		for (const type of ["mousePressed", "mouseReleased"])
			await client.send("Input.dispatchMouseEvent", {
				type,
				...position,
				button: "right",
				buttons: type === "mousePressed" ? 2 : 0,
				clickCount: 1,
			});
	};
	const settleEstimate = async () => {
		const deadline = Date.now() + 5000;
		let answered = null;
		while (Date.now() < deadline) {
			const sequence = await read(`${fixture}.preview().sequence`);
			if (sequence !== answered) {
				await read(`${fixture}.reply()`);
				answered = sequence;
			}
			if (
				await read(
					`document.querySelector('.salvage-footer button:last-child')?.disabled === false`,
				)
			)
				return;
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
		throw new Error(
			"Automatic salvage appraisal did not produce a complete estimate",
		);
	};
	const click = (selector) =>
		read(`document.querySelector(${JSON.stringify(selector)}).click()`);
	const point = (selector) =>
		read(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing salvage element: ' + ${JSON.stringify(selector)});
        element.scrollIntoView({ block: 'nearest' });
        const rect = element.getBoundingClientRect();
        const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        if (!element.contains(document.elementFromPoint(point.x, point.y))) throw new Error('Salvage element is covered: ' + ${JSON.stringify(selector)});
        return point;
    })()`);
	const drag = async (source, target, cancel = false) => {
		const from = await point(source);
		const to = await point(target);
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...from,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...to,
			button: "left",
			buttons: 1,
		});
		if (cancel) {
			for (const type of ["keyDown", "keyUp"])
				await client.send("Input.dispatchKeyEvent", {
					type,
					key: "Escape",
					code: "Escape",
				});
		}
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...to,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
	};
	const owned = (guid) =>
		`.client-inventory [data-item-guid="${guid}"].item-grid-cell`;
	await wait(`${fixture}.ready()`);
	await read(`${fixture}.begin()`);
	await wait(`document.querySelector(${JSON.stringify(owned(9200))}) !== null`);
	const initialUse = await read(count("submit_client_item_use"));
	const initialPreview = await read(count("preview_client_salvage"));
	// Candidate action appears in the existing selected-HUD action menu, independent of tool lookup.
	await click('button[aria-label="Selected entity actions"]');
	await wait(
		`Array.from(document.querySelectorAll('[role="menuitem"]')).some(item => item.textContent.trim() === 'Salvage')`,
	);
	await read(
		`Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent.trim() === 'Salvage').click()`,
	);
	await wait(`${count("preview_client_salvage")} > ${initialPreview}`);
	await read(
		`${fixture}.reply({ kind: 'rejected', reason: 'You do not have an Ust in your inventory.' })`,
	);
	await assert(
		`document.querySelector('[data-salvage-panel]') === null`,
		"Missing-tool refusal opened a salvage draft",
	);
	// Ordinary Ust double-click opens locally; there is no generic Use/target packet.
	const toolPoint = await point(owned(9200));
	for (const clickCount of [1, 2]) {
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...toolPoint,
			button: "left",
			buttons: 1,
			clickCount,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...toolPoint,
			button: "left",
			buttons: 0,
			clickCount,
		});
	}
	await wait(`${count("preview_client_salvage")} > ${initialPreview + 1}`);
	await read(`${fixture}.reply()`);
	await wait(`document.querySelector('[data-salvage-queue]') !== null`);
	await assert(
		`${count("submit_client_item_use")} === ${initialUse}`,
		"Ust activation sent generic item Use",
	);
	// Real inventory pointer drag adds an item to the draft, never an inventory-transfer request.
	const beforeDrop = await read(count("preview_client_salvage"));
	const from = await point(owned(9201));
	const to = await point("[data-salvage-queue]");
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		...from,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...to,
		button: "left",
		buttons: 1,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		...to,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	await wait(`${count("preview_client_salvage")} > ${beforeDrop}`);
	await read(`${fixture}.reply()`);
	await wait(`document.querySelector('[data-salvage-item="9201"]') !== null`);
	await assert(
		`(() => {
        const cell = document.querySelector('[data-salvage-item="9201"]');
        const rect = cell.getBoundingClientRect();
        const style = getComputedStyle(cell);
        const expected = parseFloat(style.getPropertyValue('--ui-item-cell-min-size')) * parseFloat(style.getPropertyValue('--ui-icon-scale'));
        return Math.abs(rect.width - expected) < 1 && Math.abs(rect.height - rect.width) < 1;
    })()`,
		"Queued salvage cell does not use the shared square item dimensions",
	);

	await wait(
		`document.querySelector('.salvage-footer button:last-child')?.disabled === false`,
	);
	const beforeDuplicate = await read(count("preview_client_salvage"));
	await drag(owned(9201), "[data-salvage-queue]");
	await assert(
		`${count("preview_client_salvage")} === ${beforeDuplicate}`,
		"Duplicate queue drop requested another preview",
	);
	await assert(
		`document.querySelectorAll('[data-salvage-item="9201"]').length === 1`,
		"Duplicate drop changed queue membership",
	);
	await assert(
		`!Array.from(document.querySelectorAll('.client-toast')).some(toast => toast.textContent.includes('cannot join the salvage queue'))`,
		"Duplicate queue drop reported the item as ineligible",
	);
	// Add a second material through the same selected-entity action and review both outputs.
	const beforeMixed = await read(count("preview_client_salvage"));
	await read(`${fixture}.select(9203)`);
	// The selection effect closes an old menu; wait for the new identity before opening it.
	await wait(
		`document.querySelector('.selected-entity')?.getAttribute('aria-label')?.startsWith('Selected entity: Oak bow')`,
	);
	await click('button[aria-label="Selected entity actions"]');
	await wait(
		`Array.from(document.querySelectorAll('[role="menuitem"]')).some(item => item.textContent.trim() === 'Salvage')`,
	);
	await read(
		`Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent.trim() === 'Salvage').click()`,
	);
	await wait(`${count("preview_client_salvage")} > ${beforeMixed}`);
	await assert(
		`JSON.stringify(${fixture}.preview().items) === JSON.stringify([9201, 9203])`,
		"Mixed-material addition dropped a source",
	);
	await read(`${fixture}.reply()`);
	await wait(
		`document.querySelectorAll('.salvage-output tbody tr').length === 2`,
	);
	await assert(
		`Array.from(document.querySelectorAll('.salvage-output tbody tr td:first-child')).map(cell => cell.textContent).join(',') === 'Steel,Oak'`,
		"Mixed output does not identify both materials",
	);
	await wait(
		`document.querySelector('.salvage-footer button:last-child')?.disabled === false`,
	);
	await click(".salvage-footer button:last-child");
	await wait(
		`Array.from(document.querySelectorAll('dialog button')).some(button => button.textContent.trim() === 'Salvage')`,
	);
	await assert(
		`document.querySelector('dialog[open]').textContent.includes('Entire stacks are included.')`,
		"Salvage confirmation omitted whole-stack destruction guidance",
	);
	await assert(
		`document.querySelector('dialog[open]').textContent.includes('Suppress confirmation for the next hour')`,
		"Salvage confirmation omitted one-hour suppression",
	);
	await click('dialog[open] input[type="checkbox"]');
	await read(
		`Array.from(document.querySelectorAll('dialog button')).find(button => button.textContent.trim() === 'Salvage').click()`,
	);
	await wait(`${count("submit_client_salvage")} > 0`);
	await assert(
		`${fixture}.submitted().review.sources.map(source => source.input.materialType).join(',') === 'Steel,Oak'`,
		"Mixed submission did not preserve both reviewed materials",
	);
	await assert(
		`document.querySelector('[data-salvage-item="9201"]') !== null`,
		"Enqueue acceptance cleared the draft before dispatch",
	);
	await read(`${fixture}.finish('rejected')`);
	await wait(
		`document.querySelector('.salvage-footer button:last-child')?.disabled === false`,
	);
	await assert(
		`document.querySelector('[data-salvage-item="9201"]') !== null`,
		"Local rejection lost the draft",
	);
	await click(".salvage-footer button:last-child");
	await wait(`${count("submit_client_salvage")} === 2`);
	await wait(`document.querySelector('dialog[open]') === null`);
	await read(`${fixture}.finish('dispatched')`);
	await wait(`document.querySelector('[data-salvage-item="9201"]') === null`);
	await read(`${fixture}.reply()`);
	const beforeBound = await read(count("preview_client_salvage"));
	await read(`${fixture}.activateBound()`);
	await wait(`${count("preview_client_salvage")} > ${beforeBound}`);
	await read(`${fixture}.reply()`);
	await assert(
		`${count("submit_client_item_use")} === ${initialUse}`,
		"Bound Ust activation bypassed the local salvage flow",
	);
	// Keep an unrelated inspector open while the salvage queue fetches its own data.
	const beforeInspect = await read(appraisalCount(9201));
	await rightClick(owned(9201));
	await wait(`${appraisalCount(9201)} > ${beforeInspect}`);
	await read(`${fixture}.appraise(9201, 'ready')`);
	await wait(
		`document.querySelector('.inspection-name')?.textContent === 'Steel sword'`,
	);
	const beforeAutomatic = await read(appraisalCount(9202));
	const beforePending = await read(count("preview_client_salvage"));
	await read(`${fixture}.pending(9202); ${fixture}.select(9202)`);
	await wait(
		`document.querySelector('.selected-entity')?.getAttribute('aria-label')?.startsWith('Selected entity: Steel armor')`,
	);
	await wait(
		`document.querySelector('button[aria-label="Selected entity actions"]') !== null`,
	);
	await click('button[aria-label="Selected entity actions"]');
	await wait(
		`Array.from(document.querySelectorAll('[role="menuitem"]')).some(item => item.textContent.trim() === 'Salvage')`,
	);
	await read(
		`Array.from(document.querySelectorAll('[role="menuitem"]')).find(item => item.textContent.trim() === 'Salvage').click()`,
	);
	await wait(`${count("preview_client_salvage")} > ${beforePending}`);
	await read(
		`${fixture}.reply({ kind: 'pending-details', tool: { guid: 9200, instance: 1 }, items: [9202] })`,
	);
	await wait(
		`document.querySelector('[data-salvage-item="9202"]')?.dataset.salvagePendingDetails === 'true'`,
	);
	await assert(
		`document.querySelector('.salvage-footer button:last-child').disabled`,
		"Unappraised source could be submitted",
	);
	await wait(`${appraisalCount(9202)} > ${beforeAutomatic}`);
	await assert(
		`document.querySelector('.salvage-output').textContent.includes('Calculating')`,
		"Pending sources do not show automatic calculation status",
	);
	await read(`${fixture}.appraise(9202, 'rejected')`);
	await wait(
		`document.querySelector('button[aria-label="Retry salvage appraisal"]') !== null`,
	);
	await assert(
		`document.querySelector('[data-salvage-item="9202"]') !== null && document.querySelector('.salvage-footer button:last-child').disabled`,
		"Failed automatic appraisal lost the item or enabled destruction",
	);
	await assert(
		`document.querySelector('.inspection-name')?.textContent === 'Steel sword'`,
		"Background appraisal failure changed the open inspector",
	);
	await click('button[aria-label="Retry salvage appraisal"]');
	await wait(`${appraisalCount(9202)} > ${beforeAutomatic + 1}`);
	await read(`${fixture}.appraise(9202, 'ready')`);
	await settleEstimate();
	await assert(
		`document.querySelector('.inspection-name')?.textContent === 'Steel sword'`,
		"Background appraisal success changed the open inspector",
	);
	await click('button[aria-label="Close Steel sword"]');
	const beforeOptionalInspect = await read(appraisalCount(9202));
	await rightClick('[data-salvage-item="9202"]');
	await wait(`${appraisalCount(9202)} > ${beforeOptionalInspect}`);
	await read(`${fixture}.appraise(9202, 'ready')`);
	await wait(
		`document.querySelector('.inspection-name')?.textContent === 'Steel armor'`,
	);
	await click('button[aria-label="Close Steel armor"]');
	const beforeLocalRemoval = await read(count("preview_client_salvage"));
	const physicalCommands = `${api}.inventoryDragCommands().filter(entry => ['preview_client_inventory', 'submit_client_inventory', 'submit_client_item_use'].includes(entry.command)).length`;
	const beforePhysicalCommands = await read(physicalCommands);
	await drag('[data-salvage-item="9202"]', "[data-salvage-queue]");
	await assert(
		`${count("preview_client_salvage")} === ${beforeLocalRemoval}`,
		"Dragging within the queue removed an item",
	);
	await drag('[data-salvage-item="9202"]', owned(9201), true);
	await assert(
		`${count("preview_client_salvage")} === ${beforeLocalRemoval}`,
		"Escape failed to cancel queue removal",
	);
	await assert(
		`document.querySelector('[data-salvage-item="9202"]') !== null`,
		"Cancelled drag lost the queued item",
	);
	await drag('[data-salvage-item="9202"]', owned(9201));
	await wait(`${count("preview_client_salvage")} > ${beforeLocalRemoval}`);
	await assert(
		`${fixture}.preview().items.length === 0`,
		"Dragging out did not unqueue the captured item",
	);
	await read(`${fixture}.reply()`);
	await wait(`document.querySelector('[data-salvage-item="9202"]') === null`);
	await assert(
		`${physicalCommands} === ${beforePhysicalCommands}`,
		"Queue removal dispatched a physical item action",
	);
	// The physical source is still available; requeue it and exercise the alternative remove button.
	const beforeRequeue = await read(count("preview_client_salvage"));
	await drag(owned(9202), "[data-salvage-queue]");
	await wait(`${count("preview_client_salvage")} > ${beforeRequeue}`);
	await read(`${fixture}.reply()`);
	await wait(`document.querySelector('[data-salvage-item="9202"]') !== null`);
	const pendingPoint = await point('[data-salvage-item="9202"]');
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...pendingPoint,
	});
	const removePoint = await point(
		'button[aria-label="Remove Steel armor from salvage queue"]',
	);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await client.send("Input.dispatchMouseEvent", {
			type,
			...removePoint,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
		});
	}
	await wait(`${fixture}.preview().items.length === 0`);
	await read(`${fixture}.reply()`);
	await wait(`document.querySelector('[data-salvage-item="9202"]') === null`);
	await click('button[aria-label="Close Salvaging"]');
	await wait(`document.querySelector('[data-salvage-panel]') === null`);

	return {
		missingTool: true,
		hudEntry: true,
		localUstUse: true,
		pointerDrop: true,
		duplicateDropNoop: true,
		squareQueueCells: true,
		mixedMaterialReviewAndSubmit: true,
		confirmation: true,
		confirmationSuppression: true,
		rejectionRetainsDraft: true,
		dispatchClearsDraft: true,
		boundUstUse: true,
		pendingAppraisal: true,
		automaticAppraisal: true,
		appraisalRetry: true,
		backgroundInspectorIsolation: true,
		inspection: true,
		removal: true,
		dragOutRemoval: true,
		dragInsideRetains: true,
		dragCancelRetains: true,
		noInventoryTransfer: true,
		closure: true,
	};
}
