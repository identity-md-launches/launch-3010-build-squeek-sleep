// Round engine and API parsing tests. Run with: npm test (node --test, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRACE_MS,
  POINTS_FLIP,
  POINTS_HELD,
  ROUND_MS,
  adoptPlayer,
  advance,
  emptySave,
  formatCountdown,
  history,
  leaderboard,
  normalizeSave,
  parseEconomy,
  parseStatus,
  pickFor,
  placePick,
  roundEnd,
  roundStart,
} from "../src/game.js";

const R = 1000; // an arbitrary round id
/** @param {"running" | "sleeping"} state @param {number} at */
const obs = (state, at) => ({ state, rpm: state === "running" ? 120 : 0, height: 42, at });

test("parseStatus reads common field shapes", () => {
  assert.equal(parseStatus({ wheel: { status: "running", rpm: 88 }, block_height: 7 }, 1)?.state, "running");
  assert.equal(parseStatus({ wheel_status: "stopped", rpm: 0, blockHeight: 9 }, 1)?.state, "sleeping");
  assert.equal(parseStatus({ status: "ok", hamster: { state: "sleeping" } }, 1)?.state, "sleeping");
  assert.equal(parseStatus({ data: { wheel: { running: true } } }, 1)?.state, "running");
  assert.equal(parseStatus({ rpm: 140 }, 1)?.state, "running", "falls back to RPM");
  const full = parseStatus({ wheel: { state: "spinning", rpm: "132" }, block: { height: "1,204" } }, 5);
  assert.deepEqual(full, { state: "running", rpm: 132, height: 1204, at: 5 });
});

test("parseStatus refuses payloads without a wheel state", () => {
  assert.equal(parseStatus({ status: "ok" }, 1), null);
  assert.equal(parseStatus(null, 1), null);
  assert.equal(parseStatus("running", 1), null);
});

// Trimmed from GET https://api.squeekchain.com/v1/status, 2026-11-05.
const liveStatus = (/** @type {Record<string, unknown>} */ measurement) => ({
  schemaVersion: 1,
  measurement: { freshness: "online", coreStatus: "IDLE", rpmMilli: 0, speedMmPerSecond: 0, ...measurement },
  builder: { status: "available", anchor: { blockHeight: "366", blockProgress: "425653103" } },
  oracle: { state: "accepted" },
  settlementQueue: { status: "available", state: "empty" },
  modules: [{ instanceId: "wheel", state: "ready", data: {} }],
});

test("parseStatus reads the live Squeekchain measurement shape", () => {
  assert.deepEqual(
    parseStatus(
      {
        measurement: { freshness: "online", coreStatus: "IDLE", rpmMilli: 0 },
        builder: { status: "available", anchor: { blockHeight: 366 } },
        oracle: { state: "accepted" },
        settlementQueue: { status: "available", state: "empty" },
      },
      7,
    ),
    { state: "sleeping", rpm: 0, height: 366, at: 7 },
  );
  assert.deepEqual(parseStatus(liveStatus({}), 1), { state: "sleeping", rpm: 0, height: 366, at: 1 }, "string block height");
  assert.deepEqual(parseStatus(liveStatus({ coreStatus: "ACTIVE", rpmMilli: 84500 }), 1), { state: "running", rpm: 84.5, height: 366, at: 1 });
  assert.equal(parseStatus(liveStatus({ coreStatus: "SPINNING", rpmMilli: "120000" }), 1)?.state, "running");
});

test("parseStatus treats a stale or faulted measurement as no reading", () => {
  assert.equal(parseStatus(liveStatus({ freshness: "stale" }), 1), null);
  assert.equal(parseStatus(liveStatus({ freshness: "offline", coreStatus: "ACTIVE", rpmMilli: 90000 }), 1), null);
  assert.equal(parseStatus(liveStatus({ coreStatus: "COUNTER_FAULT" }), 1), null, "no RPM fallback for a fault");
});

test("parseEconomy reads the live Squeekchain supply and schedule", () => {
  // Values from GET https://api.squeekchain.com/v1/economy/state, 2026-11-05.
  const live = {
    supply: { liveSupplyBaseUnits: "211344792874834038361435307", totalMintedBaseUnits: "211344892876204030802856319" },
    schedule: {
      firstPeriodRateBaseUnits: "2592319617759930871476",
      launchBonusBaseUnits: "105000000000000000000000000",
      bonusBlocks: 97020,
      halvingBlocks: 393470,
      startHeight: 0,
      closedThroughBlock: 366,
      issuedBaseUnits: "1344892876204030802856319",
    },
  };
  const econ = parseEconomy(live);
  assert.ok(econ.supply !== null && Math.abs(econ.supply - 211_344_792.87) < 0.01, `supply ${econ.supply}`);
  assert.ok(econ.reward !== null && Math.abs(econ.reward - 3674.57) < 0.01, `reward ${econ.reward}`);
  // Cross-check: issued so far divided by blocks closed is the same per-block reward.
  assert.ok(Math.abs(econ.reward - 1344892.876204 / 366) < 0.01);

  const afterBonus = parseEconomy({ ...live, schedule: { ...live.schedule, closedThroughBlock: 200000 } });
  assert.ok(afterBonus.reward !== null && Math.abs(afterBonus.reward - 2592.32) < 0.01, `after bonus ${afterBonus.reward}`);
  const pastHalving = parseEconomy({ ...live, schedule: { ...live.schedule, closedThroughBlock: 400000 } });
  assert.equal(pastHalving.reward, null, "no guess past the first halving");
  assert.equal(parseEconomy({ supply: {}, schedule: {} }).supply, null);
});

test("adoptPlayer hands a guest's pick, stats and results to their new name", () => {
  const save = emptySave();
  placePick(save, "Guest", "run", roundStart(R) + 10_000);
  advance(save, obs("sleeping", roundStart(R + 1) + 1000), roundStart(R + 1) + 1000);
  advance(save, obs("running", roundStart(R + 1) + 20_000), roundStart(R + 1) + 20_000);
  placePick(save, "Guest", "sleep", roundStart(R + 1) + 30_000);
  assert.equal(adoptPlayer(save, "Guest", "Ana"), true);
  assert.equal(pickFor(save, R + 2, "Ana"), "sleep");
  assert.equal(pickFor(save, R + 2, "Guest"), null);
  assert.equal(save.players.Ana.points, POINTS_FLIP);
  assert.equal(save.players.Guest, undefined);
  assert.equal(save.rounds[String(R + 1)].results.Ana.points, POINTS_FLIP);
  assert.deepEqual(leaderboard(save).map((p) => p.name), ["Ana"]);
  // An existing name is another player: nothing moves.
  placePick(save, "Guest", "run", roundStart(R + 1) + 40_000);
  assert.equal(adoptPlayer(save, "Guest", "Ana"), false);
  assert.equal(pickFor(save, R + 2, "Guest"), "run");
});

test("parseEconomy finds supply and reward", () => {
  assert.deepEqual(parseEconomy({ sqk: { total_supply: 21000, block_reward: 50 } }), { supply: 21000, reward: 50 });
  assert.deepEqual(parseEconomy({}), { supply: null, reward: null });
});

test("a pick placed during round N counts for round N + 1", () => {
  const save = emptySave();
  const target = placePick(save, "Ana", "run", roundStart(R) + 30_000);
  assert.equal(target, R + 1);
  assert.equal(pickFor(save, R + 1, "Ana"), "run");
  placePick(save, "Ana", "sleep", roundStart(R) + 60_000);
  assert.equal(pickFor(save, R + 1, "Ana"), "sleep", "switching before the lock replaces the pick");
});

test("held round: correct pick earns POINTS_HELD, wrong pick earns nothing", () => {
  const save = emptySave();
  placePick(save, "Ana", "run", roundStart(R) + 10_000);
  placePick(save, "Bo", "sleep", roundStart(R) + 10_000);
  advance(save, obs("running", roundStart(R + 1) + 2000), roundStart(R + 1) + 2000);
  advance(save, obs("running", roundEnd(R + 1) - 3000), roundEnd(R + 1) - 3000);
  const settled = advance(save, obs("running", roundEnd(R + 1) + 2000), roundEnd(R + 1) + 2000);
  const round = settled.find((r) => r.id === R + 1);
  assert.ok(round);
  assert.equal(round.outcome, "held");
  assert.equal(save.players.Ana.points, POINTS_HELD);
  assert.equal(save.players.Bo.points, 0);
  assert.equal(save.players.Bo.played, 1);
  assert.equal(leaderboard(save)[0].name, "Ana");
});

test("a flip mid-round settles early and pays POINTS_FLIP", () => {
  const save = emptySave();
  placePick(save, "Ana", "run", roundStart(R) + 10_000);
  advance(save, obs("sleeping", roundStart(R + 1) + 1000), roundStart(R + 1) + 1000);
  const settled = advance(save, obs("running", roundStart(R + 1) + 50_000), roundStart(R + 1) + 50_000);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].outcome, "flipped");
  assert.equal(settled[0].end, "running");
  assert.equal(save.players.Ana.points, POINTS_FLIP);
  assert.equal(history(save)[0].id, R + 1);
});

test("no reading at the start voids the round without cost", () => {
  const save = emptySave();
  placePick(save, "Ana", "run", roundStart(R) + 10_000);
  // First reading arrives 40 s into the round: too late to record the start.
  advance(save, obs("running", roundStart(R + 1) + 40_000), roundStart(R + 1) + 40_000);
  const settled = advance(save, obs("running", roundEnd(R + 1) + 1000), roundEnd(R + 1) + 1000);
  const round = settled.find((r) => r.id === R + 1);
  assert.equal(round?.outcome, "void");
  assert.equal(save.players.Ana.points, 0);
  assert.equal(save.players.Ana.played, 0);
  assert.equal(round?.results.Ana.points, 0);
});

test("no reading near the end voids the round after the grace period", () => {
  const save = emptySave();
  placePick(save, "Ana", "sleep", roundStart(R) + 10_000);
  advance(save, obs("sleeping", roundStart(R + 1) + 1000), roundStart(R + 1) + 1000);
  // Feed goes quiet; the page ticks with the stale reading.
  const stale = obs("sleeping", roundStart(R + 1) + 1000);
  assert.equal(advance(save, stale, roundEnd(R + 1) + 5000).length, 0, "waits during the grace period");
  const settled = advance(save, stale, roundEnd(R + 1) + GRACE_MS + 1000);
  assert.equal(settled.find((r) => r.id === R + 1)?.outcome, "void");
});

test("a pick left from a closed page is voided on return", () => {
  const save = emptySave();
  placePick(save, "Ana", "run", roundStart(R) + 10_000);
  const later = roundStart(R + 5) + 1000;
  const settled = advance(save, obs("running", later), later);
  assert.ok(settled.some((r) => r.id === R + 1 && r.outcome === "void"));
  assert.equal(pickFor(save, R + 1, "Ana"), null);
});

test("history keeps 10 rounds, newest first, and hides empty void rounds", () => {
  const save = emptySave();
  for (let i = 0; i < 14; i++) {
    const id = R + i;
    placePick(save, "Ana", "run", roundStart(id - 1) + 1000);
    advance(save, obs("running", roundStart(id) + 1000), roundStart(id) + 1000);
    advance(save, obs("running", roundEnd(id) - 2000), roundEnd(id) - 2000);
  }
  advance(save, obs("running", roundStart(R + 14) + 1000), roundStart(R + 14) + 1000);
  const rows = history(save);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].id, R + 13);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].id > r.id));
  assert.equal(save.players.Ana.points, 14 * POINTS_HELD);
});

test("normalizeSave rejects malformed storage", () => {
  assert.deepEqual(normalizeSave("nope"), emptySave());
  assert.deepEqual(normalizeSave({ version: 2 }), emptySave());
  const ok = normalizeSave({ version: 1, current: "  Ana  ", players: { Ana: { points: "3", correct: 1, played: 2 } }, picks: {}, rounds: {} });
  assert.equal(ok.current, "Ana");
  assert.equal(ok.players.Ana.points, 3);
});

test("formatCountdown", () => {
  assert.equal(formatCountdown(ROUND_MS), "2:00");
  assert.equal(formatCountdown(61_001), "1:02");
  assert.equal(formatCountdown(-5), "0:00");
});
