import assert from "node:assert/strict";

/** Verify real-client Escape ownership across queued combat responses and retirement. */
export async function probeClientCombatEscape(
	client,
	evaluate,
	consoleMessages,
) {
	const read = (expression) => evaluate(client, expression);
	const api = "globalThis.__HOLTBURGER_CLIENT_PRESENTATION__";
	const wait = async (expression) => {
		const deadline = Date.now() + 90_000;
		while (!(await read(expression))) {
			const errors = consoleMessages.filter(
				({ level }) => level === "error" || level === "exception",
			);
			if (errors.length) throw new Error(JSON.stringify(errors));
			if (Date.now() > deadline)
				throw new Error(
					`Combat repro timeout: ${expression}; ${await read("document.body.innerText")}`,
				);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	};
	const settle = () =>
		read(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	const key = async (key, code) => {
		for (const type of ["keyDown", "keyUp"])
			await client.send("Input.dispatchKeyEvent", { type, key, code });
		await settle();
	};
	const play = async () => {
		await read(`(() => {
			const play = document.querySelector('.engagement-toggle[aria-label="Start attack"]');
			if (!play || play.disabled) throw new Error('Play is not available');
			play.click();
		})()`);
		await settle();
	};
	await wait(
		`${api}?.read().gates.connection.waiting > 0 && ${api}.read().gates.scene.waiting > 0`,
	);
	await read(`${api}.releaseConnection(); ${api}.releaseScene()`);
	await wait(
		"[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Enter World' && !b.disabled)",
	);
	await read(
		"[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Enter World').click()",
	);
	await wait(
		`${api}.read().portalReveals === 1 && document.querySelector('.client-world') !== null`,
	);

	// Control: a normally accepted start must acquire Escape cancellation through production input.
	await read(`${api}.combat.prepare()`);
	await settle();
	await key("Tab", "Tab");
	await play();
	let control = await read(`${api}.combat.read()`);
	assert.equal(control.starts.length, 1);
	assert.equal(
		control.starts[0].target,
		control.targetGuid,
		"Tab must acquire the fixture creature",
	);
	await read(`${api}.combat.deliverNext()`);
	await settle();
	await key("Escape", "Escape");
	control = await read(`${api}.combat.read()`);
	assert.equal(control.stops, 1, "Control case must stop the accepted attack");
	await read(`${api}.combat.deliverNext()`);
	assert.equal((await read(`${api}.combat.read()`)).activeTarget, null);

	// A matching refusal must release its own lease and leave selection's Escape action reachable.
	await read(`${api}.combat.prepare()`);
	await settle();
	await key("x", "KeyX");
	await play();
	await read(`${api}.combat.deliverNext()`);
	await settle();
	const rejected = await read(`${api}.combat.read()`);
	assert.equal(
		rejected.processedIntentSequence,
		rejected.starts[0].intentSequence,
	);
	await key("Escape", "Escape");
	assert.equal((await read(`${api}.combat.read()`)).stops, 0);
	assert.equal(
		await read(
			"document.querySelector('section[aria-label=\"Selected entity\"]') === null",
		),
		true,
	);

	// Both begin requests reach the host before either response is released. No response reordering.
	await read(`${api}.combat.prepare()`);
	await settle();
	await key("x", "KeyX");
	await play();
	await key("Tab", "Tab");
	await play();
	const pending = await read(`${api}.combat.read()`);
	assert.deepEqual(
		pending.starts.map((start) => start.target),
		[pending.playerGuid, pending.targetGuid],
	);
	assert.equal(pending.delivered, 0);
	await read(`${api}.combat.deliverNext()`);
	await settle();
	assert.equal(
		await read(
			"[...document.querySelectorAll('.client-toast')].some(t => t.textContent.includes('Select a valid target before attacking.'))",
		),
		true,
	);
	await read(`${api}.combat.deliverNext()`);
	await settle();
	assert.equal(
		await read(
			"document.querySelector('.engagement-toggle').getAttribute('aria-label')",
		),
		"Cancel attack",
	);
	await key("Escape", "Escape");
	const result = await read(`${api}.combat.read()`);
	assert.equal(result.delivered, 2);
	assert.equal(
		result.stops,
		1,
		JSON.stringify({
			controlStopRequests: control.stops,
			requestTargets: pending.starts.map((start) => start.target),
			deliveredResponses: result.delivered,
			expectedStopRequests: 1,
			observedStopRequests: result.stops,
			activeTargetAfterEscape: result.activeTarget,
		}),
	);
	await read(`${api}.combat.deliverNext()`);
	assert.equal((await read(`${api}.combat.read()`)).activeTarget, null);

	// Escape must cancel a begin before its acceptance arrives; delivery remains begin, then stop.
	await read(`${api}.combat.prepare()`);
	await settle();
	await key("Tab", "Tab");
	await play();
	await key("Escape", "Escape");
	const immediate = await read(`${api}.combat.read()`);
	assert.equal(immediate.delivered, 0);
	assert.equal(immediate.stops, 1);
	await read(`${api}.combat.deliverNext(); ${api}.combat.deliverNext()`);
	await settle();
	assert.equal((await read(`${api}.combat.read()`)).activeTarget, null);

	// A stop response queued before a new begin cannot retire the new begin's lease.
	await read(`${api}.combat.prepare()`);
	await settle();
	await key("Tab", "Tab");
	await play();
	await read(`${api}.combat.deliverNext()`);
	await settle();
	await key("Escape", "Escape");
	await key("1", "Digit1");
	const restart = await read(`${api}.combat.read()`);
	assert.equal(restart.stops, 1);
	assert.equal(restart.starts.length, 2);
	assert.ok(
		restart.starts[1].intentSequence > restart.starts[0].intentSequence,
	);
	await read(`${api}.combat.deliverNext(); ${api}.combat.deliverNext()`);
	await settle();
	await key("Escape", "Escape");
	assert.equal((await read(`${api}.combat.read()`)).stops, 2);
	await read(`${api}.combat.deliverNext()`);
	assert.equal((await read(`${api}.combat.read()`)).activeTarget, null);

	// Retiring the session releases pending ownership; a late acceptance must not reacquire it.
	await read(`${api}.combat.prepare()`);
	await settle();
	await key("Tab", "Tab");
	await play();
	await read(`${api}.failSession()`);
	await wait("document.querySelector('h1')?.textContent === 'Connection lost'");
	await read(`${api}.combat.deliverNext()`);
	await settle();
	await key("Escape", "Escape");
	assert.equal((await read(`${api}.combat.read()`)).stops, 0);
	return {
		control: true,
		matchingRefusalReleasesOwnership: true,
		rapidRetryRemainsCancelable: true,
		immediateCancellation: true,
		stopThenRestart: true,
		retirement: true,
	};
}
