import type { MinimapSubject } from "../app/minimap-frame";
import { parsePrintedMapCoordinates } from "../lib/game/map/map-coordinates";
import {
	formatWaypointReadout,
	mapWaypointGuidance,
	waypointFromPrintedCoordinates,
	type MapWaypointDisplay,
	type MapWaypointTarget,
} from "../lib/game/map/map-waypoint";
import type {
	ClientChatMessage,
	ClientCurrentState,
	ClientLifecycle,
} from "./client-host-contract";

/** Session-local intent owner. Renderer replacement and portal travel do not own its lifetime. */
export class ClientNavigationWaypointOwner {
	/** Single committed destination, independent of presentation resources. */
	#target: MapWaypointTarget | null = null;
	/** Accepted character identity binds target lifetime and rejects stale subject placements. */
	#characterGuid: number | null = null;
	/** Frontend proximity policy injected from client tuning. */
	readonly #nearRadiusMeters: number;

	constructor(nearRadiusMeters: number) {
		this.#nearRadiusMeters = nearRadiusMeters;
	}

	/** Accepted identity changes clear intent; repeating the same identity preserves it. */
	acceptCharacter(guid: number | null): void {
		if (guid !== this.#characterGuid) this.clear();
		this.#characterGuid = guid;
	}

	/** Atomic state replacement carries character identity as well as lifecycle. */
	acceptCurrentState(
		state: Pick<ClientCurrentState, "lifecycle" | "localPlayerGuid">,
	): void {
		this.acceptCharacter(state.localPlayerGuid);
		this.acceptLifecycle(state.lifecycle);
	}

	/** Teleports retain intent; initial entry and character retirement are explicit boundaries. */
	acceptLifecycle(lifecycle: ClientLifecycle): void {
		switch (lifecycle.kind) {
			case "entering-world":
				this.acceptCharacter(lifecycle.characterGuid);
				return;
			case "in-world":
				return;
			case "portal-space":
				// Initial activation can arrive without an entering-world event.
				if (lifecycle.cause === "initial-entry") this.clear();
				return;
			case "connecting":
			case "authenticating":
			case "character-selection":
			case "exiting":
				this.acceptCharacter(null);
				return;
		}
	}

	/** Also used during session cleanup, without producing unsolicited chat. */
	clear(): void {
		this.#target = null;
	}

	/** Read against the exact subject sampled for this UI frame; no movement publications. */
	read(
		subject: MinimapSubject | null,
		available: boolean,
	): MapWaypointDisplay | null {
		const target = this.#target;
		if (target === null) return null;
		if (
			!available ||
			subject?.kind !== "controlled-entity" ||
			subject.guid !== this.#characterGuid ||
			subject.anchor.residency === null
		)
			return {
				kind: "paused",
				target,
				reason: "Waypoint · waiting for outdoor position",
			};
		if (subject.anchor.residency.envCellId !== null)
			return { kind: "paused", target, reason: "Waypoint · paused indoors" };
		return mapWaypointGuidance(target, subject.anchor, this.#nearRadiusMeters);
	}

	/** Commit a prepared destination through the same character check and confirmation for all inputs. */
	set(target: MapWaypointTarget, notify: (message: string) => void): void {
		if (this.#characterGuid === null)
			throw new Error("Select a character before setting a waypoint.");
		this.#target = target;
		notify(`Waypoint set: ${target.label}.`);
	}

	/** Exact-token interception, including invalid arguments, keeps recognized commands local. */
	runCommand(
		message: string,
		readDisplay: () => MapWaypointDisplay | null,
		append: (message: ClientChatMessage) => void,
		notify: (message: string) => void,
	): boolean {
		const match = /^@(?:waypoint|wp)(?=\s|$)/i.exec(message.trim());
		if (match === null) return false;
		const input = message.trim().slice(match[0].length).trim();
		if (input.toLowerCase() === "clear") {
			const existed = this.#target !== null;
			this.clear();
			append({
				kind: "system",
				message: existed ? "Waypoint cleared." : "No waypoint is set.",
			});
		} else if (input === "") {
			const display = readDisplay();
			append({
				kind: "system",
				message:
					display === null
						? "Usage: @waypoint 42.3N, 12.7E · @waypoint clear · Alias: @wp"
						: `${display.target.label} · ${formatWaypointReadout(display)}`,
			});
		} else {
			const parsed = parsePrintedMapCoordinates(input);
			if (parsed === null)
				throw new Error(
					"Use latitude and longitude, for example @waypoint 42.3N, 12.7E. Clear with @waypoint clear. Alias: @wp.",
				);
			const target = waypointFromPrintedCoordinates(parsed);
			if (target === null)
				throw new Error("Waypoint coordinates are outside the outdoor world.");
			this.set(target, notify);
		}
		return true;
	}
}
