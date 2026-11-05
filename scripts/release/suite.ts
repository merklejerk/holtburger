import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { z } from "zod";
import { ROOT, run } from "../io.ts";
import { github } from "../github.ts";
import { assemble, freezeManifest } from "./assembly.ts";
import { verifyBundle } from "./artifacts.ts";
import { productSchema } from "./contracts.ts";
import { flatpakManifest, prepareFlatpak, recordFlatpak } from "./flatpak.ts";
import { prepareSource, sourceDistribution } from "./identity.ts";
import { planRelease } from "./publication.ts";
import { publishFrozenRelease } from "./publishing.ts";
import { distributionKind } from "./version.ts";

/** Required paths are resolved at the CLI boundary before entering release operations. */
function path(value: string | undefined): string {
  return resolve(z.string().min(1).parse(value));
}

/** Explicit command contracts keep orchestration separate from artifact policy. */
export async function main(args: readonly string[]): Promise<void> {
  const [command, ...rest] = args;
  switch (command) {
    case "plan": {
      const { values } = parseArgs({
        args: rest,
        options: {
          purpose: { type: "string", default: "release" },
          product: { type: "string", default: "both" },
          target: { type: "string", default: "all" },
        },
      });
      planRelease(ROOT, values, process.env, github, run);
      break;
    }
    case "prepare-source": {
      const { values } = parseArgs({
        args: rest,
        options: { kind: { type: "string" } },
      });
      prepareSource(
        ROOT,
        sourceDistribution(ROOT, distributionKind.parse(values.kind)),
      );
      break;
    }
    case "assemble": {
      const { values } = parseArgs({
        args: rest,
        options: {
          product: { type: "string" },
          target: { type: "string" },
          package: { type: "string" },
          content: { type: "string" },
          notices: { type: "string" },
          output: { type: "string" },
        },
      });
      const common = {
        target: z.string().parse(values.target),
        notices: path(values.notices),
        output: path(values.output),
      };
      const product = productSchema.parse(values.product);
      if (
        (product === "cli" && values.package !== undefined) ||
        (product === "3d" && values.content !== undefined)
      )
        throw new Error("Supply only the selected product's payload source");
      await assemble(
        ROOT,
        product === "cli"
          ? { ...common, product, content: path(values.content) }
          : { ...common, product, package: path(values.package) },
        process.env,
        run,
      );
      break;
    }
    case "verify": {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const [bundle] = z.tuple([z.string()]).parse(positionals);
      console.log(JSON.stringify(verifyBundle(path(bundle), ROOT)));
      break;
    }
    case "manifest": {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const [artifacts] = z.tuple([z.string()]).parse(positionals);
      freezeManifest(ROOT, path(artifacts), process.env);
      break;
    }
    case "publish": {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const [artifacts, tag] = z
        .tuple([z.string(), z.string()])
        .parse(positionals);
      const frozen = freezeManifest(ROOT, path(artifacts), process.env);
      publishFrozenRelease(ROOT, frozen, tag, github, run);
      break;
    }
    case "flatpak-manifest": {
      const { values } = parseArgs({
        args: rest,
        options: { native: { type: "string" }, output: { type: "string" } },
      });
      flatpakManifest(
        ROOT,
        path(values.native),
        path(values.output),
        process.env,
        run,
      );
      break;
    }
    case "prepare-flatpak": {
      const { values } = parseArgs({
        args: rest,
        options: {
          product: { type: "string" },
          artifacts: { type: "string" },
          output: { type: "string" },
        },
      });
      console.log(
        await prepareFlatpak(
          ROOT,
          path(values.artifacts),
          productSchema.parse(values.product),
          path(values.output),
          process.env,
          run,
        ),
      );
      break;
    }
    case "record-flatpak": {
      const { values } = parseArgs({
        args: rest,
        options: {
          files: { type: "string" },
          native: { type: "string" },
          bundle: { type: "string" },
          output: { type: "string" },
        },
      });
      recordFlatpak(
        ROOT,
        path(values.files),
        path(values.native),
        path(values.bundle),
        path(values.output),
        process.env,
        run,
      );
      break;
    }
    default:
      throw new Error(
        "Expected plan, prepare-source, assemble, verify, manifest, publish, flatpak-manifest, prepare-flatpak or record-flatpak",
      );
  }
}

if (import.meta.main) await main(process.argv.slice(2));
