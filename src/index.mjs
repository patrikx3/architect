export { architect } from './orchestrator.mjs';

// Pair mode (default) — 1 task, 2 AIs, fixed split
//   Claude  = planner + reviewer  (NEVER writes file content)
//   Codex   = implementer + reviser (NEVER plans architecture)
export { default as pairPlannerRole } from './roles/pair-planner.mjs';
export { default as pairImplementerRole } from './roles/pair-implementer.mjs';
export { default as pairReviewerRole } from './roles/pair-reviewer.mjs';
export { default as pairReviserRole } from './roles/pair-reviser.mjs';

// RUP mode — Phase 1: Inception
export { default as visionRole } from './roles/vision.mjs';
export { default as visionReviewerRole } from './roles/vision-reviewer.mjs';

// RUP mode — Phase 2: Elaboration
export { default as requirementsAnalystRole } from './roles/requirements-analyst.mjs';
export { default as architectRole } from './roles/architect.mjs';
export { default as riskAnalystRole } from './roles/risk-analyst.mjs';
export { default as designReviewerRole } from './roles/design-reviewer.mjs';

// RUP mode — Phase 3: Construction
export { default as implementerRole } from './roles/implementer.mjs';
export { default as criticRole } from './roles/critic.mjs';
export { default as reviserRole } from './roles/reviser.mjs';

// RUP mode — Phase 4: Transition
export { default as acceptanceWriterRole } from './roles/acceptance-writer.mjs';
export { default as deploymentWriterRole } from './roles/deployment-writer.mjs';
