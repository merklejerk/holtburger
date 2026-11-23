import { describe, expect, it, vi } from "vitest";
import type { NameplateCategory } from "../../lib/game/renderer/overlays/nameplate-policy";
import {
	cellId,
	type DynamicEntityView,
	type DynamicEntityWorldPlacement,
} from "../../lib/game/runtime/dynamic-entity-feed";
import type { ClientEntityFacts } from "./entity-mirror";
import { entityFacts } from "./entity-mirror.test-support";
import {
	ClientEntityOverlays,
	isWithinSmartProximity,
	resolveActiveCombatEngagement,
	resolveVisibleHealthBarFraction,
} from "./entity-overlays";
import type { ClientEntityOverlayTuning } from "../settings/tuning-contract";

type WorldPose = DynamicEntityWorldPlacement["pose"];

const TEST_TUNING: ClientEntityOverlayTuning = {
	proximityArcDegrees: 90,
	proximityRadiusMeters: 5,
	immediatePreviewIntervalMs: 100,
	healthMaxDistanceMeters: 35,
	healthRecentWindowMs: 5_000,
};

const CATEGORY_VISIBILITY: Readonly<Record<NameplateCategory, boolean>> = {
	mob: true,
	npc: true,
	other: false,
	player: true,
	portal: true,
	selfPlayer: false,
};

function pose(x: number, y: number, z = 0, yawDegrees = 0): WorldPose {
	// Clockwise horizontal rotation in AC (+Y north, +X east) around Z axis.
	const halfRad = (-yawDegrees * 0.5 * Math.PI) / 180;
	return {
		landblockId: cellId(0x0101_0000),
		coords: { x, y, z },
		rotation: {
			w: Math.cos(halfRad),
			x: 0,
			y: 0,
			z: Math.sin(halfRad),
		},
	};
}

function dynamicEntity(
	guid: number,
	x: number,
	y: number,
	options: {
		readonly generation?: number;
		readonly entityClass?: DynamicEntityView["presentation"]["entityClass"];
		readonly name?: string;
		readonly z?: number;
		readonly yawDegrees?: number;
		readonly attachedTo?: number;
	} = {},
): DynamicEntityView {
	const generation = options.generation ?? 1;
	const entityClass = options.entityClass ?? "mob";
	const name = options.name ?? `Entity ${guid}`;
	return {
		identity: { guid, wcid: 42 },
		generation,
		placement:
			options.attachedTo === undefined
				? {
						kind: "world",
						pose: pose(x, y, options.z ?? 0, options.yawDegrees ?? 0),
						spatialMembership: {
							reachesOutdoors: true,
							reachedEnvCellIds: [],
						},
						contact: "grounded",
						sampleMode: "authoritative-only",
					}
				: {
						kind: "attached",
						parent: options.attachedTo,
						parentLocation: "none",
						placement: "default",
					},
		presentation: {
			placementFrame: 0,
			entityClass,
			content: {
				motionTableDid: null,
				setupDid: 1,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			objectScale: 1,
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			radar: {
				behavior: null,
				category: "other",
				obviousRange: null,
			},
		},
		display: {
			name,
			level: 10,
		},
		physics: {
			flags: {
				reportCollisions: false,
				gravity: false,
				ethereal: false,
				ignoreCollisions: false,
				missile: false,
				inelastic: false,
				edgeSlide: false,
				frozen: false,
			},
			participation: "pose-only",
			cloaked: false,
			hidden: false,
			lighting: false,
			noDraw: false,
			translucency: 0,
			defaultAnimation: false,
			defaultScript: false,
		},
		motion: null,
	};
}

function creatureFacts(
	guid: number,
	fraction: number | null,
	observedAtSeconds = 100,
	options: {
		readonly instanceSequence?: number;
		readonly targeting?: ClientEntityFacts["targeting"];
		readonly isHostile?: boolean;
		readonly corpse?: boolean;
	} = {},
): ClientEntityFacts {
	return {
		...entityFacts(guid, {
			isHostile: options.isHostile ?? false,
			targeting: options.targeting ?? "creature",
			corpse: options.corpse ? "unopened" : null,
		}),
		health:
			fraction === null
				? null
				: {
						instanceSequence: options.instanceSequence ?? 1,
						fraction,
						observedAtSeconds,
					},
	};
}

describe("resolveActiveCombatEngagement", () => {
	it("prioritizes spellCastTarget even outside combat mode and ignores peace-mode desired targets", () => {
		expect(
			resolveActiveCombatEngagement({
				combatMode: "peace",
				spellCastTarget: 42,
				combat: { desired: null },
			}),
		).toMatchObject({ target: 42, combatType: "magic" });
		expect(
			resolveActiveCombatEngagement({
				combatMode: "peace",
				spellCastTarget: null,
				combat: {
					desired: {
						target: 99,
						profile: { kind: "melee", height: "medium", power: 0.5 },
					},
				},
			}),
		).toBeNull();
		expect(
			resolveActiveCombatEngagement({
				combatMode: "melee",
				spellCastTarget: null,
				combat: {
					desired: {
						target: 99,
						profile: { kind: "melee", height: "medium", power: 0.5 },
					},
				},
			}),
		).toMatchObject({ target: 99, combatType: "melee" });
	});
});

describe("isWithinSmartProximity", () => {
	it("evaluates player body facing horizontal cone and inclusive 3D root distance", () => {
		const facingEast = pose(10, 10, 0, 90);
		expect(isWithinSmartProximity(facingEast, pose(15, 10), TEST_TUNING)).toBe(
			true,
		);
		expect(
			isWithinSmartProximity(facingEast, pose(15.01, 10), TEST_TUNING),
		).toBe(false);
		// 44 deg from +X lies inside 90 deg total arc; 46 deg lies outside.
		expect(
			isWithinSmartProximity(
				facingEast,
				pose(
					10 + 3 * Math.cos((44 * Math.PI) / 180),
					10 + 3 * Math.sin((44 * Math.PI) / 180),
				),
				TEST_TUNING,
			),
		).toBe(true);
		expect(
			isWithinSmartProximity(
				facingEast,
				pose(
					10 + 3 * Math.cos((46 * Math.PI) / 180),
					10 + 3 * Math.sin((46 * Math.PI) / 180),
				),
				TEST_TUNING,
			),
		).toBe(false);
		// Behind the player (-X) is outside.
		expect(isWithinSmartProximity(facingEast, pose(8, 10), TEST_TUNING)).toBe(
			false,
		);
		// Vertically coincident origin within 3D radius qualifies without dividing by zero.
		expect(
			isWithinSmartProximity(facingEast, pose(10, 10, 4), TEST_TUNING),
		).toBe(true);
		expect(
			isWithinSmartProximity(facingEast, pose(10, 10, 5.1), TEST_TUNING),
		).toBe(false);
	});
});

describe("resolveVisibleHealthBarFraction", () => {
	it("admits fresh damaged living creatures within distance, tolerates IPC skew, and excludes full/corpse/wrong-gen", () => {
		const playerPose = pose(10, 10);
		const mobView = dynamicEntity(7, 10, 20, { generation: 2 });
		const base = {
			dynamic: mobView,
			playerPose,
			hostNowSeconds: 100,
			recentWindowSeconds: TEST_TUNING.healthRecentWindowMs / 1_000,
			maxDistanceSquared:
				TEST_TUNING.healthMaxDistanceMeters *
				TEST_TUNING.healthMaxDistanceMeters,
		};

		// Zero health is valid for non-corpse creatures; negative age from IPC skew stays visible.
		expect(
			resolveVisibleHealthBarFraction({
				...base,
				facts: creatureFacts(7, 0, 100.4, { instanceSequence: 2 }),
			}),
		).toBe(0);
		// Full health never shows a bar.
		expect(
			resolveVisibleHealthBarFraction({
				...base,
				facts: creatureFacts(7, 1, 100, { instanceSequence: 2 }),
			}),
		).toBeNull();
		// Generation mismatch never leaks old health onto reused GUIDs.
		expect(
			resolveVisibleHealthBarFraction({
				...base,
				facts: creatureFacts(7, 0.5, 100, { instanceSequence: 1 }),
			}),
		).toBeNull();
		// Stale sample or unavailable snapshot clock hides the bar.
		expect(
			resolveVisibleHealthBarFraction({
				...base,
				facts: creatureFacts(7, 0.5, 95, { instanceSequence: 2 }),
			}),
		).toBeNull();
		expect(
			resolveVisibleHealthBarFraction({
				...base,
				hostNowSeconds: null,
				facts: creatureFacts(7, 0.5, 100, { instanceSequence: 2 }),
			}),
		).toBeNull();
		// Corpse or non-creature never shows a bar.
		expect(
			resolveVisibleHealthBarFraction({
				...base,
				facts: creatureFacts(7, 0.5, 100, {
					instanceSequence: 2,
					corpse: true,
				}),
			}),
		).toBeNull();
		expect(
			resolveVisibleHealthBarFraction({
				...base,
				facts: creatureFacts(7, 0.5, 100, {
					instanceSequence: 2,
					targeting: "non-creature",
				}),
			}),
		).toBeNull();
		// Beyond max distance hides the bar.
		expect(
			resolveVisibleHealthBarFraction({
				...base,
				dynamic: dynamicEntity(
					7,
					10,
					10 + TEST_TUNING.healthMaxDistanceMeters + 1,
					{
						generation: 2,
					},
				),
				facts: creatureFacts(7, 0.5, 100, { instanceSequence: 2 }),
			}),
		).toBeNull();
	});
});

describe("ClientEntityOverlays", () => {
	it("implements all six Smart predicates, Always mode, priority/occlusion separation, and non-invented labels", () => {
		const player = dynamicEntity(1, 0, 0, {
			entityClass: "player",
			name: "Hero",
		});
		const selectedItem = dynamicEntity(2, 0, -25, { entityClass: "other" });
		const hoveredDoor = dynamicEntity(3, 0, -25, { entityClass: "other" });
		const combatMob = dynamicEntity(4, 0, -25, { entityClass: "mob" });
		const alertItem = dynamicEntity(5, 0, -25, { entityClass: "other" });
		const proximityItem = dynamicEntity(6, 0, 3, { entityClass: "other" });
		const immediateMob = dynamicEntity(7, 0, -25, { entityClass: "mob" });
		const damagedBystander = dynamicEntity(8, 0, -20, { entityClass: "mob" });
		const unnamedDamagedMob = dynamicEntity(9, 0, -15, {
			entityClass: "mob",
			name: "   ",
		});
		const entities = [
			player,
			selectedItem,
			hoveredDoor,
			combatMob,
			alertItem,
			proximityItem,
			immediateMob,
			damagedBystander,
			unnamedDamagedMob,
		];
		const facts = new Map<number, ClientEntityFacts>([
			[1, creatureFacts(1, 0.8, 100)],
			[2, creatureFacts(2, null, 100, { targeting: "non-creature" })],
			[3, creatureFacts(3, null, 100, { targeting: "non-creature" })],
			[4, creatureFacts(4, 0.4, 100, { isHostile: true })],
			[5, creatureFacts(5, null, 100, { targeting: "non-creature" })],
			[6, creatureFacts(6, null, 100, { targeting: "non-creature" })],
			[7, creatureFacts(7, 1.0, 100, { isHostile: true })],
			[8, creatureFacts(8, 0.25, 100, { isHostile: false })],
			[9, creatureFacts(9, 0.5, 100)],
		]);

		const policy = new ClientEntityOverlays({
			tuning: TEST_TUNING,
			initialMode: "smart",
		});
		const frame = policy.composeFrame({
			nowMs: 1_000,
			hostNowSeconds: 100,
			playerGuid: 1,
			playerPose: pose(0, 0),
			dynamicEntities: entities,
			resolveDynamicGeneration: (guid) =>
				entities.find((entity) => entity.identity.guid === guid)?.generation ??
				null,
			factsEntities: facts,
			selectedGuid: 2,
			hoveredGuid: 3,
			activeCombatTargetGuid: 4,
			alertGuids: new Set([5]),
			categoryVisibility: CATEGORY_VISIBILITY,
			sampleImmediateTarget: () => 7,
		});
		expect(frame.kind).toBe("resolved");
		if (frame.kind !== "resolved") throw new Error("Expected resolved frame");

		// Self proximity exclusion does not block self injured health bar.
		expect(frame.entities.get(1)?.presentation).toEqual({
			occlusion: "scene",
			nameplate: null,
			healthBar: { fraction: 0.8, priority: "ambient" },
		});
		expect(frame.entities.get(2)?.presentation).toEqual({
			occlusion: "overlay",
			nameplate: "focus",
			healthBar: null,
		});
		expect(frame.entities.get(3)?.presentation).toEqual({
			occlusion: "overlay",
			nameplate: "focus",
			healthBar: null,
		});
		expect(frame.entities.get(4)?.presentation).toEqual({
			occlusion: "scene",
			nameplate: "focus",
			healthBar: { fraction: 0.4, priority: "focus" },
		});
		expect(frame.entities.get(5)?.presentation).toEqual({
			occlusion: "overlay",
			nameplate: "alert",
			healthBar: null,
			beacon: { kind: "alert" },
		});
		expect(frame.entities.get(6)?.presentation).toEqual({
			occlusion: "scene",
			nameplate: "ambient",
			healthBar: null,
		});
		// Immediate full-health mob gets label alone.
		expect(frame.entities.get(7)?.presentation).toEqual({
			occlusion: "scene",
			nameplate: "focus",
			healthBar: null,
		});
		// Out-of-cone damaged non-hostile creature gets bar alone.
		expect(frame.entities.get(8)?.presentation).toEqual({
			occlusion: "scene",
			nameplate: null,
			healthBar: { fraction: 0.25, priority: "ambient" },
		});
		// Unnamed damaged mob keeps its bar and never receives an invented label even if selected.
		expect(frame.entities.get(9)?.presentation).toEqual({
			occlusion: "scene",
			nameplate: null,
			healthBar: { fraction: 0.5, priority: "ambient" },
		});

		// Switching to Always disables passive preview and Smart proximity while preserving explicit alert exceptions.
		const sampleSpy = vi.fn(() => 7);
		policy.setMode("always");
		const alwaysFrame = policy.composeFrame({
			nowMs: 1_000 + TEST_TUNING.immediatePreviewIntervalMs,
			hostNowSeconds: 100,
			playerGuid: 1,
			playerPose: pose(0, 0),
			dynamicEntities: entities,
			resolveDynamicGeneration: (guid) =>
				entities.find((entity) => entity.identity.guid === guid)?.generation ??
				null,
			factsEntities: facts,
			selectedGuid: null,
			hoveredGuid: null,
			activeCombatTargetGuid: null,
			alertGuids: new Set([5]),
			categoryVisibility: CATEGORY_VISIBILITY,
			sampleImmediateTarget: sampleSpy,
		});
		expect(sampleSpy).not.toHaveBeenCalled();
		if (alwaysFrame.kind !== "resolved") throw new Error("Expected resolved");
		expect(alwaysFrame.entities.get(5)?.presentation.nameplate).toBe("alert");
		expect(alwaysFrame.entities.get(6)).toBeUndefined();
		expect(alwaysFrame.entities.get(7)?.presentation.nameplate).toBe("ambient");

		// Switching to Minimal restricts nameplates to selected, hovered, and alert matches while keeping independent health bars.
		policy.setMode("minimal");
		const minimalFrame = policy.composeFrame({
			nowMs: 1_000 + TEST_TUNING.immediatePreviewIntervalMs * 2,
			hostNowSeconds: 100,
			playerGuid: 1,
			playerPose: pose(0, 0),
			dynamicEntities: entities,
			resolveDynamicGeneration: (guid) =>
				entities.find((entity) => entity.identity.guid === guid)?.generation ??
				null,
			factsEntities: facts,
			selectedGuid: 2,
			hoveredGuid: 3,
			activeCombatTargetGuid: 4,
			alertGuids: new Set([5]),
			categoryVisibility: CATEGORY_VISIBILITY,
			sampleImmediateTarget: sampleSpy,
		});
		expect(sampleSpy).not.toHaveBeenCalled();
		if (minimalFrame.kind !== "resolved") throw new Error("Expected resolved");
		expect(minimalFrame.entities.get(2)?.presentation).toEqual({
			occlusion: "overlay",
			nameplate: "focus",
			healthBar: null,
		});
		expect(minimalFrame.entities.get(3)?.presentation).toEqual({
			occlusion: "overlay",
			nameplate: "focus",
			healthBar: null,
		});
		expect(minimalFrame.entities.get(4)?.presentation).toEqual({
			occlusion: "scene",
			nameplate: null,
			healthBar: { fraction: 0.4, priority: "focus" },
		});
		expect(minimalFrame.entities.get(5)?.presentation).toEqual({
			occlusion: "overlay",
			nameplate: "alert",
			healthBar: null,
			beacon: { kind: "alert" },
		});
		// Selecting an alerted entity preserves its alert beacon alongside focus nameplate priority.
		const selectedAlertFrame = policy.composeFrame({
			nowMs: 1_000 + TEST_TUNING.immediatePreviewIntervalMs * 3,
			hostNowSeconds: 100,
			playerGuid: 1,
			playerPose: pose(0, 0),
			dynamicEntities: entities,
			resolveDynamicGeneration: (guid) =>
				entities.find((entity) => entity.identity.guid === guid)?.generation ??
				null,
			factsEntities: facts,
			selectedGuid: 5,
			hoveredGuid: null,
			activeCombatTargetGuid: null,
			alertGuids: new Set([5]),
			categoryVisibility: CATEGORY_VISIBILITY,
		});
		if (selectedAlertFrame.kind !== "resolved")
			throw new Error("Expected resolved");
		expect(selectedAlertFrame.entities.get(5)?.presentation).toEqual({
			occlusion: "overlay",
			nameplate: "focus",
			healthBar: null,
			beacon: { kind: "alert" },
		});
		expect(minimalFrame.entities.get(6)).toBeUndefined();
		expect(minimalFrame.entities.get(7)).toBeUndefined();
		expect(minimalFrame.entities.get(8)?.presentation).toEqual({
			occlusion: "scene",
			nameplate: null,
			healthBar: { fraction: 0.25, priority: "ambient" },
		});
	});

	it("schedules 10Hz preview without catch-up bursts and invalidates reused GUID generations", () => {
		const mobGen1 = dynamicEntity(10, 0, -20, { generation: 1 });
		const mobGen2 = dynamicEntity(10, 0, -20, { generation: 2 });
		const facts = new Map<number, ClientEntityFacts>([
			[10, creatureFacts(10, 1.0, 100)],
		]);
		const sampleImmediateTarget = vi.fn(() => 10);
		const policy = new ClientEntityOverlays({
			tuning: TEST_TUNING,
			initialMode: "smart",
		});

		let generation = 1;
		const compose = (nowMs: number) =>
			policy.composeFrame({
				nowMs,
				hostNowSeconds: 100,
				playerGuid: 1,
				playerPose: pose(0, 0),
				dynamicEntities: [generation === 1 ? mobGen1 : mobGen2],
				resolveDynamicGeneration: (guid) => (guid === 10 ? generation : null),
				factsEntities: facts,
				selectedGuid: null,
				hoveredGuid: null,
				activeCombatTargetGuid: null,
				alertGuids: new Set(),
				categoryVisibility: CATEGORY_VISIBILITY,
				sampleImmediateTarget,
			});

		// First frame samples once; subsequent frame within interval reuses it.
		const f1 = compose(1_000);
		expect(sampleImmediateTarget).toHaveBeenCalledTimes(1);
		expect(
			f1.kind === "resolved" && f1.entities.get(10)?.presentation.nameplate,
		).toBe("focus");

		compose(1_000 + TEST_TUNING.immediatePreviewIntervalMs - 1);
		expect(sampleImmediateTarget).toHaveBeenCalledTimes(1);

		// Delayed frame (>10x interval) takes at most ONE sample and schedules from current time.
		const delayedAt = 1_000 + TEST_TUNING.immediatePreviewIntervalMs * 10;
		compose(delayedAt);
		expect(sampleImmediateTarget).toHaveBeenCalledTimes(2);
		compose(delayedAt + TEST_TUNING.immediatePreviewIntervalMs - 1);
		expect(sampleImmediateTarget).toHaveBeenCalledTimes(2);

		// Reusing GUID 10 under generation 2 mid-interval clears the stale gen-1 immediate preview.
		generation = 2;
		const reused = compose(
			delayedAt + TEST_TUNING.immediatePreviewIntervalMs - 1,
		);
		expect(
			reused.kind === "resolved" ? reused.entities.get(10) : undefined,
		).toBeUndefined();
	});

	it("suppresses automatic projectile nameplates in Smart and Always modes unless selected or hovered", () => {
		const nearbyArrow = dynamicEntity(20, 0, 1, {
			entityClass: "other",
			name: "Arrow",
		});
		const alertedBolt = dynamicEntity(21, 0, -10, {
			entityClass: "mob",
			name: "Shock Wave",
		});
		const selectedBolt = dynamicEntity(22, 0, -10, {
			entityClass: "other",
			name: "Flame Bolt",
		});
		const hoveredArrow = dynamicEntity(23, 0, -10, {
			entityClass: "other",
			name: "Heavy Crossbow Bolt",
		});
		const entities = [nearbyArrow, alertedBolt, selectedBolt, hoveredArrow];
		const facts = new Map<number, ClientEntityFacts>([
			[20, creatureFacts(20, null, 100, { targeting: "projectile" })],
			[21, creatureFacts(21, null, 100, { targeting: "projectile" })],
			[22, creatureFacts(22, null, 100, { targeting: "projectile" })],
			[23, creatureFacts(23, null, 100, { targeting: "projectile" })],
		]);
		const policy = new ClientEntityOverlays({
			tuning: TEST_TUNING,
			initialMode: "smart",
		});
		const compose = () =>
			policy.composeFrame({
				nowMs: 1_000,
				hostNowSeconds: 100,
				playerGuid: 1,
				playerPose: pose(0, 0),
				dynamicEntities: entities,
				resolveDynamicGeneration: (guid) =>
					entities.find((entity) => entity.identity.guid === guid)
						?.generation ?? null,
				factsEntities: facts,
				selectedGuid: 22,
				hoveredGuid: 23,
				activeCombatTargetGuid: 20,
				alertGuids: new Set([21]),
				categoryVisibility: CATEGORY_VISIBILITY,
				sampleImmediateTarget: () => 20,
			});

		const smart = compose();
		expect(smart.kind).toBe("resolved");
		if (smart.kind !== "resolved") throw new Error("Expected resolved frame");
		expect(smart.entities.get(20)).toBeUndefined();
		expect(smart.entities.get(21)).toBeUndefined();
		expect(smart.entities.get(22)?.presentation).toEqual({
			occlusion: "overlay",
			nameplate: "focus",
			healthBar: null,
		});
		expect(smart.entities.get(23)?.presentation).toEqual({
			occlusion: "overlay",
			nameplate: "focus",
			healthBar: null,
		});

		policy.setMode("always");
		const always = compose();
		expect(always.kind).toBe("resolved");
		if (always.kind !== "resolved") throw new Error("Expected resolved frame");
		expect(always.entities.get(20)).toBeUndefined();
		expect(always.entities.get(21)).toBeUndefined();
		expect(always.entities.get(22)?.presentation.nameplate).toBe("focus");
		expect(always.entities.get(23)?.presentation.nameplate).toBe("focus");
	});
});
