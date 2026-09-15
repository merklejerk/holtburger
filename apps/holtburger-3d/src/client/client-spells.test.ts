import { describe, expect, it, vi } from "vitest";
import { SpellReferences } from "../app/spell-references";
import {
	UiIconRepository,
	type UiIconServices,
} from "../app/ui-icon-repository";
import { ClientSpellState, type ClientSpellServices } from "./client-spells";

function fixture() {
	let knownSpells: readonly number[] | null = [1, 2];
	const listeners = new Set<
		Parameters<ClientSpellServices["session"]["subscribe"]>[0]
	>();
	const services: UiIconServices = {
		prepare: vi.fn<UiIconServices["prepare"]>(async (requests) =>
			requests.map(({ key }) => ({
				kind: "ready" as const,
				key,
				image: new Uint8Array([1]),
			})),
		),
		createImage: vi.fn(async () => "blob:spell"),
		revokeImage: vi.fn(),
		report: vi.fn(),
	};
	const spec = {
		kind: "spell",
		base: 1,
		background: 2,
		effects: 3,
		overlay: null,
	} as const;
	const references = new SpellReferences({ invoke: async () => [] });
	const load = vi.spyOn(references, "load").mockImplementation(async (ids) =>
		ids.map((id) => ({
			kind: "known",
			id,
			name: `Spell ${id}`,
			artwork: { kind: "ready", spec },
		})),
	);
	const icons = new UiIconRepository(services);
	const state = new ClientSpellState(
		{
			state: () => ({ knownSpells }),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
		references,
		icons,
	);
	return {
		state,
		icons,
		services,
		spec,
		load,
		set(ids: readonly number[] | null) {
			knownSpells = ids;
			for (const listener of listeners) listener({ type: "resyncing" });
		},
	};
}

describe("ClientSpellState artwork lifetime", () => {
	it("loads lazily, survives panel close, and releases shared artwork after its last known spell", async () => {
		const f = fixture();
		expect(f.load).not.toHaveBeenCalled();
		await f.state.load([1, 2]);
		const panel = f.icons.createOwner("display");
		const key = f.icons.retain(panel, f.spec);
		await vi.waitFor(() => expect(f.icons.read(key).kind).toBe("ready"));
		f.icons.releaseOwner(panel);
		expect(f.services.revokeImage).not.toHaveBeenCalled();
		await f.state.load([1, 2]);
		expect(f.services.prepare).toHaveBeenCalledTimes(1);
		f.set([2]);
		expect(f.services.revokeImage).not.toHaveBeenCalled();
		f.set([]);
		expect(f.services.revokeImage).toHaveBeenCalledOnce();
		f.state.destroy();
	});

	it.each(["reset", "destroy"] as const)(
		"rejects pending retention after %s",
		async (action) => {
			const f = fixture();
			let release: () => void = () => {
				throw new Error("Lookup gate is not initialized.");
			};
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			f.load.mockImplementationOnce(async () => {
				await gate;
				return [
					{
						kind: "known",
						id: 1,
						name: "Spell",
						artwork: { kind: "ready", spec: f.spec },
					},
				];
			});
			const work = f.state.load([1]);
			if (action === "reset") {
				f.set(null);
				f.set([1]);
			} else f.state.destroy();
			release();
			await work;
			expect(f.services.prepare).not.toHaveBeenCalled();
			f.state.destroy();
		},
	);

	it("leaves an independent spell bar lease alive across character teardown", async () => {
		const f = fixture();
		await f.state.load([1]);
		const bar = f.icons.createOwner("display");
		const key = f.icons.retain(bar, f.spec);
		await vi.waitFor(() => expect(f.icons.read(key).kind).toBe("ready"));
		f.set(null);
		f.state.destroy();
		expect(f.services.revokeImage).not.toHaveBeenCalled();
		f.icons.releaseOwner(bar);
		expect(f.services.revokeImage).toHaveBeenCalledOnce();
	});
});
