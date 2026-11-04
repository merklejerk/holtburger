/**
 * Numeric fields stay type-only until their constructors assign the first values.
 * Preinitializing them to undefined makes in-place arithmetic allocate in Electron.
 * Keep these assignments explicit so caller-owned output objects remain effective.
 */
export class Vec2 {
	declare x: number;
	declare y: number;

	constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
	}
	static zero(): Vec2 {
		return new Vec2(0, 0);
	}
	copy(other: Vec2): this {
		this.x = other.x;
		this.y = other.y;
		return this;
	}
	clone(): Vec2 {
		return new Vec2(this.x, this.y);
	}
}

export class Vec3 {
	declare x: number;
	declare y: number;
	declare z: number;

	constructor(x: number, y: number, z: number) {
		this.x = x;
		this.y = y;
		this.z = z;
	}
	static zero(): Vec3 {
		return new Vec3(0, 0, 0);
	}
	copy(other: Vec3): this {
		this.x = other.x;
		this.y = other.y;
		this.z = other.z;
		return this;
	}
	clone(): Vec3 {
		return new Vec3(this.x, this.y, this.z);
	}
	/** Return the component-wise sum without mutating either vector. */
	add(other: Vec3): Vec3 {
		return new Vec3(this.x + other.x, this.y + other.y, this.z + other.z);
	}
	/** Return squared Euclidean distance when a square root is unnecessary. */
	distanceSquaredTo(other: Vec3): number {
		const x = this.x - other.x;
		const y = this.y - other.y;
		const z = this.z - other.z;
		return x * x + y * y + z * z;
	}
}

export class Mat4 {
	declare m11: number;
	declare m12: number;
	declare m13: number;
	declare m14: number;
	declare m21: number;
	declare m22: number;
	declare m23: number;
	declare m24: number;
	declare m31: number;
	declare m32: number;
	declare m33: number;
	declare m34: number;
	declare m41: number;
	declare m42: number;
	declare m43: number;
	declare m44: number;

	constructor(
		m11: number,
		m12: number,
		m13: number,
		m14: number,
		m21: number,
		m22: number,
		m23: number,
		m24: number,
		m31: number,
		m32: number,
		m33: number,
		m34: number,
		m41: number,
		m42: number,
		m43: number,
		m44: number,
	) {
		this.m11 = m11;
		this.m12 = m12;
		this.m13 = m13;
		this.m14 = m14;
		this.m21 = m21;
		this.m22 = m22;
		this.m23 = m23;
		this.m24 = m24;
		this.m31 = m31;
		this.m32 = m32;
		this.m33 = m33;
		this.m34 = m34;
		this.m41 = m41;
		this.m42 = m42;
		this.m43 = m43;
		this.m44 = m44;
	}
	static zero(): Mat4 {
		return new Mat4(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
	}
	static identity(): Mat4 {
		return new Mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
	}
	copy(other: Mat4): this {
		this.m11 = other.m11;
		this.m12 = other.m12;
		this.m13 = other.m13;
		this.m14 = other.m14;
		this.m21 = other.m21;
		this.m22 = other.m22;
		this.m23 = other.m23;
		this.m24 = other.m24;
		this.m31 = other.m31;
		this.m32 = other.m32;
		this.m33 = other.m33;
		this.m34 = other.m34;
		this.m41 = other.m41;
		this.m42 = other.m42;
		this.m43 = other.m43;
		this.m44 = other.m44;
		return this;
	}
	clone(): Mat4 {
		return Mat4.zero().copy(this);
	}
}

export class AABB3 {
	constructor(
		public min: Vec3,
		public max: Vec3,
	) {}
	static zero(): AABB3 {
		return new AABB3(Vec3.zero(), Vec3.zero());
	}
	copy(other: AABB3): this {
		this.min.copy(other.min);
		this.max.copy(other.max);
		return this;
	}
	/** Expand these bounds in place to include every point within `other`. */
	union(other: AABB3): this {
		this.min.x = Math.min(this.min.x, other.min.x);
		this.min.y = Math.min(this.min.y, other.min.y);
		this.min.z = Math.min(this.min.z, other.min.z);
		this.max.x = Math.max(this.max.x, other.max.x);
		this.max.y = Math.max(this.max.y, other.max.y);
		this.max.z = Math.max(this.max.z, other.max.z);
		return this;
	}
	clone(): AABB3 {
		return new AABB3(this.min.clone(), this.max.clone());
	}
}

export class AABB2 {
	constructor(
		public min: Vec2,
		public max: Vec2,
	) {}
	static zero(): AABB2 {
		return new AABB2(Vec2.zero(), Vec2.zero());
	}
	copy(other: AABB2): this {
		this.min.copy(other.min);
		this.max.copy(other.max);
		return this;
	}
	clone(): AABB2 {
		return new AABB2(this.min.clone(), this.max.clone());
	}
}

export class Quat {
	declare w: number;
	declare x: number;
	declare y: number;
	declare z: number;

	constructor(w: number, x: number, y: number, z: number) {
		this.w = w;
		this.x = x;
		this.y = y;
		this.z = z;
	}
	static zero(): Quat {
		return new Quat(0, 0, 0, 0);
	}
	static identity(): Quat {
		return new Quat(1, 0, 0, 0);
	}
	copy(other: Quat): this {
		this.w = other.w;
		this.x = other.x;
		this.y = other.y;
		this.z = other.z;
		return this;
	}
	clone(): Quat {
		return new Quat(this.w, this.x, this.y, this.z);
	}
}
