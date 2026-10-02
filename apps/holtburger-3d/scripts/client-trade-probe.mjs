/** Exercise production HUD controls and a real inventory pointer drop without image checks. */
export async function probeTrade(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const fixture = `${api}.tradeProbe`;
	const read = (expression) => evaluateExpression(client, expression);
	const wait = async (expression) => {
		const deadline = Date.now() + 5000;
		while (!(await read(expression))) {
			if (Date.now() > deadline)
				throw new Error(`Trade UI did not settle: ${expression}`);
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
	};
	const button = (text) =>
		`Array.from(document.querySelectorAll('[data-trade-panel] button')).find((button) => button.getAttribute("aria-label") === ${JSON.stringify(text)})`;
	await read(`${fixture}.begin()`);
	await wait(
		`document.querySelector('[aria-label="Trade"]')?.disabled === false`,
	);
	await read(`document.querySelector('[aria-label="Trade"]').click()`);
	const open = await read(`${fixture}.request()`);
	if (
		open.kind !== "open" ||
		open.partner !== 5001 ||
		(await read("document.querySelector('[data-trade-panel]') !== null"))
	)
		throw new Error("Trade initiation did not wait for server registration");
	await read(`(() => {
        const inventory = document.querySelector('button[aria-label="Inventory"]');
        if (inventory?.getAttribute('aria-pressed') !== 'true') inventory?.click();
    })()`);
	await wait(
		"document.querySelector('.client-inventory .contents-scroll [data-item-guid=\"6001\"]') !== null",
	);
	await read(`${fixture}.register()`);
	await wait("document.querySelector('[data-trade-panel]') !== null");
	const point = (selector) =>
		read(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing trade probe element');
        element.scrollIntoView({block: 'nearest'});
        const rect = element.getBoundingClientRect();
        const point = {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
        if (!element.contains(document.elementFromPoint(point.x, point.y))) throw new Error('Trade probe element is covered');
        return point;
    })()`);
	const from = await point(
		'.client-inventory .contents-scroll [data-item-guid="6001"]',
	);
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		...from,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	const to = await point('[data-trade-offer="5001"]');
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
	const add = await read(`${fixture}.request()`);
	if (add.kind !== "add" || add.item !== 6001)
		throw new Error("Inventory drop did not submit a trade addition");
	await read(`${fixture}.pending()`);
	await wait(`${button("Confirm trade")}?.disabled === true`);
	if (await read("document.querySelector('[data-trade-item]') !== null"))
		throw new Error("Pending addition became a confirmed offer");
	await read(`${fixture}.acknowledge()`);
	await wait(
		`${button("Confirm trade")}?.disabled === false && document.querySelector('[data-trade-item="6001"]') !== null`,
	);
	for (const item of [6001, 6002]) {
		const selectedPoint = await point(`[data-trade-item="${item}"]`);
		for (const type of ["mousePressed", "mouseReleased"]) {
			await client.send("Input.dispatchMouseEvent", {
				type,
				...selectedPoint,
				button: "left",
				buttons: type === "mousePressed" ? 1 : 0,
				clickCount: 1,
			});
		}
		await wait(
			`document.querySelector('[data-trade-item="${item}"]')?.getAttribute('aria-pressed') === 'true'`,
		);
	}

	const confirmPoint = await point('[data-trade-side="self"] .trade-confirm');
	for (const type of ["mousePressed", "mouseReleased"]) {
		await client.send("Input.dispatchMouseEvent", {
			type,
			...confirmPoint,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
		});
	}
	const accept = await read(`${fixture}.request()`);
	if (accept.kind !== "accept" || accept.revision !== 2)
		throw new Error("Acceptance did not name the displayed offer revision");
	await read(`${fixture}.accepted("partner", true)`);
	await wait(
		"document.querySelector('[data-trade-side=\"partner\"]').dataset.tradeAccepted === 'true'",
	);
	const theme = await read(`(() => {
        const panel = document.querySelector('[data-trade-panel]');
        const confirm = panel.querySelector('.trade-confirm');
        const transition = confirm.style.transition;
        confirm.style.transition = 'none';
        const overrides = {
            '--ui-trade-self-color': 'rgb(210, 100, 120)',
            '--ui-trade-partner-color': 'rgb(80, 140, 220)',
            '--ui-trade-self-background': 'rgb(21, 22, 23)',
            '--ui-trade-partner-background': 'rgb(31, 32, 33)',
            '--ui-trade-self-header-background': 'rgb(41, 42, 43)',
            '--ui-trade-partner-header-background': 'rgb(51, 52, 53)',
            '--ui-trade-accepted-color': 'rgb(70, 200, 100)',
            '--ui-trade-reset-size': '38px',
            '--ui-trade-reset-inset': '5px',
            '--ui-trade-reset-background': 'rgb(61, 62, 63)',
            '--ui-button-color': 'rgb(180, 160, 220)',
            '--ui-button-border-color': 'rgb(140, 120, 200)',
        };
        for (const [name, value] of Object.entries(overrides)) panel.style.setProperty(name, value);
        const self = panel.querySelector('[data-trade-side="self"]');
        const partner = panel.querySelector('[data-trade-side="partner"]');
        const actual = {
            selfColor: getComputedStyle(self).borderColor,
            partnerColor: getComputedStyle(partner).borderColor,
            selfBackground: getComputedStyle(self).backgroundColor,
            partnerBackground: getComputedStyle(partner).backgroundColor,
            selfHeader: getComputedStyle(self.querySelector('header')).backgroundColor,
            partnerHeader: getComputedStyle(partner.querySelector('header')).backgroundColor,
            acceptedColor: getComputedStyle(partner.querySelector('[role="status"]')).color,
            resetSize: getComputedStyle(panel.querySelector('.trade-reset')).width,
            resetBackingSize: getComputedStyle(panel.querySelector('.trade-reset-notch')).width,
            resetBackground: getComputedStyle(panel.querySelector('.trade-reset-notch')).backgroundColor,
            buttonColor: getComputedStyle(panel.querySelector('.trade-confirm')).color,
            buttonBorder: getComputedStyle(panel.querySelector('.trade-confirm')).borderColor,
        };
        for (const name of Object.keys(overrides)) panel.style.removeProperty(name);
        confirm.style.transition = transition;
        return actual;
    })()`);
	const expectedTheme = {
		selfColor: "rgb(210, 100, 120)",
		partnerColor: "rgb(80, 140, 220)",
		selfBackground: "rgb(21, 22, 23)",
		partnerBackground: "rgb(31, 32, 33)",
		selfHeader: "rgb(41, 42, 43)",
		partnerHeader: "rgb(51, 52, 53)",
		acceptedColor: "rgb(70, 200, 100)",
		resetSize: "38px",
		resetBackingSize: "48px",
		resetBackground: "rgb(61, 62, 63)",
		buttonColor: "rgb(180, 160, 220)",
		buttonBorder: "rgb(140, 120, 200)",
	};
	for (const [name, value] of Object.entries(expectedTheme)) {
		if (theme[name] !== value)
			throw new Error(
				`Trade theme override failed for ${name}: ${theme[name]}`,
			);
	}

	await read(`${fixture}.accepted("self", true)`);
	await wait(
		`${button("Withdraw acceptance")}?.disabled === true && document.querySelector('[data-trade-side="self"]').dataset.tradeAccepted === 'true'`,
	);
	await read(`${fixture}.accepted("partner", false)`);
	await wait(`${button("Withdraw acceptance")}?.disabled === false`);
	const acceptedButtonTheme = await read(`(() => {
        const button = document.querySelector('.trade-confirm');
        const transition = button.style.transition;
        button.style.transition = 'none';
        button.style.setProperty('--ui-button-color', 'rgb(180, 160, 220)');
        button.style.setProperty('--ui-button-border-color', 'rgb(140, 120, 200)');
        const result = {color: getComputedStyle(button).color, border: getComputedStyle(button).borderColor};
        button.style.removeProperty('--ui-button-color');
        button.style.removeProperty('--ui-button-border-color');
        button.style.transition = transition;
        return result;
    })()`);
	if (
		acceptedButtonTheme.color !== "rgb(180, 160, 220)" ||
		acceptedButtonTheme.border !== "rgb(140, 120, 200)"
	)
		throw new Error("Accepted trade button bypassed theme overrides");

	await read(`${button("Withdraw acceptance")}.click()`);
	if ((await read(`${fixture}.request()`)).kind !== "withdraw")
		throw new Error("Ready control did not withdraw acceptance");
	await read(`${fixture}.accepted("self", false)`);
	const resetPoint = await point(".trade-reset-notch .trade-reset");
	for (const type of ["mousePressed", "mouseReleased"]) {
		await client.send("Input.dispatchMouseEvent", {
			type,
			...resetPoint,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
		});
	}
	if ((await read(`${fixture}.request()`)).kind !== "reset")
		throw new Error("Integrated reset did not submit reset");
	await read(`${fixture}.complete()`);
	await wait(
		"document.querySelector('[data-trade-panel]') !== null && document.querySelector('[data-trade-item]') === null",
	);
	await read(
		`document.querySelector('button[aria-label="Close Trade with Item 5001"]').click()`,
	);
	const close = await read(`${fixture}.request()`);
	if (
		close.kind !== "close" ||
		!(await read("document.querySelector('[data-trade-panel]') !== null"))
	)
		throw new Error("Trade close did not wait for the server");
	await read(`${fixture}.close()`);
	await wait("document.querySelector('[data-trade-panel]') === null");
	await read(`${fixture}.register()`);
	await wait("document.querySelector('[data-trade-panel]') !== null");
	await read(`${fixture}.close()`);
	await wait("document.querySelector('[data-trade-panel]') === null");
	return {
		open,
		add,
		accept,
		close,
		theme,
		acceptedButtonTheme,
		incoming: true,
		completionRetainsWindow: true,
	};
}
