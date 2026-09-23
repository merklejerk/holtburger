/** Real pointer gestures, production HUD, and typed synthetic core replies. */
export async function probeVendor(client, evaluateExpression, capture) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const fixture = `${api}.vendorProbe`;
	const read = (expression) => evaluateExpression(client, expression);
	const wait = async (expression) => {
		const deadline = Date.now() + 5000;
		while (!(await read(expression))) {
			if (Date.now() > deadline)
				throw new Error(`Vendor UI did not settle: ${expression}`);
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
	};
	const point = (selector) =>
		read(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing vendor probe element: ' + ${JSON.stringify(selector)});
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const rect = element.getBoundingClientRect();
        const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        if (!element.contains(document.elementFromPoint(point.x, point.y))) throw new Error('Covered vendor probe element: ' + ${JSON.stringify(selector)});
        return point;
    })()`);
	const drag = async (source, target) => {
		const from = await point(source);
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...from,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		const to = await point(target);
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
	};
	const click = (selector) =>
		read(`document.querySelector(${JSON.stringify(selector)}).click()`);
	const offer = '[data-vendor-offer="7001"]';
	const queue = '[data-vendor-queue="5000"]';
	const owned = (id) =>
		`.client-inventory .contents-scroll [data-item-guid="${id}"]`;
	const countInventoryRequests = () =>
		read(
			`${api}.inventoryDragCommands().filter((entry) => entry.command === 'preview_client_inventory' || entry.command === 'submit_client_inventory').length`,
		);
	const currencies = await read(`${fixture}.currencies`);
	const quote = async (buys, sells) => {
		await read(
			`${fixture}.reply(${JSON.stringify({ buys, sells, currencies, affordable: true })})`,
		);
		await read(`${fixture}.settle()`);
		await wait(
			`document.querySelector(${JSON.stringify(offer)})?.disabled === false`,
		);
	};
	await read(`${fixture}.begin()`);
	await wait("document.querySelector('[data-vendor-panel]') !== null");
	await quote([], []);
	const inspectPoint = await point(offer);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await client.send("Input.dispatchMouseEvent", {
			type,
			...inspectPoint,
			button: "right",
			buttons: type === "mousePressed" ? 2 : 0,
			clickCount: 1,
		});
	}
	const examination = await read(
		`${api}.inventoryDragCommands().findLast((entry) => entry.command === 'examine_client_entity')`,
	);
	if (examination?.args?.guid !== 7001)
		throw new Error("Offer inspection did not request its non-entity GUID");
	await read(`${api}.objectInspectionProbe().respond('item', 7001)`);
	await wait(
		`${api}.objectInspectionProbe().snapshot().state.kind === 'ready'`,
	);
	await read(`${api}.objectInspectionProbe().end()`);
	const offerInspectionsBefore = await read(
		`${api}.inventoryDragCommands().filter((entry) => entry.command === 'examine_client_entity').length`,
	);
	await read(`document.querySelector(${JSON.stringify(offer)}).focus()`);
	for (const type of ["keyDown", "keyUp"])
		await client.send("Input.dispatchKeyEvent", {
			type,
			key: "e",
			code: "KeyE",
			windowsVirtualKeyCode: 69,
		});
	const offerInspection = await read(
		`${api}.inventoryDragCommands().findLast((entry) => entry.command === 'examine_client_entity')`,
	);
	if (
		(await read(
			`${api}.inventoryDragCommands().filter((entry) => entry.command === 'examine_client_entity').length`,
		)) !==
			offerInspectionsBefore + 1 ||
		offerInspection?.args?.guid !== 7001
	)
		throw new Error(
			"Examine shortcut did not inspect the focused vendor offer",
		);
	await read(`${api}.objectInspectionProbe().respond('item', 7001)`);
	await read(`${api}.objectInspectionProbe().end()`);
	for (const type of ["keyDown", "keyUp"])
		await client.send("Input.dispatchKeyEvent", {
			type,
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			modifiers: 8,
		});
	if (
		(await read(
			`${api}.inventoryDragCommands().filter((entry) => entry.command === 'examine_client_entity').length`,
		)) !==
			offerInspectionsBefore + 1 ||
		(await read("document.querySelector('.vendor-quantity-dialog') !== null"))
	)
		throw new Error("Shift+Enter still activated a vendor offer");

	if (!(await read("document.querySelector('.client-inventory') !== null")))
		await click('button[aria-label="Inventory"]');
	await wait(`document.querySelector(${JSON.stringify(owned(6001))}) !== null`);
	const requestsBefore = await countInventoryRequests();
	const inventorySubmissions = () =>
		read(
			`${api}.inventoryDragCommands().filter((entry) => entry.command === 'submit_client_inventory').length`,
		);
	const submissionsBefore = await inventorySubmissions();
	const selectionBefore = await read(`${api}.capture().selectedGuid`);
	await drag(offer, owned(6001));
	if ((await countInventoryRequests()) !== requestsBefore)
		throw new Error("Vendor offer entered inventory movement preview");
	if ((await read(`${api}.capture().selectedGuid`)) !== selectionBefore)
		throw new Error("Vendor offer was selected as a world entity");
	await drag(offer, queue);
	await wait("document.querySelector('.vendor-quantity-dialog') !== null");
	const quantity = await read(
		"document.querySelector('.vendor-quantity-dialog input[type=number]').value",
	);
	if (quantity !== "10")
		throw new Error(
			`Vendor quantity did not start at the offered stack: ${quantity}`,
		);
	if (capture) {
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await capture("vendor-quantity", shot.data);
	}
	await click(".vendor-quantity-dialog button[type=button]");
	await wait("document.querySelector('.vendor-quantity-dialog') === null");
	if (
		!(await read(
			`document.activeElement === document.querySelector(${JSON.stringify(offer)})`,
		))
	)
		throw new Error("Canceling vendor quantity did not restore offer focus");
	await drag(offer, queue);
	await wait("document.querySelector('.vendor-quantity-dialog') !== null");
	await read(
		"document.querySelector('.vendor-quantity-dialog form').requestSubmit()",
	);
	const requestedBuy = await read(`${fixture}.pending().draft.buys`);
	if (
		JSON.stringify(requestedBuy) !==
		JSON.stringify([{ item: 7001, amount: 10 }])
	)
		throw new Error("Vendor drag did not queue the whole offered stack");
	const buys = [{ item: 7001, amount: 10, total: 100, merge_key: 500 }];
	await quote(buys, []);
	const sells = [];
	for (const item of [6001, 6002]) {
		await drag(owned(item), queue);
		sells.push({ item, amount: 80, total: 3500, merge_key: 500 });
		await quote(buys, sells);
	}
	await wait(
		"document.querySelectorAll('.vendor-queue .sell .vendor-cell').length === 1",
	);
	const merged = await read(
		"document.querySelector('.vendor-queue .sell .vendor-cell').getAttribute('aria-label')",
	);
	if (!merged.includes("160") || !merged.includes("7,000"))
		throw new Error(`Merged sale quantity or price is wrong: ${merged}`);
	const cooldown = await read(`${fixture}.gestureCooldownMs`);
	await new Promise((resolve) => setTimeout(resolve, cooldown));
	const sword = await point('[data-vendor-offer="7002"]');
	for (const clickCount of [1, 2]) {
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...sword,
			button: "left",
			buttons: 1,
			clickCount,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...sword,
			button: "left",
			buttons: 0,
			clickCount,
		});
	}
	if ((await read(`${fixture}.pending().draft.buys.length`)) !== 2)
		throw new Error("Double-click did not queue a second offer");
	buys.push({ item: 7002, amount: 1, total: 10, merge_key: null });
	await quote(buys, sells);
	await drag(owned(6003), queue);
	await read(`${fixture}.reject('Retained items cannot be sold')`);
	await read(`${fixture}.settle()`);
	await wait(
		`document.querySelector(${JSON.stringify(offer)})?.disabled === false`,
	);
	const displayed = await read(`(() => {
        const panel = document.querySelector('[data-vendor-panel]');
        const catalog = panel.querySelector('.vendor-catalog');
        const rows = [...catalog.querySelectorAll('.vendor-offer-row')];
        const sampleRow = catalog.querySelector('[data-vendor-offer="7001"]');
        const sampleIcon = sampleRow?.querySelector('.offer-icon');
        const sampleName = sampleRow?.querySelector('.offer-name');
        const samplePrice = sampleRow?.querySelector('.offer-price');
        const costlyRow = catalog.querySelector('[data-vendor-offer="7003"]');
        const costlyPrice = costlyRow?.querySelector('.offer-price');
        const dangerSample = document.createElement('span');
        dangerSample.style.color = 'var(--ui-color-danger)';
        panel.append(dangerSample);
        const dangerColor = getComputedStyle(dangerSample).color;
        dangerSample.remove();
        const costlyPriceRed = costlyPrice?.textContent?.trim() === '600' &&
            getComputedStyle(costlyPrice).color === dangerColor &&
            costlyRow?.getAttribute('aria-label')?.includes('Not enough Trade Tokens');
        const affordablePriceNormal = samplePrice !== null &&
            getComputedStyle(samplePrice).color !== dangerColor;
        const rowsAreLines = rows.length > 0 && rows.every((row) => {
            const box = row.getBoundingClientRect();
            return box.width > box.height * 3 && Math.abs(box.width - row.parentElement.getBoundingClientRect().width) < 1;
        });
        const sampleRowContent = sampleIcon !== null && sampleName?.textContent?.trim() === 'Lead Scarabs×10' &&
            samplePrice?.textContent?.trim() === '100' &&
            samplePrice?.querySelector('.vendor-currency-amount')?.getAttribute('title') === 'Trade Tokens' &&
            samplePrice?.querySelector('.currency-icon') !== null &&
            sampleIcon.getBoundingClientRect().right < sampleName.getBoundingClientRect().left &&
            sampleName.getBoundingClientRect().left < samplePrice.getBoundingClientRect().left;
        const groups = [...panel.querySelectorAll('.queue-group')];
        const currency = panel.querySelector('.vendor-currencies');
        const currencyList = currency.querySelector('.vendor-currency-list');
        const balanceNodes = [...currencyList.querySelectorAll('.vendor-currency-amount')];
        const balances = balanceNodes.map((entry) => ({
            name: entry.getAttribute('title'), amount: entry.textContent?.replaceAll(' ', ''),
            icon: entry.querySelector('.currency-icon') !== null,
        }));
        const deltas = [...currencyList.querySelectorAll('.currency-delta')].map((entry) => ({
            amount: entry.textContent, red: getComputedStyle(entry).color === dangerColor,
        }));
        const currencyRightAligned = getComputedStyle(currencyList).justifyContent === 'flex-end' &&
            balanceNodes.length > 0 &&
            Math.abs(currency.getBoundingClientRect().right - balanceNodes.at(-1).getBoundingClientRect().right) < 1;
        const queueTotals = [...groups].map((group) => ({
            heading: group.querySelector('h3')?.textContent?.trim(),
            name: group.querySelector('.vendor-currency-amount')?.getAttribute('title'),
            amount: group.querySelector('.vendor-currency-amount')?.textContent?.replaceAll(' ', ''),
            icon: group.querySelector('.currency-icon') !== null,
        }));
        const footer = panel.querySelector('.vendor-footer');
        return { categories: [...catalog.querySelectorAll('h3')].map((title) => title.textContent),
            balances, deltas, currencyRightAligned, queueTotals,
            rowsAreLines, sampleRowContent, costlyPriceRed, affordablePriceNormal,
            scrollable: catalog.scrollHeight > catalog.clientHeight,
            catalogPadding: getComputedStyle(catalog).paddingLeft,
            currencyBorder: getComputedStyle(currency).borderTopWidth,
            groupsShareLine: groups.length === 2 && Math.abs(groups[0].getBoundingClientRect().top - groups[1].getBoundingClientRect().top) < 1,
            footerAlignment: getComputedStyle(footer).justifyContent,
            boughtCells: panel.querySelectorAll('.buy .vendor-cell').length,
            soldCells: panel.querySelectorAll('.sell .vendor-cell').length };
    })()`);
	if (
		!displayed.rowsAreLines ||
		!displayed.sampleRowContent ||
		!displayed.costlyPriceRed ||
		!displayed.affordablePriceNormal ||
		!displayed.scrollable ||
		displayed.catalogPadding === "0px" ||
		displayed.currencyBorder === "0px" ||
		displayed.balances.length !== 2 ||
		displayed.balances.some((balance) => !balance.icon) ||
		!displayed.currencyRightAligned ||
		displayed.deltas.length !== 2 ||
		displayed.deltas[0].red ||
		displayed.deltas[1].red ||
		displayed.queueTotals.length !== 2 ||
		displayed.queueTotals.some((total) => !total.icon) ||
		!displayed.groupsShareLine ||
		displayed.footerAlignment !== "flex-end" ||
		displayed.boughtCells !== 2 ||
		displayed.soldCells !== 1
	)
		throw new Error(
			`Vendor layout/queue mismatch: ${JSON.stringify(displayed)}`,
		);
	if (
		displayed.balances[0].name !== "Trade Tokens" ||
		displayed.balances[0].amount !== "500→400(-100)" ||
		displayed.balances[1].name !== "Pyreals" ||
		displayed.balances[1].amount !== "3,000→10,000(+7,000)" ||
		!displayed.queueTotals[0].heading?.startsWith("Buying for") ||
		displayed.queueTotals[0].name !== "Trade Tokens" ||
		displayed.queueTotals[0].amount !== "110" ||
		!displayed.queueTotals[1].heading?.startsWith("Selling for") ||
		displayed.queueTotals[1].name !== "Pyreals" ||
		displayed.queueTotals[1].amount !== "7,000"
	)
		throw new Error(
			`Vendor currency amounts mismatch: ${JSON.stringify(displayed)}`,
		);
	const themed = await read(`(() => {
        const panel = document.querySelector('[data-vendor-panel]');
        const values = {
            '--ui-vendor-inset': '12px',
            '--ui-vendor-offer-row-gap': '5px',
            '--ui-vendor-offer-icon-size': '24px',
            '--ui-vendor-offer-column-gap': '10px',
            '--ui-vendor-offer-padding': '4px 9px',
            '--ui-vendor-offer-background': 'rgb(33 44 55)',
            '--ui-vendor-buy-color': 'rgb(17 88 66)',
            '--ui-vendor-sell-color': 'rgb(99 44 11)',
        };
        for (const [name, value] of Object.entries(values))
            panel.style.setProperty(name, value);
        const catalog = panel.querySelector('.vendor-catalog');
        const list = panel.querySelector('.vendor-list');
        const row = panel.querySelector('.vendor-offer-row');
        const icon = row.querySelector('.offer-icon');
        const result = {
            inset: getComputedStyle(catalog).paddingLeft,
            rowGap: getComputedStyle(list).rowGap,
            iconSize: getComputedStyle(icon).width,
            columnGap: getComputedStyle(row).columnGap,
            rowPadding: getComputedStyle(row).padding,
            rowBackground: getComputedStyle(row).backgroundColor,
            buyColor: getComputedStyle(panel.querySelector('.queue-group.buy')).borderColor,
            sellColor: getComputedStyle(panel.querySelector('.queue-group.sell')).borderColor,
        };
        for (const name of Object.keys(values)) panel.style.removeProperty(name);
        return result;
    })()`);
	if (
		themed.inset !== "12px" ||
		themed.rowGap !== "5px" ||
		themed.iconSize !== "24px" ||
		themed.columnGap !== "10px" ||
		themed.rowPadding !== "4px 9px" ||
		themed.rowBackground !== "rgb(33, 44, 55)" ||
		themed.buyColor !== "rgb(17, 88, 66)" ||
		themed.sellColor !== "rgb(99, 44, 11)"
	)
		throw new Error(
			`Vendor theme hooks did not apply: ${JSON.stringify(themed)}`,
		);
	await read(`document.querySelector(${JSON.stringify(offer)}).focus()`);
	const away = await point(offer);
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...away,
		button: "none",
		buttons: 0,
	});
	if (
		!(await read(
			"getComputedStyle(document.querySelector('.vendor-queue .buy .queue-remove')).opacity === '0'",
		))
	)
		throw new Error("Queue remove button was visible without hover or focus");
	const queueCell = await point(".vendor-queue .buy .vendor-cell");
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...queueCell,
		button: "none",
		buttons: 0,
	});
	if (
		!(await read(
			"getComputedStyle(document.querySelector('.vendor-queue .buy .queue-remove')).opacity === '1'",
		))
	)
		throw new Error("Queue remove button did not appear on hover");
	const removal = await point(".vendor-queue .buy .queue-remove");
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...removal,
		button: "none",
		buttons: 0,
	});
	if (
		!(await read(
			`(() => {
				const entry = document.querySelector('.vendor-queue .buy .queue-entry');
				const button = entry.querySelector('.queue-remove');
				const cell = entry.querySelector('.vendor-cell');
				const icon = button.getBoundingClientRect();
				const art = cell.getBoundingClientRect();
				return icon.width < art.width && icon.right > art.right - 8 && icon.top < art.top + 8 && button.getAttribute('aria-label').startsWith('Remove ');
			})()`,
		))
	)
		throw new Error(
			"Queued item remove button is not floating at the top right",
		);
	if (capture) {
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await capture("vendor", shot.data);
	}
	await click(".vendor-footer .trade-button");
	const submitted = await read(`${fixture}.submitted()`);
	if (
		JSON.stringify(submitted.draft.sells) !== JSON.stringify([6001, 6002]) ||
		submitted.draft.buys.length !== 2
	)
		throw new Error("Vendor submission lost its original source identities");
	await read(`${fixture}.refresh()`);
	await wait(
		"document.querySelector('.vendor-footer .trade-button')?.textContent.includes('Selling') === true",
	);
	await read(`${fixture}.finishBuyFailure()`);
	if ((await read(`${fixture}.pending().draft.sells.length`)) !== 0)
		throw new Error("Confirmed sales were restored after failed buying");
	await quote(buys, []);
	await wait(
		"document.querySelectorAll('.vendor-queue .sell .vendor-cell').length === 0",
	);
	const failure = await read(
		"document.body.innerText.includes('Items sold; purchase failed.')",
	);
	if (!failure)
		throw new Error("Partial completion did not explain that the sale stands");
	if ((await inventorySubmissions()) !== submissionsBefore)
		throw new Error("Vendor gestures submitted an inventory movement");
	const summary = {
		...displayed,
		sourceIds: submitted.draft.sells,
		partialFailure: failure,
		inventorySubmissions: 0,
	};
	const inspectionsBefore = await read(
		`${api}.inventoryDragCommands().filter((entry) => entry.command === 'examine_client_entity').length`,
	);
	await click(".vendor-queue .buy .vendor-cell");
	if ((await read(`${fixture}.pending().draft.buys.length`)) !== 2)
		throw new Error("Selecting a queued item removed it from the draft");
	if (
		!(await read(
			"document.querySelector('.vendor-queue .buy .vendor-cell').getAttribute('aria-pressed') === 'true'",
		))
	)
		throw new Error("Queued item did not become selected");
	const inspectionCount = () =>
		read(
			`${api}.inventoryDragCommands().filter((entry) => entry.command === 'examine_client_entity').length`,
		);
	if ((await inspectionCount()) !== inspectionsBefore)
		throw new Error("Selecting a queued item inspected it immediately");
	await read(
		"document.querySelector('.vendor-queue .buy .vendor-cell').focus()",
	);
	for (const type of ["keyDown", "keyUp"])
		await client.send("Input.dispatchKeyEvent", {
			type,
			key: "e",
			code: "KeyE",
			windowsVirtualKeyCode: 69,
		});
	const queuedInspection = await read(
		`${api}.inventoryDragCommands().findLast((entry) => entry.command === 'examine_client_entity')`,
	);
	if (
		(await inspectionCount()) !== inspectionsBefore + 1 ||
		queuedInspection?.args?.guid !== 7001
	)
		throw new Error(
			"Examine shortcut did not inspect the selected queued item",
		);
	await read(`${api}.objectInspectionProbe().respond('item', 7001)`);
	await read(`${api}.objectInspectionProbe().end()`);
	const queuedPoint = await point(".vendor-queue .buy .vendor-cell");
	for (const type of ["mousePressed", "mouseReleased"])
		await client.send("Input.dispatchMouseEvent", {
			type,
			...queuedPoint,
			button: "right",
			buttons: type === "mousePressed" ? 2 : 0,
			clickCount: 1,
		});
	if (
		(await inspectionCount()) !== inspectionsBefore + 2 ||
		(await read(
			`${api}.inventoryDragCommands().findLast((entry) => entry.command === 'examine_client_entity').args.guid`,
		)) !== 7001
	)
		throw new Error("Right-click did not inspect the queued item");
	await read(`${api}.objectInspectionProbe().respond('item', 7001)`);
	await read(`${api}.objectInspectionProbe().end()`);
	await click(".vendor-queue .buy .queue-remove");
	if ((await read(`${fixture}.pending().draft.buys.length`)) !== 1)
		throw new Error("Queue remove button lost the wrong purchase entries");
	await quote([buys[1]], []);
	await click(".vendor-footer button:first-child");
	await quote([], []);
	if (
		!(await read(
			"document.querySelector('.queue-placeholder') !== null && document.querySelector('.trade-button').disabled",
		))
	)
		throw new Error("Clearing the draft did not restore the empty state");
	await read(`document.querySelector(${JSON.stringify(offer)}).focus()`);
	for (const type of ["keyDown", "keyUp"])
		await client.send("Input.dispatchKeyEvent", {
			type,
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
	await wait("document.querySelector('.vendor-quantity-dialog') !== null");
	await read(
		"document.querySelector('.vendor-quantity-dialog form').requestSubmit()",
	);
	if ((await read(`${fixture}.pending().draft.buys[0]?.item`)) !== 7001)
		throw new Error("Keyboard queue action did not buy the focused offer");
	await quote([buys[0]], []);
	await read(`${fixture}.refresh()`);
	await read(
		`${fixture}.reply(${JSON.stringify({
			buys: [buys[0]],
			sells: [],
			currencies: currencies.map((currency, index) =>
				index === 0 ? { ...currency, projected: -50 } : currency,
			),
			affordable: false,
		})})`,
	);
	await read(`${fixture}.settle()`);
	const negativeBalanceHighlighted = await read(`(() => {
        const balance = document.querySelector('.vendor-currencies .vendor-currency-amount');
        const projected = balance.querySelector('.negative');
        const delta = balance.querySelector('.currency-delta');
        const sample = document.createElement('span');
        sample.style.color = 'var(--ui-color-danger)';
        balance.append(sample);
        const dangerColor = getComputedStyle(sample).color;
        sample.remove();
        return projected?.textContent?.trim() === '-50' &&
            delta?.textContent?.trim() === '(-550)' &&
            getComputedStyle(projected).color === dangerColor &&
            getComputedStyle(delta).color !== dangerColor;
    })()`);
	if (!negativeBalanceHighlighted)
		throw new Error("Negative projected balance, not its delta, should be red");
	await read(`${fixture}.close()`);
	await wait("document.querySelector('[data-vendor-panel]') === null");
	if (
		await read(
			"document.querySelector('button[aria-label=\"Close Inventory\"]') !== null",
		)
	)
		await click('button[aria-label="Close Inventory"]');
	return { ...summary, negativeBalanceHighlighted };
}
