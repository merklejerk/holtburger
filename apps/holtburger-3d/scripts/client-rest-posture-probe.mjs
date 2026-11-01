import assert from "node:assert/strict";

/** Native keys exercise the production binding gate, cycle controller and rendered toast. */
export async function probeClientRestPostures(driver) {
	const { api, evaluate, press, key, click } = driver;
	await evaluate(
		`globalThis.__restPostureProbe = ${api}.beginRestPostureProbe()`,
	);
	const probe = "globalThis.__restPostureProbe";
	const settle = () =>
		evaluate(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	const read = () => evaluate(`${probe}.read()`);
	try {
		for (const [index, posture, label] of [
			[0, "crouching", "Crouching"],
			[1, "sitting", "Sitting"],
			[2, "lying", "Lying down"],
			[3, "standing", "Standing"],
		]) {
			await key("keyDown", "n", "KeyN", 78);
			await key("keyDown", "n", "KeyN", 78, { autoRepeat: true });
			await key("keyUp", "n", "KeyN", 78);
			await settle();
			const state = await read();
			assert.equal(
				state.commands.length,
				index + 1,
				"held N advances only once",
			);
			assert.deepEqual(state.commands.at(-1), {
				command: "set_client_rest_posture",
				args: { posture },
			});
			assert.equal(state.toast.message, label);
			// Keyed toast replacements retain the outgoing node during its authored fade.
			assert.equal(
				await evaluate(
					`[...document.querySelectorAll('.client-toast[role=status]')].some(node => node.textContent.trim() === ${JSON.stringify(label)})`,
				),
				true,
			);
			await evaluate(`${probe}.observe(${JSON.stringify(posture)})`);
		}
		await press("N", "KeyN", 78, { modifiers: 8 });
		assert.equal(
			(await read()).commands.length,
			4,
			"Shift+N does not activate the unmodified binding",
		);
		await click('input[aria-label="Chat message"]');
		await press("n", "KeyN", 78);
		assert.equal((await read()).commands.length, 4, "chat editor owns N");
		await press("Escape", "Escape", 27);
		await press("n", "KeyN", 78);
		await settle();
		await press("Escape", "Escape", 27);
		await settle();
		assert.equal(
			(await read()).commands.at(-1).command,
			"cancel_client_rest_posture",
		);
		return {
			cycle: true,
			toasts: true,
			repeatSuppressed: true,
			editorOwnership: true,
			escapeCancellation: true,
		};
	} finally {
		await evaluate(`${probe}.dispose(); delete globalThis.__restPostureProbe`);
	}
}
