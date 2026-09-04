import type { DecodedPhysicsScriptTable } from "../../assets/decode-physics-script-table-record";
import type { PhysicsScriptTableSource } from "../../assets/physics-script-table-source";
import { PreparedAssetRepository } from "./prepared-asset-repository";

/** Shares immutable PhysicsScriptTable transfer over the common asset lifecycle. */
export class PhysicsScriptTableRepository extends PreparedAssetRepository<
	DecodedPhysicsScriptTable,
	DecodedPhysicsScriptTable
> {
	constructor(source: PhysicsScriptTableSource) {
		super({
			destroySource: () => source.destroy(),
			label: "PhysicsScriptTable",
			load: (tableId) => source.loadPhysicsScriptTable(tableId),
			prepare: (decoded, expectedId) => {
				if (decoded.id.toLowerCase() !== expectedId.toLowerCase()) {
					throw new Error(
						`PhysicsScriptTable source returned ${decoded.id} for ${expectedId}.`,
					);
				}
				return decoded;
			},
		});
	}
}
