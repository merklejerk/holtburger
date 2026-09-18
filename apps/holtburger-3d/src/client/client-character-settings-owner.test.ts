import { describe, expect, it, vi } from "vitest";
import { ClientCharacterSettingsOwner } from "./client-character-settings-owner";
import { createDefaultClientCharacterSettings } from "./client-settings-defaults";
import type { ClientCharacterSettingsLoad } from "./client-settings-transport";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => (resolve = accept));
	return { promise, resolve };
}

function ownerFixture() {
	const loads = new Map<
		number,
		ReturnType<typeof deferred<ClientCharacterSettingsLoad>>
	>();
	const saves: number[] = [];
	const states: string[] = [];
	const failures: unknown[] = [];
	const owner = new ClientCharacterSettingsOwner({
		transport: {
			loadCharacter: (guid) => {
				const pending = deferred<ClientCharacterSettingsLoad>();
				loads.set(guid, pending);
				return pending.promise;
			},
			saveCharacter: async (guid) => void saves.push(guid),
		},
		publish: (state) =>
			states.push(
				`${state.kind}:${"characterGuid" in state ? state.characterGuid : "none"}`,
			),
		loadFailed: (error) => failures.push(error),
		saveFailed: (error) => failures.push(error),
		saveDelayMs: 100,
	});
	return { owner, loads, saves, states, failures };
}

describe("ClientCharacterSettingsOwner", () => {
	it("rejects a late A load after switching to B", async () => {
		const fixture = ownerFixture();
		fixture.owner.acceptGuid(1);
		fixture.owner.acceptGuid(2);
		await vi.waitFor(() => expect(fixture.loads.size).toBe(2));
		fixture.loads.get(1)!.resolve({
			kind: "loaded",
			settings: createDefaultClientCharacterSettings(),
			lastKnownName: "A",
		});
		await Promise.resolve();
		expect(fixture.owner.state()).toMatchObject({
			kind: "loading",
			characterGuid: 2,
		});
		fixture.loads.get(2)!.resolve({ kind: "missing" });
		await vi.waitFor(() =>
			expect(fixture.owner.state()).toMatchObject({
				kind: "ready",
				characterGuid: 2,
			}),
		);
	});

	it("coalesces duplicate identity reports and captures a name during load", async () => {
		const fixture = ownerFixture();
		fixture.owner.acceptGuid(7);
		fixture.owner.acceptGuid(7);
		fixture.owner.acceptName(7, "Mira");
		await vi.waitFor(() => expect(fixture.loads.size).toBe(1));
		fixture.loads.get(7)!.resolve({ kind: "missing" });
		await vi.waitFor(() =>
			expect(fixture.owner.state()).toMatchObject({
				kind: "ready",
				characterGuid: 7,
				lastKnownName: "Mira",
			}),
		);
	});

	it("flushes an edited A snapshot before loading B", async () => {
		const fixture = ownerFixture();
		fixture.owner.acceptGuid(1);
		await vi.waitFor(() => expect(fixture.loads.has(1)).toBe(true));
		fixture.loads.get(1)!.resolve({ kind: "missing" });
		await vi.waitFor(() => expect(fixture.owner.state().kind).toBe("ready"));
		fixture.owner.change(createDefaultClientCharacterSettings());
		fixture.owner.acceptGuid(2);
		await vi.waitFor(() => expect(fixture.loads.has(2)).toBe(true));
		expect(fixture.saves).toEqual([1]);
	});
});
