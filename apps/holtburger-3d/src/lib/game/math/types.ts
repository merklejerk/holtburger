export interface Vec2 {
	x: number;
	y: number;
}

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export interface Vec4 {
	x: number;
	y: number;
	z: number;
	w: number;
}

export interface Mat3 {
	m11: number;
	m12: number;
	m13: number;
	m21: number;
	m22: number;
	m23: number;
	m31: number;
	m32: number;
	m33: number;
}

export interface Mat4 {
	m11: number;
	m12: number;
	m13: number;
	m14: number;
	m21: number;
	m22: number;
	m23: number;
	m24: number;
	m31: number;
	m32: number;
	m33: number;
	m34: number;
	m41: number;
	m42: number;
	m43: number;
	m44: number;
}

export interface AABB3 {
	min: Vec3;
	max: Vec3;
}

export interface AABB2 {
	min: Vec2;
	max: Vec2;
}

export interface Quat {
	w: number;
	x: number;
	y: number;
	z: number;
}
