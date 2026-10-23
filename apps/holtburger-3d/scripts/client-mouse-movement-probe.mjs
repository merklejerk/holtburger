import assert from "node:assert/strict";

/** Drive the production viewport's mouse listeners with actual Chrome button delivery. */
export async function probeClientMouseMovement(client, evaluate) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const fixture = `${api}.mouseMovement.fixture`;
	const read = (expression) => evaluate(client, expression);
	const state = () => read(`${fixture}.state()`);
	const settle = () =>
		read(
			"new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
		);
	const wait = async (expression) => {
		const deadline = Date.now() + 5000;
		while (!(await read(expression))) {
			if (Date.now() > deadline)
				throw new Error(
					`Mouse probe timeout: ${expression}; ${JSON.stringify(await state())}`,
				);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	};
	const waitForLock = async (locked) => {
		await wait(`(document.pointerLockElement !== null) === ${locked}`);
		// Chrome changes the property before dispatching the owner's pointerlockchange event.
		await settle();
	};
	const point = await read(`(() => {
		const canvas = document.querySelector('.client-canvas'); const b = canvas.getBoundingClientRect();
		for (const fx of [0.6,0.4,0.7,0.3]) for (const fy of [0.4,0.6,0.3]) {
			const x=b.left+b.width*fx,y=b.top+b.height*fy;
			if(document.elementFromPoint(x,y)===canvas)return {x,y};
		} throw new Error('No exposed viewport point');
	})()`);
	let lastHoldAt = -Infinity;
	const mouse = async (type, button, buttons, x = point.x, y = point.y) => {
		if (type === "mousePressed" && [1, 2, 4].includes(buttons)) {
			// Chromium rate-limits capture requests; independent gestures must not become an automated burst.
			const gestureIntervalMs = 300;
			await new Promise((resolve) =>
				setTimeout(
					resolve,
					Math.max(0, gestureIntervalMs - (Date.now() - lastHoldAt)),
				),
			);
			lastHoldAt = Date.now();
		}
		await client.send("Input.dispatchMouseEvent", {
			type,
			button,
			buttons,
			x,
			y,
			clickCount: 1,
		});
		if (type === "mouseReleased" && buttons === 0) await settle();
	};
	const key = async (value, down) => {
		await client.send("Input.dispatchKeyEvent", {
			type: down ? "keyDown" : "keyUp",
			key: value,
			code: value.length === 1 ? `Key${value.toUpperCase()}` : value,
		});
	};
	const forward = async (expected) =>
		assert.equal((await state()).drive.longitudinal, expected);
	const initial = await read(`${api}.bindingSettings.read()`);
	await read(`document.querySelector('button[aria-label="Settings"]').click()`);
	await settle();
	await read(`document.querySelector('#settings-tab-input').click()`);
	await settle();
	const control = `[...document.querySelectorAll('#settings-section-input label')].find(label => label.textContent.includes('Use mouse movement/steering')).querySelector('input')`;
	await read(`${control}.click()`);
	await settle();
	assert.equal(
		await read(`${api}.bindingSettings.read().mouseMovement`),
		!initial.mouseMovement,
	);
	await read(`${control}.click()`);
	await settle();
	assert.equal(
		await read(`${api}.bindingSettings.read().mouseMovement`),
		initial.mouseMovement,
	);
	const defaults = await read(
		`import('/src/client/client-input-settings.ts').then(module => module.CLIENT_INPUT_DEFAULTS)`,
	);
	await read(
		`${api}.bindingSettings.replace({...${api}.bindingSettings.read(), mouseMovement:${!defaults.mouseMovement}, character:{...${api}.bindingSettings.read().character,forward:[{key:'F8'}]}})`,
	);
	await settle();
	await read(
		`[...document.querySelectorAll('#settings-section-input button')].find(button => button.textContent === 'Restore default input settings').click()`,
	);
	await settle();
	assert.deepEqual(await read(`${api}.bindingSettings.read()`), defaults);
	await read(`${api}.bindingSettings.replace(${JSON.stringify(initial)})`);
	await settle();
	await read(`document.querySelector('button[aria-label="Settings"]').click()`);
	await settle();
	await read(`globalThis.__releaseMouseKeys = ${fixture}.bindKeyboard()`);
	try {
		const panPixels = await read(
			`import('/src/client/client-viewport-pointer-gesture.ts').then(module => module.CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS + 1)`,
		);
		for (const cursorJump of [false, true]) {
			await mouse("mouseMoved", "none", 0);
			await mouse("mousePressed", "right", 2);
			await waitForLock(true);
			await mouse("mouseMoved", "none", 2, point.x + 20);
			await mouse("mouseReleased", "right", 0, point.x + 20);
			await waitForLock(false);
			const handoffOrbits = await read(`${api}.capture().orbitDeltas.length`);
			const handoffClicks = await read(
				`${api}.capture().viewportSelectionPoints.length`,
			);
			if (cursorJump) {
				// Delay acquisition so the captured unlocked zero/jump sequence arrives before the pan lock.
				await read(`(() => {
					const canvas=document.querySelector('.client-canvas'); const original=canvas.requestPointerLock;
					Object.defineProperty(canvas,'requestPointerLock',{configurable:true,value:()=>new Promise((resolve,reject)=>{
						globalThis.__resumePanCapture=()=>original.call(canvas).then(resolve,reject);
					})});
				})()`);
			}
			await mouse("mousePressed", "left", 1);
			if (cursorJump) {
				await read(`(() => {
					const canvas=document.querySelector('.client-canvas');
					canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:${point.x - 89},clientY:${point.y - 16},movementX:0,movementY:0}));
					canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:${point.x + 468},clientY:${point.y + 13},movementX:557,movementY:29}));
				})()`);
				assert.equal(
					await read(`${api}.capture().orbitDeltas.length`),
					handoffOrbits,
				);
				await read("globalThis.__resumePanCapture()");
			}
			await waitForLock(true);
			// A one-sample drag must rotate immediately and must not activate a click on release.
			await mouse("mouseMoved", "none", 1, point.x + panPixels);
			await mouse("mouseReleased", "left", 0, point.x + panPixels);
			await waitForLock(false);
			assert.deepEqual(
				await read(`${api}.capture().orbitDeltas.slice(${handoffOrbits})`),
				[{ x: panPixels, y: 0 }],
			);
			assert.equal(
				await read(`${api}.capture().viewportSelectionPoints.length`),
				handoffClicks,
			);
			if (cursorJump)
				await read(
					"delete document.querySelector('.client-canvas').requestPointerLock; delete globalThis.__resumePanCapture",
				);
			await read(`${fixture}.reset()`);
		}
		const beforeClicks = await read(
			`${api}.capture().viewportSelectionPoints.length`,
		);
		await mouse("mousePressed", "right", 2);
		assert.equal(
			await read(`${api}.capture().viewportSelectionPoints.length`),
			beforeClicks,
		);
		await mouse("mouseReleased", "right", 0);
		assert.equal(
			await read(`${api}.capture().viewportSelectionPoints.length`),
			beforeClicks + 1,
		);
		const beforeChords = await read(
			`${api}.capture().viewportSelectionPoints.length`,
		);
		for (const order of [
			["left", "right"],
			["right", "left"],
		]) {
			await read(`${fixture}.reset()`);
			await mouse("mousePressed", order[0], order[0] === "left" ? 1 : 2);
			await mouse("mousePressed", order[1], 3);
			await forward("forward");
			await mouse("mouseReleased", order[0], order[0] === "left" ? 2 : 1);
			await forward(null);
			await mouse("mouseReleased", order[1], 0);
		}
		assert.equal(
			await read(`${api}.capture().viewportSelectionPoints.length`),
			beforeChords,
		);
		await key("w", true);
		await mouse("mousePressed", "middle", 4);
		await key("w", false);
		await forward("forward");
		await mouse("mousePressed", "left", 5);
		await mouse("mousePressed", "right", 7);
		await mouse("mouseReleased", "middle", 3);
		await forward("forward");
		await key("s", true);
		await forward("backward");
		await key("s", false);
		await forward("forward");
		await mouse("mouseReleased", "left", 2);
		await forward(null);
		await mouse("mouseReleased", "right", 0);
		await read(`${fixture}.toggleAutoRun()`);
		await mouse("mousePressed", "middle", 4);
		assert.equal((await state()).autoRun, false);
		await read(`globalThis.__releaseMouseBlock = ${fixture}.block()`);
		await forward(null);
		await read("globalThis.__releaseMouseBlock()");
		await mouse("mouseMoved", "none", 4, point.x + 8);
		await forward(null);
		await mouse("mouseReleased", "middle", 0);
		await read(`${fixture}.precise(true); ${api}.setPreciseJumpActive(true)`);
		await settle();
		await mouse("mousePressed", "middle", 4);
		await forward(null);
		await read(`${fixture}.precise(false); ${api}.setPreciseJumpActive(false)`);
		await settle();
		await forward(null);
		await mouse("mouseReleased", "middle", 0);
		await mouse("mousePressed", "middle", 4);
		await forward("forward");
		const escapeBefore = (await state()).gameEscapeCount;
		await key("Escape", true);
		await key("Escape", false);
		assert.equal((await state()).gameEscapeCount, escapeBefore + 1);
		await forward("forward");
		await mouse("mouseMoved", "none", 4, point.x + 8);
		await forward("forward");
		await mouse("mouseReleased", "middle", 0);
		await forward(null);
		for (const cancellation of [
			`window.dispatchEvent(new Event('blur'))`,
			`document.querySelector('.client-canvas').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}))`,
		]) {
			await mouse("mousePressed", "middle", 4);
			await forward("forward");
			await read(cancellation);
			await forward(null);
			await mouse("mouseMoved", "none", 4, point.x + 8);
			await forward(null);
			await mouse("mouseReleased", "middle", 0);
		}
		// DOM editor handoff cancels mouse ownership through the same client composition seam.
		await mouse("mousePressed", "middle", 4);
		await read(`document.querySelector('[aria-label="Chat message"]').focus()`);
		await forward(null);
		await mouse("mouseMoved", "none", 4, point.x + 8);
		await forward(null);
		await mouse("mouseReleased", "middle", 0);
		await read(`document.querySelector('[aria-label="Chat message"]').blur()`);
		await read(
			`globalThis.__releaseMouseKeys(); globalThis.__releaseMouseKeys = ${fixture}.bindKeyboard()`,
		);
		// Disabling movement cancels capture and held forward without blocking ordinary camera orbit.
		await mouse("mousePressed", "middle", 4);
		await waitForLock(true);
		await mouse("mouseMoved", "none", 4, point.x + 20);
		await read(
			`${api}.bindingSettings.replace({...${api}.bindingSettings.read(), mouseMovement:false})`,
		);
		await settle();
		await forward(null);
		await waitForLock(false);
		await mouse("mouseReleased", "middle", 0);
		const disabledTurns = (await state()).turns.length;
		const disabledRear = await read(`${api}.mouseMovement.rearFollowEntries()`);
		for (const [button, mask] of [
			["middle", 4],
			["right", 2],
		]) {
			await mouse("mousePressed", button, mask);
			await mouse("mouseMoved", "none", mask, point.x + 20);
			await forward(null);
			await mouse("mouseReleased", button, 0, point.x + 20);
		}
		const disabledOrbits = await read(`${api}.capture().orbitDeltas.length`);
		await mouse("mousePressed", "left", 1);
		await mouse("mousePressed", "right", 3);
		await mouse("mouseMoved", "none", 3, point.x + 20);
		await forward(null);
		await mouse("mouseReleased", "right", 1, point.x + 20);
		await mouse("mouseMoved", "none", 1, point.x + 30);
		await mouse("mouseReleased", "left", 0, point.x + 30);
		await settle();
		assert.equal((await state()).turns.length, disabledTurns);
		assert.equal(
			await read(`${api}.mouseMovement.rearFollowEntries()`),
			disabledRear,
		);
		assert.equal(await read("document.pointerLockElement"), null);
		assert.ok(
			await read(`${api}.capture().orbitDeltas.length > ${disabledOrbits}`),
		);
		const disabledClicks = await read(
			`${api}.capture().viewportSelectionPoints.length`,
		);
		for (const [button, mask] of [
			["left", 1],
			["right", 2],
		]) {
			await mouse("mousePressed", button, mask);
			await mouse("mouseReleased", button, 0);
		}
		assert.equal(
			await read(`${api}.capture().viewportSelectionPoints.length`),
			disabledClicks + 2,
		);
		await key("w", true);
		await forward("forward");
		await key("w", false);
		await forward(null);
		await read(`${api}.bindingSettings.replace(${JSON.stringify(initial)})`);
		await settle();
		await read(`${fixture}.reset()`);
		// Middle hold supplies forward movement, rear-follow steering, and pitch together.
		const middleRearBefore = await read(
			`${api}.mouseMovement.rearFollowEntries()`,
		);
		await mouse("mousePressed", "middle", 4);
		await forward("forward");
		await waitForLock(true);
		await mouse("mouseMoved", "none", 4, point.x, point.y + 20);
		assert.equal((await state()).turns.length, 0);
		assert.deepEqual(await read(`${api}.capture().orbitDeltas.at(-1)`), {
			x: 0,
			y: -20,
		});
		assert.equal(
			await read(`${api}.mouseMovement.rearFollowEntries()`),
			middleRearBefore + 1,
		);
		await mouse("mouseMoved", "none", 4, point.x + 30, point.y + 30);
		assert.ok((await state()).turns.length > 0);
		assert.ok((await state()).turns.every((delta) => delta > 0));
		await mouse("mouseReleased", "middle", 0, point.x + 30, point.y + 30);
		await forward(null);
		await waitForLock(false);
		await read(`${api}.bindingSettings.replace(${JSON.stringify(initial)})`);
		await settle();
		await read(`${fixture}.reset()`);
		// Overlapping middle/chord holds preserve capture until the final steering source ends.
		await mouse("mousePressed", "middle", 4);
		await waitForLock(true);
		await mouse("mouseMoved", "none", 4, point.x + 20);
		await mouse("mousePressed", "left", 5, point.x + 20);
		await mouse("mousePressed", "right", 7, point.x + 20);
		await mouse("mouseReleased", "middle", 3, point.x + 20);
		await forward("forward");
		assert.equal(await read("document.pointerLockElement !== null"), true);
		await mouse("mousePressed", "middle", 7, point.x + 20);
		await mouse("mouseReleased", "right", 5, point.x + 20);
		await forward("forward");
		assert.equal(await read("document.pointerLockElement !== null"), true);
		await mouse("mouseMoved", "none", 5, point.x + 30);
		const middleTurnsBeforeOrbit = (await state()).turns.length;
		await mouse("mouseReleased", "middle", 1, point.x + 30);
		await forward(null);
		await waitForLock(true);
		const middleOrbitsBefore = await read(
			`${api}.capture().orbitDeltas.length`,
		);
		await mouse("mouseMoved", "none", 1, point.x + 40, point.y + 10);
		await mouse("mouseReleased", "left", 0, point.x + 40, point.y + 10);
		assert.equal((await state()).turns.length, middleTurnsBeforeOrbit);
		assert.ok(
			await read(`${api}.capture().orbitDeltas.length > ${middleOrbitsBefore}`),
		);
		await read(`${fixture}.reset()`);
		const rearBefore = await read(`${api}.mouseMovement.rearFollowEntries()`);
		await mouse("mousePressed", "right", 2);
		await waitForLock(true);
		await mouse("mouseMoved", "none", 2, point.x, point.y + 20);
		assert.equal((await state()).turns.length, 0);
		assert.deepEqual(await read(`${api}.capture().orbitDeltas.at(-1)`), {
			x: 0,
			y: -20,
		});
		assert.equal(
			await read(`${api}.mouseMovement.rearFollowEntries()`),
			rearBefore + 1,
		);
		await mouse("mouseMoved", "none", 2, point.x + 35, point.y + 30);
		assert.ok((await state()).turns.length > 0);
		assert.ok((await state()).turns.every((delta) => delta > 0));
		const turnsBeforePitch = (await state()).turns.length;
		const pitchesBefore = await read(`${api}.capture().orbitDeltas.length`);
		await mouse("mouseMoved", "none", 2, point.x + 35, point.y + 45);
		assert.equal((await state()).turns.length, turnsBeforePitch);
		assert.equal(
			await read(`${api}.capture().orbitDeltas.length`),
			pitchesBefore + 1,
		);
		assert.deepEqual(await read(`${api}.capture().orbitDeltas.at(-1)`), {
			x: 0,
			y: -15,
		});
		await mouse("mousePressed", "left", 3, point.x + 35);
		await forward("forward");
		await mouse("mouseReleased", "left", 2, point.x + 35);
		await forward(null);
		// Releasing RMB first hands a surviving LMB hold back to free orbit without steering.
		await mouse("mousePressed", "left", 3, point.x + 35);
		await forward("forward");
		const turnsBeforeOrbit = (await state()).turns.length;
		const orbitsBefore = await read(`${api}.capture().orbitDeltas.length`);
		await mouse("mouseReleased", "right", 1, point.x + 35);
		await forward(null);
		await waitForLock(true);
		await mouse("mouseMoved", "none", 1, point.x + 45, point.y + 10);
		await mouse("mouseReleased", "left", 0, point.x + 45, point.y + 10);
		assert.equal((await state()).turns.length, turnsBeforeOrbit);
		assert.ok(
			await read(`${api}.capture().orbitDeltas.length > ${orbitsBefore}`),
		);
		// Capture loss ends yaw; physical mouse and keyboard holds still determine movement.
		await key("w", true);
		await mouse("mousePressed", "right", 2);
		await waitForLock(true);
		await mouse("mouseMoved", "none", 2, point.x + 20);
		await mouse("mousePressed", "left", 3, point.x + 20);
		await mouse("mousePressed", "middle", 7, point.x + 20);
		await forward("forward");
		await read("document.exitPointerLock()");
		await waitForLock(false);
		const turnsAtUnlock = (await state()).turns.length;
		const picksAtUnlock = await read(
			`${api}.capture().viewportSelectionPoints.length`,
		);
		await mouse("mouseMoved", "none", 7, point.x + 40);
		await settle();
		assert.equal((await state()).turns.length, turnsAtUnlock);
		assert.equal(await read("document.pointerLockElement"), null);
		await mouse("mouseReleased", "middle", 3, point.x + 40);
		await forward("forward");
		await key("w", false);
		await forward("forward");
		await mouse("mouseReleased", "left", 2, point.x + 40);
		await forward(null);
		await mouse("mouseReleased", "right", 0, point.x + 40);
		assert.equal(
			await read(`${api}.capture().viewportSelectionPoints.length`),
			picksAtUnlock,
		);
		const steeringYaw = (await state()).turns;
		assert.ok(
			steeringYaw.every((delta) => delta > 0),
			"Unlock must not reinterpret cursor restoration as reverse steering",
		);
		// Capture refusal ends yaw and reports the reason while forward remains held.
		await read(`globalThis.__originalMouseLock = document.querySelector('.client-canvas').requestPointerLock;
		Object.defineProperty(document.querySelector('.client-canvas'),'requestPointerLock',{configurable:true,value:()=>Promise.reject(new Error('probe refusal'))});`);
		await mouse("mousePressed", "right", 2);
		await mouse("mousePressed", "left", 3);
		await mouse("mouseMoved", "none", 3, point.x + 20);
		await wait(`${fixture}.state().errors.length === 1`);
		await forward("forward");
		assert.match((await state()).errors[0], /probe refusal/);
		const turnsAtRefusal = (await state()).turns.length;
		await mouse("mouseMoved", "none", 3, point.x + 40);
		await settle();
		assert.equal((await state()).turns.length, turnsAtRefusal);
		assert.equal((await state()).errors.length, 1);
		await mouse("mouseReleased", "left", 2, point.x + 40);
		await forward(null);
		await mouse("mouseReleased", "right", 0, point.x + 40);
		// Delay actual browser acquisition until after cancellation; the owner must release it.
		await read(
			`Object.defineProperty(document.querySelector('.client-canvas'),'requestPointerLock',{configurable:true,value:()=>new Promise((resolve,reject)=>{globalThis.__finishMouseLock=()=>globalThis.__originalMouseLock.call(document.querySelector('.client-canvas')).then(()=>{globalThis.__lateMouseLockSettled=true;resolve()},reject)})});`,
		);
		await mouse("mousePressed", "right", 2);
		await mouse("mouseMoved", "none", 2, point.x + 20);
		await read(`${fixture}.reset(); globalThis.__finishMouseLock()`);
		await wait(
			"globalThis.__lateMouseLockSettled === true && document.pointerLockElement === null",
		);
		await mouse("mouseReleased", "right", 0);
		await read(
			`delete document.querySelector('.client-canvas').requestPointerLock`,
		);
		return {
			mouseSettingsUi: true,
			restoreAllInputSettings: true,
			chordOrders: 2,
			overlappingSources: true,
			keyboardPrecedence: true,
			autorun: true,
			preciseSuppression: true,
			liveSettingsCancellation: true,
			mouseMovementToggle: true,
			disabledOrbitAndClicks: true,
			rearFollow: true,
			pointerLock: true,
			steeringPitch: true,
			middleSteeringPitch: true,
			middleChordHandoff: true,
			capturedCameraPan: true,
			oneSamplePanAfterSteering: true,
			unlockedCursorJumpExclusion: true,
			relativeYaw: steeringYaw,
			clickSuppression: true,
			editorCancellation: true,
			gameEscapeRouting: true,
			forwardSurvivesCaptureLoss: true,
			blurAndPointerCancellation: true,
			lockedOrbitHandoff: true,
			lockRefusal: true,
			lateLockCleanup: true,
		};
	} finally {
		await read(
			`delete document.querySelector('.client-canvas').requestPointerLock; document.exitPointerLock(); ${fixture}.reset(); globalThis.__releaseMouseKeys(); ${api}.bindingSettings.replace(${JSON.stringify(initial)})`,
		);
	}
}
