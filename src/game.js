// @ts-check
/**
 * Pure game logic for Squeek or Sleep. No DOM access, so it runs in Node tests too.
 *
 * Rounds are fixed 2-minute windows aligned to the clock: round id = floor(ms / ROUND_MS).
 * While round N is in play, players pick for round N + 1. Picks lock when N + 1 starts.
 * At the start of a round the hamster's state is recorded; the round settles early if the
 * state flips, otherwise at the end of the window with the last state observed.
 */

export const ROUND_MS = 120_000;
/** How long after a round boundary an observation still counts as "the state at that moment". */
export const GRACE_MS = 15_000;
export const POLL_MS = 5_000;
export const POINTS_HELD = 1;
export const POINTS_FLIP = 3;
export const HISTORY_SIZE = 10;
export const MAX_NAME = 20;

/** @typedef {"running" | "sleeping"} HamsterState */
/** @typedef {"run" | "sleep"} Pick */

/**
 * @typedef {object} Observation
 * @property {HamsterState} state
 * @property {number | null} rpm
 * @property {number | null} height
 * @property {number} at  time the reading arrived, ms since epoch
 */

/**
 * @typedef {object} PlayerResult
 * @property {Pick} pick
 * @property {number} points
 * @property {boolean} correct
 */

/**
 * @typedef {object} Round
 * @property {number} id
 * @property {HamsterState | null} start
 * @property {number | null} startHeight
 * @property {Observation | null} last
 * @property {HamsterState | null} end
 * @property {number | null} endHeight
 * @property {boolean} settled
 * @property {"flipped" | "held" | "void" | null} outcome
 * @property {string | null} voidReason
 * @property {number | null} settledAt
 * @property {Record<string, PlayerResult>} results
 */

/**
 * @typedef {object} PlayerStats
 * @property {number} points
 * @property {number} correct
 * @property {number} played
 */

/**
 * @typedef {object} SaveData
 * @property {number} version
 * @property {string} current
 * @property {Record<string, PlayerStats>} players
 * @property {Record<string, Record<string, Pick>>} picks  round id -> player -> pick
 * @property {Record<string, Round>} rounds
 */

/**
 * @typedef {object} SettleEvent
 * @property {Round} round
 */

// ---------------------------------------------------------------------------
// API parsing

/**
 * Lower-case a key and drop separators so `block_height`, `blockHeight` and
 * `Block-Height` all compare equal.
 * @param {string} key
 */
function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Breadth-first search for the first key (in priority order) anywhere in the payload.
 * @param {unknown} root
 * @param {string[]} names normalized key names, most specific first
 * @param {number} [maxDepth]
 * @returns {unknown}
 */
export function findValue(root, names, maxDepth = 4) {
  if (!root || typeof root !== "object") return undefined;
  /** @type {{ value: Record<string, unknown>, depth: number }[]} */
  const queue = [{ value: /** @type {Record<string, unknown>} */ (root), depth: 0 }];
  /** @type {Map<string, unknown>} */
  const found = new Map();
  while (queue.length) {
    const item = /** @type {{ value: Record<string, unknown>, depth: number }} */ (queue.shift());
    for (const [key, value] of Object.entries(item.value)) {
      const norm = normalizeKey(key);
      if (names.includes(norm) && !found.has(norm) && value !== null && value !== undefined && typeof value !== "object") {
        found.set(norm, value);
      }
      if (value && typeof value === "object" && !Array.isArray(value) && item.depth < maxDepth) {
        queue.push({ value: /** @type {Record<string, unknown>} */ (value), depth: item.depth + 1 });
      }
    }
  }
  for (const name of names) {
    if (found.has(name)) return found.get(name);
  }
  return undefined;
}

/**
 * Read a finite number from a number or numeric string.
 * @param {unknown} value
 * @returns {number | null}
 */
export function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/[,_\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const RUNNING_WORDS = ["running", "run", "spinning", "spin", "active", "awake", "on", "moving", "turning"];
const SLEEPING_WORDS = ["stopped", "stop", "sleeping", "asleep", "sleep", "idle", "resting", "rest", "off", "still", "paused", "napping"];

/**
 * Map a status word or boolean to a hamster state.
 * @param {unknown} value
 * @returns {HamsterState | null}
 */
export function toHamsterState(value) {
  if (typeof value === "boolean") return value ? "running" : "sleeping";
  if (typeof value !== "string") return null;
  const word = value.trim().toLowerCase();
  if (RUNNING_WORDS.includes(word)) return "running";
  if (SLEEPING_WORDS.includes(word)) return "sleeping";
  return null;
}

const STATE_KEYS = [
  "wheelstatus", "wheelstate", "hamsterstate", "hamsterstatus", "status", "state", "wheel", "activity",
];
const RUNNING_FLAG_KEYS = ["isrunning", "running", "wheelrunning", "spinning", "isspinning"];
const RPM_KEYS = ["rpm", "wheelrpm", "currentrpm", "speedrpm"];
const HEIGHT_KEYS = ["blockheight", "height", "latestblock", "currentblock", "blocknumber", "block", "tip"];

/**
 * Turn the /v1/status payload into an observation. Field names are matched loosely
 * (snake_case, camelCase, nested under `wheel` or `hamster`). Returns null when the
 * payload says nothing usable about the wheel, so the UI never invents a state.
 * @param {unknown} payload
 * @param {number} at
 * @returns {Observation | null}
 */
export function parseStatus(payload, at) {
  if (!payload || typeof payload !== "object") return null;
  const obj = /** @type {Record<string, unknown>} */ (payload);
  const height = toNumber(findValue(payload, HEIGHT_KEYS));

  // The live Squeekchain shape: the wheel reading sits in `measurement`, with the state in
  // `coreStatus` (ACTIVE / IDLE / COUNTER_FAULT ...) and the speed in thousandths of an RPM.
  // A reading that is not fresh, or a status that is neither running nor idle, is no reading.
  const measurement = obj.measurement;
  if (measurement && typeof measurement === "object" && !Array.isArray(measurement)) {
    const m = /** @type {Record<string, unknown>} */ (measurement);
    if (m.freshness !== undefined && m.freshness !== "online") return null;
    const measured = toHamsterState(m.coreStatus);
    if (!measured) return null;
    const milli = toNumber(m.rpmMilli);
    return { state: measured, rpm: milli === null ? null : milli / 1000, height, at };
  }

  const rpm = toNumber(findValue(payload, RPM_KEYS));
  /** @type {HamsterState | null} */
  let state = null;
  // A `wheel` object usually carries the state, so look there before the top-level `status`,
  // which some APIs use for request health ("ok").
  for (const scope of [obj.wheel, obj.hamster, obj.data, obj]) {
    if (state || !scope || typeof scope !== "object") continue;
    for (const key of STATE_KEYS) {
      const candidate = toHamsterState(findValue(scope, [key], 1));
      if (candidate) {
        state = candidate;
        break;
      }
    }
    if (!state) {
      const flag = findValue(scope, RUNNING_FLAG_KEYS, 1);
      if (typeof flag === "boolean") state = flag ? "running" : "sleeping";
    }
  }
  if (!state && rpm !== null) state = rpm > 0 ? "running" : "sleeping";
  if (!state) return null;
  return { state, rpm, height, at };
}

/**
 * @typedef {object} Economy
 * @property {number | null} supply
 * @property {number | null} reward
 */

/** SQK has 18 decimals; the API reports amounts in base units as decimal strings. */
const SQK_DECIMALS = 18;

/**
 * Convert a base-unit amount (string or number) to whole SQK, or null.
 * @param {unknown} value
 * @returns {number | null}
 */
export function fromBaseUnits(value) {
  const n = toNumber(value);
  return n === null ? null : n / 10 ** SQK_DECIMALS;
}

/**
 * Reward for the next block from the emission schedule. During the first `bonusBlocks`
 * blocks the launch bonus is spread evenly on top of the first-period rate; after that the
 * first-period rate holds until `halvingBlocks`. Past that the API does not say what the
 * rate becomes, so this returns null instead of guessing.
 * @param {Record<string, unknown>} schedule
 * @returns {number | null}
 */
export function scheduleReward(schedule) {
  const rate = toNumber(schedule.firstPeriodRateBaseUnits);
  const closed = toNumber(schedule.closedThroughBlock);
  if (rate === null || closed === null) return null;
  const block = closed - (toNumber(schedule.startHeight) ?? 0);
  const bonus = toNumber(schedule.launchBonusBaseUnits) ?? 0;
  const bonusBlocks = toNumber(schedule.bonusBlocks) ?? 0;
  const halvingBlocks = toNumber(schedule.halvingBlocks);
  let reward = rate;
  if (bonusBlocks > 0 && block < bonusBlocks) reward += bonus / bonusBlocks;
  else if (halvingBlocks !== null && block >= halvingBlocks) return null;
  return reward / 10 ** SQK_DECIMALS;
}

/**
 * @param {unknown} payload
 * @returns {Economy}
 */
export function parseEconomy(payload) {
  const obj = payload && typeof payload === "object" ? /** @type {Record<string, any>} */ (payload) : {};
  // The live Squeekchain shape: `supply` and `schedule` objects with amounts in base units.
  if (obj.supply && typeof obj.supply === "object") {
    const supply = fromBaseUnits(obj.supply.liveSupplyBaseUnits ?? obj.supply.totalMintedBaseUnits);
    const reward = obj.schedule && typeof obj.schedule === "object" ? scheduleReward(obj.schedule) : null;
    return { supply, reward };
  }
  return {
    supply: toNumber(findValue(payload, ["circulatingsupply", "totalsupply", "sqksupply", "supply", "minted", "totalminted"])),
    reward: toNumber(findValue(payload, ["blockreward", "currentblockreward", "rewardperblock", "reward", "blocksubsidy", "subsidy"])),
  };
}

// ---------------------------------------------------------------------------
// Rounds

/** @param {number} ms */
export function roundIdAt(ms) {
  return Math.floor(ms / ROUND_MS);
}

/** @param {number} id */
export function roundStart(id) {
  return id * ROUND_MS;
}

/** @param {number} id */
export function roundEnd(id) {
  return (id + 1) * ROUND_MS;
}

/** @returns {SaveData} */
export function emptySave() {
  return { version: 1, current: "", players: {}, picks: {}, rounds: {} };
}

/**
 * Validate data read back from localStorage; anything malformed becomes a fresh save.
 * @param {unknown} raw
 * @returns {SaveData}
 */
export function normalizeSave(raw) {
  const save = emptySave();
  if (!raw || typeof raw !== "object") return save;
  const r = /** @type {Record<string, any>} */ (raw);
  if (r.version !== 1) return save;
  if (typeof r.current === "string") save.current = cleanName(r.current);
  if (r.players && typeof r.players === "object") {
    for (const [name, stats] of Object.entries(r.players)) {
      if (!stats || typeof stats !== "object") continue;
      save.players[name] = {
        points: Number(stats.points) || 0,
        correct: Number(stats.correct) || 0,
        played: Number(stats.played) || 0,
      };
    }
  }
  if (r.picks && typeof r.picks === "object") save.picks = r.picks;
  if (r.rounds && typeof r.rounds === "object") save.rounds = r.rounds;
  return save;
}

/**
 * Trim and collapse whitespace; cap the length.
 * @param {string} name
 */
export function cleanName(name) {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

/**
 * @param {number} id
 * @returns {Round}
 */
function newRound(id) {
  return {
    id,
    start: null,
    startHeight: null,
    last: null,
    end: null,
    endHeight: null,
    settled: false,
    outcome: null,
    voidReason: null,
    settledAt: null,
    results: {},
  };
}

/**
 * Record a pick for the round after the one in play. Returns the round id the pick is for.
 * @param {SaveData} save
 * @param {string} player
 * @param {Pick} pick
 * @param {number} now
 */
export function placePick(save, player, pick, now) {
  const target = roundIdAt(now) + 1;
  const key = String(target);
  if (!save.picks[key]) save.picks[key] = {};
  save.picks[key][player] = pick;
  if (!save.players[player]) save.players[player] = { points: 0, correct: 0, played: 0 };
  return target;
}

/**
 * Hand everything recorded under `from` (stats, open picks, round results) to `to`.
 * Used when a guest names themselves, so one person's points do not split across two
 * rows. Does nothing if `to` already has a record: that is a different player.
 * @param {SaveData} save
 * @param {string} from
 * @param {string} to
 * @returns {boolean} whether anything moved
 */
export function adoptPlayer(save, from, to) {
  if (from === to || save.players[to]) return false;
  let moved = false;
  if (save.players[from]) {
    save.players[to] = save.players[from];
    delete save.players[from];
    moved = true;
  }
  for (const picks of Object.values(save.picks)) {
    if (picks && from in picks) {
      picks[to] = picks[from];
      delete picks[from];
      moved = true;
    }
  }
  for (const round of Object.values(save.rounds)) {
    if (round && round.results && from in round.results) {
      round.results[to] = round.results[from];
      delete round.results[from];
      moved = true;
    }
  }
  return moved;
}

/**
 * The pick a player holds for a round, if any.
 * @param {SaveData} save
 * @param {number} id
 * @param {string} player
 * @returns {Pick | null}
 */
export function pickFor(save, id, player) {
  return save.picks[String(id)]?.[player] ?? null;
}

/**
 * Score one round and update player totals.
 * @param {SaveData} save
 * @param {Round} round
 * @param {number} now
 */
function settle(save, round, now) {
  round.settled = true;
  round.settledAt = now;
  const picks = save.picks[String(round.id)] ?? {};
  for (const [player, pick] of Object.entries(picks)) {
    if (!save.players[player]) save.players[player] = { points: 0, correct: 0, played: 0 };
    const stats = save.players[player];
    if (round.outcome === "void" || !round.end) {
      round.results[player] = { pick, points: 0, correct: false };
      continue;
    }
    const wanted = pick === "run" ? "running" : "sleeping";
    const correct = wanted === round.end;
    const points = correct ? (round.outcome === "flipped" ? POINTS_FLIP : POINTS_HELD) : 0;
    round.results[player] = { pick, points, correct };
    stats.played += 1;
    if (correct) {
      stats.correct += 1;
      stats.points += points;
    }
  }
  delete save.picks[String(round.id)];
}

/**
 * Advance the round engine. Call it with every new observation (or null when a poll
 * failed) and on a clock tick. Returns the rounds that settled during this call.
 * @param {SaveData} save
 * @param {Observation | null} obs latest successful reading, if any
 * @param {number} now
 * @returns {Round[]}
 */
export function advance(save, obs, now) {
  /** @type {Round[]} */
  const settledNow = [];
  const currentId = roundIdAt(now);

  // Make sure the round in play exists and record its start state.
  const key = String(currentId);
  if (!save.rounds[key]) save.rounds[key] = newRound(currentId);
  const current = save.rounds[key];
  if (!current.settled && current.start === null && obs) {
    const inWindow = obs.at >= roundStart(currentId) - GRACE_MS && obs.at <= roundStart(currentId) + GRACE_MS;
    if (inWindow && now <= roundStart(currentId) + GRACE_MS) {
      current.start = obs.state;
      current.startHeight = obs.height;
    }
  }
  if (
    !current.settled &&
    obs &&
    obs.at >= roundStart(currentId) &&
    obs.at < roundEnd(currentId) &&
    (!current.last || obs.at > current.last.at)
  ) {
    current.last = obs;
  }
  // Early settle: the state flipped mid-round.
  if (!current.settled && current.start !== null && current.last && current.last.state !== current.start) {
    current.end = current.last.state;
    current.endHeight = current.last.height;
    current.outcome = "flipped";
    settle(save, current, now);
    settledNow.push(current);
  }

  // Settle every earlier round still open.
  for (const round of Object.values(save.rounds)) {
    if (round.settled || round.id >= currentId) continue;
    if (round.start === null) {
      round.outcome = "void";
      round.voidReason = "No reading at the start";
    } else if (!round.last || round.last.at < roundEnd(round.id) - GRACE_MS) {
      // A reading taken just after the boundary still describes the end of the window.
      if (obs && obs.at >= roundEnd(round.id) && obs.at <= roundEnd(round.id) + GRACE_MS && now <= roundEnd(round.id) + GRACE_MS) {
        round.end = obs.state;
        round.endHeight = obs.height;
        round.outcome = obs.state === round.start ? "held" : "flipped";
      } else if (now <= roundEnd(round.id) + GRACE_MS) {
        continue; // still waiting for an end reading
      } else {
        round.outcome = "void";
        round.voidReason = "No reading at the end";
      }
    } else {
      round.end = round.last.state;
      round.endHeight = round.last.height;
      round.outcome = round.end === round.start ? "held" : "flipped";
    }
    settle(save, round, now);
    settledNow.push(round);
  }

  // Picks left for rounds that already ended without a record (page was closed) are void.
  for (const id of Object.keys(save.picks)) {
    const n = Number(id);
    if (n < currentId && !save.rounds[id]) {
      const round = newRound(n);
      round.outcome = "void";
      round.voidReason = "Page was closed during the round";
      save.rounds[id] = round;
      settle(save, round, now);
      settledNow.push(round);
    }
  }

  prune(save, currentId);
  return settledNow;
}

/**
 * Keep storage small: the latest settled rounds plus anything still open.
 * @param {SaveData} save
 * @param {number} currentId
 */
function prune(save, currentId) {
  const settled = Object.values(save.rounds)
    .filter((r) => r.settled)
    .sort((a, b) => b.id - a.id);
  for (const r of settled.slice(HISTORY_SIZE * 2)) delete save.rounds[String(r.id)];
  for (const r of Object.values(save.rounds)) {
    if (!r.settled && r.id < currentId - 2) delete save.rounds[String(r.id)];
  }
}

/**
 * Settled rounds, newest first. A void round nobody picked is left out: it is only
 * the partial round in play when the page was opened.
 * @param {SaveData} save
 * @param {number} [limit]
 */
export function history(save, limit = HISTORY_SIZE) {
  return Object.values(save.rounds)
    .filter((r) => r.settled && !(r.outcome === "void" && Object.keys(r.results).length === 0))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

/**
 * Players with at least one pick, best first.
 * @param {SaveData} save
 */
export function leaderboard(save) {
  return Object.entries(save.players)
    .map(([name, s]) => ({ name, ...s }))
    .filter((p) => p.played > 0 || p.points > 0)
    .sort((a, b) => b.points - a.points || b.correct - a.correct || a.played - b.played || a.name.localeCompare(b.name));
}

/**
 * Format remaining milliseconds as m:ss.
 * @param {number} ms
 */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
