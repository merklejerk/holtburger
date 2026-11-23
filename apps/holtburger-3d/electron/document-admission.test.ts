import { describe, expect, it } from "vitest";
import { DocumentAdmission } from "./document-admission";

describe("document IPC admission", () => {
	it("rejects a picker request or late old-session request against a new document", () => {
		const gate = new DocumentAdmission();
		gate.navigate("picker", "launcher/index.html");
		const picker = gate.boot("file:///app/dist/launcher/index.html");
		gate.require(picker, "picker");
		expect(gate.isAdmitted(picker)).toBe(true);
		expect(() => gate.require(picker, "client")).toThrow("unavailable");
		gate.close();
		expect(gate.isAdmitted(picker)).toBe(false);
		expect(() => gate.require(picker)).toThrow("closed");
		gate.navigate("client", "client/index.html?debug=1");
		expect(() => gate.boot("file:///app/dist/launcher/index.html")).toThrow(
			"unavailable",
		);
		const first = gate.boot("file:///app/dist/client/index.html?debug=1");
		gate.require(first, "client");
		expect(gate.isAdmitted(first)).toBe(true);
		expect(gate.isAdmitted(picker)).toBe(false);
		expect(() => gate.require(picker)).toThrow("closed");
		gate.navigate("client", "client/index.html");
		expect(() => gate.require(first)).toThrow("closed");
	});

	it("admits multi-role game channels for client and explorer while rejecting picker", () => {
		const gate = new DocumentAdmission();
		gate.navigate("picker", "launcher/index.html");
		const picker = gate.boot("file:///app/dist/launcher/index.html");
		expect(() => gate.require(picker, ["client", "explorer"])).toThrow(
			"unavailable",
		);

		gate.navigate("explorer", "explorer/index.html");
		const explorer = gate.boot("file:///app/dist/explorer/index.html");
		gate.require(explorer, ["client", "explorer"]);
		gate.require(explorer, "explorer");
		expect(() => gate.require(explorer, "client")).toThrow("unavailable");
		expect(() => gate.require(explorer, "picker")).toThrow("unavailable");

		gate.navigate("client", "client/index.html");
		const client = gate.boot("file:///app/dist/client/index.html");
		gate.require(client, ["client", "explorer"]);
		expect(() => gate.require(explorer, ["client", "explorer"])).toThrow(
			"closed",
		);
	});
});
