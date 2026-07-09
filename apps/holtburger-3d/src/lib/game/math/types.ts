export class Vec2 {
	constructor(
		public x: number,
		public y: number,
	) {}
	static zero(): Vec2 {
		return new Vec2(0, 0);
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
}

export class Vec4 {
	constructor(
		public x: number,
		public y: number,
		public z: number,
		public w: number,
	) {}
	static zero(): Vec4 {
		return new Vec4(0, 0, 0, 0);
	}
}

export class Mat3 {
	constructor(
		public m11: number,
		public m12: number,
		public m13: number,
		public m21: number,
		public m22: number,
		public m23: number,
		public m31: number,
		public m32: number,
		public m33: number,
	) {}
	static zero(): Mat3 {
		return new Mat3(0, 0, 0, 0, 0, 0, 0, 0, 0);
	}
	static identity(): Mat3 {
		return new Mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);
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
}

export class AABB3 {
	constructor(
		public min: Vec3,
		public max: Vec3,
	) {}
	static zero(): AABB3 {
		return new AABB3(Vec3.zero(), Vec3.zero());
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
}
