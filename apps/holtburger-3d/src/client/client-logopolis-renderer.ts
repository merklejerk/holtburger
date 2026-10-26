import spriteAtlasUrl from "../assets/icons/logopolis-sprites.svg?url";
import {
	LOGOPOLIS,
	type SnakeDirection,
	type SnakeGame,
} from "./client-logopolis";

/** Cold arcade presentation state; pause does not change the simulation outcome. */
export type LogopolisScreenStatus = SnakeGame["outcome"]["kind"] | "paused";

const CELL = 8;
const INSET = 4;
const SCORE_HEIGHT = 16;
/** Native framebuffer; CSS stretches its coarse pixels to a classic 4:3 display. */
export const LOGOPOLIS_SCREEN = {
	width: LOGOPOLIS.width * CELL + INSET * 2,
	height: LOGOPOLIS.height * CELL + SCORE_HEIGHT + INSET * 2,
};

/** Decode the authored atlas before a board can start or draw sprites. */
export async function loadLogopolisSprites(): Promise<HTMLImageElement> {
	const image = new Image();
	image.src = spriteAtlasUrl;
	await image.decode();
	if (image.naturalWidth !== CELL * 3 || image.naturalHeight !== CELL)
		throw new Error("Logopolis sprite atlas must contain three 8×8 cells.");
	return image;
}

/** Tiny 3×5 bitmap alphabet for the screen's fixed arcade labels and decimal scores. */
const GLYPHS: Readonly<Record<string, readonly number[]>> = {
	" ": [0, 0, 0, 0, 0],
	A: [2, 5, 7, 5, 5],
	B: [6, 5, 6, 5, 6],
	C: [3, 4, 4, 4, 3],
	D: [6, 5, 5, 5, 6],
	E: [7, 4, 6, 4, 7],
	G: [3, 4, 5, 5, 3],
	L: [4, 4, 4, 4, 7],
	M: [5, 7, 7, 5, 5],
	O: [2, 5, 5, 5, 2],
	P: [6, 5, 6, 4, 4],
	R: [6, 5, 6, 5, 5],
	S: [3, 4, 2, 1, 6],
	T: [7, 2, 2, 2, 2],
	U: [5, 5, 5, 5, 7],
	V: [5, 5, 5, 5, 2],
	0: [7, 5, 5, 5, 7],
	1: [2, 6, 2, 2, 7],
	2: [6, 1, 2, 4, 7],
	3: [6, 1, 2, 1, 6],
	4: [5, 5, 7, 1, 1],
	5: [7, 4, 6, 1, 6],
	6: [3, 4, 7, 5, 7],
	7: [7, 1, 2, 2, 2],
	8: [7, 5, 7, 5, 7],
	9: [7, 5, 7, 1, 6],
};

function ink(context: CanvasRenderingContext2D, color: string): void {
	context.fillStyle = color;
	context.shadowColor = color;
	context.shadowBlur = 0.7;
}

function text(
	context: CanvasRenderingContext2D,
	label: string,
	x: number,
	y: number,
	scale: number,
): void {
	for (const character of label) {
		const rows = GLYPHS[character];
		if (rows === undefined)
			throw new Error(`Logopolis bitmap font has no glyph for ${character}.`);
		rows.forEach((bits, row) => {
			for (let column = 0; column < 3; column++) {
				if (bits & (4 >> column))
					context.fillRect(x + column * scale, y + row * scale, scale, scale);
			}
		});
		x += 4 * scale;
	}
}

/** Draw the full screen, including scores and outcome text, only when the board changes. */
export function renderLogopolis(
	context: CanvasRenderingContext2D,
	sprites: CanvasImageSource,
	game: SnakeGame,
	bestScore: number,
	status: LogopolisScreenStatus,
): void {
	const { width, height } = LOGOPOLIS_SCREEN;
	context.clearRect(0, 0, width, height);
	context.imageSmoothingEnabled = false;
	ink(context, "#fff1b9");
	text(
		context,
		`SCORE ${String(game.score).padStart(3, "0")}`,
		INSET + 2,
		INSET + 1,
		1,
	);
	const best = `BEST ${String(bestScore).padStart(3, "0")}`;
	text(context, best, width - INSET - best.length * 4, INSET + 1, 1);

	context.save();
	context.translate(INSET, SCORE_HEIGHT + INSET);
	// Clip bloom to the playfield so it cannot bleed into the score display.
	context.beginPath();
	context.rect(0, 0, LOGOPOLIS.width * CELL, LOGOPOLIS.height * CELL);
	context.clip();
	game.portals.forEach((portal, index) => {
		const angles: Record<SnakeDirection, number> = {
			right: 0,
			down: Math.PI / 2,
			left: Math.PI,
			up: -Math.PI / 2,
		};
		context.save();
		context.translate(
			(portal.cell.x + 0.5) * CELL,
			(portal.cell.y + 0.5) * CELL,
		);
		context.rotate(angles[portal.direction]);
		// The contrasting arrow and open rim stay crisp, within their own board cell.
		context.shadowBlur = 0;
		context.drawImage(
			sprites,
			index * CELL,
			0,
			CELL,
			CELL,
			-CELL / 2,
			-CELL / 2,
			CELL,
			CELL,
		);
		context.restore();
	});
	if (game.outcome.kind === "playing") {
		ink(context, "#fff04b");
		context.fillRect(
			game.outcome.food.x * CELL + 3,
			game.outcome.food.y * CELL + 3,
			2,
			2,
		);
		const pickup = game.outcome.portalPickup;
		if (pickup !== null) {
			ink(context, "#37edff");
			context.drawImage(
				sprites,
				CELL * 2,
				0,
				CELL,
				CELL,
				pickup.x * CELL,
				pickup.y * CELL,
				CELL,
				CELL,
			);
		}
	}
	ink(context, "#39f51b");
	game.body.forEach((part, index) => {
		const x = part.x * CELL;
		const y = part.y * CELL;
		context.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
		const next = game.body[index + 1];
		if (next === undefined) return;
		// Join adjacent cells; portal discontinuities remain separate stretches of snake.
		if (part.y === next.y && Math.abs(part.x - next.x) === 1)
			context.fillRect(
				Math.min(part.x, next.x) * CELL + 1,
				y + 1,
				CELL * 2 - 2,
				CELL - 2,
			);
		if (part.x === next.x && Math.abs(part.y - next.y) === 1)
			context.fillRect(
				x + 1,
				Math.min(part.y, next.y) * CELL + 1,
				CELL - 2,
				CELL * 2 - 2,
			);
	});
	const [head] = game.body;
	context.fillRect(head.x * CELL, head.y * CELL, CELL, CELL);
	context.restore();

	if (status !== "playing") {
		context.shadowBlur = 0;
		context.fillStyle = "#000b";
		context.fillRect(0, SCORE_HEIGHT, width, height - SCORE_HEIGHT);
		ink(context, "#fff1b9");
		const label =
			status === "paused"
				? "PAUSED"
				: status === "won"
					? "BOARD CLEAR"
					: "GAME OVER";
		text(
			context,
			label,
			Math.floor((width - (label.length * 4 - 1) * 2) / 2),
			Math.floor(height * 0.4),
			2,
		);
	}
}
