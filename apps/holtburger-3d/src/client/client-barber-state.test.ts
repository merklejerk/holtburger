import { describe, expect, it } from "vitest";
import fixture from "./fixtures/barber-wire.json";
import {
	barberPreviewSchema,
	barberSnapshotSchema,
	type BarberRequest,
	type BarberSnapshot,
	type BarberPreview,
} from "./client-barber-contract";
import { ClientBarberState } from "./client-barber-state";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";

function setup(
	requestGate: Promise<void> | null = null,
	initialSnapshot: BarberSnapshot = barberSnapshotSchema.parse(
		fixture.snapshot,
	),
) {
	let snapshot = initialSnapshot;
	const requests: BarberRequest[] = [];
	let listener: ((event: ClientLifecycleSessionEvent) => void) | null = null;
	const presented: (BarberPreview | null)[] = [];
	let visualGate: Promise<void> | null = null;
	const model = new ClientBarberState(
		{
			barberSnapshot: () => snapshot,
			subscribe: (next) => {
				listener = next;
				return () => {
					listener = null;
				};
			},
			requestBarber: async (request) => {
				requests.push(request);
				if (requests.length === 1 && requestGate !== null) await requestGate;
			},
		},
		async (preview) => {
			presented.push(preview);
			if (preview !== null && visualGate !== null) await visualGate;
		},
		() => {},
	);
	return {
		blockVisual: (gate: Promise<void>) => {
			visualGate = gate;
		},
		model,
		requests,
		presented,
		snapshot: (next: BarberSnapshot) => {
			snapshot = next;
			listener?.({ type: "barber-updated", barber: next });
		},
		preview: (revision: number) =>
			listener?.({
				type: "barber-preview",
				result: { ...barberPreviewSchema.parse(fixture.preview), revision },
			}),
	};
}

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
}

describe("barber editor", () => {
	it("starts a recreated editor above the core's recovered draft revision", async () => {
		const snapshot = barberSnapshotSchema.parse(fixture.snapshot);
		if (snapshot.interaction?.phase.kind !== "editing")
			throw new Error("Expected editable fixture.");
		snapshot.interaction.phase.revision = 7;
		const f = setup(null, snapshot);
		expect(f.requests.at(-1)).toMatchObject({
			kind: "preview",
			draft: { revision: 8 },
		});
		await f.model.destroy();
	});

	it("does not dispatch queued edits after destruction", async () => {
		const f = setup();
		let release: () => void = () => {
			throw new Error("Visual gate has not initialized.");
		};
		f.blockVisual(
			new Promise<void>((resolve) => {
				release = resolve;
			}),
		);
		f.preview(1);
		const original = f.model.read().choices;
		if (original === null) throw new Error("Expected editable fixture.");
		f.model.change({ ...original, body: { ...original.body, eyes: 2 } });
		await f.model.destroy();
		release();
		await settle();
		await settle();
		expect(f.requests).toHaveLength(1);
	});

	it("continues the newest queued edit after an older preview request fails", async () => {
		let rejectRequest: (error: Error) => void = () => {
			throw new Error("Request gate has not initialized.");
		};
		const gate = new Promise<void>((_resolve, reject) => {
			rejectRequest = reject;
		});
		const f = setup(gate);
		const original = f.model.read().choices;
		if (original === null) throw new Error("Expected editable fixture.");
		f.model.change({ ...original, body: { ...original.body, eyes: 2 } });
		rejectRequest(new Error("Preview command failed."));
		await settle();
		expect(f.requests.at(-1)).toMatchObject({
			kind: "preview",
			draft: { revision: 2, choices: { body: { eyes: 2 } } },
		});
		f.preview(2);
		await settle();
		expect(f.model.read().canApply).toBe(true);
		expect(f.model.read().problem).toBeNull();
		await f.model.destroy();
	});

	it("withdraws an obsolete renderer preparation immediately while coalescing later edits", async () => {
		const f = setup();
		const releases: (() => void)[] = [];
		const gate = new Promise<void>((resolve) => {
			releases.push(resolve);
		});
		f.blockVisual(gate);
		f.preview(1);
		const original = f.model.read().choices;
		if (original === null) throw new Error("Expected editable fixture.");
		f.model.change({ ...original, body: { ...original.body, eyes: 2 } });
		expect(f.presented.at(-1)).toBeNull();
		expect(f.requests).toHaveLength(1);
		for (const release of releases) release();
		await settle();
		await settle();
		expect(f.requests.at(-1)).toMatchObject({
			kind: "preview",
			draft: { revision: 2 },
		});
		expect(f.model.read().canApply).toBe(false);
		await f.model.destroy();
	});

	it("coalesces edits and applies only the exact installed revision once", async () => {
		const f = setup();
		const original = f.model.read().choices;
		if (original === null) throw new Error("Expected editable fixture.");
		expect(f.requests).toHaveLength(1);
		f.model.change({ ...original, body: { ...original.body, eyes: 2 } });
		f.model.change({ ...original, body: { ...original.body, eyes: 3 } });
		expect(f.requests).toHaveLength(1);
		f.model.apply();
		expect(f.requests).toHaveLength(1);
		f.preview(1);
		await settle();
		expect(f.requests.at(-1)).toMatchObject({
			kind: "preview",
			draft: { revision: 3 },
		});
		expect(f.presented.filter((x) => x !== null)).toHaveLength(0);
		f.preview(3);
		await settle();
		expect(f.model.read().canApply).toBe(true);
		f.model.apply();
		f.model.apply();
		expect(f.requests.filter((x) => x.kind === "apply")).toHaveLength(1);
		await f.model.destroy();
	});

	it("cannot reinstall canceled or replaced openings from late previews", async () => {
		const f = setup();
		f.model.cancel();
		f.preview(1);
		await settle();
		expect(f.model.read().interaction).toBeNull();
		f.snapshot(barberSnapshotSchema.parse(fixture.snapshot));
		expect(f.model.read().interaction).toBeNull();
		expect(f.presented.filter((x) => x !== null)).toHaveLength(0);
		expect(f.requests.at(-1)).toEqual({ kind: "cancel", id: 12 });
		const snapshot = barberSnapshotSchema.parse(fixture.snapshot);
		if (snapshot.interaction === null)
			throw new Error("Expected interaction fixture.");
		f.snapshot({
			...snapshot,
			interaction: { ...snapshot.interaction, id: 13 },
		});
		f.preview(1);
		await settle();
		expect(f.model.read().interaction?.id).toBe(13);
		expect(f.presented.filter((x) => x !== null)).toHaveLength(0);
		await f.model.destroy();
	});
});
