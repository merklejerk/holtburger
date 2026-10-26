/** Board geometry, simulation period, and input capacity shared by runtime and tests. */
export const LOGOPOLIS = {
	width: 20,
	height: 18,
	tickMs: 140,
	turnBufferSize: 3,
} as const;

const DIRECTIONS = ["up", "right", "down", "left"] as const;
/** One cardinal movement in board coordinates. */
export type SnakeDirection = (typeof DIRECTIONS)[number];
/** Integer board position. */
export interface SnakeCell {
	readonly x: number;
	readonly y: number;
}
/** Linked portal tile; direction is the outward direction at this end. */
export interface SnakePortal {
	readonly cell: SnakeCell;
	readonly direction: SnakeDirection;
}
/** Initial pair; each run owns its current portal positions and exit headings. */
export const LOGOPOLIS_INITIAL_PORTALS: readonly [SnakePortal, SnakePortal] = [
	{ cell: { x: 4, y: 4 }, direction: "right" },
	{ cell: { x: 15, y: 13 }, direction: "up" },
];
/** Complete game outcome; a live board always has food. */
type SnakeOutcome =
	| {
			readonly kind: "playing";
			readonly food: SnakeCell;
			/** Optional portal-shuffle pickup; absent when the board has no spare cell. */
			readonly portalPickup: SnakeCell | null;
	  }
	| { readonly kind: "lost" }
	| { readonly kind: "won" };
/** Head-first occupied route; discontinuities represent already-traversed portals. */
export interface SnakeGame {
	readonly body: readonly [SnakeCell, ...SnakeCell[]];
	readonly direction: SnakeDirection;
	readonly score: number;
	/** Current linked pair shared by movement, placement, and rendering. */
	readonly portals: readonly [SnakePortal, SnakePortal];
	readonly outcome: SnakeOutcome;
}

const STEPS: Record<SnakeDirection, SnakeCell> = {
	up: { x: 0, y: -1 },
	right: { x: 1, y: 0 },
	down: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
};

/** Structural cell equality also covers portal and food positions. */
export function sameSnakeCell(a: SnakeCell, b: SnakeCell): boolean {
	return a.x === b.x && a.y === b.y;
}

/** Whether a requested direction avoids reversing the supplied heading. */
export function canTurnSnake(
	from: SnakeDirection,
	to: SnakeDirection,
): boolean {
	return STEPS[from].x + STEPS[to].x !== 0 || STEPS[from].y + STEPS[to].y !== 0;
}

/** Buffer distinct corners against the last planned heading; excess input leaves the route intact. */
export function queueSnakeTurn(
	turns: readonly SnakeDirection[],
	heading: SnakeDirection,
	turn: SnakeDirection,
): readonly SnakeDirection[] {
	const plannedHeading = turns.at(-1) ?? heading;
	if (
		turns.length >= LOGOPOLIS.turnBufferSize ||
		turn === plannedHeading ||
		!canTurnSnake(plannedHeading, turn)
	)
		return turns;
	return [...turns, turn];
}

function advance(cell: SnakeCell, direction: SnakeDirection): SnakeCell {
	return { x: cell.x + STEPS[direction].x, y: cell.y + STEPS[direction].y };
}

function insideBoard(cell: SnakeCell): boolean {
	return (
		cell.x >= 0 &&
		cell.y >= 0 &&
		cell.x < LOGOPOLIS.width &&
		cell.y < LOGOPOLIS.height
	);
}

function choose<T>(values: readonly [T, ...T[]], random: () => number): T;
function choose<T>(values: readonly T[], random: () => number): T | null;
function choose<T>(values: readonly T[], random: () => number): T | null {
	if (values.length === 0) return null;
	const value = values[Math.floor(random() * values.length)];
	if (value === undefined)
		throw new Error("Snake random sample must select an available item.");
	return value;
}

function freeCells(
	body: readonly SnakeCell[],
	portals: SnakeGame["portals"],
): SnakeCell[] {
	const free: SnakeCell[] = [];
	for (let y = 0; y < LOGOPOLIS.height; y++) {
		for (let x = 0; x < LOGOPOLIS.width; x++) {
			const cell = { x, y };
			if (
				!body.some((part) => sameSnakeCell(part, cell)) &&
				!portals.some((portal) => sameSnakeCell(portal.cell, cell))
			)
				free.push(cell);
		}
	}
	return free;
}

function placePortalPickup(
	body: SnakeGame["body"],
	portals: SnakeGame["portals"],
	food: SnakeCell,
	random: () => number,
): SnakeCell | null {
	return choose(
		freeCells(body, portals).filter((cell) => !sameSnakeCell(cell, food)),
		random,
	);
}

function placeFood(
	body: SnakeGame["body"],
	portals: SnakeGame["portals"],
	pickup: SnakeCell | null,
	random: () => number,
): SnakeOutcome {
	const free = freeCells(body, portals);
	// Convert a remaining shuffle pickup to food when it is the final unoccupied cell.
	const food = choose(
		free.length === 1 || pickup === null
			? free
			: free.filter((cell) => !sameSnakeCell(cell, pickup)),
		random,
	);
	if (food === null) return { kind: "won" };
	return {
		kind: "playing",
		food,
		portalPickup:
			pickup !== null && !sameSnakeCell(pickup, food)
				? pickup
				: placePortalPickup(body, portals, food, random),
	};
}

/** Enumerate safe placements rather than retrying random cells on a crowded board. */
function shufflePortals(
	body: SnakeGame["body"],
	food: SnakeCell,
	previous: SnakeGame["portals"],
	random: () => number,
): SnakeGame["portals"] | null {
	const vacant = (cell: SnakeCell) =>
		insideBoard(cell) &&
		!sameSnakeCell(cell, food) &&
		!body.some((part) => sameSnakeCell(part, cell));
	/** Placement-time proof: this portal's outward cell is already clear and in bounds. */
	interface Candidate {
		readonly portal: SnakePortal;
		readonly exit: SnakeCell;
	}
	const candidates: Candidate[] = [];
	for (const cell of freeCells(body, previous)) {
		if (sameSnakeCell(cell, food)) continue;
		for (const direction of DIRECTIONS) {
			const exit = advance(cell, direction);
			if (vacant(exit)) candidates.push({ portal: { cell, direction }, exit });
		}
	}
	const disjoint = (a: Candidate, b: Candidate) =>
		!sameSnakeCell(a.portal.cell, b.portal.cell) &&
		!sameSnakeCell(a.portal.cell, b.exit) &&
		!sameSnakeCell(a.exit, b.portal.cell) &&
		!sameSnakeCell(a.exit, b.exit);
	// Carry one proven partner through selection, so the second choice is nonempty by construction.
	const choices = candidates.flatMap((first) => {
		const partner = candidates.find((second) => disjoint(first, second));
		return partner === undefined ? [] : [{ first, partner }];
	});
	const chosen = choose(choices, random);
	if (chosen === null) return null;
	const partners: readonly [Candidate, ...Candidate[]] = [
		chosen.partner,
		...candidates.filter(
			(candidate) =>
				candidate !== chosen.partner && disjoint(chosen.first, candidate),
		),
	];
	return [chosen.first.portal, choose(partners, random).portal];
}

/** Start a run; randomness is injected so food placement is reproducible in tests. */
export function createSnakeGame(random: () => number): SnakeGame {
	const body: SnakeGame["body"] = [
		{ x: 8, y: 9 },
		{ x: 7, y: 9 },
		{ x: 6, y: 9 },
	];
	return {
		body,
		direction: "right",
		score: 0,
		portals: LOGOPOLIS_INITIAL_PORTALS,
		outcome: placeFood(body, LOGOPOLIS_INITIAL_PORTALS, null, random),
	};
}

/** Advance once. Stored route cells make the entire body follow the head through portals. */
export function stepSnake(
	game: SnakeGame,
	turn: SnakeDirection,
	random: () => number,
): SnakeGame {
	if (game.outcome.kind !== "playing") return game;
	const [head] = game.body;
	let direction = canTurnSnake(game.direction, turn) ? turn : game.direction;
	let next = advance(head, direction);
	const [a, b] = game.portals;
	const exit = sameSnakeCell(next, a.cell)
		? b
		: sameSnakeCell(next, b.cell)
			? a
			: null;
	if (exit !== null) {
		direction = exit.direction;
		next = advance(exit.cell, direction);
	}
	const grows = sameSnakeCell(next, game.outcome.food);
	// A non-growing tail vacates in the same transaction, including at portal exits.
	const retained = grows ? game.body : game.body.slice(0, -1);
	if (
		!insideBoard(next) ||
		retained.some((part) => sameSnakeCell(part, next))
	) {
		return { ...game, direction, outcome: { kind: "lost" } };
	}
	const body: SnakeGame["body"] = [next, ...retained];
	if (grows)
		return {
			...game,
			body,
			direction,
			score: game.score + 1,
			outcome: placeFood(body, game.portals, game.outcome.portalPickup, random),
		};
	if (
		game.outcome.portalPickup !== null &&
		sameSnakeCell(next, game.outcome.portalPickup)
	) {
		const portals = shufflePortals(
			body,
			game.outcome.food,
			game.portals,
			random,
		);
		// If the board cannot fit two safe entrances and exits, retire the special pickup.
		if (portals === null)
			return {
				...game,
				body,
				direction,
				outcome: { ...game.outcome, portalPickup: null },
			};
		return {
			...game,
			body,
			direction,
			portals,
			outcome: {
				...game.outcome,
				portalPickup: placePortalPickup(
					body,
					portals,
					game.outcome.food,
					random,
				),
			},
		};
	}
	return { ...game, body, direction };
}

/** Match only the local easter egg; malformed arguments must not become public speech. */
export function isLogopolisCommand(message: string): boolean {
	if (!/^[/@]logopolis(?:\s|$)/i.test(message.trim())) return false;
	if (!/^[/@]logopolis$/i.test(message.trim()))
		throw new Error("Usage: /logopolis");
	return true;
}
