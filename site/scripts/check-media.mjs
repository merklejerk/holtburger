import { parseArgs } from 'node:util';
import { catalogFiles } from './media-catalog.mjs';

const { values } = parseArgs({
	options: { remote: { type: 'boolean' } }
});
const files = await catalogFiles();
if (values.remote) {
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
	`Media catalog valid; ${files.length} remote references${values.remote ? ' checked' : ''}`
);
