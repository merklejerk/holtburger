import { describe, expect, it, vi } from "vitest";
import { UiIconRepository } from "../app/ui-icon-repository";
import {
	ClientEntityMirror,
	type ClientEntityFacts,
	type WorldContainerState,
} from "./client-entity-mirror";
import { entityFacts } from "./client-entity-mirror.test-support";
import { ClientWorldContainerPanelState } from "./client-world-container-panel-state";

function fixture() {
	const mirror = new ClientEntityMirror();
	const submitInventory = vi.fn(async () => {});
	const closeContainer = vi.fn(async () => {});
	const report = vi.fn();
	const icons = new UiIconRepository({
		prepare: async (requests) =>
			requests.map(({ key }) => ({
				kind: "ready",
				key,
				image: new Uint8Array([1]),
			})),
		createImage: async () => "blob:fixture",
		revokeImage: vi.fn(),
		report,
	});
	const model = new ClientWorldContainerPanelState(
		{
			entities: mirror,
			state: () => ({ lifecycle: { kind: "in-world" } }),
			submitInventory,
			closeContainer,
		},
		icons,
		report,
	);
	const root = entityFacts(10, {
		storage: {
			kind: "container",
			roster: "announced",
			itemCapacity: 8,
			packCapacity: 7,
		},
	});
	const pack = entityFacts(11, {
		worldContainerContent: true,
		canPickUp: true,
		location: {
			kind: "contained",
			parentGuid: root.guid,
			slot: { kind: "pack", index: 0, entryKind: "container" },
		},
		storage: {
			kind: "container",
			roster: "announced",
			itemCapacity: 8,
			packCapacity: 0,
		},
	});
	const child = entityFacts(12, {
		worldContainerContent: true,
		canPickUp: true,
		location: {
			kind: "contained",
			parentGuid: pack.guid,
			slot: { kind: "item", index: 0 },
		},
	});
	const replace = (
		access: WorldContainerState,
		records: readonly ClientEntityFacts[],
	) =>
		mirror.commit(
			mirror.prepareSnapshot(
				{
					projectileSupply: { kind: "not-applicable" },
					worldContainer: access,
					entities: [entityFacts(1), ...records],
				},
				1,
			),
		);
	replace({ kind: "open", root: root.guid }, [root, pack, child]);
	return {
		model,
		mirror,
		root,
		pack,
		child,
		replace,
		submitInventory,
		closeContainer,
		report,
		destroy: () => {
			model.destroy();
			icons.dispose();
		},
	};
}

describe("external contents presentation", () => {
	it("groups pending descendants and keeps foci lootable without presenting them as packs", () => {
		const f = fixture();
		const pending = {
			...f.child,
			canPickUp: false,
			description: { kind: "pending" as const },
		};
		const focus = entityFacts(13, {
			worldContainerContent: true,
			canPickUp: true,
			location: {
				kind: "contained",
				parentGuid: f.root.guid,
				slot: { kind: "pack", index: 1, entryKind: "foci" },
			},
		});
		f.replace({ kind: "open", root: f.root.guid }, [
			f.root,
			f.pack,
			pending,
			focus,
		]);
		const view = f.model.read();
		expect(view?.sections.map((section) => section.container.guid)).toEqual([
			10, 11,
		]);
		expect(view?.packs.map((pack) => pack.guid)).toEqual([10, 11]);
		expect(view?.sections[0]?.packs.map((item) => item.guid)).toEqual([13]);
		expect(view?.sections[1]?.items[0]?.description.kind).toBe("pending");
		f.model.pickup(pending.guid);
		expect(f.submitInventory).not.toHaveBeenCalled();
		f.model.pickup(focus.guid);
		expect(f.submitInventory).toHaveBeenCalledWith({
			item: 13,
			target: { kind: "pickup", container: null },
		});
		f.destroy();
	});

	it("can close a same-root reopen even when the display never sampled the closed interval", async () => {
		const f = fixture();
		f.model.read();
		f.model.close(f.root.guid);
		await vi.waitFor(() => expect(f.closeContainer).toHaveResolved());
		f.replace({ kind: "closed" }, []);
		f.replace({ kind: "open", root: f.root.guid }, [f.root, f.pack, f.child]);
		f.model.read();
		f.model.close(f.root.guid);
		expect(f.closeContainer).toHaveBeenCalledTimes(2);
		f.destroy();
	});

	it("revalidates pickup and close identities while recovery and replacement change access", async () => {
		const f = fixture();
		f.model.read();
		f.model.pickup(f.pack.guid);
		expect(f.submitInventory).toHaveBeenCalledWith({
			item: 11,
			target: { kind: "pickup", container: null },
		});
		// Submission leaves membership intact until the server changes storage.
		expect(f.model.read()?.sections).toHaveLength(2);
		f.model.close(10);
		f.model.close(10);
		expect(f.closeContainer).toHaveBeenCalledTimes(1);
		f.mirror.awaitSnapshot();
		expect(f.model.read()?.pending).toBe(true);
		f.model.pickup(f.child.guid);
		expect(f.submitInventory).toHaveBeenCalledTimes(1);
		f.replace({ kind: "closed" }, []);
		expect(f.model.read()).toBeNull();
		const other = entityFacts(20, {
			storage: {
				kind: "container",
				roster: "announced",
				itemCapacity: 8,
				packCapacity: 0,
			},
		});
		f.replace({ kind: "open", root: other.guid }, [other]);
		expect(f.model.read()?.root.guid).toBe(20);
		expect(f.model.read()?.sections[0]?.items).toEqual([]);
		f.model.close(10);
		expect(f.closeContainer).toHaveBeenCalledTimes(1);
		f.model.close(20);
		expect(f.closeContainer).toHaveBeenLastCalledWith(20);
		await Promise.resolve();
		f.destroy();
	});
});
