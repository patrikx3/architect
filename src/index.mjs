export { architect } from './orchestrator.mjs';

// p3x-architect is a DESIGN-ONLY tool. The exported roles produce design
// artifacts (conventions, vision, requirements, architecture, file_tree,
// risks, design-findings, plan). Implementation is up to the human + their
// implementer (Claude Code, Cursor, the human, the team).

// Scout — runs first on every existing-codebase pass to seed every other role
// with a "conventions" doc derived from the actual project.
export { default as scoutRole } from './roles/scout.mjs';

// Pair mode (default — fast design pass)
export { default as pairPlannerRole } from './roles/pair-planner.mjs';

// RUP mode — Phase 1: Inception
export { default as visionRole } from './roles/vision.mjs';
export { default as visionReviewerRole } from './roles/vision-reviewer.mjs';

// RUP mode — Phase 2: Elaboration
export { default as requirementsAnalystRole } from './roles/requirements-analyst.mjs';
export { default as architectRole } from './roles/architect.mjs';
export { default as riskAnalystRole } from './roles/risk-analyst.mjs';
export { default as designReviewerRole } from './roles/design-reviewer.mjs';
