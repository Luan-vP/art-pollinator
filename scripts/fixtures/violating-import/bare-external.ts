// Fixture: violates the dependency-direction rule via a bare external import.
// Used only by scripts/test-boundaries.mjs to prove the checker fails.
import { readFileSync } from "fs";

export function readSomething(path: string): string {
  return readFileSync(path, "utf8");
}
