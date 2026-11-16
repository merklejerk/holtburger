import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(
	new URL("../../../fighter.js", import.meta.url),
	"utf8",
);

test("fighter skips summons and retires a target that becomes nonhostile and resumes acquisition", () => {
	const summon = { guid: 2, kind: "monster", isHostile: false, profile: null };
	const mob = { guid: 3, kind: "monster", isHostile: true, profile: null };
	const attacks: number[] = [];
	let cancellations = 0;
	const combat = {
		isEngaged: false,
		target: null as number | null,
		combatMode: "Melee",
	};
	const callbacks: { event?: (event: unknown) => void } = {};
	runInNewContext(source, {
		HB: {
			onEvent: (callback: (event: unknown) => void) => {
				callbacks.event = callback;
			},
			selfEntity: () => ({
				guid: 1,
				health: 100,
				healthMax: 100,
				stamina: 100,
				staminaMax: 100,
				busyOperation: "none",
			}),
			entity: (guid: number) => (guid === mob.guid ? mob : summon),
			nearbyEntities: () => [summon, mob],
			combatInfo: () => combat,
			party: () => null,
			currentInteraction: () => null,
			attack: (guid: number) => attacks.push(guid),
			cancelInteraction: () => {
				cancellations++;
			},
		},
	});
	const dispatch = callbacks.event;
	assert.ok(dispatch);
	dispatch({
		kind: "lifecycle",
		data: { kind: "started", data: { args: "" } },
	});
	assert.deepEqual(attacks, [mob.guid]);
	combat.isEngaged = true;
	combat.target = mob.guid;
	dispatch({ kind: "lifecycle", data: { kind: "tick" } });
	assert.deepEqual(attacks, [mob.guid]);
	mob.isHostile = false;
	dispatch({ kind: "lifecycle", data: { kind: "tick" } });
	assert.equal(cancellations, 1);
	assert.deepEqual(attacks, [mob.guid]);
	// An unchanged pending cancellation must not be sent on every tick.
	dispatch({ kind: "lifecycle", data: { kind: "tick" } });
	assert.equal(cancellations, 1);
	combat.isEngaged = false;
	combat.target = null;
	dispatch({ kind: "lifecycle", data: { kind: "tick" } });
	assert.deepEqual(attacks, [mob.guid]);
	mob.isHostile = true;
	dispatch({ kind: "lifecycle", data: { kind: "tick" } });
	assert.deepEqual(attacks, [mob.guid, mob.guid]);
});
