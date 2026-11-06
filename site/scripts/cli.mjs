import yargs from 'yargs';

/** Parse and validate before handlers touch disk, the network, or child processes.
 * @param {string} name */
export function commandLine(name) {
	return yargs(process.argv.slice(2))
		.scriptName(name)
		.strict()
		.version(false)
		.help()
		.showHelpOnFail(false)
		.parserConfiguration({ 'parse-positional-numbers': false })
		.wrap(100)
		.fail((message, error) => {
			throw new Error(message || error?.message || 'Invalid arguments');
		});
}

/** @param {unknown} value */
export function nonEmpty(value) {
	if (typeof value !== 'string')
		throw new Error('Path must be a single string');
	if (value.trim().length === 0) throw new Error('Path must not be empty');
	return value;
}

/** Report operation failures without a Node stack trace.
 * @param {import('yargs').Argv} parser */
export async function runCli(parser) {
	try {
		await parser.parseAsync();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
