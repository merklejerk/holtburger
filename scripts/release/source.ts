import { z } from "zod";
import {
  distribution,
  git,
  sourceDistribution,
  validatePreparedSource,
  type Distribution,
} from "./identity.ts";
import { checkVersions, distributionKind } from "./version.ts";

/** Immutable distribution plus the working-tree state used by all assembly stages. */
export interface SourceFacts {
  /** Effective source identity for this build's distribution kind. */
  readonly identity: Distribution;
  /** Local dirty builds may be inspected but cannot be published. */
  readonly modified: boolean;
}

/** Build-kind default is the established ordinary/local-release contract. */
export function currentKind(
  env: Readonly<NodeJS.ProcessEnv>,
): Distribution["kind"] {
  return distributionKind.parse(env.HOLTBURGER_DISTRIBUTION ?? "release");
}

/** Bind supplied build metadata to actual Git state and verified nightly preparation. */
export function sourceFacts(
  root: string,
  env: Readonly<NodeJS.ProcessEnv>,
): SourceFacts {
  const commit = git(root, "rev-parse", "HEAD");
  if (
    env.HOLTBURGER_SOURCE_REVISION !== undefined &&
    env.HOLTBURGER_SOURCE_REVISION !== commit
  )
    throw new Error("Source revision does not match the checked-out commit");
  const kind = currentKind(env);
  if (kind === "nightly") {
    const identity = sourceDistribution(root, kind);
    validatePreparedSource(root, identity);
    return { identity, modified: false };
  }
  const modified = z
    .enum(["0", "1"])
    .optional()
    .parse(env.HOLTBURGER_SOURCE_MODIFIED);
  return {
    identity: distribution(kind, checkVersions(root), commit),
    modified:
      modified === "1" ||
      git(root, "status", "--porcelain", "--ignore-submodules=none").length !==
        0,
  };
}
