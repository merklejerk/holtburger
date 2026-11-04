import { getContext, setContext } from "svelte";
import { z } from "zod";
import type { HostTransport } from "../lib/host/host-transport";
import { prepareUiIcons } from "../app/ui-icon-source";
import type { UiIconDisplay, UiIconServices } from "../app/ui-icon-repository";
import {
	statTargetSchema,
	type StatTarget,
} from "./client-character-sheet-contract";

const word = z.number().int().nonnegative().max(0xffff_ffff);
const referenceSchema = z
	.object({
		target: statTargetSchema,
		creationId: word,
		artwork: z.discriminatedUnion("kind", [
			z
				.object({
					kind: z.literal("ready"),
					spec: z
						.object({ kind: z.literal("base"), base: word.positive() })
						.strict(),
				})
				.strict(),
			z
				.object({ kind: z.literal("failed"), detail: z.string().min(1) })
				.strict(),
		]),
	})
	.strict();
/** Static references contain both allocation and progression identities, resolved by the host. */
export const statIconReferencesSchema = z
	.array(referenceSchema)
	.superRefine((references, context) => {
		const targets = new Set<string>();
		const creationIds = new Set<string>();
		for (const reference of references) {
			const target = JSON.stringify(reference.target);
			const creation = creationIconKey(
				statIconKind(reference.target),
				reference.creationId,
			);
			if (targets.has(target))
				context.addIssue({
					code: "custom",
					message: "Duplicate stat icon target",
				});
			if (creationIds.has(creation))
				context.addIssue({
					code: "custom",
					message: "Duplicate stat icon creation identity",
				});
			targets.add(target);
			creationIds.add(creation);
		}
	});
export type StatIconReferences = z.infer<typeof statIconReferencesSchema>;
/** Static content and PNG preparation share the same selected content transport. */
export interface StatArtworkServices {
	/** Load identities once per mounted screen; current stat updates do not reload artwork. */
	readonly load: () => Promise<StatIconReferences>;
	/** Reuse the existing bounded icon preparation protocol. */
	readonly prepare: UiIconServices["prepare"];
}
/** Mode-neutral static-content adapter, usable before character entry. */
export function statArtworkServices(
	transport: HostTransport,
): StatArtworkServices {
	return {
		load: async () =>
			statIconReferencesSchema.parse(await transport.invoke("load_stat_icons")),
		prepare: (requests) => prepareUiIcons(transport, requests),
	};
}
export type StatIconKind = "attribute" | "vital" | "skill";
/** Category is read from the canonical contract, never inferred from displayed names. */
export function statIconKind(target: StatTarget): StatIconKind {
	if ("Attribute" in target) return "attribute";
	return "Vital" in target ? "vital" : "skill";
}
/** Namespacing keeps skill slot zero distinct from creator attribute/vital index zero. */
export function creationIconKey(kind: StatIconKind, id: number): string {
	return `creation:${kind}:${id}`;
}
/** Bounded display lookup supplied by one artwork owner to all stat labels beneath it. */
export interface StatIconLookup {
	/** Canonical in-game stat identity. */
	readonly read: (target: StatTarget) => UiIconDisplay | undefined;
	/** Host-resolved allocation index or numeric skill slot. */
	readonly creation: (
		kind: StatIconKind,
		id: number,
	) => UiIconDisplay | undefined;
}
const STAT_ICONS = Symbol("stat-icons");
export function provideStatIcons(lookup: StatIconLookup): void {
	setContext(STAT_ICONS, lookup);
}
export function useStatIcons(): StatIconLookup {
	const lookup = getContext<StatIconLookup | undefined>(STAT_ICONS);
	if (lookup === undefined) throw new Error("Stat icon owner was not provided");
	return lookup;
}
/** Missing references stay visibly failed instead of becoming permanently loading artwork. */
export function failedStatIcon(detail: string): UiIconDisplay {
	return { kind: "failed", issues: [{ code: "preparation", detail }] };
}
