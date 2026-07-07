export function omitRenderGeometryVertexBuffers<
	TGeometry extends {
		readonly normals?: unknown;
		readonly positions?: unknown;
		readonly uvs?: unknown;
	},
>(geometry: TGeometry): Omit<TGeometry, "normals" | "positions" | "uvs"> {
	const metadata = { ...geometry } as Record<string, unknown>;
	delete metadata["normals"];
	delete metadata["positions"];
	delete metadata["uvs"];

	return metadata as Omit<TGeometry, "normals" | "positions" | "uvs">;
}
