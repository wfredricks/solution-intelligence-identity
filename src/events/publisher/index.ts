/**
 * Adapted from archetypes/events-spine — https://github.com/wfredricks/archetypes
 * Source commit: 1b334abbb354fa89dd758225e960ce5f58dcf365
 * Source path: events-spine/reference-impl/src/publisher/index.ts (events-spine-v0.1.0-pre)
 *
 * Pattern: events-spine (composite) — simple-pubsub primitive barrel.
 * Adopted for: SI/I identity service, Stage 2d.
 *
 * Maintenance ownership: SI core team.
 *
 * Modifications from upstream:
 *   - none — copied verbatim.
 *
 * Re-exports for the publisher primitive (simple-pubsub).
 *
 * @module events/publisher
 */

export type { Publisher, PublisherOptions, PublishInput } from './publisher.js';
export { createPublisher, decodeEnvelope } from './publisher.js';
