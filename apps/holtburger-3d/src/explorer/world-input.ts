import type { EnvCellId, LandblockId } from "../lib/game/game-types";
import { Quat } from "../lib/game/math/types";
import type { SceneResidency } from "../lib/game/scene";

const HEX_PREFIX_PATTERN = /^(?:0x)?([0-9a-f]{4})$/i;
const HEX_CELL_PATTERN = /^(?:0x)?([0-9a-f]{8})$/i;

/** Parsed residence explicitly supplied by Explorer's world controls. */
export interface ParsedResidenceInput {
	/** Human-readable normalized target shown beside the form input. */
	readonly label: string;
	/** Authoritative residence encoded by the submitted identifier. */
	readonly residency: SceneResidency;
}

/** Parse a landblock prefix, outdoor landblock id, or environment-cell id. */
export function parseResidenceInput(
	input: string,
): ParsedResidenceInput | null {
	const value = input.trim();
	const prefixMatch = HEX_PREFIX_PATTERN.exec(value);
	if (prefixMatch) {
		return createResidence(`${prefixMatch[1]}ffff`);
	}
	const cellMatch = HEX_CELL_PATTERN.exec(value);
	return cellMatch ? createResidence(cellMatch[1]!) : null;
}

/** Convert Explorer yaw/pitch degrees into one normalized camera quaternion. */
export function createCameraRotation(
	yawDegrees: number,
	pitchDegrees: number,
): Quat {
	if (!Number.isFinite(yawDegrees) || !Number.isFinite(pitchDegrees)) {
		throw new Error("Camera yaw and pitch must be finite.");
	}
	const yaw = (yawDegrees * Math.PI) / 180;
	const pitch = (pitchDegrees * Math.PI) / 180;
	const halfYaw = yaw / 2;
	const halfPitch = pitch / 2;
	const cosYaw = Math.cos(halfYaw);
	const sinYaw = Math.sin(halfYaw);
	const cosPitch = Math.cos(halfPitch);
	const sinPitch = Math.sin(halfPitch);
	const z = -sinYaw * sinPitch;
	return new Quat(
		cosYaw * cosPitch,
		cosYaw * sinPitch,
		sinYaw * cosPitch,
		Object.is(z, -0) ? 0 : z,
	);
}

function createResidence(rawId: string): ParsedResidenceInput {
	const canonicalId = `0x${rawId.toLowerCase()}`;
	const prefix = canonicalId.slice(0, 6);
	const suffix = canonicalId.slice(6);
	const landblockId = `${prefix}ffff` as LandblockId;
	if (suffix === "ffff") {
		return {
			label: `Outdoor landblock ${landblockId}`,
			residency: { envCellId: null, landblockId },
		};
	}
	const envCellId = canonicalId as EnvCellId;
	return {
		label: `Environment cell ${envCellId}`,
		residency: { envCellId, landblockId },
	};
}
