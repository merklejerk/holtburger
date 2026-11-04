import type { RecallDestination } from "./client-host-contract";

/** Map-menu presentation only; core owns which attempts are offered. */
export const RECALL_LABELS: Readonly<Record<RecallDestination, string>> = {
	lifestone: "Lifestone",
	marketplace: "Marketplace",
	house: "House",
	"allegiance-housing": "Allegiance Housing",
	"allegiance-hometown": "Allegiance Hometown",
	"pk-arena": "PK Arena",
	"pk-lite-arena": "PK Lite Arena",
};
