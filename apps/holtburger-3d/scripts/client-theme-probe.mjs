/** Client production-component appearance evidence, after the normal interaction suite. */
export async function probeClientTheme(
	client,
	evaluateExpression,
	save,
	viteUrl,
) {
	const read = (fn) => evaluateExpression(client, `(${fn.toString()})()`);
	const capture = async (name) =>
		save === null
			? undefined
			: save(
					name,
					(
						await client.send("Page.captureScreenshot", {
							format: "png",
							captureBeyondViewport: false,
						})
					).data,
				);
	await read(() =>
		document.querySelector('button[aria-label="Debug"]').click(),
	);
	await read(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	);
	const windowBefore = await read(() => {
		const box = document
			.querySelector('.hud-window[aria-label="Client diagnostics"]')
			.getBoundingClientRect();
		return {
			left: box.left,
			top: box.top,
			width: box.width,
			height: box.height,
		};
	});
	const gesture = async (x, y, dx, dy) => {
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
			x: x + dx,
			y: y + dy,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			button: "left",
			buttons: 0,
			clickCount: 1,
			x: x + dx,
			y: y + dy,
		});
		await read(() => new Promise((resolve) => requestAnimationFrame(resolve)));
	};
	await gesture(
		windowBefore.left + windowBefore.width / 2,
		windowBefore.top + 16,
		-30,
		-20,
	);
	await gesture(
		windowBefore.left - 30 + windowBefore.width - 3,
		windowBefore.top - 20 + windowBefore.height - 3,
		24,
		16,
	);
	const windowAfter = await read(() => {
		const box = document
			.querySelector('.hud-window[aria-label="Client diagnostics"]')
			.getBoundingClientRect();
		return {
			left: box.left,
			top: box.top,
			width: box.width,
			height: box.height,
		};
	});
	if (
		windowAfter.left !== windowBefore.left - 30 ||
		windowAfter.top !== windowBefore.top - 20 ||
		windowAfter.width !== windowBefore.width + 24 ||
		windowAfter.height !== windowBefore.height + 16
	)
		throw new Error(
			"The themed diagnostic window did not preserve native drag/resize.",
		);
	await capture("runtime");
	const application = await read(() =>
		globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeThemeApplication(),
	);
	await read(() =>
		globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.previewCharacterSelection(),
	);
	await read(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	);
	await read(() => {
		const option = document.querySelector('button[name="character"]');
		option.click();
		option.focus();
	});
	await read(() => new Promise((resolve) => requestAnimationFrame(resolve)));
	await capture("characters");
	for (const [key, windowsVirtualKeyCode, index] of [
		["ArrowDown", 40, 1],
		["ArrowUp", 38, 0],
	]) {
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key,
			code: key,
			windowsVirtualKeyCode,
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key,
			code: key,
			windowsVirtualKeyCode,
		});
		const valid = await evaluateExpression(
			client,
			`(() => {
			const options = [...document.querySelectorAll('button[name="character"]')];
			return options.at(${index}).getAttribute("aria-pressed") === "true" &&
				document.activeElement === options.at(${index});
		})()`,
		);
		if (!valid)
			throw new Error(
				`Character selection did not handle ${key} through its character rows.`,
			);
	}
	// Character selection is an ordinary page: Tab reaches its native action buttons.
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
	await read(() => {
		if (!document.activeElement?.classList.contains("enter-world"))
			throw new Error(
				"Character selection did not allow native Tab navigation.",
			);
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
		text: "\r",
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
	});
	await read(async () => {
		const enter = [...document.querySelectorAll(".enter-world")].find(
			(button) => button.textContent.trim().startsWith("Enter"),
		);
		if (!enter) throw new Error("Character entry control is absent.");
		await new Promise((resolve) => requestAnimationFrame(resolve));
		if (!enter.disabled || !enter.textContent.includes("Entering"))
			throw new Error("Character entry did not publish its pending state.");
		const selected = document.querySelector(
			'button[name="character"][aria-pressed="true"]',
		);
		const other = [
			...document.querySelectorAll('button[name="character"]'),
		].find((option) => option !== selected);
		other.click();
		other.focus();
		await new Promise((resolve) => requestAnimationFrame(resolve));
		if (
			document.querySelector(
				'button[name="character"][aria-pressed="true"]',
			) !== selected
		)
			throw new Error("Pending character entry allowed selection to change.");
	});
	// Exercise the actual startup/error shell without opening a live server connection.
	await client.send("Page.enable");
	await client.send("Page.addScriptToEvaluateOnNewDocument", {
		source: `
		// The early renderer now observes the same deliberately refused host as session startup.
		// Retain that exact injected fault as evidence; all unexpected console errors still propagate.
		window.__THEME_EXPECTED_PRESENTATION_ERRORS__ = [];
		const reportConsoleError = console.error.bind(console);
		console.error = (...args) => {
			if (args.length === 1 && args[0] instanceof Error && args[0].message === "Theme harness: no live connection") {
				window.__THEME_EXPECTED_PRESENTATION_ERRORS__.push(args[0].message);
				return;
			}
			reportConsoleError(...args);
		};
		window.holtburgerHost = {
			listen: async () => 1,
			unlisten: async () => {},
			invoke: async () => { throw new Error("Theme harness: no live connection"); }
		};
		window.holtburgerVisualCache = {
			read: async () => ({ kind: "missing" }),
			stage: async () => {},
			listenFailures: () => () => {}
		};
		window.holtburgerSettings = {
			loadUser: async () => ({ sections: {}, hudPlacements: {}, unavailable: [] }),
			saveUserPatch: async () => {},
			resetUser: async () => [],
			loadCharacter: async () => ({ sections: {}, unavailable: [] }),
			saveCharacterPatch: async () => {}
		};
	`,
	});
	const loaded = new Promise((resolve) =>
		client.on("Page.loadEventFired", resolve),
	);
	await client.send("Page.navigate", { url: `${viteUrl}/client/index.html` });
	await loaded;
	const startup = await read(async () => {
		for (let attempt = 0; attempt < 100; attempt++) {
			const error = document.querySelector(
				".client-pregame-screen [role='alert']",
			);
			if (error?.textContent.includes("Theme harness: no live connection"))
				return true;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(
			"Client startup failure did not reach its themed lifecycle screen.",
		);
	});
	const expectedPresentationErrors = await read(
		() => window.__THEME_EXPECTED_PRESENTATION_ERRORS__,
	);
	if (expectedPresentationErrors.length !== 1)
		throw new Error(
			`Expected one deliberately refused presentation startup: ${JSON.stringify(expectedPresentationErrors)}`,
		);
	await capture("startup");
	return {
		...application,
		startup,
		expectedPresentationErrors,
		windowGesture: { before: windowBefore, after: windowAfter },
	};
}
