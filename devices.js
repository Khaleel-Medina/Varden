// Devices — optional hardware that reacts to a reply while it streams in.
//
// Three transports, kept apart on purpose because their promises are different:
//   lovense  — the visitor's own phone/PC app opens a local server; no account, no cloud.
//   buttplug — Intiface Central on the visitor's machine; most brands, needs a desktop app.
//   handy    — the vendor's cloud; needs a key, but reaches a stroker from any network.
//
// The only thing that ever travels is one number between 0 and 1. The reply text, the
// card and the persona are not sent anywhere new, which is why this is safe to use on
// the local GPU route as well as the hosted ones.

const LOVENSE_DOMAIN = 'lovense.club';

// The vendor runs two cloud API generations, and the hardware decides which one it speaks:
// firmware 4 (Handy 2 and 2 Pro) answers only on v3, firmware 3 (the original Handy) only on
// v2. A firmware 4 device sent a v2 command does not politely error — the server has no such
// device in its v2 registry — so the generation is negotiated at connect, never assumed.
const HANDY_BASES = {
  v2: 'https://www.handyfeeling.com/api/handy/v2/',
  v3: 'https://www.handyfeeling.com/api/handy-rest/v3/',
};

// Firmware arrives as "430+dcee7e58" or "4.3.0+dcee7e58": a build number plus a build hash.
// 430 means 4.3.0, and the hash is noise in a status line.
function handyFirmwareLabel(raw) {
  const text = String(raw || '').trim();
  const build = text.split('+')[0];
  return /^\d{3}$/.test(build) ? build.split('').join('.') : build;
}

// A Lovense command that expires on its own: a tab that dies stops the toy within two
// seconds instead of leaving it running. An indefinite hold is never sent — that is the
// whole point of this constant.
const LOVENSE_HOLD_SEC = 2;

// Sustained motion has a ceiling. A scene can outlast a reply, but never a forgotten tab.
const SUSTAIN_MAX_MS = 5 * 60 * 1000;
export const REACTION_TICK_MS = 1500;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Scene-synced strokes: faster prose means a shorter half-stroke. 650 ms at rest, 300 ms
// at full intensity. The floor is the rate limit talking: the cloud allows 240 requests a
// minute, and 300 ms half-strokes spend 200 of them, leaving room for the connecting calls.
export function handyHalfPeriod(level) {
  return Math.round(650 - 350 * clamp(Number(level) || 0, 0, 1));
}

// HDSP works in percent of the stroke zone, so a stroke is "be at this end in T ms".
export function handyStrokeTarget(phase, depth = [0, 100]) {
  return phase ? depth[1] : depth[0];
}

/* ---------------- scene tracking ---------------- */

// What the two of them are doing, read off words that have already arrived. Nothing here is
// sent anywhere: the act only ever leaves this page as the pace and depth it selected.
const SCENES = {
  thrust: { label: 'thrusting', half: [300, 520], depth: [0, 100], sustain: 0.55 },
  oral: { label: 'going down', half: [430, 760], depth: [0, 55], sustain: 0.45 },
  hands: { label: 'using hands', half: [480, 900], depth: [0, 60], sustain: 0.4 },
  grind: { label: 'grinding', half: [700, 1100], depth: [15, 80], sustain: 0.5 },
  tease: { label: 'teasing', half: [900, 1400], depth: [0, 30], sustain: 0.3 },
};

const SCENE_CUES = {
  thrust:
    /\b(dogg(y|ie)|from behind|behind (her|him|me)|missionary|cowgirl|reverse cowgirl|riding|ride(s|d)? (him|her|me)|bent over|bend(s|ing)? (her|him|me)? ?over|against the wall|thrust(s|ed|ing)?|pound(s|ed|ing)?|fuck(s|ed|ing)?|ball(s)? deep|spread(s|ing)? (her|his|my) (legs|thighs)|enter(s|ed|ing)? (her|him|me)|inside (her|him|me))\b/i,
  oral: /\b(blow ?job|suck(s|ed|ing)?|mouth|tongue|lick(s|ed|ing)?|throat|swallow(s|ed|ing)?|go(es|ing)? down on|kneel(s|ing|ed)? (down|between))\b/i,
  hands:
    /\b(finger(s|ed|ing)?|hand ?job|jerk(s|ed|ing)? (him|her|me) off|stroke(s|d|ing)? (him|her|me)|palm(s|ed)?|thumb(s)? (over|against))\b/i,
  grind: /\b(grind(s|ed|ing)?|hump(s|ed|ing)?|rub(s|bed|bing)? (against|on|between)|dry hump|thigh(s)? (between|around))\b/i,
  tease:
    /\b(teas(e|es|ed|ing)|kiss(es|ed|ing)?|neck|undress(es|ed|ing)?|strip(s|ped|ping)?|caress(es|ed|ing)?|trail(s|ed|ing)? (a|her|his) (hand|fingers))\b/i,
};

// A stop cue is a scene change to nothing: it ends motion even if the paragraph also said
// doggy style, because it came last.
const SCENE_STOP =
  /\b(stop(s|ped|ping)?|halt(s|ed|ing)?|pull(s|ed|ing)? out|finish(es|ed|ing)?|done|climb(s|ed|ing)? off|get(s|ting)? off|collapse(s|d)?|catch(es|ing)? (her|his|my) breath|after ?glow|no more|not now)\b/i;

// Talking about an act is not doing it. "Can we do doggy style?", "I'd love to try doggy" and
// "Doggy style sounds nice" all mention the act and none of them is happening, so a clause
// has to be a statement and contain something actually being done before it can start one.
const SCENE_QUESTION = /\?\s*$/;
const SCENE_HEDGE =
  /\b(can|could|would|should|shall|may|might|wanna|want to|wants to|want me to|thinking about|thought about|in the mood|how about|what if|if (we|you|i)|maybe|perhaps|ever (tried|done)|propos\w*|suggest\w*|ask(s|ed|ing)?|wonder\w*|imagine|question)\b/i;
const SCENE_ACTION =
  /\b(take|takes|took|taking|grab|grabs|grabbed|grabbing|pull|pulls|pulled|pulling|push|pushes|pushed|pushing|thrust|thrusts|thrusting|drive|drives|drove|slam|slams|slammed|pound|pounds|pounded|fuck|fucks|fucked|fucking|ride|rides|rode|riding|grind|grinds|grinding|hump|humps|humping|suck|sucks|sucked|sucking|lick|licks|licked|licking|kiss|kisses|kissed|kissing|finger|fingers|fingered|fingering|stroke|strokes|stroked|stroking|palm|palms|touch|touches|touched|touching|slide|slides|slid|sliding|press|presses|pressed|pressing|bend|bends|bent|bending|pin|pins|pinned|lift|lifts|lifted|roll|rolls|rolled|wrap|wraps|wrapped|guide|guides|guided|enter|enters|entered|entering|kneel|kneels|knelt|kneeling|spread|spreads|hold|holds|held|holding|pump|pumps|pumped|pumping|move|moves|moved|moving|buck|bucks|bucked|rock|rocks|rocked|arch|arches|arched|clutch|clutches|clutched|grip|grips|gripped|moan|moans|moaned|groan|groans|groaned|gasp|gasps|gasped)\b/i;

function sceneIsTalk(clause) {
  return SCENE_QUESTION.test(clause) || SCENE_HEDGE.test(clause);
}

// The last cue that is actually being performed in this clause, or null when it is only
// being discussed.
function sceneCueIn(clause) {
  if (sceneIsTalk(clause) || !SCENE_ACTION.test(clause)) return null;
  let best = null;
  for (const [act, pattern] of Object.entries(SCENE_CUES)) {
    const at = lastCueIndex(clause, pattern);
    if (at < 0 || (best && at <= best.at)) continue;
    best = { act, at };
  }
  return best;
}

function lastCueIndex(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const scan = new RegExp(pattern.source, flags);
  let best = -1;
  let match;
  while ((match = scan.exec(text))) {
    best = match.index;
    if (match.index === scan.lastIndex) scan.lastIndex += 1;
  }
  return best;
}

// How long a change of act takes to travel. Long enough to feel like a change of rhythm,
// short enough that it is clearly following the text rather than lagging behind it.
const BLEND_MS = 1500;

export class Scene {
  constructor({ now = () => Date.now(), idleMs = 90000, fluid = true } = {}) {
    this.now = now;
    this.idleMs = idleMs;
    this.act = null;
    this.lastAt = 0;
    // Fluid mode eases into a new act; off, it changes between one stroke and the next.
    this.fluid = fluid !== false;
    this.prev = null;
    this.switchedAt = 0;
  }

  setFluid(on) {
    this.fluid = on !== false;
    if (!this.fluid) this.prev = null;
  }

  // Last clause wins, and inside a clause the last cue wins, so "takes you from behind, then
  // stops" ends stopped rather than stuck at the first thing it read. A question about an act
  // changes nothing, and neither does a sentence that only names one.
  observe(text) {
    const chunk = String(text || '');
    if (!chunk) return this.act;
    const clauseRe = /[^.!?;\n]+[.!?;]?/g;
    let best = null;
    let match;
    while ((match = clauseRe.exec(chunk))) {
      const clause = match[0];
      const base = match.index;
      // A question about stopping must not stop anything; a statement about stopping must.
      const stopAt = SCENE_QUESTION.test(clause) ? -1 : lastCueIndex(clause, SCENE_STOP);
      const cue = sceneCueIn(clause);
      if (stopAt >= 0 && (!cue || stopAt >= cue.at)) best = { act: null, at: base + stopAt };
      else if (cue) best = { act: cue.act, at: base + cue.at };
    }
    if (!best) return this.act;
    if (best.act !== this.act) {
      // Freeze wherever the motion currently is, not the act it was heading for, so a change
      // during a change still starts from what the device is doing.
      this.prev = this.act ? this.current() : null;
      this.switchedAt = this.now();
    }
    this.act = best.act;
    this.lastAt = this.now();
    return this.act;
  }

  // The numbers motion actually uses right now: a blend while fluid, the act's own values
  // otherwise. Stop cues leave no target, so they take the fallback profile and stop anyway.
  current() {
    const target = this.profile || SCENES.thrust;
    if (!this.fluid || !this.prev) {
      return { half: target.half, depth: target.depth, sustain: target.sustain };
    }
    const k = clamp((this.now() - this.switchedAt) / BLEND_MS, 0, 1);
    const ease = k * k * (3 - 2 * k);
    const mix = (a, b) => a + (b - a) * ease;
    return {
      half: [mix(this.prev.half[0], target.half[0]), mix(this.prev.half[1], target.half[1])],
      depth: [mix(this.prev.depth[0], target.depth[0]), mix(this.prev.depth[1], target.depth[1])],
      sustain: mix(this.prev.sustain, target.sustain),
    };
  }

  get profile() {
    return this.act ? SCENES[this.act] : null;
  }

  // Empty once the scene has gone quiet: a label is a claim that motion is being followed.
  get label() {
    return this.active ? this.profile.label : '';
  }

  // A scene goes quiet rather than ending on its own: no cue for a minute and a half and the
  // device stops, which is the difference between following a scene and leaving it running.
  get active() {
    return Boolean(this.profile && this.now() - this.lastAt <= this.idleMs);
  }

  pace(level) {
    const half = this.current().half;
    const value = clamp(Number(level) || 0, 0, 1);
    return Math.max(300, Math.round(half[1] - (half[1] - half[0]) * value));
  }

  depth() {
    const depth = this.current().depth;
    return [Math.round(depth[0]), Math.round(depth[1])];
  }

  sustainLevel() {
    return this.current().sustain;
  }
}

async function timedFetch(url, options = {}, ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- reaction mapping ---------------- */

// Turns the stream itself into intensity. Deliberately arithmetic rather than another
// model call: it costs no tokens, works offline, and cannot be steered by a card.
export class Reaction {
  constructor({ cap = 0.6 } = {}) {
    this.cap = clamp(Number(cap) || 0.6, 0.05, 1);
    this.level = 0;
    this.reset();
  }

  reset() {
    this.level = 0;
    this.lastAt = performance.now();
  }

  feed(text) {
    const chunk = String(text || '');
    if (!chunk) return;
    const now = performance.now();
    const seconds = Math.max(0.04, (now - this.lastAt) / 1000);
    this.lastAt = now;

    let heat = 0;
    for (const char of chunk) {
      if (char === '*' || char === '—' || char === '…') heat += 0.5;
      else if (char === '!' || char === '?') heat += 0.35;
      else if (char === '\n') heat += 0.25;
      else if (!/\s/.test(char)) heat += 0.05;
    }

    // Typing speed is the base signal; punctuation-heavy prose keeps it high even when
    // the tokens arrive slowly.
    const rate = chunk.length / seconds;
    const raw = clamp(0.14 + rate / 70 + heat / Math.max(1, chunk.length), 0, 1);

    // Attack fast, release slow, so it follows a heated paragraph without chattering.
    const gain = raw > this.level ? 0.45 : 0.16;
    this.level += (raw - this.level) * gain;
  }

  // Called on every tick: quiet text bleeds off instead of holding at the last peak.
  sample() {
    if (performance.now() - this.lastAt > 1200) this.level += (0 - this.level) * 0.5;
    return this.peek();
  }

  // Reading the level must not advance the decay, or a fast reader would age it faster.
  peek() {
    return clamp(this.level, 0, this.cap);
  }
}

/* ---------------- Lovense (Game Mode, local) ---------------- */

// "192.168.1.24" -> "192-168-1-24": the app's certificate covers a wildcard for
// *.lovense.club, and that name maps back to the LAN address. It is the only way to
// reach the toy from an HTTPS page without mixed-content blocking.
export function lovenseHostName(host) {
  const raw = String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!raw) return '';
  const hostPart = raw.split(':')[0].trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostPart)) return hostPart.replace(/\./g, '-');
  return hostPart;
}

export function lovenseBases(host, port, pageProtocol = 'https:') {
  const raw = String(host || '').trim();
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return [`${url.protocol}//${url.host}`];
    } catch {
      return [];
    }
  }
  const name = lovenseHostName(raw);
  if (!name) return [];
  const chosenPort = Number(port) || 30010;
  const bases = [];
  if (pageProtocol === 'https:') {
    bases.push(`https://${name}.${LOVENSE_DOMAIN}:${chosenPort}`);
  } else {
    // A page served over plain HTTP (localhost development) can talk to the plain port
    // as well, and that is the one older app builds open.
    bases.push(`http://${name}.${LOVENSE_DOMAIN}:${chosenPort}`);
    const address = String(raw).split(':')[0];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) bases.push(`http://${address}:20010`);
  }
  return bases;
}

function readLovenseToys(payload) {
  const data = payload?.data;
  if (!data) return [];
  let toys = data.toys;
  if (typeof toys === 'string') {
    try {
      toys = JSON.parse(toys);
    } catch {
      return [];
    }
  }
  if (!toys || typeof toys !== 'object') return [];
  return Object.entries(toys).map(([id, toy]) => ({
    id,
    name: String(toy?.nickName || toy?.name || 'Lovense toy'),
  }));
}

function lovenseFailure(error, base) {
  const message = String(error?.message || error || '');
  if (/abort/i.test(message)) {
    return `The Lovense server at ${base} did not answer. Game Mode has to be on and the phone has to be on the same Wi-Fi.`;
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return `The browser could not read ${base}. Either the address is wrong, Game Mode is off, or the local-network permission was declined — check the prompt near the address bar.`;
  }
  return `Could not reach the Lovense server (${message || 'unknown error'}).`;
}

class LovenseLink {
  constructor(config) {
    this.kind = 'lovense';
    this.config = config;
    this.base = '';
    this.toys = [];
    this.label = 'Lovense toy';
    this.contentType = '';
  }

  async post(body) {
    const payload = JSON.stringify(body);
    const types = this.contentType ? [this.contentType] : ['text/plain;charset=UTF-8', 'application/json'];
    let lastError = null;
    for (const type of types) {
      try {
        const response = await timedFetch(
          `${this.base}/command`,
          {
            method: 'POST',
            // text/plain keeps the request CORS-safelisted, so a local server that cannot
            // answer an OPTIONS preflight still works. application/json is the fallback for
            // anything that insists on the exact type.
            headers: { 'Content-Type': type },
            body: payload,
          },
          6000
        );
        if (!response.ok) {
          lastError = new Error(`the toy server answered ${response.status}`);
          continue;
        }
        this.contentType = type;
        return await response.json().catch(() => null);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('the toy server did not answer');
  }

  async connect() {
    const bases = lovenseBases(this.config.lovenseHost, this.config.lovensePort, this.config.pageProtocol);
    if (!bases.length) {
      throw new Error('Add the address Lovense Remote shows for Game Mode — it looks like 192.168.1.24.');
    }
    let lastError = null;
    for (const base of bases) {
      this.base = base;
      try {
        const payload = await this.post({ command: 'GetToys', apiVer: 1 });
        this.toys = readLovenseToys(payload);
        this.label = this.toys.length ? this.toys.map((toy) => toy.name).join(', ') : 'Lovense toy';
        return this.label;
      } catch (error) {
        lastError = error;
      }
    }
    this.base = bases[0];
    throw new Error(lovenseFailure(lastError, bases[0]));
  }

  async setLevel(level) {
    // 0-20 is the vibration scale. A short hold refreshes each tick, so the toy stops on
    // its own if this tab disappears.
    const strength = Math.round(clamp(level, 0, 1) * 20);
    const body =
      strength <= 0
        ? { command: 'Function', action: 'Stop', apiVer: 1, stopPrevious: 1 }
        : { command: 'Function', action: `Vibrate:${strength}`, timeSec: LOVENSE_HOLD_SEC, apiVer: 1, stopPrevious: 1 };
    const toy = this.toys[0];
    if (toy?.id) body.toy = toy.id;
    await this.post(body);
  }

  async stop() {
    if (!this.base) return;
    await this.post({ command: 'Function', action: 'Stop', apiVer: 1, stopPrevious: 1 });
  }

  async disconnect() {
    try {
      await this.stop();
    } catch {
      /* already gone */
    }
    this.base = '';
    this.toys = [];
  }
}

/* ---------------- Intiface / Buttplug (local WebSocket) ---------------- */

class ButtplugLink {
  constructor(config) {
    this.kind = 'buttplug';
    this.config = config;
    this.ws = null;
    this.sequence = 0;
    this.devices = [];
    this.label = 'Intiface';
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify([{ Id: ++this.sequence, Message: message }]));
    return true;
  }

  receive(raw) {
    let messages;
    try {
      messages = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(messages)) return;
    for (const entry of messages) {
      const message = entry?.Message;
      if (!message) continue;
      if (message.DeviceAdded) {
        const added = message.DeviceAdded;
        if (!this.devices.some((device) => device.index === added.DeviceIndex)) {
          this.devices.push({
            index: added.DeviceIndex,
            name: String(added.DeviceName || 'toy'),
            // First scalar actuator is the one a chat reaction should drive.
            actuator: String(added.DeviceMessages?.ScalarCmd?.[0]?.Actuator || 'Vibrate'),
          });
        }
      }
      if (message.DeviceRemoved) {
        this.devices = this.devices.filter((device) => device.index !== message.DeviceRemoved.DeviceIndex);
      }
      // Intiface pings to detect dead clients; answering keeps the socket open.
      if (message.Ping) this.send({ Ok: { Id: message.Ping.Id } });
    }
  }

  async connect() {
    const url = String(this.config.buttplugUrl || '').trim() || 'ws://127.0.0.1:12345';
    if (!/^wss?:\/\//i.test(url)) throw new Error('The Intiface address has to start with ws:// or wss://.');
    if (typeof WebSocket !== 'function') throw new Error('This browser cannot open a WebSocket to Intiface.');
    this.devices = [];
    const socket = new WebSocket(url);
    this.ws = socket;
    socket.addEventListener('message', (event) => this.receive(event.data));
    socket.addEventListener('close', () => {
      if (this.ws === socket) this.ws = null;
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Intiface did not answer. Start its server — it listens on port 12345 by default.')),
        6000
      );
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        this.send({ RequestServerInfo: { ClientName: 'Varden', MessageVersion: 3 } });
        this.send({ StartScanning: {} });
        resolve();
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Could not reach Intiface. Is Intiface Central running with its server started?'));
      });
    }).catch((error) => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      throw error;
    });

    // Devices arrive as unsolicited messages after scanning starts, so give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    this.label = this.devices.length
      ? this.devices.map((device) => device.name).join(', ')
      : 'Intiface (no toy found yet)';
    return this.label;
  }

  async setLevel(level) {
    const scalar = clamp(level, 0, 1);
    for (const device of this.devices) {
      this.send({
        ScalarCmd: {
          DeviceIndex: device.index,
          Scalars: [{ Index: 0, Scalar: scalar, Actuator: device.actuator }],
        },
      });
    }
  }

  async stop() {
    this.send({ StopAllDevices: {} });
  }

  async disconnect() {
    this.send({ StopAllDevices: {} });
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
    this.devices = [];
  }
}

/* ---------------- The Handy (vendor cloud) ---------------- */

// Only HAMP is used: it is the one mode that runs continuously with a single speed,
// which maps cleanly onto "intensity". Mode 0 is HAMP in the v2 API.
class HandyLink {
  constructor(config) {
    this.kind = 'handy';
    this.config = config;
    this.label = 'The Handy';
    // 'hamp' is one continuous stroke speed; 'hdsp' is real strokes timed from the text.
    this.mode = config.handyMode === 'hdsp' ? 'hdsp' : 'hamp';
    // 'auto' is the honest default: try what the saved keys allow and believe the device.
    this.preference = ['auto', 'v3', 'v2'].includes(config.handyApi) ? config.handyApi : 'auto';
    // Set by the handshake; every request and every unit depends on it.
    this.api = 'v2';
    this.firmware = '';
    this.hardware = '';
    // Set when the cloud refuses the Application ID, so a failure can say which of the two
    // went wrong instead of blaming the device for a bad key.
    this.authRejected = false;
    // Set by the controller: lets every stroke read the freshest intensity instead of the
    // last one-second-and-a-half snapshot.
    this.levelSource = null;
    this.moving = false;
    this.stroking = false;
    this.activeMode = null;
    this.level = 0;
    this.phase = false;
    this.strokeTimer = 0;
    // The scene the controller is tracking, and the level it wants held between replies.
    this.scene = null;
    this.hold = 0;
    // Strokes swallow their errors during a reply, so the last one is kept for the test
    // pulse to report instead of a silent no-op.
    this.lastStrokeError = null;
  }

  headers() {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const key = String(this.config.handyKey || '').trim();
    if (key) headers['X-Connection-Key'] = key;
    const appKey = String(this.config.handyAppKey || '').trim();
    if (appKey) headers['X-Api-Key'] = appKey;
    return headers;
  }

  async call(path, method = 'GET', body) {
    const response = await timedFetch(
      `${HANDY_BASES[this.api]}${path}`,
      {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
      },
      8000
    );
    const payload = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) {
      this.authRejected = true;
      throw new Error(this.authMessage());
    }
    // The ceiling gets its own sentence: "slow down" is actionable, the vendor's "Too many
    // requests" is not, and a 429 can arrive with or without the usual envelope.
    if (response.status === 429) {
      throw new Error('The Handy rate-limited this page (240 requests a minute). It clears on its own; a lower cap or steady speed uses less of it.');
    }
    // Both generations can answer 200 and put the refusal in an error envelope, so a status
    // check alone would report a refused command as a success — this is how a wrong key used
    // to look like an offline device.
    if (payload?.error) {
      const vendor = payload.error;
      const code = vendor.code ? ` (code ${vendor.code})` : '';
      throw new Error(`The Handy refused that: ${vendor.message || vendor.name || 'no reason given'}${code}.`);
    }
    if (!response.ok) throw new Error(`The Handy answered ${response.status}.`);
    // v3 wraps every answer in { result }; v2 answers flat. One line reads both.
    return payload?.result ?? payload;
  }

  authMessage() {
    if (this.api === 'v3') {
      return 'The Handy cloud did not accept that Application ID. Firmware 4 devices (Handy 2, 2 Pro) need an Application ID from user.handyfeeling.com as well as the connection key. Paste the ID itself, not the Application Key — the Key is meant for servers.';
    }
    return 'The Handy rejected that connection key. Copy it again from the Handy app. The original Handy does not use an Application ID at all, so leave that field empty.';
  }

  async connect() {
    if (!String(this.config.handyKey || '').trim()) {
      throw new Error('Add the Handy connection key — the Handy app shows it under its connection settings.');
    }
    const appKey = String(this.config.handyAppKey || '').trim();
    // v3 needs an Application ID and firmware 4 needs v3; v2 needs none and firmware 3 needs
    // v2. So the saved preference is a starting point and the fallback is the real detector.
    const attempts =
      this.preference === 'v3'
        ? ['v3']
        : this.preference === 'v2'
          ? ['v2']
          : appKey
            ? ['v3', 'v2']
            : ['v2'];
    const failures = [];
    for (const api of attempts) {
      this.api = api;
      this.authRejected = false;
      try {
        await this.handshake();
        return this.label;
      } catch (error) {
        failures.push({ api, message: String(error?.message || error), auth: this.authRejected });
      }
    }
    this.api = 'v2';
    throw new Error(this.explainFailures(failures));
  }

  // One attempt speaks for itself. Two are a diagnosis: the newer API usually fails over the
  // key and the older one over the device link, and saying only the last one blamed the
  // device for a key the cloud had already refused.
  explainFailures(failures) {
    if (!failures.length) return 'The Handy did not answer. Check the connection key and that the device is switched on.';
    if (failures.length === 1) return failures[0].message;
    const keyProblem = failures.some((failure) => failure.auth);
    const lead = keyProblem
      ? 'The cloud refused the Application ID, so the device was never asked: fix the ID before anything else.'
      : '';
    const detail = failures.map((failure) => `API ${failure.api}: ${failure.message}`).join(' ');
    return [lead, detail].filter(Boolean).join(' ');
  }

  async handshake() {
    this.authRejected = false;
    if (this.api === 'v3' && !String(this.config.handyAppKey || '').trim()) {
      throw new Error(
        'Handy 2 (firmware 4) needs an Application ID as well: create a free one at user.handyfeeling.com and paste the ID (not the Application Key) above.'
      );
    }
    const status = await this.call('connected');
    if (!status?.connected) {
      // "Online" here means the vendor's cloud can reach the device, which on firmware 4
      // means its Wi-Fi link is up. Bluetooth alone keeps the app working but leaves the
      // cloud with nothing to talk to, so the message names that instead of shrugging.
      throw new Error(
        'The cloud cannot reach the device — it reports it offline. On a Handy 2 the Wi-Fi light has to be connected (Bluetooth alone is not enough for cloud control). Check that the device is on Wi-Fi with internet, then try again; on the original Handy, check that it is switched on and paired to the Handy app.'
      );
    }
    const info = await this.call('info').catch(() => null);
    this.firmware = handyFirmwareLabel(this.api === 'v3' ? info?.fw_version : info?.fwVersion || info?.version);
    const model = String((this.api === 'v3' ? info?.hw_model_name : info?.model) || '').trim();
    this.hardware = this.api === 'v3' && Number.isFinite(info?.hw_model_no) ? `HW ${info.hw_model_no}` : '';
    const seen = [model, this.firmware ? `FW ${this.firmware}` : '', this.hardware, `API ${this.api}`].filter(Boolean);
    this.label = seen.length ? `The Handy (${seen.join(', ')})` : 'The Handy';
    await this.useMode(this.mode);
  }

  // HAMP is mode 0 and HDSP is mode 2; the mode decides which commands are legal, and
  // switching is also how a stroke still in flight gets cancelled.
  async useMode(mode) {
    if (this.activeMode === mode) return;
    await this.call('mode', 'PUT', { mode: mode === 'hdsp' ? 2 : 0 });
    this.activeMode = mode;
  }

  async setLevel(level) {
    const value = clamp(level, 0, 1);
    this.level = value;
    if (this.mode === 'hdsp') {
      this.startStrokes();
      return;
    }
    await this.useMode('hamp');
    // v3 takes a fraction of max velocity, v2 a whole percent.
    const velocity = this.api === 'v3' ? Math.round(value * 1000) / 1000 : Math.round(value * 100);
    if (!this.moving) {
      await this.call('hamp/start', 'PUT', {});
      this.moving = true;
    }
    await this.call('hamp/velocity', 'PUT', { velocity });
  }

  // HDSP takes one position and one duration at a time, so strokes are scheduled back and
  // forth rather than approximated with a constant speed.
  // Starts the loop before the first text arrives, so the opening of a reply is not dead
  // air waiting for an intensity tick.
  async start() {
    if (this.mode !== 'hdsp') return;
    this.startStrokes();
  }

  startStrokes() {
    if (this.stroking) return;
    this.stroking = true;
    this.moving = false;
    this.lastStrokeError = null;
    const pump = () => {
      if (!this.stroking) return;
      const live = typeof this.levelSource === 'function' ? this.levelSource() : this.level;
      // Held motion outranks the fading stream: between replies the prose is quiet, but the
      // scene is still going, so the hold keeps the pace up.
      const level = Math.max(live, this.hold);
      this.level = level;
      // Quiet text is a pause, not a slow grind: keep checking, do not stroke.
      if (level < 0.1) {
        this.strokeTimer = setTimeout(pump, 300);
        return;
      }
      const wide = this.scene?.active;
      const half = wide ? this.scene.pace(level) : handyHalfPeriod(level);
      const position = handyStrokeTarget(this.phase, wide ? this.scene.depth() : [0, 100]);
      this.phase = !this.phase;
      // One command per half-stroke; a failure costs a single stroke, not the reply.
      // One command per half-stroke; a failure costs a single stroke, not the reply, but it
      // is remembered so a test pulse can say what went wrong.
      void this.useMode('hdsp')
        .then(() =>
          this.call(
            'hdsp/xpt',
            'PUT',
            // v2 names the target `position` and the time `t`; v3 names them `xp` and `t`
            // and snake_cases the flag. The old body used `position, duration`, which
            // neither API accepts, so scene-synced strokes never actually moved.
            this.api === 'v3'
              ? { xp: position, t: half, stop_on_target: true }
              : { position, t: half, stopOnTarget: true }
          ).catch((error) => {
            this.lastStrokeError = error;
          })
        )
        .catch((error) => {
          this.lastStrokeError = error;
        });
      this.strokeTimer = setTimeout(pump, half);
    };
    pump();
  }

  // Called while motion is held between replies. HAMP still needs a velocity, so it takes the
  // same path as a stream; HDSP only needs the loop kept alive at this level.
  setHold(level) {
    this.hold = clamp(Number(level) || 0, 0, 1);
    if (this.mode === 'hdsp') {
      this.startStrokes();
      return;
    }
    return this.setLevel(this.hold);
  }

  stopStrokes() {
    this.stroking = false;
    if (this.strokeTimer) {
      clearTimeout(this.strokeTimer);
      this.strokeTimer = 0;
    }
  }

  async stop() {
    this.hold = 0;
    this.stopStrokes();
    if (!this.moving && this.activeMode === null) return;
    if (this.moving) this.moving = false;
    // Switching back to HAMP cancels a stroke still in flight, then stops the device there.
    await this.useMode('hamp');
    await this.call('hamp/stop', 'PUT', {});
  }

  async disconnect() {
    try {
      await this.stop();
    } catch {
      /* already stopped */
    }
  }
}

/* ---------------- controller ---------------- */

export function createDevices({ onStatus } = {}) {
  let link = null;
  let reaction = null;
  let timer = 0;
  let muted = false;
  let failures = 0;
  let cap = 0.6;
  const scene = new Scene();
  let sustainOn = true;
  let sustained = false;
  // Set by Stop, a hidden tab or a disconnect: finish() must not revive motion the visitor
  // just ended.
  let suppressed = false;
  // Streams arrive as fragments, and a scene clause split across two tokens would never parse,
  // so text is held until it reaches a sentence boundary.
  let sceneBuffer = '';

  const report = (text) => {
    try {
      onStatus?.(text);
    } catch {
      /* a status line must never break the chat */
    }
  };

  const tick = async () => {
    if (!link || !reaction || muted) return;
    try {
      await link.setLevel(reaction.sample());
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= 3) {
        report(`The device stopped answering (${error?.message || error}), so it was stopped.`);
        try {
          await link.stop();
        } catch {
          /* nothing left to stop */
        }
        muted = true;
        clearInterval(timer);
        timer = 0;
      }
    }
  };

  function stopNow() {
    suppressed = true;
    sustained = false;
    muted = true;
    clearInterval(timer);
    timer = 0;
    if (link) link.stop().catch(() => {});
  }

  // Between replies: keep the last pace alive at the scene's own intensity, and stop on a
  // stop cue, an idle scene, a ceiling, or three failed commands.
  function startSustain() {
    const current = link;
    if (!current) return;
    sustained = true;
    muted = false;
    clearInterval(timer);
    const startedAt = Date.now();
    const step = async () => {
      if (!link || link !== current || !sustained) return;
      if (!scene.active || Date.now() - startedAt > SUSTAIN_MAX_MS) {
        stopNow();
        return;
      }
      const level = clamp(scene.sustainLevel() * cap, 0.08, 1);
      try {
        // Awaiting matters here: an unawaited rejection would surface as an unhandled
        // promise instead of a failure this loop can count.
        if (typeof current.setHold === 'function') await current.setHold(level);
        else await current.setLevel(level);
        failures = 0;
      } catch (error) {
        failures += 1;
        if (failures >= 3) {
          report(`The device stopped answering (${error?.message || error}), so it was stopped.`);
          stopNow();
        }
      }
    };
    void step();
    timer = setInterval(step, REACTION_TICK_MS);
  }

  async function disconnect() {
    clearInterval(timer);
    timer = 0;
    muted = false;
    sustained = false;
    const current = link;
    link = null;
    reaction = null;
    if (current) {
      try {
        await current.disconnect();
      } catch {
        /* already gone */
      }
    }
  }

  return {
    get connected() {
      return Boolean(link);
    },
    get kind() {
      return link?.kind || null;
    },
    get label() {
      return link?.label || '';
    },
    // The act currently followed, for the status line. Empty once the scene has stopped or
    // gone quiet.
    get sceneLabel() {
      return scene.active ? scene.label : '';
    },

    async connect(config) {
      await disconnect();
      cap = clamp(Number(config.cap ?? 60) / 100, 0.05, 1);
      const chosen =
        config.kind === 'buttplug' ? new ButtplugLink(config) : config.kind === 'handy' ? new HandyLink(config) : new LovenseLink(config);
      const label = await chosen.connect();
      link = chosen;
      reaction = new Reaction({ cap });
      chosen.levelSource = () => reaction.peek();
      chosen.scene = scene;
      sustainOn = config.sustain !== false;
      scene.setFluid(config.fluid !== false);
      failures = 0;
      muted = false;
      suppressed = false;
      sustained = false;
      report('');
      return label;
    },

    setCap(percent) {
      cap = clamp(Number(percent) / 100, 0.05, 1);
      if (reaction) reaction.cap = cap;
    },

    // Turning the hold off mid-scene stops it, rather than waiting for the next reply.
    setSustain(on) {
      sustainOn = on !== false;
      if (!sustainOn && sustained) stopNow();
    },

    // Fluid mode only changes how a scene change is travelled; it never starts or stops one.
    setFluid(on) {
      scene.setFluid(on);
    },

    // The visitor's own message counts as the scene speaking: "turn around" has to change the
    // motion before the model has written a word.
    noteScene(text) {
      if (!link) return;
      scene.observe(text);
    },

    // A short pulse, so a connection can be proven before a reply is ever sent. It goes
    // through the same setLevel/stop path as the stream, so it tests the real commands.
    async pulse() {
      const target = link;
      if (!target) throw new Error('Connect a device first.');
      muted = false;
      reaction?.reset();
      // Feed the reaction the intensity a hot sentence would give it, or scene-synced mode
      // would have nothing to stroke to.
      reaction?.feed('*she moans* yes — harder, now! ');
      let strokeError = null;
      try {
        await target.setLevel(clamp(0.45 * cap, 0.15, 0.6));
        await new Promise((resolve) => setTimeout(resolve, 1400));
        // Strokes hide their own failures while a reply streams; a test should not.
        strokeError = target.lastStrokeError || null;
      } finally {
        await target.stop().catch(() => {});
        reaction?.reset();
        report('');
      }
      if (strokeError) throw strokeError;
    },

    begin() {
      if (!link) return;
      muted = false;
      suppressed = false;
      sustained = false;
      sceneBuffer = '';
      link.setHold?.(0);
      reaction?.reset();
      void link.start?.();
      clearInterval(timer);
      timer = setInterval(() => {
        void tick();
      }, REACTION_TICK_MS);
    },

    feed(delta) {
      if (!link || muted) return;
      sceneBuffer += delta;
      const boundary = Math.max(
        sceneBuffer.lastIndexOf('.'),
        sceneBuffer.lastIndexOf('!'),
        sceneBuffer.lastIndexOf('?'),
        sceneBuffer.lastIndexOf('\n')
      );
      if (boundary >= 0 || sceneBuffer.length > 500) {
        const cut = boundary >= 0 ? boundary + 1 : sceneBuffer.length;
        scene.observe(sceneBuffer.slice(0, cut));
        sceneBuffer = sceneBuffer.slice(cut);
      }
      reaction?.feed(delta);
    },

    // Ends the reply: always stop, never leave the last command holding.
    // The reply ended. If a scene is still going and the hold is on, keep the pace instead of
    // going still — that is the whole point of following a scene rather than a stream.
    async finish() {
      clearInterval(timer);
      timer = 0;
      muted = false;
      if (!link) return;
      // A reply can end mid-sentence; the last fragment still counts before deciding whether
      // to hold or stop.
      if (sceneBuffer) {
        scene.observe(sceneBuffer);
        sceneBuffer = '';
      }
      if (suppressed) return;
      if (sustainOn && scene.active) {
        startSustain();
        return;
      }
      sustained = false;
      try {
        await link.stop();
      } catch {
        /* the device is already still */
      }
    },

    // Tab hidden, Stop pressed, or a route switch: mute until the next reply begins.
    stopNow,

    // The scene a visitor can see is the scene the device follows.
    get scene() {
      return scene.active ? scene.act : null;
    },

    disconnect,
  };
}
