import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ROOT } from "../io.ts";
import { invokeInstaller } from "./installers.ts";

test("installer orchestration calls the app package with admitted paths and native compiler arguments", () => {
  const native = resolve("native payload with spaces"),
    output = resolve("installer output/setup.exe");
  for (const compiler of [undefined, "Compiler with spaces/ISCC.exe"]) {
    const calls: unknown[] = [];
    invokeInstaller(ROOT, native, output, compiler, (program, args, cwd) => {
      calls.push({ program, args, cwd });
      return "";
    });
    assert.deepEqual(calls, [
      {
        program: "npm",
        args: [
          "run",
          "--silent",
          "package:installer",
          "--",
          "--native",
          native,
          "--output",
          output,
          ...(compiler === undefined ? [] : ["--iscc", resolve(compiler)]),
        ],
        cwd: join(ROOT, "apps/holtburger-3d"),
      },
    ]);
  }
  assert.throws(
    () =>
      invokeInstaller(ROOT, native, output, undefined, () => {
        throw new Error("app installer failed");
      }),
    /app installer failed/,
  );
});
