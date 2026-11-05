// @ts-check
import {
  POLL_MS,
  ROUND_MS,
  advance,
  cleanName,
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
  roundIdAt,
  roundStart,
} from "./game.js";

/** @typedef {import("./game.js").Observation} Observation */
/** @typedef {import("./game.js").Round} Round */
/** @typedef {import("./game.js").SaveData} SaveData */
/** @typedef {import("./game.js").Pick} Pick */

const API = "https://api.squeekchain.com/v1";
const STORAGE_KEY = "squeek-or-sleep:v1";
const ECONOMY_MS = 60_000;
const STALE_MS = 30_000;
const DEFAULT_NAME = "Guest";

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return /** @type {T} */ (el);
}

const el = {
  status: byId("status"),
  statusWho: byId("status-who"),
  statusWord: byId("status-word"),
  statusRpm: byId("status-rpm"),
  statusHeight: byId("status-height"),
  statusFresh: byId("status-fresh"),
  statusAnnounce: byId("status-announce"),
  nextLabel: byId("next-label"),
  countdown: byId("countdown"),
  progressFill: byId("progress-fill"),
  pickState: byId("pick-state"),
  playerName: byId("player-name"),
  changeName: /** @type {HTMLButtonElement} */ (byId("change-name")),
  nameForm: /** @type {HTMLFormElement} */ (byId("name-form")),
  nameInput: /** @type {HTMLInputElement} */ (byId("name-input")),
  nameError: byId("name-error"),
  result: byId("result"),
  resultPoints: byId("result-points"),
  resultText: byId("result-text"),
  inPlay: byId("in-play"),
  boardList: byId("board-list"),
  boardEmpty: byId("board-empty"),
  historyList: byId("history-list"),
  historyEmpty: byId("history-empty"),
  econSupply: byId("econ-supply"),
  econReward: byId("econ-reward"),
  econHeight: byId("econ-height"),
  econNote: byId("econ-note"),
  reset: /** @type {HTMLButtonElement} */ (byId("reset")),
};

/** @type {HTMLButtonElement[]} */
const pickButtons = Array.from(document.querySelectorAll("button[data-pick]"));

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Storage

let storageOk = true;

/** @returns {SaveData} */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeSave(raw ? JSON.parse(raw) : null);
  } catch {
    storageOk = false;
    return emptySave();
  }
}

let lastWritten = "";

function persist() {
  if (!storageOk) return;
  const json = JSON.stringify(save);
  if (json === lastWritten) return;
  try {
    localStorage.setItem(STORAGE_KEY, json);
    lastWritten = json;
  } catch {
    storageOk = false;
  }
}

let save = load();
if (!save.current) save.current = DEFAULT_NAME;

// ---------------------------------------------------------------------------
// Live data

/** @type {Observation | null} */
let latest = null;
/** @type {"connecting" | "ok" | "error" | "unreadable"} */
let feed = "connecting";
let lastAttempt = 0;
/** @type {import("./game.js").HamsterState | "unknown"} */
let shownState = "unknown";

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function getJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function pollStatus() {
  lastAttempt = Date.now();
  try {
    const payload = await getJson(`${API}/status`, POLL_MS - 500);
    const obs = parseStatus(payload, Date.now());
    if (obs) {
      latest = obs;
      feed = "ok";
    } else {
      feed = "unreadable";
    }
  } catch {
    feed = "error";
  }
  tick();
}

async function pollEconomy() {
  try {
    const econ = parseEconomy(await getJson(`${API}/economy/state`, 8000));
    el.econSupply.textContent = econ.supply === null ? "Not reported" : `${numberFormat.format(econ.supply)} SQK`;
    el.econReward.textContent = econ.reward === null ? "Not reported" : `${numberFormat.format(econ.reward)} SQK`;
    el.econNote.textContent = "From api.squeekchain.com, refreshed every minute.";
  } catch {
    if (el.econSupply.textContent === "Loading") {
      el.econSupply.textContent = "Unavailable";
      el.econReward.textContent = "Unavailable";
    }
    el.econNote.textContent = "Unable to reach api.squeekchain.com. Trying again in a minute.";
  }
}

// ---------------------------------------------------------------------------
// Rendering

/** @param {number} id */
function roundLabel(id) {
  return timeFormat.format(new Date(roundStart(id)));
}

/** @param {"running" | "sleeping" | null} state */
function stateWord(state) {
  if (state === "running") return "running";
  if (state === "sleeping") return "asleep";
  return "unknown";
}

/** @param {Pick} pick */
function pickWord(pick) {
  return pick === "run" ? "Squeek" : "Sleep";
}

/** @param {number} now */
function renderStatus(now) {
  const fresh = latest !== null && now - latest.at < STALE_MS;
  /** @type {"running" | "sleeping" | "unknown"} */
  const state = fresh && latest ? latest.state : "unknown";
  el.status.dataset.state = state;

  if (state === "unknown") {
    el.statusWho.textContent = "Wheel status";
    el.statusWord.textContent = feed === "connecting" ? "loading" : "offline";
  } else {
    el.statusWho.textContent = "Squeektoshi is";
    el.statusWord.textContent = stateWord(state);
  }

  if (latest) {
    el.statusRpm.textContent = latest.rpm === null ? "RPM not reported" : `${numberFormat.format(latest.rpm)} RPM`;
    el.statusHeight.textContent = latest.height === null ? "Block not reported" : `Block ${numberFormat.format(latest.height)}`;
    el.econHeight.textContent = latest.height === null ? "Not reported" : numberFormat.format(latest.height);
    const rpm = latest.rpm && latest.rpm > 0 ? latest.rpm : 40;
    el.status.style.setProperty("--spin-duration", `${Math.min(3, Math.max(0.4, 60 / rpm)).toFixed(2)}s`);
  }

  if (feed === "connecting") {
    el.statusFresh.textContent = "Connecting to Squeekchain";
  } else if (feed === "error") {
    el.statusFresh.textContent = latest
      ? `Unable to reach Squeekchain. Last reading ${ago(now - latest.at)}. Retrying every 5 seconds.`
      : "Unable to reach Squeekchain. Retrying every 5 seconds.";
  } else if (feed === "unreadable") {
    el.statusFresh.textContent = "Squeekchain answered without a wheel state. Retrying every 5 seconds.";
  } else if (latest) {
    el.statusFresh.textContent = `Updated ${ago(now - latest.at)}`;
  }

  if (state !== shownState) {
    if (shownState !== "unknown" && state !== "unknown") {
      el.statusAnnounce.textContent = `Squeektoshi is now ${stateWord(state)}.`;
    }
    shownState = state;
  }
}

/** @param {number} ms */
function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 2) return "just now";
  if (s < 60) return `${s} s ago`;
  return `${Math.round(s / 60)} min ago`;
}

/** @param {number} now */
function renderRound(now) {
  const currentId = roundIdAt(now);
  const nextId = currentId + 1;
  const left = roundEnd(currentId) - now;
  el.countdown.textContent = formatCountdown(left);
  el.nextLabel.textContent = roundLabel(nextId);
  el.progressFill.style.inlineSize = `${(((now - roundStart(currentId)) / ROUND_MS) * 100).toFixed(1)}%`;

  const mine = pickFor(save, nextId, save.current);
  for (const button of pickButtons) {
    const pressed = button.dataset.pick === mine;
    button.setAttribute("aria-pressed", String(pressed));
    const hint = /** @type {HTMLElement | null} */ (button.querySelector(".pick-hint"));
    if (hint) hint.textContent = pressed ? "Your pick" : hint.dataset.hint ?? "";
  }
  const pickText = mine
    ? `You picked ${pickWord(mine)} for the ${roundLabel(nextId)} round. You can switch until the countdown ends.`
    : "No pick yet. You can change it until the countdown ends.";
  if (el.pickState.textContent !== pickText) el.pickState.textContent = pickText;

  // The round in play right now.
  const current = save.rounds[String(currentId)];
  const lockedPick = pickFor(save, currentId, save.current);
  const yours = lockedPick ? ` Your pick: ${pickWord(lockedPick)}.` : "";
  let inPlay;
  if (!current || current.start === null) {
    inPlay = now - roundStart(currentId) > 15_000
      ? `The ${roundLabel(currentId)} round started before this page had a reading, so it is not scored.${yours}`
      : `The ${roundLabel(currentId)} round is starting.${yours}`;
  } else if (current.settled) {
    inPlay = `The ${roundLabel(currentId)} round already settled: the wheel changed state.`;
  } else {
    inPlay = `In play: the ${roundLabel(currentId)} round started with Squeektoshi ${stateWord(current.start)}.${yours}`;
  }
  if (el.inPlay.textContent !== inPlay) el.inPlay.textContent = inPlay;
}

/** @param {Round} round */
function describeRound(round) {
  if (round.outcome === "void") return `Not scored: ${(round.voidReason ?? "missing reading").toLowerCase()}`;
  if (round.outcome === "flipped") return `${capital(stateWord(round.start))} to ${stateWord(round.end)}`;
  return `Stayed ${stateWord(round.end)}`;
}

/** @param {string} s */
function capital(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** @param {Round[]} settled */
function showResult(settled) {
  const round = settled[settled.length - 1];
  if (!round) return;
  const mine = round.results[save.current];
  let kind = "info";
  let points = "";
  let text = "";
  const label = `The ${roundLabel(round.id)} round`;
  if (round.outcome === "void") {
    if (!mine) return;
    kind = "void";
    points = "0";
    text = `${label} was not scored: ${(round.voidReason ?? "missing reading").toLowerCase()}. Your pick costs nothing.`;
  } else if (mine && mine.correct) {
    kind = "win";
    points = `+${mine.points}`;
    text = round.outcome === "flipped"
      ? `You called it. Squeektoshi went from ${stateWord(round.start)} to ${stateWord(round.end)}.`
      : `Right again. Squeektoshi stayed ${stateWord(round.end)}.`;
  } else if (mine) {
    kind = "miss";
    points = "0";
    text = `Not this time. Squeektoshi ended ${stateWord(round.end)}. Nothing lost; pick again.`;
  } else {
    if (round.start === null) return;
    points = round.outcome === "flipped" ? "Flip" : "Held";
    text = `${label} settled: ${describeRound(round).toLowerCase()}. Pick Squeek or Sleep to score the next one.`;
  }
  el.result.dataset.kind = kind;
  el.resultPoints.textContent = points;
  el.resultText.textContent = text;
  // Restart the one-shot pop animation.
  el.result.dataset.pop = "false";
  void el.result.offsetWidth;
  el.result.dataset.pop = "true";
}

function renderBoard() {
  const rows = leaderboard(save);
  el.boardList.replaceChildren(
    ...rows.slice(0, 10).map((p, i) => {
      const li = document.createElement("li");
      li.dataset.you = String(p.name === save.current);
      const rank = document.createElement("span");
      rank.className = "board-rank";
      rank.textContent = `${i + 1}.`;
      const name = document.createElement("span");
      name.className = "board-name";
      name.textContent = p.name === save.current ? `${p.name} (you)` : p.name;
      const detail = document.createElement("small");
      detail.textContent = `${p.correct} of ${p.played} right`;
      name.append(detail);
      const points = document.createElement("span");
      points.className = "board-points";
      points.textContent = p.points === 1 ? "1 pt" : `${p.points} pts`;
      li.append(rank, name, points);
      return li;
    }),
  );
  el.boardEmpty.hidden = rows.length > 0;
  el.boardList.hidden = rows.length === 0;
}

function renderHistory() {
  const rounds = history(save);
  el.historyList.replaceChildren(
    ...rounds.map((round) => {
      const li = document.createElement("li");
      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent = roundLabel(round.id);

      const detail = document.createElement("span");
      detail.className = "history-detail";
      if (round.outcome === "void") {
        detail.textContent = describeRound(round);
      } else {
        const start = document.createElement("span");
        start.className = round.start === "running" ? "tag-run" : "tag-sleep";
        start.textContent = capital(stateWord(round.start));
        const end = document.createElement("span");
        end.className = round.end === "running" ? "tag-run" : "tag-sleep";
        end.textContent = stateWord(round.end);
        detail.append(start, " to ", end, round.outcome === "flipped" ? " (flip)" : " (held)");
      }
      const mine = round.results[save.current];
      const sub = document.createElement("small");
      sub.textContent = mine ? `Your pick: ${pickWord(mine.pick)}` : "No pick";
      detail.append(sub);

      const points = document.createElement("span");
      points.className = "history-points";
      points.dataset.win = String(Boolean(mine && mine.correct));
      points.textContent = mine ? (mine.correct ? `+${mine.points}` : "0") : "";
      li.append(time, detail, points);
      return li;
    }),
  );
  el.historyEmpty.hidden = rounds.length > 0;
  el.historyList.hidden = rounds.length === 0;
}

function renderPlayer() {
  el.playerName.textContent = save.current;
}

let lastBoardKey = "";

function tick() {
  const now = Date.now();
  // The engine checks each reading's timestamp, so passing an old one again is harmless.
  const settled = advance(save, latest, now);
  if (settled.length) showResult(settled);
  persist();
  render(now, settled.length);
}

/**
 * @param {number} now
 * @param {number} [settledCount]
 */
function render(now, settledCount = 0) {
  renderStatus(now);
  renderRound(now);
  const boardKey = JSON.stringify([save.current, save.players, Object.keys(save.rounds).length, settledCount]);
  if (boardKey !== lastBoardKey) {
    lastBoardKey = boardKey;
    renderBoard();
    renderHistory();
  }
}

// ---------------------------------------------------------------------------
// Interactions

for (const button of pickButtons) {
  button.addEventListener("click", () => {
    const pick = /** @type {Pick} */ (button.dataset.pick);
    placePick(save, save.current, pick, Date.now());
    persist();
    lastBoardKey = "";
    tick();
  });
}

el.changeName.addEventListener("click", () => {
  const open = el.nameForm.hidden;
  el.nameForm.hidden = !open;
  el.changeName.setAttribute("aria-expanded", String(open));
  el.changeName.textContent = open ? "Cancel" : "Change name";
  if (open) {
    el.nameInput.value = save.current === DEFAULT_NAME ? "" : save.current;
    el.nameInput.removeAttribute("aria-invalid");
    el.nameError.textContent = "";
    el.nameInput.focus();
  }
});

el.nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = cleanName(el.nameInput.value);
  if (!name) {
    el.nameInput.setAttribute("aria-invalid", "true");
    el.nameError.textContent = "Enter a name with at least one letter or number.";
    el.nameInput.focus();
    return;
  }
  save.current = name;
  persist();
  el.nameForm.hidden = true;
  el.changeName.setAttribute("aria-expanded", "false");
  el.changeName.textContent = "Change name";
  renderPlayer();
  lastBoardKey = "";
  tick();
  el.changeName.focus();
});

el.nameForm.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    el.nameForm.hidden = true;
    el.changeName.setAttribute("aria-expanded", "false");
    el.changeName.textContent = "Change name";
    el.changeName.focus();
  }
});

el.reset.addEventListener("click", () => {
  const ok = window.confirm("Clear every score, pick and round saved in this browser? This cannot be undone.");
  if (!ok) return;
  const current = save.current;
  save = emptySave();
  save.current = current;
  persist();
  el.result.dataset.kind = "none";
  lastBoardKey = "";
  tick();
});

// Another tab on this device changed the save: pick it up. Render only; writing back here
// would make two open tabs answer each other's writes forever.
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  const current = save.current;
  save = load();
  save.current = current;
  lastWritten = JSON.stringify(save);
  lastBoardKey = "";
  render(Date.now());
});

// ---------------------------------------------------------------------------
// Start

renderPlayer();
if (!storageOk) {
  el.boardEmpty.textContent = "This browser blocks local storage, so scores last only until you close the page.";
}
tick();
pollStatus();
pollEconomy();
setInterval(() => {
  // Skip a beat if the previous request is still within its timeout.
  if (Date.now() - lastAttempt >= POLL_MS - 100) pollStatus();
}, POLL_MS);
setInterval(pollEconomy, ECONOMY_MS);
setInterval(tick, 1000);
