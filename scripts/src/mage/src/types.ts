export type MageDamageType =
	| "acid"
	| "cold"
	| "direct"
	| "lightning"
	| "fire"
	| "bludgeon"
	| "pierce"
	| "slash"
	| "void";

export type MageSpellSchool = "war" | "life" | "void";
export type MageSpellType =
	| "attack"
	| "heal"
	| "revitalize"
	| "vuln"
	| "health-to-health"
	| "health-to-mana"
	| "health-to-stamina"
	| "mana-to-health"
	| "mana-to-mana"
	| "mana-to-stamina"
	| "stamina-to-mana"
	| "stamina-to-health"
	| "stamina-to-stamina";
export type MageTargetKind = "self" | "other";

export type MageSpellRecord = {
	name?: string;
	spellId: number;
	school: MageSpellSchool;
	type: MageSpellType;
	difficulty: number;
	damageType: MageDamageType | null;
	range: number | null;
	targetKind: MageTargetKind;
};

export type MageData = {
	spells: Record<string, MageSpellRecord>;
	skills: Record<string, number>;
	weenieResists: Uint8Array;
};

export type MageConfig = {
	preferredSpellIds: number[];
	bannedSpellIds: number[];
};

export type MonsterCandidate = {
	guid: Guid;
	weenieId: number | null;
	position: WorldPosition;
	distanceToSelf: number;
	distanceToParty: number;
};

export type AttackTarget = {
	guid: Guid;
	reason: string;
	weenieId: number | null;
};

export type SkillSnapshot = {
	skillId: number;
	effective: number;
	training: TrainingLevel;
};

export type MageSpellcastKind =
	| "attack"
	| "vulnerability"
	| "heal"
	| "revitalize"
	| "transfer";

export type MageSpellcastRequest = {
	spellName: string | null;
	targetName: string | null;
	spellId: number;
	targetGuid: Guid | null;
	damageType: MageDamageType | null;
	kind: MageSpellcastKind;
	issuedAt: number;
	attackRay: AttackRaySnapshot | null;
};

export type AttackRaySnapshot = {
	from: WorldPosition;
	to: WorldPosition;
};

export type MageSpellcastInterruptionReason =
	| "follow_override"
	| "teleport"
	| "weenie_error";

export type MageSpellcastOutcome =
	| { kind: "succeeded" }
	| { kind: "resisted" }
	| { kind: "fizzled" }
	| { kind: "missed" }
	| { kind: "timed_out" }
	| {
			kind: "interrupted";
			reason: MageSpellcastInterruptionReason;
	  };

export type MageResolvedSpellcast = {
	request: MageSpellcastRequest;
	outcome: MageSpellcastOutcome;
	resolvedAt: number;
};

export type MageSpellcastState =
	| {
			phase: "idle";
	  }
	| {
			phase: "awaiting_busy";
			request: MageSpellcastRequest;
	  }
	| {
			phase: "active";
			request: MageSpellcastRequest;
			busySince: number;
	  };

export type VulnerabilityPolicyState = {
	failedVulnAttemptsByTarget: Map<Guid, number>;
	lastSuccessfulVulnAtByTarget: Map<Guid, number>;
};

export type AttackPolicyState = {
	lastMissedAttackByTarget: Map<Guid, AttackMissRecord>;
};

export type AttackMissRecord = {
	missedAt: number;
	ray: AttackRaySnapshot;
};

export type HealingKitUseRecord = {
	targetGuid: Guid;
	targetName: string | null;
	kitGuid: Guid;
	issuedAt: number;
};

export type HealingKitPolicyState = {
	pendingUse: HealingKitUseRecord | null;
	lastSuccessfulUseAtByTarget: Map<Guid, number>;
};

export type MageRuntimeState = {
	data: MageData | null;
	config: MageConfig;
	elapsedSeconds: number;
	combatTargetGuid: Guid | null;
	spellcast: MageSpellcastState;
	partySeparationLatched: boolean;
	maxPartyDistance: number;
	maxAggroDistance: number;
	actionTimes: Map<string, number>;
	attackPolicy: AttackPolicyState;
	healingKitPolicy: HealingKitPolicyState;
	vulnerabilityPolicy: VulnerabilityPolicyState;
};

export type PartySeparation = {
	shouldFollow: boolean;
	distance: number | null;
	nextLatched: boolean;
};

export type ChooseSpellOptions = {
	school?: MageSpellSchool;
	type?: MageSpellType;
	targetKind?: MageTargetKind;
	targetGuid?: Guid | null;
	selfGuid: Guid;
	preferredSpellIds?: number[];
	preferredDamageTypes?: MageDamageType[];
	exactDamageType?: MageDamageType | null;
};

export type AttackTargetSelection = {
	target: AttackTarget | null;
	nextCombatTargetGuid: Guid | null;
};
