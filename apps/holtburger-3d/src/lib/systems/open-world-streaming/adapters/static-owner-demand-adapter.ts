import { planStaticDemand } from "../../../static/demand-planner";
import type { StaticDemand } from "../../../static/contracts";
import {
	createStaticLayerMaterializationOwner,
	type StaticLayerMaterializationOwner,
	type StaticLayerMaterializationOwnerKind,
} from "../owners/owner-id";

export function createStaticLayerOwnersFromDemand(input: {
	readonly demand: StaticDemand;
	readonly revision: number;
}): readonly StaticLayerMaterializationOwner[] {
	const plan = planStaticDemand(input.demand, input.revision);
	return plan.retainedLayerOwners.map((ownerKey) =>
		createStaticLayerMaterializationOwner({
			landblockId: ownerKey.landblockId,
			layerKind: ownerKey.kind as StaticLayerMaterializationOwnerKind,
		}),
	);
}
