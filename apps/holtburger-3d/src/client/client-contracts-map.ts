import { sceneVector3, type SceneVector3 } from "../lib/assets/ac-frame";
import { createLandblockWorldOrigin } from "../lib/game/landblocks";
import { WORLD_MAP_EXTENT } from "../lib/game/world-map/types";
import {
	formatWorldMapCoordinates,
	sceneMapPoint,
} from "../lib/game/map/map-coordinates";
import {
	waypointFromMapPoint,
	type MapWaypointTarget,
} from "../lib/game/map/map-waypoint";
import { contractStatusLabel } from "./client-contracts-view";
import type {
	ContractRow,
	ContractsSnapshot,
	ContractLocation,
} from "./client-contracts-contract";

/** One authored destination role; status does not choose the map glyph. */
type ContractMapEntry = {
	/** Identity remains distinct even when names or destinations coincide. */
	readonly id: number;
	/** Authored contract name. */
	readonly name: string;
} & (
	| { /** Area points do not invent an NPC. */ readonly role: "area" }
	| {
			/** Authored role of the selected contact. */ readonly role:
				"start" | "end";
			/** The contact's authored NPC name. */ readonly npc: string;
	  }
);

/** Exact coincident horizontal points share one icon; altitude is not a 2D distinction. */
export interface ContractMapMarker {
	/** Stable horizontal placement identity, independent of pan/zoom/status. */
	readonly key: string;
	/** Canonical scene position converted once at this app-owned boundary. */
	readonly position: SceneVector3;
	/** Every contract/role at this point, in stable tooltip order. */
	readonly entries: readonly ContractMapEntry[];
}

/** Project accepted unfiltered facts; Journal controls never participate. */
export function contractMapMarkers(
	facts: ContractsSnapshot | null,
): readonly ContractMapMarker[] {
	const markers = new Map<
		string,
		{ key: string; position: SceneVector3; entries: ContractMapEntry[] }
	>();
	if (facts === null) return [];
	for (const row of facts.rows) {
		if (row.kind !== "resolved") continue;
		const locations: {
			readonly entry: ContractMapEntry;
			readonly location: ContractLocation;
		}[] = [];
		if (row.contact !== null)
			locations.push({
				entry: {
					id: row.id,
					name: row.name,
					role: row.contact.role,
					npc: row.contact.name,
				},
				location: row.contact.location,
			});
		// Quest areas are authored points. In-progress visibility is h3d policy, not an ACE rule.
		if (row.status.kind === "inProgress")
			locations.push({
				entry: { id: row.id, name: row.name, role: "area" },
				location: row.area,
			});
		for (const { entry, location } of locations) {
			if (location.kind !== "outdoor") continue;
			const position = contractLocationPosition(location);
			if (
				position[0] < 0 ||
				position[0] > WORLD_MAP_EXTENT ||
				position[2] > 0 ||
				position[2] < -WORLD_MAP_EXTENT
			)
				continue;
			const key = `${position[0]},${position[2]}`;
			let marker = markers.get(key);
			if (marker === undefined) {
				marker = { key, position, entries: [] };
				markers.set(key, marker);
			}
			marker.entries.push(entry);
		}
	}
	return [...markers.values()].map((marker) => ({
		...marker,
		entries: marker.entries.toSorted(
			(a, b) =>
				a.name.localeCompare(b.name) ||
				a.id - b.id ||
				a.role.localeCompare(b.role),
		),
	}));
}

/** Compose current status with retained placement; countdown expiry never rebuilds geometry. */
export function contractMapTooltips(
	markers: readonly ContractMapMarker[],
	facts: ContractsSnapshot | null,
): ReadonlyMap<string, string> {
	if (facts === null) return new Map();
	const rows = new Map(facts.rows.map((row) => [row.id, row]));
	return new Map(
		markers.map((marker) => [
			marker.key,
			marker.entries
				.map((entry) => {
					const row: ContractRow | undefined = rows.get(entry.id);
					if (row === undefined || row.kind !== "resolved") return "";
					const role =
						entry.role === "area"
							? "Quest area"
							: entry.role === "start"
								? "Start contact"
								: "End contact";
					const destination =
						entry.role === "area" ? role : `${role}: ${entry.npc}`;
					const coords = formatWorldMapCoordinates({
						x: marker.position[0],
						z: marker.position[2],
					});
					return `${entry.name} · ${contractStatusLabel(row)}\n${destination} · ${coords}`;
				})
				.filter((text) => text !== "")
				.join("\n\n"),
		]),
	);
}

/** One authored AC placement conversion for contract map markers and journal navigation. */
function contractLocationPosition(
	location: Extract<ContractLocation, { kind: "outdoor" }>,
): SceneVector3 {
	const source = location.position;
	const origin = createLandblockWorldOrigin({
		x: source.landblockId >>> 24,
		y: (source.landblockId >>> 16) & 0xff,
	});
	return sceneVector3([
		origin.x + source.coords.x,
		source.coords.z,
		origin.z - source.coords.y,
	]);
}

/** Structured labels are cell-based; navigate to authored geometry without reparsing the label. */
export function contractLocationWaypoint(
	location: ContractLocation,
): MapWaypointTarget | null {
	if (location.kind !== "outdoor") return null;
	const source = contractLocationPosition(location);
	const position = sceneMapPoint(source[0], source[2]);
	return waypointFromMapPoint(position);
}
