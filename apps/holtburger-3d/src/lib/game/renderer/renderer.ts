export interface FramePlan {}

export interface Renderer {
	drawFrame(plan: FramePlan): void;
	destroy(): Promise<void>;
}
