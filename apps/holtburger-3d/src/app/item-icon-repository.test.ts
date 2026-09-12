import { describe, expect, it, vi } from "vitest";
import {
	ItemIconRepository,
	type ItemIconServices,
} from "./item-icon-repository";
import {
	MAX_ICON_BATCH,
	type ItemIconRequest,
	type ItemIconSpec,
	type PreparedItemIcon,
} from "./item-icon-source";

const spec = (base = 1): ItemIconSpec => ({
	kind: "item",
	base,
	itemType: 4,
	overlay: null,
	underlay: null,
	uiEffects: 0,
});
interface Work {
	requests: readonly ItemIconRequest[];
	resolve: (results: readonly PreparedItemIcon[]) => void;
	reject: (error: Error) => void;
}
function fixture() {
	const pending: Work[] = [];
	let imageId = 0;
	const services: ItemIconServices = {
		prepare: vi.fn<ItemIconServices["prepare"]>(
			(requests) =>
				new Promise((resolve, reject) =>
					pending.push({ requests, resolve, reject }),
				),
		),
		createImage: vi.fn(async () => `blob:test-${++imageId}`),
		revokeImage: vi.fn(),
		report: vi.fn(),
	};
	const repository = new ItemIconRepository(services);
	const owner = repository.createOwner("persistent");
	const next = async () => {
		await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
		const work = pending.shift();
		if (!work) throw new Error("Expected queued work.");
		return work;
	};
	const ready = (work: Work) =>
		work.resolve(
			work.requests.map(({ key }) => ({
				kind: "ready",
				key,
				image: new Uint8Array([1]),
			})),
		);
	return { repository, owner, services, next, ready };
}

describe("ItemIconRepository", () => {
	it("keeps standalone graphics distinct from composed artwork of the same asset", async () => {
		const f = fixture();
		const baseSpec = { kind: "base", base: 1 } as const;
		const baseKey = f.repository.retain(f.owner, baseSpec);
		const itemKey = f.repository.retain(f.owner, spec(baseSpec.base));
		expect(baseKey).not.toBe(itemKey);
		expect(f.repository.retain(f.owner, baseSpec)).toBe(baseKey);
		const work = await f.next();
		expect(work.requests).toEqual([
			{ key: baseKey, spec: baseSpec },
			{ key: itemKey, spec: spec(baseSpec.base) },
		]);
		f.ready(work);
		await vi.waitFor(() =>
			expect(f.services.createImage).toHaveBeenCalledTimes(2),
		);
		expect(f.repository.read(baseKey)).not.toEqual(f.repository.read(itemKey));
		f.repository.dispose();
	});
	it("shares one preparation and URL across persistent owners and display uses", async () => {
		const f = fixture();
		const second = f.repository.createOwner("persistent");
		const display = f.repository.createOwner("display");
		const key = f.repository.retain(f.owner, spec());
		expect(
			f.repository.retain(second, {
				uiEffects: 0,
				underlay: null,
				overlay: null,
				kind: "item",
				itemType: 4,
				base: 1,
			}),
		).toBe(key);
		f.repository.retainKey(display, key);
		const work = await f.next();
		expect(work.requests).toEqual([{ key, spec: spec() }]);
		f.ready(work);
		await vi.waitFor(() =>
			expect(f.repository.read(key)).toEqual({
				kind: "ready",
				url: "blob:test-1",
			}),
		);
		f.repository.releaseOwner(f.owner);
		f.repository.releaseOwner(second);
		expect(f.services.revokeImage).not.toHaveBeenCalled();
		f.repository.releaseOwner(display);
		expect(f.services.revokeImage).toHaveBeenCalledExactlyOnceWith(
			"blob:test-1",
		);
	});
	it("bounds and serializes bursts without keeping obsolete queued requests", async () => {
		const f = fixture();
		const keys = Array.from({ length: MAX_ICON_BATCH * 2 + 1 }, (_, index) =>
			f.repository.retain(f.owner, spec(index + 1)),
		);
		const first = await f.next();
		expect(first.requests).toHaveLength(MAX_ICON_BATCH);
		expect(f.services.prepare).toHaveBeenCalledTimes(1);
		const obsolete = keys[MAX_ICON_BATCH];
		if (!obsolete) throw new Error("Expected queued key.");
		f.repository.release(f.owner, obsolete);
		f.ready(first);
		const second = await f.next();
		expect(second.requests).toHaveLength(MAX_ICON_BATCH);
		expect(second.requests.some(({ key }) => key === obsolete)).toBe(false);
		f.ready(second);
		await vi.waitFor(() =>
			expect(f.services.createImage).toHaveBeenCalledTimes(MAX_ICON_BATCH * 2),
		);
		f.repository.dispose();
		expect(f.services.revokeImage).toHaveBeenCalledTimes(MAX_ICON_BATCH * 2);
	});
	it("rejects stale completion after same-key reacquisition", async () => {
		const f = fixture();
		const key = f.repository.retain(f.owner, spec());
		const old = await f.next();
		f.repository.release(f.owner, key);
		f.repository.retain(f.owner, spec());
		f.ready(old);
		const current = await f.next();
		expect(f.services.createImage).not.toHaveBeenCalled();
		expect(f.repository.read(key).kind).toBe("loading");
		f.ready(current);
		await vi.waitFor(() => expect(f.repository.read(key).kind).toBe("ready"));
		f.repository.dispose();
	});
	it("reports a failed batch once per retained entry and continues unrelated work", async () => {
		const f = fixture();
		const key = f.repository.retain(f.owner, spec());
		const first = await f.next();
		const other = f.repository.retain(f.owner, spec(2));
		first.reject(new Error("transport rejected"));
		const second = await f.next();
		expect(f.repository.read(key).kind).toBe("failed");
		f.repository.retain(f.owner, spec());
		expect(f.services.report).toHaveBeenCalledTimes(1);
		f.ready(second);
		await vi.waitFor(() => expect(f.repository.read(other).kind).toBe("ready"));
		expect(f.services.prepare).toHaveBeenCalledTimes(2);
		f.repository.dispose();
	});
	it("keeps displayed URLs alive across repository disposal, then revokes exactly once", async () => {
		const f = fixture();
		const display = f.repository.createOwner("display");
		const key = f.repository.retain(f.owner, spec());
		f.repository.retainKey(display, key);
		f.ready(await f.next());
		await vi.waitFor(() => expect(f.repository.read(key).kind).toBe("ready"));
		f.repository.dispose();
		f.repository.dispose();
		expect(f.services.revokeImage).not.toHaveBeenCalled();
		expect(() => f.repository.retain(f.owner, spec())).toThrow();
		f.repository.releaseOwner(display);
		f.repository.releaseOwner(display);
		expect(f.services.revokeImage).toHaveBeenCalledTimes(1);
	});
	it("revokes an image that finishes browser decoding after its entry is released", async () => {
		const f = fixture();
		let finish: ((url: string) => void) | undefined;
		vi.mocked(f.services.createImage).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const key = f.repository.retain(f.owner, spec());
		f.ready(await f.next());
		await vi.waitFor(() =>
			expect(f.services.createImage).toHaveBeenCalledTimes(1),
		);
		f.repository.release(f.owner, key);
		if (!finish) throw new Error("Expected pending image decode.");
		finish("blob:late");
		await vi.waitFor(() =>
			expect(f.services.revokeImage).toHaveBeenCalledExactlyOnceWith(
				"blob:late",
			),
		);
		f.repository.dispose();
	});
	it("suppresses work completing after disposal and isolates a replacement repository", async () => {
		const old = fixture();
		old.repository.retain(old.owner, spec());
		const work = await old.next();
		old.repository.dispose();
		const current = fixture();
		expect(() => current.repository.retain(old.owner, spec())).toThrow();
		const key = current.repository.retain(current.owner, spec());
		old.ready(work);
		current.ready(await current.next());
		await vi.waitFor(() =>
			expect(current.repository.read(key).kind).toBe("ready"),
		);
		expect(old.services.createImage).not.toHaveBeenCalled();
		current.repository.dispose();
	});
	it("settles browser decode failures without blocking the next batch", async () => {
		const f = fixture();
		vi.mocked(f.services.createImage).mockRejectedValueOnce(
			new Error("invalid PNG"),
		);
		const key = f.repository.retain(f.owner, spec());
		f.ready(await f.next());
		await vi.waitFor(() => expect(f.repository.read(key).kind).toBe("failed"));
		const other = f.repository.retain(f.owner, spec(2));
		f.ready(await f.next());
		await vi.waitFor(() => expect(f.repository.read(other).kind).toBe("ready"));
		expect(f.services.report).toHaveBeenCalledTimes(1);
		f.repository.dispose();
	});
});
