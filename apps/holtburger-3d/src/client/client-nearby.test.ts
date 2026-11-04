import { RenderSceneInterestController } from "../lib/game/runtime/render-scene-interest-controller";
import { cellId } from "../lib/game/runtime/dynamic-entity-feed";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientNearby } from "./client-nearby";
import {
	nearbyFacts,
	nearbyPose,
	NearbyTestSession,
	nearbySceneInterest,
} from "./client-nearby.test-support";
import { createDefaultClientCharacterSettings } from "./client-settings-defaults";
import type { EntityAlertRule } from "./client-entity-alerts";
import type { ClientChatEntry } from "./client-chat-policy";
import { dynamicEntityWorldOrigin } from "../lib/game/runtime/dynamic-entity-presentation";
import { formatWorldMapCoordinates } from "../lib/game/map/map-coordinates";
import { filterNearbyRows, nearbyLocation } from "./client-nearby-policy";

const timing = { absenceGraceMs: 100, notificationBatchMs: 10 };
const rule = (id: string, pattern = "*golem*"): EntityAlertRule => ({
	id,
	enabled: true,
	match: { mode: "glob", pattern },
});

describe("ClientNearby", () => {
	const owners: ClientNearby[] = [];
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
	});
	afterEach(() => {
		owners.forEach((owner) => owner.destroy());
		owners.length = 0;
		vi.useRealTimers();
	});
	function setup(ready = true) {
		const session = new NearbyTestSession();
		const chat: ClientChatEntry[] = [];
		const save = vi.fn();
		const owner = new ClientNearby({
			session,
			now: () => Date.now(),
			timing,
			appendChat: (entry) => chat.push(entry),
			saveRules: save,
		});
		const scene = new RenderSceneInterestController();
		scene.replace(nearbySceneInterest("0x0000ffff", "dungeon"));
		owner.setSceneMembership(scene);
		owners.push(owner);
		const accept = (rules: readonly EntityAlertRule[]) =>
			owner.acceptSettings({
				kind: "ready",
				characterGuid: 1,
				generation: 1,
				settings: {
					...createDefaultClientCharacterSettings(),
					entityAlerts: rules,
				},
				lastKnownName: null,
			});
		if (ready) accept([rule("one")]);
		return { session, owner, chat, accept, save, scene };
	}
	it("filters pickups across categories and follows eligibility changes without examination", () => {
		const { session, owner } = setup();
		const item = nearbyFacts(7, "Loose Gem");
		const pack = nearbyFacts(8, "Loose Pack");
		if (item.nearby === null || pack.nearby === null)
			throw new Error("fixture requires public facts");
		const gem = {
			...item,
			canPickUp: true,
			nearby: { ...item.nearby, category: "item" as const },
		};
		const bag = {
			...pack,
			canPickUp: true,
			nearby: { ...pack.nearby, category: "container" as const },
		};
		session.baseline(
			[gem, bag, { ...gem, guid: 9, canPickUp: false }],
			[nearbyPose(7, 5), nearbyPose(8, 10), nearbyPose(9, 15)],
		);
		const query = {
			text: "",
			categories: ["pickup"] as const,
			tracked: false,
			sort: "distance" as const,
		};
		const pickups = () =>
			filterNearbyRows(owner.read().rows, query).map((row) => row.guid);
		const props = () =>
			filterNearbyRows(owner.read().rows, {
				...query,
				categories: ["prop"],
			}).map((row) => row.guid);
		expect(pickups()).toEqual([7, 8]);
		expect(props()).toEqual([9]);
		expect(owner.read().rows.map((row) => [row.guid, row.category])).toEqual([
			[7, "pickup"],
			[8, "container"],
			[9, "prop"],
		]);
		expect(
			filterNearbyRows(owner.read().rows, {
				...query,
				categories: [],
				sort: "category",
			}).map((row) => row.guid),
		).toEqual([8, 9, 7]);
		expect(
			filterNearbyRows(owner.read().rows, {
				...query,
				categories: ["pickup", "prop"],
			}).map((row) => row.guid),
		).toEqual([7, 8, 9]);
		expect(
			filterNearbyRows(owner.read().rows, { ...query, text: "gem" }).map(
				(row) => row.guid,
			),
		).toEqual([7]);
		session.update([{ ...gem, canPickUp: false }]);
		expect(pickups()).toEqual([8]);
		expect(props()).toEqual([7, 9]);
		expect(owner.read().rows.find((row) => row.guid === 7)?.category).toBe(
			"prop",
		);
	});
	it("matches authored names while formatting unnamed alert text", () => {
		const { session, owner, chat, accept } = setup();
		accept([rule("generated", "*Unnamed*")]);
		session.baseline([nearbyFacts(7, "")], [nearbyPose(7, 5)]);
		expect([...owner.trackedGuids()]).toEqual([]);
		expect(owner.read().rows[0].facts.name).toBe("");
		accept([rule("all", "*")]);
		session.baseline(
			[nearbyFacts(7, ""), nearbyFacts(8, "")],
			[nearbyPose(7, 5), nearbyPose(8, 10)],
		);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(
			chat.flatMap((entry) =>
				entry.kind === "formatted-system"
					? entry.rows.flatMap((row) => row.spans)
					: [],
			),
		).toContainEqual({
			kind: "entity",
			guid: 8,
			text: "[Unnamed · 0x00000008]",
		});
	});

	it("batches multiple identities and overlapping rules without losing initial coordinates", () => {
		const { session, owner, chat, accept } = setup();
		accept([rule("one"), rule("two", "Diamond*")]);
		session.baseline(
			[nearbyFacts(7, "Diamond Golem"), nearbyFacts(8, "Diamond Golem")],
			[nearbyPose(7, 5), nearbyPose(8, 10)],
		);
		expect([...owner.trackedGuids()]).toEqual([7, 8]);
		expect(owner.read().rows[0].matchingRules).toEqual(["one", "two"]);
		session.pose(nearbyPose(7, 99));
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(1);
		expect(chat[0]).toMatchObject({
			kind: "formatted-system",
			rows: [
				{
					indented: false,
					spans: [{ kind: "plain", text: "2 tracked entities nearby" }],
				},
				{
					indented: true,
					spans: [
						{ kind: "entity", guid: 7, text: "Diamond Golem" },
						{ kind: "plain", text: expect.stringContaining("(5.0, 0.0, 0.0)") },
					],
				},
				{
					indented: true,
					spans: [
						{ kind: "entity", guid: 8, text: "Diamond Golem" },
						{
							kind: "plain",
							text: expect.stringContaining("(10.0, 0.0, 0.0)"),
						},
					],
				},
			],
		});
		expect(owner.read().rows[0].location.text).toContain("(99.0, 0.0, 0.0)");
	});
	it.each([true, false])(
		"joins separate identity and pose publications (identity first: %s)",
		(identityFirst) => {
			const { session, owner, chat } = setup();
			session.baseline([], []);
			if (identityFirst) session.update([nearbyFacts(7, "Golem")]);
			else session.pose(nearbyPose(7, 5));
			expect(owner.trackedGuids().size).toBe(0);
			if (identityFirst) session.pose(nearbyPose(7, 5));
			else session.update([nearbyFacts(7, "Golem")]);
			vi.advanceTimersByTime(timing.notificationBatchMs);
			expect(chat).toHaveLength(1);
			expect(owner.read().rows).toHaveLength(1);
		},
	);
	it("scans existing entities after late settings hydration", () => {
		const { session, owner, chat, accept } = setup(false);
		session.baseline([nearbyFacts(7, "Golem")], [nearbyPose(7, 5)]);
		expect(owner.read().ready).toBe(false);
		accept([rule("one")]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(1);
	});
	it("waits for public-only identity rather than using a merged description", () => {
		const { session, owner, chat } = setup();
		session.baseline(
			[{ ...nearbyFacts(7, "Golem"), nearby: null }],
			[nearbyPose(7, 5)],
		);
		expect(owner.read().rows).toHaveLength(0);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(0);
		session.update([nearbyFacts(7, "Golem")]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(1);
	});
	it("preserves suppression across same-session recovery and discovers new identities", () => {
		const { session, owner, chat } = setup();
		session.baseline([nearbyFacts(7, "Golem")], [nearbyPose(7, 5)]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		session.entities.awaitSnapshot();
		session.mirror.awaitSnapshot();
		session.emit({ type: "resyncing" });
		expect(owner.trackedGuids().size).toBe(0);
		vi.advanceTimersByTime(timing.absenceGraceMs * 2);
		session.baseline(
			[nearbyFacts(7, "Golem"), nearbyFacts(8, "Golem")],
			[nearbyPose(7, 5), nearbyPose(8, 10)],
		);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(2);
		expect(chat[1]).toMatchObject({
			rows: [
				{
					indented: false,
					spans: [
						{ kind: "entity", guid: 8, text: "Golem" },
						{ kind: "plain", text: expect.stringContaining("10.0") },
					],
				},
			],
		});
	});
	it("rearms only after confirmed absence exceeds grace", () => {
		const { session, owner, chat } = setup();
		const facts = nearbyFacts(7, "Golem");
		session.baseline([facts], [nearbyPose(7, 5)]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		session.update([], [7]);
		expect(owner.trackedGuids().size).toBe(0);
		vi.advanceTimersByTime(timing.absenceGraceMs / 2);
		session.update([facts]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(1);
		session.update([], [7]);
		vi.advanceTimersByTime(timing.absenceGraceMs);
		session.update([facts]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(2);
	});
	it("rule additions, edits and reactivation silently seed current matches", () => {
		const { session, owner, chat, save } = setup();
		owner.changeRules(1, []);
		session.baseline([nearbyFacts(7, "Golem")], [nearbyPose(7, 5)]);
		owner.changeRules(1, [rule("one", "Goblin")]);
		owner.changeRules(1, [rule("one", "Golem")]);
		expect([...owner.trackedGuids()]).toEqual([7]);
		expect(owner.read().rows[0].matchingRules).toEqual(["one"]);
		session.pose(nearbyPose(7, 6));
		session.update([nearbyFacts(7, "Golem")]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(0);
		owner.changeRules(1, [{ ...rule("one", "Golem"), enabled: false }]);
		expect(owner.trackedGuids().size).toBe(0);
		owner.changeRules(1, [rule("one", "Golem")]);
		session.pose(nearbyPose(7, 7));
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(0);
		expect(save).toHaveBeenCalledTimes(5);
		// A distinct arrival still announces under the same rule.
		session.pose(nearbyPose(8, 10));
		session.update([nearbyFacts(8, "Golem")]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(1);
		// The silently accepted encounter becomes new after a confirmed absence.
		session.update([], [7]);
		vi.advanceTimersByTime(timing.absenceGraceMs);
		session.update([nearbyFacts(7, "Golem")]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(2);
	});
	it("rule reactivation preserves encounter suppression when an entity returns within grace", () => {
		const { session, owner, chat } = setup();
		session.baseline([nearbyFacts(7, "Golem")], [nearbyPose(7, 5)]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		session.update([], [7]);
		owner.changeRules(1, [{ ...rule("one"), enabled: false }]);
		owner.changeRules(1, [rule("one")]);
		session.update([nearbyFacts(7, "Golem")]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(1);
	});
	it("expires retained entities on scene departure and announces their unchanged GUIDs on return", () => {
		const { session, owner, chat, scene } = setup();
		session.baseline([nearbyFacts(7, "Golem")], [nearbyPose(7, 5)]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(1);
		// Only interest changes. Both mirrors retain the original entity and pose.
		scene.replace(nearbySceneInterest("0x1234ffff", "dungeon"));
		expect(owner.read().rows).toHaveLength(0);
		expect(owner.trackedGuids().size).toBe(0);
		vi.advanceTimersByTime(timing.absenceGraceMs);
		scene.replace(nearbySceneInterest("0x0000ffff", "dungeon"));
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(owner.read().rows.map((row) => row.guid)).toEqual([7]);
		expect([...owner.trackedGuids()]).toEqual([7]);
		expect(chat).toHaveLength(2);
	});
	it("detects scene crossings carried only by movement ticks", () => {
		const { session, owner, chat } = setup();
		const inside = nearbyPose(7, 5);
		const outside = {
			...inside,
			placement: {
				...inside.placement,
				pose: { ...inside.placement.pose, landblockId: cellId(0x12340100) },
			},
		};
		session.baseline([nearbyFacts(7, "Golem")], [nearbyPose(1, 0), outside]);
		let seconds = 10;
		const move = (entity: typeof inside) => {
			const point = {
				pose: entity.placement.pose,
				spatialMembership: entity.placement.spatialMembership,
			};
			const event = {
				kind: "ticked" as const,
				batch: {
					hostTime: { seconds: ++seconds },
					durationMs: 1,
					updates: [],
					advances: [
						{
							entity,
							kind: "integrated" as const,
							path: { initial: point, legs: [{ endFraction: 1, end: point }] },
						},
					],
				},
			};
			session.mirror.apply(event);
			session.emit({ type: "dynamic", event });
		};
		move(inside);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect([...owner.trackedGuids()]).toEqual([7]);
		expect(chat).toHaveLength(1);
		move(outside);
		expect(owner.trackedGuids().size).toBe(0);
		vi.advanceTimersByTime(timing.absenceGraceMs);
		move(inside);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(owner.read().rows.map((row) => row.guid)).toEqual([7]);
		expect(chat).toHaveLength(2);
		const read = vi.spyOn(session.entities, "read");
		move(inside);
		move(nearbyPose(1, 1));
		expect(read).not.toHaveBeenCalled();
	});
	it("preserves a brief scene departure and unknown loading context without duplicate alerts", () => {
		const { session, owner, chat, scene } = setup();
		session.baseline([nearbyFacts(7, "Golem")], [nearbyPose(7, 5)]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		scene.replace(nearbySceneInterest("0x1234ffff", "dungeon"));
		vi.advanceTimersByTime(timing.absenceGraceMs / 2);
		scene.replace(nearbySceneInterest("0x0000ffff", "dungeon"));
		scene.clear();
		vi.advanceTimersByTime(timing.absenceGraceMs * 2);
		expect(owner.read().rows).toHaveLength(0);
		scene.replace(nearbySceneInterest("0x0000ffff", "dungeon"));
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(1);
	});
	it("rebinds membership sources without retaining old scene subscriptions", () => {
		const { session, owner, chat, scene } = setup();
		session.baseline([nearbyFacts(7, "Golem")], [nearbyPose(7, 5)]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		owner.setSceneMembership(null);
		scene.replace(nearbySceneInterest("0x1234ffff", "dungeon"));
		vi.advanceTimersByTime(timing.absenceGraceMs * 2);
		scene.replace(nearbySceneInterest("0x0000ffff", "dungeon"));
		owner.setSceneMembership(scene);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(owner.read().rows).toHaveLength(1);
		expect(chat).toHaveLength(1);
	});

	it("suspends during portal space without resetting surviving encounters", () => {
		const { session, owner, chat } = setup();
		session.baseline([nearbyFacts(7, "Golem")], [nearbyPose(7, 5)]);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		session.current = {
			...session.current,
			lifecycle: {
				kind: "portal-space",
				cause: "teleport",
				worldGeneration: 1,
			},
		};
		session.emit({ type: "lifecycle" });
		expect(owner.read().ready).toBe(false);
		session.current = { ...session.current, lifecycle: { kind: "in-world" } };
		session.emit({ type: "lifecycle" });
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(1);
	});
	it("retirement cancels queued notifications and disposes listeners/timers", () => {
		const { session, owner, chat } = setup();
		session.baseline([nearbyFacts(7, "Golem")], [nearbyPose(7, 5)]);
		owner.acceptSettings({ kind: "loading", characterGuid: 2, generation: 2 });
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(chat).toHaveLength(0);
		expect(owner.trackedGuids().size).toBe(0);
		owner.destroy();
		expect(session.listeners.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("rejects stale character edits without saving or mutating the new character's rules", () => {
		const { owner, save } = setup();
		owner.acceptSettings({
			kind: "ready",
			characterGuid: 2,
			generation: 2,
			settings: createDefaultClientCharacterSettings(),
			lastKnownName: null,
		});
		expect(owner.changeRules(1, [rule("old-character")])).toBe(false);
		expect(owner.rules()).toEqual([]);
		expect(save).not.toHaveBeenCalled();
	});
	it("filters categories with OR, then tracked and fuzzy name with AND; sorts independently", () => {
		const { session, owner } = setup();
		const npc = nearbyFacts(8, "Town Golem");
		if (npc.nearby === null) throw new Error("fixture requires public facts");
		session.baseline(
			[
				nearbyFacts(7, "Diamond Golem"),
				{ ...npc, nearby: { ...npc.nearby, category: "npc" } },
				nearbyFacts(9, "Drudge"),
			],
			[nearbyPose(1, 0), nearbyPose(7, 10), nearbyPose(8, 5), nearbyPose(9, 1)],
		);
		const rows = owner.read().rows;
		expect(
			filterNearbyRows(rows, {
				text: "glm",
				categories: ["monster", "npc"],
				tracked: true,
				sort: "distance",
			}).map((row) => row.guid),
		).toEqual([8, 7]);
		expect(
			filterNearbyRows(rows, {
				text: "",
				categories: [],
				tracked: false,
				sort: "name",
			}).map((row) => row.guid),
		).toEqual([7, 9, 8]);
	});
	it("uses mixed-landblock surface coordinates for interior rows and detections", () => {
		const { session, owner, scene, chat } = setup();
		const entity = nearbyPose(7, 5);
		const mixedEntity = {
			...entity,
			placement: {
				...entity.placement,
				pose: { ...entity.placement.pose, landblockId: cellId(0xda550100) },
			},
		};
		const request = nearbySceneInterest("0xda55ffff", "outdoor");
		scene.replace({
			...request,
			radii: { ...request.radii, envCellRadius: 0 },
			ambientOutdoorEnvCellOwners: new Set(["0xda55ffff"]),
		});
		session.baseline([nearbyFacts(7, "Diamond Golem")], [mixedEntity]);
		const origin = dynamicEntityWorldOrigin(mixedEntity.placement);
		const text = formatWorldMapCoordinates(origin);
		expect(owner.read().rows[0]?.location).toMatchObject({
			text,
			waypoint: { position: { x: origin.x, z: origin.z } },
		});
		expect(owner.trackedGuids().has(7)).toBe(true);
		vi.advanceTimersByTime(timing.notificationBatchMs);
		expect(JSON.stringify(chat)).toContain(text);
		scene.replace(nearbySceneInterest("0xda55ffff", "dungeon"));
		expect(owner.read().rows[0]?.location).toMatchObject({
			waypoint: null,
			text: expect.stringContaining("Cell 0xda550100"),
		});
	});
	it("keeps dungeon-only locations cell-local without surface waypoints", () => {
		const entity = nearbyPose(7, 5);
		if (entity.placement.kind !== "world")
			throw new Error("fixture requires world placement");
		expect(nearbyLocation(entity.placement, false)).toMatchObject({
			waypoint: null,
			text: expect.stringContaining("Cell 0x"),
		});
	});
	it("orders category and name views with stable identity ties", () => {
		const { session, owner } = setup();
		session.baseline([nearbyFacts(9, "Golem")], [nearbyPose(9, 1)]);
		vi.advanceTimersByTime(timing.absenceGraceMs);
		const npc = nearbyFacts(8, "Golem");
		if (npc.nearby === null) throw new Error("fixture requires public facts");
		session.pose(nearbyPose(7, 1));
		session.pose(nearbyPose(8, 1));
		session.update([
			nearbyFacts(7, "Golem"),
			{ ...npc, nearby: { ...npc.nearby, category: "npc" } },
		]);
		const rows = owner.read().rows;
		const query = { text: "", categories: [], tracked: false };
		expect(
			filterNearbyRows(rows, { ...query, sort: "category" }).map(
				(row) => row.guid,
			),
		).toEqual([7, 9, 8]);
		expect(
			filterNearbyRows(rows, { ...query, sort: "name" }).map((row) => row.guid),
		).toEqual([7, 8, 9]);
	});
});
