import assert from "node:assert/strict";

/** Native browser input against production chat, wheel, modality, and synthetic queue boundary. */
export async function probeClientEmotes(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const evaluate = (expression) => evaluateExpression(client, expression);
	const settle = () =>
		evaluate(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	const read = () => evaluate(`JSON.parse(JSON.stringify(${api}.chat.read()))`);
	const reset = async () => {
		await evaluate(`${api}.chat.reset()`);
		await settle();
	};
	const open = () =>
		evaluate("document.querySelector('.client-emote-dialog') !== null");
	const click = async (selector, text) => {
		const point = await evaluate(`(() => {
			const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${text === undefined ? "true" : `e.textContent.trim() === ${JSON.stringify(text)}`});
			if (!element) throw new Error('Emote control missing: ' + ${JSON.stringify(text ?? selector)});
			const r = (element.querySelector(".emote-label") ?? element).getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2};
		})()`);
		for (const type of ["mousePressed", "mouseReleased"])
			await client.send("Input.dispatchMouseEvent", {
				type,
				button: "left",
				clickCount: 1,
				...point,
			});
		await settle();
	};
	const key = async (type, value, code, vk, extra = {}) => {
		await client.send("Input.dispatchKeyEvent", {
			type,
			key: value,
			code,
			windowsVirtualKeyCode: vk,
			...(type === "keyDown" && value === "Enter" ? { text: "\r" } : {}),
			...extra,
		});
		await settle();
	};
	const press = async (value, code, vk) => {
		await key("keyDown", value, code, vk);
		await key("keyUp", value, code, vk);
	};
	const holdWheel = async () => {
		await key("keyUp", "t", "KeyT", 84);
		await key("keyDown", "t", "KeyT", 84);
	};
	const draft = async (text) => {
		await click('input[aria-label="Chat message"]');
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "a",
			code: "KeyA",
			windowsVirtualKeyCode: 65,
			modifiers: 2,
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "a",
			code: "KeyA",
			windowsVirtualKeyCode: 65,
		});
		await press("Backspace", "Backspace", 8);
		await client.send("Input.insertText", { text });
		await settle();
	};
	try {
		await reset();
		await press("Escape", "Escape", 27);
		await holdWheel();
		await press("Home", "Home", 36);
		const emptyRecent = await evaluate(`(() => {
			const wheel = document.querySelector('.emote-wheel');
			const wedge = [...wheel.querySelectorAll('button')].find(e => e.textContent.trim() === 'Recent');
			if (!wedge?.disabled) throw new Error('Empty Recent must be disabled');
			const rect = wedge.querySelector('.emote-label').getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, active: wheel.getAttribute('aria-activedescendant') };
		})()`);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: emptyRecent.x,
			y: emptyRecent.y,
		});
		await settle();
		assert.equal(
			await evaluate(
				"document.querySelector('.emote-wheel').getAttribute('aria-activedescendant')",
			),
			emptyRecent.active,
			"Hovering disabled Recent cannot select it",
		);
		await click(".emote-wheel [role=menuitem]", "Recent");
		assert.equal(
			await open(),
			true,
			"Disabled wedge clicks must not dismiss the wheel",
		);
		assert.equal(
			await evaluate(
				"document.querySelector('.emote-wheel').getAttribute('aria-label')",
			),
			"Emotes · Choose a category",
		);
		assert.equal((await read()).requests.length, 0);
		await key("keyUp", "t", "KeyT", 84);
		await draft("/lo");
		await press("Tab", "Tab", 9);
		assert.equal(
			await evaluate(
				`document.querySelector('input[aria-label="Chat message"]').value`,
			),
			"/loc ",
			"Tab inserts a command without submitting",
		);
		assert.equal((await read()).requests.length, 0);
		await draft("@te");
		await press("ArrowDown", "ArrowDown", 40);
		await press("Enter", "Enter", 13);
		assert.equal(
			await evaluate(
				`document.querySelector('input[aria-label="Chat message"]').value`,
			),
			"@tellselected ",
			"Arrow navigation and Enter accept the selected command",
		);
		assert.equal((await read()).requests.length, 0);
		await draft("@ls");
		await click(".chat-completions [role=option]");
		assert.equal(
			await evaluate(
				`document.querySelector('input[aria-label="Chat message"]').value`,
			),
			"@ls ",
			"Pointer acceptance preserves the command alias and prefix",
		);
		assert.equal(
			await evaluate(
				`document.activeElement === document.querySelector('input[aria-label="Chat message"]')`,
			),
			true,
		);
		assert.equal((await read()).requests.length, 0);
		await draft("*wav");
		assert.equal(
			await evaluate(
				"document.querySelectorAll('.chat-completions [role=option]').length",
			),
			1,
		);
		await press("Enter", "Enter", 13);
		assert.equal(
			await evaluate(
				"document.querySelector('input[aria-label=\"Chat message\"]').value",
			),
			"*wave*",
		);
		assert.equal((await read()).requests.length, 0);
		await press("Enter", "Enter", 13);
		assert.deepEqual((await read()).requests, [
			{ kind: "soul-emote", token: "wave" },
		]);
		await draft("*wav");
		const beforePointer = (await read()).requests.length;
		await click(".chat-completions [role=option]");
		assert.equal(
			await evaluate(
				`document.querySelector('input[aria-label="Chat message"]').value`,
			),
			"*wave*",
			"Pointer completion retains the editor until its click commits",
		);
		assert.equal(
			await evaluate(
				`document.activeElement === document.querySelector('input[aria-label="Chat message"]')`,
			),
			true,
		);
		assert.equal(
			(await read()).requests.length,
			beforePointer,
			"Pointer completion does not submit",
		);
		await draft("Hello *HI*");
		await press("Enter", "Enter", 13);
		assert.deepEqual((await read()).requests.slice(-2), [
			{ kind: "soul-emote", token: "HI" },
			{ kind: "speech", message: "Hello" },
		]);
		assert.deepEqual((await read()).recentEmotes, ["wave"]);
		await draft("*warm h");
		await press("Tab", "Tab", 9);
		await press("Enter", "Enter", 13);
		assert.deepEqual((await read()).recentEmotes, ["warmhands", "wave"]);
		await evaluate(`${api}.chat.restart()`);
		await settle();
		assert.deepEqual(
			(await read()).recentEmotes,
			["warmhands", "wave"],
			"Recent restores from user settings when the composer restarts",
		);
		await draft("Hello *wav* friend");
		await evaluate(
			`document.querySelector('input[aria-label="Chat message"]').setSelectionRange(10, 10)`,
		);
		await settle();
		await press("Tab", "Tab", 9);
		assert.equal(
			await evaluate(
				`document.querySelector('input[aria-label="Chat message"]').value`,
			),
			"Hello *wave* friend",
			"Completion replaces only the active span",
		);
		await press("Escape", "Escape", 27);
		await draft("*wav");
		const beforeComposition = (await read()).requests.length;
		await client.send("Input.imeSetComposition", {
			text: "な",
			selectionStart: 1,
			selectionEnd: 1,
		});
		await settle();
		await evaluate(
			`document.querySelector('input[aria-label="Chat message"]').form.requestSubmit()`,
		);
		await settle();
		assert.equal(
			(await read()).requests.length,
			beforeComposition,
			"Composition cannot submit chat",
		);
		await client.send("Input.insertText", { text: "な" });
		await press("Escape", "Escape", 27);
		await reset();
		await draft("Hello *wave*");
		await evaluate(`${api}.chat.rejectAfter(1)`);
		await press("Enter", "Enter", 13);
		assert.deepEqual((await read()).requests, [
			{ kind: "soul-emote", token: "wave" },
		]);
		assert.equal(
			await evaluate(
				`document.querySelector('input[aria-label="Chat message"]').value`,
			),
			"",
			"A partial queue retires its draft",
		);
		assert.equal(
			await evaluate(
				`document.querySelector('.chat-buffer').textContent.includes('Queued 1 of 2')`,
			),
			true,
		);

		await draft("typing");
		await press("t", "KeyT", 84);
		assert.equal(await open(), false, "Editor owns activation keys");
		await press("Escape", "Escape", 27);
		await holdWheel();
		assert.equal(await open(), true);
		assert.equal((await read()).inputAllowed, false);
		assert.equal(
			await evaluate(`(() => {
            const wheel = document.querySelector('.emote-wheel');
            const rect = wheel.getBoundingClientRect();
            if (Math.abs(rect.width - rect.height) > 1) throw new Error('Wheel must remain circular');
            const hit = (angle, radius) => document.elementFromPoint(rect.left + rect.width * (0.5 + radius * Math.cos(angle)), rect.top + rect.height * (0.5 + radius * Math.sin(angle)));
            const wedges = [...wheel.querySelectorAll('[role=menuitem]')];
            for (let index = 0; index < wedges.length; index++) {
                if (wedges[index].disabled) continue;
                const angle = index * 2 * Math.PI / wedges.length - Math.PI / 2;
                if (hit(angle, 0.46)?.closest('[role=menuitem]') !== wedges[index]) throw new Error('Outer arc must be clickable throughout its wedge');
            }
            if (!hit(0, 0)?.closest('.emote-center')) throw new Error('Section label must remain centered');
            if (hit(-Math.PI / 3, 0.375)?.closest('[role=menuitem]')) throw new Error('Segment gaps must not select a neighboring wedge');
            const gapWidth = radius => {
                const angle = -Math.PI / 3;
                let empty = 0;
                for (let offset = -12; offset <= 12; offset += 0.25) {
                    const x = rect.left + rect.width * (0.5 + radius * Math.cos(angle)) - offset * Math.sin(angle);
                    const y = rect.top + rect.height * (0.5 + radius * Math.sin(angle)) + offset * Math.cos(angle);
                    if (!document.elementFromPoint(x, y)?.closest('[role=menuitem]')) empty += 0.25;
                }
                return empty;
            };
            if (Math.abs(gapWidth(0.30) - gapWidth(0.45)) > 1) throw new Error('Wedge gaps must have constant width across the ring');
            const glass = getComputedStyle(wedges[0]);
            if (glass.backdropFilter === 'none') throw new Error('Wedges must use the shared frosted backdrop');
            const pixel = document.createElement('canvas').getContext('2d');
            if (!pixel) throw new Error('Browser color normalization requires a 2D context');
            pixel.fillStyle = glass.backgroundColor;
            pixel.fillRect(0, 0, 1, 1);
            const alpha = pixel.getImageData(0, 0, 1, 1).data[3];
            if (alpha <= 0 || alpha >= 255) throw new Error('Frosted wedge background must be translucent');

            return true;
        })()`),
			true,
		);

		await evaluate(`(() => {
			const override = document.createElement('style');
			override.id = 'emote-theme-probe';
			override.textContent = '@layer overrides { .client-emote-dialog { --ui-emote-wheel-size: 280px; --ui-emote-wheel-highlight-background: rgb(21, 43, 65); --ui-emote-wheel-highlight-scale: 1.07; --ui-emote-wheel-transition-duration: 0s; } }';
			document.head.append(override);
		})()`);
		try {
			await press("Home", "Home", 36);
			assert.equal(
				await evaluate(`(() => {
				const wheel = document.querySelector('.emote-wheel');
				const wedge = wheel.querySelector('.highlighted');
				const style = getComputedStyle(wedge);
				if (getComputedStyle(wheel).width !== '280px') throw new Error('Wheel ignored theme size');
				if (style.backgroundColor !== 'rgb(21, 43, 65)') throw new Error('Wheel ignored themed highlight backing');
				if (style.transform !== 'matrix(1.07, 0, 0, 1.07, 0, 0)') throw new Error('Wheel ignored themed highlight scale');
				if (!style.transitionDuration.split(',').every(value => value.trim() === '0s')) throw new Error('Wheel ignored themed transition duration');
				return true;
			})()`),
				true,
			);
		} finally {
			await evaluate("document.getElementById('emote-theme-probe').remove()");
			await settle();
		}

		await click(".emote-center-label");
		assert.equal(
			await open(),
			true,
			"The passive root label does not dismiss the wheel",
		);

		const count = (await read()).requests.length;
		await click(".emote-wheel [role=menuitem]", "Greetings");
		assert.equal(
			await evaluate(
				"document.querySelector('.emote-wheel').getAttribute('aria-label')",
			),
			"Emotes · Greetings",
		);
		assert.equal(
			await evaluate(
				"[...document.querySelectorAll('.emote-wheel button')].find(e=>e.textContent.trim()==='curtsey').disabled",
			),
			true,
		);
		assert.equal((await read()).requests.length, count);
		await click(".emote-center-label");
		assert.equal(
			await evaluate(
				"document.querySelector('.emote-wheel').getAttribute('aria-label')",
			),
			"Emotes · Greetings",
			"The section label is passive inside a subwheel",
		);
		await click(".emote-back");
		assert.equal(await open(), true, "Center Back retains the open wheel");
		assert.equal(
			await evaluate(
				"document.querySelector('.emote-wheel').getAttribute('aria-label')",
			),
			"Emotes · Choose a category",
		);
		assert.equal((await read()).requests.length, count);
		// Every curated category and Recent uses the center action, leaving every wedge for emotes.
		const categories = await evaluate(
			"[...document.querySelectorAll('.emote-wedge:not(:disabled)')].map(e => e.textContent.trim())",
		);
		for (const category of categories) {
			await click(".emote-wheel [role=menuitem]", category);
			assert.equal(
				await evaluate(
					"document.querySelector('.emote-back').getAttribute('aria-label')",
				),
				"Back to emote categories",
			);
			if (category === "Recent")
				assert.equal(
					await evaluate("document.querySelectorAll('.emote-wedge').length"),
					(await read()).recentEmotes.length,
					"Recent dedicates one wedge to each saved emote",
				);
			await click(".emote-back");
			assert.equal(
				await evaluate(
					"document.querySelector('.emote-wheel').getAttribute('aria-label')",
				),
				"Emotes · Choose a category",
			);
		}
		assert.equal((await read()).requests.length, count);
		await click(".emote-wheel [role=menuitem]", "Greetings");
		await click(".emote-wheel [role=menuitem]", "Wave");
		assert.equal(await open(), false);
		assert.equal((await read()).inputAllowed, true);
		assert.equal((await read()).gameActive, true);
		assert.equal((await read()).requests.length, count + 1);
		await holdWheel();
		assert.equal(await open(), true, "Configured activation opens wheel");
		const highlighted = () =>
			evaluate(
				`document.querySelector('.emote-wheel').getAttribute('aria-activedescendant')`,
			);
		for (const [letter, code, vk, arrow, arrowCode] of [
			["w", "KeyW", 87, "ArrowUp", 38],
			["a", "KeyA", 65, "ArrowLeft", 37],
			["s", "KeyS", 83, "ArrowDown", 40],
			["d", "KeyD", 68, "ArrowRight", 39],
		]) {
			await press("Home", "Home", 36);
			await press(arrow, arrow, arrowCode);
			const expected = await highlighted();
			await press("Home", "Home", 36);
			await press(letter, code, vk);
			assert.equal(
				await highlighted(),
				expected,
				`${letter.toUpperCase()} navigates like ${arrow}`,
			);
		}
		const beforeRelease = (await read()).requests.length;
		await key("keyDown", "t", "KeyT", 84, { autoRepeat: true });
		assert.equal(
			await open(),
			true,
			"Holding the activation key never reopens or toggles the wheel",
		);
		await key("keyUp", "t", "KeyT", 84, { modifiers: 8 });
		assert.equal(
			await open(),
			false,
			"Physical release dismisses even if modifiers changed",
		);
		assert.equal(
			(await read()).requests.length,
			beforeRelease,
			"Release never selects an emote",
		);
		await press("t", "KeyT", 84);
		assert.equal(await open(), false, "A tap cannot leave a latched wheel");
		await holdWheel();

		await click(".emote-wheel [role=menuitem]", "Recent");
		await press("Escape", "Escape", 27);
		assert.equal(await open(), true);
		await press("Escape", "Escape", 27);
		assert.equal(await open(), false);
		await holdWheel();
		await evaluate("window.dispatchEvent(new Event('blur'))");
		await settle();
		assert.equal(await open(), false);
		assert.equal((await read()).inputAllowed, true);
		await holdWheel();
		await reset();
		assert.equal(await open(), false, "Character generation retires wheel");
		await holdWheel();
		await evaluate(`${api}.chat.professorPrompt()`);
		await settle();
		assert.equal(await open(), false, "A new modal retires the wheel");
		await evaluate(`${api}.chat.clearPrompt()`);
		await settle();
		await holdWheel();
		for (const type of ["mousePressed", "mouseReleased"])
			await client.send("Input.dispatchMouseEvent", {
				type,
				button: "left",
				clickCount: 1,
				x: 1,
				y: 1,
			});
		await settle();
		assert.equal(await open(), false);
		assert.equal((await read()).requests.length, 0);
		await holdWheel();
		await evaluate("window.dispatchEvent(new Event('resize'))");
		await settle();
		assert.equal(await open(), false, "Resize retires the wheel");
		await holdWheel();
		await evaluate(`${api}.chat.setEmotesEnabled(false)`);
		await settle();
		assert.equal(await open(), false, "World lifecycle loss retires the wheel");
		await evaluate(`${api}.chat.setEmotesEnabled(true)`);
		await settle();
		await holdWheel();
		await press("Home", "Home", 36);
		await press("Enter", "Enter", 13);
		await press("Home", "Home", 36);
		await key("keyDown", "Enter", "Enter", 13, { autoRepeat: true });
		await key("keyUp", "Enter", "Enter", 13);
		assert.equal(
			(await read()).requests.length,
			0,
			"Repeated confirmation cannot execute a leaf",
		);
		await press("Enter", "Enter", 13);
		assert.equal(
			(await read()).requests.length,
			1,
			"A fresh confirmation executes once",
		);
		await reset();
		await holdWheel();
		await press("Home", "Home", 36);
		await press(" ", "Space", 32);
		await press("Home", "Home", 36);
		await press(" ", "Space", 32);
		assert.equal(
			(await read()).requests.length,
			1,
			"Space confirms a leaf once while activation remains held",
		);
		await key("keyUp", "t", "KeyT", 84);
		assert.equal(
			await open(),
			false,
			"Releasing after selection cannot reopen the wheel",
		);
		await reset();

		// The existing keyboard fixture owns a real production controller, including held-key cancellation.
		await evaluate(`${api}.beginKeyboardProbe()`);
		await settle();
		await click("#keyboard-viewport");
		await key("keyDown", "w", "KeyW", 87);
		assert.equal(
			(await evaluate(`${api}.keyboardProbe().capture()`)).movement.forward,
			1,
		);
		await holdWheel();
		assert.equal(await open(), true);
		const blocked = await evaluate(`${api}.keyboardProbe().capture()`);
		assert.equal(blocked.movement.forward, 0);
		assert.equal(blocked.pointerAllowed, false);
		await key("keyUp", "w", "KeyW", 87);
		for (const [letter, code, vk] of [
			["w", "KeyW", 87],
			["a", "KeyA", 65],
			["s", "KeyS", 83],
			["d", "KeyD", 68],
		]) {
			await key("keyDown", letter, code, vk);
			assert.deepEqual(
				(await evaluate(`${api}.keyboardProbe().capture()`)).movement,
				{ forward: 0, right: 0, up: 0 },
				"Wheel navigation must not move the character while a key is down",
			);
			await key("keyUp", letter, code, vk);
		}

		await press("Escape", "Escape", 27);
		assert.equal(
			(await evaluate(`${api}.keyboardProbe().capture()`)).movement.forward,
			0,
		);
		await key("keyUp", "w", "KeyW", 87);
		await evaluate(`${api}.keyboardProbe().dispose()`);
		return {
			completion: true,
			pointerCompletion: true,
			caretReplacement: true,
			ime: true,
			partialQueue: true,
			resizeAndLifecycle: true,
			repeatSuppression: true,
			embeddedSpeech: true,
			sharedRecent: true,
			wheel: true,
			annularHitAreas: true,
			constantGapsAndGlass: true,
			wheelThemeTokens: true,
			heldActivation: true,
			spaceConfirmation: true,
			keyboard: true,
			wasdNavigation: true,
			modalCancellation: true,
			heldInputRetired: true,
		};
	} finally {
		await key("keyUp", "t", "KeyT", 84);
		await evaluate(`${api}.chat.clearPrompt()`);
		await evaluate(`${api}.chat.setEmotesEnabled(true)`);
		await reset();
		await evaluate(`${api}.resetSelectionFixture()`);
	}
}
