import { describe, expect, it } from "vitest";
import {
	resolveExplorerPointResidency,
	resolveExplicitExplorerEnvCell,
} from "./explorer-residency";

describe("Explorer point residency policy", () => {
	it("selects the only exact containment match across overlapping bounds", () => {
		expect(
			resolveExplorerPointResidency({
				envCells: [
					{
						containsPoint: false,
						envCellId: "0x01020001",
						landblockId: "0x0102ffff",
					},
					{
						containsPoint: true,
						envCellId: "0x01020002",
						landblockId: "0x0102ffff",
					},
				],
				outdoor: {
					envCellId: null,
					landblockId: "0x0102ffff",
				},
			}),
		).toEqual({
			kind: "resolved",
			residency: {
				envCellId: "0x01020002",
				landblockId: "0x0102ffff",
			},
			source: "cell-containment",
		});
	});

	it("retains every containment match as typed ambiguity", () => {
		expect(
			resolveExplorerPointResidency({
				envCells: [
					{
						containsPoint: true,
						envCellId: "0x01020001",
						landblockId: "0x0102ffff",
					},
					{
						containsPoint: true,
						envCellId: "0x01020002",
						landblockId: "0x0102ffff",
					},
				],
				outdoor: {
					envCellId: null,
					landblockId: "0x0102ffff",
				},
			}),
		).toEqual({
			candidates: [
				{
					envCellId: "0x01020001",
					landblockId: "0x0102ffff",
				},
				{
					envCellId: "0x01020002",
					landblockId: "0x0102ffff",
				},
			],
			kind: "ambiguous",
		});
	});

	it("uses outdoor only when no candidate hull contains the point", () => {
		expect(
			resolveExplorerPointResidency({
				envCells: [
					{
						containsPoint: false,
						envCellId: "0x01020001",
						landblockId: "0x0102ffff",
					},
				],
				outdoor: {
					envCellId: null,
					landblockId: "0x0102ffff",
				},
			}),
		).toEqual({
			kind: "resolved",
			residency: {
				envCellId: null,
				landblockId: "0x0102ffff",
			},
			source: "outdoor",
		});
	});

	it("reports points outside canonical world bounds", () => {
		expect(resolveExplorerPointResidency(null)).toEqual({ kind: "outside" });
	});

	it("keeps exact-DID resolution distinct from overlap policy", () => {
		const residency = {
			envCellId: "0x01020001" as const,
			landblockId: "0x0102ffff" as const,
		};

		expect(resolveExplicitExplorerEnvCell(residency, "contained")).toEqual({
			kind: "resolved",
			residency,
			source: "explicit-env-cell",
		});
		expect(
			resolveExplicitExplorerEnvCell(residency, "topology-unavailable"),
		).toEqual({
			kind: "topology-unavailable",
			landblockId: "0x0102ffff",
		});
		expect(resolveExplicitExplorerEnvCell(residency, "outside")).toEqual({
			kind: "outside",
		});
	});
});
