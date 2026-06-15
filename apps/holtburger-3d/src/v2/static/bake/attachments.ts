import type {
	StaticBakeAttachmentProvider,
	StaticBakeAttachmentRequest,
	StaticBakeBatchAttachments,
} from "../contracts";

export function createEmptyStaticBakeAttachments(): StaticBakeBatchAttachments {
	return {
		envCellCellStructureGeometry: [],
		staticObjectSourceGeometry: [],
	};
}

function mergeStaticBakeBatchAttachments(
	attachments: readonly StaticBakeBatchAttachments[],
): StaticBakeBatchAttachments {
	return {
		envCellCellStructureGeometry: attachments.flatMap(
			(attachment) => attachment.envCellCellStructureGeometry,
		),
		staticObjectSourceGeometry: attachments.flatMap(
			(attachment) => attachment.staticObjectSourceGeometry,
		),
	};
}

export class CompositeStaticBakeAttachmentProvider
	implements StaticBakeAttachmentProvider
{
	readonly #providers: readonly StaticBakeAttachmentProvider[];

	constructor(providers: readonly StaticBakeAttachmentProvider[]) {
		this.#providers = providers;
	}

	async createAttachments(
		request: StaticBakeAttachmentRequest,
	): Promise<StaticBakeBatchAttachments> {
		return mergeStaticBakeBatchAttachments(
			await Promise.all(
				this.#providers.map((provider) => provider.createAttachments(request)),
			),
		);
	}
}
