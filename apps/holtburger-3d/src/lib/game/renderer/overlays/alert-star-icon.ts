import alertStarSvg from "../../../../assets/icons/minimap-alert.svg?raw";

/** Authored square viewBox dimension shared by the alert star SVG asset. */
const ALERT_STAR_VIEWBOX_SIZE = 24;

/** Ordered polygon vertices parsed once from the authored 5-point alert star SVG. */
const ALERT_STAR_VERTICES: readonly (readonly [number, number])[] =
	parseAlertStarVertices(alertStarSvg);

/**
 * Parse a closed straight-segment SVG path (`M`/`m`/`L`/`l`/`Z`) into viewBox coordinates.
 *
 * Pure parsing avoids DOMParser/Path2D dependencies so both browser Canvas2D rasterization and
 * Node test contexts consume the exact same authored SVG asset.
 */
function parseAlertStarVertices(
	svg: string,
): readonly (readonly [number, number])[] {
	const match = /<path\b[^>]*\bd="([^"]+)"/i.exec(svg);
	if (match === null)
		throw new Error("Alert star SVG must contain a path geometry.");
	const tokens = match[1].match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)/g);
	if (tokens === null)
		throw new Error("Alert star SVG path contains no commands.");

	const vertices: [number, number][] = [];
	let cursorX = 0;
	let cursorY = 0;
	let command: string | null = null;
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index];
		if (token === undefined) break;
		if (/^[a-zA-Z]$/.test(token)) {
			command = token;
			index += 1;
			if (command === "Z" || command === "z") continue;
			continue;
		}
		if (command === null)
			throw new Error("Alert star SVG path must begin with a command.");
		const x = Number(tokens[index]);
		const y = Number(tokens[index + 1]);
		if (!Number.isFinite(x) || !Number.isFinite(y))
			throw new Error("Alert star SVG path coordinates must be finite.");
		index += 2;
		if (command === "m" || command === "l") {
			cursorX += x;
			cursorY += y;
			if (command === "m") command = "l";
		} else if (command === "M" || command === "L") {
			cursorX = x;
			cursorY = y;
			if (command === "M") command = "L";
		} else {
			throw new Error(`Unsupported alert star SVG path command: ${command}`);
		}
		vertices.push([cursorX, cursorY]);
	}
	if (vertices.length < 3)
		throw new Error("Alert star SVG path must contain at least 3 vertices.");
	return vertices;
}

/** Paint the authored 5-point alert star centered at `(centerX, centerY)` with a dark halo. */
export function paintAlertStar(
	context: CanvasRenderingContext2D,
	centerX: number,
	centerY: number,
	size: number,
	fillStyle: string,
	outlineStyle: string,
	outlineViewBoxWidth = 2.4,
): void {
	const scale = size / ALERT_STAR_VIEWBOX_SIZE;
	context.save();
	context.translate(centerX - size / 2, centerY - size / 2);
	context.scale(scale, scale);
	context.beginPath();
	const first = ALERT_STAR_VERTICES[0];
	if (first !== undefined) {
		context.moveTo(first[0], first[1]);
		for (let i = 1; i < ALERT_STAR_VERTICES.length; i += 1) {
			const vertex = ALERT_STAR_VERTICES[i];
			if (vertex !== undefined) context.lineTo(vertex[0], vertex[1]);
		}
	}
	context.closePath();
	context.lineJoin = "round";
	context.lineCap = "round";
	if (outlineViewBoxWidth > 0) {
		context.lineWidth = outlineViewBoxWidth;
		context.strokeStyle = outlineStyle;
		context.stroke();
	}
	context.fillStyle = fillStyle;
	context.fill();
	context.restore();
}
