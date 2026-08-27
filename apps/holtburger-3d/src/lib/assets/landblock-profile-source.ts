import { z } from "zod";

import type { LandblockOwnerId } from "../game/game-types";
import { normalizeLandblockOwner } from "../game/landblocks";

/** Canonical scene-content classification projected by the host profile capability. */
const landblockSceneClassSchema = z.enum([
	"dungeon-only",
	"outdoor-only",
	"outdoor-with-env-cells",
]);
type LandblockSceneClass = z.infer<typeof landblockSceneClassSchema>;

/** Minimal static fact required to choose scene-interest coverage. */
export interface LandblockProfile {
	readonly landblockId: LandblockOwnerId;
	readonly sceneClass: LandblockSceneClass;
}

/** Host capability for one normalized landblock owner's shallow profile. */
export interface LandblockProfileSource {
	loadLandblockProfile(
		landblockId: LandblockOwnerId,
	): Promise<LandblockProfile | null>;
}

const profileSchema = z
	.object({
		landblockId: z.string().regex(/^(?:0x)?[0-9a-f]{8}$/i),
		sceneClass: landblockSceneClassSchema,
	})
	.strict();

/** Decode and validate one host response against the owner requested by the caller. */
export function decodeLandblockProfile(
	value: unknown,
	requestedLandblockId: LandblockOwnerId,
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
	return { landblockId: returned, sceneClass: parsed.sceneClass };
}

/** Cache completed profiles and share concurrent owner requests without caching failures. */
export class CachedLandblockProfileSource implements LandblockProfileSource {
	readonly #source: LandblockProfileSource;
	readonly #profiles = new Map<LandblockOwnerId, LandblockProfile | null>();
	readonly #pending = new Map<
		LandblockOwnerId,
		Promise<LandblockProfile | null>
	>();

	constructor(source: LandblockProfileSource) {
		this.#source = source;
	}

	loadLandblockProfile(
		landblockId: LandblockOwnerId,
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
	requested: LandblockOwnerId,
): LandblockProfile {
	const returned = normalizeLandblockOwner(profile.landblockId);
	if (returned !== requested) {
		throw new Error(
			`Landblock profile source returned ${returned} for requested owner ${requested}.`,
		);
	}
	return { ...profile, landblockId: returned };
}
