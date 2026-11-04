import { CLIENT_ALLEGIANCE_REFRESH_INTERVAL_MS } from "./client-tuning";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientAllegianceState } from "./client-allegiance-state";
import {
	allegianceSnapshotSchema,
	type AllegianceAction,
	type AllegianceSnapshot,
} from "./client-allegiance-contract";

const player = 42;
const member = (guid: number, name: string) => ({
	guid,
	name,
	title: "Yeoman",
	rank: 1,
	level: 10,
	online: true,
	contributedXp: 3,
});
const patron = member(10, "Amy");
const vassal = member(11, "Ben");
const snapshot: AllegianceSnapshot = {
	playerGuid: player,
	refreshing: false,
	canSwear: false,
	profile: {
		name: "Allegiance",
		rank: 1,
		totalMembers: 20,
		totalDescendants: 10,
		monarch: patron,
		patron,
		selfMember: member(player, "Player"),
		directVassals: [vassal],
	},
};
function setup(
	submit: (action: AllegianceAction) => Promise<void> = async () => {},
) {
	const owner = new ClientAllegianceState(submit);
	owner.recover(snapshot, { showLogons: false }, player, true);
	return owner;
}

describe("Allegiance presentation", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("reads on activation and cadence, skips outstanding reads, and retains facts", async () => {
		const submit = vi.fn<(action: AllegianceAction) => Promise<void>>(
			async () => {},
		);
		const owner = setup(submit);
		owner.setVisible(true);
		expect(submit).toHaveBeenCalledExactlyOnceWith({ kind: "refresh" });
		await Promise.resolve();
		owner.update({ ...snapshot, refreshing: true });
		await vi.advanceTimersByTimeAsync(CLIENT_ALLEGIANCE_REFRESH_INTERVAL_MS);
		expect(submit).toHaveBeenCalledTimes(1);
		owner.update(snapshot);
		await vi.advanceTimersByTimeAsync(CLIENT_ALLEGIANCE_REFRESH_INTERVAL_MS);
		expect(submit).toHaveBeenCalledTimes(2);
		expect(owner.read().snapshot).toBe(snapshot);
		owner.setVisible(false);
		await vi.advanceTimersByTimeAsync(
			CLIENT_ALLEGIANCE_REFRESH_INTERVAL_MS * 2,
		);
		expect(submit).toHaveBeenCalledTimes(2);
		owner.setVisible(true);
		expect(submit).toHaveBeenCalledTimes(3);
	});

	it("starts when a visible tab becomes available and stops on retirement", async () => {
		const submit = vi.fn<(action: AllegianceAction) => Promise<void>>(
			async () => {},
		);
		const owner = new ClientAllegianceState(submit);
		owner.setVisible(true);
		expect(submit).not.toHaveBeenCalled();
		owner.recover(snapshot, { showLogons: true }, player, true);
		expect(submit).toHaveBeenCalledExactlyOnceWith({ kind: "refresh" });
		expect(owner.read().preferences).toEqual({ showLogons: true });
		await Promise.resolve();
		owner.setContext(player, false);
		await vi.advanceTimersByTimeAsync(
			CLIENT_ALLEGIANCE_REFRESH_INTERVAL_MS * 2,
		);
		expect(submit).toHaveBeenCalledTimes(1);
		owner.setContext(player, true);
		await Promise.resolve();
		expect(submit).toHaveBeenCalledTimes(2);
		owner.reset();
		await vi.advanceTimersByTimeAsync(
			CLIENT_ALLEGIANCE_REFRESH_INTERVAL_MS * 2,
		);
		expect(submit).toHaveBeenCalledTimes(2);
	});

	it("logs background dispatch failures without replacing player action feedback", async () => {
		const error = new Error("Host unavailable");
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const owner = setup(async () => {
				throw error;
			});
			await owner.request({ kind: "showLogons", enabled: true });
			const feedback = owner.read().feedback;
			owner.setVisible(true);
			await Promise.resolve();
			expect(log).toHaveBeenCalledWith(
				"Allegiance profile request failed",
				error,
			);
			expect(owner.read().feedback).toBe(feedback);
		} finally {
			log.mockRestore();
		}
	});

	it("reviews an exact relationship and keeps facts after queued break", async () => {
		const submit = vi.fn<(action: AllegianceAction) => Promise<void>>(
			async () => {},
		);
		const owner = setup(submit);
		owner.review("patron", patron.guid);
		expect(owner.read().review).toEqual({
			role: "patron",
			guid: patron.guid,
			name: patron.name,
			player,
		});
		expect(await owner.confirmReview()).toBe(true);
		expect(submit).toHaveBeenCalledExactlyOnceWith({
			kind: "break",
			guid: patron.guid,
		});
		expect(owner.read().snapshot).toBe(snapshot);
		expect(owner.read().review).toBeNull();
		expect(owner.read().submitting).toBe(false);
	});

	it.each(["relationship", "name", "character", "availability", "close"])(
		"retires %s changes before destructive dispatch",
		async (change) => {
			const submit = vi.fn<(action: AllegianceAction) => Promise<void>>(
				async () => {},
			);
			const owner = setup(submit);
			owner.setVisible(true);
			await Promise.resolve();
			submit.mockClear();
			owner.review("vassal", vassal.guid);
			const profile = snapshot.profile;
			if (profile === null) throw new Error("Fixture profile missing");
			if (change === "relationship")
				owner.update({
					...snapshot,
					profile: { ...profile, directVassals: [] },
				});
			if (change === "name")
				owner.update({
					...snapshot,
					profile: {
						...profile,
						directVassals: [{ ...vassal, name: "Renamed" }],
					},
				});
			if (change === "character") owner.setContext(player + 1, true);
			if (change === "availability") owner.setContext(player, false);
			if (change === "close") owner.setVisible(false);
			expect(owner.read().review).toBeNull();
			expect(await owner.confirmReview()).toBe(false);
			expect(
				submit.mock.calls.some(([action]) => action.kind === "break"),
			).toBe(false);
		},
	);

	it("preserves review on presence/XP updates without treating read completion as mutation evidence", () => {
		const owner = setup();
		owner.review("patron", patron.guid);
		const profile = snapshot.profile;
		if (profile === null) throw new Error("Fixture profile missing");
		owner.update({
			...snapshot,
			profile: {
				...profile,
				patron: { ...patron, online: false, contributedXp: 4 },
			},
		});
		expect(owner.read().review?.guid).toBe(patron.guid);
	});

	it("guards swear eligibility, self targets, and concurrent queue work", async () => {
		let resolve: () => void = () => {};
		const submit = vi.fn(
			() =>
				new Promise<void>((done) => {
					resolve = done;
				}),
		);
		const owner = setup(submit);
		expect(owner.canSwear(patron.guid)).toBe(false);
		owner.update({ ...snapshot, canSwear: true, profile: null });
		expect(owner.canSwear(player)).toBe(false);
		const request = owner.request({ kind: "swear", guid: patron.guid });
		expect(owner.read().submitting).toBe(true);
		expect(await owner.request({ kind: "refresh" })).toBe(false);
		resolve();
		expect(await request).toBe(true);
		expect(submit).toHaveBeenCalledExactlyOnceWith({
			kind: "swear",
			guid: patron.guid,
		});
		expect(owner.read().snapshot?.profile).toBeNull();
	});

	it("does not resurrect late dispatch failures after character retirement", async () => {
		let reject: (reason: Error) => void = () => {};
		const owner = setup(
			() =>
				new Promise<void>((_, fail) => {
					reject = fail;
				}),
		);
		const request = owner.request({ kind: "showLogons", enabled: true });
		owner.reset();
		reject(new Error("Old character failure"));
		expect(await request).toBe(false);
		expect(owner.read().feedback).toBeNull();
		expect(owner.read().submitting).toBe(false);
	});

	it("rejects invalid wire fields while preserving capped totals and nullable levels", () => {
		expect(allegianceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
		expect(
			allegianceSnapshotSchema.safeParse({ ...snapshot, extra: true }).success,
		).toBe(false);
		expect(
			allegianceSnapshotSchema.safeParse({ ...snapshot, playerGuid: -1 })
				.success,
		).toBe(false);
	});
});
