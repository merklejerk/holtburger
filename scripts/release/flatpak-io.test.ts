import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT, type Runner } from "../io.ts";
import {
  MIN_FILE_CHOOSER_PORTAL_VERSION,
  PALETTE_FIXTURE_ID,
  probe3dPortal,
  probeCliTools,
} from "./flatpak-io.ts";

test("CLI Flatpak conversion/export uses its own explicit grants and compares actual palette bytes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "holtburger-flatpak-probe-")),
    inputs = join(root, "retail inputs 雪"),
    outputs = join(root, "tool outputs");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(inputs);
  mkdirSync(outputs);
  const calls: string[][] = [];
  const command: Runner = (program, args) => {
    assert.equal(program, "flatpak");
    assert.ok(args.includes("io.github.merklejerk.holtburger-cli"));
    assert.ok(args.includes(`--filesystem=${inputs}:ro`));
    assert.ok(args.includes(`--filesystem=${outputs}:rw`));
    calls.push([...args]);
    if (args.includes("export")) {
      assert.ok(args.includes(PALETTE_FIXTURE_ID));
      const index = args.indexOf("--output");
      writeFileSync(args[index + 1], "authored palette bytes");
    }
    return "";
  };
  probeCliTools(inputs, outputs, command);
  assert.equal(calls.length, 4);
  assert.ok(calls[1].includes("--command=dat2hba"));
  assert.ok(calls[3].includes("eor/portal"));
  assert.ok(existsSync(join(outputs, "converted.palette")));
  const changed: Runner = (program, args, cwd) => {
    const result = command(program, args, cwd);
    if (args.includes("--namespace"))
      writeFileSync(join(outputs, "converted.palette"), "changed bytes");
    return result;
  };
  assert.throws(
    () => probeCliTools(inputs, outputs, changed),
    /changed the authored palette/,
  );
});

test("3D document grant checks the app sandbox and is revoked even when its probe fails", () => {
  for (const failure of [false, true]) {
    const calls: string[][] = [];
    const command: Runner = (program, args) => {
      calls.push([program, ...args]);
      if (program === "busctl")
        return JSON.stringify({ data: MIN_FILE_CHOOSER_PORTAL_VERSION });
      if (args[0] === "document-export")
        return "/run/user/1000/doc/document-id/retail inputs 雪";
      if (args[0] === "run" && failure) throw new Error("sandbox failure");
      return "";
    };
    if (failure)
      assert.throws(
        () => probe3dPortal(ROOT, "/retail inputs 雪", command),
        /sandbox failure/,
      );
    else probe3dPortal(ROOT, "/retail inputs 雪", command);
    assert.deepEqual(calls.at(-1), [
      "flatpak",
      "document-unexport",
      "--doc-id",
      "document-id",
    ]);
    assert.ok(calls[2].includes("io.github.merklejerk.holtburger-3d"));
    assert.ok(
      calls[2].some((arg) => arg.includes('test ! -r "$1/client_portal.dat"')),
    );
  }
  let exports = 0;
  assert.throws(
    () =>
      probe3dPortal(ROOT, "/inputs", (program) => {
        if (program !== "busctl") exports++;
        return JSON.stringify({ data: MIN_FILE_CHOOSER_PORTAL_VERSION - 1 });
      }),
    /below Electron/,
  );
  assert.equal(exports, 0);
});
