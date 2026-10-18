import type { DynamicEntityWorldPlacement } from "../lib/game/runtime/dynamic-entity-feed";
import type { CameraPlacement } from "../lib/game/runtime/types";
import type { ClientChatMessage } from "./client-host-contract";

const POSITION_DECIMAL_PLACES = 3;
const ORIENTATION_DECIMAL_PLACES = 4;

/** Compact repro text names coordinate frames and quaternion component order. */
export function formatClientLocation(
	player: DynamicEntityWorldPlacement["pose"],
	camera: CameraPlacement,
): string {
	return [
		`Player(AC) cell=0x${player.landblockId.toString(16).padStart(8, "0")} pos=${formatPosition(player.coords)} quat(wxyz)=${formatOrientation(player.rotation)}`,
		`Camera(scene) lb=${camera.landblockId} cell=${camera.envCellId ?? "outdoors"} pos=${formatPosition(camera.position)} quat(wxyz)=${formatOrientation(camera.rotation)}`,
	].join("\n");
}

function formatPosition({
	x,
	y,
	z,
}: DynamicEntityWorldPlacement["pose"]["coords"]): string {
	return formatComponents([x, y, z], POSITION_DECIMAL_PLACES);
}

function formatOrientation({
	w,
	x,
	y,
	z,
}: DynamicEntityWorldPlacement["pose"]["rotation"]): string {
	return formatComponents([w, x, y, z], ORIENTATION_DECIMAL_PLACES);
}

/** Numeric conversion trims trailing zeros and normalizes rounded negative zero. */
function formatComponents(
	values: readonly number[],
	decimalPlaces: number,
): string {
	return `(${values.map((value) => Number(value.toFixed(decimalPlaces))).join(", ")})`;
}

/** Intercept only the app-local command; clipboard failure leaves the report in durable chat. */
export async function runClientLocationCommand(
	message: string,
	readReport: () => string,
	appendMessage: (message: ClientChatMessage) => void,
): Promise<boolean> {
	if (!/^[/@]loc$/i.test(message.trim())) return false;
	const report = readReport();
	appendMessage({ kind: "system", message: report });
	try {
		await navigator.clipboard.writeText(report);
	} catch (error) {
		throw new Error(
			`Location printed, but clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
	return true;
}
