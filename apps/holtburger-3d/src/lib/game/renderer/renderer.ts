export type RenderResourceKey = `render-resource:${string}`;

export interface FramePlan {}

export interface Renderer {
	drawFrame(plan: FramePlan): void;
}
