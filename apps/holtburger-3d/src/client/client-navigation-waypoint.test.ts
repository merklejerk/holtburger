import { describe, expect, it, vi } from "vitest";
import type { MinimapSubject } from "../app/minimap-frame";
import {
	MAP_DEGREE_DISPLAY_BIAS,
	MAP_DEGREE_ORIGIN,
	METERS_PER_MAP_DEGREE,
	scenePointFromPrintedCoordinates,
} from "../lib/game/map/map-coordinates";
import {
	formatWaypointDistance,
	formatWaypointReadout,
	mapWaypointGuidance,
} from "../lib/game/map/map-waypoint";
import type { ClientLifecycle } from "./client-host-contract";
import { ClientNavigationWaypointOwner } from "./client-navigation-waypoint";

const NEAR_RADIUS = 10;
const CHARACTER = 1;
const target = {
	position: scenePointFromPrintedCoordinates({
		latitude: { magnitude: 0, hemisphere: "N" },
		longitude: { magnitude: 0, hemisphere: "E" },
	}),
	label: "0.0N, 0.0E",
};

function subject(
	east: number,
	south: number,
	headingRadians = 0,
): Extract<MinimapSubject, { kind: "controlled-entity" }> {
	return {
		kind: "controlled-entity",
		guid: CHARACTER,
		anchor: {
			worldX: target.position.x - east,
			worldZ: target.position.z - south,
			worldY: 500,
			headingRadians,
			residency: { landblockId: "0x7f7fffff", envCellId: null },
		},
	};
}

function fixture() {
	const owner = new ClientNavigationWaypointOwner(NEAR_RADIUS);
	owner.acceptCharacter(CHARACTER);
	const append = vi.fn();
	const notify = vi.fn();
	const read = () => owner.read(subject(100, 0), true);
	const command = (message: string) =>
		owner.runCommand(message, read, append, notify);
	return { owner, append, notify, read, command };
}

describe("waypoint geometry", () => {
	it.each([
		[0, -100, 0],
		[100, 0, Math.PI / 2],
		[0, 100, Math.PI],
		[-100, 0, -Math.PI / 2],
	])("points towards east=%s south=%s", (east, south, bearing) => {
		const player = subject(east, south);
		const display = mapWaypointGuidance(target, player.anchor, NEAR_RADIUS);
		expect(display).toMatchObject({
			kind: "guiding",
			distanceMeters: 100,
			relativeBearingRadians: bearing,
		});
	});
	it("subtracts player heading and ignores elevation", () => {
		const player = subject(300, -400, Math.PI / 2);
		expect(
			mapWaypointGuidance(target, player.anchor, NEAR_RADIUS),
		).toMatchObject({
			distanceMeters: 500,
			relativeBearingRadians: Math.atan2(300, 400) - Math.PI / 2,
		});
	});
	it("uses unrounded inclusive proximity and suppresses zero-distance direction", () => {
		for (const distance of [0, NEAR_RADIUS])
			expect(
				mapWaypointGuidance(target, subject(distance, 0).anchor, NEAR_RADIUS),
			).toEqual({ kind: "near", target, distanceMeters: distance });
		expect(
			mapWaypointGuidance(
				target,
				subject(NEAR_RADIUS + 0.01, 0).anchor,
				NEAR_RADIUS,
			).kind,
		).toBe("guiding");
	});
	it("formats shared distance and state readouts", () => {
		expect(formatWaypointDistance(842.3)).toBe("842 m");
		expect(formatWaypointDistance(1000)).toBe("1.0 km");
		expect(formatWaypointDistance(12400)).toBe("12.4 km");
		expect(
			formatWaypointReadout({ kind: "near", target, distanceMeters: 3 }),
		).toBe("Near waypoint · 3 m");
	});
});

describe("@waypoint", () => {
	it.each(["@waypoint", "@wp"])(
		"sets, replaces, reports, and clears through %s",
		(command) => {
			const f = fixture();
			expect(f.command(command)).toBe(true);
			expect(f.append).toHaveBeenLastCalledWith({
				kind: "system",
				message: expect.stringContaining("Usage:"),
			});
			expect(f.command(` ${command.toUpperCase()} 0.0n, 0.0e `)).toBe(true);
			expect(f.read()?.target).toEqual(target);
			expect(f.notify).toHaveBeenCalledExactlyOnceWith(
				"Waypoint set: 0.0N, 0.0E.",
			);
			expect(f.append).toHaveBeenCalledTimes(1);
			f.command(command);
			expect(f.append).toHaveBeenLastCalledWith({
				kind: "system",
				message: "0.0N, 0.0E · Waypoint · 100 m",
			});
			f.command(`${command} 42.345n 12.7890w`);
			expect(f.read()?.target.label).toBe("42.345N, 12.7890W");
			f.command(`${command} CLEAR`);
			expect(f.read()).toBeNull();
			expect(f.append).toHaveBeenLastCalledWith({
				kind: "system",
				message: "Waypoint cleared.",
			});
			f.command(`${command} clear`);
			expect(f.append).toHaveBeenLastCalledWith({
				kind: "system",
				message: "No waypoint is set.",
			});
		},
	);
	it.each([
		"@waypoint garbage",
		"@wp garbage",
		"@wp clear extra",
		"@wp 102N 0E",
		"@waypoint clear extra",
		"@waypoint 42N 12E 0Z",
		"@waypoint 102N 0E",
		"@waypoint 0N 102E",
		"@waypoint 102S 0E",
		"@waypoint 0N 102W",
		`@waypoint ${"9".repeat(308)}N 0E`,
	])(
		"retains the target and cannot fall through to server chat for %s",
		(input) => {
			const f = fixture();
			f.command("@waypoint 0.0N 0.0E");
			const send = vi.fn();
			expect(() => {
				if (!f.command(input)) send(input);
			}).toThrow();
			expect(send).not.toHaveBeenCalled();
			expect(f.read()?.target).toEqual(target);
		},
	);
	it.each(["hello", "@loc", "@waypoints", "@wpx", "/waypoint 0N 0E"])(
		"leaves %s to normal routing",
		(input) => {
			const f = fixture(),
				send = vi.fn();
			if (!f.command(input)) send(input);
			expect(send).toHaveBeenCalledExactlyOnceWith(input);
			expect(f.append).not.toHaveBeenCalled();
		},
	);
	it("rejects the exclusive upper edge and accepts the inclusive lower edge", () => {
		const f = fixture();
		const edge = MAP_DEGREE_ORIGIN - MAP_DEGREE_DISPLAY_BIAS;
		f.command(`@waypoint ${edge}S ${edge}W`);
		expect(f.read()?.target.position).toMatchObject({ x: 0, z: -0 });
		expect(() => f.command(`@waypoint ${edge}N 0E`)).toThrow("outside");
		f.command("@waypoint 101.9N 101.9E");
		expect(f.read()?.target.position.x).toBeLessThan(
			MAP_DEGREE_ORIGIN * 2 * METERS_PER_MAP_DEGREE,
		);
	});
	it("requires a character to set intent", () => {
		const f = fixture();
		f.owner.acceptCharacter(null);
		expect(() => f.command("@waypoint 0N 0E")).toThrow("Select a character");
	});
	it("retains targets while unavailable or indoors and resumes on coherent outdoor placement", () => {
		const f = fixture();
		f.command("@waypoint 0.0N 0.0E");
		const player = subject(100, 0);
		expect(f.owner.read(player, false)).toMatchObject({
			kind: "paused",
			target,
		});
		expect(f.owner.read(null, true)?.kind).toBe("paused");
		expect(
			f.owner.read(
				{ ...player, anchor: { ...player.anchor, residency: null } },
				true,
			)?.kind,
		).toBe("paused");
		expect(
			f.owner.read(
				{
					...player,
					anchor: {
						...player.anchor,
						residency: { landblockId: "0x7f7fffff", envCellId: "0x7f7f0100" },
					},
				},
				true,
			),
		).toMatchObject({ kind: "paused", reason: "Waypoint · paused indoors" });
		expect(
			f.owner.read({ kind: "free-camera", anchor: player.anchor }, true)?.kind,
		).toBe("paused");
		expect(f.owner.read({ ...player, guid: 2 }, true)?.kind).toBe("paused");
		expect(f.read()?.kind).toBe("guiding");
		expect(f.owner.read(subject(0, 0), true)?.kind).toBe("near");
		expect(f.read()?.kind).toBe("guiding");
	});
	it("retains the same character through portal travel and resets on character replacement", () => {
		const f = fixture();
		f.command("@waypoint 0.0N 0.0E");
		f.owner.acceptLifecycle({
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		f.owner.acceptLifecycle({ kind: "in-world" });
		f.owner.acceptCharacter(CHARACTER);
		expect(f.read()?.target).toEqual(target);
		f.owner.acceptLifecycle({ kind: "entering-world", characterGuid: 2 });
		expect(f.read()).toBeNull();
	});
	it("reconciles current-state replacement without losing a same-character waypoint", () => {
		const f = fixture();
		f.command("@waypoint 0.0N 0.0E");
		f.owner.acceptCurrentState({
			localPlayerGuid: CHARACTER,
			lifecycle: { kind: "in-world" },
		});
		expect(f.read()?.target).toEqual(target);
		f.owner.acceptCurrentState({
			localPlayerGuid: CHARACTER,
			lifecycle: {
				kind: "portal-space",
				worldGeneration: 2,
				cause: "teleport",
			},
		});
		expect(f.read()?.target).toEqual(target);
		f.owner.acceptCurrentState({
			localPlayerGuid: 2,
			lifecycle: { kind: "in-world" },
		});
		expect(f.read()).toBeNull();
		f.owner.acceptCurrentState({
			localPlayerGuid: CHARACTER,
			lifecycle: { kind: "in-world" },
		});
		f.command("@waypoint 0N 0E");
		f.owner.acceptCurrentState({
			localPlayerGuid: null,
			lifecycle: { kind: "character-selection", characters: [] },
		});
		expect(f.read()).toBeNull();
	});
	it("clears at initial activation even without a preceding character-entry event", () => {
		const f = fixture();
		f.command("@waypoint 0N 0E");
		f.owner.acceptLifecycle({
			kind: "portal-space",
			cause: "initial-entry",
			worldGeneration: 3,
		});
		expect(f.read()).toBeNull();
	});
	it.each([
		{ kind: "connecting" },
		{ kind: "authenticating" },
		{ kind: "character-selection", characters: [] },
		{ kind: "exiting", cause: "explicit-disconnect" },
	] satisfies ClientLifecycle[])("clears on retirement %s", (lifecycle) => {
		const f = fixture();
		f.command("@waypoint 0N 0E");
		f.owner.acceptLifecycle(lifecycle);
		expect(f.read()).toBeNull();
	});
});

describe("content waypoint activation", () => {
	it("sets and confirms through the same owner without entering command routing", () => {
		const f = fixture();
		f.owner.set(target, f.notify);
		expect(f.read()?.target).toEqual(target);
		expect(f.notify).toHaveBeenCalledExactlyOnceWith(
			"Waypoint set: 0.0N, 0.0E.",
		);
		expect(f.append).not.toHaveBeenCalled();
		f.owner.acceptCharacter(null);
		expect(() => f.owner.set(target, f.notify)).toThrow("Select a character");
		expect(f.read()).toBeNull();
	});
});
