import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(
	new URL("../../../fighter.js", import.meta.url),
	"utf8",
);

test("fighter skips summons and retires a target that becomes nonhostile and resumes acquisition", () => {
	const summon = {
		guid: 2,
		category: "monster",
		isHostile: false,
		isDead: false,
	};
	const mob = {
		guid: 3,
		category: "monster",
		isHostile: true,
		isDead: false,
	};
	const attacks: number[] = [];
	let stopCombatCount = 0;
	let stopMovementCount = 0;
	const combat = {
		state: "idle",
		target: null as number | null,
		combatMode: "melee",
		profile: null,
	};
	const callbacks: { event?: (event: unknown) => void } = {};
	runInNewContext(source, {
		HB: {
			onEvent: (callback: (event: unknown) => void) => {
				callbacks.event = callback;
			},
			self: () => ({
				guid: 1,
				health: 100,
				healthMax: 100,
				stamina: 100,
				staminaMax: 100,
				busy: null,
				navigation: null,
			}),
			entity: (guid: number) => ({
				summary: guid === mob.guid ? mob : summon,
			}),
			entities: () => [summon, mob],
			combat: () => combat,
			social: () => ({ fellowship: null }),
			beginCombat: (guid: number) => attacks.push(guid),
			stopCombat: () => {
				stopCombatCount++;
			},
			stopMovement: () => {
				stopMovementCount++;
			},
		},
	});
	const dispatch = callbacks.event;
	assert.ok(dispatch);
	dispatch({ kind: "started", args: "" });
	assert.deepEqual(attacks, [mob.guid]);
	combat.state = "engaged";
	combat.target = mob.guid;
	dispatch({ kind: "tick", elapsed: 0.1 });
	assert.deepEqual(attacks, [mob.guid]);
	mob.isHostile = false;
	dispatch({ kind: "tick", elapsed: 0.1 });
	assert.equal(stopCombatCount, 1);
	assert.equal(stopMovementCount, 1);
	assert.deepEqual(attacks, [mob.guid]);
	// An unchanged pending cancellation must not be sent on every tick.
	dispatch({ kind: "tick", elapsed: 0.1 });
	assert.equal(stopCombatCount, 1);
	combat.state = "idle";
	combat.target = null;
	dispatch({ kind: "tick", elapsed: 0.1 });
	assert.deepEqual(attacks, [mob.guid]);
	mob.isHostile = true;
	dispatch({ kind: "tick", elapsed: 0.1 });
	assert.deepEqual(attacks, [mob.guid, mob.guid]);
});
