import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientInventoryState } from "./client-inventory-state";
import { ClientEntityMirror } from "./client-entity-mirror";
import { entityFacts } from "./client-entity-mirror.test-support";
import { CLIENT_TUNING } from "./client-tuning";
import type { ClientLifecycle } from "./client-host-contract";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import {
	ItemIconRepository,
	type ItemIconServices,
} from "../app/item-icon-repository";

const item = (guid: number, base: number, parent = 1) => {
	const record = entityFacts(guid);
	if (record.description.kind !== "known")
		throw new Error("Known fixture required.");
	return {
		...record,
		ownedByPlayer: true,
		location: {
			kind: "contained" as const,
			parentGuid: parent,
			slot: { kind: "item" as const, index: guid },
		},
		description: {
			...record.description,
			icon: { base, overlay: null, underlay: null, uiEffects: 0 },
		},
	};
};
function fixture(
	initialLifecycle: ClientLifecycle | null = { kind: "in-world" },
) {
	const mirror = new ClientEntityMirror();
	const baseline = (items: ReturnType<typeof item>[], player = 1) =>
		mirror.commit(
			mirror.prepareSnapshot(
				{ entities: [entityFacts(player), ...items] },
				player,
			),
		);
	baseline([item(2, 10)]);
	let lifecycle: ClientLifecycle | null = initialLifecycle;
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	let image = 0;
	const services: ItemIconServices = {
		prepare: vi.fn<ItemIconServices["prepare"]>(async (requests) =>
			requests.map(({ key }) => ({
				kind: "ready",
				key,
				image: new Uint8Array([1]),
			})),
		),
		createImage: vi.fn(async () => `blob:${++image}`),
		revokeImage: vi.fn(),
		report: vi.fn(),
	};
	const icons = new ItemIconRepository(services);
	const model = new ClientInventoryState(
		{
			entities: mirror,
			state: () => ({ lifecycle }),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
		icons,
	);
	const changeLifecycle = (value: ClientLifecycle) => {
		lifecycle = value;
		for (const listener of listeners)
			listener({ type: "lifecycle", lifecycle });
	};
	return {
		mirror,
		model,
		icons,
		services,
		baseline,
		changeLifecycle,
		destroy: () => {
			model.destroy();
			icons.dispose();
		},
	};
}
const sample = () =>
	vi.advanceTimersByTimeAsync(CLIENT_TUNING.inventory.displayIntervalMs);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("persistent inventory state", () => {
	it("updates stack quantities through recovery without touching shared artwork", async () => {
		const f = fixture();
		await sample();
		const originalKeys = f.model.read().iconKeys;
		const stacked = (count: number) => {
			const entity = item(2, 10);
			return {
				...entity,
				description: { ...entity.description, stackCount: count },
			};
		};
		for (const count of [2, 20, 1]) {
			f.mirror.awaitSnapshot();
			await sample();
			expect(f.model.read().pending).toBe(true);
			f.baseline([stacked(count)]);
			await sample();
			expect(f.model.read().sections[0]?.items[0]?.description).toMatchObject({
				stackCount: count,
			});
			expect(f.model.read().iconKeys).toEqual(originalKeys);
		}
		expect(f.services.prepare).toHaveBeenCalledTimes(1);
		expect(f.services.createImage).toHaveBeenCalledTimes(2);
		expect(f.services.revokeImage).not.toHaveBeenCalled();
		f.destroy();
	});

	it("waits for usable lifecycle state when constructed before connection", async () => {
		const f = fixture(null);
		await sample();
		expect(f.model.read().pending).toBe(true);
		expect(f.services.prepare).not.toHaveBeenCalled();
		f.changeLifecycle({ kind: "in-world" });
		await sample();
		expect(f.model.read().pending).toBe(false);
		expect(f.services.createImage).toHaveBeenCalledTimes(2);
		f.destroy();
	});

	it("prepares before first display, reconciles hidden changes and keeps sort across entry", async () => {
		const f = fixture();
		await sample();
		expect(f.services.createImage).toHaveBeenCalledTimes(2);
		f.model.cycleSort();
		f.baseline([item(3, 11)]);
		await sample();
		expect(f.services.createImage).toHaveBeenCalledTimes(3);
		expect(f.services.revokeImage).toHaveBeenCalledTimes(1);
		expect(f.model.read().sections[0]?.items.map((item) => item.guid)).toEqual([
			3,
		]);
		expect(f.model.read().sortMode).toBe("alphabetical");
		f.mirror.awaitSnapshot();
		f.changeLifecycle({ kind: "entering-world", characterGuid: 1 });
		f.changeLifecycle({
			kind: "portal-space",
			cause: "initial-entry",
			worldGeneration: 2,
		});
		await sample();
		expect(f.model.read().sections).toEqual([]);
		expect(f.model.read().sortMode).toBe("alphabetical");
		expect(f.services.revokeImage).toHaveBeenCalledTimes(3);
		f.destroy();
	});
	it("preserves references through recovery and ordinary teleport", async () => {
		const f = fixture();
		await sample();
		f.mirror.awaitSnapshot();
		await sample();
		expect(f.model.read().pending).toBe(true);
		expect(f.services.revokeImage).not.toHaveBeenCalled();
		f.baseline([item(2, 10)]);
		f.changeLifecycle({
			kind: "portal-space",
			cause: "teleport",
			worldGeneration: 2,
		});
		await sample();
		expect(f.services.prepare).toHaveBeenCalledTimes(1);
		expect(f.model.read().pending).toBe(false);
		f.destroy();
	});
	it("does not evict on same-icon item handoff or second-consumer release", async () => {
		const f = fixture();
		await sample();
		const oldKey = f.model.read().iconKeys.get(2);
		if (!oldKey) throw new Error("Expected icon key.");
		const other = f.icons.createOwner("persistent");
		f.icons.retainKey(other, oldKey);
		f.baseline([item(3, 10)]);
		await sample();
		expect(f.model.read().iconKeys.get(3)).toBe(oldKey);
		expect(f.services.prepare).toHaveBeenCalledTimes(1);
		f.icons.releaseOwner(other);
		expect(f.services.revokeImage).not.toHaveBeenCalled();
		f.destroy();
	});
	it("resets references on a changed player snapshot and stops maintenance on destruction", async () => {
		const f = fixture();
		await sample();
		f.baseline([item(5, 12, 4)], 4);
		await sample();
		expect(f.services.revokeImage).toHaveBeenCalledTimes(2);
		expect(f.model.read().sections[0]?.container.guid).toBe(4);
		f.model.destroy();
		const count = vi.mocked(f.services.prepare).mock.calls.length;
		f.baseline([item(6, 13, 4)], 4);
		await sample();
		expect(f.services.prepare).toHaveBeenCalledTimes(count);
		f.icons.dispose();
	});
});
