import { describe, expect, it, vi } from "vitest";
import {
	emptyHousing,
	type HousingSnapshot,
	type HousingManagementRequest,
} from "./client-housing-contract";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import {
	ClientHousingManagementState,
	type HousingManagementSession,
} from "./client-housing-management-state";

function fixture(initial?: HousingSnapshot) {
	let housing: HousingSnapshot = initial ?? {
		...emptyHousing(),
		home: {
			kind: "owned",
			home: {
				houseType: 1,
				boughtAt: 100,
				maintenanceFree: true,
				buy: [],
				rent: [],
				maintenancePaid: true,
				period: null,
				position: {
					landblockId: 0x12340001,
					coords: { x: 0, y: 0, z: 0 },
					rotation: { w: 1, x: 0, y: 0, z: 0 },
				},
			},
		},
		access: {
			generation: 3,
			records: {
				publicEntry: false,
				guests: [],
				allegiance: null,
				roommates: null,
			},
			refreshing: false,
		},
	};
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const submit = vi
		.fn<(request: HousingManagementRequest) => Promise<void>>()
		.mockResolvedValue(undefined);
	const query = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
	const failure = vi.fn<(message: string) => void>();
	const session: HousingManagementSession = {
		housingSnapshot: () => housing,
		state: () => ({ playerGuid: 1, lifecycle: { kind: "in-world" } }),
		queryHousingAccess: query,
		submitHousingManagement: submit,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	const model = new ClientHousingManagementState(session, failure);
	function emit(event: ClientLifecycleSessionEvent): void {
		if (event.type === "housing-updated") housing = event.housing;
		for (const listener of listeners) listener(event);
	}
	return {
		model,
		session,
		emit,
		submit,
		query,
		failure,
		housing: () => housing,
	};
}

describe("housing management review and receipt ownership", () => {
	it.each([
		{ kind: "bootEveryone" } as const,
		{ kind: "bootGuest", name: "Fixture guest" } as const,
		{ kind: "removeGuest", name: "Fixture guest" } as const,
		{ kind: "removeAllGuests" } as const,
		{ kind: "addAllStorage" } as const,
		{ kind: "removeAllStorage" } as const,
		{ kind: "publicEntry", enabled: false } as const,
		{ kind: "allegianceEntry", enabled: true } as const,
		{ kind: "allegianceStorage", enabled: false } as const,
	])("submits $kind directly and blocks duplicate requests", async (action) => {
		const f = fixture();
		f.model.request(action);
		f.model.request(action);
		expect(f.submit).toHaveBeenCalledTimes(1);
		expect(f.submit.mock.calls[0][0].action).toEqual(action);
		expect(f.model.read().confirmation).toBeNull();
		expect(f.model.question()).toBeNull();
		expect(f.model.read().pending).toBe(true);
		await Promise.resolve();
		f.model.destroy();
	});

	it("freezes submitted action fields and ignores receipts after character retirement", async () => {
		const f = fixture();
		const action = { kind: "removeGuest" as const, name: "Reviewed guest" };
		f.model.request(action);
		action.name = "Changed guest";
		expect(f.submit.mock.calls[0][0].action).toEqual({
			kind: "removeGuest",
			name: "Reviewed guest",
		});
		const request = f.submit.mock.calls[0]?.[0];
		if (request === undefined) throw new Error("Missing submitted request");
		await Promise.resolve();
		f.emit({
			type: "lifecycle",
			lifecycle: {
				kind: "character-selection",
				rejection: null,
				maxSlots: 11,
				characters: [],
			},
		});
		f.emit({
			type: "housing-management-finished",
			result: {
				sequence: request.sequence,
				generation: request.generation,
				outcome: { kind: "requested" },
			},
		});
		expect(f.model.read().pending).toBe(false);
		f.model.destroy();
	});

	it("cancels abandonment and refuses an answer from an older modal", () => {
		const f = fixture();
		f.model.request({ kind: "abandon" });
		const first = f.model.read().confirmation;
		if (first === null) throw new Error("Missing abandonment question");
		expect(f.model.question()).toEqual({
			requestId: first.requestId,
			text: first.message,
			typedConfirmation: { requiredText: "abandon" },
		});
		f.model.respond(first.requestId, false);
		expect(f.model.read().confirmation).toBeNull();
		f.model.request({ kind: "abandon" });
		f.model.respond(first.requestId, true);
		expect(f.submit).not.toHaveBeenCalled();
		f.model.destroy();
	});

	it("does not query on construction and confirms abandonment once with its reviewed home identity", async () => {
		const f = fixture();
		expect(f.query).not.toHaveBeenCalled();
		f.model.request({ kind: "abandon" });
		expect(f.submit).not.toHaveBeenCalled();
		expect(f.model.read().confirmation?.message).toContain("remove its deed");
		f.model.confirm();
		f.model.confirm();
		expect(f.submit).toHaveBeenCalledTimes(1);
		expect(f.submit.mock.calls[0]?.[0]).toMatchObject({
			player: 1,
			generation: 3,
			action: { kind: "abandon" },
		});
		expect(f.model.read().pending).toBe(true);
		await Promise.resolve();
		f.model.destroy();
	});

	it("retires confirmation on changed home facts and resync without dispatch", () => {
		const f = fixture();
		f.model.request({ kind: "abandon" });
		f.emit({
			type: "housing-updated",
			housing: {
				...f.housing(),
				access: { ...f.housing().access, generation: 4 },
			},
		});
		expect(f.model.read().confirmation).toBeNull();
		f.model.confirm();
		expect(f.submit).not.toHaveBeenCalled();
		f.model.request({ kind: "abandon" });
		f.emit({ type: "resyncing" });
		expect(f.model.read().confirmation).toBeNull();
		f.model.destroy();
	});

	it("correlates terminal results and keeps core rejection feedback as the toast owner", async () => {
		const f = fixture();
		f.model.request({ kind: "hooks", enabled: false });
		const request = f.submit.mock.calls[0]?.[0];
		if (request === undefined) throw new Error("Missing submitted request");
		await Promise.resolve();
		f.emit({
			type: "housing-management-finished",
			result: {
				sequence: request.sequence + 1,
				generation: request.generation,
				outcome: { kind: "requested" },
			},
		});
		expect(f.model.read().pending).toBe(true);
		f.emit({
			type: "housing-management-finished",
			result: {
				sequence: request.sequence,
				generation: request.generation,
				outcome: { kind: "requested" },
			},
		});
		expect(f.model.read().pending).toBe(false);
		expect(f.failure).not.toHaveBeenCalled();
		f.model.request({ kind: "allegianceEntry", enabled: true });
		const refused = f.submit.mock.calls[1]?.[0];
		if (refused === undefined) throw new Error("Missing allegiance request");
		await Promise.resolve();
		f.emit({
			type: "housing-management-finished",
			result: {
				sequence: refused.sequence,
				generation: refused.generation,
				outcome: { kind: "rejected", reason: "Only the owner can do this" },
			},
		});
		expect(f.model.read().pending).toBe(false);
		expect(f.failure).not.toHaveBeenCalled();
		f.model.destroy();
	});

	it("recovers submitted admission without reopening confirmation and blocks competing payment", () => {
		const f = fixture();
		const pending = {
			sequence: 41,
			generation: 3,
			action: { kind: "abandon" as const },
		};
		f.emit({
			type: "housing-updated",
			housing: { ...f.housing(), pendingManagement: pending },
		});
		const recovered = new ClientHousingManagementState(f.session, f.failure);
		expect(recovered.read().pending).toBe(true);
		expect(recovered.read().confirmation).toBeNull();
		recovered.request({ kind: "hooks", enabled: true });
		expect(f.submit).not.toHaveBeenCalled();
		recovered.destroy();
		f.model.destroy();
		const payment = fixture({
			...f.housing(),
			pendingManagement: null,
			pendingPayment: { sequence: 4, crystal: 5, purpose: "maintenance" },
		});
		expect(payment.model.read().editable).toBe(false);
		payment.model.destroy();
	});

	it("retains a checkbox intention through stale refreshes and replaces it when the window ends", async () => {
		const f = fixture();
		f.model.request({ kind: "publicEntry", enabled: true });
		expect(f.model.read().publicEntry).toBe(true);
		await Promise.resolve();
		const request = f.submit.mock.calls[0][0];
		f.emit({
			type: "housing-management-finished",
			result: {
				sequence: request.sequence,
				generation: request.generation,
				outcome: { kind: "requested" },
			},
		});
		f.emit({
			type: "housing-updated",
			housing: {
				...f.housing(),
				access: { ...f.housing().access, refreshing: true },
			},
		});
		expect(f.model.read().publicEntry).toBe(true);
		expect(f.model.read().editable).toBe(true);
		// Background facts remain unchanged until the window closes, even across view reads.
		expect(f.model.read().publicEntry).toBe(true);
		f.emit({
			type: "housing-updated",
			housing: {
				...f.housing(),
				access: { ...f.housing().access, refreshing: false },
			},
		});
		expect(f.model.read().publicEntry).toBe(false);
		expect(f.failure).not.toHaveBeenCalled();
		f.model.destroy();
	});

	it("defaults undisclosed booleans off and keeps requested allegiance relationships until disclosure", async () => {
		const f = fixture();
		expect(f.model.read().allegianceEntry).toBe(false);
		expect(f.model.read().allegianceStorage).toBe(false);
		f.model.request({ kind: "allegianceStorage", enabled: true });
		expect(f.model.read().allegianceStorage).toBe(true);
		expect(f.model.read().allegianceEntry).toBe(true);
		await Promise.resolve();
		const request = f.submit.mock.calls[0][0];
		f.emit({
			type: "housing-management-finished",
			result: {
				sequence: request.sequence,
				generation: request.generation,
				outcome: { kind: "requested" },
			},
		});
		for (const refreshing of [true, false])
			f.emit({
				type: "housing-updated",
				housing: {
					...f.housing(),
					access: { ...f.housing().access, refreshing },
				},
			});
		expect(f.model.read().allegianceStorage).toBe(true);
		f.emit({
			type: "housing-updated",
			housing: {
				...f.housing(),
				access: {
					...f.housing().access,
					generation: f.housing().access.generation + 1,
				},
			},
		});
		expect(f.model.read().allegianceStorage).toBe(false);
		f.model.destroy();
	});

	it("revokes storage for all displayed guests and reconciles permissions after refresh", async () => {
		const f = fixture();
		f.emit({
			type: "housing-updated",
			housing: {
				...f.housing(),
				access: {
					...f.housing().access,
					records: {
						publicEntry: false,
						allegiance: null,
						roommates: null,
						guests: [
							{ character: 2, name: "First", storageAllowed: false },
							{ character: 3, name: "Second", storageAllowed: true },
						],
					},
				},
			},
		});
		f.model.request({ kind: "removeAllStorage" });
		expect(f.model.read().guests?.map((guest) => guest.storageChecked)).toEqual(
			[false, false],
		);
		await Promise.resolve();
		const request = f.submit.mock.calls[0][0];
		f.emit({
			type: "housing-management-finished",
			result: {
				sequence: request.sequence,
				generation: request.generation,
				outcome: { kind: "requested" },
			},
		});
		for (const refreshing of [true, false])
			f.emit({
				type: "housing-updated",
				housing: {
					...f.housing(),
					access: { ...f.housing().access, refreshing },
				},
			});
		expect(f.model.read().guests?.map((guest) => guest.storageChecked)).toEqual(
			[false, true],
		);
		f.model.destroy();
	});

	it("ignores an older refusal while a newer checkbox request is pending", async () => {
		const f = fixture();
		f.model.request({ kind: "publicEntry", enabled: false });
		await Promise.resolve();
		const older = f.submit.mock.calls[0][0];
		f.emit({
			type: "housing-management-finished",
			result: {
				sequence: older.sequence,
				generation: older.generation,
				outcome: { kind: "requested" },
			},
		});
		f.model.request({ kind: "publicEntry", enabled: true });
		f.emit({
			type: "housing-management-finished",
			result: {
				sequence: older.sequence,
				generation: older.generation,
				outcome: { kind: "rejected", reason: "Old refusal" },
			},
		});
		expect(f.model.read().publicEntry).toBe(true);
		expect(f.model.read().pending).toBe(true);
		await Promise.resolve();
		f.model.destroy();
	});

	it("releases local admission on transport failure with one toast", async () => {
		const f = fixture();
		f.submit.mockRejectedValueOnce(new Error("Host unavailable"));
		f.model.request({ kind: "publicEntry", enabled: true });
		expect(f.model.read().publicEntry).toBe(true);
		await Promise.resolve();
		expect(f.model.read().pending).toBe(false);
		expect(f.model.read().publicEntry).toBe(false);
		expect(f.failure).toHaveBeenCalledExactlyOnceWith(
			"Error: Host unavailable",
		);
		f.model.destroy();
	});
});
