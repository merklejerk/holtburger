import type { PreparedPhysicsScriptClosure } from "./physics-script-repository";

/**
 * The whole-object UV scroll rate a staged script closure authors, if any.
 *
 * Retail keys scroll by GfxObj DataID and shares one offset across every instance of that mesh
 * (`CPhysics::UpdateTexVelocity`, acclient.c:299999), which is what keeps tiled flowing surfaces
 * from tearing at their seams. Because the archive authors exactly one rate per DataID, the rate is
 * a static property of content identity rather than of a running entity — so it is resolved here,
 * once, when the closure is staged, and never written again while a frame runs.
 *
 * Resolving at preparation rather than at hook execution starts the scroll slightly earlier than
 * retail would for a hook authored at `t > 0`. Ratified 2026-08-06 as immaterial: these are ambient
 * looping surfaces whose absolute phase origin already differs from retail unobservably, and a
 * late-starting scroll is a visible kick that this avoids rather than causes.
 */
export function resolveAuthoredTextureScroll(
	closure: PreparedPhysicsScriptClosure,
): readonly [number, number] | null {
	let resolved: readonly [number, number] | null = null;
	for (const script of closure.scripts.values()) {
		for (const record of script.records) {
			// `texture-velocity-part` is deliberately not handled: the complete archive census found
			// zero part-scoped scroll hooks anywhere, so implementing one would be speculative.
			if (record.kind !== "texture-velocity") continue;
			const rate = [record.uSpeed, record.vSpeed] as const;
			if (resolved === null) {
				resolved = rate;
				continue;
			}
			// Two distinct rates on one owner would make a derived phase wrong for at least one of
			// them, and the archive contains no such case. Fail loudly rather than pick a winner the
			// way retail's last-writer-wins registration would.
			if (resolved[0] !== rate[0] || resolved[1] !== rate[1]) {
				throw new Error(
					`Script closure for ${closure.rootId} authors conflicting texture scroll rates ` +
						`(${resolved[0]}, ${resolved[1]}) and (${rate[0]}, ${rate[1]}).`,
				);
			}
		}
	}
	return resolved;
}
