import type { z } from "zod";
import type { entityAppearanceSchema } from "./entity-appearance-contract";

/** A local visual level scoped to one authoritative object incarnation. */
export interface DynamicPresentationOverride {
	readonly guid: number;
	readonly generation: number;
	/** Bare-body substitutions; attached equipment is hidden for this level's installed lifetime. */
	readonly body: {
		readonly setupDid: number;
		readonly appearance: z.infer<typeof entityAppearanceSchema>;
	} | null;
	/** Racial particle level, independent of whether the editor remains open. */
	readonly particles: {
		/** Apply/preview identity; repeated recovery publications must not replay effects. */
		readonly key: string;
		readonly script: number | null;
	} | null;
}
