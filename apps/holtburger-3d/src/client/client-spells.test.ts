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
	const components = vi.spyOn(references, "components").mockResolvedValue(
		new Map([
			[
				188,
				{
					id: 188,
					name: "Prismatic Taper",
					artwork: {
						kind: "ready",
						spec: { kind: "spell-component", base: 188 },
					},
				},
			],
		]),
	);
	const load = vi.spyOn(references, "load").mockImplementation(async (ids) =>
		ids.map((id) => ({
			kind: "known",
			details: {
				description: "Description",
				school: 3,
				baseMana: 10,
				manaPerTarget: 0,
				durationSeconds: 60,
				classification: {
					beneficial: true,
					level: 1,
					target: "other",
					fellowship: false,
					damage: "acid",
				},
			},
			id,
			name: `Spell ${id}`,
			artwork: { kind: "ready", spec },
		})),
	);
	const icons = new UiIconRepository(services);
	const query = vi.fn<ClientSpellServices["session"]["querySpellInspection"]>(
		async () => {},
	);
	const state = new ClientSpellState(
		{
			state: () => ({ knownSpells }),
			querySpellInspection: query,
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
		query,
		components,
		emit(
			event: Parameters<
				Parameters<ClientSpellServices["session"]["subscribe"]>[0]
			>[0],
		) {
			for (const listener of listeners) listener(event);
		},
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
	it("retains cold filters across membership changes and clears them on character reset", () => {
		const f = fixture();
		f.state.search = { text: "acid", tags: ["acid"] };
		f.set([1]);
		expect(f.state.search).toEqual({ text: "acid", tags: ["acid"] });
		f.set(null);
		expect(f.state.search).toEqual({ text: "", tags: [] });
		f.state.destroy();
	});
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
						details: {
							description: "Description",
							school: 3,
							baseMana: 10,
							manaPerTarget: 0,
							durationSeconds: 60,
							classification: {
								beneficial: true,
								level: 1,
								target: "other",
								fellowship: false,
								damage: "acid",
							},
						},
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

describe("independent spell inspections", () => {
	it("correlates consumers and retires replies after context changes and reset", () => {
		const f = fixture();
		const first = vi.fn();
		const second = vi.fn();
		const releaseFirst = f.state.inspect(1, first);
		const releaseSecond = f.state.inspect(2, second);
		const requests = f.query.mock.calls.map(([request]) => request);
		const reply = (request: (typeof requests)[number], revision: number) =>
			f.emit({
				type: "spell-inspection-result",
				result: {
					...request,
					context: { revision, player: 1 },
					outcome: {
						kind: "ready",
						rangeMetres: 25,
						formula: { kind: "ready", components: [1, 188, 0, 0, 0, 0, 0, 0] },
					},
				},
			});
		for (const request of requests) reply(request, 1);
		expect(first).toHaveBeenLastCalledWith({
			kind: "ready",
			rangeMetres: 25,
			formula: { kind: "ready", components: [1, 188, 0, 0, 0, 0, 0, 0] },
		});
		expect(second).toHaveBeenLastCalledWith({
			kind: "ready",
			rangeMetres: 25,
			formula: { kind: "ready", components: [1, 188, 0, 0, 0, 0, 0, 0] },
		});
		f.emit({
			type: "spell-inspection-context",
			context: { revision: 2, player: 1 },
		});
		for (const request of requests) reply(request, 1);
		expect(first).toHaveBeenLastCalledWith({ kind: "pending" });
		expect(second).toHaveBeenLastCalledWith({ kind: "pending" });
		const current = f.query.mock.calls.slice(2).map(([request]) => request);
		releaseFirst();
		first.mockClear();
		for (const request of current) reply(request, 2);
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenLastCalledWith({
			kind: "ready",
			rangeMetres: 25,
			formula: { kind: "ready", components: [1, 188, 0, 0, 0, 0, 0, 0] },
		});
		f.set(null);
		for (const request of current) reply(request, 2);
		expect(second).toHaveBeenLastCalledWith({ kind: "pending" });
		releaseSecond();
		f.state.destroy();
		f.icons.dispose();
	});
});

describe("formula component artwork ownership", () => {
	it("preserves repeated slots, shares images, and protects an independent display after reset", async () => {
		const f = fixture();
		const rows = await f.state.components(1, [188, 188]);
		expect(rows.map((row) => row.id)).toEqual([188, 188]);
		await vi.waitFor(() =>
			expect(f.services.createImage).toHaveBeenCalledTimes(1),
		);
		await f.state.components(2, [188]);
		await f.state.components(1, [188]);
		expect(f.services.createImage).toHaveBeenCalledTimes(1);
		const owner = f.icons.createOwner("display");
		f.icons.retain(owner, { kind: "spell-component", base: 188 });
		f.set(null);
		expect(f.services.revokeImage).not.toHaveBeenCalled();
		f.icons.releaseOwner(owner);
		expect(f.services.revokeImage).toHaveBeenCalledTimes(1);
		f.state.destroy();
		f.icons.dispose();
	});
	it("does not retain a pending formula after its context retires", async () => {
		const f = fixture();
		let release: () => void = () => {
			throw new Error("Missing gate");
		};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const definitions = await f.components();
		f.components.mockImplementationOnce(async () => {
			await gate;
			return definitions;
		});
		const work = f.state.components(1, [188]);
		f.emit({
			type: "spell-inspection-context",
			context: { revision: 2, player: 1 },
		});
		release();
		await work;
		expect(f.services.prepare).not.toHaveBeenCalled();
		f.state.destroy();
		f.icons.dispose();
	});
});
