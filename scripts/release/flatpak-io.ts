import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ROOT, readJson, run, type Runner } from "../io.ts";
import { productSchema } from "./contracts.ts";

/** Authored palette in the checked-in minimal DAT; compare raw and converted exports. */
export const PALETTE_FIXTURE_ID = "0x04000001";
/** Electron v44's FileChooser implementation requires portal version 3. */
export const MIN_FILE_CHOOSER_PORTAL_VERSION = 3;

/** CLI tools use explicit read-only inputs and writable outputs without a graphical portal. */
export function probeCliTools(
  inputs: string,
  outputs: string,
  command: Runner,
): void {
  const app = "io.github.merklejerk.holtburger-cli",
    dat = join(inputs, "client_portal.dat"),
    converted = join(outputs, "converted.hba");
  const prefix = [
    "run",
    "--user",
    `--filesystem=${inputs}:ro`,
    `--filesystem=${outputs}:rw`,
  ];
  command(
    "flatpak",
    [
      ...prefix,
      "--command=sh",
      app,
      "-c",
      'test -r "$1/client_portal.dat" && test ! -w "$1/client_portal.dat" && test -w "$2"',
      "tool-grant-probe",
      inputs,
      outputs,
    ],
    ROOT,
  );
  command(
    "flatpak",
    [
      ...prefix,
      "--command=dat2hba",
      app,
      "--profile",
      "full",
      `eor/portal=${dat}`,
      converted,
    ],
    ROOT,
  );
  for (const [source, namespace, output] of [
    [dat, [], "source.palette"],
    [converted, ["--namespace", "eor/portal"], "converted.palette"],
  ] as const)
    command(
      "flatpak",
      [
        ...prefix,
        "--command=dat-tool",
        app,
        "export",
        source,
        PALETTE_FIXTURE_ID,
        ...namespace,
        "--output",
        join(outputs, output),
      ],
      ROOT,
    );
  if (
    !readFileSync(join(outputs, "source.palette")).equals(
      readFileSync(join(outputs, "converted.palette")),
    )
  )
    throw new Error(
      "Flatpak DAT conversion changed the authored palette bytes",
    );
  console.log(
    JSON.stringify({
      probe: "flatpak-cli-tool-io",
      inputReadOnly: true,
      explicitOutputGrant: true,
      conversionExportMatches: true,
    }),
  );
}

/** Always revoke the document grant after checking the 3D application's sandbox. */
export function probe3dPortal(
  root: string,
  inputs: string,
  command: Runner,
): void {
  const { id } = z
    .object({ id: z.string() })
    .parse(
      readJson(
        join(root, ".github/flatpak/io.github.merklejerk.holtburger-3d.json"),
      ),
    );
  const { data: version } = z
    .object({ data: z.number().int() })
    .parse(
      JSON.parse(
        command(
          "busctl",
          [
            "--user",
            "--json=short",
            "get-property",
            "org.freedesktop.portal.Desktop",
            "/org/freedesktop/portal/desktop",
            "org.freedesktop.portal.FileChooser",
            "version",
          ],
          root,
        ),
      ),
    );
  if (version < MIN_FILE_CHOOSER_PORTAL_VERSION)
    throw new Error(
      `FileChooser portal version ${version} is below Electron's required version`,
    );
  const portal = command(
    "flatpak",
    ["document-export", "--unique", "--allow-read", `--app=${id}`, inputs],
    root,
  ).trim();
  if (portal.length === 0)
    throw new Error("Document export returned no portal path");
  try {
    command(
      "flatpak",
      [
        "run",
        "--user",
        "--command=sh",
        id,
        "-c",
        'test ! -r "$1/client_portal.dat" && test -r "$2/client_portal.dat" && test ! -w "$2/client_portal.dat"',
        "portal-probe",
        inputs,
        portal,
      ],
      root,
    );
    console.log(
      JSON.stringify({
        probe: "flatpak-3d-portal-io",
        portalReadOnly: true,
        fileChooserVersion: version,
      }),
    );
  } finally {
    command(
      "flatpak",
      ["document-unexport", "--doc-id", basename(dirname(portal))],
      root,
    );
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { product: { type: "string" } } });
  const product = productSchema.parse(values.product),
    temporary = mkdtempSync(join(tmpdir(), "holtburger-flatpak-io-"));
  try {
    const inputs = join(temporary, "retail inputs 雪");
    mkdirSync(inputs);
    copyFileSync(
      join(ROOT, "scripts/fixtures/content/minimal-content.dat.fixture"),
      join(inputs, "client_portal.dat"),
    );
    if (product === "cli") {
      const outputs = join(temporary, "tool outputs");
      mkdirSync(outputs);
      probeCliTools(inputs, outputs, run);
    } else probe3dPortal(ROOT, inputs, run);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
