/**
 * Holtburger unified Live API scripting surface (`HB` / `Holtburger`).
 *
 * Every read and action routes directly through `holtburger-live-api`'s `LiveApiEngine`,
 * matching the REST (`/v1/*`, `POST /v1/command`) and WebSocket (`/v1/ws`) contracts verbatim.
 */

type Guid = number;
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
interface JsonObject {
	[key: string]: JsonValue;
}
type JsonArray = JsonValue[];

interface Vector3 {
	x: number;
	y: number;
	z: number;
}

interface Quaternion {
	w: number;
	x: number;
	y: number;
	z: number;
}

interface WorldPosition {
	landblock_id: number;
	coords: Vector3;
	rotation: Quaternion;
}

type Gait = "walk" | "run";
type AttackHeight = "low" | "medium" | "high";
type CombatModeSpec = "peace" | "melee" | "missile" | "magic";
type UiPrintStyle = "info" | "warn" | "error" | "system" | "combat" | "magic" | "trade";

type AttackProfileSpec =
	| { kind: "melee"; height: AttackHeight; power: number }
	| { kind: "missile"; height: AttackHeight; accuracy: number };

interface EntityFilter {
	maxDistance?: number;
	category?: string;
	name?: string;
	wcid?: number;
}

interface EntitySummary {
	guid: Guid;
	name: string;
	wcid: number | null;
	category: string;
	isHostile: boolean;
	isDead: boolean;
	isVendor: boolean;
	position: WorldPosition;
	distanceToSelf: number | null;
	healthFraction: number | null;
	stackCount: number | null;
	container: Guid | null;
	wielder: Guid | null;
}

interface EntityPropertiesView {
	ints: Record<string, number>;
	int64s: Record<string, number>;
	floats: Record<string, number>;
	bools: Record<string, boolean>;
	strings: Record<string, string>;
	dids: Record<string, number>;
	iids: Record<string, number>;
}

interface EntityDetail {
	summary: EntitySummary;
	facts: JsonValue | null;
	properties: EntityPropertiesView | null;
	creatureProfile: JsonValue | null;
	weaponProfile: JsonValue | null;
	armorProfile: JsonValue | null;
}

interface SelfView {
	guid: Guid;
	name: string | null;
	position: WorldPosition | null;
	heading: number | null;
	health: number;
	healthMax: number;
	stamina: number;
	staminaMax: number;
	mana: number;
	manaMax: number;
	pyreals: number | null;
	burden: number | null;
	combatMode: string;
	busy: string | null;
	confirmation: {
		requestId: number;
		confirmationType: string;
		context: number;
		text: string;
	} | null;
	spellCastTarget: Guid | null;
	navigation: JsonValue | null;
	serverTime: number | null;
}

interface InventoryView {
	pyreals: number | null;
	burden: number | null;
	containers: Array<{
		guid: Guid;
		name: string | null;
		itemCapacity: number | null;
		packCapacity: number | null;
		items: Guid[];
	}>;
	openWorldContainer: Guid | null;
	projectileSupply: JsonValue;
}

interface EquipmentView {
	items: Array<{
		guid: Guid;
		name: string | null;
		equipMask: number;
	}>;
}

interface CombatView {
	combatMode: string;
	state: string;
	target: Guid | null;
	profile: AttackProfileSpec | null;
}

interface SocialView {
	fellowship: JsonValue | null;
	allegiance: JsonValue;
	friends: JsonValue | null;
	squelch: JsonValue | null;
	contracts: JsonValue | null;
}

interface SpellbookView {
	knownSpells: number[];
	castTarget: Guid | null;
}

interface SpellDefinitionView {
	id: number;
	name: string;
	description: string;
	school: string;
	iconId: number;
	category: number;
	bitfield: number;
	baseMana: number;
	baseRangeConstant: number;
	baseRangeMod: number;
	power: number;
	components: number[];
	duration: number | null;
}

interface CommandResponse {
	accepted: boolean;
	correlationId: number | null;
	settled: boolean;
	timedOut: boolean;
	outcome?: JsonValue;
	latestEventSeq: number;
}

interface ScriptPostRequest {
	url: string;
	bodyJson?: JsonValue;
	timeoutMs?: number;
}

interface ScriptPostResponse {
	ok: boolean;
	status: number;
	bodyJson: JsonValue | null;
}

type ScriptEvent =
	| { kind: "started"; args: string }
	| { kind: "stopped" }
	| { kind: "tick"; elapsed: number }
	| { kind: "command"; msg: string }
	| {
			kind: "api";
			seq: number;
			timestampMs: number;
			topic: string;
			event: JsonObject;
	  };

type PositionRef = Guid | WorldPosition | { position: WorldPosition };

interface HoltburgerApi {
	onEvent(handler: (event: ScriptEvent) => void): void;
	query(query: JsonObject): JsonValue;
	command(command: JsonObject, wait?: { until?: "accepted" | "settled"; timeoutMs?: number }): CommandResponse;
	pollEvents(since?: number, topics?: string[], limit?: number): {
		events: Array<{ seq: number; timestampMs: number; topic: string; event: JsonObject }>;
		nextSeq: number;
		droppedBefore?: number | null;
	};

	info(): JsonObject;
	characters(): JsonValue[];
	self(): SelfView;
	sheet(): JsonObject | null;
	enchantments(): JsonObject | null;
	spellbook(): SpellbookView;
	recalls(): string[];
	deathLocations(): JsonObject;
	entities(filter?: EntityFilter): EntitySummary[];
	entity(guid: Guid, includeProperties?: boolean): EntityDetail | null;
	inventory(): InventoryView;
	equipment(): EquipmentView;
	combat(): CombatView;
	trade(): JsonObject;
	vendor(): JsonObject | null;
	social(): SocialView;
	selection(): Guid | null;
	spells(search?: string | null, school?: string | null): SpellDefinitionView[];
	spell(id: number): SpellDefinitionView;
	skills(): JsonValue[];

	setCombatMode(mode: CombatModeSpec): CommandResponse;
	beginCombat(target: Guid, profile: AttackProfileSpec): CommandResponse;
	updateCombatProfile(profile: AttackProfileSpec): CommandResponse;
	stopCombat(): CommandResponse;
	castSpell(spellId: number, targetGuid?: Guid | null): CommandResponse;
	useEntity(guid: Guid, unrestricted?: boolean): CommandResponse;
	useItem(source: Guid, target?: Guid | null): CommandResponse;
	salvage(items: Guid[], tool?: Guid | null): CommandResponse;
	requestAppraisal(guid: Guid, factsOnly?: boolean): CommandResponse;
	queryHealth(guid: Guid): CommandResponse;
	inventoryIntent(intent: JsonObject): CommandResponse;
	tradeAction(request: JsonObject): CommandResponse;
	vendorTrade(trade: JsonObject): CommandResponse;
	respondConfirmation(requestId: number, accepted: boolean): CommandResponse;
	chat(request: JsonObject): CommandResponse;
	say(message: string): CommandResponse;
	emote(message: string): CommandResponse;
	soulEmote(token: string): CommandResponse;

	steer(
		goal: JsonObject,
		opts?: { stuckTimeoutMs?: number; maxDurationMs?: number | null },
	): CommandResponse;
	moveTo(
		destination: WorldPosition,
		opts?: {
			arrivalDistance?: number;
			gait?: Gait;
			finalHeading?: number | null;
			stuckTimeoutMs?: number;
			maxDurationMs?: number | null;
		},
	): CommandResponse;
	approach(
		target: Guid,
		opts?: {
			arrivalDistance?: number | null;
			gait?: Gait;
			stuckTimeoutMs?: number;
			maxDurationMs?: number | null;
		},
	): CommandResponse;
	follow(
		target: Guid,
		opts?: {
			followDistance?: number;
			gait?: Gait;
			stuckTimeoutMs?: number;
			maxDurationMs?: number | null;
		},
	): CommandResponse;
	faceHeading(heading: number): CommandResponse;
	faceEntity(target: Guid): CommandResponse;
	stopMovement(): CommandResponse;
	snapFacing(heading: number): CommandResponse;
	setSelection(guid: Guid | null): CommandResponse;
	print(message: string, style?: UiPrintStyle): CommandResponse;

	distance(from: PositionRef, to: PositionRef): number;
	headingTo(from: PositionRef, to: PositionRef): number;
	debugLog(message: string): void;
	loadConfig(): JsonValue | null;
	writeConfig(value: string | JsonValue): boolean;
	loadData(): JsonValue | null;
	loadDataBin(): Uint8Array | null;
	postJson(request: ScriptPostRequest): Promise<ScriptPostResponse>;
}

declare const HB: HoltburgerApi;
declare const Holtburger: HoltburgerApi;
