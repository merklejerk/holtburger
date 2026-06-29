import type { RuntimeDynamicSpawnRequest } from "../dynamic/dynamic-entity-controller";
import type {
	DynamicEntityAppearanceOverride,
	DynamicEntityResidence,
} from "../dynamic/contracts";
import { FIRST_RUNTIME_SPAWN_FIXTURE } from "../runtime/runtime-spawn-fixtures";
import type { WeenieSpawnSeed } from "./weenie-spawn-seed-resolver";

export type BrowserSpawnAnimationMode = "none" | "explicit";
export type BrowserSpawnResidenceMode = "env-cell" | "outdoor";

export interface BrowserSpawnFormState {
	/** Optional display label for browser-owned runtime spawn rows. */
	readonly label: string;
	/** Optional WCID seed lookup input. It never creates a spawn directly. */
	readonly weenieClassId: string;
	/** Hidden ObjDesc-shaped appearance facts populated by WCID lookup when available. */
	readonly modelData: DynamicEntityAppearanceOverride | null;
	/** Required setup model id, accepted as decimal or `0x` hex. */
	readonly setupModelId: string;
	/** Optional server-authored correlation id kept separate from runtime entity id. */
	readonly serverInstanceId: string;
	/** Source residence mode for the runtime spawn. */
	readonly residenceMode: BrowserSpawnResidenceMode;
	/** Source landblock id, accepted as decimal or `0x` hex. */
	readonly landblockId: string;
	/** Env-cell id, accepted as decimal or `0x` hex when env-cell residence is selected. */
	readonly envCellId: string;
	/** Landblock-local X origin. */
	readonly originX: string;
	/** Landblock-local Y origin. */
	readonly originY: string;
	/** Landblock-local Z origin. */
	readonly originZ: string;
	/** Yaw angle in degrees around the browser/runtime vertical axis. */
	readonly yawDegrees: string;
	/** Source X scale. */
	readonly scaleX: string;
	/** Source Y scale. */
	readonly scaleY: string;
	/** Source Z scale. */
	readonly scaleZ: string;
	/** Animation policy for the runtime spawn request. */
	readonly animationMode: BrowserSpawnAnimationMode;
	/** Explicit animation id, accepted as decimal or `0x` hex when enabled. */
	readonly animationId: string;
}

export interface BrowserRuntimeSpawnRecord {
	/** Browser display label captured at create time. */
	readonly label: string;
	/** Source setup model id submitted to the runtime. */
	readonly setupModelId: number;
	/** Optional WCID source identity from a seed-applied form. */
	readonly weenieClassId: number | null;
	/** Optional server-authored correlation id metadata. */
	readonly serverInstanceId: string | null;
	/** Source residence used for select/inspect affordances. */
	readonly sourceResidence: DynamicEntityResidence;
}

interface BrowserSpawnRequestAccepted {
	readonly kind: "accepted";
	readonly record: BrowserRuntimeSpawnRecord;
	readonly request: RuntimeDynamicSpawnRequest;
}

interface BrowserSpawnRequestRejected {
	readonly errors: readonly string[];
	readonly kind: "rejected";
}

export type BrowserSpawnRequestValidationResult =
	| BrowserSpawnRequestAccepted
	| BrowserSpawnRequestRejected;

const DEFAULT_RUNTIME_SPAWN_LANDBLOCK_ID = 0xda55ffff;
const DEFAULT_RUNTIME_SPAWN_ENV_CELL_ID = 0xda550100;
const DEFAULT_RUNTIME_SPAWN_SCALE = "1";

export function createDefaultBrowserSpawnFormState(): BrowserSpawnFormState {
	return {
		animationId: "",
		animationMode: "none",
		envCellId: formatHex32(DEFAULT_RUNTIME_SPAWN_ENV_CELL_ID),
		label: FIRST_RUNTIME_SPAWN_FIXTURE.label,
		landblockId: formatHex32(DEFAULT_RUNTIME_SPAWN_LANDBLOCK_ID),
		modelData: null,
		originX: "0",
		originY: "0",
		originZ: "0",
		scaleX: DEFAULT_RUNTIME_SPAWN_SCALE,
		scaleY: DEFAULT_RUNTIME_SPAWN_SCALE,
		scaleZ: DEFAULT_RUNTIME_SPAWN_SCALE,
		serverInstanceId: "",
		residenceMode: "outdoor",
		setupModelId: formatHex32(FIRST_RUNTIME_SPAWN_FIXTURE.setupModelId),
		weenieClassId: String(FIRST_RUNTIME_SPAWN_FIXTURE.weenieClassId),
		yawDegrees: "0",
	};
}

export function applyWeenieSpawnSeedToForm(
	form: BrowserSpawnFormState,
	seed: WeenieSpawnSeed,
): BrowserSpawnFormState {
	return {
		...form,
		label: seed.label,
		modelData: seed.appearance ?? null,
		scaleX: seed.defaultScale == null ? form.scaleX : String(seed.defaultScale),
		scaleY: seed.defaultScale == null ? form.scaleY : String(seed.defaultScale),
		scaleZ: seed.defaultScale == null ? form.scaleZ : String(seed.defaultScale),
		setupModelId: formatHex32(seed.setupModelId),
		weenieClassId: String(seed.weenieClassId),
	};
}

export function parseWeenieClassIdInput(input: string): number | null {
	return parseUnsignedInteger(input);
}

export function validateBrowserSpawnForm(
	form: BrowserSpawnFormState,
): BrowserSpawnRequestValidationResult {
	const errors: string[] = [];
	const setupModelId = parseRequiredUnsignedInteger(
		form.setupModelId,
		"Setup id",
		errors,
	);
	const landblockId = parseRequiredUnsignedInteger(
		form.landblockId,
		"Landblock id",
		errors,
	);
	const envCellId =
		form.residenceMode === "env-cell"
			? parseRequiredUnsignedInteger(form.envCellId, "Env-cell id", errors)
			: null;
	const weenieClassId = parseOptionalUnsignedInteger(
		form.weenieClassId,
		"WCID",
		errors,
	);
	const originX = parseRequiredFiniteNumber(form.originX, "Origin X", errors);
	const originY = parseRequiredFiniteNumber(form.originY, "Origin Y", errors);
	const originZ = parseRequiredFiniteNumber(form.originZ, "Origin Z", errors);
	const yawDegrees = parseRequiredFiniteNumber(
		form.yawDegrees,
		"Yaw degrees",
		errors,
	);
	const scaleX = parseRequiredPositiveNumber(form.scaleX, "Scale X", errors);
	const scaleY = parseRequiredPositiveNumber(form.scaleY, "Scale Y", errors);
	const scaleZ = parseRequiredPositiveNumber(form.scaleZ, "Scale Z", errors);
	const animationId =
		form.animationMode === "explicit"
			? parseRequiredUnsignedInteger(form.animationId, "Animation id", errors)
			: null;

	if (form.animationMode !== "none" && form.animationMode !== "explicit") {
		errors.push("Animation mode is not supported.");
	}
	if (form.residenceMode !== "outdoor" && form.residenceMode !== "env-cell") {
		errors.push("Residence mode is not supported.");
	}

	if (errors.length > 0) {
		return { errors, kind: "rejected" };
	}

	const sourceResidence = createSourceResidence({
		envCellId,
		landblockId: landblockId as number,
		residenceMode: form.residenceMode,
	});
	const request: RuntimeDynamicSpawnRequest = {
		animationSelection:
			form.animationMode === "explicit"
				? { animationId: animationId as number, kind: "explicit" }
				: { kind: "none" },
		baseLocalPlacement: {
			orientation: createYawQuaternion(degreesToRadians(yawDegrees as number)),
			origin: {
				x: originX as number,
				y: originY as number,
				z: originZ as number,
			},
		},
		modelData: form.modelData,
		serverInstanceIdMetadata: createServerInstanceMetadata(
			form.serverInstanceId,
		),
		setupModelId: setupModelId as number,
		sourceResidence,
		sourceScale: {
			x: scaleX as number,
			y: scaleY as number,
			z: scaleZ as number,
		},
	};

	return {
		kind: "accepted",
		record: {
			label: createRuntimeSpawnLabel(form.label, setupModelId as number),
			serverInstanceId: request.serverInstanceIdMetadata?.id ?? null,
			setupModelId: setupModelId as number,
			sourceResidence,
			weenieClassId,
		},
		request,
	};
}

export function formatBrowserSpawnRecordSummary(
	record: BrowserRuntimeSpawnRecord,
): string {
	const serverSuffix =
		record.serverInstanceId === null
			? ""
			: ` server ${record.serverInstanceId}`;
	const wcidSuffix =
		record.weenieClassId === null ? "" : ` WCID ${record.weenieClassId}`;
	return `${record.label} setup ${formatHex32(record.setupModelId)} ${formatResidenceSummary(record.sourceResidence)}${wcidSuffix}${serverSuffix}`;
}

function createSourceResidence(options: {
	readonly envCellId: number | null;
	readonly landblockId: number;
	readonly residenceMode: BrowserSpawnResidenceMode;
}): DynamicEntityResidence {
	if (options.residenceMode === "env-cell") {
		return {
			envCellId: options.envCellId as number,
			kind: "env-cell",
			landblockId: options.landblockId,
		};
	}
	return {
		kind: "outdoor-landblock",
		landblockId: options.landblockId,
	};
}

function formatResidenceSummary(residence: DynamicEntityResidence): string {
	if (residence.kind === "env-cell") {
		return `env ${formatHex32(residence.envCellId)}`;
	}
	return `out ${formatHex32(residence.landblockId)}`;
}

function createRuntimeSpawnLabel(label: string, setupModelId: number): string {
	const trimmed = label.trim();
	return trimmed.length > 0
		? trimmed
		: `Runtime setup ${formatHex32(setupModelId)}`;
}

function createServerInstanceMetadata(
	serverInstanceId: string,
): RuntimeDynamicSpawnRequest["serverInstanceIdMetadata"] {
	const trimmed = serverInstanceId.trim();
	if (trimmed.length === 0) {
		return null;
	}
	return { id: trimmed };
}

function parseRequiredUnsignedInteger(
	input: string,
	label: string,
	errors: string[],
): number | null {
	const parsed = parseUnsignedInteger(input);
	if (parsed === null) {
		errors.push(`${label} must be a non-negative integer.`);
	}
	return parsed;
}

function parseOptionalUnsignedInteger(
	input: string,
	label: string,
	errors: string[],
): number | null {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const parsed = parseUnsignedInteger(trimmed);
	if (parsed === null) {
		errors.push(`${label} must be a non-negative integer when provided.`);
	}
	return parsed;
}

function parseUnsignedInteger(input: string): number | null {
	const trimmed = input.trim();
	const radix = trimmed.toLowerCase().startsWith("0x") ? 16 : 10;
	const digits = radix === 16 ? trimmed.slice(2) : trimmed;
	if (digits.length === 0) {
		return null;
	}
	if (!/^[0-9a-f]+$/i.test(digits)) {
		return null;
	}
	const value = Number.parseInt(digits, radix);
	if (!Number.isSafeInteger(value) || value < 0) {
		return null;
	}
	return value;
}

function parseRequiredFiniteNumber(
	input: string,
	label: string,
	errors: string[],
): number | null {
	const value = Number(input.trim());
	if (!Number.isFinite(value)) {
		errors.push(`${label} must be a finite number.`);
		return null;
	}
	return value;
}

function parseRequiredPositiveNumber(
	input: string,
	label: string,
	errors: string[],
): number | null {
	const value = parseRequiredFiniteNumber(input, label, errors);
	if (value !== null && value <= 0) {
		errors.push(`${label} must be greater than zero.`);
		return null;
	}
	return value;
}

function createYawQuaternion(yawRadians: number): {
	readonly w: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
} {
	const halfYaw = yawRadians / 2;
	return {
		w: Math.cos(halfYaw),
		x: 0,
		y: 0,
		z: Math.sin(halfYaw),
	};
}

function degreesToRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function formatHex32(value: number): string {
	return `0x${value.toString(16).padStart(8, "0")}`;
}
