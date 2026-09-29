/** Exercise decoded book receipts and deferred pages through the browser session and HUD. */
export async function probeClientBook(client, evaluateExpression, delay) {
	const root = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.bookProbe";
	const drag = async (rectangle, deltaX, deltaY) => {
		const x = rectangle.left + rectangle.width / 2;
		const y = rectangle.top + rectangle.height / 2;
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			button: "left",
			buttons: 1,
			clickCount: 1,
			x,
			y,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			button: "left",
			buttons: 1,
			x: x + deltaX,
			y: y + deltaY,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			button: "left",
			buttons: 0,
			clickCount: 1,
			x: x + deltaX,
			y: y + deltaY,
		});
		await delay(50);
	};
	await evaluateExpression(
		client,
		`(() => {
		${root}.open({ name: 'Field Journal', book: {
			guid: 42, inscription: 'For the next traveler', authorName: 'A. Writer',
			pages: [
				{ index: 0, authorName: 'A. Writer', text: 'First line\\nSecond line' },
				{ index: 1, authorName: 'B. Writer', text: null },
			],
		} });
	})()`,
	);
	await delay(50);
	const initialWindow = await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Field Journal"]');
		const bounds = panel.getBoundingClientRect();
		const grip = panel.querySelector('.hud-window-resize-bottom-right').getBoundingClientRect();
		return {
			panel: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
			grip: { left: grip.left, top: grip.top, width: grip.width, height: grip.height },
		};
	})()`,
	);
	await drag(initialWindow.grip, 35, 25);
	const resizedWindow = await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Field Journal"]');
		const bounds = panel.getBoundingClientRect();
		const title = panel.querySelector('.hud-window-titlebar').getBoundingClientRect();
		return {
			panel: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
			title: { left: title.left, top: title.top, width: title.width, height: title.height },
		};
	})()`,
	);
	if (
		resizedWindow.panel.width < initialWindow.panel.width + 20 ||
		resizedWindow.panel.height < initialWindow.panel.height + 15
	)
		throw new Error("Book window did not resize through its border.");
	await drag(resizedWindow.title, -35, 20);
	const movedWindow = await evaluateExpression(
		client,
		`(() => {
		const bounds = document.querySelector('[aria-label="Field Journal"]').getBoundingClientRect();
		return { left: bounds.left, top: bounds.top };
	})()`,
	);
	if (
		movedWindow.left > resizedWindow.panel.left - 20 ||
		movedWindow.top < resizedWindow.panel.top + 10
	)
		throw new Error("Book window did not move through its title bar.");
	await evaluateExpression(
		client,
		`(() => {
		const window = document.querySelector('[aria-label="Field Journal"]');
		if (!window?.textContent.includes('Loading pages 1 of 2'))
			throw new Error('Book reader did not show deferred-page progress.');
		if (window.textContent.includes('First line'))
			throw new Error('Book reader exposed partial text.');
		const requests = ${root}.requests().filter((entry) => entry.command === 'read_client_book_page');
		if (requests.at(-1)?.args?.pageIndex !== 1 || requests.at(-1)?.args?.book !== 42)
			throw new Error('Book reader did not request the missing page.');
		${root}.update({ guid: 42, inscription: 'For the next traveler',
			authorName: 'A. Writer', pages: [
				{ index: 0, authorName: 'A. Writer', text: 'First line\\nSecond line' },
				{ index: 1, authorName: 'B. Writer', text: 'Final page' },
			] });
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const window = document.querySelector('[aria-label="Field Journal"]');
		if (!window?.textContent.includes('First line') ||
			!window.textContent.includes('Final page') ||
			!window.textContent.includes('B. Writer') ||
			!window.textContent.includes('For the next traveler'))
			throw new Error('Book reader lost text or attribution.');
		const firstPage = window.querySelector('.book-text');
		if (!firstPage?.textContent.includes('First line\\nSecond line') ||
			getComputedStyle(firstPage).whiteSpace !== 'pre-wrap')
			throw new Error('Book reader did not preserve authored line breaks.');
		window.querySelector('[aria-label="Close Field Journal"]').click();
		${root}.update({ guid: 42, inscription: null, authorName: null, pages: [] });
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		if (document.querySelector('[aria-label="Field Journal"]'))
			throw new Error('A late page update reopened the book.');
		${root}.open({ name: 'Blank Book', book: {
			guid: 43, pages: [], inscription: null, authorName: null,
		} });
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const window = document.querySelector('[aria-label="Blank Book"]');
		if (!window?.textContent.includes('This book has no text.'))
			throw new Error('Empty book did not open with an explicit message.');
		window.querySelector('[aria-label="Close Blank Book"]').click();
	})()`,
	);
	await evaluateExpression(
		client,
		`(() => {
		${root}.failNextRequest();
		${root}.open({ name: 'Retry Book', book: {
			guid: 44, pages: [{ index: 0, authorName: '', text: null }],
			inscription: null, authorName: null,
		} });
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const window = document.querySelector('[aria-label="Retry Book"]');
		if (!window?.textContent.includes('Injected page request failure') ||
			!window.textContent.includes('Retry'))
			throw new Error('Book request failure did not offer retry.');
		${root}.retry();
		${root}.update({ guid: 44, pages: [{ index: 0, authorName: '', text: 'Recovered' }],
			inscription: null, authorName: null });
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const window = document.querySelector('[aria-label="Retry Book"]');
		if (!window?.textContent.includes('Recovered'))
			throw new Error('Book retry did not display the recovered page.');
		window.querySelector('[aria-label="Close Retry Book"]').click();
	})()`,
	);
	return { passed: true };
}
