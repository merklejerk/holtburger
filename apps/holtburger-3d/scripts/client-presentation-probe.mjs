import assert from "node:assert/strict";

/** Exercise the actual ClientApp with real content and a controlled authority boundary. */
export async function probeClientPresentation(
	client,
	evaluate,
	consoleMessages,
) {
	const read = (expression) => evaluate(client, expression);
	const api = "globalThis.__HOLTBURGER_CLIENT_PRESENTATION__";
	const visible =
		"document.querySelector('.client-canvas')?.style.visibility === 'visible'";
	const wait = async (expression) => {
		const deadline = Date.now() + 90_000;
		while (!(await read(expression))) {
			const errors = consoleMessages.filter(
				({ level }) => level === "error" || level === "exception",
			);
			if (errors.length) throw new Error(JSON.stringify(errors));
			if (Date.now() > deadline)
				throw new Error(
					`Presentation timeout: ${expression}; ${await read("document.body.innerText")}`,
				);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	};
	const click = (label) =>
		read(`(() => {
		const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)});
		if (!button || button.disabled) throw new Error('Unavailable button: ' + ${JSON.stringify(label)});
		button.click();
	})()`);
	const physicalClick = async (label) => {
		const point = await read(`(() => {
			const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)});
			if (!button || button.disabled) throw new Error('Unavailable button: ' + ${JSON.stringify(label)});
			const bounds = button.getBoundingClientRect();
			return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
		})()`);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			buttons: 0,
			...point,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			button: "left",
			buttons: 1,
			clickCount: 1,
			...point,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			button: "left",
			buttons: 0,
			clickCount: 1,
			...point,
		});
	};
	const covered = async () => {
		assert.equal(
			await read(
				"document.querySelector('.client-loading-page') !== null && document.querySelector('.client-character-list') === null && document.querySelector('.creature-preview') === null",
			),
			true,
		);
		assert.equal(await read(visible), false);
	};
	await wait(
		`${api}?.read().gates.connection.waiting > 0 && ${api}.read().gates.scene.waiting > 0`,
	);
	await covered();
	// Exercise the browser clock boundary with one repeated display timestamp before scene reveal.
	// Reuse a timestamp on the next callback, rather than invoking one callback twice.
	await read(`(() => {
		const native = window.requestAnimationFrame;
		let previous = null;
		globalThis.__PRESENTATION_REPEATED_TIMESTAMP__ = false;
		window.requestAnimationFrame = callback => native.call(window, timestamp => {
			if (previous === null) { previous = timestamp; callback(timestamp); return; }
			window.requestAnimationFrame = native;
			globalThis.__PRESENTATION_REPEATED_TIMESTAMP__ = true;
			callback(previous);
		});
	})()`);
	await physicalClick("Provide characters");
	await wait(
		`${api}.read().rosterDelivered && document.querySelector('h1')?.textContent === 'Loading'`,
	);
	await covered();
	await physicalClick("Release scene");
	await wait(
		`${api} && ${visible} && document.body.innerText.includes('Choose a character') && !document.body.innerText.includes('Loading model')`,
	);
	await read(
		"globalThis.__PRESENTATION_PROOF_CANVAS__ = document.querySelector('.client-canvas'); true",
	);
	try {
		const selection = await read(`${api}.read()`);
		assert.equal(
			await read("globalThis.__PRESENTATION_REPEATED_TIMESTAMP__"),
			true,
		);
		await read("document.querySelector('input[name=character]').focus()");
		for (const [key, code, index] of [
			["ArrowDown", 40, 1],
			["ArrowUp", 38, 0],
		]) {
			await client.send("Input.dispatchKeyEvent", {
				type: "keyDown",
				key,
				code: key,
				windowsVirtualKeyCode: code,
			});
			await client.send("Input.dispatchKeyEvent", {
				type: "keyUp",
				key,
				code: key,
				windowsVirtualKeyCode: code,
			});
			await wait(
				`document.querySelectorAll('input[name=character]')[${index}].checked`,
			);
		}

		await click("Create character");
		await wait(
			"document.body.innerText.includes('Create a character') && document.querySelector('.client-canvas')?.style.visibility === 'hidden'",
		);
		await wait(
			"document.body.innerText.includes('Skills & Stats') && !document.body.innerText.includes('Loading model')",
		);
		const creator = await read(`${api}.read()`);
		await click("Face");
		await click("Body");
		await click("Cancel");
		await wait(
			`${visible} && document.body.innerText.includes('Choose a character')`,
		);
		await click("Enter World");
		await wait(
			`${api}.read().portalReveals === 1 && ${visible} && document.querySelector('.client-world') !== null`,
		);
		const gameplay = await read(`${api}.read()`);
		await read(`${api}.holdRetirement(); ${api}.returnSelection()`);
		await wait(
			`${api}.read().gates.retirement.waiting > 0 && document.querySelector('.client-loading-page') !== null`,
		);
		await covered();
		await read(`${api}.releaseRetirement()`);
		await wait(
			`${visible} && document.body.innerText.includes('Choose a character') && !document.body.innerText.includes('Loading model')`,
		);
		const returned = await read(
			`({...${api}.read(), sameCanvas: document.querySelector('.client-canvas') === globalThis.__PRESENTATION_PROOF_CANVAS__})`,
		);
		assert.equal(returned.sameCanvas, true);
		for (const phase of [selection, creator, gameplay, returned]) {
			assert.equal(phase.worldCanvases, 1);
			assert.equal(phase.worldContextRequests, 1);
		}
		assert.deepEqual(
			consoleMessages.filter(
				({ level }) => level === "error" || level === "exception",
			),
			[],
		);
		// New page lifetimes exercise readiness in the other order and fault recovery independently.
		const baseUrl = await read("location.href");
		const reload = async (empty = false) => {
			const url = new URL(baseUrl);
			if (empty) url.searchParams.set("empty-roster", "1");
			await client.send("Page.enable");
			const loaded = new Promise((resolve) =>
				client.on("Page.loadEventFired", resolve),
			);
			await client.send("Page.navigate", { url: url.href });
			await loaded;
			await wait(
				`${api}?.read().gates.connection.waiting > 0 && ${api}.read().gates.scene.waiting > 0`,
			);
		};
		await reload(true);
		await read(`${api}.authenticate()`);
		await physicalClick("Release scene");
		await wait(`${api}.read().worldDraws > 0`);
		assert.equal(
			await read("document.querySelector('h1').textContent"),
			"Authenticating",
		);
		await covered();
		await physicalClick("Provide characters");
		await wait(
			`${visible} && document.querySelector('.client-character-list') !== null`,
		);
		assert.equal(
			await read("document.querySelectorAll('input[name=character]').length"),
			0,
		);
		assert.equal(
			await read(
				"[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Enter World').disabled",
			),
			true,
		);

		await reload();
		await read(`${api}.releaseConnection(); ${api}.failScene()`);
		await wait(
			"document.querySelector('.client-loading-page [role=alert]')?.textContent.includes('Presentation fixture: scene failed')",
		);
		await covered();
		assert.deepEqual(await read(`${api}.read().expectedErrors`), [
			"Presentation fixture: scene failed",
		]);
		await click("Retry scene");
		await wait(
			`${visible} && document.querySelector('.client-character-list') !== null`,
		);
		assert.equal((await read(`${api}.read()`)).worldContextRequests, 1);

		await reload();
		await read(`${api}.failConnection()`);
		await wait(
			"document.querySelector('.client-loading-page [role=alert]')?.textContent.includes('Presentation fixture: connection failed')",
		);
		await covered();
		await click("Disconnect");
		await wait("document.querySelector('h1')?.textContent === 'Disconnecting'");
		await read(`${api}.releaseScene()`);
		await wait(`${api}.read().sceneResponses > 0`);
		await read(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
		await covered();
		return {
			selection,
			creator,
			gameplay,
			returned,
			nativeRosterKeys: true,
			loadingGate: {
				rosterFirst: true,
				repeatedTimestamp: true,
				sceneFirst: true,
				emptyRoster: true,
				retry: true,
				connectionFailureAndExit: true,
				staleReturnPrevented: true,
			},
		};
	} finally {
		await read("delete globalThis.__PRESENTATION_PROOF_CANVAS__");
	}
}
