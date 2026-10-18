import assert from "node:assert/strict";

/** Exercise production text consumers and intent with DOM facts and real pointer/keyboard input. */
export async function probeWaypointContent(client, evaluate) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const read = (code) => evaluate(client, code);
	const settle = () => read("new Promise(resolve => setTimeout(resolve, 400))");
	const mouse = async (type, x, y, down) => {
		if (type === "mousePressed")
			await client.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x,
				y,
				button: "none",
				buttons: 0,
			});
		return client.send("Input.dispatchMouseEvent", {
			type,
			x,
			y,
			button: type === "mouseMoved" ? "none" : "left",
			buttons: down ? 1 : 0,
			clickCount: type === "mouseMoved" ? 0 : 1,
		});
	};
	const point = (selector) =>
		read(`(() => {
		const node = document.querySelector(${JSON.stringify(selector)});
		if (!node) throw new Error('Missing content target: ' + ${JSON.stringify(selector)});
		node.scrollIntoView({block: 'center'});
		const r = node.getClientRects()[0];
		return {x: r.left + r.width/2, y: r.top + r.height/2};
	})()`);
	const click = async (selector) => {
		const p = await point(selector);
		await mouse("mousePressed", p.x, p.y, true);
		await mouse("mouseReleased", p.x, p.y, false);
		await settle();
	};
	const label = () =>
		read(`${api}.waypoint.read().frame.waypoint?.target.label`);
	const show = async (surface) => {
		await read(`${api}.showWaypointContent(${JSON.stringify(surface)})`);
		await settle();
	};
	const scene = () =>
		read(
			`(() => { const f=${api}.readWorldMapFixture(); return {orbits:f.sceneOrbits,zooms:f.sceneZooms,selection:${api}.waypoint.read().frame.selectedGuid}; })()`,
		);
	const activate = async (selector, expected) => {
		const beforeScene = await scene();
		const beforeChat = await read(
			"document.querySelector('.chat-buffer').textContent",
		);
		await point(selector);
		const diagnostic = await read(
			`(() => { const n = document.querySelector(${JSON.stringify(selector)}); const r=n.getClientRects()[0]; return {rect: r.toJSON(), hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML, pointer:getComputedStyle(n).pointerEvents, active:document.activeElement?.outerHTML.slice(0,200)}; })()`,
		);
		await click(selector);
		assert.equal(await label(), expected, JSON.stringify(diagnostic));
		assert.deepEqual(await scene(), beforeScene);
		const confirmation = `Waypoint set: ${expected}.`;
		assert.equal(
			await read(`${api}.waypoint.read().notices.at(-1)`),
			confirmation,
		);
		// The outgoing keyed toast can remain during its fade; inspect the requested message.
		assert.equal(
			await read(
				`Array.from(document.querySelectorAll('.client-toast[role="status"]'), node => node.textContent.trim()).includes(${JSON.stringify(confirmation)})`,
			),
			true,
		);
		assert.equal(
			await read("document.querySelector('.chat-buffer').textContent"),
			beforeChat,
		);
	};
	await show("chat");
	const before = await read(
		`({sent: ${api}.waypoint.read().sent.length, history: ${api}.waypoint.read().history})`,
	);
	assert.equal(
		await read(
			"document.querySelectorAll('.chat-message .waypoint-link').length",
		),
		0,
	);
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.chat-message')).pointerEvents",
		),
		"none",
	);
	await click('[aria-label="Interact with chat history"]');
	assert.equal(
		await read(
			"document.querySelectorAll('.chat-message .waypoint-link').length",
		),
		2,
	);
	const key = async (name, code, virtualKey, modifiers) => {
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: name,
			code,
			windowsVirtualKeyCode: virtualKey,
			modifiers,
			text: name === "Enter" ? "\r" : undefined,
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: name,
			code,
			windowsVirtualKeyCode: virtualKey,
		});
		await settle();
	};
	await key("Tab", "Tab", 9, 0);
	assert.equal(
		await read("document.activeElement.classList.contains('waypoint-link')"),
		true,
	);
	assert.equal(
		await read(`(() => {
		const style = getComputedStyle(document.activeElement);
		return style.outlineStyle === 'solid' && style.outlineWidth === '2px';
	})()`),
		true,
		"Coordinate link lacks the themed keyboard focus ring",
	);
	await key("Enter", "Enter", 13, 0);
	assert.equal(await label(), "42.1N, 33.6E");
	await activate(".chat-message .waypoint-link", "42.1N, 33.6E");
	// A pointer control returns keyboard ownership to the game while history stays interactive.
	const original = await label();
	const countBeforeSelection = await read(
		`${api}.waypoint.read().notices.length`,
	);

	await read("document.getSelection().removeAllRanges()");
	const bounds = await read(
		`(() => { const range=document.createRange(); range.selectNodeContents(document.querySelector('.chat-message')); const r=range.getClientRects()[0]; const link=document.querySelector('.chat-message .waypoint-link').getBoundingClientRect(); return {x:r.x+10,y:r.y+r.height/2,end:link.right+10}; })()`,
	);
	// Native word selection and Shift-click extend the range through the inline control.
	for (const type of ["mousePressed", "mouseReleased"])
		await client.send("Input.dispatchMouseEvent", {
			type,
			x: bounds.x,
			y: bounds.y,
			button: "left",
			clickCount: 2,
		});
	for (const type of ["mousePressed", "mouseReleased"])
		await client.send("Input.dispatchMouseEvent", {
			type,
			x: bounds.end,
			y: bounds.y,
			button: "left",
			clickCount: 1,
			modifiers: 8,
		});
	await settle();
	const selection = await read("document.getSelection().toString()");
	assert.ok(
		selection.includes("42.1N, 33.6E"),
		`Native selection did not include coordinate text: ${selection}`,
	);
	const link = await point(".chat-message .waypoint-link");
	await mouse("mousePressed", link.x - 5, link.y, true);
	await mouse("mouseMoved", link.x + 5, link.y, true);
	await mouse("mouseReleased", link.x + 5, link.y, false);
	await settle();
	assert.equal(
		await read(`${api}.waypoint.read().notices.length`),
		countBeforeSelection,
	);
	assert.equal(await label(), original);
	await key("c", "KeyC", 67, 2);
	await click('[aria-label="Chat message"]');
	await key("v", "KeyV", 86, 2);
	assert.equal(
		await read(`document.querySelector('[aria-label="Chat message"]').value`),
		selection,
	);
	await key("Escape", "Escape", 27, 0);
	await read("document.getSelection().removeAllRanges()");
	// Double-click-and-drag is another native selection gesture; record whether this headless browser extends it.
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: bounds.x,
		y: bounds.y,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: bounds.x,
		y: bounds.y,
		button: "left",
		buttons: 1,
		clickCount: 2,
	});
	await mouse("mouseMoved", bounds.end, bounds.y, true);
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: bounds.end,
		y: bounds.y,
		button: "left",
		buttons: 0,
		clickCount: 2,
	});
	await settle();
	const dragSelectionCreated = await read(
		"document.getSelection().toString().includes('42.1N, 33.6E')",
	);
	assert.equal(
		await read(`${api}.waypoint.read().notices.length`),
		countBeforeSelection,
	);

	await read(
		`(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('.chat-buffer strong')); const s = document.getSelection(); s.removeAllRanges(); s.addRange(range); })()`,
	);
	await activate(
		'.chat-message .waypoint-link[title="Set waypoint: 0.00S, 0.0W"]',
		"0.00S, 0.0W",
	);
	assert.equal(await read(`${api}.waypoint.read().gameActive`), true);
	await read("document.getSelection().removeAllRanges()");
	await click('[aria-label="Interact with chat history"]');
	assert.equal(
		await read(
			"document.querySelectorAll('.chat-message .waypoint-link').length",
		),
		0,
	);
	assert.equal(await label(), "0.00S, 0.0W");
	// Deferred text arrives through the existing book owner, then renders with the normal ready state.
	await show("book");
	assert.equal(
		await read("document.querySelectorAll('.book-text .waypoint-link').length"),
		0,
	);
	await read(
		`${api}.bookProbe.update({guid:42, inscription:'Inscribed at 2.0N, 3.0E.', authorName:'Traveler', pages:[{index:0, authorName:'Writer', text:'First stop: 42.1N, 33.6E.\\nNext page follows.'},{index:1, authorName:'Writer', text:'Second stop: 1.2S, 3.4W.'}]})`,
	);
	await settle();
	await activate(".book-text .waypoint-link", "42.1N, 33.6E");
	await activate(".book-page:nth-child(2) .waypoint-link", "1.2S, 3.4W");
	await activate(".book-scroll blockquote .waypoint-link", "2.0N, 3.0E");
	await show("item");
	await activate(".inspection-description .waypoint-link", "42.1N, 33.6E");
	await activate(
		"[data-inspection-portal-destination] .waypoint-link",
		"42.1N, 33.6E",
	);
	await click(".inspection-description-toggle");
	await activate(
		'.inspection-description .waypoint-link[title="Set waypoint: 1.2S, 3.4W"]',
		"1.2S, 3.4W",
	);
	await activate(".inspection-scroll blockquote .waypoint-link", "0.00S, 0.0W");
	await show("creature");
	await activate(
		".inspection-creature-description .waypoint-link",
		"40.0N, 20.0E",
	);
	await show("contracts");
	await click('nav[aria-label="Game shortcuts"] button[aria-label="Journal"]');
	await read(
		`document.querySelectorAll('.contract-row > summary').forEach(node => node.click())`,
	);
	await settle();
	await activate(".contract-details p .waypoint-link", "1.2S, 3.4W");
	await activate(
		'.contract-details .waypoint-link[title="Set waypoint: 0.4N, 0.4E"]',
		"0.4N, 0.4E",
	);
	const blockSize = await read(
		"import('/src/lib/game/landblocks.ts').then(m => m.OUTDOOR_LANDBLOCK_WORLD_SIZE)",
	);
	assert.deepEqual(
		await read(
			`JSON.parse(JSON.stringify(${api}.waypoint.read().frame.waypoint.target.position))`,
		),
		{ x: 128 * blockSize + 6, z: -(128 * blockSize + 12) },
	);
	await activate(
		'.contract-details .waypoint-link[title="Set waypoint: 0.5N, 0.5E"]',
		"0.5N, 0.5E",
	);
	await activate(
		'.contract-details .waypoint-link[title="Set waypoint: 4.5N, 6.7E"]',
		"4.5N, 6.7E",
	);
	const after = await read(
		`({sent: ${api}.waypoint.read().sent.length, history: ${api}.waypoint.read().history})`,
	);
	assert.deepEqual(after, before);
	return {
		passed: true,
		chatInteractiveOnly: true,
		nativeSelection: true,
		dragSelectionCreationVerified: dragSelectionCreated,
		clipboard: true,
		books: true,
		inspection: true,
		inscriptions: true,
		contracts: true,
	};
}
