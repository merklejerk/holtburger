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
	const checkFooterLayout = async () => {
		const layout = await read(`(() => {
			const screen = document.querySelector('.client-pregame-screen');
			const footer = screen.querySelector('.pregame-footer');
			const bounds = footer.getBoundingClientRect();
			const content = screen.querySelector('.pregame-content').getBoundingClientRect();
			const previews = [...screen.querySelectorAll('.creature-preview')].map(preview => {
				const rect = preview.getBoundingClientRect();
				return {top: rect.top, bottom: rect.bottom, height: rect.height};
			});
			const structuralRegions = ['.pregame-content', '.creation-layout', '.creation-navigation', '.creation-preview', '.creation-editor', '.creation-settings', '.character-selection-content', '.character-preview-column'];
			const scrollRegions = structuralRegions.flatMap(selector => [...screen.querySelectorAll(selector)].flatMap(element => {
				const style = getComputedStyle(element);
				const horizontal = /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
				const vertical = /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
				return horizontal || vertical ? [{selector, horizontal, vertical, width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight}] : [];
			}));
			return {viewport: innerHeight, pageHeight: document.scrollingElement.scrollHeight, screenHeight: screen.getBoundingClientRect().height, contentHeight: content.height, contentTop: content.top, footerTop: bounds.top, footerBottom: bounds.bottom, footerHeight: bounds.height, previews, scrollRegions};
		})()`);
		assert.ok(
			layout.footerHeight > 0 &&
				layout.footerTop >= 0 &&
				layout.footerBottom <= layout.viewport + 1,
			JSON.stringify(layout),
		);
		assert.ok(layout.pageHeight <= layout.viewport + 1, JSON.stringify(layout));
		assert.deepEqual(layout.scrollRegions, [], JSON.stringify(layout));
		for (const preview of layout.previews) {
			assert.ok(
				preview.height > 0 &&
					preview.height <= layout.contentHeight + 1 &&
					preview.top >= layout.contentTop - 1 &&
					preview.bottom <= layout.footerTop + 1,
				JSON.stringify(layout),
			);
		}
	};
	// Exercise theme inputs rather than asserting the current default palette.
	const checkPregameTheme = async () => {
		const result = await read(`(async () => {
			const screen = document.querySelector('.client-pregame-screen');
			const primary = screen.querySelector('.enter-world, .pregame-primary');
			const shade = screen.querySelector('.character-roster, .creation-editor');
			const previous = screen.getAttribute('style');
			const bodyColor = getComputedStyle(document.body).color;
			const before = getComputedStyle(shade, '::before').backgroundImage;
			try {
				screen.style.setProperty('--ui-color-highlight', 'rgb(17, 183, 209)');
				screen.style.setProperty('--ui-font-heading', 'monospace');
				screen.style.setProperty('--pregame-primary-shadow', 'none');
				screen.style.setProperty('--pregame-backdrop-color', 'rgb(45 67 89 / 50%)');
				screen.style.setProperty('--pregame-editor-backdrop-color', 'rgb(45 67 89 / 50%)');
				// Palette changes use the shared button color transition.
				getComputedStyle(primary).color;
				await Promise.all(primary.getAnimations().map(animation => animation.finished));
				return {
					brand: getComputedStyle(screen.querySelector('.pregame-brand')).color,
					font: getComputedStyle(screen.querySelector('.pregame-brand')).fontFamily,
					primary: getComputedStyle(primary).color,
					shadow: getComputedStyle(primary).boxShadow,
					shadeChanged: getComputedStyle(shade, '::before').backgroundImage !== before,
					isolated: getComputedStyle(document.body).color === bodyColor,
				};
			} finally {
				if (previous === null) screen.removeAttribute('style');
				else screen.setAttribute('style', previous);
			}
		})()`);
		assert.deepEqual(result, {
			brand: "rgb(17, 183, 209)",
			font: "monospace",
			primary: "rgb(17, 183, 209)",
			shadow: "none",
			shadeChanged: true,
			isolated: true,
		});
	};
	const covered = async () => {
		await checkFooterLayout();
		assert.equal(
			await read(
				"document.querySelector('[aria-label=\"Build information\"]') === null",
			),
			true,
		);
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
	// Intercept only the configured loading timers so tuning changes never make this probe wait longer.
	await read(`(async () => {
		const { CLIENT_LOADING_TUNING: tuning } = await import('/src/client/client-tuning.ts');
		const native = { timeout: window.setTimeout, interval: window.setInterval, clearTimeout: window.clearTimeout, clearInterval: window.clearInterval };
		const idle = new Map();
		const rotation = new Map();
		let next = -1;
		window.setTimeout = (callback, delay, ...args) => {
			if (delay !== tuning.quipIdleDelayMs || typeof callback !== 'function') return native.timeout.call(window, callback, delay, ...args);
			const id = next--; idle.set(id, () => callback(...args)); return id;
		};
		window.setInterval = (callback, delay, ...args) => {
			if (delay !== tuning.quipIntervalMs || typeof callback !== 'function') return native.interval.call(window, callback, delay, ...args);
			const id = next--; rotation.set(id, () => callback(...args)); return id;
		};
		window.clearTimeout = id => { if (!idle.delete(id)) native.clearTimeout.call(window, id); };
		window.clearInterval = id => { if (!rotation.delete(id)) native.clearInterval.call(window, id); };
		globalThis.__LOADING_STATUS_CLOCK__ = {
			quips: tuning.quips,
			fireIdle() { for (const [id, callback] of [...idle]) { idle.delete(id); callback(); } },
			rotate() { for (const callback of rotation.values()) callback(); },
			read() { return { idle: idle.size, rotation: rotation.size }; },
			restore() {
				window.setTimeout = native.timeout; window.setInterval = native.interval;
				window.clearTimeout = native.clearTimeout; window.clearInterval = native.clearInterval;
				idle.clear(); rotation.clear(); delete globalThis.__LOADING_STATUS_CLOCK__;
			}
		};
	})()`);
	try {
		await read(`${api}.authenticate()`);
		await wait(
			"document.querySelector('.loading-message[role=status]')?.textContent.includes('Authenticating')",
		);
		assert.deepEqual(await read("globalThis.__LOADING_STATUS_CLOCK__.read()"), {
			idle: 1,
			rotation: 0,
		});
		await read("globalThis.__LOADING_STATUS_CLOCK__.fireIdle()");
		await wait(
			"document.querySelector('.loading-message.loading-flavor') !== null",
		);
		assert.equal(
			await read(
				"globalThis.__LOADING_STATUS_CLOCK__.quips.includes(document.querySelector('.loading-message').textContent)",
			),
			true,
		);
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
		await wait(
			"document.querySelector('.loading-message[role=status]')?.textContent.includes('Preparing scene')",
		);
		assert.deepEqual(await read("globalThis.__LOADING_STATUS_CLOCK__.read()"), {
			idle: 1,
			rotation: 0,
		});
		await read("globalThis.__LOADING_STATUS_CLOCK__.fireIdle()");
		await wait(
			"document.querySelector('.loading-message.loading-flavor') !== null",
		);
		await read("globalThis.__LOADING_STATUS_CLOCK__.rotate()");
		assert.equal(
			await read(
				"globalThis.__LOADING_STATUS_CLOCK__.quips.includes(document.querySelector('.loading-message').textContent)",
			),
			true,
		);
	} finally {
		await read("globalThis.__LOADING_STATUS_CLOCK__.restore()");
	}
	await read(`${api}.notify('Fixture loading update', 'status')`);
	await wait(
		"document.querySelector('.loading-message[role=status]')?.textContent === 'Fixture loading update'",
	);
	await read(`${api}.notify('Fixture loading warning', 'warning')`);
	await wait(
		"document.querySelector('.loading-message[role=alert]')?.textContent === 'Fixture loading warning'",
	);
	// Hold scene admission while checking real browser animation and reduced-motion behavior.
	try {
		await client.send("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
		});
		await wait(`(() => {
			const portal = document.querySelector('.scene-loading');
			const layers = portal?.querySelectorAll('[data-motion-layer]');
			return layers?.length > 0 && [...layers]
				.every(layer => layer.getAnimations().some(animation => animation.playState === 'running'));
		})()`);
		assert.equal(
			await read(`(() => {
			const ribbon = document.querySelector('.scene-loading .ribbon-back-body');
			const animation = ribbon.getAnimations()[0];
			animation.pause();
			animation.currentTime = 0;
			const start = getComputedStyle(ribbon).d;
			animation.currentTime = Number(animation.effect.getTiming().duration) / 4;
			const moved = getComputedStyle(ribbon).d;
			animation.play();
			return start.startsWith('path(') && start !== moved;
		})()`),
			true,
		);
		await client.send("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "reduce" }],
		});
		await wait(
			"document.querySelector('.scene-loading').getAnimations({ subtree: true }).length === 0",
		);
	} finally {
		await client.send("Emulation.setEmulatedMedia", { features: [] });
	}
	await physicalClick("Release scene");
	await wait(
		`${api} && ${visible} && document.querySelector('.client-character-list') !== null && !document.body.innerText.includes('Loading model')`,
	);
	await read(
		"globalThis.__PRESENTATION_PROOF_CANVAS__ = document.querySelector('.client-canvas'); true",
	);
	try {
		const selection = await read(`${api}.read()`);
		await checkPregameTheme();
		await checkFooterLayout();
		assert.match(
			await read(
				"document.querySelector('[aria-label=\"Build information\"]')?.textContent ?? ''",
			),
			/^DEV · v\S+ · [0-9a-f]{8,}(?: · modified)?$/,
		);
		assert.equal(
			await read("globalThis.__PRESENTATION_REPEATED_TIMESTAMP__"),
			true,
		);
		await read("document.querySelector('button[name=character]').focus()");
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
				`document.querySelectorAll('button[name=character]')[${index}].getAttribute("aria-pressed") === "true"`,
			);
		}

		await click("Create character");
		await wait(
			`${visible} && document.body.innerText.includes('Create a character')`,
		);
		await wait(
			"document.querySelector('.creation-settings select') !== null && document.querySelector('.creation-viewport .creature-preview-status') === null",
		);
		const creator = await read(`${api}.read()`);
		await checkPregameTheme();
		await checkFooterLayout();
		assert.equal(
			await read(
				"document.querySelector('[aria-label=\"Build information\"]') === null",
			),
			true,
		);
		assert.equal(
			await read(
				"document.querySelector('.pregame-footer').textContent.trim() === 'Back'",
			),
			true,
		);
		const snapshot = await client.send("DOMSnapshot.captureSnapshot", {
			computedStyles: [],
			includePaintOrder: true,
		});
		const { nodes, layout } = snapshot.documents[0];
		const paintOrder = (className) => {
			const node = nodes.attributes.findIndex((attributes) =>
				attributes.some(
					(value, index) =>
						index % 2 === 0 &&
						snapshot.strings[value] === "class" &&
						snapshot.strings[attributes[index + 1]]
							.split(/\s+/)
							.includes(className),
				),
			);
			const index = layout.nodeIndex.indexOf(node);
			assert.notEqual(index, -1, `Missing painted region: ${className}`);
			return layout.paintOrders[index];
		};
		const footerLayer = {
			footer: paintOrder("pregame-footer"),
			page: paintOrder("creation-layout"),
			backEnabled: await read(
				"!document.querySelector('.pregame-footer button').disabled",
			),
		};
		assert.equal(footerLayer.backEnabled, true);
		assert.ok(
			footerLayer.footer > footerLayer.page,
			JSON.stringify(footerLayer),
		);
		await read(`document.getElementById('creation-appearance-tab').focus()`);
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "ArrowDown",
			code: "ArrowDown",
			windowsVirtualKeyCode: 40,
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "ArrowDown",
			code: "ArrowDown",
			windowsVirtualKeyCode: 40,
		});
		await wait(
			"document.getElementById('creation-skills-stats-tab').getAttribute('aria-selected') === 'true' && document.activeElement.id === 'creation-skills-stats-tab'",
		);
		const formScroll = await read(`(() => {
			const panel = document.querySelector('.creation-settings .tab-panel:not([hidden])');
			const settings = document.querySelector('.creation-settings');
			const actions = document.querySelector('.creation-actions');
			const before = actions.getBoundingClientRect();
			panel.scrollTop = panel.scrollHeight;
			const after = actions.getBoundingClientRect();
			return {scrolled: panel.scrollTop > 0, stationary: before.top === after.top, separate: actions.closest('.creation-settings') === null, fillsSpace: Math.abs(settings.getBoundingClientRect().bottom - after.top) <= 1 && Math.abs(panel.getBoundingClientRect().height - settings.getBoundingClientRect().height) <= 1};
		})()`);
		assert.deepEqual(formScroll, {
			scrolled: true,
			stationary: true,
			separate: true,
			fillsSpace: true,
		});
		await read(
			"document.querySelector('.creation-actions .pregame-primary').click()",
		);
		await wait(
			"document.getElementById('creation-review-tab').getAttribute('aria-selected') === 'true'",
		);
		await click("Previous");
		await wait(
			"document.getElementById('creation-skills-stats-tab').getAttribute('aria-selected') === 'true'",
		);
		await click("Appearance");
		await click("Face");
		await click("Body");
		await physicalClick("Back");
		await wait(
			`${visible} && document.querySelector('.client-character-list') !== null`,
		);
		assert.equal(
			await read(
				`getComputedStyle(document.querySelector('button[name="character"][aria-pressed="true"]')).outlineStyle`,
			),
			"none",
		);
		assert.equal(
			await read(
				"document.querySelector('.character-preview-viewport .creature-preview').tabIndex",
			),
			-1,
		);
		for (const label of ["Enter World", "Create character", "Disconnect"]) {
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
			assert.equal(
				await read("document.activeElement.textContent.trim()"),
				label,
			);
		}
		const drag = await read(`(() => {
			const preview = document.querySelector('.character-preview-viewport .creature-preview');
			const bounds = preview.getBoundingClientRect();
			return {x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, before: preview.getAttribute('aria-valuenow')};
		})()`);
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			button: "left",
			buttons: 1,
			clickCount: 1,
			x: drag.x,
			y: drag.y,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			buttons: 1,
			x: drag.x + 40,
			y: drag.y,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			button: "left",
			buttons: 0,
			clickCount: 1,
			x: drag.x + 40,
			y: drag.y,
		});
		assert.notEqual(
			await read(
				"document.querySelector('.character-preview-viewport .creature-preview').getAttribute('aria-valuenow')",
			),
			drag.before,
		);
		assert.equal(
			await read(
				"document.activeElement === document.querySelector('.character-preview-viewport .creature-preview')",
			),
			false,
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
			`${visible} && document.querySelector('.client-character-list') !== null && !document.body.innerText.includes('Loading model')`,
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
			await read("document.querySelectorAll('button[name=character]').length"),
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
		assert.equal(
			await read("document.querySelector('.loading-flavor') === null"),
			true,
		);
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
			rosterKeyboardNavigation: true,
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
