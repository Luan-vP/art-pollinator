// Fixture: violates the dependency-direction rule by reaching outward to
// `app` via a relative import that escapes the core source root.
// Used only by scripts/test-boundaries.mjs to prove the checker fails.
import { validateLockRequest } from "../../../app/src/validate-lock-request.js";

export const forbidden = validateLockRequest;
