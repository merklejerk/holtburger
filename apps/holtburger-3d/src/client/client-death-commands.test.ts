import type { ClientChatEntry } from "./client-chat-policy";
import { clientCommandHelp } from "./client-command-help";
import { describe, expect, it, vi } from "vitest";
import {
	ClientDeathCommands,
	deathLocationLines,
	parseDeathCommand,
} from "./client-death-commands";
import type { ClientLifecycle } from "./client-host-contract";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import { deathLocationResultSchema } from "./client-death-contract";
import { waypointTextSpans } from "../lib/game/map/map-waypoint";

function fixture() {
	let state: { playerGuid: number | null; lifecycle: ClientLifecycle | null } =
		{ playerGuid: 7, lifecycle: { kind: "in-world" } };
	let receiver: (event: ClientLifecycleSessionEvent) => void = () => {};
	const append = vi.fn<(message: ClientChatEntry) => void>();
	const session = {
		state: () => state,
		subscribe: (listener: typeof receiver) => {
			receiver = listener;
			return () => {
				receiver = () => {};
			};
		},
		queryDeathLocations: vi.fn().mockResolvedValue(undefined),
		manageCorpseConsent: vi.fn().mockResolvedValue(undefined),
		setCorpseConsent: vi.fn().mockResolvedValue(undefined),
		setCorpsePermission: vi.fn().mockResolvedValue(undefined),
		killCharacter: vi.fn().mockResolvedValue(undefined),
	};
	const commands = new ClientDeathCommands(session, append);
	return {
		commands,
		session,
		append,
		receive: (event: ClientLifecycleSessionEvent) => receiver(event),
		retire: () => {
			state = {
				playerGuid: null,
				lifecycle: {
					kind: "character-selection",
					rejection: null,
					maxSlots: 11,
					characters: [],
				},
			};
			receiver({ type: "resyncing" });
		},
	};
}

describe("h3d death commands", () => {
	it("owns both prefixes, case, names, and typed dispatch", async () => {
		const f = fixture();
		for (const prefix of ["/", "@"]) {
			await f.commands.run(`${prefix}CoRpSe`);
			await f.commands.run(`${prefix}corpses`);
			await f.commands.run(`${prefix}permit Best Friend`);
			await f.commands.run(`${prefix}unpermit Best Friend`);
			await f.commands.run(`${prefix}consent who`);
			await f.commands.run(`${prefix}consent clear`);
			await f.commands.run(`${prefix}consent remove Best Friend`);
			await f.commands.run(`${prefix}consent OFF`);
		}
		expect(f.session.queryDeathLocations.mock.calls).toEqual([
			["last-outdoor"],
			["recent"],
			["last-outdoor"],
			["recent"],
		]);
		expect(f.session.setCorpsePermission).toHaveBeenCalledWith(
			"Best Friend",
			true,
		);
		expect(f.session.setCorpsePermission).toHaveBeenCalledWith(
			"Best Friend",
			false,
		);
		expect(f.session.manageCorpseConsent).toHaveBeenCalledWith({
			kind: "remove",
			playerName: "Best Friend",
		});
		expect(f.session.setCorpseConsent).toHaveBeenCalledWith(false);
		f.commands.destroy();
	});
	it.each([
		"/corpse extra",
		"@permit",
		"/consent remove",
		"/consent who extra",
		"@die now",
	])("rejects malformed recognized text %s", (text) => {
		expect(() => parseDeathCommand(text)).toThrow("Usage:");
	});
	it("passes unrecognized text through", async () => {
		const f = fixture();
		for (const text of ["ordinary speech", "@unknown", "/ls"])
			expect(await f.commands.run(text)).toBe(false);
		expect(f.append).not.toHaveBeenCalled();
		f.commands.destroy();
	});
	it("explains bare consent without sending game actions", async () => {
		const f = fixture();
		expect(await f.commands.run("/consent")).toBe(true);
		expect(f.append).toHaveBeenCalledExactlyOnceWith(
			clientCommandHelp("consent"),
		);
		expect(f.session.manageCorpseConsent).not.toHaveBeenCalled();
		f.commands.destroy();
	});
	it("requires confirmation for every suicide alias and retires old questions", async () => {
		const f = fixture();
		for (const text of ["/die", "@die", "/rip", "@RIP"]) {
			await f.commands.run(text);
			const question = f.commands.question();
			if (question === null) throw new Error("Missing confirmation");
			f.commands.respond(question.requestId, false);
		}
		expect(f.session.killCharacter).not.toHaveBeenCalled();
		await f.commands.run("/die");
		const question = f.commands.question();
		if (question === null) throw new Error("Missing confirmation");
		f.commands.respond(question.requestId, true);
		f.commands.respond(question.requestId, true);
		expect(f.session.killCharacter).toHaveBeenCalledTimes(1);
		await f.commands.run("/die");
		f.retire();
		expect(f.commands.question()).toBeNull();
		f.commands.destroy();
	});
	it("formats only current-character replies and rejects stale results", () => {
		const f = fixture();
		const result = deathLocationResultSchema.parse({
			character: 7,
			locations: { kind: "recent", positions: [] },
		});
		f.receive({ type: "death-locations", result });
		expect(f.append).toHaveBeenCalledExactlyOnceWith({
			kind: "system",
			message: "No deaths observed this session.",
		});
		f.retire();
		f.receive({ type: "death-locations", result });
		expect(f.append).toHaveBeenCalledTimes(1);
		f.commands.destroy();
	});
});

describe("historical coordinate output", () => {
	const position = {
		landblockId: 0xda550001,
		coords: { x: 12, y: 34, z: 56 },
		rotation: { w: 1, x: 0, y: 0, z: 0 },
	};
	it("uses the existing clickable outdoor grammar and preserves indoor cells", () => {
		const result = deathLocationResultSchema.parse({
			character: 7,
			locations: {
				kind: "recent",
				positions: [position, { ...position, landblockId: 0xda550100 }, null],
			},
		});
		const lines = deathLocationLines(result);
		expect(
			waypointTextSpans(lines[1]).filter((span) => span.target !== null),
		).toHaveLength(1);
		expect(lines[2]).toContain("0xda550100");
		expect(
			waypointTextSpans(lines[2]).every((span) => span.target === null),
		).toBe(true);
		expect(lines[3]).toContain("unavailable");
	});
	it("distinguishes an absent saved bookmark from empty session history", () => {
		const result = deathLocationResultSchema.parse({
			character: 7,
			locations: { kind: "last-outdoor", position: null },
		});
		expect(deathLocationLines(result)).toEqual([
			"No saved last outdoor death location.",
		]);
	});
});
