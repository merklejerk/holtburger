import { describe, expect, it, vi } from "vitest";

import { nameplateIconId } from "../systems/dynamic-presentation-source";
import {
	NameplateIconCatalog,
	type NameplateIconSource,
} from "./nameplate-icon-source";
import {
	NameplateIconRepository,
	type NameplateIconServices,
	type PreparedNameplateIcon,
} from "./nameplate-icon-repository";

const ICON_ID = nameplateIconId("fixture");
const SOURCE: NameplateIconSource = {
	id: ICON_ID,
	label: "Fixture",
	svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"/>',
};

function controlled<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
	readonly reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((accepted, declined) => {
		resolve = accepted;
		reject = declined;
	});
	return { promise, reject, resolve };
}

function prepared(release = vi.fn()): PreparedNameplateIcon {
	return {
		height: 8,
		image: {} as CanvasImageSource,
		release,
		width: 16,
	};
}

function fixture(prepare: NameplateIconServices["prepare"]) {
	const services = {
		prepare: vi.fn(prepare),
		report: vi.fn(),
	} satisfies NameplateIconServices;
	return {
		repository: new NameplateIconRepository(
			new NameplateIconCatalog([SOURCE]),
			services,
		),
		services,
	};
}

describe("NameplateIconRepository", () => {
	it("rejects ambiguous or incomplete source registrations", () => {
		expect(() => new NameplateIconCatalog([SOURCE, SOURCE])).toThrow(
			"Duplicate nameplate icon ID",
		);
		expect(
			() =>
				new NameplateIconCatalog([
					{ ...SOURCE, label: "", id: nameplateIconId("unlabeled") },
				]),
		).toThrow("must have a label");
		expect(
			() =>
				new NameplateIconCatalog([
					{ ...SOURCE, svg: "", id: nameplateIconId("empty") },
				]),
		).toThrow("must have SVG content");
	});

	it("deduplicates retained identities and publishes one readiness change", async () => {
		const pending = controlled<PreparedNameplateIcon>();
		const { repository, services } = fixture(() => pending.promise);

		repository.reconcile([ICON_ID, ICON_ID]);
		expect(repository.read(ICON_ID)).toEqual({ kind: "loading" });
		expect(services.prepare).toHaveBeenCalledOnce();
		pending.resolve(prepared());
		await vi.waitFor(() => expect(repository.read(ICON_ID).kind).toBe("ready"));

		expect(repository.diagnostics().revision).toBe(1);
		expect(repository.takeChanged()).toEqual([ICON_ID]);
		expect(repository.takeChanged()).toEqual([]);
		repository.destroy();
	});

	it("releases a ready image when its final population reference disappears", async () => {
		const release = vi.fn();
		const { repository } = fixture(async () => prepared(release));
		repository.reconcile([ICON_ID]);
		await vi.waitFor(() => expect(repository.read(ICON_ID).kind).toBe("ready"));

		repository.reconcile([]);

		expect(release).toHaveBeenCalledOnce();
		expect(() => repository.read(ICON_ID)).toThrow("not retained");
		repository.destroy();
	});

	it("releases a late image instead of reviving a removed entry", async () => {
		const pending = controlled<PreparedNameplateIcon>();
		const release = vi.fn();
		const { repository } = fixture(() => pending.promise);
		repository.reconcile([ICON_ID]);
		repository.reconcile([]);

		pending.resolve(prepared(release));
		await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());

		expect(repository.diagnostics().revision).toBe(0);
		expect(repository.takeChanged()).toEqual([]);
		repository.destroy();
	});

	it("reports one failure and retries only after the source is reacquired", async () => {
		const { repository, services } = fixture(async () => {
			throw new Error("invalid SVG");
		});
		repository.reconcile([ICON_ID]);
		await vi.waitFor(() =>
			expect(repository.read(ICON_ID).kind).toBe("failed"),
		);

		repository.reconcile([ICON_ID]);
		expect(services.prepare).toHaveBeenCalledOnce();
		repository.reconcile([]);
		repository.reconcile([ICON_ID]);
		await vi.waitFor(() => expect(services.prepare).toHaveBeenCalledTimes(2));

		expect(services.report).toHaveBeenCalledTimes(2);
		repository.destroy();
	});

	it("releases completion after destruction and rejects later reads", async () => {
		const pending = controlled<PreparedNameplateIcon>();
		const release = vi.fn();
		const { repository } = fixture(() => pending.promise);
		repository.reconcile([ICON_ID]);
		repository.destroy();

		pending.resolve(prepared(release));
		await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());

		expect(() => repository.read(ICON_ID)).toThrow("destroyed");
	});

	it("fails loudly for an unregistered identity", () => {
		const { repository } = fixture(async () => prepared());
		expect(() => repository.reconcile([nameplateIconId("missing")])).toThrow(
			"Unknown nameplate icon",
		);
		repository.destroy();
	});
});
