export { architect } from './orchestrator.mjs';

// Pair mode (default) — Claude implements + Codex critiques
export { default as pairImplementerRole } from './roles/pair-implementer.mjs';

// RUP mode — Phase 1: Inception
export { default as visionRole } from './roles/vision.mjs';
export { default as visionReviewerRole } from './roles/vision-reviewer.mjs';

// RUP mode — Phase 2: Elaboration
export { default as requirementsAnalystRole } from './roles/requirements-analyst.mjs';
export { default as architectRole } from './roles/architect.mjs';
export { default as riskAnalystRole } from './roles/risk-analyst.mjs';
export { default as designReviewerRole } from './roles/design-reviewer.mjs';

// Both modes — Construction
export { default as implementerRole } from './roles/implementer.mjs';
export { default as criticRole } from './roles/critic.mjs';
export { default as reviserRole } from './roles/reviser.mjs';

// RUP mode — Phase 4: Transition
export { default as acceptanceWriterRole } from './roles/acceptance-writer.mjs';
export { default as deploymentWriterRole } from './roles/deployment-writer.mjs';
