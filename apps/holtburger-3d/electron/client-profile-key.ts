import type { ClientLaunchConfiguration } from "./client-launch.js";

const MAXIMUM_GUID = 0xffff_ffff;

/** Normalize a launch endpoint only for local profile namespacing, never server selection. */
export function clientServerScope(
	startup: Pick<ClientLaunchConfiguration, "host" | "port">,
): string {
	const trimmed = startup.host.trim();
	if (trimmed.length === 0)
		throw new Error("Client profile host cannot be empty");
	const unwrapped =
		trimmed.startsWith("[") && trimmed.endsWith("]")
			? trimmed.slice(1, -1)
			: trimmed;
	const normalizedHost = unwrapped.toLowerCase();
	const displayedHost = normalizedHost.includes(":")
		? `[${normalizedHost}]`
		: normalizedHost;
	return `${displayedHost}:${startup.port}`;
}

/** Composite local identity; character GUIDs are stable only within one shard database. */
export function clientCharacterProfileKey(
	startup: Pick<ClientLaunchConfiguration, "host" | "port">,
	characterGuid: number,
): string {
	if (
		!Number.isInteger(characterGuid) ||
		characterGuid < 0 ||
		characterGuid > MAXIMUM_GUID
	)
		throw new Error(
			"Client character GUID is outside the unsigned 32-bit range",
		);
	return `${clientServerScope(startup)}/0x${characterGuid
		.toString(16)
		.padStart(8, "0")}`;
}
