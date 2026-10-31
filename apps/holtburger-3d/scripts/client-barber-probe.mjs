/** Production HUD and lifecycle decode, with explicit synthetic core replies. */
export async function probeBarber(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.barberProbe";
	const read = (expression) => evaluateExpression(client, expression);
	const wait = async (expression) => {
		const deadline = Date.now() + 5000;
		while (!(await read(expression))) {
			if (Date.now() > deadline)
				throw new Error(`Barber HUD did not settle: ${expression}`);
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
	};
	await read(`${api}.begin()`);
	await wait(`${api}.requests().length === 1`);
	await read(`${api}.reply()`);
	await wait(
		`Array.from(document.querySelectorAll('.barber-panel button')).some(button => button.textContent === 'Apply' && !button.disabled)`,
	);
	if (
		await read(
			`document.querySelector('[aria-label="Barbershop"]').querySelectorAll('.resize-border').length !== 0`,
		)
	)
		throw new Error("Barber window still exposes resize handles.");
	const expandedHeight = await read(
		`document.querySelector('[aria-label="Barbershop"]').getBoundingClientRect().height`,
	);
	const swatchGrid = await read(`(() => {
        const fields = Array.from(document.querySelectorAll('.barber-panel .body-color'), field => field.getBoundingClientRect());
        if (fields.length !== 4) throw new Error('Expected four appearance swatch fields.');
        const [first, second, third, fourth] = fields;
        return first.top === second.top && third.top === fourth.top && third.top > first.top && first.left === third.left && second.left === fourth.left && second.left > first.left;
    })()`);
	if (!swatchGrid)
		throw new Error(
			"Barber swatches are not arranged in two rows and columns.",
		);
	const checkboxLabelGap = await read(`(() => {
        const checkbox = document.querySelector('.barber-panel input[type=checkbox]');
        const label = checkbox.closest('label');
        const text = Array.from(label.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (!text) throw new Error('Barber checkbox has no label text.');
        const range = document.createRange();
        range.selectNodeContents(text);
        return range.getBoundingClientRect().left - checkbox.getBoundingClientRect().right;
    })()`);
	if (!(checkboxLabelGap > 0))
		throw new Error("Barber checkbox overlaps or touches its label.");
	const initial = await read(
		`Number(document.querySelector('.barber-panel input[type=range]').value)`,
	);
	await read(
		`document.querySelector('[aria-label="Previous Hair / body style"]').click()`,
	);
	await wait(`${api}.requests().length === 2`);
	if (
		(await read(
			`Number(document.querySelector('.barber-panel input[type=range]').value)`,
		)) !==
		initial - 1
	)
		throw new Error("Previous appearance button did not decrement the slider.");
	await read(`${api}.reply()`);
	await wait(
		`Array.from(document.querySelectorAll('.barber-panel button')).some(button => button.textContent === 'Apply' && !button.disabled)`,
	);
	await read(
		`document.querySelector('[aria-label="Next Hair / body style"]').click()`,
	);
	await wait(`${api}.requests().length === 3`);
	if (
		(await read(
			`Number(document.querySelector('.barber-panel input[type=range]').value)`,
		)) !== initial
	)
		throw new Error("Next appearance button did not increment the slider.");
	if (
		!(await read(
			`document.querySelector('[aria-label="Next Hair / body style"]').disabled`,
		))
	)
		throw new Error(
			"Next appearance button stayed enabled at the final choice.",
		);
	await read(`${api}.reply()`);
	await wait(
		`Array.from(document.querySelectorAll('.barber-panel button')).some(button => button.textContent === 'Apply' && !button.disabled)`,
	);
	const point = await read(
		`(() => {const input = document.querySelector('.barber-panel input[type=range]'); const rect = input.getBoundingClientRect(); return {x: rect.x + rect.width * 0.6, y: rect.y + rect.height / 2};})()`,
	);
	for (const type of ["mousePressed", "mouseReleased"])
		await client.send("Input.dispatchMouseEvent", {
			type,
			...point,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
		});
	await wait(`${api}.requests().length === 4`);
	await read(`${api}.reply()`);
	await wait(
		`Array.from(document.querySelectorAll('.barber-panel button')).some(button => button.textContent === 'Apply' && !button.disabled)`,
	);
	await read(
		`Array.from(document.querySelectorAll('.barber-panel button')).find(button => button.textContent === 'Apply').click()`,
	);
	await wait(`${api}.requests().some(request => request.kind === 'apply')`);
	const submitted = await read(`${api}.requests()`);
	if (submitted.filter((request) => request.kind === "apply").length !== 1)
		throw new Error("Barber sent duplicate Apply.");
	await read(`${api}.finish()`);
	await read(`${api}.begin(true)`);
	await wait(
		`document.querySelector('.barber-panel')?.textContent.includes('Body and face styles cannot be changed')`,
	);
	if (
		await read(
			`document.querySelectorAll('.barber-panel input[type=range]').length !== 0`,
		)
	)
		throw new Error("Unsupported body styles remained editable.");
	const compactHeight = await read(
		`document.querySelector('[aria-label="Barbershop"]').getBoundingClientRect().height`,
	);
	if (!(compactHeight < expandedHeight))
		throw new Error("Barber window did not shrink to fit its smaller content.");
	await read(
		`Array.from(document.querySelectorAll('.barber-panel button')).find(button => button.textContent === 'Cancel').click()`,
	);
	await wait(`${api}.requests().some(request => request.kind === 'cancel')`);
	const canceled = await read(`${api}.requests()`);
	if (canceled.some((request) => request.kind === "apply"))
		throw new Error("Cancel submitted an appearance.");
	return {
		submitted,
		canceled,
		disabledStyles: true,
		swatchGrid,
		checkboxLabelGap,
		stepButtons: true,
		fixedWindow: true,
		contentHeights: { expanded: expandedHeight, compact: compactHeight },
	};
}
