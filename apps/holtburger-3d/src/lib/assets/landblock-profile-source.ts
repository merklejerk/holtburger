import { z } from "zod";

import type { LandblockId } from "../game/game-types";
import { normalizeLandblockOwner } from "../game/landblocks";

/** Canonical content classification projected by the host profile capability. */
const landblockTraversalClassSchema = z.enum([
	"dungeon-only",
	"outdoor-or-mixed",
]);
type LandblockTraversalClass = z.infer<typeof landblockTraversalClassSchema>;

/** Minimal static fact required to choose scene-interest coverage. */
export interface LandblockProfile {
	readonly landblockId: LandblockId;
	readonly traversalClass: LandblockTraversalClass;
}

/** Host capability for one normalized landblock owner's shallow profile. */
export interface LandblockProfileSource {
	loadLandblockProfile(
		landblockId: LandblockId,
	): Promise<LandblockProfile | null>;
}

const profileSchema = z
	.object({
		landblockId: z.string().regex(/^(?:0x)?[0-9a-f]{8}$/i),
		traversalClass: landblockTraversalClassSchema,
	})
	.strict();

/** Decode and validate one host response against the owner requested by the caller. */
export function decodeLandblockProfile(
	value: unknown,
	requestedLandblockId: LandblockId,
): LandblockProfile | null {
	const requested = normalizeLandblockOwner(requestedLandblockId);
	const parsed = profileSchema.nullable().parse(value);
	if (parsed === null) return null;
	const returned = normalizeLandblockOwner(parsed.landblockId);
	if (returned !== requested) {
		throw new Error(
			`Landblock profile returned ${returned} for requested owner ${requested}.`,
		);
	}
	return { landblockId: returned, traversalClass: parsed.traversalClass };
}

/** Cache completed profiles and share concurrent owner requests without caching failures. */
export class CachedLandblockProfileSource implements LandblockProfileSource {
	readonly #source: LandblockProfileSource;
	readonly #profiles = new Map<LandblockId, LandblockProfile | null>();
	readonly #pending = new Map<LandblockId, Promise<LandblockProfile | null>>();

	constructor(source: LandblockProfileSource) {
		this.#source = source;
	}

	loadLandblockProfile(
		landblockId: LandblockId,
	): Promise<LandblockProfile | null> {
		const owner = normalizeLandblockOwner(landblockId);
		const cached = this.#profiles.get(owner);
		if (cached !== undefined) return Promise.resolve(cached);
		const pending = this.#pending.get(owner);
		if (pending) return pending;

		const request = this.#source
			.loadLandblockProfile(owner)
			.then((profile) => {
				const normalizedProfile =
					profile === null ? null : normalizeProfileOwner(profile, owner);
				this.#profiles.set(owner, normalizedProfile);
				return normalizedProfile;
			})
			.finally(() => {
				this.#pending.delete(owner);
			});
		this.#pending.set(owner, request);
		return request;
	}

	/** Clear completed and in-flight state with the owning frontend runtime. */
	destroy(): void {
		this.#profiles.clear();
		this.#pending.clear();
	}
}

function normalizeProfileOwner(
	profile: LandblockProfile,
	requested: LandblockId,
): LandblockProfile {
	const returned = normalizeLandblockOwner(profile.landblockId);
	if (returned !== requested) {
		throw new Error(
			`Landblock profile source returned ${returned} for requested owner ${requested}.`,
		);
	}
	return { ...profile, landblockId: returned };
}
