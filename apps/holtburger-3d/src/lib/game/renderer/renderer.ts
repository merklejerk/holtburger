export type RenderResourceKey = `render-resource:${string}`;

export interface Renderer {
	drawFrame(): void;
	destroy(): void;
}
