import type { PartySnapshot } from "./client-party-contract";
import { formatQuantity } from "../app/quantity-format";

/** Prepared presentation facts; the authoritative roster still includes the current player. */
export interface PartyHudDisplay {
	/** Authoritative leader identity; a self-leader simply has no displayed badge. */
	readonly leader: number | null;
	/** Stable roster order with only teammates, preserving exact vital tuples. */
	readonly members: readonly Pick<
		PartySnapshot["members"][number],
		"guid" | "name" | "vitals"
	>[];
}

/** Column admission is app behavior; themes control cell geometry within this cap. */
export const PARTY_HUD_MAXIMUM_COLUMNS = 4;

/** Resolved CSS lengths used by the HUD's resize boundary and screenshot diagnostics. */
export interface PartyHudGeometry {
	/** Cell dimensions resolved by the browser, including rem/em/calc theme values. */
	readonly cellSize: { readonly width: number; readonly height: number };
	/** Reserved native scrollbar space, included in the minimum editable width. */
	readonly scrollbarAllowance: number;
}

/** Read actual CSS dimensions from the isolated probe; never parse raw custom properties. */
export function readPartyHudGeometry(node: HTMLElement): PartyHudGeometry {
	const style = getComputedStyle(node);
	const width = Number.parseFloat(style.width);
	const height = Number.parseFloat(style.height);
	const scrollbarAllowance = Number.parseFloat(style.paddingRight);
	if (!Number.isFinite(width) || width <= 0)
		throw new Error(
			"Party theme cell width must resolve to a positive CSS length",
		);
	if (!Number.isFinite(height) || height <= 0)
		throw new Error(
			"Party theme cell height must resolve to a positive CSS length",
		);
	if (!Number.isFinite(scrollbarAllowance))
		throw new Error(
			"Party theme scrollbar allowance must resolve to a CSS length",
		);
	return { cellSize: { width, height }, scrollbarAllowance };
}

/** Sampled by the app with the session's current player identity, before the component renders. */
export function presentPartyHud(
	party: PartySnapshot | null,
	player: number | null,
): PartyHudDisplay | null {
	if (party === null || player === null) return null;
	return {
		leader: party.leader,
		members: party.members.filter((member) => member.guid !== player),
	};
}

/** Eight teammate cells cover ACE's nine-player capacity without live update demand. */
export const PARTY_HUD_PREVIEW: PartyHudDisplay = {
	leader: 2,
	members: Array.from({ length: 8 }, (_, index) => ({
		guid: index + 2,
		name: `Teammate ${index + 1}`,
		vitals: [
			240 - index * 20,
			160 - index * 10,
			120 - index * 8,
			240,
			160,
			120,
		],
	})),
};

/** Preserve reported quantities while bounding the visual fill; zero maxima are unavailable. */
export function partyVitalDisplay(
	current: number,
	maximum: number,
): {
	/** Bounded meter fill; null indicates that a maximum is unavailable. */
	readonly percent: number | null;
	/** Exact server quantities for hover and accessible text. */
	readonly quantity: string;
} {
	return maximum === 0
		? { percent: null, quantity: "Unavailable" }
		: {
				percent: Math.max(0, Math.min(100, (current / maximum) * 100)),
				quantity: `${formatQuantity(current)} / ${formatQuantity(maximum)}`,
			};
}
