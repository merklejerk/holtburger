import { describe, it, expect } from "vitest";
import {
	contractMapMarkers,
	contractLocationWaypoint,
	contractMapTooltips,
} from "./client-contracts-map";
import {
	contractsUpdatedSchema,
	type ContractRow,
} from "./client-contracts-contract";
import { ClientContractsState } from "./client-contracts-state";
import fixture from "../harness/browser/fixtures/contracts.json";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";
import { formatWorldMapCoordinates } from "../lib/game/map/map-coordinates";

type Resolved = Extract<ContractRow, { kind: "resolved" }>;
function contact(): Resolved {
	const row = contractsUpdatedSchema.parse(fixture).contracts?.rows[0];
	if (row?.kind !== "resolved") throw new Error("Expected fixture contact");
	return row;
}

describe("contract map projection", () => {
	it("uses source positions and retains unfiltered facts independently of Journal controls", () => {
		const owner = new ClientContractsState(
			async () => {},
			() => 0,
		);
		owner.recover({ rows: [contact()] }, 42, true);
		owner.setSearch("absent");
		owner.setFilters(["inProgress"]);
		expect(owner.read().journal?.rows).toEqual([]);
		const markers = contractMapMarkers(owner.readFacts());
		expect(markers).toHaveLength(1);
		expect(markers[0]?.position).toEqual([
			128 * OUTDOOR_LANDBLOCK_WORLD_SIZE + 6,
			25,
			-(128 * OUTDOOR_LANDBLOCK_WORLD_SIZE + 12),
		]);
		expect(markers[0]?.entries[0]).toMatchObject({
			role: "start",
			npc: "Fred",
		});
		owner.reset();
		expect(contractMapMarkers(owner.readFacts())).toEqual([]);
	});
	it("shows selected outdoor contacts in every status and quest areas when available or in progress", () => {
		const row = contact();
		if (row.contact === null) throw new Error("Expected fixture contact");
		for (const [status, roles] of [
			[{ kind: "available" }, ["area", "start"]],
			[{ kind: "inProgress", progress: null }, ["area", "start"]],
			[{ kind: "completed" }, ["start"]],
			[{ kind: "waitingToRepeat", remainingSeconds: 10 }, ["start"]],
		] as const) {
			const markers = contractMapMarkers({
				rows: [
					{
						...row,
						status,
						area: row.contact.location,
					},
				],
			});
			expect(
				markers.flatMap((marker) => marker.entries.map((entry) => entry.role)),
			).toEqual(roles);
		}
		const area = contractsUpdatedSchema.parse(fixture).contracts?.rows[1];
		if (area?.kind !== "resolved") throw new Error("Expected fixture area");
		expect(
			contractMapMarkers({ rows: [area] }).flatMap((marker) =>
				marker.entries.map((entry) => entry.role),
			),
		).toEqual(["area"]);
		const both = {
			...row,
			status: { kind: "inProgress", progress: null } as const,
			area: area.area,
			deadline: { kind: "finished" } as const,
		};
		expect(contractMapMarkers({ rows: [both] })).toHaveLength(2);
		expect(
			contractMapMarkers({
				rows: [
					{
						...row,
						contact: { role: "end", name: "Only end", location: row.area },
					},
				],
			}),
		).toEqual([]);
		expect(
			contractMapMarkers({ rows: [{ kind: "unresolved", id: 99 }] }),
		).toEqual([]);
	});
	it("groups exact horizontal points across identities and roles while preserving tooltip facts", () => {
		const row = contact();
		if (row.contact === null) throw new Error("Expected contact");
		const both: Resolved = {
			...row,
			status: { kind: "inProgress", progress: "7 Wins" },
			area: row.contact.location,
		};
		const facts = { rows: [both, { ...row, id: 2 }] };
		const markers = contractMapMarkers(facts);
		expect(markers).toHaveLength(1);
		expect(markers[0]?.entries.map((entry) => [entry.id, entry.role])).toEqual([
			[1, "area"],
			[1, "start"],
			[2, "start"],
		]);
		const tooltip = [...contractMapTooltips(markers, facts).values()].join(
			"\n",
		);
		expect(tooltip).toContain("Start contact: Fred");
		expect(tooltip).toContain("Quest area");
		expect(tooltip).toContain("In progress");
		const position = markers[0]?.position;
		if (position === undefined) throw new Error("Expected map point");
		expect(tooltip).toContain(
			formatWorldMapCoordinates({ x: position[0], z: position[2] }),
		);
	});
	it("keeps a sole end contact honestly labeled after completion and checks each outdoor role independently", () => {
		const row = contact();
		if (row.contact === null) throw new Error("Expected fixture contact");
		const endContact = {
			...row.contact,
			role: "end" as const,
			name: "Only end",
		};
		const completed: Resolved = {
			...row,
			status: { kind: "completed" },
			contact: endContact,
			area: row.contact.location,
		};
		const facts = { rows: [completed] };
		const markers = contractMapMarkers(facts);
		expect(
			markers.flatMap((marker) => marker.entries.map((entry) => entry.role)),
		).toEqual(["end"]);
		expect(
			[...contractMapTooltips(markers, facts).values()].join("\n"),
		).toContain("End contact: Only end");
		const indoor = { kind: "indoor", cellId: 0x80800100 } as const;
		const progress: Resolved = {
			...completed,
			status: { kind: "inProgress", progress: null },
		};
		const indoorContact: Resolved = {
			...progress,
			contact: { ...endContact, location: indoor },
		};
		expect(
			contractMapMarkers({ rows: [indoorContact] }).flatMap((marker) =>
				marker.entries.map((entry) => entry.role),
			),
		).toEqual(["area"]);
		expect(
			contractMapMarkers({ rows: [{ ...progress, area: indoor }] }).flatMap(
				(marker) => marker.entries.map((entry) => entry.role),
			),
		).toEqual(["end"]);
	});
	it("keeps different positions in one cell separate and skips off-map points", () => {
		const row = contact();
		if (row.contact?.location.kind !== "outdoor")
			throw new Error("Expected outdoor contact");
		const location = row.contact.location;
		const second: Resolved = {
			...row,
			id: 2,
			contact: {
				...row.contact,
				location: {
					...location,
					position: { ...location.position, coords: { x: 7, y: 12, z: 25 } },
				},
			},
		};
		expect(contractMapMarkers({ rows: [row, second] })).toHaveLength(2);
		const offMap: Resolved = {
			...second,
			contact: {
				...row.contact,
				location: {
					...location,
					position: {
						...location.position,
						coords: { x: -50000, y: 12, z: 25 },
					},
				},
			},
		};
		expect(contractMapMarkers({ rows: [offMap] })).toEqual([]);
	});
});

describe("contract journal waypoints", () => {
	it("uses exact authored offsets even when the visible cell label is zero", () => {
		const row = contact();
		if (row.contact?.location.kind !== "outdoor")
			throw new Error("Expected outdoor fixture");
		const location = { ...row.contact.location, latitude: 0, longitude: 0 };
		const target = contractLocationWaypoint(location);
		const marker = contractMapMarkers({
			rows: [{ ...row, contact: { ...row.contact, location } }],
		})[0];
		expect(target?.position).toMatchObject({
			x: marker?.position[0],
			z: marker?.position[2],
		});
		expect(target?.label).toBe(
			formatWorldMapCoordinates({
				x: 128 * OUTDOOR_LANDBLOCK_WORLD_SIZE + 6,
				z: -(128 * OUTDOOR_LANDBLOCK_WORLD_SIZE + 12),
			}),
		);
	});
	it("leaves missing, indoor, and upper-grid-edge destinations noninteractive", () => {
		expect(contractLocationWaypoint({ kind: "missing" })).toBeNull();
		expect(
			contractLocationWaypoint({ kind: "indoor", cellId: 0x80800100 }),
		).toBeNull();
		const row = contact();
		if (row.contact?.location.kind !== "outdoor")
			throw new Error("Expected outdoor fixture");
		const location = {
			...row.contact.location,
			position: {
				...row.contact.location.position,
				landblockId: 0xfe800001,
				coords: { x: OUTDOOR_LANDBLOCK_WORLD_SIZE, y: 0, z: 0 },
			},
		};
		expect(contractLocationWaypoint(location)).toBeNull();
		expect(
			contractMapMarkers({
				rows: [{ ...row, contact: { ...row.contact, location } }],
			}),
		).toHaveLength(1);
	});
});
