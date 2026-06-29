import { describe, expect, it } from "vitest";
import { FIRST_RUNTIME_SPAWN_FIXTURE } from "../runtime/runtime-spawn-fixtures";
import {
	applyWeenieSpawnSeedToForm,
	createDefaultBrowserSpawnFormState,
	parseWeenieClassIdInput,
	validateBrowserSpawnForm,
} from "./runtime-spawn-form";

describe("browser runtime spawn form", () => {
	it("turns a manual setup-backed form into a runtime spawn request", () => {
		const result = validateBrowserSpawnForm({
			...createDefaultBrowserSpawnFormState(),
			label: "Manual human",
			landblockId: "0xda55ffff",
			originX: "1.5",
			originY: "2.5",
			originZ: "3.5",
			scaleX: "1",
			scaleY: "2",
			scaleZ: "3",
			serverInstanceId: "server-object:5001",
			setupModelId: "0x02000001",
			weenieClassId: "",
			yawDegrees: "90",
		});

		expect(result).toMatchObject({
			kind: "accepted",
			record: {
				label: "Manual human",
				serverInstanceId: "server-object:5001",
				setupModelId: 0x02000001,
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
				weenieClassId: null,
			},
			request: {
				animationSelection: { kind: "none" },
				baseLocalPlacement: {
					origin: { x: 1.5, y: 2.5, z: 3.5 },
					orientation: {
						x: 0,
						y: 0,
					},
				},
				serverInstanceIdMetadata: { id: "server-object:5001" },
				setupModelId: 0x02000001,
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
				sourceScale: { x: 1, y: 2, z: 3 },
			},
		});
		if (result.kind !== "accepted") {
			throw new Error("expected accepted browser spawn request");
		}
		expect(result.request.baseLocalPlacement.orientation.w).toBeCloseTo(
			Math.SQRT1_2,
		);
		expect(result.request.baseLocalPlacement.orientation.z).toBeCloseTo(
			Math.SQRT1_2,
		);
	});

	it("applies WCID seed facts to the editable form without creating a request", () => {
		const seededForm = applyWeenieSpawnSeedToForm(
			{
				...createDefaultBrowserSpawnFormState(),
				label: "keep? no",
				setupModelId: "",
				weenieClassId: "",
			},
			{
				label: FIRST_RUNTIME_SPAWN_FIXTURE.label,
				setupModelId: FIRST_RUNTIME_SPAWN_FIXTURE.setupModelId,
				weenieClassId: FIRST_RUNTIME_SPAWN_FIXTURE.weenieClassId,
			},
		);

		expect(seededForm).toMatchObject({
			label: FIRST_RUNTIME_SPAWN_FIXTURE.label,
			setupModelId: "0x02000001",
			weenieClassId: "1",
		});
		expect(validateBrowserSpawnForm(seededForm)).toMatchObject({
			kind: "accepted",
			record: { weenieClassId: FIRST_RUNTIME_SPAWN_FIXTURE.weenieClassId },
			request: { setupModelId: FIRST_RUNTIME_SPAWN_FIXTURE.setupModelId },
		});
	});

	it("turns env-cell residence inputs into env-cell runtime spawn requests", () => {
		const result = validateBrowserSpawnForm({
			...createDefaultBrowserSpawnFormState(),
			envCellId: "0xda550100",
			landblockId: "0xda55ffff",
			residenceMode: "env-cell",
		});

		expect(result).toMatchObject({
			kind: "accepted",
			record: {
				sourceResidence: {
					envCellId: 0xda550100,
					kind: "env-cell",
					landblockId: 0xda55ffff,
				},
			},
			request: {
				sourceResidence: {
					envCellId: 0xda550100,
					kind: "env-cell",
					landblockId: 0xda55ffff,
				},
			},
		});
	});

	it("requires env-cell ids only when env-cell residence is selected", () => {
		expect(
			validateBrowserSpawnForm({
				...createDefaultBrowserSpawnFormState(),
				envCellId: "",
				residenceMode: "outdoor",
			}),
		).toMatchObject({
			kind: "accepted",
			request: {
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
			},
		});

		expect(
			validateBrowserSpawnForm({
				...createDefaultBrowserSpawnFormState(),
				envCellId: "",
				residenceMode: "env-cell",
			}),
		).toEqual({
			errors: ["Env-cell id must be a non-negative integer."],
			kind: "rejected",
		});
	});

	it("requires explicit animation ids when explicit animation mode is selected", () => {
		expect(
			validateBrowserSpawnForm({
				...createDefaultBrowserSpawnFormState(),
				animationId: "",
				animationMode: "explicit",
			}),
		).toEqual({
			errors: ["Animation id must be a non-negative integer."],
			kind: "rejected",
		});

		expect(
			validateBrowserSpawnForm({
				...createDefaultBrowserSpawnFormState(),
				animationId: "0x03000001",
				animationMode: "explicit",
			}),
		).toMatchObject({
			kind: "accepted",
			request: {
				animationSelection: { animationId: 0x03000001, kind: "explicit" },
			},
		});
	});

	it("rejects invalid required fields before creating runtime requests", () => {
		expect(
			validateBrowserSpawnForm({
				...createDefaultBrowserSpawnFormState(),
				landblockId: "not-a-landblock",
				originX: "nan",
				scaleZ: "0",
				setupModelId: "",
			}),
		).toEqual({
			errors: [
				"Setup id must be a non-negative integer.",
				"Landblock id must be a non-negative integer.",
				"Origin X must be a finite number.",
				"Scale Z must be greater than zero.",
			],
			kind: "rejected",
		});
	});

	it("parses decimal and hex WCID inputs for resolver lookup", () => {
		expect(parseWeenieClassIdInput("1")).toBe(1);
		expect(parseWeenieClassIdInput("0x1")).toBe(1);
		expect(parseWeenieClassIdInput("")).toBeNull();
		expect(parseWeenieClassIdInput("-1")).toBeNull();
	});
});
