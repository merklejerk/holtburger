import type { AnimationAssetRepository } from "../animation/animation-asset-repository";
import type { SceneNodeId } from "../scene";
import type { DynamicEntityRecord } from "./dynamic-entity-types";
import type { ObjectVisualTemplateRepositoryPort } from "./object-visual-template-repository";

/** Owns per-frame presentation counters and aggregate dynamic-entity diagnostics. */
export class DynamicEntityDiagnostics {
	/** Residents visited by the last sparse presentation publication. */
	lastPresentationEntityVisitCount = 0;
	lastPublishedPresentationCount = 0;
	/** Publications for residents with behavior but no playback, which animation cannot cover. */
	lastEffectOnlyPresentationCount = 0;
	/** Envelope lookups whose result changed the owner radius during the last publication. */
	lastParticleEnvelopeChangeCount = 0;
	/** Owner-aggregate lookups performed during the last publication. */
	lastParticleEnvelopeQueryCount = 0;

	getDiagnostics<TTemplateOwnerId extends string>(
		entities: ReadonlyMap<SceneNodeId, DynamicEntityRecord>,
		animations: AnimationAssetRepository,
		templates: ObjectVisualTemplateRepositoryPort<TTemplateOwnerId>,
	) {
		const prepared = [...entities.values()].map(
			(entity) => entity.preparedAnimation,
		);
		return {
			activatableEntityCount: prepared.filter(
				(animation) => animation?.kind === "activatable",
			).length,
			animationResources: animations.getDiagnostics(),
			entityCount: entities.size,
			lastPresentationEntityVisitCount: this.lastPresentationEntityVisitCount,
			lastPublishedPresentationCount: this.lastPublishedPresentationCount,
			lastEffectOnlyPresentationCount: this.lastEffectOnlyPresentationCount,
			lastParticleEnvelopeChangeCount: this.lastParticleEnvelopeChangeCount,
			lastParticleEnvelopeQueryCount: this.lastParticleEnvelopeQueryCount,
			staticFallbackEntityCount: prepared.filter(
				(animation) => animation?.kind === "retain-static-presentation",
			).length,
			templates: templates.getDiagnostics(),
		};
	}
}
