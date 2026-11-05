import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { sha256, writeJson } from "../io.ts";
import {
  INSTALLER_TARGETS,
  installerFilename,
  manifestSchema,
  PRODUCTS,
  TARGETS,
} from "./contracts.ts";
import { distribution, git } from "./identity.ts";

/** Complete synthetic release spanning the runtime-defined products and target inventory. */
export function createManifestFixture(
  identity = distribution("release", "0.2.0", "a".repeat(40)),
) {
  const shared = {
    version: identity.version,
    channel: "beta",
    kind: identity.kind,
    commit: identity.commit,
    modified: false,
    noticesSha256: sha256(Buffer.from("notice bytes")),
  } as const;
  const content = {
    contentSha256: sha256(Buffer.from("content zip")),
    contentFiles: {
      "bootstrap.hba": sha256(Buffer.from("bootstrap")),
      "navigation.hnav": sha256(Buffer.from("navigation")),
    },
  };
  const native = PRODUCTS.flatMap((product) =>
    TARGETS.map((target) => ({
      ...shared,
      product,
      target: target.triple,
      ...(product === "cli" ? content : {}),
      archive: `holtburger-${product}-${shared.version}-${target.triple}${target.platform === "linux" ? ".tar.gz" : ".zip"}`,
      sha256: sha256(Buffer.from(`${product}/${target.triple}`)),
    })),
  );
  const flatpaks = PRODUCTS.map((product) => ({
    ...shared,
    product,
    target: "x86_64-unknown-linux-gnu",
    ...(product === "cli" ? content : {}),
    appId: `io.github.merklejerk.holtburger-${product}`,
    runtime: "org.freedesktop.Platform/x86_64/26.08",
    archive: `holtburger-${product}-${shared.version}-x86_64.flatpak`,
    sha256: sha256(Buffer.from(`flatpak/${product}`)),
  }));
  const installers = INSTALLER_TARGETS.map((target) => ({
    ...shared,
    product: "3d",
    target: target.triple,
    format: target.format,
    nativeArchiveSha256: sha256(Buffer.from(`3d/${target.triple}`)),
    installer: installerFilename(target, shared.version),
    sha256: sha256(Buffer.from(`installer/${target.triple}`)),
  }));
  const assets = [
    { name: "THIRD_PARTY_NOTICES.html", sha256: shared.noticesSha256 },
    ...native.map((record) => ({
      name: record.archive,
      sha256: record.sha256,
    })),
    ...flatpaks.map((record) => ({
      name: record.archive,
      sha256: record.sha256,
    })),
    ...installers.map((record) => ({
      name: record.installer,
      sha256: record.sha256,
    })),
  ];
  return manifestSchema.parse({
    ...shared,
    schemaVersion: 2,
    native,
    flatpaks,
    installers,
    assets,
  });
}

/** A real, isolated standalone suite, with npm/Cargo inputs requiring no registry. */
export function createSourceFixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "holtburger-identity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.name", "Release fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "member/src"), { recursive: true });
  mkdirSync(join(root, "apps/holtburger-3d"), { recursive: true });
  mkdirSync(join(root, "release"));
  writeFileSync(
    join(root, "release/RELEASE_NOTES.md"),
    "Previous release notes\n",
  );
  writeJson(join(root, "release/channel.json"), "beta");
  writeFileSync(
    join(root, "Cargo.toml"),
    '[workspace]\nmembers = ["member"]\n[workspace.package]\nversion = "0.2.0"\n',
  );
  writeFileSync(
    join(root, "member/Cargo.toml"),
    '[package]\nname = "fixture-member"\nversion.workspace = true\nedition = "2021"\n',
  );
  writeFileSync(
    join(root, "member/src/lib.rs"),
    "// Synthetic release fixture.\n",
  );
  writeFileSync(
    join(root, "Cargo.lock"),
    'version = 4\n[[package]]\nname = "fixture-member"\nversion = "0.2.0"\n',
  );
  writeJson(join(root, "package.json"), {
    name: "fixture-tools",
    private: true,
  });
  writeJson(join(root, "package-lock.json"), {
    name: "fixture-tools",
    lockfileVersion: 3,
    packages: {},
  });
  writeJson(join(root, "apps/holtburger-3d/package.json"), {
    name: "holtburger-3d",
    version: "0.2.0",
  });
  writeJson(join(root, "apps/holtburger-3d/package-lock.json"), {
    name: "holtburger-3d",
    version: "0.2.0",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "holtburger-3d", version: "0.2.0" } },
  });
  git(root, "add", ".");
  git(root, "commit", "-m", "Synthetic source");
  git(
    root,
    "update-ref",
    "refs/remotes/origin/main",
    git(root, "rev-parse", "HEAD"),
  );
  return root;
}
