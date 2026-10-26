import assert from "node:assert/strict";

/** Native input verifies the real chat-to-board handoff and exclusive scope lifecycle. */
export async function probeClientLogopolis(driver) {
	const { api, evaluate, key } = driver;
	const settle = () =>
		evaluate(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	const press = async (value, code, virtualKey) => {
		await driver.press(
			value,
			code,
			virtualKey,
			value === "Enter" ? { text: "\r" } : {},
		);
		await settle();
	};
	const click = async (selector) => {
		await driver.click(selector);
		await settle();
	};
	const state = () =>
		evaluate(`({
		status: document.querySelector('[data-logopolis-status]')?.dataset.logopolisStatus,
		focused: document.activeElement?.getAttribute('aria-label'),
		hidden: document.querySelector('[aria-label="Logopolis"]')?.hidden,
		world: ${api}.keyboardProbe().capture()
	})`);
	const launch = async () => {
		await click('input[aria-label="Chat message"]');
		await driver.insertText("/logopolis ");
		await press("Enter", "Enter", 13);
		await evaluate(`(async () => {
			const deadline = performance.now() + 5000;
			while (document.querySelector('[data-logopolis-status]')?.dataset.logopolisStatus !== 'playing') {
				const error = document.querySelector('[data-logopolis-status] [role="alert"]');
				if (error) throw new Error(error.textContent);
				if (performance.now() > deadline) throw new Error('Logopolis did not finish preparing its renderer.');
				await new Promise(requestAnimationFrame);
			}
		})()`);
		const current = await state();
		assert.equal(
			current.status,
			"playing",
			"Command immediately starts the board",
		);
		assert.equal(
			current.focused,
			"Logopolis portal Snake board",
			"Chat submission leaves focus with Snake",
		);
		assert.equal(current.world.gameActive, false);
	};
	await evaluate(`${api}.chat.reset()`);
	await evaluate(`${api}.beginKeyboardProbe()`);
	try {
		const renderer = await evaluate(`(async () => {
			const { renderLogopolis, loadLogopolisSprites, LOGOPOLIS_SCREEN } = await import('/src/client/client-logopolis-renderer.ts');
			const { createSnakeGame } = await import('/src/client/client-logopolis.ts');
			const sprites = await loadLogopolisSprites();
			const canvas = document.createElement('canvas');
			canvas.width = LOGOPOLIS_SCREEN.width;
			canvas.height = LOGOPOLIS_SCREEN.height;
			const context = canvas.getContext('2d');
			if (!context) throw new Error('Arcade renderer requires canvas.');
			const game = createSnakeGame(() => 0);
			const pixels = () => Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
			const frames = ['playing', 'paused', 'lost', 'won'].map(status => {
				renderLogopolis(context, sprites, game, game.score, status);
				return pixels();
			});
			renderLogopolis(context, sprites, { ...game, score: game.score + 1 }, game.score + 1, 'playing');
			const scored = pixels();
			const orientations = ['up', 'right', 'down', 'left'].map(direction => {
				renderLogopolis(context, sprites, { ...game, portals: game.portals.map(portal => ({ ...portal, direction })) }, game.score, 'playing');
				return pixels().join(',');
			});
			return { portalDirectionsDistinct: new Set(orientations).size === orientations.length,
				draws: frames.every(frame => frame.some(value => value > 0)),
				distinctStates: new Set(frames.map(frame => frame.join(','))).size === frames.length,
				scoreUpdates: scored.some((value, index) => value !== frames[0][index]) };
		})()`);
		assert.deepEqual(renderer, {
			portalDirectionsDistinct: true,
			draws: true,
			distinctStates: true,
			scoreUpdates: true,
		});
		await launch();
		await key("keyDown", "w", "KeyW", 87);
		assert.equal(
			(await state()).world.movement.forward,
			0,
			"Snake input cannot move the world",
		);
		await press("Escape", "Escape", 27);
		assert.equal((await state()).status, "paused");
		assert.equal(
			(await state()).hidden,
			false,
			"First Escape releases input without closing",
		);
		await key("keyDown", "w", "KeyW", 87, { autoRepeat: true });
		assert.equal(
			(await state()).world.movement.forward,
			0,
			"Held Snake key stays quarantined after Escape",
		);
		await key("keyUp", "w", "KeyW", 87);
		await press("Escape", "Escape", 27);
		assert.equal(
			(await state()).hidden,
			true,
			"Second Escape dismisses the retained window",
		);
		await launch();
		await evaluate(`${api}.keyboardProbe().openModal()`);
		assert.equal((await state()).status, "paused", "Modality cancels Snake");
		await evaluate(`${api}.keyboardProbe().closeModal()`);
		await settle();
		assert.equal((await state()).focused, "Logopolis portal Snake board");
		assert.equal(
			(await state()).status,
			"paused",
			"Modal focus restoration cannot resume play",
		);
		const viewport = await evaluate(`(async () => {
			const { CLIENT_UI_DEFAULTS } = await import('/src/client/client-ui-defaults.ts');
			const root = document.querySelector('[data-logopolis-status]');
			const screen = root.querySelector('.logopolis-screen');
			const action = screen.querySelector('button');
			const canvas = screen.querySelector('canvas');
			const inspect = () => {
				const outer = root.getBoundingClientRect();
				const display = canvas.getBoundingClientRect();
				const button = action.getBoundingClientRect();
				return {
					visible: display.width > 0 && display.height > 0,
					contained: display.left >= outer.left && display.right <= outer.right && display.top >= outer.top && display.bottom <= outer.bottom,
					controlInsideScreen: button.left >= display.left && button.right <= display.right && button.top >= display.top && button.bottom <= display.bottom,
					glassPassesInput: getComputedStyle(screen, '::before').pointerEvents === 'none' && getComputedStyle(screen, '::after').pointerEvents === 'none'
				};
			};
			const initial = inspect();
			const shell = root.closest('.hud-window');
			const prior = { width: shell.style.width, height: shell.style.height };
			try {
				shell.style.width = CLIENT_UI_DEFAULTS.logopolis.minSize.width + 'px';
				shell.style.height = CLIENT_UI_DEFAULTS.logopolis.minSize.height + 'px';
				await new Promise(requestAnimationFrame);
				return { ...initial, minimumWindow: Object.values(inspect()).every(Boolean) };
			} finally {
				shell.style.width = prior.width;
				shell.style.height = prior.height;
			}
		})()`);
		assert.deepEqual(viewport, {
			visible: true,
			contained: true,
			controlInsideScreen: true,
			glassPassesInput: true,
			minimumWindow: true,
		});
		await click("[data-logopolis-status] button");
		assert.equal((await state()).status, "playing");
		await evaluate('window.dispatchEvent(new Event("blur"))');
		assert.equal(
			(await state()).status,
			"paused",
			"Application blur pauses play",
		);
		await click("[data-logopolis-status] button");
		await press("Enter", "Enter", 13);
		assert.equal(
			(await state()).focused,
			"Chat message",
			"Chat can acquire input from Snake",
		);
		assert.equal((await state()).status, "paused");
		await launch();
		await click("#keyboard-viewport");
		assert.equal(
			(await state()).status,
			"paused",
			"World pointer intent releases Snake",
		);
		assert.equal((await state()).world.gameActive, true);
		await launch();
		await click('button[aria-label="Close Logopolis"]');
		assert.equal((await state()).status, "paused");
		assert.equal((await state()).hidden, true);
		await launch();
		await press("Escape", "Escape", 27);
		await press("Escape", "Escape", 27);
		return {
			arcadeRenderer: renderer,
			arcadeViewport: viewport,
			automaticLaunch: true,
			exclusiveKeyboard: true,
			heldKeyCancellation: true,
			retainedReopening: true,
			modalPause: true,
			blurPause: true,
			chatTransfer: true,
			viewportTransfer: true,
		};
	} finally {
		await evaluate(`${api}.keyboardProbe().dispose()`);
	}
}
