/** Real browser context gestures exercise the production popup, command, and toast path. */
export async function probeInventoryAutoMerge(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const read = (expression) => evaluateExpression(client, expression);
	const menu = '[role="menu"][aria-label="Bag actions"]';
	const strip = ".client-inventory .contents-packs";
	const cell = (guid) => `${strip} .item-grid-cell[data-item-guid="${guid}"]`;
	const header = (guid) =>
		`.client-inventory .contents-scroll .contents-header[data-item-guid="${guid}"]`;
	const commands = () =>
		read(
			`${api}.inventoryDragCommands().filter(entry => entry.command === 'auto_merge_client_container')`,
		);
	const waitFor = async (expression, description) => {
		for (let attempt = 0; attempt < 80; attempt++) {
			if (await read(expression)) return;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error(`Auto-merge probe timed out: ${description}`);
	};
	const point = (selector) =>
		read(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing auto-merge target');
        element.scrollIntoView({block: 'nearest', inline: 'nearest'});
        const rect = element.getBoundingClientRect();
        return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    })()`);
	const click = async (selector, button = "left") => {
		const location = await point(selector);
		for (const type of ["mousePressed", "mouseReleased"]) {
			await client.send("Input.dispatchMouseEvent", {
				type,
				...location,
				button,
				buttons: type === "mousePressed" ? (button === "right" ? 2 : 1) : 0,
				clickCount: 1,
			});
		}
	};
	const visible = () =>
		read(`document.querySelector(${JSON.stringify(menu)}) !== null`);
	await read(`${api}.autoMergeProbe.begin()`);
	await waitFor(
		`document.querySelector(${JSON.stringify(cell(1001))}) !== null`,
		"bag strip",
	);
	const selected = await read(`${api}.capture().selectedGuid`);
	const initial = (await commands()).length;
	const toastBefore = await read(`${api}.autoMergeProbe.toast()`);
	for (const [index, [selector, guid]] of [
		[cell(1), 1],
		[cell(1001), 1001],
		[header(1), 1],
		[header(1001), 1001],
	].entries()) {
		await click(selector, "right");
		await waitFor(
			`document.querySelector(${JSON.stringify(menu)}) !== null`,
			"context menu",
		);
		if ((await read(`${api}.capture().selectedGuid`)) !== selected)
			throw new Error("Right-click changed inventory selection");
		await click(`${menu} [role="menuitem"]`);
		await waitFor(
			`${api}.inventoryDragCommands().filter(entry => entry.command === 'auto_merge_client_container').length === ${initial + index + 1}`,
			"single container submission",
		);
		const submission = (await commands()).at(-1);
		const timing = await read(`${api}.autoMergeProbe.timing`);
		if (
			JSON.stringify(submission.args) !==
			JSON.stringify({ container: guid, policy: timing })
		)
			throw new Error(
				"Auto-merge did not forward the selected container and tuning snapshot",
			);
		if (await visible())
			throw new Error("Auto-merge command did not dismiss its popup");
	}
	if (
		JSON.stringify(await read(`${api}.autoMergeProbe.toast()`)) !==
		JSON.stringify(toastBefore)
	)
		throw new Error("Enqueue response published a false completion toast");
	const selectedHud = ".selected-entity";
	const hudAction = `${selectedHud} button[aria-label="Auto-merge"]`;
	const hudTrigger = `${selectedHud} button[aria-label="Selected entity actions"]`;
	const hudMenu = '[role="menu"][aria-label="Selected entity actions"]';
	const hudRows = `Array.from(document.querySelectorAll(${JSON.stringify(`${hudMenu} [role="menuitem"]`)}))`;
	const hudMergeExists = `${hudRows}.some(row => row.textContent.trim() === 'Auto-merge')`;

	const sampleInterval = await read(
		"import('/src/client/client-tuning.ts').then(({CLIENT_TUNING}) => CLIENT_TUNING.selectedEntityHud.displayIntervalMs)",
	);
	for (const [index, guid] of [1, 1001].entries()) {
		if ((await read(`${api}.capture().selectedGuid`)) !== guid)
			await click(header(guid));
		await waitFor(
			`${api}.capture().selectedGuid === ${guid}`,
			"selected container",
		);
		await new Promise((resolve) => setTimeout(resolve, sampleInterval));
		if (
			await read(
				`document.querySelector(${JSON.stringify(hudAction)}) !== null`,
			)
		) {
			await click(hudAction);
		} else {
			await click(hudTrigger);
			await waitFor(hudMergeExists, "selected HUD auto-merge action");
			const rowId = await read(`(() => {
                const row = ${hudRows}.find(row => row.textContent.trim() === 'Auto-merge');
                if (!row) throw new Error('Missing selected auto-merge menu action');
                return row.id;
            })()`);
			await click(`${hudMenu} [id=${JSON.stringify(rowId)}]`);
		}
		await waitFor(
			`${api}.inventoryDragCommands().filter(entry => entry.command === 'auto_merge_client_container').length === ${initial + 5 + index}`,
			"selected HUD container submission",
		);
		const submission = (await commands()).at(-1);
		if (submission.args.container !== guid)
			throw new Error("Selected HUD auto-merge used the wrong container");
	}
	await click(cell(1002));
	await new Promise((resolve) => setTimeout(resolve, sampleInterval));
	if (
		await read(`document.querySelector(${JSON.stringify(hudAction)}) !== null`)
	)
		throw new Error("Selected focus offered a direct auto-merge action");
	if (
		await read(`document.querySelector(${JSON.stringify(hudTrigger)}) !== null`)
	) {
		await click(hudTrigger);
		if (await read(hudMergeExists))
			throw new Error("Selected focus offered auto-merge in its action menu");
		await click(".inventory-burden");
	}

	await click(cell(1002), "right");
	if (await visible()) throw new Error("Focus offered auto-merge");
	await click(`${strip} .item-grid-cell[data-empty="true"]`, "right");
	if (await visible()) throw new Error("Empty slot offered auto-merge");
	await click(cell(1), "right");
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
	await waitFor(
		`document.querySelector(${JSON.stringify(menu)}) === null`,
		"Escape dismissal",
	);
	await click(cell(1), "right");
	await click(".inventory-burden");
	await waitFor(
		`document.querySelector(${JSON.stringify(menu)}) === null`,
		"outside dismissal",
	);
	await click(cell(1), "right");
	await read(`${api}.autoMergeProbe.resync()`);
	await waitFor(
		`document.querySelector(${JSON.stringify(menu)}) === null`,
		"resync dismissal",
	);
	await click(cell(1), "right");
	if (await visible())
		throw new Error("Recovery picture offered an active auto-merge command");
	await read(`${api}.autoMergeProbe.begin()`);
	await waitFor(
		`document.querySelector(${JSON.stringify(cell(1001))})?.disabled === false`,
		"replacement baseline",
	);
	await click(cell(1), "right");
	await click('button[aria-label="Close Inventory"]');
	await waitFor(
		`document.querySelector(${JSON.stringify(menu)}) === null`,
		"panel closure dismissal",
	);
	for (const feedback of [
		{ message: "Auto-merge complete: 2 slots freed", tone: "status" },
		{
			message:
				"Auto-merge stopped: Timed out waiting for the server; the last request may still complete. 1 slots freed",
			tone: "warning",
		},
	]) {
		await read(`${api}.autoMergeProbe.feedback(${JSON.stringify(feedback)})`);
		const toast = await read(`${api}.autoMergeProbe.toast()`);
		if (toast?.message !== feedback.message || toast.tone !== feedback.tone)
			throw new Error(
				"Auto-merge feedback did not reach the session toast owner after panel closure",
			);
	}
	if ((await commands()).length !== initial + 6)
		throw new Error(
			"Dismissal/suppression submitted another container command",
		);
	return {
		mainPack: true,
		containerHeaders: true,
		selectedHudMainPack: true,
		selectedHudBag: true,
		selectedHudFociExcluded: true,
		realBag: true,
		fociExcluded: true,
		emptySlotsExcluded: true,
		selectionPreserved: true,
		tuningForwarded: true,
		oneCommandPerGesture: true,
		escapeDismissal: true,
		outsideDismissal: true,
		recoveryDismissal: true,
		closeDismissal: true,
		sessionToasts: true,
	};
}
