import assert from "node:assert/strict";
import test from "node:test";
import { pickIaCookiePairLru } from "./ia-cookie-pool.mjs";

function cookie(id, overrides = {}) {
  return {
    id,
    user: `user-${id}`,
    sig: `sig-${id}`,
    last_used_at: null,
    use_count: 0,
    error_count: 0,
    is_valid: true,
    ...overrides,
  };
}

test("pickIaCookiePairLru returns null for empty pool", () => {
  assert.equal(pickIaCookiePairLru([]), null);
  assert.equal(pickIaCookiePairLru(null), null);
});

test("pickIaCookiePairLru returns the only cookie", () => {
  const only = cookie("a");
  assert.equal(pickIaCookiePairLru([only]), only);
});

test("pickIaCookiePairLru prefers never-used cookies", () => {
  const never = cookie("never");
  const recent = cookie("recent", { last_used_at: "2026-05-30T12:00:00.000Z" });
  const older = cookie("older", { last_used_at: "2026-05-30T10:00:00.000Z" });
  assert.equal(pickIaCookiePairLru([recent, never, older]), never);
});

test("pickIaCookiePairLru picks oldest last_used_at among used cookies", () => {
  const recent = cookie("recent", { last_used_at: "2026-05-30T12:00:00.000Z" });
  const older = cookie("older", { last_used_at: "2026-05-30T10:00:00.000Z" });
  assert.equal(pickIaCookiePairLru([recent, older]), older);
});

test("pickIaCookiePairLru deprioritizes high error-rate cookies", () => {
  const bad = cookie("bad", {
    last_used_at: null,
    use_count: 10,
    error_count: 8,
  });
  const good = cookie("good", {
    last_used_at: "2026-05-30T11:00:00.000Z",
    use_count: 10,
    error_count: 1,
  });
  assert.equal(pickIaCookiePairLru([bad, good]), good);
});

test("pickIaCookiePairLru skips is_valid=false when alternatives exist", () => {
  const invalid = cookie("invalid", { is_valid: false, last_used_at: null });
  const valid = cookie("valid", { last_used_at: "2026-05-30T12:00:00.000Z" });
  assert.equal(pickIaCookiePairLru([invalid, valid]), valid);
});

test("pickIaCookiePairLru falls back to invalid cookie when all invalid", () => {
  const a = cookie("a", { is_valid: false, last_used_at: "2026-05-30T12:00:00.000Z" });
  const b = cookie("b", { is_valid: false, last_used_at: "2026-05-30T10:00:00.000Z" });
  assert.equal(pickIaCookiePairLru([a, b]), b);
});
