import { createServer } from 'node:http';
import { commandLine, runCli } from './cli.mjs';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import sirv from 'sirv';

await runCli(
	commandLine('npm run preview:site --').command(
		'$0',
		'Serve the built website at its production URL prefix',
		(builder) =>
			builder
				.option('port', {
					type: 'number',
					default: 4178,
					describe: 'Local HTTP port (1–65535)'
				})
				.check((args) => {
					if (
						!Number.isInteger(args.port) ||
						args.port < 1 ||
						args.port > 65535
					)
						throw new Error('Port must be an integer from 1 to 65535');
					return true;
				}),
		async (args) => {
			await preview(args.port);
		}
	)
);

/** @param {number} port */
async function preview(port) {
	const root = fileURLToPath(new URL('../build/', import.meta.url));
	const serve = sirv(root, {
		dev: true
	});
	// Serve the actual adapter output at the same project prefix as GitHub Pages.
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		if (url.pathname === '/holtburger') {
			response.writeHead(308, { Location: '/holtburger/' });
			response.end();
			return;
		}
		if (!url.pathname.startsWith('/holtburger/')) {
			response.writeHead(404);
			response.end('Not found');
			return;
		}
		const pathname = url.pathname.slice('/holtburger'.length);
		// Directory redirects keep relative links correct, matching ordinary static hosting.
		if (
			!pathname.endsWith('/') &&
			statSync(join(root, pathname), { throwIfNoEntry: false })?.isDirectory()
		) {
			response.writeHead(308, { Location: `${url.pathname}/${url.search}` });
			response.end();
			return;
		}
		request.url = `${pathname}${url.search}`;
		serve(request, response, () => {
			response.writeHead(404);
			response.end('Not found');
		});
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => {
			console.log(`Site preview: http://127.0.0.1:${port}/holtburger/`);
			resolve(undefined);
		});
	});
}
