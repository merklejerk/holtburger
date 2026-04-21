import type { MageDamageType } from "./types";

export const MAX_AGGRO_DISTANCE = 25;
export const MAX_PARTY_DISTANCE = 10;
export const PARTY_RESUME_FACTOR = 0.9;
export const HEALING_DISTANCE = 15;
export const SELF_MANA_THRESHOLD = 0.4;
export const SELF_HEALTH_THRESHOLD = 0.6;
export const SELF_STAMINA_THRESHOLD = 0.6;
export const PARTY_HEAL_THRESHOLD = 0.6;
export const PARTY_REVITALIZE_THRESHOLD = 0.4;
export const SPELL_SKILL_HEADROOM = 30;
export const SPELL_REPEAT_SECONDS = 1.1;
export const HEALING_KIT_SUCCESS_GRACE_SECONDS = 2;
export const PENDING_SPELL_BUSY_GRACE_SECONDS = 1;
export const VULN_REPEAT_SECONDS = 10 * 60;
export const MAX_VULN_ATTEMPTS_PER_TARGET = 2;
export const FOLLOW_REPEAT_SECONDS = 1.5;
export const PENDING_SPELL_TIMEOUT_SECONDS = 8;
export const ATTACK_SPELL_TIMEOUT_SECONDS = 5;

export const EMPTY_DAMAGE_TYPES: MageDamageType[] = [];
