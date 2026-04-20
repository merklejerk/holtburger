import {
	ATTACK_SPELL_TIMEOUT_SECONDS,
	FOLLOW_REPEAT_SECONDS,
	HEALING_KIT_SUCCESS_GRACE_SECONDS,
	PENDING_SPELL_BUSY_GRACE_SECONDS,
	PENDING_SPELL_TIMEOUT_SECONDS,
	SPELL_REPEAT_SECONDS,
	VULN_REPEAT_SECONDS,
} from "./constants";
import { isMonsterCandidateInCombatRange } from "./domain/targeting";
import type {
	AttackRaySnapshot,
	MageResolvedSpellcast,
	MageRuntimeState,
	MageSpellRecord,
	MageSpellcastInterruptionReason,
	MageSpellcastKind,
	MageSpellcastOutcome,
	MageSpellcastRequest,
	MonsterCandidate,
} from "./types";

export function logMageInfo(message: string): void {
	HB.debugLog(`mage: ${message}`);
}

export function issueAction(
	state: MageRuntimeState,
	key: string,
	minIntervalSeconds: number,
	action: () => void,
): boolean {
	const lastIssuedAt = state.actionTimes.get(key);
	if (
		lastIssuedAt != null &&
		state.elapsedSeconds - lastIssuedAt < minIntervalSeconds
	) {
		return false;
	}

	state.actionTimes.set(key, state.elapsedSeconds);
	action();
	return true;
}

export function castSpell(
	state: MageRuntimeState,
	spell: MageSpellRecord,
	targetGuid: Guid | null,
): boolean {
	if (spellcastBlocksPlanning(state)) {
		return false;
	}

	const actionKey = `cast:${spell.spellId}:${targetGuid ?? "self"}`;
	return issueAction(state, actionKey, SPELL_REPEAT_SECONDS, () => {
		const request = createSpellcastRequest(state, spell, targetGuid);
		state.spellcast = {
			phase: "awaiting_busy",
			request,
		};
		logMageInfo(
			`cast start -> ${describeSpellcastRequest(request)} at ${state.elapsedSeconds.toFixed(2)}s`,
		);
		HB.castSpell(spell.spellId, targetGuid);
	});
}

export function currentSpellcastRequest(
	state: MageRuntimeState,
): MageSpellcastRequest | null {
	return state.spellcast.phase === "idle" ? null : state.spellcast.request;
}

export function spellcastBlocksPlanning(state: MageRuntimeState): boolean {
	return state.spellcast.phase !== "idle";
}

export function resolveSpellcastFromChatMessage(
	state: MageRuntimeState,
	chatEvent: Pick<ScriptChatEvent, "sender" | "message">,
	targetName: string | null,
): boolean {
	const request = currentSpellcastRequest(state);
	if (request == null) {
		return false;
	}

	const expectedTargetName = request.targetName ?? targetName;

	if (request.kind === "vulnerability") {
		if (isResistMessage(chatEvent, expectedTargetName)) {
			return finalizeSpellcast(state, { kind: "resisted" }) != null;
		}

		if (isVulnerabilityLandingMessage(request, chatEvent, expectedTargetName)) {
			return finalizeSpellcast(state, { kind: "succeeded" }) != null;
		}

		return false;
	}

	if (request.kind === "attack") {
		if (isResistMessage(chatEvent, expectedTargetName)) {
			return finalizeSpellcast(state, { kind: "resisted" }) != null;
		}

		if (isAttackBlockedMessage(chatEvent, expectedTargetName)) {
			return finalizeSpellcast(state, { kind: "fizzled" }) != null;
		}

		if (isAttackLandingMessage(request, chatEvent, expectedTargetName)) {
			return finalizeSpellcast(state, { kind: "succeeded" }) != null;
		}

		return false;
	}

	return false;
}

export function resolveSpellcastFromCombatFeedback(
	state: MageRuntimeState,
	feedback: ScriptCombatFeedback,
): boolean {
	const request = currentSpellcastRequest(state);
	if (request == null || request.kind !== "attack") {
		return false;
	}

	switch (feedback.kind) {
		case "victim_notification":
		case "killer_notification":
			return finalizeSpellcast(state, { kind: "succeeded" }) != null;
		case "attack_done":
			return feedback.data.error !== "None"
				? resolveSpellcastFromWeenieError(state)
				: false;
		case "attack_commenced":
		case "attacker_notification":
		case "defender_notification":
		case "evasion_attacker_notification":
		case "evasion_defender_notification":
			return false;
	}
}

export function observeSpellCastBusy(state: MageRuntimeState): void {
	if (state.spellcast.phase !== "awaiting_busy") {
		return;
	}

	state.spellcast = {
		phase: "active",
		request: state.spellcast.request,
		busySince: state.elapsedSeconds,
	};
	logMageInfo(
		`cast busy -> ${describeSpellcastRequest(state.spellcast.request)} at ${state.elapsedSeconds.toFixed(2)}s`,
	);
}

export function resolveSpellcastFromIdle(state: MageRuntimeState): boolean {
	if (state.spellcast.phase === "idle") {
		return false;
	}

	if (state.spellcast.phase === "awaiting_busy") {
		const pendingAge = state.elapsedSeconds - state.spellcast.request.issuedAt;
		if (pendingAge < PENDING_SPELL_BUSY_GRACE_SECONDS) {
			return false;
		}

		return finalizeSpellcast(state, { kind: "fizzled" }) != null;
	}

	if (
		state.spellcast.request.kind === "attack" ||
		state.spellcast.request.kind === "vulnerability"
	) {
		return false;
	}

	return finalizeSpellcast(state, { kind: "succeeded" }) != null;
}

export function resolveSpellcastFromTimeout(state: MageRuntimeState): boolean {
	const request = currentSpellcastRequest(state);
	if (request == null) {
		return false;
	}

	const timeoutSeconds =
		request.kind === "attack"
			? ATTACK_SPELL_TIMEOUT_SECONDS
			: PENDING_SPELL_TIMEOUT_SECONDS;

	if (state.elapsedSeconds - request.issuedAt < timeoutSeconds) {
		return false;
	}

	return (
		finalizeSpellcast(
			state,
			request.kind === "attack" ? { kind: "missed" } : { kind: "timed_out" },
		) != null
	);
}

export function resolveSpellcastFromWeenieError(
	state: MageRuntimeState,
): boolean {
	return interruptSpellcast(state, "weenie_error");
}

export function interruptSpellcast(
	state: MageRuntimeState,
	reason: MageSpellcastInterruptionReason,
): boolean {
	return (
		finalizeSpellcast(state, {
			kind: "interrupted",
			reason,
		}) != null
	);
}

export function cancelCombatPlanning(state: MageRuntimeState): boolean {
	const hadSpellcast = spellcastBlocksPlanning(state);
	const hadHealingKitUse = healingKitUseBlocksPlanning(state);
	const hadCombatTarget = state.combatTargetGuid != null;
	const hadMissHistory = state.attackPolicy.lastMissedAttackByTarget.size > 0;

	if (hadSpellcast) {
		interruptSpellcast(state, "teleport");
	}
	if (hadHealingKitUse) {
		clearHealingKitUse(state);
	}

	clearCombatTarget(state);
	state.attackPolicy.lastMissedAttackByTarget.clear();

	return hadSpellcast || hadHealingKitUse || hadCombatTarget || hadMissHistory;
}

export function hasRecentVulnerabilityCast(
	state: MageRuntimeState,
	targetGuid: Guid,
): boolean {
	const lastAppliedAt =
		state.vulnerabilityPolicy.lastSuccessfulVulnAtByTarget.get(targetGuid);
	return (
		lastAppliedAt != null &&
		state.elapsedSeconds - lastAppliedAt < VULN_REPEAT_SECONDS
	);
}

export function failedVulnAttemptCount(
	state: MageRuntimeState,
	targetGuid: Guid,
): number {
	return (
		state.vulnerabilityPolicy.failedVulnAttemptsByTarget.get(targetGuid) ?? 0
	);
}

export function hasRecentMissedAttack(
	state: MageRuntimeState,
	self: ScriptSelfView,
	target: MonsterCandidate,
): boolean {
	const record = state.attackPolicy.lastMissedAttackByTarget.get(target.guid);
	if (record == null) {
		return false;
	}

	if (state.elapsedSeconds - record.missedAt >= PENDING_SPELL_TIMEOUT_SECONDS) {
		return false;
	}

	const currentRay = createAttackRaySnapshot(self.position, target.position);
	if (currentRay == null) {
		return false;
	}

	return isSimilarAttackRay(record.ray, currentRay);
}

export function vulnerabilityPolicyForTarget(
	state: MageRuntimeState,
	targetGuid: Guid,
): {
	failedVulnAttemptCount: number;
	recentlySucceeded: boolean;
} {
	return {
		failedVulnAttemptCount: failedVulnAttemptCount(state, targetGuid),
		recentlySucceeded: hasRecentVulnerabilityCast(state, targetGuid),
	};
}

export function clearVulnerabilityHistory(
	state: MageRuntimeState,
	targetGuid: Guid,
): void {
	state.vulnerabilityPolicy.lastSuccessfulVulnAtByTarget.delete(targetGuid);
	state.vulnerabilityPolicy.failedVulnAttemptsByTarget.delete(targetGuid);
}

export function clearHealingKitHistory(
	state: MageRuntimeState,
	targetGuid: Guid,
): void {
	if (state.healingKitPolicy.pendingUse?.targetGuid === targetGuid) {
		clearHealingKitUse(state);
	}
	state.healingKitPolicy.lastSuccessfulUseAtByTarget.delete(targetGuid);
}

export function hasRecentHealingKitSuccess(
	state: MageRuntimeState,
	targetGuid: Guid,
): boolean {
	const lastAppliedAt =
		state.healingKitPolicy.lastSuccessfulUseAtByTarget.get(targetGuid);
	return (
		lastAppliedAt != null &&
		state.elapsedSeconds - lastAppliedAt < HEALING_KIT_SUCCESS_GRACE_SECONDS
	);
}

export function clearVulnerabilityAttemptHistory(
	state: MageRuntimeState,
	targetGuid: Guid,
): void {
	state.vulnerabilityPolicy.failedVulnAttemptsByTarget.delete(targetGuid);
}

export function clearAttackHistory(
	state: MageRuntimeState,
	targetGuid: Guid,
): void {
	state.attackPolicy.lastMissedAttackByTarget.delete(targetGuid);
}

export function clearCombatTarget(state: MageRuntimeState): void {
	state.combatTargetGuid = null;
}

export function setCombatTarget(
	state: MageRuntimeState,
	targetGuid: Guid,
): void {
	state.combatTargetGuid = targetGuid;
}

export function isCombatTargetAlive(
	entity: ScriptEntityView | null | undefined,
): boolean {
	return entity != null && entity.motionCommand.kind !== "dead";
}

export function resolveCombatTarget(
	state: MageRuntimeState,
	self: ScriptSelfView,
	partyLeader: ScriptPartyMemberView | null,
	maxAttackRange: number,
): ScriptEntityView | null {
	const combatTargetGuid = state.combatTargetGuid;
	if (combatTargetGuid == null) {
		return null;
	}

	if (!HB.entityExists(combatTargetGuid)) {
		clearCombatTarget(state);
		return null;
	}

	const entity = HB.entity(combatTargetGuid);
	if (entity == null) {
		clearCombatTarget(state);
		return null;
	}
	if (!isCombatTargetAlive(entity)) {
		clearCombatTarget(state);
		return null;
	}

	const candidate = {
		guid: entity.guid,
		weenieId: entity.weenieId,
		position: entity.position,
		distanceToSelf: HB.distance(self.guid, entity.guid),
		distanceToParty:
			partyLeader != null ? HB.distance(partyLeader.guid, entity.guid) : 0,
	};
	if (
		!isMonsterCandidateInCombatRange(
			candidate,
			maxAttackRange,
			state.maxAggroDistance,
		)
	) {
		clearCombatTarget(state);
		return null;
	}

	return entity;
}

export function followPartyLeader(
	state: MageRuntimeState,
	self: ScriptSelfView,
	partyLeader: ScriptPartyMemberView | null,
): boolean {
	const currentInteraction = HB.currentInteraction();

	if (partyLeader == null) {
		if (currentInteraction?.kind === "Follow") {
			HB.cancelInteraction();
		}
		return false;
	}

	if (partyLeader.guid === self.guid) {
		if (
			currentInteraction?.kind === "Follow" &&
			currentInteraction.data.guid !== partyLeader.guid
		) {
			HB.cancelInteraction();
		}
		return false;
	}

	if (
		currentInteraction?.kind === "Follow" &&
		currentInteraction.data.guid === partyLeader.guid
	) {
		return true;
	}

	return issueAction(
		state,
		`follow:${partyLeader.guid}`,
		FOLLOW_REPEAT_SECONDS,
		() => {
			logMageInfo(`follow -> ${partyLeader.guid}`);
			if (currentInteraction != null) {
				HB.cancelInteraction();
			}
			HB.follow(partyLeader.guid);
		},
	);
}

export function firstHealingKit(): Guid | null {
	for (const container of HB.inventory()) {
		for (const itemGuid of container.items) {
			const item = HB.entity(itemGuid);
			if (item?.kind === "healing_kit") {
				return item.guid;
			}
		}
	}

	return null;
}

export function useHealingKitOnTarget(
	state: MageRuntimeState,
	targetGuid: Guid,
): boolean {
	if (healingKitUseBlocksPlanning(state)) {
		return false;
	}

	if (hasRecentHealingKitSuccess(state, targetGuid)) {
		return false;
	}

	const kitGuid = firstHealingKit();
	if (kitGuid == null) {
		return false;
	}

	const target = HB.entity(targetGuid);
	state.healingKitPolicy.pendingUse = {
		targetGuid,
		targetName: normalizeCastName(target?.name?.trim() ?? null),
		kitGuid,
		issuedAt: state.elapsedSeconds,
	};
	logMageInfo(
		`heal-kit start -> ${describeHealingKitUse(state.healingKitPolicy.pendingUse)} at ${state.elapsedSeconds.toFixed(2)}s`,
	);
	HB.useWith(kitGuid, targetGuid);
	return true;
}

export function healingKitUseBlocksPlanning(state: MageRuntimeState): boolean {
	return state.healingKitPolicy.pendingUse != null;
}

export function resolveHealingKitUseFromChatMessage(
	state: MageRuntimeState,
	chatEvent: Pick<ScriptChatEvent, "sender" | "message">,
	targetName: string | null,
): boolean {
	const request = state.healingKitPolicy.pendingUse;
	if (request == null) {
		return false;
	}

	const expectedTargetName = request.targetName ?? targetName;
	if (expectedTargetName == null) {
		return false;
	}

	if (isHealingKitFailureMessage(chatEvent, expectedTargetName)) {
		clearHealingKitUse(state);
		logMageInfo(
			`heal-kit failed -> ${describeHealingKitUse(request)} at ${state.elapsedSeconds.toFixed(2)}s`,
		);
		return true;
	}

	if (isHealingKitSuccessMessage(chatEvent, expectedTargetName)) {
		state.healingKitPolicy.lastSuccessfulUseAtByTarget.set(
			request.targetGuid,
			state.elapsedSeconds,
		);
		clearHealingKitUse(state);
		logMageInfo(
			`heal-kit succeeded -> ${describeHealingKitUse(request)} at ${state.elapsedSeconds.toFixed(2)}s`,
		);
		return true;
	}

	return false;
}

export function resolveHealingKitUseFromTimeout(
	state: MageRuntimeState,
): boolean {
	const request = state.healingKitPolicy.pendingUse;
	if (request == null) {
		return false;
	}

	if (state.elapsedSeconds - request.issuedAt < PENDING_SPELL_TIMEOUT_SECONDS) {
		return false;
	}

	clearHealingKitUse(state);
	logMageInfo(
		`heal-kit timeout -> ${describeHealingKitUse(request)} at ${state.elapsedSeconds.toFixed(2)}s`,
	);
	return true;
}

export function clearNonMageInteraction(state: MageRuntimeState): boolean {
	const interaction = HB.currentInteraction();
	if (interaction?.kind !== "Attack" && interaction?.kind !== "Approach") {
		return false;
	}

	return issueAction(
		state,
		`cancel:${interaction.kind}:${interaction.data.guid}`,
		0.5,
		() => {
			HB.cancelInteraction();
		},
	);
}

function createSpellcastRequest(
	state: MageRuntimeState,
	spell: MageSpellRecord,
	targetGuid: Guid | null,
): MageSpellcastRequest {
	const self = HB.selfEntity();
	const target = targetGuid == null ? null : HB.entity(targetGuid);
	const targetName = normalizeCastName(target?.name?.trim() ?? null);

	return {
		spellName: normalizeCastName(spell.name ?? null),
		targetName,
		spellId: spell.spellId,
		targetGuid,
		damageType: spell.damageType,
		kind: spellcastKindForSpell(spell),
		issuedAt: state.elapsedSeconds,
		attackRay:
			spell.type === "attack" && self != null && target != null
				? createAttackRaySnapshot(self.position, target.position)
				: null,
	};
}

function spellcastKindForSpell(spell: MageSpellRecord): MageSpellcastKind {
	switch (spell.type) {
		case "attack":
			return "attack";
		case "vuln":
			return "vulnerability";
		case "heal":
			return "heal";
		case "revitalize":
			return "revitalize";
		default:
			return "transfer";
	}
}

function finalizeSpellcast(
	state: MageRuntimeState,
	outcome: MageSpellcastOutcome,
): MageResolvedSpellcast | null {
	const request = currentSpellcastRequest(state);
	if (request == null) {
		return null;
	}

	const resolution = {
		request,
		outcome,
		resolvedAt: state.elapsedSeconds,
	} satisfies MageResolvedSpellcast;

	applyAttackOutcome(state, resolution);
	applyVulnerabilityOutcome(state, resolution);
	logSpellcastResolution(state, resolution);
	state.spellcast = { phase: "idle" };
	return resolution;
}

function applyAttackOutcome(
	state: MageRuntimeState,
	resolution: MageResolvedSpellcast,
): void {
	const targetGuid = resolution.request.targetGuid;
	if (resolution.request.kind !== "attack" || targetGuid == null) {
		return;
	}

	if (resolution.outcome.kind === "missed") {
		if (resolution.request.attackRay != null) {
			state.attackPolicy.lastMissedAttackByTarget.set(targetGuid, {
				missedAt: state.elapsedSeconds,
				ray: resolution.request.attackRay,
			});
		}
		if (state.combatTargetGuid === targetGuid) {
			clearCombatTarget(state);
		}
		return;
	}

	state.attackPolicy.lastMissedAttackByTarget.delete(targetGuid);
}

function applyVulnerabilityOutcome(
	state: MageRuntimeState,
	resolution: MageResolvedSpellcast,
): void {
	const targetGuid = resolution.request.targetGuid;
	if (resolution.request.kind !== "vulnerability" || targetGuid == null) {
		return;
	}

	switch (resolution.outcome.kind) {
		case "succeeded":
			state.vulnerabilityPolicy.lastSuccessfulVulnAtByTarget.set(
				targetGuid,
				state.elapsedSeconds,
			);
			state.vulnerabilityPolicy.failedVulnAttemptsByTarget.delete(targetGuid);
			return;
		case "resisted":
		case "fizzled":
		case "timed_out":
			incrementVulnerabilityAttempt(state, targetGuid);
			return;
		case "interrupted":
			if (resolution.outcome.reason === "weenie_error") {
				incrementVulnerabilityAttempt(state, targetGuid);
			}
			return;
	}
}

function incrementVulnerabilityAttempt(
	state: MageRuntimeState,
	targetGuid: Guid,
): number {
	const nextAttemptCount = failedVulnAttemptCount(state, targetGuid) + 1;
	state.vulnerabilityPolicy.failedVulnAttemptsByTarget.set(
		targetGuid,
		nextAttemptCount,
	);
	return nextAttemptCount;
}

function logSpellcastResolution(
	state: MageRuntimeState,
	resolution: MageResolvedSpellcast,
): void {
	const description = describeSpellcastRequest(resolution.request);
	const resolvedAt = state.elapsedSeconds.toFixed(2);

	switch (resolution.outcome.kind) {
		case "succeeded":
			if (resolution.request.kind === "vulnerability") {
				logMageInfo(`cast landed vuln -> ${description} at ${resolvedAt}s`);
				return;
			}

			if (resolution.request.kind === "attack") {
				logMageInfo(`cast landed attack -> ${description} at ${resolvedAt}s`);
				return;
			}

			logMageInfo(`cast completed -> ${description} at ${resolvedAt}s`);
			return;
		case "resisted":
			logMageInfo(`cast resisted -> ${description} at ${resolvedAt}s`);
			return;
		case "fizzled":
			logMageInfo(`cast fizzled -> ${description} at ${resolvedAt}s`);
			return;
		case "missed":
			logMageInfo(`cast missed attack -> ${description} at ${resolvedAt}s`);
			return;
		case "timed_out":
			logMageInfo(`cast timeout -> ${description} at ${resolvedAt}s`);
			return;
		case "interrupted":
			logMageInfo(
				`cast interrupted -> ${description} reason=${resolution.outcome.reason} at ${resolvedAt}s`,
			);
			return;
	}
}

function isResistMessage(
	chatEvent: Pick<ScriptChatEvent, "sender" | "message">,
	targetName: string | null,
): boolean {
	const message = chatEvent.message.trim().toLowerCase();
	if (!message.endsWith("resists your spell")) {
		return false;
	}

	if (targetName == null) {
		return true;
	}

	const normalizedTargetName = targetName.trim().toLowerCase();
	if (normalizedTargetName.length === 0) {
		return false;
	}

	const expectedMessage = `${normalizedTargetName} resists your spell`;
	const sender = chatEvent.sender?.trim().toLowerCase();
	if (sender == null || sender.length === 0) {
		return message === expectedMessage;
	}

	return sender === normalizedTargetName && message === expectedMessage;
}

function isVulnerabilityLandingMessage(
	request: MageSpellcastRequest,
	chatEvent: Pick<ScriptChatEvent, "sender" | "message">,
	targetName: string | null,
): boolean {
	if (targetName == null || request.spellName == null) {
		return false;
	}

	const message = normalizeChatMessage(chatEvent.message);
	const expectedPrefix = `you cast ${normalizeChatMessage(request.spellName)} on ${normalizeChatMessage(targetName)}`;
	return message.startsWith(expectedPrefix);
}

function isAttackLandingMessage(
	request: MageSpellcastRequest,
	chatEvent: Pick<ScriptChatEvent, "sender" | "message">,
	targetName: string | null,
): boolean {
	logMageInfo(
		`checking attack landing -> message="${chatEvent.message}" targetName="${targetName}" spellName="${request.spellName}"`,
	);
	if (targetName == null || request.spellName == null) {
		return false;
	}

	const message = normalizeChatMessage(chatEvent.message);
	const spellName = normalizeChatMessage(request.spellName);
	const normalizedTargetName = normalizeChatMessage(targetName);

	if (
		message.startsWith("you ") &&
		message.includes(` ${normalizedTargetName} `) &&
		message.includes(` with ${spellName}.`)
	) {
		return true;
	}

	return (
		message.startsWith(`with ${spellName} you drain `) &&
		message.endsWith(` from ${normalizedTargetName}.`)
	);
}

function isAttackBlockedMessage(
	chatEvent: Pick<ScriptChatEvent, "sender" | "message">,
	targetName: string | null,
): boolean {
	if (targetName == null) {
		return false;
	}

	const message = normalizeChatMessage(chatEvent.message);
	const normalizedTargetName = normalizeChatMessage(targetName);
	return (
		message ===
		`the lifestone's magic protects ${normalizedTargetName} from the attack!`
	);
}

function normalizeChatMessage(message: string): string {
	return message.trim().toLowerCase();
}

function normalizeCastName(name: string | null): string | null {
	if (name == null) {
		return null;
	}

	const trimmed = name.trim();
	return trimmed.length === 0 ? null : trimmed;
}

function createAttackRaySnapshot(
	from: WorldPosition,
	to: WorldPosition,
): AttackRaySnapshot | null {
	if (!isMeaningfulAttackRay(from, to)) {
		return null;
	}

	return {
		from: cloneWorldPosition(from),
		to: cloneWorldPosition(to),
	};
}

function isSimilarAttackRay(
	left: AttackRaySnapshot,
	right: AttackRaySnapshot,
): boolean {
	if (
		left.from.landblockId !== right.from.landblockId ||
		left.to.landblockId !== right.to.landblockId
	) {
		return false;
	}

	const leftVector = attackVectorBetween(left.from, left.to);
	const rightVector = attackVectorBetween(right.from, right.to);
	if (leftVector == null || rightVector == null) {
		return false;
	}

	const leftDistance = vectorLength(leftVector);
	const rightDistance = vectorLength(rightVector);
	if (
		attackDistanceBucket(leftDistance) !== attackDistanceBucket(rightDistance)
	) {
		return false;
	}

	const leftDirection = normalizeVector(leftVector, leftDistance);
	const rightDirection = normalizeVector(rightVector, rightDistance);
	if (leftDirection == null || rightDirection == null) {
		return false;
	}

	const dotProduct =
		leftDirection.x * rightDirection.x +
		leftDirection.y * rightDirection.y +
		leftDirection.z * rightDirection.z;
	return dotProduct >= 0.995;
}

function attackVectorBetween(
	from: WorldPosition,
	to: WorldPosition,
): Vector3 | null {
	if (from.landblockId !== to.landblockId) {
		return null;
	}

	return {
		x: to.coords.x - from.coords.x,
		y: to.coords.y - from.coords.y,
		z: to.coords.z - from.coords.z,
	};
}

function vectorLength(vector: Vector3): number {
	return Math.sqrt(
		vector.x * vector.x + vector.y * vector.y + vector.z * vector.z,
	);
}

function normalizeVector(vector: Vector3, length: number): Vector3 | null {
	if (length === 0) {
		return null;
	}

	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length,
	};
}

function attackDistanceBucket(distance: number): number {
	return Math.floor(distance / 2);
}

function cloneWorldPosition(position: WorldPosition): WorldPosition {
	return {
		landblockId: position.landblockId,
		coords: {
			x: position.coords.x,
			y: position.coords.y,
			z: position.coords.z,
		},
		rotation: {
			w: position.rotation.w,
			x: position.rotation.x,
			y: position.rotation.y,
			z: position.rotation.z,
		},
	};
}

function isMeaningfulAttackRay(
	from: WorldPosition,
	to: WorldPosition,
): boolean {
	return attackVectorBetween(from, to) != null;
}

function describeSpellcastRequest(request: {
	spellId: number;
	targetGuid: Guid | null;
	damageType: string | null;
	kind: MageSpellcastKind;
}): string {
	return `${request.kind}:${request.spellId}${request.damageType == null ? "" : `:${request.damageType}`}${request.targetGuid == null ? "" : `:${request.targetGuid}`}`;
}

function describeHealingKitUse(request: {
	targetGuid: Guid;
	targetName: string | null;
	kitGuid: Guid;
}): string {
	return `${request.targetGuid}${request.targetName == null ? "" : `:${request.targetName}`}:${request.kitGuid}`;
}

function clearHealingKitUse(state: MageRuntimeState): void {
	state.healingKitPolicy.pendingUse = null;
}

function isHealingKitFailureMessage(
	chatEvent: Pick<ScriptChatEvent, "sender" | "message">,
	targetName: string | null,
): boolean {
	if (!isOwnHealingChatSender(chatEvent)) {
		return false;
	}

	const message = normalizeChatMessage(chatEvent.message);
	if (targetName == null) {
		return (
			message.startsWith("you fail to heal ") ||
			message.endsWith(" fails to heal you.")
		);
	}

	const normalizedTargetName = normalizeChatMessage(targetName);
	return (
		message === `you fail to heal ${normalizedTargetName}.` ||
		(message.endsWith(" fails to heal you.") &&
			message.includes(normalizedTargetName))
	);
}

function isHealingKitSuccessMessage(
	chatEvent: Pick<ScriptChatEvent, "sender" | "message">,
	targetName: string | null,
): boolean {
	if (!isOwnHealingChatSender(chatEvent)) {
		return false;
	}

	const message = normalizeChatMessage(chatEvent.message);
	if (targetName == null) {
		return (
			message.startsWith("you heal ") || message.includes(" heals you for ")
		);
	}

	const normalizedTargetName = normalizeChatMessage(targetName);
	return (
		message.startsWith(`you heal ${normalizedTargetName} for `) ||
		(message.includes(` ${normalizedTargetName} `) &&
			message.includes(" heals you for "))
	);
}

function isOwnHealingChatSender(
	chatEvent: Pick<ScriptChatEvent, "sender" | "message">,
): boolean {
	const sender = normalizeCastName(chatEvent.sender?.trim() ?? null);
	if (sender == null) {
		return true;
	}

	const selfName = normalizeCastName(HB.selfEntity()?.name?.trim() ?? null);
	if (selfName == null) {
		return true;
	}

	return sender.toLowerCase() === selfName.toLowerCase();
}
