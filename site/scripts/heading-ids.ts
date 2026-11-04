import type { Root } from 'mdast';
import { toString } from 'mdast-util-to-string';
import GithubSlugger from 'github-slugger';

/** HTML properties consumed by mdsvex's Markdown-to-HTML bridge. */
declare module 'mdast' {
	interface Data {
		hProperties?: Record<string, string>;
	}
}

/** Markdown compiler boundary: mdsvex's plugin types accept a generic AST. */
function isRoot(value: unknown): value is Root {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		value.type === 'root' &&
		'children' in value &&
		Array.isArray(value.children)
	);
}

/** Assign the same heading IDs used by the guide table of contents. */
export function headingIds() {
	return (tree: unknown) => {
		if (!isRoot(tree)) throw new Error('Heading IDs require a Markdown root');
		const slugger = new GithubSlugger();
		for (const node of tree.children) {
			if (node.type !== 'heading') continue;
			node.data = {
				...node.data,
				hProperties: {
					...node.data?.hProperties,
					id: slugger.slug(toString(node))
				}
			};
		}
	};
}
