import type { SpellDetails } from "../app/spell-references";

const LIFE_MAGIC_SCHOOL = 2;

/** Complete recipient intent forwarded to shared combat execution. */
export type ClientSpellCastAim =
	| {
			readonly kind: "normal";
			readonly selection: number | null;
	  }
	| { readonly kind: "untargeted" };

/** Choose app-local free-projectile policy without weakening ordinary spell routing. */
export function resolveClientSpellCastAim(
	details: SpellDetails | null,
	selection: number | null,
): ClientSpellCastAim {
	if (
		selection === null &&
		details !== null &&
		details.school !== LIFE_MAGIC_SCHOOL &&
		details.castingRoute === "selected-target" &&
		details.usesProjectileHandler
	) {
		// RETAIL DIVERGENCE: acclient.c:387512-387534 requires a selection here.
		// Preserving that check would prevent deliberate forward fire supported by ACE's
		// null-target projectile path. ACE WorldObject_Magic.cs:266-274 rejects a
		// missing Life target after Player_Magic.cs:849-868 consumes resources. The
		// 2026-09-17 6,266-spell DAT census found 474 selected-target non-Life
		// projectiles affected by this policy.
		return { kind: "untargeted" };
	}
	return { kind: "normal", selection };
}
