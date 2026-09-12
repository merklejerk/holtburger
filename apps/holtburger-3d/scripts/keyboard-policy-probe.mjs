import assert from "node:assert/strict";

/** Drive actual browser defaults; DOM-dispatched keyboard events cannot prove focus or native control behavior. */
export async function probeKeyboardPolicy(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const evaluate = (expression) => evaluateExpression(client, expression);
	const invoke = (method) => evaluate(`${api}.keyboardProbe().${method}()`);
	const capture = () => invoke("capture");
	const click = async (selector, fraction = 0.5) => {
		const point = await evaluate(`(() => {
			const element = document.querySelector(${JSON.stringify(selector)});
			if (!element) throw new Error('Keyboard probe control is absent: ' + ${JSON.stringify(selector)});
			const rect = element.getBoundingClientRect();
			return { x: rect.left + rect.width * ${fraction}, y: rect.top + rect.height / 2 };
		})()`);
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			button: "left",
			clickCount: 1,
			...point,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			button: "left",
			clickCount: 1,
			...point,
		});
	};
	const key = async (type, value, code, virtualKey, extra = {}) => {
		await client.send("Input.dispatchKeyEvent", {
			type,
			key: value,
			code,
			windowsVirtualKeyCode: virtualKey,
			...extra,
		});
	};
	const press = async (value, code, virtualKey, extra = {}) => {
		await key("keyDown", value, code, virtualKey, extra);
		await key("keyUp", value, code, virtualKey);
	};
	await evaluate(`${api}.beginKeyboardProbe()`);
	try {
		await key("keyDown", "w", "KeyW", 87);
		assert.equal(
			(await capture()).movement.forward,
			1,
			"Explorer receives game keys through the app boundary",
		);
		await click("#keyboard-button");
		let state = await capture();
		assert.equal(state.clicks, 1);
		assert.equal(
			state.movement.forward,
			1,
			"An ordinary button must not cancel movement",
		);
		assert.notEqual(state.focused, "keyboard-button");
		await click("#keyboard-checkbox");
		assert.equal((await capture()).checked, true);
		await click("#keyboard-range", 0.8);
		state = await capture();
		assert.ok(
			state.range > 50,
			"Native range interaction survives focus policy",
		);
		assert.equal(state.movement.forward, 1);
		assert.equal(state.gameActive, true);
		await press("Tab", "Tab", 9);
		await press("Tab", "Tab", 9, { modifiers: 8 });
		assert.equal((await capture()).gameActive, true);

		await click("#keyboard-editor");
		state = await capture();
		assert.equal(state.movement.forward, 0, "Editing cancels held movement");
		assert.equal(
			state.pointerAllowed,
			true,
			"Editing preserves pointer availability",
		);
		await key("keyUp", "w", "KeyW", 87);
		await press("w", "KeyW", 87, { text: "w" });
		state = await capture();
		assert.equal(state.editorValue, "w");
		assert.equal(state.movement.forward, 0);
		await press("Tab", "Tab", 9);
		assert.equal((await capture()).focused, "keyboard-editor");
		await press("1", "Digit1", 49, { modifiers: 2 });
		assert.equal(
			(await capture()).focused,
			"keyboard-editor",
			"Editors suppress scope activation commands",
		);

		await invoke("openModal");
		assert.equal((await capture()).pointerAllowed, false);
		await press("x", "KeyX", 88);
		assert.equal(
			(await capture()).presses,
			0,
			"Modal input cannot reach a containing scope",
		);
		await click("#keyboard-modal-editor");
		await press("w", "KeyW", 87, { text: "w" });
		assert.equal((await capture()).movement.forward, 0);
		await press("Escape", "Escape", 27);
		state = await capture();
		assert.equal(
			state.focused,
			"keyboard-editor",
			"Modal dismissal restores the prior editor",
		);
		assert.equal(state.pointerAllowed, true);

		await click("#keyboard-viewport");
		await press("1", "Digit1", 49, { modifiers: 2 });
		assert.equal((await capture()).focused, "keyboard-bar");
		await press("w", "KeyW", 87);
		assert.equal(
			(await capture()).movement.forward,
			0,
			"Unhandled scope keys never leak into the game",
		);
		await press("x", "KeyX", 88);
		state = await capture();
		assert.equal(state.presses, 1);
		assert.equal(state.releases, 1);
		await invoke("openModal");
		await press("Escape", "Escape", 27);
		assert.equal((await capture()).focused, "keyboard-bar");
		await press("Escape", "Escape", 27);
		assert.equal((await capture()).gameActive, true);

		await press("1", "Digit1", 49, { modifiers: 2 });
		await invoke("openModal");
		await invoke("unregisterScope");
		await press("Escape", "Escape", 27);
		assert.equal(
			(await capture()).gameActive,
			true,
			"A removed scope cannot be restored by modal dismissal",
		);

		await click("#keyboard-select");
		await press("ArrowDown", "ArrowDown", 40);
		await press("Enter", "Enter", 13);
		state = await capture();
		assert.equal(
			state.selected,
			"second",
			"Native select retains keyboard operation",
		);
		await click("#keyboard-viewport");
		await key("keyDown", "w", "KeyW", 87);
		await invoke("blurWindow");
		await key("keyDown", "w", "KeyW", 87, { autoRepeat: true });
		assert.equal(
			(await capture()).movement.forward,
			0,
			"Window blur cannot resurrect a held key",
		);
		await key("keyUp", "w", "KeyW", 87);
		await press("w", "KeyW", 87);
		assert.equal((await capture()).movement.forward, 0);

		await click("#keyboard-editor");
		await invoke("removeEditor");
		assert.equal(
			(await capture()).gameActive,
			true,
			"Removing an editor releases its ownership",
		);
		await click("#keyboard-button");
		await press("Enter", "Enter", 13);
		assert.equal(
			(await capture()).focusLabel,
			"Chat message",
			"Chat activation works after a HUD click without canvas focus",
		);
		await invoke("openModal");
		await press("Escape", "Escape", 27);
		assert.equal(
			(await capture()).focusLabel,
			"Chat message",
			"Modal Escape must not also close chat",
		);
		await press("Escape", "Escape", 27);
		assert.equal((await capture()).gameActive, true);

		const historyToggle = '[aria-label="Interact with chat history"]';
		const historyState = () =>
			evaluate(`(() => {
			const buffer = document.querySelector('.chat-buffer');
			return { pointerEvents: getComputedStyle(buffer).pointerEvents,
				pressed: document.querySelector(${JSON.stringify(historyToggle)}).getAttribute('aria-pressed') };
		})()`);
		assert.equal((await historyState()).pointerEvents, "none");
		await click(historyToggle);
		assert.equal((await capture()).focusLabel, "Chat messages");
		assert.equal((await historyState()).pressed, "true");
		assert.equal((await historyState()).pointerEvents, "auto");
		const word = await evaluate(`(() => {
			const span = document.querySelector('.chat-buffer p:last-child .chat-message');
			const range = document.createRange();
			range.selectNodeContents(span);
			const rect = range.getClientRects()[0];
			return { x: rect.left + 10, y: rect.top + rect.height / 2 };
		})()`);
		for (const type of ["mousePressed", "mouseReleased"]) {
			await client.send("Input.dispatchMouseEvent", {
				type,
				button: "left",
				clickCount: 2,
				...word,
			});
		}
		const selectedText = await evaluate("getSelection().toString()");
		assert.ok(
			selectedText.length > 0,
			"Chat history supports native mouse text selection",
		);
		await press("c", "KeyC", 67, { modifiers: 2 });
		assert.equal(
			(await capture()).movement.right,
			0,
			"Copy must not strafe the character",
		);
		await click('[aria-label="Chat message"]');
		await press("v", "KeyV", 86, { modifiers: 2 });
		const pasted =
			await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() =>
			resolve(document.querySelector('[aria-label="Chat message"]').value))))`);
		assert.equal(
			pasted,
			selectedText,
			"Native copy/paste transfers the selected chat history",
		);
		await click(historyToggle);
		assert.equal(
			(await capture()).focusLabel,
			"Chat message",
			"Disabling history interaction does not interrupt draft editing",
		);
		assert.equal((await historyState()).pointerEvents, "none");
		await press("Escape", "Escape", 27);
		await click(historyToggle);
		await invoke("openModal");
		await press("Escape", "Escape", 27);
		assert.equal(
			(await capture()).focusLabel,
			"Chat messages",
			"A modal restores history interaction",
		);
		await click("#keyboard-viewport");
		assert.equal((await capture()).gameActive, true);
		await click(".chat-buffer");
		assert.equal(
			(await capture()).focusLabel,
			"Chat messages",
			"An interactive buffer can reacquire keyboard ownership",
		);
		await press("Escape", "Escape", 27);
		assert.equal((await capture()).gameActive, true);
		await click(historyToggle);
		assert.equal((await historyState()).pressed, "false");
		return {
			nativeControls: true,
			editorOwnership: true,
			explicitScopes: true,
			modalRestoration: true,
			tabSuppressed: true,
			heldKeyCancellation: true,
			chatActivation: true,
			chatHistoryCopy: true,
		};
	} finally {
		await invoke("dispose");
	}
}
