import { runMage } from "./engine";
import { MAX_PARTY_DISTANCE } from "./constants";
import { loadMageConfig } from "./runtime-config";
import { filterMageDataSpells, loadMageDataWithStatus } from "./runtime-data";
import { entitySummary } from "./runtime-helpers";
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
import type { MageCombatFeedback } from "./types";

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
			: (entitySummary(HB.entity(spellcastRequest.targetGuid))?.name?.trim() ??
				null));

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

function handleApiEvent(apiEvent: JsonObject): void {
	const kind = typeof apiEvent.kind === "string" ? apiEvent.kind : "";
	switch (kind) {
		case "chat":
		case "tell":
		case "channel-message": {
			const message =
				typeof apiEvent.message === "string" ? apiEvent.message : "";
			const speaker = apiEvent.speaker as { name?: unknown } | null | undefined;
			const sender = typeof speaker?.name === "string" ? speaker.name : null;
			handleMessageEvent(message, sender, kind);
			return;
		}
		case "combat-feedback": {
			const detail = apiEvent.detail as MageCombatFeedback | undefined;
			if (detail != null && resolveSpellcastFromCombatFeedback(state, detail)) {
				runMage(state);
			}
			return;
		}
		case "teleport-started": {
			cancelCombatPlanning(state);
			return;
		}
		case "error-notice": {
			if (
				apiEvent.source === "weenie" &&
				resolveSpellcastFromWeenieError(state)
			) {
				runMage(state);
			}
			return;
		}
		case "busy-state-changed": {
			if (apiEvent.busy === "spell-cast") {
				observeSpellCastBusy(state);
			}
			if (apiEvent.busy == null) {
				resolveSpellcastFromIdle(state);
				runMage(state);
			}
			return;
		}
		case "entity-despawned": {
			const guid = typeof apiEvent.guid === "number" ? apiEvent.guid : null;
			if (guid == null) {
				return;
			}
			if (state.combatTargetGuid === guid) {
				clearCombatTarget(state);
			}
			clearAttackHistory(state, guid);
			clearHealingKitHistory(state, guid);
			clearVulnerabilityAttemptHistory(state, guid);
			return;
		}
		default:
			return;
	}
}

HB.onEvent((event) => {
	switch (event.kind) {
		case "started": {
			resetState(state);
			const loadStatus = loadMageDataWithStatus();
			state.config = loadMageConfig(loadStatus.data);
			state.data = filterMageDataSpells(
				loadStatus.data,
				state.config.bannedSpellIds,
			);
			state.maxPartyDistance =
				parsePositiveNumberArg(event.args, "max-party-dist") ??
				MAX_PARTY_DISTANCE;
			state.maxAggroDistance =
				parsePositiveNumberArg(event.args, "aggro-dist") ??
				state.maxAggroDistance;
			logMageInfo("started");
			if (state.data == null) {
				HB.print(
					`mage script started without usable mage data (json=${loadStatus.hasJson}, bin=${loadStatus.hasBin})`,
					"warn",
				);
			} else {
				HB.print(
					`loaded mage data: ${Object.keys(state.data.spells).length} spells, ${Object.keys(state.data.skills).length} skills`,
					"info",
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
			state.elapsedSeconds += event.elapsed;
			runMage(state);
			return;
		}
		case "api": {
			handleApiEvent(event.event);
			return;
		}
		default:
			return;
	}
});
