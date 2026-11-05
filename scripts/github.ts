import { ROOT, runBytes } from "./io.ts";

/** Authenticated requests and public release links are confined to this repository. */
export const REPOSITORY = "merklejerk/holtburger";
/** Native GitHub CLI owns tokens and signed-download redirects. */
export type GitHub = (args: readonly string[]) => Buffer;
/** Preserve the existing one-minute API request bound. */
const requestTimeoutMs = 60_000;

/** Production API adapter; tests inject responses instead of accessing releases. */
export const github: GitHub = (args) => {
  const endpoint = args[0];
  if (
    endpoint === undefined ||
    !(
      endpoint.startsWith(`repos/${REPOSITORY}/`) ||
      endpoint.startsWith(`https://api.github.com/repos/${REPOSITORY}/`)
    )
  )
    throw new Error("GitHub request must address this repository");
  return runBytes("gh", ["api", ...args], ROOT, requestTimeoutMs);
};
