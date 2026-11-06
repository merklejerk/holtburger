import { resolve } from "node:path";
import {
  commandLine,
  nonEmpty,
  requiredString,
  scalarChoice,
  runCli,
} from "../cli.ts";
import { ROOT, run } from "../io.ts";
import { github } from "../github.ts";
import { assemble, freezeManifest } from "./assembly.ts";
import { verifyBundle } from "./artifacts.ts";
import { PRODUCTS, TARGETS } from "./contracts.ts";
import { flatpakManifest, prepareFlatpak, recordFlatpak } from "./flatpak.ts";
import { prepareSource, sourceDistribution } from "./identity.ts";
import { planRelease } from "./publication.ts";
import { publishFrozenRelease } from "./publishing.ts";
import { distributionKind } from "./version.ts";

/** Normalize the selected payload once before assembly can read or write anything. */
function payload(
  product: "cli" | "3d",
  content: string | undefined,
  archive: string | undefined,
) {
  if (product === "cli") {
    if (archive !== undefined)
      throw new Error("--package is only valid for --product 3d");
    if (content === undefined)
      throw new Error("--product cli requires --content");
    return { product, content: resolve(content) };
  }
  if (content !== undefined)
    throw new Error("--content is only valid for --product cli");
  if (archive === undefined) throw new Error("--product 3d requires --package");
  return { product, package: resolve(archive) };
}

/** CLI contracts precede artifact policy and keep help free of release side effects. */
async function main(args: string[]): Promise<void> {
  const targets = TARGETS.map((target) => target.triple);
  await runCli(
    commandLine("npm run release --", args)
      .command(
        "plan",
        "Resolve release identity and build matrices",
        (builder) =>
          builder
            .option("purpose", {
              ...scalarChoice(["release", "nightly", "diagnostic"]),
              default: "release",
            })
            .option("product", {
              ...scalarChoice(["both", ...PRODUCTS]),
              default: "both",
            })
            .option("target", {
              ...scalarChoice(["all", ...targets]),
              default: "all",
            }),
        (args) => {
          planRelease(ROOT, args, process.env, github, run);
        },
      )
      .command(
        "prepare-source",
        "Stamp a disposable release source checkout",
        (builder) =>
          builder.option("kind", {
            ...scalarChoice(distributionKind.options),
            demandOption: true,
            describe: "Distribution kind",
          }),
        (args) => {
          prepareSource(ROOT, sourceDistribution(ROOT, args.kind));
        },
      )
      .command(
        "assemble",
        "Assemble a native distribution from validated inputs",
        (builder) =>
          builder
            .option("product", {
              ...scalarChoice(PRODUCTS),
              demandOption: true,
              describe: "Product to assemble",
            })
            .option("target", {
              ...scalarChoice(targets),
              demandOption: true,
              describe: "Native target triple",
            })
            .option("package", {
              type: "string",
              coerce: nonEmpty,
              describe: "Packaged Electron directory (3d only)",
            })
            .option("content", {
              type: "string",
              coerce: nonEmpty,
              describe: "Verified staged content directory (cli only)",
            })
            .option("notices", {
              ...requiredString,
              describe: "Third-party notice document",
            })
            .option("output", {
              ...requiredString,
              describe: "Artifact destination directory",
            }),
        async (args) => {
          const source = payload(args.product, args.content, args.package);
          await assemble(
            ROOT,
            {
              ...source,
              target: args.target,
              notices: resolve(args.notices),
              output: resolve(args.output),
            },
            process.env,
            run,
          );
        },
      )
      .command(
        "verify <bundle>",
        "Verify an unpacked native distribution",
        (builder) =>
          builder.positional("bundle", {
            ...requiredString,
            describe: "Unpacked bundle directory",
          }),
        (args) => {
          console.log(JSON.stringify(verifyBundle(resolve(args.bundle), ROOT)));
        },
      )
      .command(
        "manifest <artifacts>",
        "Freeze a complete artifact inventory",
        (builder) =>
          builder.positional("artifacts", {
            ...requiredString,
            describe: "Complete artifact directory",
          }),
        (args) => {
          freezeManifest(ROOT, resolve(args.artifacts), process.env);
        },
      )
      .command(
        "publish <artifacts> <tag>",
        "Publish the complete verified distribution to GitHub",
        (builder) =>
          builder
            .positional("artifacts", {
              ...requiredString,
              describe: "Complete artifact directory",
            })
            .positional("tag", {
              ...requiredString,
              describe: "Immutable release tag",
            }),
        (args) => {
          const frozen = freezeManifest(
            ROOT,
            resolve(args.artifacts),
            process.env,
          );
          publishFrozenRelease(ROOT, frozen, args.tag, github, run);
        },
      )
      .command(
        "flatpak-manifest",
        "Generate a Flatpak manifest from native metadata",
        (builder) =>
          builder
            .option("native", {
              ...requiredString,
              describe: "Native distribution metadata",
            })
            .option("output", {
              ...requiredString,
              describe: "Manifest output path",
            }),
        (args) => {
          flatpakManifest(
            ROOT,
            resolve(args.native),
            resolve(args.output),
            process.env,
            run,
          );
        },
      )
      .command(
        "prepare-flatpak",
        "Prepare a verified native archive for Flatpak",
        (builder) =>
          builder
            .option("product", {
              ...scalarChoice(PRODUCTS),
              demandOption: true,
              describe: "Product to prepare",
            })
            .option("artifacts", {
              ...requiredString,
              describe: "Native artifact directory",
            })
            .option("output", {
              ...requiredString,
              describe: "Manifest output path",
            }),
        async (args) => {
          console.log(
            await prepareFlatpak(
              ROOT,
              resolve(args.artifacts),
              args.product,
              resolve(args.output),
              process.env,
              run,
            ),
          );
        },
      )
      .command(
        "record-flatpak",
        "Record a verified Flatpak artifact",
        (builder) =>
          builder
            .option("files", {
              ...requiredString,
              describe: "Installed Flatpak files directory",
            })
            .option("native", {
              ...requiredString,
              describe: "Native metadata path",
            })
            .option("bundle", {
              ...requiredString,
              describe: "Built Flatpak bundle",
            })
            .option("output", {
              ...requiredString,
              describe: "Artifact receipt output path",
            }),
        (args) => {
          recordFlatpak(
            ROOT,
            resolve(args.files),
            resolve(args.native),
            resolve(args.bundle),
            resolve(args.output),
            process.env,
            run,
          );
        },
      )
      .demandCommand(1),
  );
}

if (import.meta.main) await main(process.argv.slice(2));
