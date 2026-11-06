import yargs, { type Argv } from "yargs";

/** Uniform CLI validation runs before command handlers perform I/O. */
export function commandLine(name: string, args = process.argv.slice(2)) {
  return yargs(args)
    .scriptName(name)
    .strict()
    .version(false)
    .help()
    .recommendCommands()
    .showHelpOnFail(false)
    .parserConfiguration({ "parse-positional-numbers": false })
    .wrap(100)
    .fail((message, error) => {
      throw new Error(message || error?.message || "Invalid arguments");
    });
}

/** Reject blank paths and identifiers instead of resolving them to the working directory. */
export function nonEmpty(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Argument must be a single string");
  if (value.trim().length === 0) throw new Error("Argument must not be empty");
  return value;
}

/** Preserve scalar choice types while rejecting repeated options before any handler runs. */
export function scalarChoice<const Choices extends readonly string[]>(
  choices: Choices,
) {
  return {
    type: "string",
    choices,
    coerce: (value: unknown): Choices[number] => {
      const text = nonEmpty(value);
      const selected = choices.find((choice) => choice === text);
      if (selected === undefined)
        throw new Error(`Expected one of: ${choices.join(", ")}`);
      return selected;
    },
  } as const;
}

/** Shared required path/identifier contract; each caller supplies its own description. */
export const requiredString = {
  type: "string",
  demandOption: true,
  coerce: nonEmpty,
} as const;

/** User-facing failures keep diagnostics concise and preserve a nonzero exit status. */
export async function runCli<T>(parser: Argv<T>): Promise<void> {
  try {
    await parser.parseAsync();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
