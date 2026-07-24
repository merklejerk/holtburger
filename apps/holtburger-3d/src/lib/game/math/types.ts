export class Vec2 {
	constructor(
		public x: number,
		public y: number,
	) {}
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
	constructor(
		public x: number,
		public y: number,
		public z: number,
	) {}
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
	constructor(
		public m11: number,
		public m12: number,
		public m13: number,
		public m14: number,
		public m21: number,
		public m22: number,
		public m23: number,
		public m24: number,
		public m31: number,
		public m32: number,
		public m33: number,
		public m34: number,
		public m41: number,
		public m42: number,
		public m43: number,
		public m44: number,
	) {}
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
	constructor(
		public w: number,
		public x: number,
		public y: number,
		public z: number,
	) {}
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
