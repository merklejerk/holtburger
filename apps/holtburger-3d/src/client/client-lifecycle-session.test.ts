import type { PartySnapshot } from "./client-party-contract";
import membershipFixture from "../harness/browser/fixtures/contract-membership.json";
import { contractMembershipChangeSchema } from "./client-contracts-contract";
import housingPreviewWireFixture from "./fixtures/housing-preview-wire.json";
import housingManagementWireFixture from "./fixtures/housing-management-wire.json";
import housingWireFixture from "./fixtures/housing-wire.json";
import vendorFixture from "./fixtures/vendor-wire.json";
import {
	emptyHousing,
	housingPreviewRequestSchema,
	housingManagementRequestSchema,
	housingSnapshotSchema,
	type HousingSnapshot,
} from "./client-housing-contract";
import { ClientVendorState } from "./client-vendor-state";
import { UiIconRepository } from "../app/ui-icon-repository";
import { vendorRequestSchema } from "./client-vendor-contract";
import {
	entityFacts,
	playerEntitySnapshot,
} from "./client-entity-mirror.test-support";
import { describe, expect, it, vi } from "vitest";
import inspectionFixture from "./fixtures/object-inspection-wire.json";

import { landblockVector3 } from "../lib/assets/ac-frame";
import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
import type {
	ClientCurrentState,
	ClientLifecycle,
} from "./client-host-contract";
import type { ResolvedEnchantments } from "./client-enchantments-contract";
import {
	ClientLifecycleSession,
	type ClientLifecycleTransport,
} from "./client-lifecycle-session";

class FakeClientTransport implements ClientLifecycleTransport {
	readonly calls: string[] = [];
	readonly invocations: Array<{
		command: string;
		args: Record<string, unknown> | undefined;
	}> = [];
	readonly handlers = new Map<string, (payload: unknown) => void>();
	#currentState: ClientCurrentState = currentState(0x5000_0001);
	#emitLaggedDeltaBeforeSnapshot = false;

	async listen(
		event: string,
		handler: (payload: unknown) => void,
	): Promise<() => void> {
		this.calls.push(`listen:${event}`);
		this.handlers.set(event, handler);
		return () => {
			this.calls.push(`unlisten:${event}`);
			this.handlers.delete(event);
		};
	}

	async invoke(command: string, args?: Record<string, unknown>): Promise<void> {
		this.calls.push(`invoke:${command}`);
		this.invocations.push({ command, args });
		if (command === "request_client_current_state") {
			if (this.#emitLaggedDeltaBeforeSnapshot) {
				this.emit("client-dynamic-entity", {
					kind: "upserted",
					entity: view(0x5000_0003),
				});
			}
			this.emit("client-current-state", this.#currentState);
		}
		void args;
	}

	setCurrentState(state: ClientCurrentState): void {
		this.#currentState = state;
	}

	setEmitLaggedDeltaBeforeSnapshot(enabled: boolean): void {
		this.#emitLaggedDeltaBeforeSnapshot = enabled;
	}

	emit(event: string, payload: unknown): void {
		this.handlers.get(event)?.(payload);
	}
}

describe("ClientLifecycleSession", () => {
	it("forwards typed membership activity without deriving it from snapshots or recovery", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const changes: unknown[] = [];
		session.subscribe((event) => {
			if (event.type === "contract-membership-change")
				changes.push(event.change);
		});
		await session.start();
		transport.emit("client-contracts-updated", {
			contracts: { rows: [{ kind: "unresolved", id: 99 }] },
		});
		transport.emit("client-current-state", currentState(1));
		expect(changes).toEqual([]);
		for (const value of membershipFixture)
			transport.emit("client-contract-membership-changed", value);
		expect(changes).toEqual(
			membershipFixture.map((value) =>
				contractMembershipChangeSchema.parse(value),
			),
		);
		expect(() =>
			transport.emit("client-contract-membership-changed", {
				kind: "removed",
				id: -1,
				name: null,
			}),
		).toThrow();
		expect(() =>
			transport.emit("client-contract-membership-changed", {
				kind: "updated",
				id: 1,
				name: "Quest",
			}),
		).toThrow();
		session.stop();
	});
	it("discards time observed during a failed startup before allowing a retry", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const invoke = vi
			.spyOn(transport, "invoke")
			.mockImplementationOnce(async () => {
				transport.emit("client-server-time-updated", { time: 300 });
				expect(session.readServerTime(performance.now())).not.toBeNull();
				throw new Error("Snapshot request failed.");
			});
		try {
			await expect(session.start()).rejects.toThrow("Snapshot request failed.");
			expect(session.readServerTime(performance.now())).toBeNull();
			await session.start();
			expect(session.readServerTime(performance.now())).not.toBeNull();
		} finally {
			session.stop();
			invoke.mockRestore();
		}
	});
	it("anchors synchronized time at receipt, advances across late mounts, and clears on stop", async () => {
		const now = vi.spyOn(performance, "now").mockReturnValue(1000);
		try {
			const transport = new FakeClientTransport();
			const session = new ClientLifecycleSession(transport);
			expect(session.readServerTime(1000)).toBeNull();
			await session.start();
			const baseline = session.readServerTime(1000);
			if (baseline === null) throw new Error("Fixture time missing.");
			expect(session.readServerTime(21_000)).toBe(baseline + 20);
			now.mockReturnValue(21_000);
			transport.emit("client-server-time-updated", { time: 300 });
			expect(session.readServerTime(26_000)).toBe(305);
			transport.setCurrentState({
				...currentState(0x5000_0001),
				serverTime: null,
			});
			await session.requestCurrentState();
			expect(session.readServerTime(26_000)).toBeNull();
			transport.emit("client-server-time-updated", { time: 400 });
			session.stop();
			expect(session.readServerTime(26_000)).toBeNull();
		} finally {
			now.mockRestore();
		}
	});
	it("routes allegiance facts, preferences, commands, portal retention and character retirement", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const allegiance = {
			playerGuid: 42,
			profile: null,
			refreshing: true,
			canSwear: true,
		};
		transport.setCurrentState({
			...currentState(42),
			allegiance,
			allegiancePreferences: { showLogons: false },
		});
		await session.start();
		expect(session.allegiance.read().snapshot).toEqual(allegiance);
		expect(session.allegiance.read().preferences).toEqual({
			showLogons: false,
		});
		transport.emit("client-allegiance-updated", {
			allegiance: { ...allegiance, refreshing: false },
		});
		await session.allegiance.request({ kind: "refresh" });
		expect(transport.invocations.at(-1)).toEqual({
			command: "submit_client_allegiance",
			args: { action: { kind: "refresh" } },
		});
		transport.emit("client-character-preferences-updated", {
			appearance: { showHelmet: true, showCloak: true },
			party: { shareXp: true, shareLoot: false, ignoreRequests: false },
			friends: { appearOffline: false },
			allegiance: { showLogons: true },
		});
		expect(session.allegiance.read().preferences).toEqual({ showLogons: true });
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		expect(session.allegiance.read().snapshot?.playerGuid).toBe(42);
		expect(session.allegiance.read().enabled).toBe(false);
		transport.emit("client-current-state", {
			...currentState(42),
			allegiance,
			allegiancePreferences: { showLogons: true },
		});
		expect(session.allegiance.read().snapshot?.refreshing).toBe(true);
		transport.emit("client-lifecycle-changed", {
			kind: "entering-world",
			characterGuid: 43,
		});
		expect(session.allegiance.read().snapshot).toBeNull();
		await session.stop();
	});

	it("carries row-targeted previews and unused selected sources through the shared wire fixture", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const receipts: unknown[] = [];
		session.subscribe((event) => {
			if (event.type === "housing-payment-preview") receipts.push(event.result);
		});
		await session.start();
		const request = housingPreviewRequestSchema.parse(
			housingPreviewWireFixture.request,
		);
		await session.previewHousingPayment(request);
		expect(transport.invocations.at(-1)).toEqual({
			command: "preview_client_housing_payment",
			args: { request },
		});
		transport.emit(
			"client-housing-payment-preview",
			housingPreviewWireFixture.result,
		);
		expect(receipts).toEqual([housingPreviewWireFixture.result]);
		session.stop();
	});

	it("dispatches reviewed management and validates its receipt without another toast owner", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const receipts: unknown[] = [];
		session.subscribe((event) => {
			if (event.type === "housing-management-finished")
				receipts.push(event.result);
		});
		await session.start();
		const request = housingManagementRequestSchema.parse(
			housingManagementWireFixture.request,
		);
		await session.submitHousingManagement(request);
		expect(transport.invocations.at(-1)).toEqual({
			command: "submit_client_housing_management",
			args: { request },
		});
		transport.emit(
			"client-housing-management-finished",
			housingManagementWireFixture.result,
		);
		expect(receipts).toEqual([housingManagementWireFixture.result]);
		expect(session.housingSnapshot()).toEqual(emptyHousing());
		await expect(
			session.submitHousingManagement({ ...request, sequence: -1 }),
		).rejects.toThrow();
		session.stop();
	});

	it("accepts the housing snapshot produced through the host projection", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const housing = housingSnapshotSchema.parse(housingWireFixture);
		transport.setCurrentState({ ...currentState(1), housing });
		await session.start();
		expect(session.housingSnapshot()).toEqual(housingWireFixture);
		transport.emit("client-state-resyncing", null);
		transport.emit("client-current-state", { ...currentState(1), housing });
		expect(session.housingSnapshot()).toEqual(housingWireFixture);
		session.stop();
	});

	it("restores access/search loading without querying and dispatches explicit typed reads", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const housing: HousingSnapshot = {
			...emptyHousing(),
			access: {
				generation: 5,
				refreshing: true,
				records: {
					publicEntry: true,
					guests: [{ character: 7, name: "Guest", storageAllowed: false }],
					allegiance: null,
					roommates: null,
				},
			},
			search: {
				pendingType: 1,
				results: { houseType: 4, areas: [0x12340001], totalAvailable: 2 },
			},
		};
		transport.setCurrentState({ ...currentState(1), housing });
		await session.start();
		expect(session.housingSnapshot()).toEqual(housing);
		expect(
			transport.invocations.filter(
				(entry) =>
					entry.command === "query_client_housing_access" ||
					entry.command === "search_client_housing",
			),
		).toEqual([]);
		await session.queryHousingAccess();
		expect(transport.invocations.at(-1)).toEqual({
			command: "query_client_housing_access",
			args: undefined,
		});
		await session.searchHousing(4);
		expect(transport.invocations.at(-1)).toEqual({
			command: "search_client_housing",
			args: { houseType: 4 },
		});
		await expect(session.searchHousing(0)).rejects.toThrow();
		await expect(session.searchHousing(1.5)).rejects.toThrow();
		session.stop();
		expect(session.housingSnapshot()).toEqual(emptyHousing());
	});

	it("retains pending housing payment through replacement and validates terminal feedback", async () => {
		const transport = new FakeClientTransport();
		const pendingPayment = {
			sequence: 15,
			crystal: 100,
			purpose: "purchase",
		} as const;
		transport.setCurrentState({
			...currentState(1),
			housing: { ...emptyHousing(), pendingPayment },
		});
		const session = new ClientLifecycleSession(transport);
		const results: unknown[] = [];
		session.subscribe((event) => {
			if (event.type === "housing-payment-finished") results.push(event.result);
		});
		await session.start();
		expect(session.housingSnapshot().pendingPayment).toEqual(pendingPayment);
		expect(
			transport.calls.indexOf("listen:client-housing-payment-finished"),
		).toBeLessThan(
			transport.calls.indexOf("invoke:request_client_current_state"),
		);
		const result = {
			sequence: 15,
			crystal: 100,
			outcome: { kind: "unresolved", reason: "No authoritative response" },
			notify: true,
		};
		transport.emit("client-housing-payment-finished", result);
		expect(results).toEqual([result]);
		expect(() =>
			transport.emit("client-housing-payment-finished", {
				...result,
				notify: "yes",
			}),
		).toThrow();
		transport.emit("client-housing-updated", emptyHousing());
		expect(session.housingSnapshot().pendingPayment).toBeNull();
		session.stop();
	});
	it("validates housing preview commands and emits their correlated receipts without retaining opening intent", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		await session.start();
		const receipts: unknown[] = [];
		session.subscribe((event) => {
			if (event.type === "housing-payment-preview") receipts.push(event.result);
		});
		const request = {
			sequence: 9,
			draft: { crystal: 100, purpose: "maintenance", items: [11] },
			operation: { kind: "fill", wcid: 273 },
		} as const;
		await session.previewHousingPayment({
			...request,
			draft: { ...request.draft, items: [...request.draft.items] },
		});
		expect(transport.invocations.at(-1)).toEqual({
			command: "preview_client_housing_payment",
			args: { request },
		});
		const result = {
			sequence: 9,
			crystal: 100,
			outcome: {
				kind: "ready",
				items: [11, 12],
				quote: {
					lines: [
						{
							wcid: 273,
							sources: [11, 12],
							consumption: [
								{ item: 11, quantity: 3, value: 3 },
								{ item: 12, quantity: 1, value: 10 },
							],
							credited: 13,
							effectivePaid: 13,
							shortfall: 0,
							excess: 0,
						},
					],
					complete: true,
					contributes: true,
				},
				unavailable: [],
			},
		};
		transport.emit("client-housing-payment-preview", result);
		expect(receipts).toEqual([result]);
		expect(session.housingSnapshot()).toEqual(emptyHousing());
		await expect(
			session.previewHousingPayment({
				...request,
				sequence: -1,
				draft: { ...request.draft, items: [] },
			}),
		).rejects.toThrow();
		session.stop();
	});

	it("retains housing through travel, replaces it on recovery, and clears it on stop", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const home: HousingSnapshot = {
			...emptyHousing(),
			home: { kind: "none" },
		};
		transport.setCurrentState({ ...currentState(1), housing: home });
		const events: string[] = [];
		session.subscribe((event) => events.push(event.type));
		await session.start();
		expect(session.housingSnapshot()).toEqual(home);
		expect(
			transport.calls.indexOf("listen:client-housing-updated"),
		).toBeLessThan(
			transport.calls.indexOf("invoke:request_client_current_state"),
		);
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		expect(session.housingSnapshot()).toEqual(home);
		await session.refreshHousing();
		expect(transport.invocations.at(-1)?.command).toBe(
			"refresh_client_housing",
		);
		transport.emit("client-housing-updated", { ...home, refreshing: true });
		expect(session.housingSnapshot().refreshing).toBe(true);
		transport.emit("client-state-resyncing", null);
		transport.emit("client-current-state", {
			...currentState(1),
			housing: home,
		});
		expect(session.housingSnapshot()).toEqual(home);
		expect(
			events.filter((type) => type === "housing-crystal-received"),
		).toEqual([]);
		session.stop();
		expect(session.housingSnapshot()).toEqual(emptyHousing());
	});

	it("retains connection samples independently of portal lifecycle and replaces them after loss", async () => {
		const transport = new FakeClientTransport();
		const baseline = {
			health: "connected",
			quality: "good",
			reliability: {
				receiveRepairShare: 0,
				sendRepairShare: null,
				receiveGap: false,
			},
			sampleAgeSeconds: 0,
			receiveAgeSeconds: 0.2,
			receiveBytesPerSecond: 120,
			sendBytesPerSecond: 60,
		} as const;
		transport.setCurrentState({ ...currentState(1), connection: baseline });
		const session = new ClientLifecycleSession(transport);
		await session.start();
		expect(session.connectionSample()?.sample).toEqual(baseline);
		const waiting = {
			...baseline,
			health: "waiting",
			quality: "poor",
			sampleAgeSeconds: 0,
			receiveAgeSeconds: 10,
			receiveBytesPerSecond: 0,
		} as const;
		transport.emit("client-connection-updated", waiting);
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 3,
			cause: "teleport",
		});
		expect(session.connectionSample()?.sample).toEqual(waiting);
		transport.emit("client-state-resyncing", null);
		expect(session.connectionSample()).toBeNull();
		transport.emit("client-current-state", {
			...currentState(1),
			connection: baseline,
		});
		expect(session.connectionSample()?.sample).toEqual(baseline);
		session.stop();
		expect(session.connectionSample()).toBeNull();
		transport.setCurrentState(currentState(2));
		await session.start();
		expect(session.connectionSample()).toBeNull();
		session.stop();
	});

	it("dispatches examination and emits the validated cold result", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		await session.start();
		transport.invocations.length = 0;
		const results: unknown[] = [];
		session.subscribe((event) => {
			if (event.type === "object-inspection-result") results.push(event.result);
		});

		await session.examineEntity(inspectionFixture.item.guid);
		expect(transport.invocations).toEqual([
			{
				command: "examine_client_entity",
				args: { guid: inspectionFixture.item.guid },
			},
		]);
		transport.emit("client-object-inspection-result", inspectionFixture.item);
		expect(results).toEqual([inspectionFixture.item]);
		await expect(session.examineEntity(-1)).rejects.toThrow();
		expect(transport.invocations).toHaveLength(1);
		session.stop();
	});

	it("commits container access with pending contents and replaces it coherently after loss", async () => {
		const transport = new FakeClientTransport();
		const player = 1;
		const root = 10;
		const pack = 11;
		const child = 12;
		const contents = [
			entityFacts(player),
			entityFacts(root),
			...[pack, child].map((guid) =>
				entityFacts(guid, {
					description: { kind: "pending" },
					worldContainerContent: true,
					location: {
						kind: "contained",
						parentGuid: guid === pack ? root : pack,
						slot: { kind: "pending" },
					},
				}),
			),
		];
		const opened: ClientCurrentState = {
			...currentState(player),
			entities: {
				projectileSupply: { kind: "not-applicable" },
				worldContainer: { kind: "open", root },
				entities: contents,
			},
		};
		transport.setCurrentState(opened);
		const session = new ClientLifecycleSession(transport);
		await session.start();
		const initial = session.entities.read();
		if (initial.kind !== "current")
			throw new Error("Expected replacement baseline.");
		expect(initial.level.worldContainer).toEqual({ kind: "open", root });
		expect(initial.level.entities.get(child)?.description.kind).toBe("pending");
		expect(initial.level.entities.get(child)?.canPickUp).toBe(false);
		let coherentCloseNotifications = 0;
		const unsubscribe = session.subscribe((event) => {
			if (event.type !== "entities") return;
			const read = session.entities.read();
			if (read.kind !== "current") throw new Error("Expected committed delta.");
			expect(read.level.worldContainer.kind).toBe("closed");
			expect(read.level.entities.has(child)).toBe(false);
			coherentCloseNotifications++;
		});
		transport.emit("client-entity-facts-changed", {
			projectileSupply: { kind: "not-applicable" },
			worldContainer: { kind: "closed" },
			upserts: [],
			removed: [pack, child],
		});
		expect(coherentCloseNotifications).toBe(1);
		unsubscribe();
		transport.emit("client-state-resyncing", null);
		transport.emit("client-entity-facts-changed", {
			projectileSupply: { kind: "not-applicable" },
			worldContainer: { kind: "open", root },
			upserts: contents,
			removed: [],
		});
		expect(session.entities.read().kind).toBe("pending");
		transport.emit("client-current-state", opened);
		const recovered = session.entities.read();
		if (recovered.kind !== "current")
			throw new Error("Expected recovered baseline.");
		expect(recovered.level.entities.get(child)?.description.kind).toBe(
			"pending",
		);
		transport.emit("client-state-resyncing", null);
		transport.emit("client-current-state", currentState(player));
		const closed = session.entities.read();
		if (closed.kind !== "current") throw new Error("Expected closed baseline.");
		expect(closed.level.worldContainer.kind).toBe("closed");
		expect(closed.level.entities.has(child)).toBe(false);
		await session.closeContainer(root);
		expect(transport.invocations.at(-1)).toEqual({
			command: "close_client_container",
			args: { guid: root },
		});
		session.stop();
	});

	it("casts only in confirmed magic and forwards each caller-owned aim", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const targeted = { kind: "normal", selection: 7 } as const;
		await expect(session.castSpell(42, targeted)).rejects.toThrow(
			"Spell session",
		);
		await session.start();
		await expect(session.castSpell(42, targeted)).rejects.toThrow(
			"magic stance",
		);
		transport.emit("client-combat-mode-updated", { mode: "magic" });
		await session.castSpell(42, targeted);
		await session.castSpell(42, { kind: "untargeted" });
		expect(
			transport.invocations.filter(
				(call) => call.command === "cast_client_spell",
			),
		).toEqual([
			{
				command: "cast_client_spell",
				args: { spellId: 42, aim: { kind: "normal", selection: 7 } },
			},
			{
				command: "cast_client_spell",
				args: { spellId: 42, aim: { kind: "untargeted" } },
			},
		]);
		transport.emit("client-current-state", currentState(1));
		await expect(session.castSpell(42, targeted)).rejects.toThrow(
			"magic stance",
		);
		session.stop();
		await expect(session.castSpell(42, targeted)).rejects.toThrow(
			"Spell session",
		);
	});

	it("toggles only in world and reconciles stance through events and replacement snapshots", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		await session.toggleCombatMode();
		expect(transport.calls).toEqual([]);
		await session.start();
		transport.emit("client-current-state", currentState(1));
		transport.calls.length = 0;
		await session.toggleCombatMode();
		expect(transport.calls).toEqual(["invoke:toggle_client_combat_mode"]);
		expect(session.state().combatMode).toBe("peace");
		transport.emit("client-combat-mode-updated", { mode: "missile" });
		expect(session.state().combatMode).toBe("missile");
		transport.emit("client-current-state", {
			...currentState(1),
			combatMode: "magic",
		});
		expect(session.state().combatMode).toBe("magic");
		transport.emit("client-combat-mode-updated", { mode: "peace" });
		expect(session.state().combatMode).toBe("peace");
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 3,
			cause: "teleport",
		});
		transport.calls.length = 0;
		await session.toggleCombatMode();
		expect(transport.calls).toEqual([]);
		session.stop();
	});

	it("recovers known spells from snapshots and preserves them across portal updates", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		await session.start();
		expect(session.state().knownSpells).toBeNull();
		transport.emit("client-current-state", {
			...currentState(0x50000001),
			knownSpells: [1, 3],
		});
		expect(session.state().knownSpells).toEqual([1, 3]);
		transport.emit("client-player-spells-updated", { spellIds: [3, 4] });
		expect(session.state().knownSpells).toEqual([3, 4]);
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		expect(session.state().knownSpells).toEqual([3, 4]);
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 3,
			cause: "initial-entry",
		});
		expect(session.state().knownSpells).toBeNull();
		transport.emit("client-player-spells-updated", { spellIds: [] });
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 3,
			cause: "initial-entry",
		});
		expect(session.state().knownSpells).toEqual([]);
		transport.emit("client-state-resyncing", null);
		expect(session.state().knownSpells).toBeNull();
		transport.emit("client-player-spells-updated", { spellIds: [1] });
		session.stop();
		expect(session.state().knownSpells).toBeNull();
	});

	it("retains resolved enchantments across teleport and clears them on character retirement", async () => {
		const transport = new FakeClientTransport();
		const key = { spellId: 10, layer: 2 };
		const active: ResolvedEnchantments = {
			instances: [
				{
					key,
					spellCategory: 3,
					powerLevel: 6,
					kind: "beneficial",
					remainingSeconds: 40,
					statModType: 0x9001,
					statModKey: 1,
					statModValue: 10,
				},
			],
			groups: [
				{
					affectedStat: { kind: "attribute", key: 1 },
					operation: "additive",
					channel: "ordinary",
					spellCategory: 3,
					effective: key,
					overridden: [],
				},
			],
		};
		transport.setCurrentState({
			...currentState(0x5000_0001),
			enchantments: active,
		});
		const session = new ClientLifecycleSession(transport);
		await session.start();
		expect(session.state().enchantments?.resolved).toEqual(active);
		const firstAnchor = session.state().enchantments?.receivedAtMs;
		expect(firstAnchor).toBeTypeOf("number");

		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		expect(session.state().enchantments?.receivedAtMs).toBe(firstAnchor);
		transport.emit("client-player-enchantments-updated", {
			instances: [],
			groups: [],
		});
		expect(session.state().enchantments?.resolved.instances).toEqual([]);
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 3,
			cause: "initial-entry",
		});
		expect(session.state().enchantments).toBeNull();
		transport.emit("client-current-state", {
			...currentState(0x5000_0002),
			enchantments: active,
		});
		expect(session.state().enchantments?.resolved).toEqual(active);
		transport.emit("client-state-resyncing", null);
		expect(session.state().enchantments).toBeNull();
		session.stop();
		expect(session.state().enchantments).toBeNull();
	});
	it.each([false, true])(
		"submits equipment identity and off-side preference %s",
		async (alternate) => {
			const transport = new FakeClientTransport();
			const session = new ClientLifecycleSession(transport);
			await session.equipItem(91, alternate);
			expect(transport.invocations).toEqual([
				{
					command: "equip_client_item",
					args: { guid: 91, alternate: alternate },
				},
			]);
		},
	);

	it("routes correlated inventory previews and submits semantic identities", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const results: unknown[] = [];
		session.subscribe((event) => {
			if (event.type === "inventory-preview") results.push(event.result);
		});
		await session.start();
		const intent = { item: 3, target: { kind: "item" as const, guid: 7 } };
		await session.previewInventory({ sequence: 8, intent });
		transport.emit("client-inventory-preview", {
			sequence: 8,
			preview: { kind: "merge", amount: 10 },
		});
		expect(results).toEqual([
			{ sequence: 8, preview: { kind: "merge", amount: 10 } },
		]);
		await session.submitInventory(intent);
		expect(transport.invocations.slice(-2)).toEqual([
			{
				command: "preview_client_inventory",
				args: { request: { sequence: 8, intent } },
			},
			{ command: "submit_client_inventory", args: { intent } },
		]);
		expect(() =>
			transport.emit("client-inventory-preview", {
				sequence: 8,
				preview: { kind: "merge", amount: 0 },
			}),
		).toThrow();
		await session.stop();
		expect(transport.handlers.has("client-inventory-preview")).toBe(false);
	});

	it("delivers validated action feedback and detaches its listener on stop", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const feedback: unknown[] = [];
		session.subscribe((event) => {
			if (event.type === "action-feedback") feedback.push(event.feedback);
		});
		await session.start();
		transport.emit("client-action-feedback", {
			message: "You're too busy!",
			tone: "warning",
		});
		transport.emit("client-action-feedback", {
			message: "Using the Iron Chest",
			tone: "progress",
		});
		expect(feedback).toEqual([
			{ message: "You're too busy!", tone: "warning" },
			{ message: "Using the Iron Chest", tone: "progress" },
		]);
		expect(() =>
			transport.emit("client-action-feedback", {
				message: "",
				tone: "warning",
			}),
		).toThrow();
		expect(() =>
			transport.emit("client-action-feedback", {
				message: "Invalid tone",
				tone: "fatal",
			}),
		).toThrow();
		session.stop();
		transport.emit("client-action-feedback", {
			message: "Late",
			tone: "warning",
		});
		expect(feedback).toHaveLength(2);
	});

	it("installs every listener before requesting the initial replacement state", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);

		await session.start();

		expect(transport.calls.at(-1)).toBe("invoke:request_client_current_state");
		expect(
			transport.calls.slice(0, -1).every((call) => call.startsWith("listen:")),
		).toBe(true);
		for (const name of [
			"client-current-state",
			"client-state-resyncing",
			"client-entity-facts-changed",
			"client-dynamic-entity",
		]) {
			expect(transport.handlers.has(name)).toBe(true);
		}

		expect(session.state().lifecycle).toEqual({
			kind: "in-world",
		});
		expect(session.state().playerGuid).toBe(0x5000_0001);
		expect(
			session.mirror.entities().map((entity) => entity.identity.guid),
		).toEqual([0x5000_0001]);
	});

	it("restores a sheet from the snapshot and ignores retired character updates", async () => {
		const transport = new FakeClientTransport();
		const first = characterSheet(7);
		transport.setCurrentState({ ...currentState(7), characterSheet: first });
		const session = new ClientLifecycleSession(transport);
		await session.start();
		expect(session.characterSheet.read().sheet?.character).toBe(7);

		transport.emit("client-character-sheet-updated", {
			...first,
			level: { ...first.level, unspentXp: "42" },
		});
		expect(session.characterSheet.read().sheet?.level.unspentXp).toBe("42");

		transport.emit("client-lifecycle-changed", {
			kind: "exiting",
			cause: "server-disconnect",
		});
		expect(session.characterSheet.read().sheet).toBeNull();
		transport.emit("client-character-sheet-updated", first);
		expect(session.characterSheet.read().sheet).toBeNull();

		const second = characterSheet(8);
		transport.emit("client-current-state", {
			...currentState(8),
			characterSheet: second,
		});
		expect(session.characterSheet.read().sheet?.character).toBe(8);
		transport.emit("client-character-sheet-updated", first);
		expect(session.characterSheet.read().sheet?.character).toBe(8);
		session.stop();
		expect(session.characterSheet.read().sheet).toBeNull();
	});

	it("accepts the completed character-entry baseline and subsequent inventory deltas", async () => {
		const transport = new FakeClientTransport();
		const startup = currentState(9);
		startup.lifecycle = { kind: "character-selection", characters: [] };
		startup.localPlayerGuid = null;
		startup.entities = {
			projectileSupply: { kind: "not-applicable" },
			worldContainer: { kind: "closed" },
			entities: [],
		};
		startup.dynamic.entities = [];
		transport.setCurrentState(startup);
		const session = new ClientLifecycleSession(transport);
		await session.start();
		// Repeat entry with another character without restarting the transport.
		for (const playerGuid of [9, 19]) {
			transport.emit("client-lifecycle-changed", {
				kind: "portal-space",
				worldGeneration: playerGuid,
				cause: "initial-entry",
			});
			transport.emit("client-local-player-established", { playerGuid });
			const item = entityFacts(playerGuid + 1, {
				ownedByPlayer: true,
				location: {
					kind: "contained",
					parentGuid: playerGuid,
					slot: { kind: "item", index: 0 },
				},
			});
			const baseline = currentState(playerGuid);
			baseline.entities.entities.push(item);
			transport.emit("client-entity-facts-changed", {
				projectileSupply: null,
				worldContainer: null,
				upserts: baseline.entities.entities,
				removed: [],
			});
			expect(session.entities.read().kind).toBe("pending");
			transport.emit("client-lifecycle-changed", { kind: "in-world" });
			transport.emit("client-current-state", baseline);
			transport.emit("client-entity-facts-changed", {
				projectileSupply: null,
				worldContainer: null,
				upserts: [
					entityFacts(item.guid, {
						...item,
						description: {
							kind: "known",
							name: "Updated item",
							healthQuery: "ineligible",
							itemType: 0,
							hasAlternateEquipSide: false,
							builtInSpell: null,
							mapCategory: "other",
							objectFlags: 0,
							wcid: null,
							weenieType: null,
							pyrealBalance: null,
							burden: null,
							equipLocations: null,
							consumable: null,
							useCapability: "direct" as const,
							stackCount: null,
							structure: { current: null, max: null },
							icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
						},
					}),
				],
				removed: [],
			});
			const read = session.entities.read();
			if (read.kind !== "current")
				throw new Error("Character entry did not establish inventory.");
			expect(read.level.playerGuid).toBe(playerGuid);
			expect([...read.level.entities.keys()]).toEqual([playerGuid, item.guid]);
			expect(read.level.entities.get(item.guid)?.description).toEqual({
				kind: "known",
				name: "Updated item",
				healthQuery: "ineligible",
				itemType: 0,
				hasAlternateEquipSide: false,
				builtInSpell: null,
				mapCategory: "other",
				objectFlags: 0,
				wcid: null,
				weenieType: null,
				pyrealBalance: null,
				burden: null,
				equipLocations: null,
				consumable: null,
				useCapability: "direct" as const,
				stackCount: null,
				structure: { current: null, max: null },
				icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
			});
			// Leaving the character retains the cache until the next entry replaces it.
			transport.emit("client-exit-requested", {
				cause: "server-disconnect",
				diagnostic: "Session ended",
			});
			transport.emit("client-lifecycle-changed", {
				kind: "exiting",
				cause: "server-disconnect",
			});
			transport.emit("client-lifecycle-changed", {
				kind: "character-selection",
				characters: [],
			});
			expect(session.entities.read()).toBe(read);
		}
		session.stop();
	});

	it("retires semantic state on stop and accepts reused GUIDs only from a new baseline", async () => {
		const transport = new FakeClientTransport();
		const initial = currentState(9);
		initial.entities.entities.push(
			entityFacts(10, {
				ownedByPlayer: true,
				location: {
					kind: "contained",
					parentGuid: 9,
					slot: { kind: "item", index: 0 },
				},
			}),
		);
		transport.setCurrentState(initial);
		const session = new ClientLifecycleSession(transport);
		await session.start();
		session.stop();
		expect(session.entities.read()).toEqual({ kind: "pending" });
		expect(transport.handlers.size).toBe(0);
		const replacement = currentState(9);
		replacement.entities = {
			projectileSupply: { kind: "not-applicable" },
			worldContainer: { kind: "closed" },
			entities: [
				entityFacts(9, {
					description: {
						kind: "known",
						name: "New character",
						healthQuery: "eligible",
						itemType: 0,
						hasAlternateEquipSide: false,
						builtInSpell: null,
						mapCategory: "other",
						objectFlags: 0,
						wcid: null,
						weenieType: null,
						pyrealBalance: null,
						burden: null,
						equipLocations: null,
						consumable: null,
						useCapability: "direct" as const,
						stackCount: null,
						structure: { current: null, max: null },
						icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
					},
				}),
			],
		};
		transport.setCurrentState(replacement);
		await session.start();
		const read = session.entities.read();
		if (read.kind !== "current")
			throw new Error("Restart did not establish a baseline.");
		expect([...read.level.entities.keys()]).toEqual([9]);
		expect(read.level.entities.get(9)?.description).toEqual({
			kind: "known",
			name: "New character",
			healthQuery: "eligible",
			itemType: 0,
			hasAlternateEquipSide: false,
			builtInSpell: null,
			mapCategory: "other",
			objectFlags: 0,
			wcid: null,
			weenieType: null,
			pyrealBalance: null,
			burden: null,
			equipLocations: null,
			consumable: null,
			useCapability: "direct" as const,
			stackCount: null,
			structure: { current: null, max: null },
			icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
		});
		session.stop();
	});

	it("keeps shell and both mirrors unchanged when replacement validation fails", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		await session.start();
		const before = session.entities.read();
		const player = session.state().playerGuid;
		const invalid = currentState(9);
		invalid.dynamic.entities = [view(9), view(9)];
		expect(() => transport.emit("client-current-state", invalid)).toThrow(
			"duplicate GUID",
		);
		expect(session.state().playerGuid).toBe(player);
		expect(session.entities.read()).toBe(before);
		expect(
			session.mirror.entities().map((record) => record.identity.guid),
		).toEqual([player]);
	});

	it("marks recovery pending, gates both delta paths, and notifies only after replacement", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		await session.start();
		transport.emit("client-state-resyncing", null);
		expect(session.entities.read().kind).toBe("pending");
		transport.emit("client-entity-facts-changed", {
			projectileSupply: null,
			worldContainer: null,
			upserts: playerEntitySnapshot(9).entities,
			removed: [],
		});
		transport.emit("client-dynamic-entity", {
			kind: "upserted",
			entity: view(9),
		});
		expect(session.entities.read().kind).toBe("pending");
		const observed: number[] = [];
		session.subscribe((event) => {
			if (event.type !== "current-state" && event.type !== "dynamic") return;
			const read = session.entities.read();
			if (read.kind !== "current")
				throw new Error("Replacement notified before semantic commit.");
			expect(read.level.entities.has(9)).toBe(true);
			expect(
				session.mirror.entities().map((record) => record.identity.guid),
			).toEqual([9]);
			observed.push(9);
		});
		transport.emit("client-current-state", currentState(9));
		expect(observed).toEqual([9, 9]);
	});

	it("submits and delivers correlated entity-selection queries without mutating state", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const delivered: unknown[] = [];
		session.subscribe((event) => {
			if (event.type === "entity-selection-query-result")
				delivered.push(event.result);
		});
		await session.start();

		await session.queryEntitySelectionCandidates({
			camera: {
				cameraGeneration: 2,
				playerGuid: 0x5000_0001,
				entityGeneration: 7,
			},
			sequence: 12,
			anchor: 0xda55_ffff,
			start: landblockVector3([10, 20, 4]),
			direction: [0, 1, 0],
			previousCell: null,
		});
		transport.emit("client-entity-selection-query-result", {
			status: "available",
			sequence: 12,
			staticLimitDistance: 45,
			candidateGuids: [0x7000_0001],
		});

		expect(transport.invocations.at(-1)?.command).toBe(
			"query_client_entity_selection_candidates",
		);
		expect(delivered).toEqual([
			{
				status: "available",
				sequence: 12,
				staticLimitDistance: 45,
				candidateGuids: [0x7000_0001],
			},
		]);
		expect(session.state().playerGuid).toBe(0x5000_0001);
	});

	it("validates precise-jump commands and projects correlated results", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const events: string[] = [];
		session.subscribe((event) => events.push(event.type));
		await session.start();
		events.length = 0;

		const camera = {
			cameraGeneration: 2,
			playerGuid: 0x5000_0001,
			entityGeneration: 7,
		};
		await session.setPreciseJumpAim({
			camera,
			sequence: 9,
			anchor: 0xda55_ffff,
			start: landblockVector3([10, 20, 4]),
			direction: [0, 1, 0],
			maximumDistance: 80,
			previousCell: null,
		});
		await session.commitPreciseJump({ sequence: 3, evaluationId: 11 });
		await session.cancelPreciseJump({ sequence: 4 });

		transport.emit("client-precise-jump-evaluation", {
			evaluationId: 11,
			camera,
			sequence: 9,
			target: {
				anchor: 0xda55_ffff,
				point: [10, 40, 0],
				normal: [0, 0, 1],
				committedCell: null,
			},
			status: "reachable",
			trajectory: {
				anchor: 0xda55_ffff,
				origin: [10, 20, 4],
				velocity: [0, 14, 8],
				acceleration: [0, 0, -9.8],
				durationSeconds: 1.5,
				placements: [
					{
						startFraction: 0,
						endFraction: 1,
						committedCell: null,
					},
				],
			},
			diagnostics: {
				generatedCandidates: 6,
				evaluatedCandidates: 2,
				solverTicks: 71,
			},
		});
		transport.emit("client-precise-jump-transaction-feedback", {
			sequence: 3,
			outcome: { kind: "committed" },
		});

		expect(
			transport.invocations.slice(-3).map(({ command }) => command),
		).toEqual([
			"set_client_precise_jump_aim",
			"commit_client_precise_jump",
			"cancel_client_precise_jump",
		]);
		expect(events).toEqual([
			"precise-jump-evaluation",
			"precise-jump-transaction-feedback",
		]);
		await expect(
			session.setPreciseJumpAim({
				camera,
				sequence: 10,
				anchor: 0xda55_ffff,
				start: landblockVector3([Number.NaN, 0, 0]),
				direction: [0, 1, 0],
				maximumDistance: 80,
				previousCell: null,
			}),
		).rejects.toThrow();
	});

	it("suppresses deltas during recovery and accepts only the replacement snapshot", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		await session.start();

		transport.setCurrentState(currentState(0x5000_0002));
		transport.setEmitLaggedDeltaBeforeSnapshot(true);
		await session.requestCurrentState();

		expect(
			session.mirror.entities().map((entity) => entity.identity.guid),
		).toEqual([0x5000_0002]);
	});

	it("advances world generation atomically with portal lifecycle and rejects stale portals", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const lifecycles: ClientLifecycle[] = [];
		session.subscribe((event) => {
			if (event.type === "lifecycle") lifecycles.push(event.lifecycle);
		});
		await session.start();
		lifecycles.length = 0;

		const currentPortal: ClientLifecycle = {
			kind: "portal-space",
			cause: "teleport",
			worldGeneration: 4,
		};
		transport.emit("client-lifecycle-changed", currentPortal);
		expect(session.state()).toMatchObject({
			lifecycle: currentPortal,
			worldGeneration: 4,
		});

		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			cause: "teleport",
			worldGeneration: 3,
		});
		expect(session.state()).toMatchObject({
			lifecycle: currentPortal,
			worldGeneration: 4,
		});
		expect(lifecycles).toEqual([currentPortal]);
	});

	it("projects strict lifecycle, time, correction, and terminal updates", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const events: string[] = [];
		session.subscribe((event) => events.push(event.type));
		await session.start();
		transport.emit("client-local-player-established", { playerGuid: 9 });

		const lifecycle: ClientLifecycle = {
			kind: "character-selection",
			characters: [{ guid: 7, name: "Mira", slot: 3, deleteTime: 0 }],
		};
		transport.emit("client-lifecycle-changed", lifecycle);
		transport.emit("client-server-time-updated", { time: 12.5 });
		transport.emit("client-world-name-updated", { name: "Morningthaw" });
		transport.emit("client-player-entered", { playerGuid: 9, name: "Mira" });
		transport.emit("client-player-vitals-updated", {
			vitals: [{ kind: "health", current: 80, maximum: 100 }],
		});
		transport.emit("client-chat-message", {
			kind: "speech",
			sender: "Mira",
			speakerKind: "player",
			message: "Hello",
		});
		transport.emit("client-dynamic-script-cue", {
			guid: 9,
			generation: 3,
			cue: 7,
			intensity: 0.5,
		});
		transport.emit("client-server-controlled-motion", null);
		transport.emit("client-presentation-discontinuity", {
			worldGeneration: 4,
			kind: "reset",
		});
		transport.emit("client-exit-requested", {
			cause: "server-disconnect",
			diagnostic: "server closed the session",
		});

		expect(session.state()).toMatchObject({
			lifecycle: { kind: "exiting", cause: "server-disconnect" },
			worldGeneration: 4,
			playerGuid: 9,
			playerName: "Mira",
			knownSpells: null,
			enchantments: null,
			combatMode: "peace",
			worldName: "Morningthaw",
			vitals: [{ kind: "health", current: 80, maximum: 100 }],
			exit: {
				cause: "server-disconnect",
				diagnostic: "server closed the session",
			},
		});
		expect(events).toEqual([
			"current-state",
			"dynamic",
			"local-player-established",
			"lifecycle",
			"server-time",
			"world-name",
			"player-entered",
			"vitals",
			"chat",
			"dynamic-script-cue",
			"server-controlled-motion",
			"presentation-discontinuity",
			"lifecycle",
			"exit-requested",
		]);
	});

	it("validates the renderer drive before crossing the host command seam", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);

		await session.replaceDrive({
			kind: "acquire",
			drive: {
				gait: "run",
				longitudinal: "forward",
				lateral: "left",
				turning: null,
			},
		});
		expect(transport.calls).toEqual(["invoke:replace_client_drive"]);
		await session.replaceDrive({ kind: "release" });
		expect(transport.calls).toEqual([
			"invoke:replace_client_drive",
			"invoke:replace_client_drive",
		]);
		await expect(
			session.replaceDrive({
				kind: "acquire",
				drive: {
					gait: "sprint",
					longitudinal: null,
					lateral: null,
					turning: null,
				},
			} as never),
		).rejects.toThrow();
		expect(transport.calls).toHaveLength(2);
	});

	it("validates and forwards ordered character-motion edges without reshaping them", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const release = {
			kind: "release-jump" as const,
			sequence: 12,
			drive: {
				gait: "run" as const,
				longitudinal: "forward" as const,
				lateral: "right" as const,
				turning: null,
			},
			extent: 0.625,
		};

		await session.queueCharacterMotionEvent(release);

		expect(transport.invocations).toEqual([
			{
				command: "queue_client_character_motion_event",
				args: { request: release },
			},
		]);
		await expect(
			session.queueCharacterMotionEvent({
				...release,
				sequence: 13,
				extent: 1.1,
			}),
		).rejects.toThrow();
		expect(transport.invocations).toHaveLength(1);
	});

	it("replaces charge timing and projects sequenced character-motion feedback", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const events: string[] = [];
		session.subscribe((event) => events.push(event.type));
		await session.start();
		events.length = 0;

		transport.emit("client-character-motion-capabilities-updated", {
			fullChargeDurationMs: 800,
		});
		transport.emit("client-character-motion-feedback", {
			sequence: 17,
			outcome: { kind: "rejected", reason: "overburdened" },
		});

		expect(session.state().characterMotion).toEqual({
			fullChargeDurationMs: 800,
		});
		expect(events).toEqual([
			"character-motion-capabilities",
			"character-motion-feedback",
		]);
	});

	it("submits one exact character identity for an explicit enter action", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);

		await session.enterWorld(0x5000_0002);
		await session.enterWorld(0x5000_0002);

		expect(transport.calls).toEqual(["invoke:select_client_character"]);
	});

	it("recovers party without a sibling event, preserves early hydration through revelation, and retires it on stop", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const party: PartySnapshot = {
			name: "Raid",
			leader: 1,
			shareXp: true,
			evenShare: true,
			open: false,
			locked: false,
			capabilities: {
				isLeader: true,
				canRecruit: true,
				canChangeOpenness: true,
			},
			members: [
				{
					guid: 1,
					name: "Player",
					level: 10,
					canManage: false,
					vitals: [1, 2, 3, 4, 5, 6],
				},
			],
		};
		const preferences = {
			shareXp: true,
			shareLoot: false,
			ignoreRequests: false,
		};
		transport.setCurrentState({
			...currentState(1),
			party,
			partyPreferences: preferences,
			friends: null,
			contracts: null,
			squelch: null,
			allegiance: {
				playerGuid: null,
				profile: null,
				refreshing: false,
				canSwear: false,
			},
			allegiancePreferences: null,
			friendsPreferences: null,
		});
		await session.start();
		expect(session.partySnapshot()).toEqual(party);
		expect(session.partyPreferences()).toEqual(preferences);
		transport.emit("client-lifecycle-changed", {
			kind: "entering-world",
			characterGuid: 1,
		});
		expect(session.partySnapshot()).toBeNull();
		transport.emit("client-party-updated", { party });
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 3,
			cause: "initial-entry",
		});
		expect(session.partySnapshot()).toEqual(party);
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 4,
			cause: "teleport",
		});
		expect(session.partySnapshot()).toEqual(party);
		session.stop();
		expect(session.partySnapshot()).toBeNull();
		expect(session.partyPreferences()).toBeNull();
	});

	it("routes Ignores early delivery, recovery, portal retention, and retirement", async () => {
		const transport = new FakeClientTransport();
		transport.setCurrentState(currentState(42));
		const session = new ClientLifecycleSession(transport);
		await session.start();
		const squelch = {
			entries: [
				{
					guid: 10,
					name: "Amy",
					account: true,
					coverage: "all",
					removalScope: "account",
				},
			],
			legacyAccounts: [],
			globalCoverage: "none",
		};
		transport.emit("client-squelch-updated", { squelch });
		await session.squelch.request({
			kind: "remove",
			guid: 10,
			scope: "account",
		});
		expect(transport.invocations.at(-1)).toEqual({
			command: "submit_client_squelch",
			args: { action: { kind: "remove", guid: 10, scope: "account" } },
		});
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		expect(session.squelch.read().entries).toEqual(squelch.entries);
		expect(session.squelch.read().enabled).toBe(false);
		transport.emit("client-current-state", {
			...currentState(42),
			squelch: { entries: [], legacyAccounts: [], globalCoverage: "none" },
		});
		expect(session.squelch.read().pending).toBeNull();
		expect(session.squelch.read().known).toBe(true);
		transport.emit("client-lifecycle-changed", {
			kind: "entering-world",
			characterGuid: 99,
		});
		expect(session.squelch.read().known).toBe(false);
		transport.emit("client-squelch-updated", { squelch });
		transport.emit("client-local-player-established", { playerGuid: 99 });
		expect(session.squelch.read().entries).toEqual(squelch.entries);
		session.stop();
		expect(session.squelch.read().known).toBe(false);
	});

	it("routes Friends facts, character recovery, and mirrored options", async () => {
		const transport = new FakeClientTransport();
		transport.setCurrentState(currentState(42));
		const session = new ClientLifecycleSession(transport);
		await session.start();
		const friends = { members: [{ guid: 10, name: "Amy", online: true }] };
		transport.emit("client-friends-updated", { friends });
		transport.emit("client-character-preferences-updated", {
			appearance: { showHelmet: true, showCloak: true },
			party: { shareXp: false, shareLoot: false, ignoreRequests: false },
			friends: { appearOffline: false },
			allegiance: { showLogons: false },
		});
		expect(session.friends.read().members).toEqual(friends.members);
		await session.friends.request({ kind: "appearOffline", enabled: true });
		expect(transport.invocations.at(-1)).toEqual({
			command: "submit_client_friends",
			args: { action: { kind: "appearOffline", enabled: true } },
		});
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		expect(session.friends.read().known).toBe(true);
		transport.emit("client-current-state", {
			...currentState(42),
			friends,
			friendsPreferences: { appearOffline: true },
		});
		expect(session.friends.read().pending).toBeNull();
		expect(session.friends.read().preferences).toEqual({ appearOffline: true });
		transport.emit("client-lifecycle-changed", {
			kind: "entering-world",
			characterGuid: 99,
		});
		expect(session.friends.read().known).toBe(false);
		transport.emit("client-friends-updated", { friends });
		transport.emit("client-local-player-established", { playerGuid: 99 });
		expect(session.friends.read().members).toEqual(friends.members);
		session.stop();
		expect(session.friends.read().known).toBe(false);
	});

	it("retains appearance updates and submits an appearance change", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		await session.start();

		transport.emit("client-character-preferences-updated", {
			appearance: { showHelmet: false, showCloak: true },
			party: { shareXp: false, shareLoot: false, ignoreRequests: false },
			friends: { appearOffline: false },
			allegiance: { showLogons: false },
		});
		expect(session.state().appearanceOptions).toEqual({
			showHelmet: false,
			showCloak: true,
		});

		await session.setAppearanceOption("helmet", true);
		expect(transport.invocations.at(-1)).toEqual({
			command: "set_client_appearance_option",
			args: { option: "helmet", enabled: true },
		});
		session.stop();
	});

	it("restores appearance from snapshots, retains it during teleport, and retires it on character changes and resync", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const options = { showHelmet: false, showCloak: true };
		const snapshot = {
			...currentState(0x50000001),
			appearanceOptions: options,
		};
		transport.setCurrentState(snapshot);
		await session.start();
		expect(session.state().appearanceOptions).toEqual(options);
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		expect(session.state().appearanceOptions).toEqual(options);
		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 3,
			cause: "initial-entry",
		});
		expect(session.state().appearanceOptions).toBeNull();
		transport.emit("client-character-preferences-updated", {
			appearance: options,
			party: { shareXp: false, shareLoot: false, ignoreRequests: false },
			friends: { appearOffline: false },
			allegiance: { showLogons: false },
		});
		transport.emit("client-state-resyncing", null);
		expect(session.state().appearanceOptions).toBeNull();
		transport.emit("client-current-state", snapshot);
		expect(session.state().appearanceOptions).toEqual(options);
		session.stop();
		expect(session.state().appearanceOptions).toBeNull();
	});

	it("sends visible local speech and rejects empty input before transport", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);

		await session.sendChat("Hello world");
		expect(transport.calls).toEqual(["invoke:send_client_chat"]);
		await expect(session.sendChat("   ")).rejects.toThrow("visible text");
		expect(transport.calls).toHaveLength(1);
	});

	it("dispatches recall identities and recovers choices from replacement state", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const choices: string[][] = [];
		session.subscribe((event) => {
			if (event.type === "recall-destinations")
				choices.push([...event.destinations]);
			if (event.type === "current-state")
				choices.push(event.state.recallDestinations);
		});
		transport.setCurrentState({
			...currentState(1),
			recallDestinations: ["lifestone", "marketplace"],
		});
		await session.start();
		transport.emit("client-recall-destinations-changed", [
			"lifestone",
			"pk-arena",
		]);
		transport.emit("client-state-resyncing", null);
		transport.emit("client-current-state", {
			...currentState(1),
			recallDestinations: ["lifestone", "house"],
		});
		expect(choices).toEqual([
			["lifestone", "marketplace"],
			["lifestone", "pk-arena"],
			["lifestone", "house"],
		]);
		await session.recall("allegiance-hometown");
		expect(transport.invocations.at(-1)).toEqual({
			command: "recall_client",
			args: { destination: "allegiance-hometown" },
		});
		session.stop();
	});

	it("submits finite map points and forwards authoritative permission edges", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const permissions: boolean[] = [];
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "map-teleport-capability")
				permissions.push(event.allowed);
			if (event.type === "current-state")
				permissions.push(event.state.canTeleportFromMap);
		});
		transport.setCurrentState({ ...currentState(1), canTeleportFromMap: true });
		await session.start();
		transport.emit("client-map-teleport-capability-changed", false);
		expect(permissions).toEqual([true, false]);
		await session.teleportToMapPosition({ x: 42, z: -24 });
		expect(transport.invocations.at(-1)).toEqual({
			command: "teleport_client_to_map_position",
			args: { position: { x: 42, z: -24 } },
		});
		const count = transport.invocations.length;
		await expect(
			session.teleportToMapPosition({ x: NaN, z: -24 }),
		).rejects.toThrow();
		expect(transport.invocations).toHaveLength(count);
		unsubscribe();
		session.stop();
	});
});

function characterSheet(
	character: number,
): NonNullable<ClientCurrentState["characterSheet"]> {
	return {
		character,
		name: "Test Character",
		title: null,
		titleSelection: null,
		maximumLuminance: null,
		level: {
			level: 10,
			currentXp: "1000",
			unspentXp: "200",
			unspentSkillPoints: 2,
			availableLuminance: "0",
			nextLevelXp: "2000",
			xpIntoLevel: "0",
			xpForNextLevel: "1000",
		},
		attributes: [],
		vitals: [],
		skills: [],
		armor: 0,
		resistances: {
			slash: 1,
			pierce: 1,
			bludgeon: 1,
			fire: 1,
			cold: 1,
			acid: 1,
			electric: 1,
			nether: 1,
		},
		vitae: 1,
		guardedTargets: [],
	};
}

function currentState(playerGuid: number): ClientCurrentState {
	return {
		characterSheet: null,
		trade: { trade: null, pending_items: [] },
		lifecycle: { kind: "in-world" },
		entityCollisionDisabled: false,
		canTeleportFromMap: false,
		recallDestinations: [],
		housing: emptyHousing(),
		localPlayerGuid: playerGuid,
		entities: playerEntitySnapshot(playerGuid),
		serverTime: 10,
		worldGeneration: 2,
		connection: null,
		worldName: "Leafcull",
		playerName: "Drudge",
		knownSpells: null,
		enchantments: null,
		appearanceOptions: null,
		party: null,
		partyPreferences: null,
		friends: null,
		contracts: null,
		squelch: null,
		allegiance: {
			playerGuid: null,
			profile: null,
			refreshing: false,
			canSwear: false,
		},
		allegiancePreferences: null,
		friendsPreferences: null,
		combatMode: "peace",
		combat: { desired: null, state: "idle", refill: null },
		vitals: [],
		characterMotion: null,
		activeConfirmation: null,
		dynamic: {
			hostTime: { seconds: 10 },
			entities: [view(playerGuid)],
		},
	};
}

function view(guid: number): DynamicEntityView {
	return {
		generation: 1,
		identity: { guid, wcid: 42 },
		display: { name: "Drudge", level: null },
		presentation: {
			placementFrame: 0,
			entityClass: "other",
			content: {
				motionTableDid: null,
				setupDid: 0x0200_0001,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			objectScale: 1,
			radar: {
				behavior: null,
				category: "other",
				obviousRange: null,
			},
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
			translucency: 0,
			lighting: false,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			kind: "attached",
			parent: 0,
			parentLocation: "none",
			placement: "default",
		},
		motion: null,
	};
}

it("delivers host-projected vendor contracts through the real session into the draft owner", async () => {
	const transport = new FakeClientTransport();
	const session = new ClientLifecycleSession(transport);
	await session.start();
	const failures: string[] = [];
	const icons = new UiIconRepository({
		prepare: async (requests) =>
			requests.map(({ key }) => ({
				kind: "ready",
				key,
				image: new Uint8Array([1]),
			})),
		createImage: async () => "blob:fixture",
		revokeImage: () => {},
		report: () => {},
	});
	const model = new ClientVendorState(
		session,
		icons,
		(message) => failures.push(message),
		() => 0,
	);
	const latest = () => {
		const args = transport.invocations.at(-1)?.args;
		if (args === undefined) throw new Error("No vendor command");
		return vendorRequestSchema.parse(args.request);
	};
	try {
		transport.emit(
			vendorFixture.snapshot.event,
			vendorFixture.snapshot.payload,
		);
		model.read();
		const opening = latest();
		transport.emit(vendorFixture.preview.event, {
			...vendorFixture.preview.payload,
			sequence: opening.sequence,
			outcome: {
				kind: "ready",
				quote: { ...vendorFixture.preview.payload.outcome.quote, buys: [] },
			},
		});
		model.queueBuy(1000);
		model.confirmBuyQuantity(1000, 10);
		const candidate = latest();
		expect(candidate.draft).toEqual({
			vendor: 100,
			buys: [{ item: 1000, amount: 10 }],
			sells: [],
		});
		transport.emit(vendorFixture.preview.event, {
			...vendorFixture.preview.payload,
			sequence: candidate.sequence,
		});
		expect(model.read()?.queue).toMatchObject([
			{ name: "Food", amount: 10, total: 100 },
		]);
		expect(model.read()?.quote?.currencies).toHaveLength(2);
		model.trade();
		const submitted = latest();
		expect(transport.invocations.at(-1)?.command).toBe("submit_client_vendor");
		transport.emit(vendorFixture.phase.event, vendorFixture.phase.payload);
		expect(model.read()?.phase).toBe("buying");
		transport.emit(vendorFixture.failed.event, {
			...vendorFixture.failed.payload,
			sequence: submitted.sequence,
		});
		expect(failures).toEqual(["Purchase failed. Purchase refused"]);
		expect(latest().draft.buys).toEqual(submitted.draft.buys);
		transport.emit(vendorFixture.closed.event, vendorFixture.closed.payload);
		expect(model.read()).toBeNull();
	} finally {
		model.destroy();
		icons.dispose();
		session.stop();
	}
});
