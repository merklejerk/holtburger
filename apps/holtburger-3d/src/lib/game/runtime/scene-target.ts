import type { LandblockProfileSource } from "../../assets/landblock-profile-source";
import type { EnvCellId, LandblockId } from "../game-types";
import {
	getLandblockCoordinates,
	normalizeLandblockOwner,
} from "../landblocks";
import type { SceneInterestRadii } from "./types";
import type { SceneInterestRequest } from "./scene-interest";

/** User or server intent preserved until the profile policy has classified it. */
export type SceneInterestTarget =
	| {
			readonly kind: "automatic-landblock";
			readonly landblockId: LandblockId;
	  }
	| {
			readonly kind: "outdoor";
			readonly landblockId: LandblockId;
	  }
	| {
			readonly kind: "env-cell";
			readonly landblockId: LandblockId;
			readonly envCellId: EnvCellId;
	  };

/** Targets whose owner profile determines whether the request is dungeon-only. */
type ClassifiableSceneInterestTarget = Exclude<
	SceneInterestTarget,
	{ readonly kind: "outdoor" }
>;

/** One target after the static owner profile has selected the runtime policy branch. */
export type ResolvedSceneInterestTarget =
	| {
			readonly kind: "outdoor";
			readonly requested: SceneInterestTarget;
	  }
	| {
			readonly kind: "dungeon";
			readonly requested: ClassifiableSceneInterestTarget;
	  };

/** A typed missing-profile failure that callers can surface as unavailable target content. */
export class SceneInterestTargetUnavailableError extends Error {
	readonly landblockId: LandblockId;

	constructor(landblockId: LandblockId) {
		super(`No landblock profile is available for ${landblockId}.`);
		this.name = "SceneInterestTargetUnavailableError";
		this.landblockId = landblockId;
	}
}

/** Enumerate the owner identities that can receive ambient EnvCell demand for one outdoor request. */
export function enumerateAmbientEnvCellOwners(
	target: SceneInterestTarget,
	radii: SceneInterestRadii,
): readonly LandblockId[] {
	if (radii.envCellRadius === null) return [];
	const anchor = getLandblockCoordinates(
		normalizeLandblockOwner(target.landblockId),
	);
	const owners: LandblockId[] = [];
	for (
		let y = anchor.y - radii.envCellRadius;
		y <= anchor.y + radii.envCellRadius;
		y += 1
	) {
		for (
			let x = anchor.x - radii.envCellRadius;
			x <= anchor.x + radii.envCellRadius;
			x += 1
		) {
			if (x < 0 || x > 0xff || y < 0 || y > 0xff) continue;
			owners.push(
				`0x${x.toString(16).padStart(2, "0")}${y
					.toString(16)
					.padStart(2, "0")}ffff`,
			);
		}
	}
	return owners;
}

/** Resolve explicit intent through the one shared profile policy. */
export async function resolveSceneInterestTarget(
	target: SceneInterestTarget,
	profileSource: LandblockProfileSource,
): Promise<ResolvedSceneInterestTarget> {
	if (target.kind === "outdoor") {
		return { kind: "outdoor", requested: target };
	}
	const profile = await profileSource.loadLandblockProfile(target.landblockId);
	if (profile === null) {
		throw new SceneInterestTargetUnavailableError(target.landblockId);
	}
	return profile.traversalClass === "dungeon-only"
		? { kind: "dungeon", requested: target }
		: { kind: "outdoor", requested: target };
}

/** Resolve target policy and ambient outdoor EnvCell eligibility as one currentness unit. */
export async function resolveSceneInterestRequest(
	target: SceneInterestTarget,
	radii: SceneInterestRadii,
	profileSource: LandblockProfileSource,
): Promise<SceneInterestRequest> {
	const resolvedTarget = await resolveSceneInterestTarget(
		target,
		profileSource,
	);
	if (resolvedTarget.kind === "dungeon") {
		return {
			ambientOutdoorEnvCellOwners: new Set(),
			radii,
			target: resolvedTarget,
		};
	}

	const owners = enumerateAmbientEnvCellOwners(target, radii);
	const profiles = await Promise.all(
		owners.map(async (landblockId) => ({
			landblockId,
			profile: await profileSource.loadLandblockProfile(landblockId),
		})),
	);
	const ambientOutdoorEnvCellOwners = new Set(
		profiles
			.filter(({ profile }) => profile?.traversalClass === "outdoor-or-mixed")
			.map(({ landblockId }) => landblockId),
	);
	return {
		ambientOutdoorEnvCellOwners,
		radii,
		target: resolvedTarget,
	};
}

/** Monotonic asynchronous scene-interest requests shared by frontend runtimes. */
export class SceneInterestRequestCoordinator {
	readonly #profileSource: LandblockProfileSource;
	#revision = 0;

	constructor(profileSource: LandblockProfileSource) {
		this.#profileSource = profileSource;
	}

	/** Start one complete scene-interest resolution and return its revision for currentness checks. */
	request(
		target: SceneInterestTarget,
		radii: SceneInterestRadii,
	): {
		readonly revision: number;
		readonly promise: Promise<SceneInterestRequest>;
	} {
		const revision = ++this.#revision;
		return {
			promise: resolveSceneInterestRequest(target, radii, this.#profileSource),
			revision,
		};
	}

	/** Whether a resolved target may still mutate the owning frontend runtime. */
	isCurrent(revision: number): boolean {
		return revision === this.#revision;
	}

	/** Invalidate outstanding profile work during frontend teardown. */
	destroy(): void {
		this.#revision += 1;
	}
}
