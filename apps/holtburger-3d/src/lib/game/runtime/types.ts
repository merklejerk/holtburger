import type { Quat, Vec3 } from "../math/types";

export interface LoDConfig {
	landblockRadius: number;
	buildingRadius: number;
	explicitObjectRadius: number;
	generatedObjectRadius: number;
	envCellRadius: number;
}

export interface Camera {
	fov: number;
	position: Vec3;
	rotation: Quat;
	near: number;
	far: number;
}
