/** Client production-component appearance evidence, after the normal interaction suite. */
export async function probeClientTheme(
	client,
	evaluateExpression,
	save,
	viteUrl,
) {
	const read = (fn) => evaluateExpression(client, `(${fn.toString()})()`);
	const capture = async (name) =>
		save(
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
		const box = document.querySelector(".hud-window").getBoundingClientRect();
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
		const box = document.querySelector(".hud-window").getBoundingClientRect();
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
		const option = document.querySelector('[role="option"]');
		option.click();
	});
	await read(() => new Promise((resolve) => requestAnimationFrame(resolve)));
	await capture("characters");
	for (const [key, windowsVirtualKeyCode, index] of [
		["End", 35, -1],
		["Home", 36, 0],
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
			const options = [...document.querySelectorAll('.client-character')];
			return options.at(${index}).getAttribute('aria-selected') === 'true' &&
				document.activeElement.classList.contains('client-character-list');
		})()`,
		);
		if (!valid)
			throw new Error(
				`Character selection did not handle ${key} with its local keyboard handler.`,
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
		if (!document.activeElement?.classList.contains("client-action"))
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
		const enter = [...document.querySelectorAll(".client-action")].find(
			(button) => button.textContent.trim().startsWith("Enter"),
		);
		if (!enter) throw new Error("Character entry control is absent.");
		await new Promise((resolve) => requestAnimationFrame(resolve));
		if (!enter.disabled || !enter.textContent.includes("Entering"))
			throw new Error("Character entry did not publish its pending state.");
		const selected = document.querySelector(
			'.client-character[aria-selected="true"]',
		);
		const other = [...document.querySelectorAll(".client-character")].find(
			(option) => option !== selected,
		);
		other.click();
		other.focus();
		other.dispatchEvent(
			new KeyboardEvent("keydown", { key: "End", bubbles: true }),
		);
		await new Promise((resolve) => requestAnimationFrame(resolve));
		if (
			document.querySelector('.client-character[aria-selected="true"]') !==
			selected
		)
			throw new Error("Pending character entry allowed selection to change.");
	});
	// Exercise the actual startup/error shell without opening a live server connection.
	await client.send("Page.enable");
	await client.send("Page.addScriptToEvaluateOnNewDocument", {
		source: `
		window.holtburgerHost = {
			listen: async () => 1,
			unlisten: async () => {},
			invoke: async () => { throw new Error("Theme harness: no live connection"); }
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
			const error = document.querySelector(".client-screen [role='alert']");
			if (error?.textContent.includes("Theme harness: no live connection"))
				return true;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(
			"Client startup failure did not reach its themed lifecycle screen.",
		);
	});
	await capture("startup");
	return {
		...application,
		startup,
		windowGesture: { before: windowBefore, after: windowAfter },
	};
}
