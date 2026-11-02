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
const HANDY_BASE = 'https://www.handyfeeling.com/api/handy/v2/';

// A Lovense command that expires on its own: a tab that dies stops the toy within two
// seconds instead of leaving it running. An indefinite hold is never sent — that is the
// whole point of this constant.
const LOVENSE_HOLD_SEC = 2;
export const REACTION_TICK_MS = 1500;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Scene-synced strokes: faster prose means a shorter half-stroke. 650 ms at rest, 240 ms
// at full intensity, which is also the ceiling the vendor's API accepts comfortably.
export function handyHalfPeriod(level) {
  return Math.round(650 - 410 * clamp(Number(level) || 0, 0, 1));
}

// HDSP works in percent of the stroke zone, so a stroke is "be at this end in T ms".
export function handyStrokeTarget(phase) {
  return phase ? 100 : 0;
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
    // Set by the controller: lets every stroke read the freshest intensity instead of the
    // last one-second-and-a-half snapshot.
    this.levelSource = null;
    this.moving = false;
    this.stroking = false;
    this.activeMode = null;
    this.level = 0;
    this.phase = false;
    this.strokeTimer = 0;
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
      `${HANDY_BASE}${path}`,
      {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
      },
      8000
    );
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'The Handy rejected those keys. Copy the connection key again from the Handy app; the app key is only needed if the developer portal issued you one.'
      );
    }
    if (!response.ok) throw new Error(`The Handy answered ${response.status}.`);
    return response.json().catch(() => null);
  }

  async connect() {
    if (!String(this.config.handyKey || '').trim()) {
      throw new Error('Add the Handy connection key — the Handy app shows it under its connection settings.');
    }
    const status = await this.call('connected');
    if (!status?.connected) {
      throw new Error('The Handy did not report itself online. Check the key, and that the device is switched on and connected.');
    }
    const info = await this.call('info').catch(() => null);
    this.label = info?.model ? `The Handy (${info.model})` : 'The Handy';
    await this.useMode(this.mode);
    return this.label;
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
    const velocity = Math.round(value * 100);
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
    const pump = () => {
      if (!this.stroking) return;
      const level = typeof this.levelSource === 'function' ? this.levelSource() : this.level;
      this.level = level;
      // Quiet text is a pause, not a slow grind: keep checking, do not stroke.
      if (level < 0.1) {
        this.strokeTimer = setTimeout(pump, 300);
        return;
      }
      const half = handyHalfPeriod(level);
      const position = handyStrokeTarget(this.phase);
      this.phase = !this.phase;
      // One command per half-stroke; a failure costs a single stroke, not the reply.
      void this.useMode('hdsp').then(() =>
        this.call('hdsp/xpt', 'PUT', { position, duration: half, stopOnTarget: true }).catch(() => {})
      );
      this.strokeTimer = setTimeout(pump, half);
    };
    pump();
  }

  stopStrokes() {
    this.stroking = false;
    if (this.strokeTimer) {
      clearTimeout(this.strokeTimer);
      this.strokeTimer = 0;
    }
  }

  async stop() {
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

  async function disconnect() {
    clearInterval(timer);
    timer = 0;
    muted = false;
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

    async connect(config) {
      await disconnect();
      cap = clamp(Number(config.cap ?? 60) / 100, 0.05, 1);
      const chosen =
        config.kind === 'buttplug' ? new ButtplugLink(config) : config.kind === 'handy' ? new HandyLink(config) : new LovenseLink(config);
      const label = await chosen.connect();
      link = chosen;
      reaction = new Reaction({ cap });
      chosen.levelSource = () => reaction.peek();
      failures = 0;
      muted = false;
      report('');
      return label;
    },

    setCap(percent) {
      cap = clamp(Number(percent) / 100, 0.05, 1);
      if (reaction) reaction.cap = cap;
    },

    begin() {
      if (!link) return;
      muted = false;
      reaction?.reset();
      void link.start?.();
      clearInterval(timer);
      timer = setInterval(() => {
        void tick();
      }, REACTION_TICK_MS);
    },

    feed(delta) {
      if (!link || muted) return;
      reaction?.feed(delta);
    },

    // Ends the reply: always stop, never leave the last command holding.
    async finish() {
      clearInterval(timer);
      timer = 0;
      muted = false;
      if (!link) return;
      try {
        await link.stop();
      } catch {
        /* the device is already still */
      }
    },

    // Tab hidden, Stop pressed, or a route switch: mute until the next reply begins.
    stopNow() {
      muted = true;
      clearInterval(timer);
      timer = 0;
      if (link) link.stop().catch(() => {});
    },

    disconnect,
  };
}
