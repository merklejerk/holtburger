#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { commandLine, runCli } from "../cli.ts";
import { Icns, IcnsImage } from "@fiahfy/icns";
import { Ico, IcoImage } from "@fiahfy/ico";
import sharp from "sharp";

const repository = new URL("../../", import.meta.url);
await runCli(
  commandLine("npm run generate:branding --").command(
    "$0",
    "Generate or verify checked-in branding assets",
    (builder) =>
      builder.option("check", {
        type: "boolean",
        default: false,
        describe: "Verify assets without writing files",
      }),
    async (args) => {
      await generate(args.check);
    },
  ),
);

/** The same deterministic rendering owns generation and verification. */
async function generate(check: boolean): Promise<void> {
  const source = await readFile(
    new URL("assets/branding/portal-source.png", repository),
  );

  // Sharp premultiplies alpha during resizing so transparent pixels cannot bleed
  // color into the edge. Resize every output directly from the original artwork.
  const resize = (size: number) =>
    sharp(source).resize(size, size, { kernel: sharp.kernel.lanczos3 });
  const render = (size: number) =>
    resize(size).png({ compressionLevel: 9 }).toBuffer();
  const [docsIcon, appIcon, favicon] = await Promise.all(
    [192, 512, 64].map(render),
  );

  // The encoders only package images; all native sizes use the same alpha-aware
  // Lanczos reduction as the standalone PNGs, without a second resizing step.
  const ico = new Ico();
  for (const size of [256, 128, 64, 48, 32, 24, 16]) {
    ico.append(IcoImage.fromPNG(await render(size)));
  }
  const icns = new Icns();
  for (const [type, size] of [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
    ["ic11", 32],
    ["ic12", 64],
    ["ic13", 256],
    ["ic14", 512],
  ] as const) {
    // Only macOS gets an opaque charcoal background; other exports retain alpha.
    const image = await resize(size)
      .flatten({ background: "#202024" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    icns.append(IcnsImage.fromPNG(image, type));
  }

  const outputs = new Map([
    ["assets/branding/portal-docs.png", docsIcon],
    ["assets/branding/icon.png", appIcon],
    ["assets/branding/favicon.png", favicon],
    ["assets/branding/icon.ico", ico.data],
    ["assets/branding/icon.icns", icns.data],
    ["apps/holtburger-3d/public/favicon.png", favicon],
    [
      "apps/holtburger-cli/dist/io.github.merklejerk.holtburger-cli.png",
      appIcon,
    ],
  ]);
  for (const [path, expected] of outputs) {
    const destination = new URL(path, repository);
    if (check) {
      const actual = await readFile(destination);
      if (!actual.equals(expected))
        throw new Error(
          `${path} is stale. Run npm run generate:branding at the repository root.`,
        );
    } else {
      await writeFile(destination, expected);
    }
    console.log(
      `${check ? "Verified" : "Generated"} ${fileURLToPath(destination)}`,
    );
  }
}
