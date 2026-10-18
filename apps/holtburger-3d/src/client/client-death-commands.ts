import { clientCommandHelp } from "./client-command-help";
import { createLandblockWorldOrigin } from "../lib/game/landblocks";
import { formatWorldMapCoordinates } from "../lib/game/map/map-coordinates";
import type { ClientChatEntry } from "./client-chat-policy";
import type {
	LocalConfirmationRequest,
	LocalDialogSource,
} from "./client-dialogs";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import type {
	CorpseConsentAction,
	DeathLocationQuery,
	DeathLocationResult,
} from "./client-death-contract";

type DeathCommand =
	| { readonly kind: "query"; readonly query: DeathLocationQuery }
	| {
			readonly kind: "permission";
			readonly playerName: string;
			readonly granted: boolean;
	  }
	| { readonly kind: "consent"; readonly action: CorpseConsentAction }
	| { readonly kind: "accept"; readonly enabled: boolean }
	| { readonly kind: "die" }
	| { readonly kind: "consent-help" };

/** H3d syntax only; malformed recognized commands are consumed as local errors. */
export function parseDeathCommand(text: string): DeathCommand | null {
	const match = /^[/@](\S+)(?:\s+(.*))?$/s.exec(text.trim());
	if (match === null) return null;
	const verb = match[1].toLowerCase();
	const rest = (match[2] ?? "").trim();
	switch (verb) {
		case "corpse":
		case "corpses":
			if (rest !== "") throw new Error(`Usage: /${verb}`);
			return {
				kind: "query",
				query: verb === "corpse" ? "last-outdoor" : "recent",
			};
		case "permit":
		case "unpermit":
			if (rest === "") throw new Error(`Usage: /${verb} <player>`);
			return {
				kind: "permission",
				playerName: rest,
				granted: verb === "permit",
			};
		case "die":
		case "rip":
			if (rest !== "") throw new Error("Usage: /die");
			return { kind: "die" };
		case "consent": {
			if (rest === "") return { kind: "consent-help" };
			const [operation, ...name] = rest.split(/\s+/);
			switch (operation.toLowerCase()) {
				case "on":
				case "off":
					if (name.length === 0)
						return {
							kind: "accept",
							enabled: operation.toLowerCase() === "on",
						};
					break;
				case "who":
				case "clear":
					if (name.length === 0)
						return {
							kind: "consent",
							action: {
								kind: operation.toLowerCase() === "who" ? "list" : "clear",
							},
						};
					break;
				case "remove":
					if (name.length > 0)
						return {
							kind: "consent",
							action: { kind: "remove", playerName: name.join(" ") },
						};
			}
			throw new Error("Usage: /consent on|off|who|clear|remove <player>");
		}
		default:
			return null;
	}
}

/** Preserve indoor cell identity; only outdoor samples enter the existing coordinate grammar. */
export function deathLocationLines(
	result: DeathLocationResult,
): readonly string[] {
	type Position = NonNullable<
		Extract<
			DeathLocationResult["locations"],
			{ kind: "last-outdoor" }
		>["position"]
	>;
	function location(position: Position | null): string {
		if (position === null) return "Position unavailable";
		const { landblockId: cell, coords } = position;
		if ((cell & 0xffff) >= 0x100)
			return `Indoors cell 0x${cell.toString(16).padStart(8, "0")}, position (${coords.x}, ${coords.y}, ${coords.z})`;
		const origin = createLandblockWorldOrigin({
			x: cell >>> 24,
			y: (cell >>> 16) & 0xff,
		});
		return `(${formatWorldMapCoordinates({ x: origin.x + coords.x, z: origin.z - coords.y })})`;
	}
	const facts = result.locations;
	if (facts.kind === "last-outdoor")
		return [
			facts.position === null
				? "No saved last outdoor death location."
				: `Last outdoor death: ${location(facts.position)}. This saved location does not confirm a corpse remains.`,
		];
	if (facts.positions.length === 0) return ["No deaths observed this session."];
	return [
		"Recent deaths, newest first: approximate samples may be stale or reflect a later position; corpses/items are unconfirmed.",
		...facts.positions.map((position, i) => `${i + 1}. ${location(position)}`),
	];
}

type DeathSession = Pick<
	ClientLifecycleSession,
	| "subscribe"
	| "queryDeathLocations"
	| "manageCorpseConsent"
	| "setCorpseConsent"
	| "setCorpsePermission"
	| "killCharacter"
> & {
	readonly state: () => Pick<
		ReturnType<ClientLifecycleSession["state"]>,
		"playerGuid" | "lifecycle"
	>;
};

/** App-session command handling and one local suicide question; history stays in core. */
export class ClientDeathCommands implements LocalDialogSource {
	readonly #session: DeathSession;
	readonly #append: (message: ClientChatEntry) => void;
	readonly #listeners = new Set<() => void>();
	readonly #unsubscribe: () => void;
	#pending: { readonly character: number; readonly requestId: string } | null =
		null;
	#sequence = 0;

	constructor(
		session: DeathSession,
		append: (message: ClientChatEntry) => void,
	) {
		this.#session = session;
		this.#append = append;
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
	}
	question(): LocalConfirmationRequest | null {
		return this.#pending === null
			? null
			: {
					requestId: this.#pending.requestId,
					text: "Kill your character? You may drop items and accrue a vitae penalty.",
				};
	}
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	#clear(): void {
		this.#pending = null;
		for (const listener of this.#listeners) listener();
	}
	respond(requestId: string, accepted: boolean): void {
		const pending = this.#pending;
		if (pending === null || pending.requestId !== requestId) return;
		this.#clear();
		if (
			accepted &&
			this.#session.state().playerGuid === pending.character &&
			this.#session.state().lifecycle?.kind === "in-world"
		) {
			void this.#session.killCharacter().catch((error: unknown) =>
				this.#append({
					kind: "error",
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	}
	async run(text: string): Promise<boolean> {
		const command = parseDeathCommand(text);
		if (command === null) return false;
		if (command.kind === "consent-help") {
			this.#append(clientCommandHelp("consent"));
			return true;
		}
		const state = this.#session.state();
		if (state.playerGuid === null || state.lifecycle?.kind !== "in-world")
			throw new Error(
				"Death commands require an active character in the world.",
			);
		switch (command.kind) {
			case "query":
				await this.#session.queryDeathLocations(command.query);
				break;
			case "permission":
				await this.#session.setCorpsePermission(
					command.playerName,
					command.granted,
				);
				break;
			case "consent":
				await this.#session.manageCorpseConsent(command.action);
				break;
			case "accept":
				await this.#session.setCorpseConsent(command.enabled);
				break;
			case "die":
				this.#pending = {
					character: state.playerGuid,
					requestId: `death-${++this.#sequence}`,
				};
				for (const listener of this.#listeners) listener();
		}
		return true;
	}
	#receive(event: ClientLifecycleSessionEvent): void {
		if (
			event.type === "death-locations" &&
			event.result.character === this.#session.state().playerGuid &&
			this.#session.state().lifecycle?.kind === "in-world"
		) {
			for (const message of deathLocationLines(event.result))
				this.#append({ kind: "system", message });
		}
		if (
			this.#pending !== null &&
			(this.#session.state().playerGuid !== this.#pending.character ||
				this.#session.state().lifecycle?.kind !== "in-world")
		)
			this.#clear();
	}
	destroy(): void {
		this.#unsubscribe();
		this.#clear();
		this.#listeners.clear();
	}
}
