import { HttpLandblockContentSource } from "../../lib/assets/http-landblock-content-source";
import { WebAudioDevice } from "../../lib/assets/web-audio-device";
import { AnimationAssetRepository } from "../../lib/game/animation/animation-asset-repository";
import type { DatAssetId } from "../../lib/game/game-types";
import { isContentFailure } from "../../lib/host/host-command-result";

/** Real HTTP decoding, repository ownership, and browser media rejection without visual judgments. */
export async function probeContentFailures(hostUrl: string) {
	const source = await HttpLandblockContentSource.build(hostUrl);
	const repairedId: DatAssetId = "0x0300055b";
	const missingId: DatAssetId = "0x03ffffff";
	const repaired = await source.loadAnimation(repairedId);
	const table = await source.loadMotionTableClosure("0x09000021");
	if (!table.includes(repairedId))
		throw new Error(
			"Reported motion table no longer reaches the repaired animation",
		);
	let repairedSource = false;
	let missingRequests = 0;
	const requestCount = () => missingRequests;
	let diagnostics = 0;
	const repository = new AnimationAssetRepository({
		loadMotionTableClosure: async () => [repairedId, missingId],
		loadAnimation: async (id) => {
			if (id !== missingId) return source.loadAnimation(id);
			missingRequests++;
			// Recovery substitutes a complete, known decoded fixture, never fabricated decoder bytes.
			return repairedSource ? { ...repaired, id } : source.loadAnimation(id);
		},
		destroy() {},
	});
	const unsubscribe = repository.listenContentFailures(() => diagnostics++);
	const first = await repository.acquireMotionAssets("0x09000021");
	try {
		if (first.animations.size !== 1 || !first.animations.has(repairedId))
			throw new Error("Bad clip prevented the valid sibling from staging");
		const repeated = await repository.acquireMotionAssets("0x09000021");
		repeated.release();
		if (requestCount() !== 1 || diagnostics !== 1)
			throw new Error(
				"Failed clip was requested or reported again before retry",
			);
		repairedSource = true;
		repository.retryFailed();
		const recovered = await repository.acquireMotionAssets("0x09000021");
		try {
			if (
				recovered.animations.size !== 2 ||
				requestCount() !== 2 ||
				recovered.animations.get(repairedId) !==
					first.animations.get(repairedId)
			)
				throw new Error(
					"Explicit retry failed to recover while retaining its valid sibling",
				);
		} finally {
			recovered.release();
		}
	} finally {
		first.release();
		unsubscribe();
	}
	if (
		repository.getState(repairedId) !== null ||
		repository.getState(missingId) !== null
	)
		throw new Error("Motion probe leaked a retained handle");
	repository.destroy();

	const context = new OfflineAudioContext(1, 128, 44100);
	let waveRequests = 0;
	let validWave = false;
	const device = new WebAudioDevice(
		context,
		{
			async loadAudio() {
				waveRequests++;
				return validWave ? silentWave() : new ArrayBuffer(4);
			},
			destroy() {},
		},
		0.01,
		1,
	);
	try {
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				await device.prepare("0x0a000001");
				throw new Error("Invalid wave was accepted");
			} catch (error) {
				if (!isContentFailure(error)) throw error;
			}
		}
		if (waveRequests !== 1)
			throw new Error("Repeated media rejection decoded again");
		validWave = true;
		device.retryFailed();
		await device.prepare("0x0a000001");
		if (device.getPreparedSourceBytes("0x0a000001") !== silentWave().byteLength)
			throw new Error("Retried wave did not prepare a real AudioBuffer");
	} finally {
		device.destroy();
		source.destroy();
	}
	return {
		repairedAnimation: repairedId,
		motionTable: "0x09000021",
		missingRequests,
		diagnostics,
		validSiblingRetained: true,
		releasedHandles: true,
		waveRequests,
		mediaRecovered: true,
	};
}

/** One silent PCM16 sample; accepted by the browser's real decodeAudioData implementation. */
function silentWave(): ArrayBuffer {
	const bytes = new ArrayBuffer(46);
	const view = new DataView(bytes);
	for (const [offset, text] of [
		[0, "RIFF"],
		[8, "WAVE"],
		[12, "fmt "],
		[36, "data"],
	] as const)
		for (let i = 0; i < text.length; i++)
			view.setUint8(offset + i, text.charCodeAt(i));
	view.setUint32(4, 38, true);
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 44100, true);
	view.setUint32(28, 88200, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	view.setUint32(40, 2, true);
	return bytes;
}
