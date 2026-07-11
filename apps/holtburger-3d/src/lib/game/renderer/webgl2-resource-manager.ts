import type { RendererResourceManager } from "./resource-manager";

export class WebGL2ResourceManager implements RendererResourceManager {
	protected constructor() {}

	static async build(): Promise<WebGL2ResourceManager> {
		return new WebGL2ResourceManager();
	}
}
