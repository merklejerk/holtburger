/** Board geometry, simulation period, and input capacity shared by runtime and tests. */
export const LOGOPOLIS = {
	width: 20,
	height: 18,
	tickMs: 140,
	turnBufferSize: 3,
	/** Starting body size; also the baseline for pickup growth tiers. */
	initialLength: 3,
	/** Clear cells at each end of the bisecting wall. */
	wallEdgeGap: 2,
	/** Additional body segments required for each extra reset collectible. */
	segmentsPerPortalPickup: 5,
	/** Maximum simultaneous reset collectibles. */
	maxPortalPickups: 10,
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
			/** Reset collectibles, limited by snake length and available space. */
			readonly portalPickups: readonly SnakeCell[];
	  }
	| { readonly kind: "lost" }
	| { readonly kind: "won" };
/** Bisector geometry and the coordinate axis used to classify portal sides. */
export interface SnakeWall {
	/** Normal axis: a horizontal wall separates y coordinates. */
	readonly axis: "x" | "y";
	/** Center line; portal entrances must lie strictly on opposite sides. */
	readonly coordinate: number;
	/** Solid cells, excluding edge passages and the single center opening. */
	readonly cells: readonly SnakeCell[];
}
/** Head-first occupied route; discontinuities represent already-traversed portals. */
export interface SnakeGame {
	readonly body: readonly [SnakeCell, ...SnakeCell[]];
	readonly direction: SnakeDirection;
	readonly score: number;
	/** Fixed obstacle cells selected at the start of the run. */
	readonly wall: SnakeWall;
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
	wall: SnakeGame["wall"],
): SnakeCell[] {
	const free: SnakeCell[] = [];
	for (let y = 0; y < LOGOPOLIS.height; y++) {
		for (let x = 0; x < LOGOPOLIS.width; x++) {
			const cell = { x, y };
			if (
				!wall.cells.some((part) => sameSnakeCell(part, cell)) &&
				!body.some((part) => sameSnakeCell(part, cell)) &&
				!portals.some((portal) => sameSnakeCell(portal.cell, cell))
			)
				free.push(cell);
		}
	}
	return free;
}

/** Preserve surviving pickups and fill the length-based allowance without displacing food. */
function placePortalPickups(
	body: SnakeGame["body"],
	portals: SnakeGame["portals"],
	wall: SnakeGame["wall"],
	food: SnakeCell,
	previous: readonly SnakeCell[],
	random: () => number,
): readonly SnakeCell[] {
	const free = freeCells(body, portals, wall).filter(
		(cell) => !sameSnakeCell(cell, food),
	);
	const pickups = previous.filter((pickup) =>
		free.some((cell) => sameSnakeCell(cell, pickup)),
	);
	const target = Math.min(
		LOGOPOLIS.maxPortalPickups,
		1 +
			Math.floor(
				Math.max(0, body.length - LOGOPOLIS.initialLength) /
					LOGOPOLIS.segmentsPerPortalPickup,
			),
	);
	const available = free.filter(
		(cell) => !pickups.some((pickup) => sameSnakeCell(cell, pickup)),
	);
	while (pickups.length < target) {
		const pickup = choose(available, random);
		if (pickup === null) break;
		pickups.push(pickup);
		available.splice(available.indexOf(pickup), 1);
	}
	return pickups;
}

function placeFood(
	body: SnakeGame["body"],
	portals: SnakeGame["portals"],
	wall: SnakeGame["wall"],
	pickups: readonly SnakeCell[],
	random: () => number,
): SnakeOutcome {
	const free = freeCells(body, portals, wall);
	const ordinary = free.filter(
		(cell) => !pickups.some((pickup) => sameSnakeCell(cell, pickup)),
	);
	// Food takes priority when every remaining cell holds a reset pickup.
	const food = choose(ordinary.length > 0 ? ordinary : free, random);
	if (food === null) return { kind: "won" };
	return {
		kind: "playing",
		food,
		portalPickups: placePortalPickups(
			body,
			portals,
			wall,
			food,
			pickups,
			random,
		),
	};
}

/** Enumerate safe placements rather than retrying random cells on a crowded board. */
function shufflePortals(
	body: SnakeGame["body"],
	food: SnakeCell,
	previous: SnakeGame["portals"],
	wall: SnakeGame["wall"],
	pickups: readonly SnakeCell[],
	random: () => number,
): SnakeGame["portals"] | null {
	const vacant = (cell: SnakeCell) =>
		insideBoard(cell) &&
		!sameSnakeCell(cell, food) &&
		!wall.cells.some((part) => sameSnakeCell(part, cell)) &&
		!pickups.some((pickup) => sameSnakeCell(pickup, cell)) &&
		!body.some((part) => sameSnakeCell(part, cell));
	/** Placement-time proof: this portal's outward cell is already clear and in bounds. */
	interface Candidate {
		readonly portal: SnakePortal;
		readonly exit: SnakeCell;
	}
	const candidates: Candidate[] = [];
	for (const cell of freeCells([...body, ...pickups], previous, wall)) {
		if (sameSnakeCell(cell, food)) continue;
		for (const direction of DIRECTIONS) {
			const exit = advance(cell, direction);
			if (vacant(exit)) candidates.push({ portal: { cell, direction }, exit });
		}
	}
	// Opposite halves and disjoint entrance/exit cells are both placement requirements.
	const compatiblePair = (a: Candidate, b: Candidate) =>
		(a.portal.cell[wall.axis] - wall.coordinate) *
			(b.portal.cell[wall.axis] - wall.coordinate) <
			0 &&
		!sameSnakeCell(a.portal.cell, b.portal.cell) &&
		!sameSnakeCell(a.portal.cell, b.exit) &&
		!sameSnakeCell(a.exit, b.portal.cell) &&
		!sameSnakeCell(a.exit, b.exit);
	// Carry one proven partner through selection, so the second choice is nonempty by construction.
	const choices = candidates.flatMap((first) => {
		const partner = candidates.find((second) => compatiblePair(first, second));
		return partner === undefined ? [] : [{ first, partner }];
	});
	const chosen = choose(choices, random);
	if (chosen === null) return null;
	const partners: readonly [Candidate, ...Candidate[]] = [
		chosen.partner,
		...candidates.filter(
			(candidate) =>
				candidate !== chosen.partner && compatiblePair(chosen.first, candidate),
		),
	];
	return [chosen.first.portal, choose(partners, random).portal];
}

/** Start a run; injected randomness selects the wall orientation and collectible positions. */
export function createSnakeGame(random: () => number): SnakeGame {
	const horizontal = choose([true, false] as const, random);
	const center = {
		x: Math.floor(LOGOPOLIS.width / 2),
		y: Math.floor(LOGOPOLIS.height / 2),
	};
	const span = horizontal ? LOGOPOLIS.width : LOGOPOLIS.height;
	const middle = Math.floor(span / 2);
	const wall: SnakeWall = {
		axis: horizontal ? "y" : "x",
		coordinate: horizontal ? center.y : center.x,
		cells: Array.from(
			{ length: span - LOGOPOLIS.wallEdgeGap * 2 },
			(_, index) => index + LOGOPOLIS.wallEdgeGap,
		)
			.filter((position) => position !== middle)
			.map((position) =>
				horizontal
					? { x: position, y: center.y }
					: { x: center.x, y: position },
			),
	};
	// Start parallel to the wall with a full clear lane ahead.
	const head = horizontal
		? { x: center.x - 2, y: center.y + 3 }
		: { x: center.x - 3, y: center.y };
	const direction = horizontal ? "right" : "down";
	const body: SnakeGame["body"] = [
		head,
		...Array.from({ length: LOGOPOLIS.initialLength - 1 }, (_, index) => ({
			x: head.x - STEPS[direction].x * (index + 1),
			y: head.y - STEPS[direction].y * (index + 1),
		})),
	];
	return {
		body,
		direction,
		score: 0,
		wall,
		portals: LOGOPOLIS_INITIAL_PORTALS,
		outcome: placeFood(body, LOGOPOLIS_INITIAL_PORTALS, wall, [], random),
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
		game.wall.cells.some((cell) => sameSnakeCell(cell, next)) ||
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
			outcome: placeFood(
				body,
				game.portals,
				game.wall,
				game.outcome.portalPickups,
				random,
			),
		};
	if (
		game.outcome.portalPickups.some((pickup) => sameSnakeCell(next, pickup))
	) {
		const pickups = game.outcome.portalPickups.filter(
			(pickup) => !sameSnakeCell(next, pickup),
		);
		const portals = shufflePortals(
			body,
			game.outcome.food,
			game.portals,
			game.wall,
			pickups,
			random,
		);
		// If no safe pair fits, retire reset pickups until food placement replenishes them.
		if (portals === null)
			return {
				...game,
				body,
				direction,
				outcome: { ...game.outcome, portalPickups: [] },
			};
		return {
			...game,
			body,
			direction,
			portals,
			outcome: {
				...game.outcome,
				portalPickups: placePortalPickups(
					body,
					portals,
					game.wall,
					game.outcome.food,
					pickups,
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
