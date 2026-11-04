import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import sirv from 'sirv';

const { values } = parseArgs({
	options: { port: { type: 'string', default: '4178' } }
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535)
	throw new Error('Port must be an integer from 1 to 65535');
const root = fileURLToPath(new URL('../build/', import.meta.url));
const serve = sirv(root, {
	dev: true
});
// Serve the actual adapter output at the same project prefix as GitHub Pages.
createServer((request, response) => {
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
}).listen(port, '127.0.0.1', () =>
	console.log(`Site preview: http://127.0.0.1:${port}/holtburger/`)
);
