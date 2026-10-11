import type {
	ContractLocation,
	ContractRow,
} from "./client-contracts-contract";

/** One status label drives the icon tooltip and expanded readable status. */
export function contractStatusLabel(row: ContractRow): string {
	if (row.kind === "unresolved") return "Definition unavailable";
	switch (row.status.kind) {
		case "available":
			return "Available";
		case "inProgress":
			return "In progress";
		case "completed":
			return "Completed";
		case "waitingToRepeat":
			return "Waiting to repeat";
	}
}

/** Render owner-derived cell coordinates without applying full-position display bias. */
export function contractLocationText(location: ContractLocation): string {
	switch (location.kind) {
		case "missing":
			return "Not provided";
		case "indoor":
			return "Indoors";
		case "outdoor":
			return `${coordinateText(location.latitude, "N", "S")}, ${coordinateText(location.longitude, "E", "W")}`;
	}
}

/** Retail acclient.c:201380 omits the hemisphere suffix on an exact zero coordinate. */
function coordinateText(
	degrees: number,
	positive: string,
	negative: string,
): string {
	const hemisphere = degrees > 0 ? positive : degrees < 0 ? negative : "";
	return `${Math.abs(degrees).toFixed(1)}${hemisphere}`;
}
