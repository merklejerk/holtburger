import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';

const { values } = parseArgs({
	options: { port: { type: 'string', default: '4178' } }
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535)
	throw new Error('Port must be an integer from 1 to 65535');
const serve = sirv(fileURLToPath(new URL('../build/', import.meta.url)), {
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
	request.url = `${url.pathname.slice('/holtburger'.length)}${url.search}`;
	serve(request, response, () => {
		response.writeHead(404);
		response.end('Not found');
	});
}).listen(port, '127.0.0.1', () =>
	console.log(`Site preview: http://127.0.0.1:${port}/holtburger/`)
);
