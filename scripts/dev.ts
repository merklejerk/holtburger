import { join } from "node:path";
import { constants } from "node:os";
import spawn from "cross-spawn";
import type { Argv } from "yargs";
import { commandLine, nonEmpty, runCli } from "./cli.ts";
import { ROOT } from "./io.ts";

/** Preserve terminal I/O, child exit status, and termination signals across platforms. */
async function launch(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const child = spawn(command, args, {
    cwd: process.env.INIT_CWD ?? process.cwd(),
    env,
    stdio: "inherit",
  });
  const interrupt = () => {
    child.kill("SIGINT");
  };
  const terminate = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal !== null) {
          process.exitCode = 128 + constants.signals[signal];
        } else {
          process.exitCode = code ?? 1;
        }
        resolve();
      });
    });
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

/** Development defaults preserve explicit environment values, including invalid empty values. */
function cliEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOLTBURGER_DEFAULT_CONTENT:
      process.env.HOLTBURGER_DEFAULT_CONTENT ?? join(ROOT, "local/content"),
    SCRIPT_DIR: process.env.SCRIPT_DIR ?? join(ROOT, "local/scripts"),
    SCRIPT_BUNDLE_DIR:
      process.env.SCRIPT_BUNDLE_DIR ??
      join(ROOT, "apps/holtburger-cli/scripts"),
  };
}

await runCli(
  commandLine("npm run dev:<app> --")
    .parserConfiguration({
      "unknown-options-as-args": true,
      "populate--": true,
    })
    .command(
      "cli [args..]",
      "Build and launch the terminal client",
      (builder) =>
        builder
          .option("release", {
            type: "boolean",
            default: false,
            describe: "Use an optimized Rust build",
          })
          .positional("args", {
            type: "string",
            array: true,
            default: [],
            describe: "Arguments forwarded unchanged to the TUI",
          }),
      async (args) => {
        await launch(
          "cargo",
          [
            "run",
            ...(args.release ? ["--release"] : []),
            "--manifest-path",
            join(ROOT, "Cargo.toml"),
            "-p",
            "holtburger-cli",
            "--bin",
            "tui",
            "--",
            ...args.args,
            ...forwarded(args["--"]),
          ],
          cliEnvironment(),
        );
      },
    )
    .command(
      "tool <binary> [args..]",
      "Build and run a repository CLI tool",
      (builder) =>
        builder
          .positional("binary", {
            type: "string",
            coerce: nonEmpty,
            describe: "Binary name from the holtburger-tools Cargo package",
            demandOption: true,
          })
          .option("release", {
            type: "boolean",
            default: false,
            describe: "Use an optimized Rust build",
          })
          .positional("args", {
            type: "string",
            array: true,
            default: [],
            describe: "Arguments forwarded unchanged to the tool",
          }),
      async (args) => {
        await launch(
          "cargo",
          [
            "run",
            ...(args.release ? ["--release"] : []),
            "--manifest-path",
            join(ROOT, "Cargo.toml"),
            "-p",
            "holtburger-tools",
            "--bin",
            args.binary,
            "--",
            ...args.args,
            ...forwarded(args["--"]),
          ],
          process.env,
        );
      },
    )
    .command(
      "client [args..]",
      "Build and launch the 3D client",
      electronOptions,
      async (args) => {
        await launchElectron("client", args.release, [
          ...args.args,
          ...forwarded(args["--"]),
        ]);
      },
    )
    .command(
      "explorer [args..]",
      "Build and launch the offline 3D explorer",
      electronOptions,
      async (args) => {
        await launchElectron("explorer", args.release, [
          ...args.args,
          ...forwarded(args["--"]),
        ]);
      },
    )
    .command(
      "site [args..]",
      "Start the website development server",
      (builder) =>
        builder.positional("args", {
          type: "string",
          array: true,
          default: [],
          describe: "Vite development-server arguments",
        }),
      async (args) => {
        await launch(
          "npm",
          [
            "--prefix",
            join(ROOT, "site"),
            "run",
            "dev",
            "--",
            ...args.args,
            ...forwarded(args["--"]),
          ],
          process.env,
        );
      },
    )
    .demandCommand(1)
    .epilog(
      "Application arguments are forwarded unchanged. Use an extra -- to forward --help to the application.",
    ),
);

/** yargs reserves the explicit -- tail for arguments belonging to the child process. */
function forwarded(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((part: unknown) => typeof part === "string")
  )
    throw new Error("Forwarded arguments must be strings");
  return value;
}

/** Both Electron modes use the same host optimization and argument-forwarding contract. */
function electronOptions(builder: Argv) {
  return builder
    .option("release", {
      type: "boolean",
      default: false,
      describe: "Use an optimized Rust host",
    })
    .positional("args", {
      type: "string",
      array: true,
      default: [],
      describe: "Client or renderer launch arguments",
    });
}

/** Mode-specific process assembly stays in the app package. */
async function launchElectron(
  mode: "client" | "explorer",
  release: boolean,
  args: string[],
): Promise<void> {
  await launch(
    "npm",
    [
      "--prefix",
      join(ROOT, "apps/holtburger-3d"),
      "run",
      `dev:${mode}${release ? ":release" : ""}`,
      "--",
      ...args,
    ],
    process.env,
  );
}
