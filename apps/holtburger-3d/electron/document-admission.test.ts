import { describe, expect, it } from "vitest";
import { DocumentAdmission } from "./document-admission";

describe("document IPC admission", () => {
	it("rejects a picker request or late old-session request against a new document", () => {
		const gate = new DocumentAdmission();
		gate.navigate("picker", "launcher/index.html");
		const picker = gate.boot("file:///app/dist/launcher/index.html");
		gate.require(picker, "picker");
		expect(() => gate.require(picker, "client")).toThrow("unavailable");
		gate.close();
		expect(() => gate.require(picker)).toThrow("closed");
		gate.navigate("client", "client/index.html?debug=1");
		expect(() => gate.boot("file:///app/dist/launcher/index.html")).toThrow(
			"unavailable",
		);
		const first = gate.boot("file:///app/dist/client/index.html?debug=1");
		gate.require(first, "client");
		expect(() => gate.require(picker)).toThrow("closed");
		gate.navigate("client", "client/index.html");
		expect(() => gate.require(first)).toThrow("closed");
	});
});
