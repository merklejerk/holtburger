import { commandLine, runCli } from './cli.mjs';
import { catalogFiles } from './media-catalog.mjs';

await runCli(
	commandLine('npm run check:site:media --').command(
		'$0',
		'Validate media catalog references',
		(builder) =>
			builder.option('remote', {
				type: 'boolean',
				default: false,
				describe: 'Check published media URLs and MIME types over the network'
			}),
		async (args) => {
			await checkMedia(args.remote);
		}
	)
);

/** @param {boolean} remote */
async function checkMedia(remote) {
	const files = await catalogFiles();
	if (remote) {
		for (const file of files) {
			const response = await fetch(file.url, {
				method: 'HEAD',
				signal: AbortSignal.timeout(15000)
			});
			if (!response.ok)
				throw new Error(`Media HTTP ${response.status}: ${file.url}`);
			if (!response.headers.get('content-type')?.startsWith(file.contentType))
				throw new Error(`Unexpected media Content-Type: ${file.url}`);
		}
	}
	console.log(
		`Media catalog valid; ${files.length} remote references${remote ? ' checked' : ''}`
	);
}
