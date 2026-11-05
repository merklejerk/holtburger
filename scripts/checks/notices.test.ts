import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { sha256, writeJson } from "../io.ts";
import {
  checkNotices,
  inputDigest,
  INPUT_RECORD_PATH,
  NOTICE_PATH,
  renderNotices,
} from "./notices.ts";

/** Synthetic originals and complete generator inputs avoid installed-runtime dependencies. */
function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "holtburger-notice-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries({
    "Cargo.toml": '[workspace]\nmembers = ["member"]\n',
    "member/Cargo.toml": '[package]\nname = "member"\nversion = "1.0.0"\n',
    "Cargo.lock": "locked graph",
    "LICENSE.md": "project license",
    ".github/about.toml": "notice policy",
    "scripts/checks/notices.ts": "generator",
    "scripts/io.ts": "shared helpers",
    "scripts/filesystem.ts": "filesystem helpers",
    "package.json": "{}",
    "package-lock.json": "{}",
    ".github/licenses/native/LICENSE":
      "Copyright Native <authors>\nOriginal notice.\n",
    [NOTICE_PATH]: "generated notices",
  })) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  writeJson(join(root, ".github/native-notices.json"), {
    packages: { example: "1.0.0" },
    files: [
      {
        path: "licenses/native/LICENSE",
        component: "native-example",
        sourceUrl: "https://example.invalid/pinned/LICENSE",
        encoding: "utf-8",
        sha256: sha256(
          readFileSync(join(root, ".github/licenses/native/LICENSE")),
        ),
      },
    ],
  });
  writeJson(join(root, INPUT_RECORD_PATH), {
    inputsSha256: inputDigest(root),
    noticesSha256: sha256(readFileSync(join(root, NOTICE_PATH))),
  });
  return root;
}

/** Cargo-about report shape independent of renderer implementation. */
function report(text: string, name: string, version: string) {
  const crate = { name, version, authors: ["Published author"] };
  return {
    crates: [{ package: crate }],
    licenses: [{ name: "MIT", text, used_by: [{ crate }] }],
  };
}

test("original license text and appendix examples survive HTML escaping", (t) => {
  const root = fixture(t),
    manifest = join(root, ".github/native-notices.json");
  const text = "Copyright Original <author> & Company\n\nLicensed text.\n";
  const result = renderNotices(report(text, "example", "1.0.0"), manifest);
  assert.ok(
    result.includes(
      "Copyright Original &lt;author&gt; &amp; Company\n\nLicensed text.",
    ),
  );
  const appendix =
    "Original license text.\n".repeat(30) + "Copyright <year> <owner>";
  assert.ok(
    renderNotices(report(appendix, "example", "1.0.0"), manifest).includes(
      "Copyright &lt;year&gt; &lt;owner&gt;",
    ),
  );
  assert.throws(
    () =>
      renderNotices(
        report(
          "MIT\nCopyright (c) <year> <copyright holders>",
          "example",
          "1.0.0",
        ),
        manifest,
      ),
    /Unresolved template attribution/,
  );
});

test("metadata-only ICU qualification is explicit and native byte/version drift fails", (t) => {
  const root = fixture(t),
    manifest = join(root, ".github/native-notices.json");
  assert.throws(
    () =>
      renderNotices(report("Original license", "example", "2.0.0"), manifest),
    /Native notices need review/,
  );
  const native = JSON.parse(readFileSync(manifest, "utf8"));
  native.packages = { deno_core_icudata: "0.74.0" };
  writeJson(manifest, native);
  const result = renderNotices(
    report(
      "MIT\nCopyright (c) <year> <copyright holders>\nPermission text.",
      "deno_core_icudata",
      "0.74.0",
    ),
    manifest,
  );
  assert.ok(result.includes("no original standalone notice was supplied"));
  assert.ok(result.includes("Published author"));
  assert.ok(result.includes("Permission text."));
  assert.ok(!result.includes("&lt;year&gt;"));
  writeFileSync(join(root, ".github/licenses/native/LICENSE"), "substituted");
  assert.throws(
    () =>
      renderNotices(
        report("Original license", "deno_core_icudata", "0.74.0"),
        manifest,
      ),
    /digest\/contents mismatch/,
  );
});

test("notice receipts cover graph, policy, originals and real generator modules", (t) => {
  const root = fixture(t);
  checkNotices(root);
  for (const name of [
    "Cargo.toml",
    "Cargo.lock",
    "member/Cargo.toml",
    "LICENSE.md",
    ".github/about.toml",
    ".github/native-notices.json",
    "scripts/checks/notices.ts",
    "scripts/io.ts",
    "scripts/filesystem.ts",
    "package.json",
    "package-lock.json",
    ".github/licenses/native/LICENSE",
  ]) {
    const path = join(root, name),
      original = readFileSync(path, "utf8");
    writeFileSync(path, `${original}\n`);
    assert.throws(() => checkNotices(root), /Notice inputs changed/);
    writeFileSync(path, original);
  }
  writeFileSync(join(root, "member/lib.rs"), "fn changed_behavior() {}\n");
  checkNotices(root);
  writeFileSync(join(root, NOTICE_PATH), "substituted");
  assert.throws(() => checkNotices(root), /output differs/);
  rmSync(join(root, INPUT_RECORD_PATH));
  assert.throws(() => checkNotices(root), /Missing committed notices file/);
});
