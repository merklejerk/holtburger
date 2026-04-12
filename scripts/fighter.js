// Autonomous fighter script for the TUI.
// It keeps the character alive, heals nearby allies or self, supports the party,
// and picks fights that stay compatible with party movement.
// When nothing else needs attention, it stays with the party leader.

const AGGRO_DISTANCE = 26;
const MAX_PARTY_DISTANCE = 32;
const PARTY_RESUME_FACTOR = 0.9;
const PARTY_RESUME_DISTANCE = MAX_PARTY_DISTANCE * PARTY_RESUME_FACTOR;
const HEALING_DISTANCE = 15;
const LOW_STAMINA_RATIO = 0.1;
const LOW_HEALTH_RATIO = 0.6;
const HEALING_BUSY_OPERATIONS = new Set(["use", "use_with_target"]);

// Sticky state for debouncing repeated actions across ticks.
const state = {
	wasLowStamina: false,
	lowStaminaCancelIssued: false,
	lastPrimaryActionKey: null,
	preferredAttackTargetGuid: null,
	partySeparationLatched: false,
};

function ratio(current, max) {
	return max > 0 ? current / max : 0;
}

function resetState() {
	state.wasLowStamina = false;
	state.lowStaminaCancelIssued = false;
	state.lastPrimaryActionKey = null;
	state.preferredAttackTargetGuid = null;
	state.partySeparationLatched = false;
}

function issuePrimaryAction(key, emit) {
	if (state.lastPrimaryActionKey === key) {
		return false;
	}

	state.lastPrimaryActionKey = key;
	emit();
	return true;
}

function isLowHealth(percent) {
	return percent != null && percent < LOW_HEALTH_RATIO;
}

function isLowStamina(self) {
	return ratio(self.stamina, self.staminaMax) < LOW_STAMINA_RATIO;
}

function isHealingBusy(self) {
	return HEALING_BUSY_OPERATIONS.has(self.busyOperation);
}

function hasDeadMotionCommand(entity) {
	return entity != null && entity.motionCommand != null && entity.motionCommand.kind === "dead";
}

// The leader is the anchor for follow behavior and party distance checks.
function partyLeaderMember(party) {
	if (!party) {
		return null;
	}

	return (
		party.members.find(
			(member) => member.guid === party.leaderGuid && Holtburger.entityExists(member.guid),
		) ?? null
	);
}

function distanceToPartyLeader(self, partyLeader) {
	return partyLeader ? Holtburger.distance(self.guid, partyLeader.guid) : null;
}

// Pick the most urgent nearby heal target, including self.
function chooseHealingTarget(self) {
	const candidates = [];
	const selfHealthRatio = ratio(self.health, self.healthMax);
	const selfEntity = Holtburger.entity(self.guid);

	if (isLowHealth(selfHealthRatio) && !hasDeadMotionCommand(selfEntity)) {
		candidates.push({
			guid: self.guid,
			distance: 0,
			healthRatio: selfHealthRatio,
		});
	}

	const party = Holtburger.party();
	if (party) {
		for (const member of party.members) {
			if (member.guid === self.guid) {
				continue;
			}

			if (!isLowHealth(member.healthPercent)) {
				continue;
			}

			if (hasDeadMotionCommand(Holtburger.entity(member.guid))) {
				continue;
			}

			const distance = Holtburger.distance(self.guid, member.guid);
			if (distance > HEALING_DISTANCE) {
				continue;
			}

			candidates.push({
				guid: member.guid,
				distance,
				healthRatio: member.healthPercent,
			});
		}
	}

	if (candidates.length === 0) {
		return null;
	}

	candidates.sort((left, right) => {
		if (left.distance !== right.distance) {
			return left.distance - right.distance;
		}

		if (left.healthRatio !== right.healthRatio) {
			return left.healthRatio - right.healthRatio;
		}

		return left.guid - right.guid;
	});

	return candidates[0];
}

// Use the first healing kit we can find.
function firstHealingKit() {
	for (const container of Holtburger.inventory()) {
		for (const itemGuid of container.items) {
			const item = Holtburger.entity(itemGuid);
			if (item && item.kind === "healing_kit") {
				return item.guid;
			}
		}
	}

	return null;
}

// Prefer monsters that keep us close to the party leader.
function selectAttackTarget(self, partyLeader) {
	const monsters = Holtburger.nearbyEntities(null, ["monster"]).filter(
		(monster) => !hasDeadMotionCommand(monster),
	);
	const withinPartyAttackRange = (monster) =>
		!partyLeader || Holtburger.distance(partyLeader.guid, monster.guid) <= MAX_PARTY_DISTANCE;
	const stickyMonster = state.preferredAttackTargetGuid
		? monsters.find(
			(monster) => monster.guid === state.preferredAttackTargetGuid && withinPartyAttackRange(monster),
		)
		: null;

	if (stickyMonster) {
		return {
			guid: stickyMonster.guid,
			key: `attack-sticky:${stickyMonster.guid}`,
			reason: "sticky",
		};
	}

	if (state.preferredAttackTargetGuid != null) {
		state.preferredAttackTargetGuid = null;
	}

	if (partyLeader) {
		let bestMonster = null;

		for (const monster of monsters) {
			if (!withinPartyAttackRange(monster)) {
				continue;
			}

			const distanceToParty = Holtburger.distance(partyLeader.guid, monster.guid);

			if (
				bestMonster == null ||
				distanceToParty < bestMonster.distanceToParty ||
				(distanceToParty === bestMonster.distanceToParty && monster.guid < bestMonster.monster.guid)
			) {
				bestMonster = { monster, distanceToParty };
			}
		}

		if (bestMonster) {
			state.preferredAttackTargetGuid = bestMonster.monster.guid;
			return {
				guid: bestMonster.monster.guid,
				key: `attack-party:${partyLeader.guid}:${bestMonster.monster.guid}`,
				reason: "party-nearest-monster",
			};
		}
	}

	const aggroMonsters = Holtburger
		.nearbyEntities(AGGRO_DISTANCE, ["monster"])
		.filter((monster) => !hasDeadMotionCommand(monster));
	if (aggroMonsters.length > 0) {
		const aggroMonster = aggroMonsters.find((monster) => withinPartyAttackRange(monster));
		if (!aggroMonster) {
			return null;
		}

		state.preferredAttackTargetGuid = aggroMonster.guid;
		return {
			guid: aggroMonster.guid,
			key: `attack-aggro:${aggroMonster.guid}`,
			reason: "local-aggro",
		};
	}

	return null;
}

// Suppress repeated heal commands while one is already in flight.
function healIfNeeded(self) {
	const healTarget = chooseHealingTarget(self);
	if (!healTarget) {
		return false;
	}

	if (isHealingBusy(self)) {
		Holtburger.debugLog(
			`healing already in progress target=${healTarget.guid} busy=${self.busyOperation}`,
		);
		return true;
	}

	const healingKit = firstHealingKit();
	if (healingKit == null) {
		return false;
	}

	const key = `heal:${healingKit}:${healTarget.guid}`;
	return issuePrimaryAction(key, () => {
		Holtburger.debugLog(
			`healing target=${healTarget.guid} health=${Math.round(healTarget.healthRatio * 100)}% kit=${healingKit}`,
		);
		Holtburger.useWith(healingKit, healTarget.guid);
	});
}

// Follow only the party leader, never a random nearby member.
function followPartyLeader(self, partyLeader) {
	if (!partyLeader || partyLeader.guid === self.guid) {
		return false;
	}

	const currentInteraction = Holtburger.currentInteraction();
	if (currentInteraction != null && currentInteraction.kind === "Follow" && currentInteraction.guid === partyLeader.guid) {
		Holtburger.debugLog(`follow already active target=${partyLeader.guid}`);
		return true;
	}

	const key = `follow:${partyLeader.guid}`;
	return issuePrimaryAction(key, () => {
		if (currentInteraction != null) {
			Holtburger.debugLog(
				`restarting follow target=${partyLeader.guid} previous=${currentInteraction.kind}`,
			);
		}
		Holtburger.cancelInteraction();
		Holtburger.follow(partyLeader.guid);
	});
}

// Reuse combat and interaction state so we do not spam attack commands.
function attackTarget(target) {
	if (!target) {
		return false;
	}

	const combatInfo = Holtburger.combatInfo();
	const currentInteraction = Holtburger.currentInteraction();
	const alreadyAttackingSameTarget =
		(combatInfo.target != null && combatInfo.target === target.guid) ||
		(currentInteraction != null && currentInteraction.kind === "Attack" && currentInteraction.guid === target.guid);
	const alreadyApproachingSameTarget =
		(currentInteraction != null && currentInteraction.kind === "Approach" && currentInteraction.guid === target.guid);

	if (alreadyAttackingSameTarget) {
		state.preferredAttackTargetGuid = target.guid;
		Holtburger.debugLog(`attack already active target=${target.guid} reason=${target.reason}`);
		return true;
	}

	if (alreadyApproachingSameTarget) {
		state.preferredAttackTargetGuid = target.guid;
		Holtburger.debugLog(`attack pending approach target=${target.guid} reason=${target.reason}`);
		return true;
	}

	state.preferredAttackTargetGuid = target.guid;
	return issuePrimaryAction(target.key, () => {
		Holtburger.debugLog(`attacking target=${target.guid} reason=${target.reason}`);
		Holtburger.attack(target.guid);
	});
}

// Once separated, stay latched until we are safely back in range of the leader.
function updatePartySeparationLatch(self, partyLeader) {
	if (!partyLeader) {
		if (state.partySeparationLatched) {
			Holtburger.debugLog("party separation cleared party=n/a");
		}

		state.partySeparationLatched = false;
		return { shouldFollow: false, distance: null };
	}

	const distance = distanceToPartyLeader(self, partyLeader);
	const isSeparated = distance != null && distance > MAX_PARTY_DISTANCE;

	if (isSeparated) {
		if (!state.partySeparationLatched) {
			Holtburger.debugLog(
				`party separation latched distance=${distance.toFixed(2)} party=${partyLeader.guid}`,
			);
		}

		state.partySeparationLatched = true;
		state.preferredAttackTargetGuid = null;
		return { shouldFollow: true, distance };
	}

	if (state.partySeparationLatched && (distance == null || distance <= PARTY_RESUME_DISTANCE)) {
		Holtburger.debugLog(
			`party separation cleared distance=${distance == null ? "n/a" : distance.toFixed(2)} party=${partyLeader ? partyLeader.guid : "n/a"}`,
		);
		state.partySeparationLatched = false;
	}

	return { shouldFollow: state.partySeparationLatched, distance };
}

// Main priority loop for each lifecycle tick.
function runFighter() {
	const self = Holtburger.selfEntity();
	if (!self) {
		return;
	}

	const combatInfo = Holtburger.combatInfo();
	const lowStamina = isLowStamina(self);

	if (lowStamina) {
		if (!state.wasLowStamina) {
			Holtburger.say("I'm tired");
			state.wasLowStamina = true;
		}

		let emittedAction = false;

		if (combatInfo.isEngaged && !state.lowStaminaCancelIssued) {
			state.lowStaminaCancelIssued = true;
			emittedAction = issuePrimaryAction("low-stamina-cancel", () => {
				Holtburger.cancelInteraction();
			});
		}

		if (healIfNeeded(self)) {
			return;
		}

		if (!emittedAction) {
			state.lastPrimaryActionKey = "low-stamina";
		}

		return;
	}

	state.wasLowStamina = false;
	state.lowStaminaCancelIssued = false;

	if (self.busyOperation !== "none") {
		return;
	}

	if (healIfNeeded(self)) {
		return;
	}

	const party = Holtburger.party();
	const partyLeader = partyLeaderMember(party);
	const separation = updatePartySeparationLatch(self, partyLeader);

	if (separation.shouldFollow) {
		if (partyLeader) {
			followPartyLeader(self, partyLeader);
			return;
		}

		state.partySeparationLatched = false;
	}

	if (combatInfo.isEngaged) {
		return;
	}

	if (attackTarget(selectAttackTarget(self, partyLeader))) {
		return;
	}

	followPartyLeader(self, partyLeader);
}

Holtburger.onEvent((event) => {
	if (event.kind !== "Lifecycle") {
		return;
	}

	switch (event.data.kind) {
		case "Started":
			resetState();
			runFighter();
			break;
		case "Stopped":
			resetState();
			break;
		case "Tick":
			runFighter();
			break;
	}
});
