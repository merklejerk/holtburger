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
            const name = screen.querySelector('.creation-name');
            const nameBefore = name === null ? null : getComputedStyle(name, '::before').background;
            const inputBefore = name === null ? null : getComputedStyle(name.querySelector('input')).backgroundColor;
			try {
				screen.style.setProperty('--ui-color-highlight', 'rgb(17, 183, 209)');
				screen.style.setProperty('--ui-font-heading', 'monospace');
				screen.style.setProperty('--pregame-primary-shadow', 'none');
                screen.style.setProperty('--pregame-name-background-color', 'rgb(24 48 72 / 80%)');
                screen.style.setProperty('--pregame-name-input-background', 'rgb(36 72 108 / 60%)');
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
                    nameThemed: name === null || (getComputedStyle(name, '::before').background !== nameBefore && getComputedStyle(name.querySelector('input')).backgroundColor !== inputBefore),
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
			nameThemed: true,
		});
	};
	const checkBuildInformation = async () => {
		assert.match(
			await read(
				"document.querySelector('[aria-label=\"Build information\"]')?.textContent ?? ''",
			),
			/^DEV · v\S+ · [0-9a-f]{8,}(?: · modified)?$/,
		);
	};
	const covered = async () => {
		await checkFooterLayout();
		await checkBuildInformation();
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
			"document.querySelector('.loading-message[role=status]')?.textContent.includes('Signing in')",
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
			"document.querySelector('.loading-message[role=status]')?.textContent.includes('Loading the world')",
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
		await checkBuildInformation();
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

		// Management belongs to each row and must not change the selected character.
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: 1,
			y: 1,
		});
		assert.equal(
			await read(
				`getComputedStyle(document.querySelectorAll('.character-row-action')[1]).visibility`,
			),
			"hidden",
		);
		const deletePoint = await read(`(() => {
            const button = document.querySelectorAll('.character-row-action')[1];
            const rect = button.getBoundingClientRect();
            return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
        })()`);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...deletePoint,
		});
		assert.equal(
			await read(
				`getComputedStyle(document.querySelectorAll('.character-row-action')[1]).visibility`,
			),
			"visible",
		);
		await read(`document.querySelectorAll('.character-row-action')[1].focus()`);
		assert.equal(
			await read(
				`getComputedStyle(document.querySelectorAll('.character-row-action')[1]).visibility`,
			),
			"visible",
		);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: 1,
			y: 1,
		});
		assert.equal(
			await read(
				`getComputedStyle(document.querySelectorAll('.character-row-action')[1]).visibility`,
			),
			"hidden",
		);
		await read(`document.querySelectorAll('.character-row-action')[1].click()`);
		await wait(
			`document.querySelector('.character-deletion-dialog')?.open === true`,
		);
		assert.equal(
			await read(
				`document.activeElement === document.querySelector('.character-deletion-form input')`,
			),
			true,
		);
		assert.equal(
			await read(
				`document.querySelector('button[name=character]').getAttribute('aria-pressed')`,
			),
			"true",
		);
		assert.equal(
			await read(
				`document.querySelector('.character-deletion-form button[type=submit]').disabled`,
			),
			true,
		);
		await read(`(() => {
            const input = document.querySelector('.character-deletion-form input');
            input.value = 'Wrong name'; input.dispatchEvent(new Event('input', {bubbles: true}));
        })()`);
		assert.equal(
			await read(
				`document.querySelector('.character-deletion-form button[type=submit]').disabled`,
			),
			true,
		);
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
		});
		await wait(`document.querySelector('.character-deletion-dialog') === null`);
		await read(`document.querySelectorAll('.character-row-action')[1].click()`);
		await wait(
			`document.querySelector('.character-deletion-dialog')?.open === true`,
		);
		assert.equal(
			await read(
				`document.activeElement === document.querySelector('.character-deletion-form input')`,
			),
			true,
		);
		assert.equal(
			await read(
				`document.querySelector('.character-deletion-form input').value`,
			),
			"",
		);
		await read(`(() => {
            const input = document.querySelector('.character-deletion-form input');
            input.value = '  NO SAVED APPEARANCE  '; input.dispatchEvent(new Event('input', {bubbles: true}));
        })()`);
		await wait(
			`!document.querySelector('.character-deletion-form button[type=submit]').disabled`,
		);
		assert.equal(
			await read(`(async () => {
            document.querySelector('.character-deletion-form button[type=submit]').click();
            await new Promise(resolve => setTimeout(resolve, 0));
            return document.querySelector('.client-character-list').disabled;
        })()`),
			true,
		);
		await wait(
			`document.querySelector('.character-deletion-dialog') === null && document.querySelector('.character-deletion-status') !== null`,
		);
		assert.equal(
			await read(
				`document.querySelector('.character-deletion-status time').dateTime.length > 0`,
			),
			true,
		);
		await read(
			`document.querySelectorAll('button[name=character]')[1].click()`,
		);
		assert.equal(
			await read(`document.querySelector('.enter-world').disabled`),
			true,
		);
		await read(
			`document.querySelector('button[aria-label="Restore No saved appearance"]').click()`,
		);
		await wait(
			`document.querySelector('.character-deletion-status') === null && !document.querySelector('.enter-world').disabled`,
		);
		await read(`document.querySelector('button[name=character]').click()`);

		await click("Create character");
		await wait(
			`${visible} && document.body.innerText.includes('Create a character')`,
		);
		await wait(
			"document.querySelector('.creation-settings select') !== null && document.querySelector('.creation-viewport .creature-preview-status') === null",
		);
		const creator = await read(`${api}.read()`);
		assert.equal(
			await read(
				"document.getElementById('creation-race-tab').getAttribute('aria-selected')",
			),
			"true",
		);

		assert.equal(
			await read(
				`Math.abs(document.querySelector('.creation-name').getBoundingClientRect().top - document.querySelector('.creation-editor-heading').getBoundingClientRect().top) < 1`,
			),
			true,
		);
		const previewBoundsBeforeNameError = await read(
			`document.querySelector('.creation-viewport').getBoundingClientRect().toJSON()`,
		);
		await read(`(() => {
            const name = document.querySelector('.creation-name input');
            name.value = 'Palette Tester1';
            name.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
		await wait(
			`document.querySelector('.creation-name input').getAttribute('aria-invalid') === 'true' && document.getElementById('creation-name-error') !== null`,
		);

		assert.deepEqual(
			await read(
				`document.querySelector('.creation-viewport').getBoundingClientRect().toJSON()`,
			),
			previewBoundsBeforeNameError,
		);

		assert.equal(
			await read(
				`document.querySelector('.creation-name-error-icon').title === document.getElementById('creation-name-error').textContent`,
			),
			true,
		);
		await click("Review");
		assert.equal(
			await read(
				`document.querySelector('button[form="creation-review-form"]').disabled`,
			),
			true,
		);
		await read(
			`document.getElementById('creation-review-form').requestSubmit()`,
		);
		assert.equal(
			await read(
				`document.querySelector('.creation-feedback').innerText.trim()`,
			),
			"",
		);
		await click("Race");
		await read(`(() => {
            const name = document.querySelector('.creation-name input');
            name.value = 'Palette Tester';
            name.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
		await wait(
			`document.querySelector('.creation-name input').getAttribute('aria-invalid') === 'false' && document.getElementById('creation-name-error') === null`,
		);

		assert.deepEqual(
			await read(
				`document.querySelector('.creation-viewport').getBoundingClientRect().toJSON()`,
			),
			previewBoundsBeforeNameError,
		);
		await click("Appearance");
		await wait(
			`document.querySelector('button[aria-label^="Skin color:"]') !== null`,
		);

		const paletteGeometry = await read(`(() => {
            // Fractional CSS pixels may differ after device-scale rounding.
            const tolerance = 1;
            return [...document.querySelectorAll('.palette-dropdown')].map(button => {
                const outer = button.getBoundingClientRect();
                const inner = button.querySelector('.palette-swatch').getBoundingClientRect();
                return {
                    square: Math.abs(outer.width - outer.height) < tolerance,
                    centered: Math.abs((inner.left + inner.right) - (outer.left + outer.right)) < tolerance && Math.abs((inner.top + inner.bottom) - (outer.top + outer.bottom)) < tolerance,
                    inset: inner.left > outer.left && inner.right < outer.right && inner.top > outer.top && inner.bottom < outer.bottom,
                };
            });
        })()`);
		assert.ok(paletteGeometry.length > 0);
		for (const geometry of paletteGeometry)
			assert.deepEqual(geometry, { square: true, centered: true, inset: true });
		await read(`(() => {
            const slider = document.querySelector('#creation-appearance input[type="range"]');
            slider.value = slider.max;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
		await wait(`(() => {
            const slider = document.querySelector('#creation-appearance input[type="range"]');
            const ordinal = Number(slider.max) + 1;
            return slider.getAttribute('aria-valuetext') === ordinal + ' of ' + ordinal;
        })()`);

		const readAppearanceControls = () =>
			read(`(() => {
            const panel = document.getElementById('creation-appearance');
            return {
                body: panel.querySelector('select').value,
                features: [...panel.querySelectorAll('input[type="range"]')].map(input => input.value),
                colors: [...panel.querySelectorAll('.palette-dropdown')].map(button => button.getAttribute('aria-label')),
            };
        })()`);
		const firstBodyControls = await readAppearanceControls();
		const secondBody = await read(`(() => {
            const select = document.querySelector('#creation-appearance select');
            return [...select.options].find(option => option.value !== select.value).value;
        })()`);
		const chooseBody = (value) =>
			read(`(() => {
            const select = document.querySelector('#creation-appearance select');
            select.value = ${JSON.stringify(value)};
            select.dispatchEvent(new Event('change', {bubbles: true}));
        })()`);
		await chooseBody(secondBody);
		await read(`(() => {
            const slider = document.querySelector('#creation-appearance input[type="range"]');
            slider.value = slider.max;
            slider.dispatchEvent(new Event('input', {bubbles: true}));
        })()`);
		const secondBodyControls = await readAppearanceControls();
		await chooseBody(firstBodyControls.body);
		assert.deepEqual(await readAppearanceControls(), firstBodyControls);
		await chooseBody(secondBody);
		assert.deepEqual(await readAppearanceControls(), secondBodyControls);
		await chooseBody(firstBodyControls.body);
		await click("Race");
		const firstRace = await read(
			`document.querySelector('#creation-race select').value`,
		);
		await read(`(() => {
            const select = document.querySelector('#creation-race select');
            select.value = [...select.options].find(option => option.value !== select.value).value;
            select.dispatchEvent(new Event('change', {bubbles: true}));
        })()`);
		await read(`(() => {
            const select = document.querySelector('#creation-race select');
            select.value = ${JSON.stringify(firstRace)};
            select.dispatchEvent(new Event('change', {bubbles: true}));
        })()`);
		await click("Appearance");
		assert.deepEqual(await readAppearanceControls(), firstBodyControls);
		await read(
			`document.querySelector('button[aria-label^="Skin color:"]').click()`,
		);
		await wait(
			`document.querySelector('[role="menu"][aria-label="Skin color"]') !== null`,
		);

		const paletteEntries = await read(`(() => {
            const tolerance = 1; // Allow fractional CSS-pixel rounding.
            return [...document.querySelectorAll('[role="menu"][aria-label="Skin color"] button')].map(button => {
                const cell = button.getBoundingClientRect();
                const swatch = button.querySelector('.palette-swatch').getBoundingClientRect();
                return {
                    square: Math.abs(cell.width - cell.height) < tolerance,
                    centered: Math.abs((swatch.left + swatch.right) - (cell.left + cell.right)) < tolerance && Math.abs((swatch.top + swatch.bottom) - (cell.top + cell.bottom)) < tolerance,
                    inset: swatch.left > cell.left && swatch.right < cell.right && swatch.top > cell.top && swatch.bottom < cell.bottom,
                };
            });
        })()`);
		assert.ok(paletteEntries.length > 0);
		for (const geometry of paletteEntries)
			assert.deepEqual(geometry, { square: true, centered: true, inset: true });
		const paletteTheme = await read(`(() => {
            const screen = document.querySelector('.client-pregame-screen');
            const previous = screen.getAttribute('style');
            try {
                screen.style.setProperty('--ui-menu-grid-icon-size', '32px');
                screen.style.setProperty('--ui-menu-grid-cell-size', '4rem');
                screen.style.setProperty('--ui-menu-grid-padding', '6px');
                const trigger = screen.querySelector('.palette-dropdown .palette-swatch').getBoundingClientRect();
                const menu = screen.querySelector('[role="menu"][aria-label="Skin color"]');
                const swatch = menu.querySelector('.palette-swatch').getBoundingClientRect();
                return { triggerWidth: trigger.width, menuWidth: swatch.width, padding: getComputedStyle(menu.querySelector('button')).paddingTop };
            } finally {
                if (previous === null) screen.removeAttribute('style');
                else screen.setAttribute('style', previous);
            }
        })()`);
		assert.deepEqual(paletteTheme, {
			triggerWidth: 32,
			menuWidth: 32,
			padding: "6px",
		});
		await read(
			`document.querySelector('[role="menu"][aria-label="Skin color"] button').click()`,
		);
		await wait(
			`document.querySelector('[role="menu"][aria-label="Skin color"]') === null`,
		);

		await read(
			`document.querySelector('button[aria-label^="Hair color:"]').click()`,
		);
		await wait(
			`document.querySelector('[role="menu"][aria-label="Hair color"]') !== null`,
		);
		assert.equal(
			await read(`(() => {
            const menu = document.querySelector('[role="menu"][aria-label="Hair color"]');
            const entries = [...menu.querySelectorAll('button')];
            const right = Math.max(...entries.map(entry => entry.getBoundingClientRect().right));
            const style = getComputedStyle(menu);
            const inset = parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth);
            return Math.abs(menu.getBoundingClientRect().right - right - inset) < 1;
        })()`),
			true,
		);
		await read(
			`document.querySelector('[role="menu"][aria-label="Hair color"] button').click()`,
		);
		await wait(
			`document.querySelector('[role="menu"][aria-label="Hair color"]') === null`,
		);
		await click("Randomize appearance");
		await wait(
			"document.querySelector('.creation-viewport .creature-preview-status') === null",
		);
		await click("Review");
		assert.equal(
			await read("document.querySelector('.creation-name input').value"),
			"Palette Tester",
		);
		assert.equal(
			await read("document.querySelector('.creation-summary dd').textContent"),
			"Palette Tester",
		);
		assert.equal(
			await read("document.querySelectorAll('.creation-summary dt').length"),
			12,
		);
		// A valid name does not bypass the unspent-attribute policy through form submission.
		assert.equal(
			await read(
				`document.querySelector('button[form="creation-review-form"]').disabled`,
			),
			true,
		);
		await read(
			`document.getElementById('creation-review-form').requestSubmit()`,
		);
		assert.equal(
			await read(
				`document.querySelector('.creation-feedback').innerText.trim()`,
			),
			"",
		);
		await click("Race");

		await checkPregameTheme();
		await checkFooterLayout();
		await checkBuildInformation();
		assert.equal(
			await read(
				"document.querySelector('.pregame-footer button').textContent.trim() === 'Back'",
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

		const skillTheme = await read(`(() => {
            const screen = document.querySelector('.client-pregame-screen');
            const label = screen.querySelector('.ui-stat-action-label');
            const before = getComputedStyle(label, '::before').backgroundImage;
            const previous = screen.getAttribute('style');
            try {
                screen.style.setProperty('--ui-color-shadow', 'rgb(35, 70, 105)');
                screen.style.setProperty('--ui-text-scale', '2');
                screen.style.setProperty('--ui-icon-scale', '1.5');
                return {
                    themedBackdrop: getComputedStyle(label, '::before').backgroundImage !== before,
                    overflowRows: [...screen.querySelectorAll('.creation-skill-row')].flatMap(row => {
                        const summary = row.querySelector('summary').getBoundingClientRect();
                        const actions = row.querySelector('.creation-skill-actions').getBoundingClientRect();
                        const bounds = row.getBoundingClientRect();
                        // Feathered backdrops intentionally overhang; measure the interactive bounds.
                        return summary.right <= actions.left + 1 && actions.right <= bounds.right + 1 ? [] : [{name: row.querySelector('summary').textContent, summaryRight: summary.right, actionsLeft: actions.left, actionsRight: actions.right, rowRight: bounds.right, scrollWidth: row.scrollWidth, clientWidth: row.clientWidth}];
                    }),
                    labelsFit: [...screen.querySelectorAll('.creation-skill-actions button')].every(button => {
                        const bounds = button.getBoundingClientRect();
                        const label = button.querySelector('.ui-stat-action-label').getBoundingClientRect();
                        return label.left >= bounds.left && label.right <= bounds.right;
                    }),
                };
            } finally {
                if (previous === null) screen.removeAttribute('style');
                else screen.setAttribute('style', previous);
            }
        })()`);
		assert.deepEqual(skillTheme, {
			themedBackdrop: true,
			overflowRows: [],
			labelsFit: true,
		});

		const attributeValues = await read(
			`[...document.querySelectorAll('#creation-skills-stats input[type="range"]')].map(input => input.value)`,
		);
		for (let index = 0; index < attributeValues.length; index++) {
			await read(`(() => {
                const input = document.querySelectorAll('#creation-skills-stats input[type="range"]')[${index}];
                input.value = input.max;
                input.dispatchEvent(new Event('input', {bubbles: true}));
            })()`);
		}
		assert.equal(
			await read(
				`document.getElementById('creation-attribute-credits').textContent.trim()`,
			),
			"0",
		);
		assert.equal(
			await read(
				`[...document.querySelectorAll('#creation-skills-stats input[type="range"]')].every(input => input.value === input.max)`,
			),
			true,
		);
		assert.equal(
			await read(
				`[...document.querySelectorAll('.creation-attribute-range')].every(input => input.classList.contains('exhausted') && !input.disabled)`,
			),
			true,
		);
		await read(`(() => {
            const input = [...document.querySelectorAll('.creation-attribute-range')].find(input => Number(input.value) > Number(input.min));
            input.value = String(Number(input.value) - 1);
            input.dispatchEvent(new Event('input', {bubbles: true}));
        })()`);
		assert.equal(
			await read(
				`Number(document.getElementById('creation-attribute-credits').textContent.trim())`,
			),
			1,
		);
		assert.equal(
			await read(
				`document.querySelector('.creation-attribute-range.exhausted') === null`,
			),
			true,
		);
		for (let index = 0; index < attributeValues.length; index++) {
			await read(`(() => {
                const input = document.querySelectorAll('#creation-skills-stats input[type="range"]')[${index}];
                input.value = ${JSON.stringify(attributeValues[index])};
                input.dispatchEvent(new Event('input', {bubbles: true}));
            })()`);
		}
		const readCredits = () =>
			read(
				`Number(document.getElementById('creation-skill-credits').textContent.trim())`,
			);
		const originalCredits = await readCredits();
		const originalTraining = await read(
			`[...document.querySelectorAll('.creation-skill-row')].map(row => ({name: row.querySelector('summary').textContent.trim(), training: Number(row.closest('section').getAttribute('aria-labelledby').split('-').at(-1))}))`,
		);
		let spentCredits = 0;
		while (
			await read(
				`document.querySelector('.creation-skill-actions button[data-direction="up"]:not(:disabled)') !== null`,
			)
		) {
			const charge = await read(`(() => {
                const button = document.querySelector('.creation-skill-actions button[data-direction="up"]:not(:disabled)');
                const cost = Number(button.textContent.trim());
                button.click();
                return cost;
            })()`);
			spentCredits += charge;
			assert.equal(await readCredits(), originalCredits - spentCredits);
			assert.ok((await readCredits()) >= 0);
		}
		let skillMoves = 0;
		while (
			await read(`(() => {
            const original = ${JSON.stringify(originalTraining)};
            return [...document.querySelectorAll('.creation-skill-row')].some(row => Number(row.closest('section').getAttribute('aria-labelledby').split('-').at(-1)) > original.find(entry => entry.name === row.querySelector('summary').textContent.trim()).training);
        })()`)
		) {
			await read(`(() => {
                const original = ${JSON.stringify(originalTraining)};
                const row = [...document.querySelectorAll('.creation-skill-row')].find(row => Number(row.closest('section').getAttribute('aria-labelledby').split('-').at(-1)) > original.find(entry => entry.name === row.querySelector('summary').textContent.trim()).training);
                const button = row.querySelector('button[data-direction="down"]');
                if (button.disabled) throw new Error('Purchased tier cannot be refunded');
                button.click();
            })()`);
			skillMoves++;
		}
		assert.ok(skillMoves > 0);
		assert.equal(await readCredits(), originalCredits);
		assert.equal(
			await read(`(() => {
            const details = [...document.querySelectorAll('.creation-skill-row details')].find(details => details.querySelector('.ui-mono') !== null);
            details.open = true;
            return details.querySelector('.creation-skill-description p').textContent.trim().length > 0 && details.querySelector('.ui-mono').textContent.trim().startsWith('Formula: ');
        })()`),
			true,
		);
		const formScroll = await read(`(() => {
            const panel = document.querySelector('.creation-settings .tab-panel:not([hidden])');
            const settings = document.querySelector('.creation-settings');
            const footer = document.querySelector('.creation-build-balances');
            const feedback = document.querySelector('.creation-feedback');
            const actions = document.querySelector('.creation-actions');
            const before = actions.getBoundingClientRect();
            const footerBefore = footer.getBoundingClientRect();
            panel.scrollTop = panel.scrollHeight;
            const after = actions.getBoundingClientRect();
            const footerAfter = footer.getBoundingClientRect();
            return {
                scrolled: panel.scrollTop > 0,
                stationary: before.top === after.top,
                separate: actions.closest('.creation-settings') === null,
                footerStationary: footerBefore.top === footerAfter.top,
                footerOutsideScroll: !panel.contains(footer),
                footerAboveActions: footerAfter.bottom <= after.top,
                fillsSpace: Math.abs(settings.getBoundingClientRect().bottom - after.top) <= 1 && Math.abs(panel.getBoundingClientRect().height + feedback.getBoundingClientRect().height - settings.getBoundingClientRect().height) <= 1,
            };
        })()`);
		assert.deepEqual(formScroll, {
			scrolled: true,
			stationary: true,
			separate: true,
			footerStationary: true,
			footerOutsideScroll: true,
			footerAboveActions: true,
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
				await read(
					"document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent.trim()",
				),
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
		// CDP must carry the held button through the move to preserve native pointer capture.
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			button: "left",
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
		for (const type of ["keyDown", "keyUp"])
			await client.send("Input.dispatchKeyEvent", {
				type,
				key: "Escape",
				code: "Escape",
			});
		await wait(
			"document.querySelector('[role=menu][aria-label=System]') !== null",
		);
		for (const type of ["keyDown", "keyUp"])
			await client.send("Input.dispatchKeyEvent", {
				type,
				key: "Escape",
				code: "Escape",
			});
		await wait(
			"document.querySelector('[role=menu][aria-label=System]') === null",
		);
		await read(`${api}.holdRetirement()`);
		await read(`document.querySelector('[aria-label="System menu"]').click()`);
		await click("Return to main menu");
		await wait(`${api}.read().logoutRequests === 1`);
		await wait(
			`${api}.read().gates.retirement.waiting > 0 && document.querySelector('.client-loading-page') !== null`,
		);
		await covered();
		assert.equal(
			await read(
				"document.querySelector('.client-pregame-screen.hero-brand') === null",
			),
			true,
		);
		assert.equal(
			await read("document.querySelector('.loading-status-icon') === null"),
			true,
		);
		for (const tone of ["status", "warning"]) {
			await read(
				`${api}.notify('You have left the LFG channel.', ${JSON.stringify(tone)})`,
			);
			await wait(
				"document.querySelector('.loading-message[role=status]')?.textContent.trim() === 'Returning to character selection…'",
			);
		}
		await read(`${api}.releaseRetirement()`);
		await wait(
			`${visible} && document.querySelector('.client-character-list') !== null && !document.body.innerText.includes('Loading model')`,
		);
		const returned = await read(
			`({...${api}.read(), sameCanvas: document.querySelector('.client-canvas') === globalThis.__PRESENTATION_PROOF_CANVAS__})`,
		);
		assert.equal(returned.sameCanvas, true);
		// A second character entry uses the retained session and renderer context.
		await click("Enter World");
		await wait(
			`${api}.read().portalReveals === 2 && ${visible} && document.querySelector('.client-world') !== null`,
		);
		await read(`${api}.holdRetirement()`);
		await read(`document.querySelector('[aria-label="System menu"]').click()`);
		await click("Disconnect");
		await wait(`${api}.read().gates.retirement.waiting > 0`);
		assert.equal(
			await read("document.querySelector('h1')?.textContent"),
			"Disconnecting",
		);
		assert.equal((await read(`${api}.read()`)).disconnectRequests, 0);
		await read(`${api}.releaseRetirement()`);
		await wait("document.querySelector('h1')?.textContent === 'Disconnected'");
		assert.equal((await read(`${api}.read()`)).disconnectRequests, 1);
		await checkBuildInformation();
		assert.equal(
			await read(
				"document.querySelector('.loading-content button.pregame-primary')?.textContent.trim()",
			),
			"Quit application",
		);
		assert.equal(
			await read("document.querySelector('.pregame-footer button') === null"),
			true,
		);
		assert.equal(
			await read("document.querySelector('.loading-details') === null"),
			true,
		);
		assert.equal(
			await read("document.querySelector('.scene-loading') === null"),
			true,
		);
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
			"Signing in",
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
			"document.querySelector('.client-loading-page [role=alert]')?.textContent.includes('The game world could not be loaded')",
		);
		await covered();
		assert.equal(
			await read("document.querySelector('.loading-flavor') === null"),
			true,
		);
		assert.deepEqual(await read(`${api}.read().expectedErrors`), [
			"Presentation fixture: scene failed",
		]);
		await click("Try again");
		await wait(
			`${visible} && document.querySelector('.client-character-list') !== null`,
		);
		assert.equal((await read(`${api}.read()`)).worldContextRequests, 1);

		await reload();
		await read(`${api}.failConnection()`);
		await wait(
			"document.querySelector('.client-loading-page [role=alert]')?.textContent.includes('The client could not start')",
		);
		await covered();
		assert.equal(
			await read(
				"document.querySelector('.loading-details:not([open]) pre').textContent",
			),
			"Presentation fixture: connection failed",
		);
		await click("Disconnect");
		await wait(
			"document.querySelector('h1')?.textContent === 'Session ended with errors'",
		);
		await checkBuildInformation();
		assert.equal(
			await read(
				"document.querySelector('.loading-content button.pregame-primary')?.textContent.trim()",
			),
			"Quit application",
		);
		assert.equal(
			await read("document.querySelector('.pregame-footer button') === null"),
			true,
		);
		assert.equal(
			await read(
				"document.querySelector('.loading-details')?.textContent.includes('Presentation fixture: connection failed')",
			),
			true,
		);
		await read(`${api}.releaseScene()`);
		await wait(`${api}.read().sceneResponses > 0`);
		await read(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
		await covered();
		await reload();
		await read(`${api}.releaseConnection(); ${api}.releaseScene()`);
		await wait(
			`${visible} && document.querySelector('.client-character-list') !== null`,
		);
		await click("Enter World");
		await wait(
			`${api}.read().portalReveals === 1 && ${visible} && document.querySelector('.client-world') !== null`,
		);
		await read(`${api}.holdCaptureStaging(); ${api}.publishCapture()`);
		await wait(`${api}.read().gates.captures.waiting > 0`);
		await read(`${api}.failSession()`);
		await wait(
			"document.querySelector('h1')?.textContent === 'Connection lost'",
		);
		assert.equal(
			await read(
				"document.querySelector('.loading-message[role=alert]')?.textContent.trim()",
			),
			"The server closed the connection for maintenance.",
		);
		await read("document.querySelector('.loading-details summary').click()");
		assert.equal(
			await read(
				"document.querySelector('.loading-details[open] pre').innerText.includes('Diagnostic: The server closed the connection for maintenance.')",
			),
			true,
		);
		assert.equal(
			await read(
				"document.querySelector('.client-loading-page').textContent.includes('Last session phase: in world')",
			),
			true,
		);
		assert.equal(
			await read("document.querySelector('.scene-loading') === null"),
			true,
		);
		await read(`${api}.beginClose()`);
		await read(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
		assert.equal((await read(`${api}.read()`)).closeResult, null);
		await read(`${api}.releaseCaptureStaging()`);
		await wait(`${api}.read().closeResult?.kind === 'prepared'`);
		await read(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
		await covered();
		// Quit must retire the whole composition even while pregame content is still loading.
		await reload();
		await read(`${api}.releaseConnection()`);
		await wait(`${api}.read().gates.scene.waiting > 0`);
		await read(`${api}.beginClose()`);
		await read(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
		await read(`${api}.releaseScene()`);
		await wait(`${api}.read().closeResult?.kind === 'prepared'`);
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
			systemMenuEscape: true,
			characterReentry: true,
			connectionLossDiagnostic: true,
			captureDrainedBeforeClose: true,
			quitDuringPregameLoading: true,
			pregameBuildInformation: true,
			centeredQuitAction: true,
			lightweightCharacterReturn: true,
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
