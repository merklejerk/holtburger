/** Verify real component interaction and stylesheet reload through the standalone showcase. */
export async function probeUiShowcase(client, evaluateExpression) {
	const read = (fn, ...args) =>
		evaluateExpression(
			client,
			`(${fn.toString()})(...${JSON.stringify(args)})`,
		);
	const wait = async (fn) => {
		for (let attempt = 0; attempt < 200; attempt++) {
			if (await read(fn)) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error(`Showcase did not settle: ${fn.toString()}`);
	};
	await wait(() => Boolean(document.querySelector(".character-hud")));
	const originalViewport = await read(() => ({
		width: innerWidth,
		height: innerHeight,
	}));
	for (const size of [
		{ width: 900, height: 800 },
		{ width: 600, height: 800 },
		originalViewport,
	]) {
		await client.send("Emulation.setDeviceMetricsOverride", {
			...size,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await read(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		await read(() => {
			const panels = [
				...document.querySelectorAll(
					".hud-panel, .hud-window, .showcase-controls",
				),
			];
			for (let i = 0; i < panels.length; i++) {
				const a = panels[i].getBoundingClientRect();
				for (const other of panels.slice(i + 1)) {
					const b = other.getBoundingClientRect();
					if (
						a.left < b.right &&
						a.right > b.left &&
						a.top < b.bottom &&
						a.bottom > b.top
					)
						throw new Error(
							"Initial showcase panels overlap: " +
								panels[i].getAttribute("aria-label") +
								" / " +
								other.getAttribute("aria-label"),
						);
				}
			}
			if (document.querySelector(".hud-panel .layout-handle"))
				throw new Error("HUD placement controls should start locked.");
		});
	}
	const baseline = await read(() => {
		for (const button of document.querySelectorAll(".shortcut-dock button")) {
			const box = button.getBoundingClientRect();
			const hit = document.elementFromPoint(
				box.x + box.width / 2,
				box.y + box.height / 2,
			);
			if (!button.contains(hit))
				throw new Error(
					"Dock button does not receive pointer input: " +
						button.getAttribute("aria-label"),
				);
		}
		const chat = document.querySelector(".chat-panel");
		const combat = chat.querySelector(".chat-tone-combat");
		const originalChatStyle = chat.style.cssText;
		try {
			const originalColor = getComputedStyle(combat).color;
			chat.style.setProperty("--ui-color-health", "rgb(1, 2, 3)");
			if (getComputedStyle(combat).color !== originalColor)
				throw new Error("Vital palette changes unexpectedly recolored chat.");
			chat.style.setProperty("--ui-chat-combat-text", "rgb(12, 34, 56)");
			if (getComputedStyle(combat).color !== "rgb(12, 34, 56)")
				throw new Error(
					"Chat category override did not reach production messages.",
				);
		} finally {
			chat.style.cssText = originalChatStyle;
		}
		const chatFilter = document.querySelector(".chat-filters button");
		if (getComputedStyle(chatFilter, "::before").content !== "none")
			throw new Error("Text filters should not have a HUD icon backing.");
		const selectedIcon = document.querySelector(
			'.shortcut-dock button[aria-pressed="true"]',
		);
		const conditionGroup = document.querySelector(".conditions");
		const selectedGroup = document.querySelector(".selected-entity__heading");
		const conditionBackdrop = getComputedStyle(
			conditionGroup,
			"::before",
		).backgroundColor;
		if (
			conditionBackdrop !==
			getComputedStyle(selectedGroup, "::before").backgroundColor
		)
			throw new Error("Condition and selected-entity HUD backings differ.");
		if (
			getComputedStyle(
				document.querySelector(".conditions .condition"),
				"::before",
			).content !== "none" ||
			getComputedStyle(
				document.querySelector(".selected-entity__heading button"),
				"::before",
			).content !== "none"
		)
			throw new Error("HUD group children must not own duplicate backings.");
		if (
			getComputedStyle(selectedIcon).backgroundColor !== "rgba(0, 0, 0, 0)" ||
			getComputedStyle(selectedIcon, "::before").maskImage === "none"
		)
			throw new Error(
				"Selected HUD icons must keep their fill on the masked backing.",
			);
		const expected = [
			".character-hud",
			".selected-entity",
			".chat-panel",
			".client-fps-counter",
			".jump-power",
			".shortcut-dock",
			".client-toast-overlay",
			".hud-window",
		];
		for (const selector of expected)
			if (!document.querySelector(selector))
				throw new Error("Missing production component: " + selector);
		const runtime = performance
			.getEntriesByType("resource")
			.filter((entry) =>
				/webgl2-|game-presentation-owner|BrowserHarnessApp|ClientWorldView|client-presentation-session/.test(
					entry.name,
				),
			);
		if (document.querySelector("canvas") || runtime.length)
			throw new Error(
				"Showcase loaded game rendering: " + runtime.map((x) => x.name),
			);
		return getComputedStyle(document.documentElement)
			.getPropertyValue("--ui-color-accent")
			.trim();
	});
	const dockPoint = await read(() => {
		const box = document
			.querySelector('.shortcut-dock button[aria-label="Debug"]')
			.getBoundingClientRect();
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...dockPoint,
	});
	await wait(() =>
		document
			.querySelector('.shortcut-dock button[aria-label="Debug"]')
			.matches(":hover"),
	);
	for (const open of [false, true]) {
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...dockPoint,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await wait(() =>
			document
				.querySelector('.shortcut-dock button[aria-label="Debug"]')
				.matches(":active"),
		);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...dockPoint,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
		const actual = await read(() =>
			Boolean(document.querySelector(".hud-window")),
		);
		if (actual !== open)
			throw new Error("Native dock click did not toggle its panel.");
	}
	const click = async (label) => {
		const point = await read((label) => {
			const button = [...document.querySelectorAll("button")].find(
				(node) => node.textContent.trim() === label,
			);
			if (!button) throw new Error("Missing button: " + label);
			const box = button.getBoundingClientRect();
			return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		}, label);
		for (const type of ["mousePressed", "mouseReleased"])
			await client.send("Input.dispatchMouseEvent", {
				type,
				...point,
				button: "left",
				clickCount: 1,
			});
	};
	await click("Unlock UI layout");
	await wait(
		() =>
			Boolean(document.querySelector('[aria-label="Move character"]')) &&
			Boolean(document.querySelector('[aria-label="Resize chat"]')),
	);
	await click("Lock UI layout");
	await wait(() => !document.querySelector(".hud-panel .layout-handle"));
	await click("characters");
	await read(() => document.querySelector('[role="option"]').focus());
	for (const [key, index] of [
		["ArrowDown", 1],
		["ArrowDown", 1],
		["Home", 0],
		["End", 1],
		["ArrowUp", 0],
		["l", 1],
	]) {
		await client.send("Input.dispatchKeyEvent", { type: "keyDown", key });
		await client.send("Input.dispatchKeyEvent", { type: "keyUp", key });
		await read((index) => {
			const options = [
				...document.querySelectorAll('.client-character-list [role="option"]'),
			];
			if (
				document.activeElement !== options[index] ||
				options[index].getAttribute("aria-selected") !== "true" ||
				options.filter((option) => option.tabIndex === 0).length !== 1
			)
				throw new Error(
					"Character listbox navigation did not move focus and selection together.",
				);
		}, index);
	}
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Tab",
		windowsVirtualKeyCode: 9,
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Tab",
		windowsVirtualKeyCode: 9,
	});
	await read(() => {
		if (document.activeElement.textContent.trim() !== "Enter World")
			throw new Error(
				"Character listbox did not use a single Tab stop before explicit entry.",
			);
		if (
			document
				.querySelector(".client-toast-overlay")
				.textContent.includes("Character entry preview")
		)
			throw new Error("Character navigation unexpectedly entered the world.");
	});
	const characterPoint = await read(() => {
		const box = document
			.querySelectorAll(".client-character")[1]
			.getBoundingClientRect();
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	});
	for (const clickCount of [1, 2]) {
		for (const type of ["mousePressed", "mouseReleased"])
			await client.send("Input.dispatchMouseEvent", {
				type,
				...characterPoint,
				button: "left",
				clickCount,
			});
	}
	await wait(() =>
		document
			.querySelector(".client-toast-overlay")
			.textContent.includes("Character entry preview"),
	);
	await read(() => document.querySelector('[role="option"]').click());
	await read(() => document.querySelector(".chat-panel input").focus());
	await client.send("Input.insertText", {
		text: "A draft survives theme reload.",
	});
	const initial = await read(() => {
		const window = document.querySelector(".hud-window");
		const box = window.getBoundingClientRect();
		return { x: box.x, y: box.y, width: box.width, height: box.height };
	});
	const gesture = async (x, y, dx, dy) => {
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x,
			y,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: x + dx,
			y: y + dy,
			button: "left",
			buttons: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: x + dx,
			y: y + dy,
			button: "left",
			buttons: 0,
		});
	};
	await gesture(initial.x + initial.width / 2, initial.y + 12, -30, -15);
	await gesture(
		initial.x - 30 + initial.width - 2,
		initial.y - 15 + initial.height - 2,
		20,
		20,
	);
	await read((initial) => {
		const panel = document.querySelector(".hud-window");
		const rect = panel.getBoundingClientRect();
		if (
			rect.x !== initial.x - 30 ||
			rect.y !== initial.y - 15 ||
			rect.width !== initial.width + 20 ||
			rect.height !== initial.height + 20
		)
			throw new Error("Production window drag/resize failed.");
		globalThis.__SHOWCASE_PROBE__ = {
			panel,
			character: document.querySelector(".character-hud"),
			rect: JSON.stringify(rect.toJSON()),
		};
	}, initial);
	let responseMode = "replacement";
	const pending = [];
	client.on("Fetch.requestPaused", (event) => {
		pending.push(
			responseMode === "replacement"
				? client.send("Fetch.fulfillRequest", {
						requestId: event.requestId,
						responseCode: 200,
						responseHeaders: [{ name: "Content-Type", value: "text/css" }],
						body: Buffer.from(
							"@layer theme { :root { --ui-color-accent: rgb(10, 20, 30); } }",
						).toString("base64"),
					})
				: client.send("Fetch.failRequest", {
						requestId: event.requestId,
						errorReason: "Failed",
					}),
		);
	});
	const intercept = () =>
		client.send("Fetch.enable", {
			patterns: [{ urlPattern: "*holtburger-standard.css*showcase-reload*" }],
		});
	try {
		await intercept();
		await click("Reload theme");
		await wait(
			() =>
				document.querySelector('.showcase-controls [role="status"]')
					?.textContent === "Theme reloaded.",
		);
		await Promise.all(pending.splice(0));
		await read(() => {
			if (
				getComputedStyle(document.documentElement)
					.getPropertyValue("--ui-color-accent")
					.trim() !== "rgb(10, 20, 30)"
			)
				throw new Error("Reload did not publish fresh CSS.");
			const saved = globalThis.__SHOWCASE_PROBE__;
			if (
				document.querySelector(".hud-window") !== saved.panel ||
				document.querySelector(".character-hud") !== saved.character ||
				JSON.stringify(saved.panel.getBoundingClientRect().toJSON()) !==
					saved.rect ||
				document.querySelector(".chat-panel input").value !==
					"A draft survives theme reload." ||
				document
					.querySelector('[role="option"]')
					.getAttribute("aria-selected") !== "true"
			)
				throw new Error("Theme reload reset production UI state.");
		});
		responseMode = "failure";
		await click("Reload theme");
		await wait(() =>
			Boolean(document.querySelector('.showcase-controls [role="alert"]')),
		);
		await Promise.all(pending.splice(0));
		await read(() => {
			if (
				getComputedStyle(document.documentElement)
					.getPropertyValue("--ui-color-accent")
					.trim() !== "rgb(10, 20, 30)"
			)
				throw new Error("Failed reload replaced the active theme.");
		});
	} finally {
		await client.send("Fetch.disable");
	}
	await click("Reload theme");
	await wait(
		() =>
			document.querySelector('.showcase-controls [role="status"]')
				?.textContent === "Theme reloaded.",
	);
	await read((baseline) => {
		if (
			getComputedStyle(document.documentElement)
				.getPropertyValue("--ui-color-accent")
				.trim() !== baseline
		)
			throw new Error("Theme retry did not restore the source stylesheet.");
		document.querySelector(".chat-panel input").focus();
	}, baseline);
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		text: "\r",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
	});
	await wait(() =>
		document
			.querySelector(".chat-buffer")
			.textContent.includes("A draft survives theme reload."),
	);
	await click("controls");
	const hud = await read(() => {
		globalThis.__SHOWCASE_BACKDROP_HUD__ =
			document.querySelector(".character-hud");
		return Boolean(globalThis.__SHOWCASE_BACKDROP_HUD__);
	});
	if (!hud) throw new Error("Missing HUD before backdrop switching.");
	for (const backdrop of [
		"grid",
		"stripes",
		"landscape",
		"bright",
		"dark",
		"image",
	]) {
		await read((value) => {
			const select = document.querySelector(".showcase-controls select");
			select.value = value;
			select.dispatchEvent(new Event("change", { bubbles: true }));
		}, backdrop);
	}
	await read(() => {
		const transfer = new DataTransfer();
		transfer.items.add(
			new File(
				[
					'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="green"/></svg>',
				],
				"viewport.svg",
				{ type: "image/svg+xml" },
			),
		);
		const input = document.querySelector('input[type="file"]');
		input.files = transfer.files;
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await wait(
		() => document.querySelector(".showcase-backdrop")?.naturalWidth === 64,
	);
	await read(() => {
		if (
			document.querySelector(".character-hud") !==
			globalThis.__SHOWCASE_BACKDROP_HUD__
		)
			throw new Error("Backdrop change remounted the HUD.");
		delete globalThis.__SHOWCASE_BACKDROP_HUD__;
		const select = document.querySelector(".showcase-controls select");
		select.value = "landscape";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await read(() => {
		delete globalThis.__SHOWCASE_PROBE__;
	});
	await click("Reset layout");
	await read(() => {
		const panel = document.querySelector('.hud-panel[aria-label="chat"]');
		const original = panel.style.cssText;
		try {
			// A wide, short chat exposes width-relative padding overflowing its grid row.
			panel.style.width = "820px";
			panel.style.height = "240px";
			const buffer = panel
				.querySelector(".chat-buffer")
				.getBoundingClientRect();
			const filters = panel
				.querySelector(".chat-filters")
				.getBoundingClientRect();
			const form = panel.querySelector("form").getBoundingClientRect();
			if (
				buffer.bottom > filters.top ||
				filters.bottom > form.top ||
				form.bottom > panel.getBoundingClientRect().bottom
			)
				throw new Error(
					"Chat messages overflow below their row into the input controls.",
				);
		} finally {
			panel.style.cssText = original;
		}
	});
	await read(() => {
		const select = document.querySelector(".showcase-controls select");
		select.value = "color";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await wait(() => Boolean(document.querySelector('input[type="color"]')));
	await read(() => {
		const picker = document.querySelector('input[type="color"]');
		picker.value = "#456789";
		picker.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await wait(
		() =>
			getComputedStyle(document.querySelector(".showcase-stage"))
				.backgroundColor === "rgb(69, 103, 137)",
	);
	await read(() => new Promise((resolve) => requestAnimationFrame(resolve)));
	await read((initial) => {
		const box = document.querySelector(".hud-window").getBoundingClientRect();
		if (
			box.x !== initial.x ||
			box.y !== initial.y ||
			box.width !== initial.width ||
			box.height !== initial.height
		)
			throw new Error("Reset did not restore the showcase window placement.");
	}, initial);
	return {
		productionComponents: true,
		noWorldRuntime: true,
		nativeWindowGestures: true,
		reloadedCss: true,
		preservedState: true,
		failedReloadRecovery: true,
		chatSend: true,
		backdropSwitching: true,
		responsiveLayout: true,
	};
}
