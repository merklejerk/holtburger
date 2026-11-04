import type { Component } from 'svelte';

declare module '*.md' {
	const content: Component;
	export default content;
	export const metadata: {
		title: string;
		description: string;
		section: string;
	};
}
