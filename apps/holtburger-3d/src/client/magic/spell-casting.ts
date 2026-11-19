import type { SpellDetails } from "../../app/spell-references";

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
		!(
			details.school.kind === "known" && details.school.school === "life-magic"
		) &&
		details.castingRoute === "selected-target" &&
		details.usesProjectileHandler
	) {
		// RETAIL DIVERGENCE: requires a selection here. Preserving that check would prevent
		// deliberate forward fire supported by the server's null-target projectile path.
		// Server behavior rejects a missing Life target after consuming resources. The
		// 2026-09-17 6,266-spell DAT census found 474 selected-target non-Life projectiles
		// affected by this policy.
		return { kind: "untargeted" };
	}
	return { kind: "normal", selection };
}
