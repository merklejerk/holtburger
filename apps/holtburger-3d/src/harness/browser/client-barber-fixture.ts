import fixture from "../../client/fixtures/barber-wire.json";
import {
	barberSnapshotSchema,
	barberPreviewSchema,
	barberRequestSchema,
} from "../../client/client-barber-contract";

/** Controlled core replies traverse production lifecycle decoding and editor admission. */
export function createBarberFixture(options: {
	readonly emit: (event: string, payload: unknown) => void;
	readonly baseline: () => void;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	let opening = 20;
	let offset = 0;
	return {
		begin: (fixed = false) => {
			options.baseline();
			offset = options.commands.length;
			const snapshot = barberSnapshotSchema.parse(fixture.snapshot);
			if (
				snapshot.interaction === null ||
				snapshot.interaction.phase.kind !== "editing"
			)
				throw new Error("Invalid barber fixture.");
			snapshot.interaction.id = ++opening;
			snapshot.interaction.subject = { guid: 1, instance: 1 };
			if (fixed) snapshot.interaction.phase.catalog.styles = { kind: "fixed" };
			options.emit("client-barber-updated", snapshot);
		},
		reply: () => {
			const command = options.commands
				.slice(offset)
				.filter((command) => command.command === "request_client_barber")
				.at(-1);
			const request = barberRequestSchema.parse(command?.args?.request);
			if (request.kind !== "preview")
				throw new Error("Expected a preview request.");
			const result = barberPreviewSchema.parse(fixture.preview);
			result.id = request.id;
			result.revision = request.draft.revision;
			result.subject = { guid: 1, instance: 1 };
			options.emit("client-barber-preview", result);
		},
		finish: () =>
			options.emit("client-barber-updated", {
				interaction: null,
				particles: null,
				result: { id: opening, outcome: { kind: "submitted" } },
			}),
		requests: () =>
			options.commands
				.slice(offset)
				.filter((command) => command.command === "request_client_barber")
				.map((command) => barberRequestSchema.parse(command.args?.request)),
	};
}
