import { entityDisplayName } from "../lib/game/entity-display-name";
import type { SceneInterestMembership } from "../lib/game/runtime/render-scene-interest-controller";
import type {
	ClientLifecycleSessionEvent,
	ClientLifecycleSessionState,
} from "./client-lifecycle-session";
import type { ClientEntityMirror } from "./client-entity-mirror";
import type { DynamicEntityMirror } from "../lib/game/runtime/dynamic-entity-feed";
import type { ClientCharacterSettingsState } from "./client-character-settings-owner";
import type { ClientChatEntry } from "./client-chat-policy";
import {
	compileEntityAlert,
	entityAlertRulesSchema,
	type EntityAlertRule,
} from "./client-entity-alerts";
import { nearbyLocation, type NearbyRow } from "./client-nearby-policy";
import {
	dynamicEntityResidency,
	dynamicEntityWorldOrigin,
} from "../lib/game/runtime/dynamic-entity-presentation";
import type {
	DynamicEntityView,
	DynamicEntityWorldPlacement,
} from "../lib/game/runtime/dynamic-entity-feed";

/** Local encounter metadata only: authoritative entity and pose facts remain in session mirrors. */
interface Encounter {
	/** Confirmed departure begins a bounded suppression grace period. */
	absentAt: number | null;
	/** A matching encounter was announced or silently accepted during a rule edit. */
	detected: boolean;
	/** Enabled matching rule IDs for current tracking, independent of notification suppression. */
	matchingRules: readonly string[];
}

/** Nearby consumes lifecycle edges, not unrelated event payloads. */
export type NearbySessionEvent =
	| { readonly type: Exclude<ClientLifecycleSessionEvent["type"], "dynamic"> }
	| Extract<ClientLifecycleSessionEvent, { type: "dynamic" }>;

/** Services injected by the client composition root, with test-owned clocks/timing policy. */
interface NearbyOptions {
	/** Accepted sources and lifecycle; neither rendered geometry nor a panel supplies these. */
	readonly session: {
		readonly entities: Pick<ClientEntityMirror, "read">;
		readonly mirror: Pick<
			DynamicEntityMirror,
			"currentEntities" | "isAwaitingSnapshot"
		>;
		state(): Pick<
			ClientLifecycleSessionState,
			"playerGuid" | "lifecycle" | "worldName"
		>;
		subscribe(listener: (event: NearbySessionEvent) => void): () => void;
	};
	/** Local milliseconds used by encounter suppression and notification batching. */
	readonly now: () => number;
	/** App policy injected independently from test clocks. */
	readonly timing: {
		readonly absenceGraceMs: number;
		readonly notificationBatchMs: number;
	};
	/** Existing retained chat owner receives complete detection batches. */
	readonly appendChat: (entry: ClientChatEntry) => void;
	/** Existing settings owner persists only validated rules for the current character. */
	readonly saveRules: (rules: readonly EntityAlertRule[]) => void;
}

/** Session-lifetime catalog and alerts; neither HUD mounting nor renderer residency owns detection. */
export class ClientNearby {
	readonly #options: NearbyOptions;
	readonly #unsubscribe: () => void;
	#sceneMembership: SceneInterestMembership | null = null;
	#unsubscribeScene: (() => void) | null = null;
	readonly #encounters = new Map<number, Encounter>();
	#rules: readonly EntityAlertRule[] = [];
	#matchers: readonly { id: string; matches: (name: string) => boolean }[] = [];
	#character: number | null = null;
	#world: string | null = null;
	#settingsReady = false;
	#recovering = false;
	#destroyed = false;
	#tracked: ReadonlySet<number> = new Set();
	/** Preserve detection identity alongside historical name and location until batch publication. */
	#queued: { guid: number; name: string; location: string }[] = [];
	#batchTimer: ReturnType<typeof setTimeout> | null = null;
	#expiryTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(options: NearbyOptions) {
		this.#options = options;
		this.#unsubscribe = options.session.subscribe((event) => {
			if (event.type === "resyncing") {
				this.#recovering = true;
				return;
			}
			if (event.type === "current-state") this.#recovering = false;
			if (
				event.type === "dynamic" &&
				event.event.kind === "ticked" &&
				event.event.batch.updates.length === 0 &&
				!event.event.batch.advances.some(({ entity }) =>
					this.#advanceChangesMembership(entity),
				)
			)
				return;
			if (
				event.type === "entities" ||
				event.type === "dynamic" ||
				event.type === "current-state" ||
				event.type === "lifecycle"
			)
				this.#reconcile("announce");
		});
	}

	/** Rebind when the presentation runtime starts/stops; hidden HUD windows do not own this. */
	setSceneMembership(source: SceneInterestMembership | null): void {
		this.#unsubscribeScene?.();
		this.#sceneMembership = source;
		this.#unsubscribeScene =
			source === null
				? null
				: source.subscribe(() => this.#reconcile("announce"));
		this.#reconcile("announce");
	}

	/** Called directly by the settings owner; late hydration scans the current accepted baseline. */
	acceptSettings(state: ClientCharacterSettingsState): void {
		if (this.#destroyed) return;
		const character = state.kind === "absent" ? null : state.characterGuid;
		const ready = state.kind === "ready";
		const rules = state.kind === "ready" ? state.settings.entityAlerts : [];
		// Combat controls and other character preferences publish through the same
		// owner. Their changes must not compile alerts or scan the entity population.
		if (
			character === this.#character &&
			ready === this.#settingsReady &&
			rules === this.#rules
		)
			return;
		if (character !== this.#character) {
			this.#reset();
			this.#character = character;
		}
		this.#settingsReady = ready;
		this.#setRules(rules);
		this.#reconcile("announce");
	}

	/** Rules are cold preferences; invalid edits fail before any runtime or persistence change. */
	changeRules(
		characterGuid: number,
		rules: readonly EntityAlertRule[],
	): boolean {
		if (
			!this.#settingsReady ||
			this.#destroyed ||
			characterGuid !== this.#character
		)
			return false;
		const valid = entityAlertRulesSchema.parse(rules);
		this.#setRules(valid);
		this.#reconcile("silent");
		this.#options.saveRules(valid);
		return true;
	}

	rules(): readonly EntityAlertRule[] {
		return this.#rules;
	}

	/** Read by the minimap on its existing imperative cadence. */
	trackedGuids(): ReadonlySet<number> {
		return this.#available() ? this.#tracked : EMPTY_GUIDS;
	}

	/** One linear pose pass serves all visible row distances; no repeated per-row feed scans. */
	read(): {
		readonly characterGuid: number | null;
		readonly ready: boolean;
		readonly rows: readonly NearbyRow[];
		readonly rules: readonly EntityAlertRule[];
		readonly editable: boolean;
	} {
		const available = this.#available();
		const rows: NearbyRow[] = [];
		const read = this.#options.session.entities.read();
		if (available && read.kind === "current") {
			const poses = this.#poses();
			const playerPose =
				read.level.playerGuid === null
					? undefined
					: poses.get(read.level.playerGuid);
			const player =
				playerPose === undefined ? null : dynamicEntityWorldOrigin(playerPose);
			for (const [guid, encounter] of this.#encounters) {
				if (encounter.absentAt !== null) continue;
				const entity = read.level.entities.get(guid);
				const pose = poses.get(guid);
				if (
					entity?.nearby == null ||
					pose === undefined ||
					this.#sceneMembership?.contains(dynamicEntityResidency(pose)) !== true
				)
					continue;
				const target = dynamicEntityWorldOrigin(pose);
				rows.push({
					guid,
					facts: entity.nearby,
					corpse: entity.corpse,
					location: this.#location(pose),
					distance:
						player === null
							? null
							: Math.hypot(
									player.x - target.x,
									player.y - target.y,
									player.z - target.z,
								),
					matchingRules: encounter.matchingRules,
				});
			}
		}
		return {
			characterGuid: this.#character,
			ready: available,
			rows,
			rules: this.#rules,
			editable: this.#settingsReady,
		};
	}

	destroy(): void {
		this.#destroyed = true;
		this.#unsubscribe();
		this.#unsubscribeScene?.();
		this.#unsubscribeScene = null;
		this.#reset();
	}

	#setRules(rules: readonly EntityAlertRule[]): void {
		if (rules === this.#rules) return;
		this.#rules = rules;
		this.#matchers = rules
			.filter((rule) => rule.enabled)
			.map((rule) => ({
				id: rule.id,
				matches: compileEntityAlert(rule.match),
			}));
		const enabled = new Set(this.#matchers.map(({ id }) => id));
		// Retire disabled tracking memberships even when a missing pose prevents
		// re-evaluation. Encounter notification suppression survives these edits.
		for (const encounter of this.#encounters.values())
			encounter.matchingRules = encounter.matchingRules.filter((id) =>
				enabled.has(id),
			);
	}

	#available(): boolean {
		const { session } = this.#options;
		return (
			!this.#destroyed &&
			!this.#recovering &&
			this.#settingsReady &&
			session.state().playerGuid === this.#character &&
			session.state().lifecycle?.kind === "in-world" &&
			session.entities.read().kind === "current" &&
			!session.mirror.isAwaitingSnapshot()
		);
	}

	/** Movement ticks only trigger a population scan when a catalog root crosses scene demand. */
	#advanceChangesMembership(entity: DynamicEntityView): boolean {
		if (
			entity.placement.kind !== "world" ||
			entity.identity.guid === this.#options.session.state().playerGuid
		)
			return false;
		const membership = this.#sceneMembership?.contains(
			dynamicEntityResidency(entity.placement),
		);
		if (membership == null) return false;
		const encounter = this.#encounters.get(entity.identity.guid);
		if (encounter === undefined) {
			if (!membership) return false;
			const read = this.#options.session.entities.read();
			return (
				read.kind === "current" &&
				read.level.entities.get(entity.identity.guid)?.nearby != null
			);
		}
		return membership
			? encounter.absentAt !== null
			: encounter.absentAt === null;
	}

	/** Scene demand already carries the profile-resolved distinction between mixed owners and dungeons. */
	#location(pose: DynamicEntityWorldPlacement) {
		return nearbyLocation(
			pose,
			this.#sceneMembership?.surfaceMapEligible(
				dynamicEntityResidency(pose),
			) === true,
		);
	}

	#poses(): Map<number, DynamicEntityWorldPlacement> {
		const poses = new Map<number, DynamicEntityWorldPlacement>();
		for (const entity of this.#options.session.mirror.currentEntities()) {
			if (entity.placement.kind === "world")
				poses.set(entity.identity.guid, entity.placement);
		}
		return poses;
	}

	#reconcile(notifications: "announce" | "silent"): void {
		const state = this.#options.session.state();
		if (
			state.lifecycle?.kind === "character-selection" ||
			state.lifecycle?.kind === "exiting"
		)
			this.#reset();
		if (!this.#available()) return;
		if (this.#world !== state.worldName) {
			this.#reset();
			this.#world = state.worldName;
		}
		const read = this.#options.session.entities.read();
		if (read.kind !== "current") return;
		const now = this.#options.now();
		const poses = this.#poses();
		const present = new Set<number>();
		const tracked = new Set<number>();
		for (const [guid, entity] of read.level.entities) {
			if (guid === read.level.playerGuid || entity.nearby === null) continue;
			const pose = poses.get(guid);
			if (
				pose === undefined ||
				this.#sceneMembership?.contains(dynamicEntityResidency(pose)) !== true
			)
				continue;
			present.add(guid);
			let encounter = this.#encounters.get(guid);
			if (
				encounter === undefined ||
				(encounter.absentAt !== null &&
					now - encounter.absentAt >= this.#options.timing.absenceGraceMs)
			) {
				encounter = { absentAt: null, detected: false, matchingRules: [] };
				this.#encounters.set(guid, encounter);
			}
			const name = entity.nearby.name;
			const matchingRules = this.#matchers
				.filter(({ matches }) => matches(name))
				.map(({ id }) => id);
			if (matchingRules.length > 0) {
				tracked.add(guid);
				if (!encounter.detected) {
					if (notifications === "announce")
						this.#queue(guid, entity.nearby.name, this.#location(pose).text);
					// Silent matches seed the encounter too, so a subsequent world
					// update cannot announce an entity already covered by the edit.
					encounter.detected = true;
				}
			}
			encounter.matchingRules = matchingRules;
			encounter.absentAt = null;
		}
		for (const [guid, encounter] of this.#encounters) {
			if (present.has(guid)) continue;
			if (
				encounter.absentAt !== null &&
				now - encounter.absentAt >= this.#options.timing.absenceGraceMs
			) {
				this.#encounters.delete(guid);
				continue;
			}
			// Semantic independence can arrive before the first pose. Once an entity has
			// been observed, a pose-only gap is not authoritative departure evidence.
			const pose = poses.get(guid);
			if (
				read.level.entities.get(guid)?.nearby != null &&
				(pose === undefined ||
					this.#sceneMembership === null ||
					this.#sceneMembership.contains(dynamicEntityResidency(pose)) === null)
			) {
				continue;
			}
			encounter.absentAt ??= now;
			if (now - encounter.absentAt >= this.#options.timing.absenceGraceMs)
				this.#encounters.delete(guid);
		}
		this.#tracked = tracked;
		this.#scheduleExpiry();
	}

	#queue(guid: number, name: string, location: string): void {
		this.#queued.push({ guid, name, location });
		if (this.#batchTimer !== null) return;
		this.#batchTimer = setTimeout(() => {
			this.#batchTimer = null;
			const queued = this.#queued;
			this.#queued = [];
			this.#options.appendChat({
				kind: "formatted-system",
				rows: [
					...(queued.length > 1
						? [
								{
									indented: false,
									spans: [
										{
											kind: "plain" as const,
											text: `${queued.length} tracked entities nearby`,
										},
									],
								},
							]
						: []),
					...queued.map((entry) => ({
						indented: queued.length > 1,
						spans: [
							{
								kind: "entity" as const,
								guid: entry.guid,
								text: entityDisplayName(entry.name, entry.guid),
							},
							{
								kind: "plain" as const,
								text: `${queued.length === 1 ? " detected" : ""} — ${entry.location}`,
							},
						],
					})),
				],
			});
		}, this.#options.timing.notificationBatchMs);
	}

	#scheduleExpiry(): void {
		if (this.#expiryTimer !== null) clearTimeout(this.#expiryTimer);
		this.#expiryTimer = null;
		let earliest = Infinity;
		for (const encounter of this.#encounters.values())
			if (encounter.absentAt !== null)
				earliest = Math.min(
					earliest,
					encounter.absentAt + this.#options.timing.absenceGraceMs,
				);
		if (earliest !== Infinity)
			this.#expiryTimer = setTimeout(
				() => {
					this.#expiryTimer = null;
					if (this.#available()) this.#reconcile("announce");
				},
				Math.max(0, earliest - this.#options.now()),
			);
	}

	#reset(): void {
		this.#encounters.clear();
		this.#tracked = EMPTY_GUIDS;
		this.#queued = [];
		this.#world = null;
		if (this.#batchTimer !== null) clearTimeout(this.#batchTimer);
		if (this.#expiryTimer !== null) clearTimeout(this.#expiryTimer);
		this.#batchTimer = null;
		this.#expiryTimer = null;
	}
}

const EMPTY_GUIDS: ReadonlySet<number> = new Set();
