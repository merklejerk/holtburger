import { runMage } from "./engine";
import { MAX_PARTY_DISTANCE } from "./constants";
import { loadMageConfig } from "./runtime-config";
import { filterMageDataSpells, loadMageDataWithStatus } from "./runtime-data";
import { createInitialState, resetState } from "./state";
import {
	cancelCombatPlanning,
	clearAttackHistory,
	clearCombatTarget,
	clearHealingKitHistory,
	clearVulnerabilityAttemptHistory,
	currentSpellcastRequest,
	observeSpellCastBusy,
	logMageInfo,
	resolveSpellcastFromCombatFeedback,
	resolveSpellcastFromChatMessage,
	resolveSpellcastFromIdle,
	resolveSpellcastFromWeenieError,
	resolveHealingKitUseFromChatMessage,
} from "./runtime-actions";

const state = createInitialState();

function parsePositiveNumberArg(args: string, flagName: string): number | null {
	const prefix = `${flagName}=`;
	const token = args
		.trim()
		.split(/\s+/)
		.find((candidate) => candidate.startsWith(prefix));
	if (token == null) {
		return null;
	}

	const parsed = Number(token.slice(prefix.length));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function handleMessageEvent(
	message: string,
	sender: string | null,
	sourceLabel: string,
): void {
	const spellcastRequest = currentSpellcastRequest(state);
	const pendingTargetName =
		spellcastRequest?.targetName ??
		(spellcastRequest?.targetGuid == null
			? null
			: (HB.entity(spellcastRequest.targetGuid)?.name?.trim() ?? null));

	logMageInfo(
		`${sourceLabel} received: message="${message}" pendingTargetName="${pendingTargetName}"`,
	);
	if (
		resolveHealingKitUseFromChatMessage(
			state,
			{ sender, message },
			pendingTargetName,
		) ||
		resolveSpellcastFromChatMessage(
			state,
			{ sender, message },
			pendingTargetName,
		)
	) {
		runMage(state);
	}
}

function handleCombatFeedbackEvent(feedback: ScriptCombatFeedback): void {
	if (resolveSpellcastFromCombatFeedback(state, feedback)) {
		runMage(state);
	}
}

HB.onEvent((event) => {
	switch (event.kind) {
		case "chat_message": {
			handleMessageEvent(event.data.message, event.data.sender, "chat_message");
			return;
		}
		case "combat_feedback": {
			handleCombatFeedbackEvent(event.data);
			return;
		}
		case "teleport_started": {
			cancelCombatPlanning(state);
			return;
		}
		case "weenie_error": {
			if (resolveSpellcastFromWeenieError(state)) {
				runMage(state);
			}
			return;
		}
		case "workflow": {
			if (event.data.kind === "busy_operation_changed") {
				if (event.data.data.busy === "spell_cast") {
					observeSpellCastBusy(state);
				}

				if (event.data.data.busy === "none") {
					resolveSpellcastFromIdle(state);
					runMage(state);
					return;
				}
			}
			return;
		}
		case "entity_disappeared": {
			if (state.combatTargetGuid === event.data.guid) {
				clearCombatTarget(state);
			}
			clearAttackHistory(state, event.data.guid);
			clearHealingKitHistory(state, event.data.guid);
			clearVulnerabilityAttemptHistory(state, event.data.guid);
			return;
		}
		case "lifecycle": {
			switch (event.data.kind) {
				case "started": {
					resetState(state);
					const loadStatus = loadMageDataWithStatus();
					state.config = loadMageConfig(loadStatus.data);
					state.data = filterMageDataSpells(
						loadStatus.data,
						state.config.bannedSpellIds,
					);
					state.maxPartyDistance =
						parsePositiveNumberArg(event.data.data.args, "max-party-dist") ??
						MAX_PARTY_DISTANCE;
					state.maxAggroDistance =
						parsePositiveNumberArg(event.data.data.args, "aggro-dist") ??
						state.maxAggroDistance;
					logMageInfo("started");
					if (state.data == null) {
						HB.print(
							"warn",
							`mage script started without usable mage data (json=${loadStatus.hasJson}, bin=${loadStatus.hasBin})`,
						);
					} else {
						HB.print(
							"info",
							`loaded mage data: ${Object.keys(state.data.spells).length} spells, ${Object.keys(state.data.skills).length} skills`,
						);
					}
					runMage(state);
					return;
				}
				case "stopped": {
					resetState(state);
					return;
				}
				case "tick": {
					state.elapsedSeconds += event.data.data.elapsedSeconds;
					runMage(state);
					return;
				}
			}
			return;
		}
		default:
			return;
	}
});
