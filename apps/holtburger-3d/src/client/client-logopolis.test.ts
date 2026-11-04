import { describe, expect, it } from "vitest";
import {
	canTurnSnake,
	queueSnakeTurn,
	createSnakeGame,
	isLogopolisCommand,
	LOGOPOLIS,
	LOGOPOLIS_INITIAL_PORTALS,
	sameSnakeCell,
	stepSnake,
	type SnakeCell,
	type SnakeDirection,
	type SnakeGame,
} from "./client-logopolis";

const random = () => 0;
/** Small explicit boards isolate movement rules from random food placement. */
function board(
	body: SnakeGame["body"],
	direction: SnakeDirection,
	food: SnakeCell,
): SnakeGame {
	return {
		body,
		direction,
		score: 0,
		portals: LOGOPOLIS_INITIAL_PORTALS,
		outcome: { kind: "playing", food, portalPickup: null },
	};
}
const distantFood = { x: LOGOPOLIS.width - 1, y: LOGOPOLIS.height - 1 };

describe("Logopolis", () => {
	it.each([-1, 1, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects an invalid random source %s",
		(sample) => {
			expect(() => createSnakeGame(() => sample)).toThrow(
				"Snake random sample must select an available item.",
			);
		},
	);
	it("starts with food outside the snake and portals", () => {
		const game = createSnakeGame(random);
		expect(game.outcome.kind).toBe("playing");
		if (game.outcome.kind !== "playing") throw new Error("Expected food.");
		const food = game.outcome.food;
		expect(game.body.some((part) => sameSnakeCell(part, food))).toBe(false);
		expect(
			LOGOPOLIS_INITIAL_PORTALS.some((portal) =>
				sameSnakeCell(portal.cell, food),
			),
		).toBe(false);
	});
	it("moves without growing and rejects reversal", () => {
		const game = createSnakeGame(random);
		const moved = stepSnake(game, "left", random);
		expect(moved.body.length).toBe(game.body.length);
		expect(moved.body[0]).toEqual({ x: game.body[0].x + 1, y: game.body[0].y });
		expect(canTurnSnake("right", "left")).toBe(false);
		expect(canTurnSnake("right", "up")).toBe(true);
	});
	it("grows and scores when eating", () => {
		const game = board([{ x: 1, y: 1 }], "right", { x: 2, y: 1 });
		const next = stepSnake(game, "right", random);
		expect(next.body).toHaveLength(2);
		expect(next.score).toBe(1);
	});
	it.each(
		LOGOPOLIS_INITIAL_PORTALS.map((entry, index) => ({
			entry,
			exit: LOGOPOLIS_INITIAL_PORTALS[index === 0 ? 1 : 0],
		})),
	)(
		"traverses a linked portal and preserves the tail route",
		({ entry, exit }) => {
			const body: SnakeGame["body"] = [
				{ x: entry.cell.x - 1, y: entry.cell.y },
				{ x: entry.cell.x - 2, y: entry.cell.y },
			];
			const next = stepSnake(
				board(body, "right", distantFood),
				"right",
				random,
			);
			expect(next.direction).toBe(exit.direction);
			expect(next.body).toEqual([
				{
					x: exit.cell.x + Number(exit.direction === "right"),
					y: exit.cell.y - Number(exit.direction === "up"),
				},
				body[0],
			]);
			const after = stepSnake(next, next.direction, random);
			expect(after.body[1]).toEqual(next.body[0]);
		},
	);
	it("checks collision at a portal exit", () => {
		const [entry, exit] = LOGOPOLIS_INITIAL_PORTALS;
		const game = board(
			[
				{ x: entry.cell.x - 1, y: entry.cell.y },
				{ x: exit.cell.x, y: exit.cell.y - 1 },
				{ x: 0, y: 0 },
			],
			"right",
			distantFood,
		);
		expect(stepSnake(game, "right", random).outcome.kind).toBe("lost");
	});
	it("allows moving into a vacating tail", () => {
		const game = board(
			[
				{ x: 1, y: 1 },
				{ x: 1, y: 2 },
				{ x: 2, y: 2 },
				{ x: 2, y: 1 },
			],
			"up",
			distantFood,
		);
		expect(stepSnake(game, "right", random).outcome.kind).toBe("playing");
	});
	it("rejects collision with retained body", () => {
		const game = board(
			[
				{ x: 1, y: 1 },
				{ x: 1, y: 2 },
				{ x: 2, y: 2 },
				{ x: 2, y: 1 },
				{ x: 3, y: 1 },
			],
			"up",
			distantFood,
		);
		expect(stepSnake(game, "right", random).outcome.kind).toBe("lost");
	});
	it("loses at the wall and leaves terminal boards unchanged", () => {
		const lost = stepSnake(
			board([{ x: 0, y: 0 }], "left", distantFood),
			"left",
			random,
		);
		expect(lost.outcome.kind).toBe("lost");
		expect(stepSnake(lost, "up", random)).toBe(lost);
	});
	it("wins when the last playable cell is filled", () => {
		const head = { x: 0, y: 0 };
		const food = { x: 1, y: 0 };
		const body: [SnakeCell, ...SnakeCell[]] = [head];
		for (let y = 0; y < LOGOPOLIS.height; y++)
			for (let x = 0; x < LOGOPOLIS.width; x++) {
				const cell = { x, y };
				if (
					!sameSnakeCell(cell, head) &&
					!sameSnakeCell(cell, food) &&
					!LOGOPOLIS_INITIAL_PORTALS.some((portal) =>
						sameSnakeCell(portal.cell, cell),
					)
				)
					body.push(cell);
			}
		expect(
			stepSnake(board(body, "right", food), "right", random).outcome.kind,
		).toBe("won");
	});
	it.each(["/logopolis", " @LOGOPOLIS "])(
		"recognizes local command %s",
		(text) => {
			expect(isLogopolisCommand(text)).toBe(true);
		},
	);
	it("rejects arguments and leaves other commands alone", () => {
		expect(() => isLogopolisCommand("/logopolis reset")).toThrow(
			"Usage: /logopolis",
		);
		expect(isLogopolisCommand("/logopolisfoo")).toBe(false);
		expect(isLogopolisCommand("hello")).toBe(false);
	});
});

describe("Snake turn buffering", () => {
	it("applies three rapid corners in order", () => {
		const start = board([{ x: 10, y: 10 }], "down", distantFood);
		let turns: readonly SnakeDirection[] = [];
		for (const turn of ["left", "up", "right"] as const)
			turns = queueSnakeTurn(turns, start.direction, turn);
		let game = start;
		const path = turns.map((turn) => {
			game = stepSnake(game, turn, random);
			return game.body[0];
		});
		const [head] = start.body;
		expect(path).toEqual([
			{ x: head.x - 1, y: head.y },
			{ x: head.x - 1, y: head.y - 1 },
			{ x: head.x, y: head.y - 1 },
		]);
	});
	it("applies a rapid left then up over consecutive cells", () => {
		const start = board([{ x: 10, y: 10 }], "down", distantFood);
		const turns = queueSnakeTurn(
			queueSnakeTurn([], start.direction, "left"),
			start.direction,
			"up",
		);
		const [first, second] = turns;
		if (first === undefined || second === undefined)
			throw new Error("Expected both buffered corners.");
		const corner = stepSnake(start, first, random);
		const next = stepSnake(corner, second, random);
		expect(corner.body[0]).toEqual({
			x: start.body[0].x - 1,
			y: start.body[0].y,
		});
		expect(next.body[0]).toEqual({
			x: start.body[0].x - 1,
			y: start.body[0].y - 1,
		});
	});
	it("validates against the planned heading rather than the current heading", () => {
		expect(queueSnakeTurn([], "right", "left")).toEqual([]);
		const turns = queueSnakeTurn([], "right", "up");
		expect(queueSnakeTurn(turns, "right", "down")).toBe(turns);
		expect(queueSnakeTurn(turns, "right", "left")).toEqual(["up", "left"]);
	});
	it("ignores duplicate directions without using another slot", () => {
		expect(queueSnakeTurn([], "right", "right")).toEqual([]);
		const turns = queueSnakeTurn([], "right", "up");
		expect(queueSnakeTurn(turns, "right", "up")).toBe(turns);
	});
	it("keeps the earliest turns when the buffer is full", () => {
		let turns: readonly SnakeDirection[] = [];
		let heading: SnakeDirection = "right";
		for (let index = 0; index < LOGOPOLIS.turnBufferSize; index++) {
			heading = heading === "right" ? "up" : "right";
			turns = queueSnakeTurn(turns, "right", heading);
		}
		expect(turns).toHaveLength(LOGOPOLIS.turnBufferSize);
		expect(
			queueSnakeTurn(turns, "right", heading === "right" ? "up" : "right"),
		).toBe(turns);
	});
	it("rejects a buffered reversal caused by a portal's new heading", () => {
		const [entry, exit] = LOGOPOLIS_INITIAL_PORTALS;
		const approach = board(
			[{ x: entry.cell.x - 1, y: entry.cell.y }],
			"down",
			distantFood,
		);
		// Right then down is legal before the portal redirects the first movement upward.
		const turns = queueSnakeTurn(
			queueSnakeTurn([], "down", "right"),
			"down",
			"down",
		);
		const [first, second] = turns;
		if (first === undefined || second === undefined)
			throw new Error("Expected both buffered corners.");
		const teleported = stepSnake(approach, first, random);
		expect(teleported.direction).toBe(exit.direction);
		const next = stepSnake(teleported, second, random);
		expect(next.direction).toBe(exit.direction);
		expect(next.body[0]).toEqual({
			x: teleported.body[0].x,
			y: teleported.body[0].y - 1,
		});
	});
});

/** Place a shuffle pickup immediately ahead without changing the ordinary food. */
function pickupAhead(): SnakeGame {
	const game = createSnakeGame(random);
	if (game.outcome.kind !== "playing")
		throw new Error("Expected a live board.");
	return {
		...game,
		outcome: {
			...game.outcome,
			portalPickup: { x: game.body[0].x + 1, y: game.body[0].y },
		},
	};
}

describe("Portal shuffle pickup", () => {
	it("spawns separately from food, snake, and portals", () => {
		const game = createSnakeGame(random);
		if (game.outcome.kind !== "playing" || game.outcome.portalPickup === null)
			throw new Error("Expected both collectibles.");
		const pickup = game.outcome.portalPickup;
		expect(sameSnakeCell(pickup, game.outcome.food)).toBe(false);
		expect(game.body.some((part) => sameSnakeCell(part, pickup))).toBe(false);
		expect(
			game.portals.some((portal) => sameSnakeCell(portal.cell, pickup)),
		).toBe(false);
	});
	it.each([0, 0.25, 0.5, 0.75, 0.999])(
		"relocates both ends with safe outward headings using sample %s",
		(sample) => {
			const game = pickupAhead();
			const next = stepSnake(game, "right", () => sample);
			expect(next.body).toHaveLength(game.body.length);
			expect(next.score).toBe(game.score);
			expect(next.portals).not.toEqual(game.portals);
			if (next.outcome.kind !== "playing")
				throw new Error("Expected a live board.");
			const { food, portalPickup } = next.outcome;
			const deltas: Record<SnakeDirection, SnakeCell> = {
				up: { x: 0, y: -1 },
				right: { x: 1, y: 0 },
				down: { x: 0, y: 1 },
				left: { x: -1, y: 0 },
			};
			const occupied = next.portals.flatMap((portal) => [
				portal.cell,
				{
					x: portal.cell.x + deltas[portal.direction].x,
					y: portal.cell.y + deltas[portal.direction].y,
				},
			]);
			expect(new Set(occupied.map((cell) => `${cell.x},${cell.y}`)).size).toBe(
				occupied.length,
			);
			for (const cell of occupied) {
				expect(cell.x).toBeGreaterThanOrEqual(0);
				expect(cell.y).toBeGreaterThanOrEqual(0);
				expect(cell.x).toBeLessThan(LOGOPOLIS.width);
				expect(cell.y).toBeLessThan(LOGOPOLIS.height);
				expect(next.body.some((part) => sameSnakeCell(part, cell))).toBe(false);
				expect(sameSnakeCell(cell, food)).toBe(false);
			}
			for (const portal of next.portals)
				expect(
					game.portals.some((old) => sameSnakeCell(old.cell, portal.cell)),
				).toBe(false);
			expect(portalPickup).not.toBeNull();
			if (portalPickup === null)
				throw new Error("Expected a replacement pickup.");
			expect(next.body.some((part) => sameSnakeCell(part, portalPickup))).toBe(
				false,
			);
			expect(
				next.portals.some((portal) => sameSnakeCell(portal.cell, portalPickup)),
			).toBe(false);
			expect(sameSnakeCell(food, portalPickup)).toBe(false);
		},
	);
	it("varies orientations along with positions", () => {
		const headings = [0, 0.25, 0.5, 0.75, 0.999].flatMap((sample) =>
			stepSnake(pickupAhead(), "right", () => sample).portals.map(
				(portal) => portal.direction,
			),
		);
		expect(new Set(headings).size).toBeGreaterThan(1);
	});
	it("uses the current portal pair for traversal", () => {
		const game: SnakeGame = {
			...board([{ x: 1, y: 2 }], "right", distantFood),
			portals: [
				{ cell: { x: 2, y: 2 }, direction: "left" },
				{ cell: { x: 10, y: 10 }, direction: "down" },
			],
		};
		const next = stepSnake(game, "right", random);
		expect(next.body[0]).toEqual({ x: 10, y: 11 });
		expect(next.direction).toBe("down");
	});
	it("retires a pickup when a crowded board cannot fit safe new portals", () => {
		const head = { x: 0, y: 0 };
		const pickup = { x: 1, y: 0 };
		const food = { x: 2, y: 0 };
		const body: [SnakeCell, ...SnakeCell[]] = [head];
		for (let y = 0; y < LOGOPOLIS.height; y++)
			for (let x = 0; x < LOGOPOLIS.width; x++) {
				const cell = { x, y };
				if (
					![head, pickup, food].some((reserved) =>
						sameSnakeCell(reserved, cell),
					) &&
					!LOGOPOLIS_INITIAL_PORTALS.some((portal) =>
						sameSnakeCell(portal.cell, cell),
					)
				)
					body.push(cell);
			}
		const game: SnakeGame = {
			...board(body, "right", food),
			outcome: { kind: "playing", food, portalPickup: pickup },
		};
		const next = stepSnake(game, "right", random);
		expect(next.portals).toBe(game.portals);
		expect(next.outcome).toEqual({ kind: "playing", food, portalPickup: null });
	});
	it("converts the last free pickup cell to food so the board remains winnable", () => {
		const head = { x: 0, y: 0 };
		const food = { x: 1, y: 0 };
		const pickup = { x: 2, y: 0 };
		const body: [SnakeCell, ...SnakeCell[]] = [head];
		for (let y = 0; y < LOGOPOLIS.height; y++)
			for (let x = 0; x < LOGOPOLIS.width; x++) {
				const cell = { x, y };
				if (
					![head, pickup, food].some((reserved) =>
						sameSnakeCell(reserved, cell),
					) &&
					!LOGOPOLIS_INITIAL_PORTALS.some((portal) =>
						sameSnakeCell(portal.cell, cell),
					)
				)
					body.push(cell);
			}
		const game: SnakeGame = {
			...board(body, "right", food),
			outcome: { kind: "playing", food, portalPickup: pickup },
		};
		const next = stepSnake(game, "right", random);
		expect(next.outcome).toEqual({
			kind: "playing",
			food: pickup,
			portalPickup: null,
		});
		expect(stepSnake(next, "right", random).outcome.kind).toBe("won");
	});
});
