// Varden — local roleplay chat.
//
// Character cards drive the prompt, chats are stored per character in IndexedDB,
// and replies are generated on the visitor's GPU through WebGPU (WebLLM).
// No server, no account, no message cap.

import {
  buildPrompt,
  chatToText,
  createChat,
  createMessage,
  deleteChat as removeChat,
  downloadText,
  ensureSeeded,
  estimateTokens,
  getCharacter,
  listCharacters,
  listChats,
  listPersonas,
  migrateLegacyChats,
  saveChat,
  savePersona,
  clearMemories,
  deleteMemory,
  extractMemories,
  listMemories,
  relevantMemories,
  saveMemory,
} from './cards.js';
import { createDevices } from './devices.js';

const WEBLLM_CDN = 'https://esm.run/@mlc-ai/web-llm';
const SETTINGS_KEY = 'varden-chat-settings';
const DEFAULT_MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

// VRAM figures come from the WebLLM prebuilt registry (0.2.87).
const MODEL_CATALOG = [
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 0.5B', vram: 944, note: 'Smallest option — quick to load, best for weaker hardware.' },
  { id: DEFAULT_MODEL, label: 'Llama 3.2 1B', vram: 879, note: 'Recommended start: the best quality that fits almost anywhere.', recommended: true },
  {
    id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    label: 'Llama 3.2 1B (f32)',
    vram: 1129,
    f32: true,
    note: 'The same model in a form any WebGPU chip can compile. Lightest safe pick when a GPU rejects f16 shaders.',
  },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B', vram: 1629, note: 'Steadier prose than 1B, still fine on integrated GPUs.' },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
    label: 'Qwen2.5 1.5B (f32)',
    vram: 1889,
    f32: true,
    note: 'Same writing as the 1.5B above without the f16 shaders, for GPUs that cannot compile them.',
  },
  { id: 'gemma-2-2b-it-q4f16_1-MLC', label: 'Gemma 2 2B', vram: 1895, note: 'Warm, conversational tone.' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', vram: 2263, note: 'Sweet spot for 8 GB unified memory machines.' },
  { id: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', label: 'Llama 3.2 3B (f32)', vram: 2952, f32: true, note: 'The 3B in the shader form every GPU can compile.' },
  { id: 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC', label: 'Hermes 3 (Llama 3.2 3B)', vram: 2263, note: 'Fine-tuned for staying in character — the strongest roleplay pick here.' },
  { id: 'Hermes-3-Llama-3.2-3B-q4f32_1-MLC', label: 'Hermes 3 (Llama 3.2 3B, f32)', vram: 2952, f32: true, note: 'In-character roleplay without f16 shaders — the safe pick for older GPUs.' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 3B', vram: 2504, note: 'Bilingual, strong at structure and scene detail.' },
  {
    id: 'Qwen3-4B-q4f16_1-MLC',
    label: 'Qwen3 4B',
    vram: 3431,
    noThink: true,
    note: 'Comfortable on an 8 GB card with room left for long scenes; the fast default for a laptop 4070.',
  },
  { id: 'Phi-4-mini-instruct-q4f16_1-MLC', label: 'Phi 4 mini', vram: 3437, note: 'Careful reasoning; wants a discrete GPU or Apple silicon.' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi 3.5 mini', vram: 3672, note: 'Methodical answers, larger download.' },
  { id: 'Phi-3.5-mini-instruct-q4f32_1-MLC', label: 'Phi 3.5 mini (f32)', vram: 5483, f32: true, note: 'Phi 3.5 in the f32 shader form; wants a discrete GPU at this size.' },
  { id: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC', label: 'Mistral 7B', vram: 4573, note: 'More expressive prose; needs ~8 GB free VRAM.' },
  {
    id: 'OpenHermes-2.5-Mistral-7B-q4f16_1-MLC',
    label: 'OpenHermes 2.5 (Mistral 7B)',
    vram: 4573,
    uncensored: true,
    note: 'The lighter uncensored option: a Mistral 7B fine-tune that follows a dark premise instead of deflecting.',
  },
  {
    id: 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC',
    label: 'Hermes 3 (Llama 3.1 8B)',
    vram: 4876,
    uncensored: true,
    note: 'Uncensored 8B with the best prose here for violent or adult scenes. Wants about 6 GB of free VRAM.',
  },
  {
    id: 'Hermes-2-Theta-Llama-3-8B-q4f16_1-MLC',
    label: 'Hermes 2 Theta (Llama 3 8B)',
    vram: 4976,
    uncensored: true,
    note: 'Roleplay-tuned 8B: minimal refusals and long in-character scenes, weaker at logic and facts.',
  },
  {
    id: 'Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC',
    label: 'Hermes 2 Pro (Llama 3 8B)',
    vram: 4976,
    uncensored: true,
    note: 'Uncensored 8B tuned for instruction following and structured output; hold the scene for you.',
  },
  {
    id: 'Hermes-2-Pro-Llama-3-8B-q4f32_1-MLC',
    label: 'Hermes 2 Pro (Llama 3 8B, f32)',
    vram: 6051,
    uncensored: true,
    f32: true,
    note: 'The uncensored 8B in f32 shaders, for GPUs that cannot compile f16. Needs about 6 GB free.',
  },
  { id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 7B', vram: 5106, note: 'Best quality available here if your GPU has the memory.' },
  { id: 'Qwen2.5-7B-Instruct-q4f32_1-MLC', label: 'Qwen2.5 7B (f32)', vram: 5900, f32: true, note: 'The 7B without f16 shaders; the strongest option here for a GPU that rejects f16.' },
  {
    id: 'Qwen3-8B-q4f16_1-MLC',
    label: 'Qwen3 8B',
    vram: 5695,
    noThink: true,
    note: 'The all-rounder for 8 GB: strongest writing that still leaves context room. Thinking is switched off so it stays in prose.',
  },
  {
    id: 'gemma-2-9b-it-q4f16_1-MLC',
    label: 'Gemma 2 9B',
    vram: 6422,
    note: 'Richest prose here, but at 6.3 GB it fills an 8 GB card — close other GPU apps and keep scenes short.',
  },
];

// Half-precision kernels only compile on GPUs that expose the shader-f16 feature.
// Elsewhere (older Intel/AMD parts, or drivers that hide it) the shader module is
// rejected outright, so the catalog carries f32 twins that avoid that path.
const modelNeedsF16 = (model) => Boolean(model) && !model.f32 && /q4f16_1|q0f16/.test(model.id);
const f32Fallback = () => MODEL_CATALOG.find((model) => model.f32) || null;

/* ---------------- hosted models (bring your own key) ---------------- */

// Hosted models are deliberately a separate list: they run on someone else's GPUs
// and the scene leaves this browser. Varden hosts, pays for and maintains nothing
// here — the visitor pastes their own OpenRouter key, it stays on this device, and
// the request goes from the page straight to OpenRouter. The model catalog is
// fetched from their public endpoint, so it never goes stale and needs no upkeep.
const HOSTED_BASE = 'https://openrouter.ai/api/v1';
const HOSTED_KEY_STORE = 'varden-hosted-key';
const HOSTED_DEFAULT = 'deepseek/deepseek-chat';

const VENDOR_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  meta: 'Meta',
  'meta-llama': 'Meta',
  deepseek: 'DeepSeek',
  mistralai: 'Mistral',
  qwen: 'Alibaba (Qwen)',
  'x-ai': 'xAI',
  moonshotai: 'Moonshot',
  nvidia: 'NVIDIA',
  'z-ai': 'Z.AI',
  minimax: 'MiniMax',
  cohere: 'Cohere',
  amazon: 'Amazon',
  microsoft: 'Microsoft',
};

const vendorLabel = (slug) =>
  VENDOR_LABELS[slug] || slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

/* ---------------- keyless pool (third list, nothing to sign up for) ---------------- */

// Pollinations answers without any credential at all: its /openai suffix is
// OpenAI-shaped, streams SSE, and sends `access-control-allow-origin: *`, so a
// static page can use it directly. It is a shared free pool, not a provider with an
// account behind it, so the UI keeps it visually separate and says what that means.
const KEYLESS_BASE = 'https://text.pollinations.ai';
const KEYLESS_FALLBACK = ['openai-fast'];

/* ---------------- own server (anything OpenAI-compatible) ---------------- */

// A fourth route, and the only remote one that can run a genuinely uncensored model
// without an account: the address is whatever the visitor runs. Ollama and LM Studio
// both speak this dialect, so one small block covers both.
const LOCAL_DEFAULT_BASE = 'http://127.0.0.1:11434';

const DEFAULT_SETTINGS = {
  modelId: DEFAULT_MODEL,
  temperature: 0.85,
  topP: 0.95,
  maxTokens: 384,
  personaId: null,
  characterId: null,
  hostedModel: null,
  keylessModel: null,
  keylessConfirmed: false,
  localBase: LOCAL_DEFAULT_BASE,
  localModel: null,
  device: {
    kind: 'off',
    lovenseHost: '',
    lovensePort: 30010,
    buttplugUrl: 'ws://127.0.0.1:12345',
    handyKey: '',
    handyAppKey: '',
    handyMode: 'hamp',
    cap: 60,
    confirmed: false,
  },
};

const state = {
  characters: [],
  personas: [],
  chats: [],
  character: null,
  chat: null,
  settings: { ...DEFAULT_SETTINGS },
  engine: null,
  engineModel: null,
  webllm: null,
  webllmPromise: null,
  webgpu: null,
  loading: false,
  generating: false,
  stopRequested: false,
  pinned: true,
  editingIndex: null,
  memories: [],
  hosted: { key: '', models: [], loading: false, error: null, status: '' },
  hostedAbort: null,
  keyless: { models: [], loading: false, error: null, status: '' },
  // The key is the one thing here that is never written to localStorage: a server key
  // is a secret, and this route is meant to work without one anyway.
  local: { key: '', models: [], loading: false, error: null, status: '' },
  devices: null,
  deviceStatus: '',
};

const $ = (id) => document.getElementById(id);

const els = {
  thread: $('thread'),
  composer: $('composer'),
  input: $('promptInput'),
  send: $('sendBtn'),
  stop: $('stopBtn'),
  continue: $('continueBtn'),
  characterList: $('characterList'),
  chatList: $('chatList'),
  newChat: $('newChatBtn'),
  characterName: $('characterName'),
  characterTagline: $('characterTagline'),
  characterSource: $('characterSource'),
  characterAvatar: $('characterAvatar'),
  characterMeta: $('characterMeta'),
  editCardLink: $('editCardLink'),
  modelSelect: $('modelSelect'),
  modelNote: $('modelNote'),
  modelChip: $('modelChip'),
  loadModel: $('loadModelBtn'),
  unloadModel: $('unloadModelBtn'),
  loadMeter: $('loadMeter'),
  loadText: $('loadText'),
  personaSelect: $('personaSelect'),
  editPersona: $('editPersonaBtn'),
  authorNote: $('authorNote'),
  temperature: $('temperature'),
  tempOut: $('tempOut'),
  topP: $('topP'),
  topPOut: $('topPOut'),
  maxTokens: $('maxTokens'),
  maxOut: $('maxOut'),
  enginePill: $('enginePill'),
  gpuBadge: $('gpuBadge'),
  gpuDetail: $('gpuDetail'),
  notice: $('notice'),
  genStatus: $('genStatus'),
  genText: $('genText'),
  genBar: $('genBar'),
  composerHint: $('composerHint'),
  exportChat: $('exportChatBtn'),
  personaDialog: $('personaDialog'),
  personaForm: $('personaForm'),
  personaName: $('personaNameInput'),
  personaDescription: $('personaDescription'),
  personaSave: $('personaSave'),
  personaSaveNew: $('personaSaveNew'),
  personaCancel: $('personaCancel'),
  personaClose: $('personaClose'),
  hostedSelect: $('hostedSelect'),
  hostedNote: $('hostedNote'),
  hostedKey: $('hostedKey'),
  hostedRemember: $('hostedRemember'),
  hostedUse: $('hostedUseBtn'),
  hostedForget: $('hostedForgetBtn'),
  hostedRefresh: $('hostedRefreshBtn'),
  hostedStatus: $('hostedStatus'),
  keylessSelect: $('keylessSelect'),
  keylessNote: $('keylessNote'),
  keylessUse: $('keylessUseBtn'),
  keylessRefresh: $('keylessRefreshBtn'),
  keylessStatus: $('keylessStatus'),
  keylessConfirm: $('keylessConfirm'),
  keylessConfirmYes: $('keylessConfirmYes'),
  keylessConfirmCancel: $('keylessConfirmCancel'),
  localBase: $('localBase'),
  localModel: $('localModel'),
  localKey: $('localKey'),
  localModelList: $('localModelList'),
  localUse: $('localUseBtn'),
  localFind: $('localFindBtn'),
  localStatus: $('localStatus'),
  deviceKind: $('deviceKind'),
  deviceFieldsLovense: $('deviceFieldsLovense'),
  deviceFieldsButtplug: $('deviceFieldsButtplug'),
  deviceFieldsHandy: $('deviceFieldsHandy'),
  lovenseHost: $('lovenseHost'),
  lovensePort: $('lovensePort'),
  buttplugUrl: $('buttplugUrl'),
  handyKey: $('handyKey'),
  handyAppKey: $('handyAppKey'),
  handyMode: $('handyMode'),
  handyModeNote: $('handyModeNote'),
  deviceMax: $('deviceMax'),
  deviceMaxOut: $('deviceMaxOut'),
  deviceConnect: $('deviceConnectBtn'),
  deviceStop: $('deviceStopBtn'),
  deviceTest: $('deviceTestBtn'),
  deviceDisconnect: $('deviceDisconnectBtn'),
  deviceConfirm: $('deviceConfirm'),
  deviceConfirmBody: $('deviceConfirmBody'),
  deviceConfirmYes: $('deviceConfirmYes'),
  deviceConfirmCancel: $('deviceConfirmCancel'),
  deviceStatus: $('deviceStatus'),
};

/* ---------------- settings ---------------- */

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (error) {
    console.warn('Varden: could not read settings', error);
  }
  if (!MODEL_CATALOG.some((model) => model.id === state.settings.modelId)) {
    state.settings.modelId = DEFAULT_MODEL;
  }
  if (typeof state.settings.hostedModel !== 'string' || !state.settings.hostedModel.includes('/')) {
    state.settings.hostedModel = null;
  }
  if (typeof state.settings.keylessModel !== 'string' || !state.settings.keylessModel.trim()) {
    state.settings.keylessModel = null;
  }
  state.settings.localBase = normalizeLocalBase(state.settings.localBase);
  if (typeof state.settings.localModel !== 'string' || !state.settings.localModel.trim()) {
    state.settings.localModel = null;
  }
  // A remembered route only survives if it was confirmed once. Without this, a new
  // session could start shipping scenes off the device that was never asked.
  if (state.settings.keylessConfirmed !== true) state.settings.keylessModel = null;

  const savedDevice = state.settings.device;
  state.settings.device = {
    ...DEFAULT_SETTINGS.device,
    ...(savedDevice && typeof savedDevice === 'object' && !Array.isArray(savedDevice) ? savedDevice : null),
  };
  const device = state.settings.device;
  if (!DEVICE_KINDS.includes(device.kind)) device.kind = 'off';
  device.cap = clampSetting(device.cap, 60);
  device.lovensePort = clampSetting(device.lovensePort, 30010, 1, 65535);
  device.confirmed = device.confirmed === true;
  if (typeof device.lovenseHost !== 'string') device.lovenseHost = '';
  if (typeof device.buttplugUrl !== 'string') device.buttplugUrl = 'ws://127.0.0.1:12345';
  if (typeof device.handyKey !== 'string') device.handyKey = '';
  if (typeof device.handyAppKey !== 'string') device.handyAppKey = '';
  device.handyMode = HANDY_MODES.includes(device.handyMode) ? device.handyMode : 'hamp';
}

function clampSetting(value, fallback, low = 5, high = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(high, Math.max(low, number));
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch (error) {
    console.warn('Varden: could not save settings', error);
  }
}

/* ---------------- hosted model plumbing ---------------- */

const hostedActive = () => Boolean(state.settings.hostedModel);
const hostedEntry = (id) => state.hosted.models.find((model) => model.id === id) || null;
function hostedModelLabel() {
  const entry = hostedEntry(state.settings.hostedModel);
  return entry ? entry.name : state.settings.hostedModel || 'Hosted model';
}

function readHostedKey() {
  return state.hosted.key || '';
}

function setHostedKey(value, remember) {
  state.hosted.key = String(value || '').trim();
  try {
    if (remember && state.hosted.key) localStorage.setItem(HOSTED_KEY_STORE, state.hosted.key);
    else localStorage.removeItem(HOSTED_KEY_STORE);
  } catch (error) {
    console.warn('Varden: could not store the hosted key', error);
  }
}

function loadHostedKey() {
  try {
    state.hosted.key = localStorage.getItem(HOSTED_KEY_STORE) || '';
  } catch {
    state.hosted.key = '';
  }
  if (els.hostedKey) els.hostedKey.value = state.hosted.key;
  if (els.hostedRemember) els.hostedRemember.checked = Boolean(state.hosted.key);
}

function buildHostedSelect() {
  if (!els.hostedSelect) return;
  if (!state.hosted.models.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = state.hosted.loading ? 'Loading the hosted catalog…' : 'No hosted models loaded';
    els.hostedSelect.replaceChildren(option);
    renderHostedNote();
    return;
  }
  const groups = new Map();
  for (const model of state.hosted.models) {
    if (!groups.has(model.vendor)) groups.set(model.vendor, []);
    groups.get(model.vendor).push(model);
  }
  const fragment = document.createDocumentFragment();
  for (const [vendor, models] of [...groups.entries()].sort((a, b) => vendorLabel(a[0]).localeCompare(vendorLabel(b[0])))) {
    const group = document.createElement('optgroup');
    group.label = `${vendorLabel(vendor)} (${models.length})`;
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      group.append(option);
    }
    fragment.append(group);
  }
  els.hostedSelect.replaceChildren(fragment);
  const wanted = state.settings.hostedModel || HOSTED_DEFAULT;
  els.hostedSelect.value = hostedEntry(wanted) ? wanted : state.hosted.models[0].id;
  renderHostedNote();
}

function renderHostedNote() {
  if (!els.hostedNote) return;
  const entry = hostedEntry(els.hostedSelect.value) || hostedEntry(state.settings.hostedModel);
  if (!entry) {
    els.hostedNote.textContent = 'Model list unavailable — check your connection and press Refresh list.';
    return;
  }
  const price = (value) => (value > 0 ? `$${(value * 1e6).toFixed(2)}` : 'free');
  const context = entry.context ? `${Math.round(entry.context / 1000)}k context` : 'context unknown';
  els.hostedNote.textContent = `${vendorLabel(entry.vendor)} · ${context} · ${price(entry.prompt)} per M in, ${price(
    entry.completion
  )} per M out. Billed by OpenRouter to your key.`;
}

function renderHostedStatus() {
  if (!els.hostedStatus) return;
  const bits = [];
  if (hostedActive()) {
    bits.push(
      `Active: ${hostedModelLabel()}. Replies are sent to that provider and billed to your key — choose a model in the list above to go back to the GPU.`
    );
  }
  if (!readHostedKey()) {
    bits.push('No key yet: create one at openrouter.ai/keys, then paste it above. It stays in this browser.');
  } else {
    bits.push('Key is in this browser only.');
  }
  if (state.hosted.loading) bits.push('Loading the hosted catalog…');
  if (state.hosted.error) bits.push(state.hosted.error);
  if (state.hosted.status) bits.push(state.hosted.status);
  els.hostedStatus.textContent = bits.join(' ');
  syncControls();
}

async function loadHostedModels() {
  if (state.hosted.loading) return;
  state.hosted.loading = true;
  renderHostedStatus();
  buildHostedSelect();
  try {
    const response = await fetch(`${HOSTED_BASE}/models`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`catalog request returned ${response.status}`);
    const payload = await response.json();
    const models = (payload.data || [])
      .filter((model) => model && typeof model.id === 'string' && model.id.includes('/'))
      .filter((model) =>
        Array.isArray(model.architecture?.input_modalities)
          ? model.architecture.input_modalities.includes('text')
          : true
      )
      .map((model) => ({
        id: model.id,
        vendor: model.id.split('/')[0],
        name: String(model.name || model.id).replace(/^[^:]*:\s*/, ''),
        context: Number(model.context_length || 0),
        prompt: Number(model.pricing?.prompt || 0),
        completion: Number(model.pricing?.completion || 0),
      }))
      .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
    if (!models.length) throw new Error('the catalog came back empty');
    state.hosted.models = models;
    state.hosted.error = null;
  } catch (error) {
    state.hosted.error = `Could not load the hosted model list (${error?.message || error}).`;
  } finally {
    state.hosted.loading = false;
    buildHostedSelect();
    renderHostedStatus();
  }
}

// Streams straight from the page to OpenRouter with the visitor's own key.
async function* hostedStream(prompt) {
  const key = readHostedKey();
  if (!key) throw new Error('No hosted API key was found in this browser.');
  const controller = new AbortController();
  state.hostedAbort = controller;
  const response = await fetch(`${HOSTED_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${key}`,
      'X-Title': 'Varden',
    },
    body: JSON.stringify({
      model: state.settings.hostedModel,
      messages: prompt.messages,
      stream: true,
      temperature: Number(state.settings.temperature),
      top_p: Number(state.settings.topP),
      max_tokens: Number(state.settings.maxTokens),
    }),
    signal: controller.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Hosted request failed (${response.status}) ${detail.slice(0, 300)}`.trim());
  }
  if (!response.body) throw new Error('The hosted provider returned no stream.');
  yield* sseChunks(response, controller);
}

/* ---------------- own server plumbing ---------------- */

// "127.0.0.1:11434", "http://localhost:1234/v1" and a pasted full completion URL all
// collapse to one shape, so the two inputs never disagree about where requests go.
function normalizeLocalBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return LOCAL_DEFAULT_BASE;
  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    return LOCAL_DEFAULT_BASE;
  }
  if (!/^https?:$/.test(url.protocol)) return LOCAL_DEFAULT_BASE;
  let path = url.pathname.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(path)) path = path.replace(/\/chat\/completions$/, '');
  // Ollama and LM Studio both keep the OpenAI shape under /v1.
  if (!path) path = '/v1';
  return `${url.origin}${path}`;
}

const localActive = () => Boolean(state.settings.localModel);
const localLabel = () => state.settings.localModel || 'Your server';
const localBase = () => normalizeLocalBase(state.settings.localBase);
const localEndpoint = (path) => `${localBase()}${path}`;

function syncLocalFields() {
  if (els.localBase) els.localBase.value = localBase();
  if (els.localModel) els.localModel.value = state.settings.localModel || '';
  renderLocalModelList();
}

function renderLocalModelList() {
  if (!els.localModelList) return;
  els.localModelList.replaceChildren(
    ...state.local.models.map((id) => {
      const option = document.createElement('option');
      option.value = id;
      return option;
    })
  );
}

function renderLocalStatus() {
  if (!els.localStatus) return;
  const bits = [];
  if (localActive()) {
    bits.push(
      `Active: ${localLabel()} on ${localBase()}. Replies come from that process and pass through no one else — if that address is not your own machine, the scene leaves your network.`
    );
  }
  if (state.local.loading) bits.push('Asking the server what it can run…');
  if (state.local.error) bits.push(state.local.error);
  if (state.local.status) bits.push(state.local.status);
  if (!bits.length) {
    bits.push('Type the address, press Find models, then Use this server. Nothing is sent until you do.');
  }
  els.localStatus.textContent = bits.join(' ');
  syncControls();
}

async function findLocalModels() {
  if (state.local.loading) return;
  state.local.loading = true;
  state.local.error = null;
  state.local.status = '';
  renderLocalStatus();
  try {
    const headers = { Accept: 'application/json' };
    if (state.local.key) headers.Authorization = `Bearer ${state.local.key}`;
    const response = await fetch(localEndpoint('/models'), { headers });
    if (!response.ok) throw new Error(`it answered ${response.status}`);
    const payload = await response.json();
    const list = (Array.isArray(payload) ? payload : payload?.data || payload?.models || [])
      .map((entry) => (typeof entry === 'string' ? entry : entry?.id || entry?.name))
      .filter((id) => typeof id === 'string' && id.trim());
    const models = [...new Set(list)];
    if (!models.length) throw new Error('it listed no models');
    state.local.models = models;
    renderLocalModelList();
    if (els.localModel && !els.localModel.value.trim()) els.localModel.value = models[0];
    state.local.status = `${models.length} model${models.length === 1 ? '' : 's'} found: pick one above and press Use this server.`;
  } catch (error) {
    state.local.error =
      `Could not read the model list (${error?.message || error}). That is usually CORS — the server has to allow this page's origin — or the server is not running. You can still type the model name yourself.`;
  } finally {
    state.local.loading = false;
    renderLocalStatus();
  }
}

function activateLocal(model) {
  state.settings.localBase = normalizeLocalBase(els.localBase?.value || state.settings.localBase);
  state.settings.localModel = String(model || '').trim() || null;
  // Exactly one route at a time, so a hosted key is never quietly used instead.
  state.settings.hostedModel = null;
  state.settings.keylessModel = null;
  state.hosted.status = '';
  state.keyless.status = '';
  state.local.status = '';
  state.local.error = null;
  setKeylessConfirm(false);
  if (els.localBase) els.localBase.value = state.settings.localBase;
  saveSettings();
  syncModelChip();
  renderHostedStatus();
  renderKeylessStatus();
  renderLocalStatus();
  els.notice.hidden = true;
}

async function* localStream(prompt) {
  const controller = new AbortController();
  state.hostedAbort = controller;
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (state.local.key) headers.Authorization = `Bearer ${state.local.key}`;
  const response = await fetch(localEndpoint('/chat/completions'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: state.settings.localModel,
      messages: prompt.messages,
      stream: true,
      temperature: Number(state.settings.temperature),
      top_p: Number(state.settings.topP),
      max_tokens: Number(state.settings.maxTokens),
    }),
    signal: controller.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Local server failed (${response.status}) ${detail.slice(0, 300)}`.trim());
  }
  if (!response.body) throw new Error('Your server returned no stream. It has to support stream: true.');
  yield* sseChunks(response, controller);
}

/* ---------------- keyless pool plumbing ---------------- */

const keylessActive = () => Boolean(state.settings.keylessModel);
const keylessEntry = (id) => state.keyless.models.find((model) => model.id === id) || null;

function keylessLabel() {
  const entry = keylessEntry(state.settings.keylessModel);
  return entry ? entry.name : state.settings.keylessModel || 'Free endpoint';
}

function buildKeylessSelect() {
  if (!els.keylessSelect) return;
  if (!state.keyless.models.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = state.keyless.loading ? 'Loading the free list…' : 'No free models available';
    els.keylessSelect.replaceChildren(option);
    renderKeylessNote();
    return;
  }
  els.keylessSelect.replaceChildren(
    ...state.keyless.models.map((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      if (model.description) option.title = model.description;
      return option;
    })
  );
  const wanted = state.settings.keylessModel;
  els.keylessSelect.value = state.keyless.models.some((model) => model.id === wanted)
    ? wanted
    : state.keyless.models[0].id;
  renderKeylessNote();
}

function renderKeylessNote() {
  if (!els.keylessNote) return;
  const entry = keylessEntry(els.keylessSelect.value) || keylessEntry(state.settings.keylessModel);
  els.keylessNote.textContent = entry
    ? `${entry.name} on a shared free pool: no key, no billing, no privacy — the pool picks the model that answers.`
    : 'No free alias is known right now; press Refresh list.';
}

function renderKeylessStatus() {
  if (!els.keylessStatus) return;
  const bits = [];
  if (keylessActive()) {
    bits.push(
      `Active: ${keylessLabel()}. Replies come from the shared pool — nothing is billed, and nothing is private. Choose a model in either list above to switch back.`
    );
  }
  if (state.keyless.loading) bits.push('Loading the free list…');
  if (state.keyless.error) bits.push(state.keyless.error);
  if (state.keyless.status) bits.push(state.keyless.status);
  if (!bits.length) bits.push('No account needed. The pool can be busy, and it changes without notice.');
  els.keylessStatus.textContent = bits.join(' ');
  syncControls();
}

// Nothing leaves the device until the user has said so once in this browser. The
// answer lives with the other settings, so it is asked per browser, not per chat.
function setKeylessConfirm(open) {
  if (!els.keylessConfirm) return;
  els.keylessConfirm.hidden = !open;
  if (open) els.keylessConfirmYes?.focus();
}

function activateKeyless(id) {
  state.settings.keylessModel = id;
  // Exactly one route at a time, so a hosted key is never quietly used instead.
  state.settings.hostedModel = null;
  state.settings.localModel = null;
  state.keyless.status = '';
  state.hosted.status = '';
  state.local.status = '';
  saveSettings();
  syncModelChip();
  renderHostedStatus();
  renderKeylessStatus();
  renderLocalStatus();
  els.notice.hidden = true;
  setKeylessConfirm(false);
}

async function loadKeylessModels() {
  if (state.keyless.loading) return;
  state.keyless.loading = true;
  renderKeylessStatus();
  buildKeylessSelect();
  try {
    const response = await fetch(`${KEYLESS_BASE}/models`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`the list returned ${response.status}`);
    const payload = await response.json();
    const list = Array.isArray(payload) ? payload : payload?.models || [];
    const models = list
      .map((entry) =>
        typeof entry === 'string'
          ? { id: entry, name: entry }
          : { id: entry?.id || entry?.name, name: entry?.name || entry?.id, description: entry?.description || '' }
      )
      .filter((model) => model.id);
    state.keyless.models = models.length ? models : KEYLESS_FALLBACK.map((id) => ({ id, name: id }));
    state.keyless.error = null;
  } catch (error) {
    state.keyless.models = KEYLESS_FALLBACK.map((id) => ({ id, name: id }));
    state.keyless.error = `The free list could not be read (${error?.message || error}); using the known alias.`;
  } finally {
    state.keyless.loading = false;
    buildKeylessSelect();
    renderKeylessStatus();
  }
}

async function* keylessStream(prompt) {
  const controller = new AbortController();
  state.hostedAbort = controller;
  const response = await fetch(`${KEYLESS_BASE}/openai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      model: state.settings.keylessModel,
      messages: prompt.messages,
      stream: true,
      temperature: Number(state.settings.temperature),
      top_p: Number(state.settings.topP),
      max_tokens: Number(state.settings.maxTokens),
    }),
    signal: controller.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Keyless request failed (${response.status}) ${detail.slice(0, 300)}`.trim());
  }
  if (!response.body) throw new Error('The free endpoint returned no stream.');
  yield* sseChunks(response, controller);
}

// Both streaming paths speak the same server-sent-events dialect, so the reader
// lives in one place: text arrives OpenAI-shaped either way.
async function* sseChunks(response, controller) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        const line = event.split('\n').find((part) => part.startsWith('data:'));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(chunk.error.message || 'The provider returned an error.');
        yield chunk;
      }
      if (state.stopRequested) {
        controller.abort();
        break;
      }
    }
  } finally {
    if (state.hostedAbort === controller) state.hostedAbort = null;
  }
}

/* ---------------- characters, chats, personas ---------------- */

function accentFor(character) {
  const accent = character?.accent;
  return accent && accent.length === 3 ? accent : ['#6d5dfc', '#10131d', '#3ad6c6'];
}

function applyAvatar(element, character) {
  const colors = accentFor(character);
  element.style.setProperty('--art-a', colors[0]);
  element.style.setProperty('--art-b', colors[1]);
  element.style.setProperty('--art-c', colors[2]);
  element.replaceChildren();
  if (character?.avatar) {
    const image = document.createElement('img');
    image.src = character.avatar;
    image.alt = character.name;
    element.append(image);
    element.classList.add('has-image');
  } else {
    element.classList.remove('has-image');
  }
}

function currentPersona() {
  return state.personas.find((persona) => persona.id === state.settings.personaId) || state.personas[0] || null;
}

function renderCharacterList() {
  if (!state.characters.length) {
    const empty = document.createElement('p');
    empty.className = 'rail-empty';
    empty.textContent = 'No characters yet. Build one in the library.';
    els.characterList.replaceChildren(empty);
    return;
  }
  els.characterList.replaceChildren(
    ...state.characters.map((character) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `character-pill${character.id === state.character?.id ? ' active' : ''}`;
      button.dataset.character = character.id;

      const art = document.createElement('span');
      art.className = 'character-pill-art';
      applyAvatar(art, character);

      const label = document.createElement('span');
      label.className = 'character-pill-label';
      const name = document.createElement('strong');
      name.textContent = character.name;
      const sub = document.createElement('small');
      sub.textContent = character.tagline || character.tags.slice(0, 2).join(' · ') || 'Character';
      label.append(name, sub);

      button.append(art, label);
      return button;
    })
  );
}

function renderChatList() {
  if (!state.chat) {
    els.chatList.replaceChildren();
    return;
  }
  if (!state.chats.length) {
    const empty = document.createElement('p');
    empty.className = 'rail-empty';
    empty.textContent = 'No chats with this character yet.';
    els.chatList.replaceChildren(empty);
    return;
  }
  els.chatList.replaceChildren(
    ...state.chats.map((chat) => {
      const row = document.createElement('div');
      row.className = `conversation-item${chat.id === state.chat?.id ? ' active' : ''}`;

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'conversation-open';
      open.dataset.openChat = chat.id;
      const title = document.createElement('span');
      title.textContent = chat.title || 'Chat';
      const meta = document.createElement('small');
      const replies = chat.messages.filter((message) => message.role === 'assistant').length;
      meta.textContent = `${replies} repl${replies === 1 ? 'y' : 'ies'} · ${new Date(chat.updatedAt || chat.createdAt).toLocaleDateString()}`;
      open.append(title, meta);

      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'conversation-delete';
      rename.dataset.renameChat = chat.id;
      rename.title = 'Rename chat';
      rename.setAttribute('aria-label', `Rename ${chat.title || 'chat'}`);
      rename.textContent = '✎';

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'conversation-delete';
      remove.dataset.deleteChat = chat.id;
      remove.title = 'Delete chat';
      remove.setAttribute('aria-label', `Delete ${chat.title || 'chat'}`);
      remove.textContent = '×';

      row.append(open, rename, remove);
      return row;
    })
  );
}

function syncCharacterHeader() {
  const character = state.character;
  els.characterName.textContent = character?.name || 'No character';
  els.characterTagline.textContent = character?.tagline || 'Pick a character from the rail to begin.';
  els.characterSource.textContent = character?.creator ? `by ${character.creator}` : 'Local character';
  applyAvatar(els.characterAvatar, character);

  const lore = character?.lorebook?.length || 0;
  els.characterMeta.textContent = character
    ? `${estimateTokens([character.description, character.personality, character.scenario].filter(Boolean).join(' '))} tokens in the card · ${lore} world info entr${lore === 1 ? 'y' : 'ies'}`
    : 'No card loaded.';
  els.editCardLink.href = character ? `./characters.html#${encodeURIComponent(character.id)}` : './characters.html';
}

async function selectCharacter(id) {
  const character = await getCharacter(id);
  if (!character) return;
  state.character = character;
  state.settings.characterId = character.id;
  saveSettings();
  state.chats = await listChats(character.id);
  const existing = state.chats[0];
  if (existing) await openChat(existing.id);
  else await startChat();
  syncCharacterHeader();
  renderCharacterList();
  await loadMemories();
}

async function startChat() {
  const chat = createChat(state.character);
  await saveChat(chat);
  state.chats = [chat, ...state.chats];
  state.chat = chat;
  els.authorNote.value = '';
  renderChatList();
  renderThread();
  syncControls();
}

async function openChat(id) {
  const chat = state.chats.find((item) => item.id === id);
  if (!chat) return;
  state.chat = chat;
  els.authorNote.value = chat.authorNote || '';
  renderChatList();
  renderThread();
  syncControls();
}

/* ---------------- markdown ---------------- */

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function renderInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return html;
}

function renderTextBlock(text) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${renderInline(line.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
        return `<ol>${lines.map((line) => `<li>${renderInline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
      }
      const heading = block.match(/^(#{1,4})\s+(.*)$/);
      if (heading && lines.length === 1) return `<h4>${renderInline(heading[2])}</h4>`;
      return `<p>${renderInline(block).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

function renderMarkdown(text) {
  const source = String(text || '');
  const fences = (source.match(/```/g) || []).length;
  const balanced = fences % 2 === 1 ? `${source}\n\`\`\`` : source;
  const parts = [];
  const pattern = /```([a-zA-Z0-9+#.-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(balanced))) {
    if (match.index > cursor) parts.push({ type: 'text', value: balanced.slice(cursor, match.index) });
    parts.push({ type: 'code', value: match[2] });
    cursor = pattern.lastIndex;
  }
  if (cursor < balanced.length) parts.push({ type: 'text', value: balanced.slice(cursor) });
  return parts
    .map((part) =>
      part.type === 'code'
        ? `<pre><code>${escapeHtml(part.value.replace(/\n$/, ''))}</code></pre>`
        : renderTextBlock(part.value)
    )
    .join('');
}

/* ---------------- long-term memory (CAM) ---------------- */

async function loadMemories() {
  const characterId = state.character?.id;
  state.memories = characterId ? await listMemories(characterId) : [];
  renderMemories();
}

function renderMemories() {
  const list = $('memoryList');
  const note = $('memoryNote');
  if (!list || !note) return;
  list.replaceChildren(
    ...state.memories.slice(0, 8).map((memory) => {
      const item = document.createElement('li');
      item.className = 'memory-item';
      const text = document.createElement('span');
      text.textContent = memory.text;
      const forget = document.createElement('button');
      forget.type = 'button';
      forget.className = 'memory-forget';
      forget.textContent = 'x';
      forget.title = 'Forget this';
      forget.dataset.memoryId = memory.id;
      item.append(text, forget);
      return item;
    })
  );
  if (state.memories.length) {
    const who = state.character?.name || 'this character';
    note.textContent = `${state.memories.length} fact${state.memories.length === 1 ? '' : 's'} remembered for ${who}.`;
  } else {
    note.textContent = 'Nothing remembered yet. Facts are saved as the scene goes on.';
  }
}

// Runs after each reply: cheap, local, and never touches the model queue.
async function rememberScene(chat) {
  const character = state.character;
  if (!character) return;
  const candidates = extractMemories((chat?.messages || []).slice(-12), {
    character,
    persona: currentPersona(),
    existing: state.memories.map((memory) => memory.text),
    limit: 2,
  });
  if (!candidates.length) return;
  for (const text of candidates) {
    const saved = await saveMemory({ characterId: character.id, chatId: chat?.id || null, text });
    state.memories.unshift(saved);
  }
  renderMemories();
}

async function forgetMemory(id) {
  await deleteMemory(id);
  state.memories = state.memories.filter((memory) => memory.id !== id);
  renderMemories();
}

document.addEventListener('click', async (event) => {
  const forget = event.target.closest('[data-memory-id]');
  if (forget) {
    event.preventDefault();
    await forgetMemory(forget.dataset.memoryId);
    return;
  }
  if (event.target.closest('#clearMemoryBtn')) {
    if (!state.character || !state.memories.length) return;
    if (!window.confirm(`Forget all ${state.memories.length} remembered facts?`)) return;
    await clearMemories(state.character.id);
    state.memories = [];
    renderMemories();
  }
});

/* ---------------- thread ---------------- */

function messageText(message) {
  if (!message) return '';
  const variants = message.variants || [];
  const active = variants[message.variantIndex ?? 0];
  return active ?? message.content ?? '';
}

function setMessageText(message, text) {
  if (!Array.isArray(message.variants) || !message.variants.length) message.variants = [text];
  message.variants[message.variantIndex ?? 0] = text;
  message.content = text;
}

function messageActions(message, index) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const add = (act, label, title) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.act = act;
    button.dataset.index = String(index);
    button.textContent = label;
    if (title) button.title = title;
    actions.append(button);
    return button;
  };

  const variants = message.variants || [];
  if (message.role === 'assistant' && variants.length > 1) {
    add('swipe-prev', '◀', 'Previous version').disabled = (message.variantIndex ?? 0) === 0;
    const counter = document.createElement('span');
    counter.className = 'swipe-counter';
    counter.textContent = `${(message.variantIndex ?? 0) + 1}/${variants.length}`;
    actions.append(counter);
    add('swipe-next', '▶', 'Next version').disabled = (message.variantIndex ?? 0) >= variants.length - 1;
  }

  add('copy', 'Copy');
  add('edit', 'Edit');
  if (message.role === 'assistant') add('regen', 'Regenerate');
  add('delete', 'Delete', 'Delete this message');
  return actions;
}

function buildMessage(message, index) {
  const wrapper = document.createElement('article');
  wrapper.className = `msg ${message.role === 'user' ? 'user' : 'assistant'}`;
  wrapper.dataset.index = String(index);

  const head = document.createElement('div');
  head.className = 'msg-head';
  const speaker = document.createElement('span');
  speaker.textContent = message.role === 'user' ? currentPersona()?.name || 'You' : state.character?.name || 'Character';
  head.append(speaker);
  if (message.ts) {
    const time = document.createElement('span');
    time.textContent = new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    head.append(time);
  }
  wrapper.append(head);

  if (state.editingIndex === index) {
    const editor = document.createElement('div');
    editor.className = 'msg-editor';
    const textarea = document.createElement('textarea');
    textarea.value = messageText(message);
    textarea.rows = Math.min(14, Math.max(4, Math.ceil(textarea.value.length / 70)));
    textarea.dataset.editText = String(index);
    const row = document.createElement('div');
    row.className = 'msg-editor-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'solid-button';
    save.dataset.act = 'save-edit';
    save.dataset.index = String(index);
    save.textContent = 'Save';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ghost-button';
    cancel.dataset.act = 'cancel-edit';
    cancel.textContent = 'Cancel';
    row.append(cancel, save);
    editor.append(textarea, row);
    wrapper.append(editor);
    setTimeout(() => textarea.focus(), 0);
    return wrapper;
  }

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = renderMarkdown(messageText(message));
  if (message.error) {
    const note = document.createElement('p');
    note.className = 'msg-error';
    note.textContent = message.error;
    body.append(note);
  }
  wrapper.append(body);
  wrapper.append(messageActions(message, index));
  return wrapper;
}

function renderThread() {
  if (!state.chat) {
    els.thread.replaceChildren();
    return;
  }
  if (!state.chat.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'thread-empty';
    const title = document.createElement('h2');
    title.textContent = state.character ? `${state.character.name} has not spoken yet.` : 'Pick a character to begin.';
    const hint = document.createElement('p');
    hint.textContent = 'Write your reply below. The character card, your persona and any triggered world info are sent with every message.';
    empty.append(title, hint);
    els.thread.replaceChildren(empty);
    return;
  }
  els.thread.replaceChildren(...state.chat.messages.map(buildMessage));
}

function scrollThread(force = false) {
  if (!force && !state.pinned) return;
  els.thread.scrollTop = els.thread.scrollHeight;
}

let pendingFrame = 0;
let pendingTarget = null;

/* ---------------- WebGPU + engine ---------------- */

// A phone reports the same WebGPU features as a laptop but gets a much smaller
// memory budget, and when it runs out the GPU process is torn down rather than
// raising a clean allocation error. Treat phones as their own class so the picker
// can steer to weights that actually fit.
const MOBILE_VRAM_LIMIT = 1700;

function isPhoneLike() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS reports a desktop user agent; a coarse pointer on a narrow screen is the tell.
  return (
    navigator.maxTouchPoints > 1 &&
    Boolean(window.matchMedia?.('(pointer: coarse)')?.matches) &&
    window.innerWidth < 1100
  );
}

function tooBigForDevice(model) {
  return Boolean(state.webgpu?.mobile) && Boolean(model) && model.vram > MOBILE_VRAM_LIMIT;
}

async function detectWebGPU() {
  if (!('gpu' in navigator)) {
    state.webgpu = {
      ok: false,
      message: 'This browser has no WebGPU. Use Chrome or Edge 113+, Safari 26+, or Firefox 141+ with hardware acceleration enabled.',
    };
    return state.webgpu;
  }
  try {
    const adapter =
      (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })) ||
      (await navigator.gpu.requestAdapter());
    if (!adapter) {
      state.webgpu = {
        ok: false,
        message: 'WebGPU is there but no GPU adapter answered. Turn on hardware acceleration in your browser settings and reload.',
      };
      return state.webgpu;
    }
    const info = adapter.info || {};
    const hasF16 = typeof adapter.features?.has === 'function' ? adapter.features.has('shader-f16') : false;
    const parts = [info.vendor || info.architecture ? [info.vendor, info.architecture].filter(Boolean).join(' ') : 'GPU adapter available'];
    parts.push(`shader-f16 ${hasF16 ? 'yes' : 'no'}`);
    const maxBuffer = adapter.limits?.maxBufferSize || 0;
    if (maxBuffer) parts.push(`${Math.round(maxBuffer / (1024 * 1024))} MB buffers`);
    const mobile = isPhoneLike();
    if (mobile) parts.push('phone-class device');
    state.webgpu = { ok: true, hasF16, maxBuffer, mobile, message: parts.join(' · ') };
  } catch (error) {
    state.webgpu = { ok: false, message: `WebGPU failed to initialise: ${error?.message || error}` };
  }
  return state.webgpu;
}

function renderGpuState() {
  const ok = Boolean(state.webgpu?.ok);
  els.enginePill.dataset.state = ok ? 'good' : 'bad';
  els.gpuBadge.textContent = ok ? 'WebGPU ready' : 'WebGPU unavailable';
  els.gpuDetail.textContent = state.webgpu?.message || '';
  els.notice.hidden = ok;
  if (!ok) els.notice.textContent = state.webgpu?.message || 'Local models cannot run in this browser.';
  els.loadModel.disabled = !ok;
  if (ok && state.webgpu.hasF16 === false) ensureCompatibleModel();
  if (ok) ensureFittingModel();
  syncControls();
}

// A phone cannot hold an 8B model however much it advertises, so move an oversized
// selection down to the largest one that fits instead of letting it fail mid-reply.
function ensureFittingModel() {
  const current = MODEL_CATALOG.find((model) => model.id === state.settings.modelId);
  if (!current || !tooBigForDevice(current)) return;
  const fits = MODEL_CATALOG.filter(
    (model) => !tooBigForDevice(model) && !(modelNeedsF16(model) && state.webgpu?.hasF16 === false)
  );
  if (!fits.length) return;
  const best = fits.reduce((smallest, model) => (model.vram < smallest.vram ? model : smallest), fits[0]);
  if (best.id === state.settings.modelId) return;
  state.settings.modelId = best.id;
  saveSettings();
  buildModelSelect();
}

// A GPU without shader-f16 cannot compile the f16 models at all, so quietly move
// the selection to an f32 twin and rebuild the picker around what this GPU can run.
function ensureCompatibleModel() {
  const current = MODEL_CATALOG.find((model) => model.id === state.settings.modelId);
  if (current && !modelNeedsF16(current)) return;
  const twin = f32Fallback();
  if (!twin || twin.id === state.settings.modelId) return;
  state.settings.modelId = twin.id;
  saveSettings();
  buildModelSelect();
}

async function loadWebLLM() {
  if (state.webllm) return state.webllm;
  if (!state.webllmPromise) {
    state.webllmPromise = import(WEBLLM_CDN)
      .then((module) => {
        state.webllm = module;
        decorateCachedModels(module);
        return module;
      })
      .catch((error) => {
        state.webllmPromise = null;
        throw error;
      });
  }
  return state.webllmPromise;
}

async function decorateCachedModels(module) {
  try {
    for (const option of els.modelSelect.options) {
      if (await module.hasModelInCache(option.value)) {
        if (!option.textContent.includes('· cached')) option.textContent += ' · cached';
      }
    }
  } catch {
    /* cache probing is best-effort */
  }
}

function buildModelSelect() {
  els.modelSelect.replaceChildren(
    ...MODEL_CATALOG.map((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      const flags = [model.uncensored ? 'uncensored' : null, model.recommended ? 'recommended' : null]
        .filter(Boolean)
        .join(', ');
      const needsF16 = modelNeedsF16(model) && state.webgpu?.hasF16 === false;
      const oversized = tooBigForDevice(model);
      const blocked = needsF16 || oversized;
      option.textContent = `${model.label} — ${(model.vram / 1024).toFixed(1)} GB VRAM${flags ? ` (${flags})` : ''}${
        needsF16 ? ' · needs f16' : oversized ? ' · too large for this device' : ''
      }`;
      if (blocked) {
        option.disabled = true;
        option.title = needsF16
          ? 'This GPU cannot compile f16 shaders. Pick a model marked f32.'
          : 'This device cannot hold that much GPU memory. Pick a smaller model.';
      }
      return option;
    })
  );
  els.modelSelect.value = state.settings.modelId;
  updateModelNote();
}

function updateModelNote() {
  const model = MODEL_CATALOG.find((item) => item.id === els.modelSelect.value) || MODEL_CATALOG[0];
  const warning = model.uncensored
    ? ' Uncensored fine-tune: it will not sanitise a scene for you.'
    : '';
  const blocked = modelNeedsF16(model) && state.webgpu?.hasF16 === false;
  const oversized = tooBigForDevice(model);
  const extra = blocked
    ? ' This GPU cannot compile f16 shaders, so this model will not load here — pick one marked f32.'
    : oversized
      ? ' This device cannot hold that much GPU memory — loading it usually ends with the GPU dropping the model mid-reply. Pick something under 1.7 GB.'
      : '';
  els.modelNote.textContent = `${model.note}${warning}${extra} About ${(model.vram / 1024).toFixed(1)} GB of GPU memory; the weights stay cached after the first download.`;
}

function syncModelChip() {
  if (keylessActive()) {
    els.modelChip.textContent = `${keylessLabel()} · free pool`;
    els.modelChip.dataset.state = 'ready';
    return;
  }
  if (hostedActive()) {
    els.modelChip.textContent = `${hostedModelLabel()} · hosted`;
    els.modelChip.dataset.state = 'ready';
  } else if (localActive()) {
    els.modelChip.textContent = `${localLabel()} · your server`;
    els.modelChip.dataset.state = 'ready';
  } else if (state.engine && state.engineModel) {
    const model = MODEL_CATALOG.find((item) => item.id === state.engineModel);
    els.modelChip.textContent = `${model ? model.label : state.engineModel} · loaded`;
    els.modelChip.dataset.state = 'ready';
  } else {
    els.modelChip.textContent = 'Model not loaded';
    delete els.modelChip.dataset.state;
  }
  // The hint under the box promised "runs on your GPU" on every route, which is exactly
  // the thing a visitor switching to a remote model needs to be told otherwise about.
  const route = keylessActive()
    ? 'replies come from the shared pool'
    : hostedActive()
      ? 'replies come from the hosted provider'
      : localActive()
        ? 'replies come from your server'
        : 'runs on your GPU';
  if (els.composerHint) els.composerHint.textContent = `Enter sends · Shift + Enter adds a line · ${route}`;
  // Unload is about the GPU engine, which stays loaded while a remote route answers.
  els.unloadModel.disabled = !state.engine || state.loading;
}

function showLoad(active, text, progress) {
  els.loadMeter.hidden = !active;
  if (active) {
    const percent = Math.max(2, Math.min(100, Math.round((progress || 0) * 100)));
    els.loadMeter.firstElementChild.style.width = `${percent}%`;
  }
  if (text) els.loadText.textContent = text;
}

function setLoading(active, message) {
  state.loading = active;
  els.loadModel.disabled = active || !state.webgpu?.ok;
  els.modelSelect.disabled = active;
  els.gpuBadge.textContent = active ? 'Loading model…' : state.webgpu?.ok ? 'WebGPU ready' : 'WebGPU unavailable';
  els.genStatus.hidden = !active;
  els.genStatus.classList.toggle('busy', active);
  if (active && message) els.genText.textContent = message;
  syncModelChip();
}

async function ensureEngine() {
  const modelId = els.modelSelect.value || state.settings.modelId;
  if (state.engine && state.engineModel === modelId) return state.engine;
  if (!state.webgpu?.ok) throw new Error(state.webgpu?.message || 'WebGPU is not available in this browser.');

  const chosen = MODEL_CATALOG.find((model) => model.id === modelId);
  if (tooBigForDevice(chosen)) {
    throw new Error(
      `"${chosen.label}" needs about ${(chosen.vram / 1024).toFixed(1)} GB of GPU memory and this device will drop it mid-reply. Pick Qwen2.5 0.5B or Llama 3.2 1B (f32) instead.`
    );
  }
  if (modelNeedsF16(chosen) && state.webgpu?.hasF16 === false) {
    throw new Error(
      'This GPU cannot compile f16 shaders, so that model would fail while loading. Pick a model marked f32 — Llama 3.2 1B (f32) is the same model in the form this GPU can run.'
    );
  }

  if (state.engine) {
    try {
      await state.engine.unload();
    } catch (error) {
      console.warn('Varden: previous engine did not unload cleanly', error);
    }
    state.engine = null;
    state.engineModel = null;
  }

  setLoading(true, 'Preparing the WebGPU runtime…');
  const module = await loadWebLLM();
  const known = module.prebuiltAppConfig?.model_list?.some((record) => record.model_id === modelId);
  if (!known) {
    setLoading(false);
    throw new Error(`"${modelId}" is not part of this WebLLM build. Pick another model.`);
  }

  const engine = new module.MLCEngine({
    initProgressCallback: (report) => {
      showLoad(true, report?.text || 'Downloading weights…', report?.progress || 0);
      setLoading(true, `Loading ${modelId.split('-q4')[0]}… ${Math.round((report?.progress || 0) * 100)}%`);
    },
  });

  try {
    await engine.reload(modelId);
  } catch (error) {
    showLoad(false);
    setLoading(false);
    try {
      await engine.unload();
    } catch {
      /* engine never initialised */
    }
    throw error;
  }

  state.engine = engine;
  state.engineModel = modelId;
  state.settings.modelId = modelId;
  saveSettings();
  showLoad(true, 'Model ready — weights are cached for next time.', 1);
  setLoading(false);
  return engine;
}

async function unloadEngine() {
  if (!state.engine || state.generating) return;
  try {
    await state.engine.unload();
  } catch (error) {
    console.warn('Varden: unload failed', error);
  }
  state.engine = null;
  state.engineModel = null;
  showLoad(false, 'Model unloaded. GPU memory released.');
  syncModelChip();
}

function describeError(error) {
  const message = String(error?.message || error || 'Unknown error');
  // The single most common phone failure: the GPU process is torn down mid-run
  // (memory pressure or a driver reset), so every pending buffer read rejects.
  // Nothing recovered, so the engine has to be rebuilt rather than retried.
  if (/mapAsync|unmapped before mapping|Buffer was unmapped|GPUBuffer.*unmapped/i.test(message)) {
    return 'The phone\u2019s GPU dropped the model while it was reading results back — that is memory pressure, not a model bug. Unload the model, then load the smallest one (Qwen2.5 0.5B or Llama 3.2 1B f32) and keep the scene short; on iOS close other tabs first, since Safari gives a page very little GPU memory. (' + message + ')';
  }
  if (/device.?lost|lost device|DEVICE_REMOVED|device removed/i.test(message)) {
    return 'The WebGPU device was closed by the browser, usually from running out of GPU memory. Load the smallest model and try again; the previous engine cannot be reused.';
  }
  if (/Keyless request failed \(402\)/i.test(message)) {
    return 'The free pool is at its limit: it allows one reply every 45 seconds per address, and the alias has to be one of the anonymous ones. Wait a minute and send again, or switch to a local model.';
  }
  if (/Local server failed \((\d+)\)/i.test(message)) {
    const status = message.match(/Local server failed \((\d+)\)/i)[1];
    if (status === '404') {
      return 'Your server does not have that model. Press Find models, pick one from the list, and try again.';
    }
    return `Your own server refused the request (${status}). ${message.slice(0, 200)}`;
  }
  if (/Keyless request failed \(429\)|queue is full/i.test(message)) {
    return 'The shared free endpoint is busy right now. Wait a moment and send again, or switch to a local model.';
  }
  if (/Keyless request failed \(\d+\)/i.test(message)) {
    return `The shared free endpoint refused that request. ${message.slice(0, 200)}`;
  }
  if (/^No hosted API key/i.test(message)) {
    return 'No hosted key in this browser yet. Create one at openrouter.ai/keys and paste it into the Hosted models panel — it stays on this device.';
  }
  if (/Hosted request failed \(401\)|invalid.?api.?key|No auth credentials|User not found/i.test(message)) {
    return 'The hosted provider rejected that key. Check it is an OpenRouter key (starts with sk-or-) and has not been revoked, then paste it again.';
  }
  if (/\(402\)|insufficient credits|requires more credits|not enough credits/i.test(message)) {
    return 'Your OpenRouter balance cannot cover that model. Add credit, or pick a cheaper model from the hosted list.';
  }
  if (/\(429\)|rate.?limit/i.test(message)) {
    return 'The provider is rate limiting your key. Wait a moment and send again, or choose a different hosted model.';
  }
  if (/\(404\)|No endpoints found|model not found/i.test(message)) {
    return 'That hosted model is unavailable right now. Pick another from the hosted list and press Refresh list.';
  }
  if (/\(403\)/i.test(message)) return 'The provider refused that model for this key. Pick a different hosted model.';
  if (/Hosted request failed \(\d+\)/i.test(message)) {
    return `The hosted request failed before any text arrived. ${message.slice(0, 240)}`;
  }
  if (/out of memory|oom|allocation|buffer size/i.test(message)) {
    return 'The GPU ran out of memory. Try a smaller model, or start a fresh chat to shorten the context.';
  }
  if (/device.?lost|lost device/i.test(message)) return 'The GPU device was lost. Unload the model and load it again.';
  if (/Failed to fetch|NetworkError|Load failed|net::/i.test(message) && localActive()) {
    return 'The page could not reach your server. Check it is running at that address, that it allows this page\u2019s origin (OLLAMA_ORIGINS, or LM Studio\u2019s CORS switch), and that the browser\u2019s local-network prompt was accepted. From an https page only localhost addresses are allowed over plain http.';
  }
  if (/Failed to fetch|network|net::/i.test(message) && hostedActive()) {
    return 'The request to the hosted provider did not go through. Check your connection and that the key is still valid, then try again.';
  }
  if (/Failed to fetch|network|net::/i.test(message)) return 'The model download failed. Check your connection and try again — cached parts are reused.';
  if (/not part of this WebLLM build/i.test(message)) return message;
  if (/Invalid ShaderModule|index_kernel|validating compute stage|createShaderModule|ShaderModule/i.test(message)) {
    return `Your GPU rejected this model's shaders, so it never ran. Pick a model marked f32 (Llama 3.2 1B f32 is the lightest) — those skip the half-precision path this GPU cannot compile. If you were already on an f32 model, clear this site's cached data in DevTools → Application → Storage, then reload and try again. (${message})`;
  }
  if (/shader-f16|feature not supported/i.test(message)) {
    return 'This GPU does not support the f16 feature these weights need. Pick a model marked f32 instead.';
  }
  return `Generation failed: ${message}`;
}

/* ---------------- devices ---------------- */

const DEVICE_KINDS = ['off', 'lovense', 'buttplug', 'handy'];

const DEVICE_CONFIRM_COPY = {
  lovense:
    'From now on the toy reacts while a reply streams in, and it stops when the reply ends or this tab goes to the background. Only intensity numbers are sent to the Lovense app on your network — never the words.',
  buttplug:
    'From now on the toy reacts while a reply streams in, and it stops when the reply ends or this tab goes to the background. Commands stay on this computer, inside Intiface — only intensity numbers, never the words.',
  handy:
    'From now on the stroker reacts while a reply streams in. Commands go through The Handy cloud with your connection key, and they carry only speed values — never the words. It cannot be made to expire on its own, so press Stop rather than closing the tab while it runs.',
};

const deviceConfig = () => state.settings.device;

const HANDY_MODES = ['hamp', 'hdsp'];

// Only The Handy offers a choice here, because only it can either hold one speed or be
// stepped to positions. The copy is the selector's other half: the two modes feel
// different and cost different amounts of traffic, so picking one is an informed choice.
const HANDY_MODE_COPY = {
  hamp: 'Steady speed: one continuous stroke whose speed rises and falls with the reply. Smooth and predictable, and it uses a handful of requests per minute.',
  hdsp: 'Scene-synced strokes: the device really strokes back and forth, timed from the text — shorter and faster as the prose heats up, slower when it eases, and still when the text goes quiet. Closer to the scene, but it sends a position about twice a second over the internet, so a slow connection can make it feel mechanical.',
};

function renderHandyModeNote() {
  if (!els.handyModeNote) return;
  const mode = HANDY_MODES.includes(deviceConfig().handyMode) ? deviceConfig().handyMode : 'hamp';
  const contrast =
    mode === 'hdsp'
      ? 'Steady speed is the smoother, lighter option if the strokes feel jerky.'
      : 'Scene-synced is the closer option if you want it to follow what is happening rather than the pace of the writing.';
  els.handyModeNote.textContent = `${HANDY_MODE_COPY[mode]} ${contrast}`;
}

function setDeviceStatus(text) {
  state.deviceStatus = text || '';
  renderDeviceStatus();
}

function buildDeviceUi() {
  const config = deviceConfig();
  if (els.handyMode) els.handyMode.value = HANDY_MODES.includes(config.handyMode) ? config.handyMode : 'hamp';
  if (els.deviceKind) els.deviceKind.value = DEVICE_KINDS.includes(config.kind) ? config.kind : 'off';
  if (els.lovenseHost) els.lovenseHost.value = config.lovenseHost;
  if (els.lovensePort) els.lovensePort.value = String(config.lovensePort);
  if (els.buttplugUrl) els.buttplugUrl.value = config.buttplugUrl;
  if (els.handyKey) els.handyKey.value = config.handyKey;
  if (els.handyAppKey) els.handyAppKey.value = config.handyAppKey;
  if (els.deviceMax) els.deviceMax.value = String(config.cap);
  if (els.deviceMaxOut) els.deviceMaxOut.value = String(config.cap);
  renderDeviceFields();
  renderDeviceStatus();
}

function renderDeviceFields() {
  const kind = deviceConfig().kind;
  if (els.deviceFieldsLovense) els.deviceFieldsLovense.hidden = kind !== 'lovense';
  if (els.deviceFieldsButtplug) els.deviceFieldsButtplug.hidden = kind !== 'buttplug';
  if (els.deviceFieldsHandy) els.deviceFieldsHandy.hidden = kind !== 'handy';
  if (els.deviceConfirmBody) els.deviceConfirmBody.textContent = DEVICE_CONFIRM_COPY[kind] || '';
  renderHandyModeNote();
  syncDeviceControls();
}

function syncDeviceControls() {
  const connected = Boolean(state.devices?.connected);
  if (els.deviceConnect) els.deviceConnect.disabled = connected;
  if (els.deviceStop) els.deviceStop.disabled = !connected;
  if (els.deviceTest) els.deviceTest.disabled = !connected || state.deviceTesting === true;
  if (els.deviceDisconnect) els.deviceDisconnect.disabled = !connected;
  if (els.deviceKind) els.deviceKind.disabled = connected;
  // The mode is sent once at connect, so changing it mid-session would be a lie.
  if (els.handyMode) els.handyMode.disabled = connected;
}

function renderDeviceStatus() {
  if (!els.deviceStatus) return;
  const bits = [];
  if (state.devices?.connected) {
    bits.push(`Connected: ${state.devices.label}. It reacts while a reply streams and stops when the reply ends.`);
  } else if (deviceConfig().kind !== 'off') {
    bits.push('Not connected yet.');
  }
  if (state.deviceStatus) bits.push(state.deviceStatus);
  if (!bits.length) bits.push('Nothing connected. Chat works exactly the same without a device.');
  els.deviceStatus.textContent = bits.join(' ');
  syncDeviceControls();
}

function setDeviceConfirm(open) {
  if (!els.deviceConfirm) return;
  els.deviceConfirm.hidden = !open;
  if (open) els.deviceConfirmYes?.focus();
}

// Connecting is the consent: nothing is opened until this runs, and the first time it
// explains what will move before it does.
async function connectDevice() {
  const config = deviceConfig();
  if (config.kind === 'off') {
    setDeviceStatus('Pick a device in the list first.');
    return;
  }
  if (config.confirmed !== true) {
    setDeviceConfirm(true);
    return;
  }
  setDeviceConfirm(false);
  setDeviceStatus('Looking for the device…');
  try {
    const label = await state.devices.connect({ ...config, pageProtocol: window.location.protocol });
    setDeviceStatus(`Connected to ${label}.`);
  } catch (error) {
    setDeviceStatus(String(error?.message || error || 'Could not connect to the device.'));
    console.warn('Varden: device connect failed', error);
  }
  renderDeviceStatus();
}

/* ---------------- generation ---------------- */

function syncControls() {
  const busy = state.generating;
  const ready = Boolean(state.webgpu?.ok) || hostedActive() || keylessActive() || localActive();
  els.send.disabled = busy || !ready;
  els.continue.disabled = busy || !ready || !state.chat?.messages.some((message) => message.role === 'assistant');
  els.stop.hidden = !busy;
  els.input.disabled = busy;
  els.exportChat.disabled = !state.chat?.messages.length;
  els.newChat.disabled = busy;
}

function deriveTitle(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 44 ? `${clean.slice(0, 44).trimEnd()}…` : clean || 'Chat';
}

async function persistChat() {
  if (!state.chat) return;
  state.chat = await saveChat(state.chat);
  state.chats = [state.chat, ...state.chats.filter((chat) => chat.id !== state.chat.id)].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );
  renderChatList();
  syncControls();
}

async function sendMessage(rawText) {
  if (state.generating || !state.chat) return;
  const text = String(rawText || '').trim();
  if (!text) return;
  if (!state.webgpu?.ok && !hostedActive() && !keylessActive() && !localActive()) {
    els.notice.hidden = false;
    els.notice.textContent =
      state.webgpu?.message ||
      'WebGPU is unavailable here, so local models cannot run. Pick a hosted model or the keyless pool in the panel.';
    return;
  }
  els.input.value = '';
  autoGrowInput();
  state.chat.messages.push(createMessage('user', text));
  if (state.chat.messages.filter((message) => message.role === 'user').length === 1) {
    state.chat.title = deriveTitle(text);
  }
  state.pinned = true;
  renderThread();
  scrollThread(true);
  await persistChat();
  await generate({ mode: 'reply' });
}

async function generate({ mode = 'reply', index = null } = {}) {
  if (!state.chat || state.generating) return;
  const chat = state.chat;
  state.generating = true;
  state.stopRequested = false;
  syncControls();

  let target;
  let history;

  if (mode === 'regenerate' && index !== null) {
    target = chat.messages[index];
    if (!target) {
      state.generating = false;
      syncControls();
      return;
    }
    target.variants = [...(target.variants || [messageText(target)]), ''];
    target.variantIndex = target.variants.length - 1;
    target.content = '';
    delete target.error;
    history = chat.messages.slice(0, index);
  } else if (mode === 'continue') {
    target = [...chat.messages].reverse().find((message) => message.role === 'assistant');
    if (!target) {
      state.generating = false;
      syncControls();
      return;
    }
    history = chat.messages;
  } else {
    target = createMessage('assistant', '');
    chat.messages.push(target);
    history = chat.messages.slice(0, -1);
  }

  const targetIndex = chat.messages.indexOf(target);
  state.editingIndex = null;
  renderThread();
  state.pinned = true;
  scrollThread(true);

  const persona = currentPersona();
  if (!state.memories.length) await loadMemories();
  const activeModel = MODEL_CATALOG.find((item) => item.id === (state.engineModel || state.settings.modelId));
  const recentText = history.slice(-6).map((message) => message.content).join(' ');
  const prompt = buildPrompt({
    character: state.character,
    persona,
    chat: { ...chat, messages: history },
    noThink: Boolean(activeModel?.noThink),
    memories: relevantMemories(state.memories, recentText, 8),
  });
  let text = mode === 'continue' ? messageText(target) : '';
  let usage = null;
  let firstTokenAt = 0;

  try {
    // Both paths hand back the same async iterable of OpenAI-shaped chunks, so the
    // streaming loop below does not care which one produced it.
    const stream = keylessActive()
      ? keylessStream(prompt)
      : hostedActive()
        ? hostedStream(prompt)
        : localActive()
          ? localStream(prompt)
          : await createLocalStream(prompt);

    state.devices?.begin();
    els.genStatus.hidden = false;
    els.genStatus.classList.add('busy');
    els.genText.textContent = localActive()
      ? `Generating on your own server · ${localLabel()}`
      : keylessActive()
      ? `Generating on the shared free endpoint · ${keylessLabel()}`
      : hostedActive()
      ? `Generating with ${hostedModelLabel()} · billed to your key`
      : prompt.dropped
        ? `Generating on your GPU · ${prompt.dropped} older message${prompt.dropped === 1 ? '' : 's'} trimmed for context`
        : 'Generating on your GPU…';

    for await (const chunk of stream) {
      if (state.stopRequested) break;
      const delta = chunk?.choices?.[0]?.delta?.content || '';
      if (delta) {
        if (!firstTokenAt) firstTokenAt = performance.now();
        text += delta;
        setMessageText(target, text);
        state.devices?.feed(delta);
        scheduleStream(targetIndex, text);
      }
      if (chunk?.usage) usage = chunk.usage;
    }
  } catch (error) {
    // Stopping a hosted reply aborts the request, which arrives here as an AbortError.
    const aborted = state.stopRequested || /abort/i.test(String(error?.name || ''));
    if (!aborted) {
      target.error = describeError(error);
      console.error('Varden: generation failed', error);
      // A lost device cannot be reused, so drop the engine: the next attempt rebuilds
      // it instead of streaming into a GPU that is no longer there.
      if (/mapAsync|unmapped|device.?lost|DEVICE_REMOVED/i.test(String(error?.message || error))) {
        state.engine = null;
        state.engineModel = null;
        showLoad(false);
        syncModelChip();
      }
    }
  } finally {
    if (pendingFrame) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
      pendingTarget = null;
    }
    const elapsed = firstTokenAt ? (performance.now() - firstTokenAt) / 1000 : 0;
    if (usage?.completion_tokens && elapsed > 0) target.tokensPerSecond = +(usage.completion_tokens / elapsed).toFixed(1);
    if (state.stopRequested) target.stopped = true;
    if (!text.trim() && !target.error) {
      target.error = state.stopRequested ? 'Stopped before the first token.' : 'The model returned an empty reply. Try again.';
    }
    setMessageText(target, text);
    void state.devices?.finish();
    state.generating = false;
    state.stopRequested = false;
    els.genStatus.classList.remove('busy');
    els.genStatus.hidden = true;
    renderThread();
    await persistChat();
    syncModelChip();
    void rememberScene(chat);
  }
}

// The local engine is created lazily, so it is awaited here and then handed back as
// the same kind of streaming result the hosted path yields.
async function createLocalStream(prompt) {
  const engine = await ensureEngine();
  return engine.chat.completions.create({
    messages: prompt.messages,
    stream: true,
    temperature: Number(state.settings.temperature),
    top_p: Number(state.settings.topP),
    max_tokens: Number(state.settings.maxTokens),
    stream_options: { include_usage: true },
  });
}

// Streaming updates the body of the message currently being written.
function scheduleStream(index, text) {
  const body = els.thread.querySelector(`.msg[data-index="${index}"] .msg-body`);
  if (!body) return;
  pendingTarget = { body, text };
  if (pendingFrame) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    if (!pendingTarget) return;
    pendingTarget.body.innerHTML = renderMarkdown(pendingTarget.text);
    const caret = document.createElement('span');
    caret.className = 'cursor';
    pendingTarget.body.append(caret);
    pendingTarget = null;
    scrollThread();
  });
}

function stopGeneration() {
  if (!state.generating) return;
  state.stopRequested = true;
  // Stop means stop, for the device as well as the model.
  state.devices?.stopNow();
  els.genText.textContent = 'Stopping…';
  try {
    state.hostedAbort?.abort();
  } catch {
    /* request already closed */
  }
  try {
    state.engine?.interruptGenerate?.();
  } catch (error) {
    console.warn('Varden: interrupt failed', error);
  }
}

/* ---------------- thread interactions ---------------- */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement('textarea');
    helper.value = text;
    document.body.append(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  }
}

async function handleThreadAction(action, index) {
  const message = state.chat?.messages[index];
  if (!message) return;

  switch (action) {
    case 'copy':
      await copyText(messageText(message));
      break;
    case 'edit':
      if (state.generating) return;
      state.editingIndex = index;
      renderThread();
      break;
    case 'cancel-edit':
      state.editingIndex = null;
      renderThread();
      break;
    case 'save-edit': {
      const textarea = els.thread.querySelector(`[data-edit-text="${index}"]`);
      if (!textarea) return;
      const value = textarea.value.trim();
      if (value) setMessageText(message, value);
      message.edited = true;
      state.editingIndex = null;
      renderThread();
      await persistChat();
      break;
    }
    case 'delete':
      if (state.generating) return;
      if (!window.confirm('Delete this message?')) return;
      state.chat.messages.splice(index, 1);
      state.editingIndex = null;
      renderThread();
      await persistChat();
      break;
    case 'regen':
      await generate({ mode: 'regenerate', index });
      break;
    case 'swipe-prev':
      if ((message.variantIndex ?? 0) <= 0) return;
      message.variantIndex = (message.variantIndex ?? 0) - 1;
      setMessageText(message, message.variants[message.variantIndex]);
      renderThread();
      await persistChat();
      break;
    case 'swipe-next':
      if ((message.variantIndex ?? 0) >= (message.variants?.length || 1) - 1) return;
      message.variantIndex = (message.variantIndex ?? 0) + 1;
      setMessageText(message, message.variants[message.variantIndex]);
      renderThread();
      await persistChat();
      break;
    default:
      break;
  }
}

/* ---------------- personas ---------------- */

function renderPersonaSelect() {
  els.personaSelect.replaceChildren(
    ...state.personas.map((persona) => {
      const option = document.createElement('option');
      option.value = persona.id;
      option.textContent = persona.name;
      return option;
    })
  );
  const active = currentPersona();
  if (active) els.personaSelect.value = active.id;
}

function openPersonaDialog() {
  const persona = currentPersona();
  els.personaName.value = persona?.name || 'You';
  els.personaDescription.value = persona?.description || '';
  els.personaDialog.showModal();
  els.personaName.focus();
}

async function savePersonaFromDialog(asNew) {
  const name = els.personaName.value.trim() || 'You';
  const description = els.personaDescription.value.trim();
  const persona = await savePersona({
    id: asNew ? undefined : currentPersona()?.id,
    name,
    description,
  });
  state.personas = await listPersonas();
  state.settings.personaId = persona.id;
  saveSettings();
  renderPersonaSelect();
  els.personaDialog.close();
  renderThread();
}

/* ---------------- chat management ---------------- */

function exportActiveChat(format) {
  if (!state.chat) return;
  const slug = (state.character?.name || 'chat').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'chat';
  if (format === 'json') {
    downloadText(JSON.stringify({ character: state.character?.name, title: state.chat.title, messages: state.chat.messages }, null, 2), `${slug}-${state.chat.id.slice(0, 6)}.json`, 'application/json');
  } else {
    downloadText(chatToText(state.chat, state.character, currentPersona()), `${slug}-${state.chat.id.slice(0, 6)}.txt`);
  }
}

async function renameChat(id) {
  const chat = state.chats.find((item) => item.id === id);
  if (!chat) return;
  const title = window.prompt('Rename this chat', chat.title || 'Chat');
  if (title === null) return;
  const trimmed = title.trim();
  if (!trimmed) return;
  chat.title = trimmed;
  if (state.chat?.id === id) state.chat.title = trimmed;
  await persistChat();
}

async function deleteChatById(id) {
  const chat = state.chats.find((item) => item.id === id);
  if (!chat) return;
  if (!window.confirm(`Delete "${chat.title || 'this chat'}"? This cannot be undone.`)) return;
  await removeChat(id);
  state.chats = state.chats.filter((item) => item.id !== id);
  if (state.chat?.id === id) {
    if (state.chats.length) await openChat(state.chats[0].id);
    else await startChat();
  }
  renderChatList();
}

/* ---------------- events ---------------- */

function autoGrowInput() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 200)}px`;
}

function syncSettingsUi() {
  els.modelSelect.value = state.settings.modelId;
  els.temperature.value = String(state.settings.temperature);
  els.topP.value = String(state.settings.topP);
  els.maxTokens.value = String(state.settings.maxTokens);
  els.tempOut.value = Number(state.settings.temperature).toFixed(2);
  els.topPOut.value = Number(state.settings.topP).toFixed(2);
  els.maxOut.value = String(state.settings.maxTokens);
  updateModelNote();
  syncModelChip();
}

function bindEvents() {
  els.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(els.input.value);
  });

  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage(els.input.value);
    }
  });
  els.input.addEventListener('input', autoGrowInput);

  els.stop.addEventListener('click', stopGeneration);
  els.continue.addEventListener('click', () => generate({ mode: 'continue' }));

  els.characterList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-character]');
    if (!button || state.generating) return;
    await selectCharacter(button.dataset.character);
  });

  els.chatList.addEventListener('click', async (event) => {
    if (state.generating) return;
    const open = event.target.closest('[data-open-chat]');
    if (open) {
      await openChat(open.dataset.openChat);
      return;
    }
    const rename = event.target.closest('[data-rename-chat]');
    if (rename) {
      await renameChat(rename.dataset.renameChat);
      return;
    }
    const removeButton = event.target.closest('[data-delete-chat]');
    if (removeButton) await deleteChatById(removeButton.dataset.deleteChat);
  });

  els.newChat.addEventListener('click', async () => {
    if (state.generating) return;
    await startChat();
  });

  els.thread.addEventListener('click', (event) => {
    const action = event.target.closest('[data-act]');
    if (!action) return;
    handleThreadAction(action.dataset.act, Number(action.dataset.index));
  });

  els.thread.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      const action = els.thread.querySelector('[data-act="save-edit"]');
      if (action && document.activeElement?.dataset.editText) {
        event.preventDefault();
        handleThreadAction('save-edit', Number(action.dataset.index));
      }
    }
  });

  els.thread.addEventListener('scroll', () => {
    const thread = els.thread;
    state.pinned = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
  });

  els.modelSelect.addEventListener('change', () => {
    state.settings.modelId = els.modelSelect.value;
    // Choosing from the GPU list is also how you switch back from any other route.
    state.settings.hostedModel = null;
    state.settings.keylessModel = null;
    state.settings.localModel = null;
    state.hosted.status = '';
    state.keyless.status = '';
    state.local.status = '';
    setKeylessConfirm(false);
    saveSettings();
    updateModelNote();
    syncModelChip();
    syncControls();
    renderHostedStatus();
    renderKeylessStatus();
    renderLocalStatus();
  });

  els.hostedSelect?.addEventListener('change', renderHostedNote);
  els.hostedKey?.addEventListener('input', () => {
    setHostedKey(els.hostedKey.value, els.hostedRemember.checked);
    state.hosted.status = '';
    renderHostedStatus();
  });
  els.hostedRemember?.addEventListener('change', () => {
    setHostedKey(els.hostedKey.value, els.hostedRemember.checked);
    state.hosted.status = els.hostedRemember.checked
      ? 'Key will be remembered on this device.'
      : 'Key is kept only until this tab closes.';
    renderHostedStatus();
  });
  els.hostedUse?.addEventListener('click', () => {
    const id = els.hostedSelect.value;
    if (!id) {
      state.hosted.status = 'Pick a hosted model first.';
      renderHostedStatus();
      return;
    }
    if (!readHostedKey()) {
      state.hosted.status = 'Add your OpenRouter key above first — browsing the list needs no key, chatting does.';
      renderHostedStatus();
      els.hostedKey.focus();
      return;
    }
    state.settings.hostedModel = id;
    state.settings.keylessModel = null;
    state.settings.localModel = null;
    state.hosted.status = '';
    state.keyless.status = '';
    state.local.status = '';
    setKeylessConfirm(false);
    saveSettings();
    syncModelChip();
    renderHostedStatus();
    renderKeylessStatus();
    renderLocalStatus();
    els.notice.hidden = true;
  });
  els.hostedForget?.addEventListener('click', () => {
    setHostedKey('', false);
    if (els.hostedKey) els.hostedKey.value = '';
    if (els.hostedRemember) els.hostedRemember.checked = false;
    state.hosted.status = 'Key removed from this browser.';
    renderHostedStatus();
  });
  els.hostedRefresh?.addEventListener('click', () => {
    state.hosted.status = '';
    loadHostedModels();
  });

  els.keylessSelect?.addEventListener('change', () => {
    renderKeylessNote();
    setKeylessConfirm(false);
  });
  els.keylessUse?.addEventListener('click', () => {
    const id = els.keylessSelect.value;
    if (!id) {
      state.keyless.status = 'There is no free alias to use right now.';
      renderKeylessStatus();
      return;
    }
    // The first switch is a question, not a setting: nothing is activated until the
    // answer comes back, so cancelling leaves the previous route exactly as it was.
    if (state.settings.keylessConfirmed !== true) {
      state.keyless.status = 'The free pool is off this device. Confirm below to switch — it is asked once.';
      renderKeylessStatus();
      setKeylessConfirm(true);
      return;
    }
    activateKeyless(id);
  });
  els.keylessConfirmYes?.addEventListener('click', () => {
    state.settings.keylessConfirmed = true;
    activateKeyless(els.keylessSelect.value || KEYLESS_FALLBACK[0]);
  });
  els.keylessConfirmCancel?.addEventListener('click', () => {
    setKeylessConfirm(false);
    state.keyless.status = 'Stayed on this device. Nothing was switched and no scene was sent.';
    renderKeylessStatus();
  });
  els.keylessRefresh?.addEventListener('click', () => {
    state.keyless.status = '';
    loadKeylessModels();
  });

  els.localKey?.addEventListener('input', () => {
    // Kept for this tab only: a server key is a secret and this route is meant to run
    // without one, so it never goes near localStorage.
    state.local.key = els.localKey.value.trim();
  });
  els.localBase?.addEventListener('change', () => {
    const next = normalizeLocalBase(els.localBase.value);
    if (els.localBase.value !== next) els.localBase.value = next;
    if (next === state.settings.localBase) return;
    state.settings.localBase = next;
    // A different address is a different route, so the old one is dropped rather than
    // quietly pointed somewhere the visitor did not choose.
    if (state.settings.localModel) {
      state.settings.localModel = null;
      state.local.models = [];
      renderLocalModelList();
      state.local.status = 'Address changed, so the old route was dropped. Press Find models, then Use this server.';
    }
    saveSettings();
    syncModelChip();
    syncControls();
    renderLocalStatus();
  });
  els.localFind?.addEventListener('click', () => {
    void findLocalModels();
  });
  els.localUse?.addEventListener('click', () => {
    const model = els.localModel.value.trim();
    if (!model) {
      state.local.status = 'Name the model your server is running, then press this again.';
      renderLocalStatus();
      els.localModel.focus();
      return;
    }
    activateLocal(model);
  });

  els.deviceKind?.addEventListener('change', () => {
    deviceConfig().kind = els.deviceKind.value;
    deviceConfig().confirmed = false;
    saveSettings();
    setDeviceConfirm(false);
    renderDeviceFields();
    renderDeviceStatus();
  });
  const saveDeviceField = (key, element, transform) => {
    if (!element) return;
    element.addEventListener('input', () => {
      deviceConfig()[key] = transform ? transform(element.value) : element.value;
      saveSettings();
    });
  };
  saveDeviceField('lovenseHost', els.lovenseHost);
  saveDeviceField('lovensePort', els.lovensePort, (value) => clampSetting(value, 30010, 1, 65535));
  saveDeviceField('buttplugUrl', els.buttplugUrl);
  saveDeviceField('handyKey', els.handyKey);
  saveDeviceField('handyAppKey', els.handyAppKey);
  els.handyMode?.addEventListener('change', () => {
    const choice = els.handyMode.value;
    deviceConfig().handyMode = HANDY_MODES.includes(choice) ? choice : 'hamp';
    saveSettings();
    renderHandyModeNote();
  });
  els.deviceMax?.addEventListener('input', () => {
    deviceConfig().cap = clampSetting(els.deviceMax.value, 60);
    if (els.deviceMaxOut) els.deviceMaxOut.value = String(deviceConfig().cap);
    // Saving the number is not the same as letting it move: the cap only applies to a
    // device that is already connected.
    state.devices?.setCap(deviceConfig().cap);
    saveSettings();
  });
  els.deviceConnect?.addEventListener('click', () => {
    void connectDevice();
  });
  els.deviceConfirmYes?.addEventListener('click', () => {
    deviceConfig().confirmed = true;
    saveSettings();
    void connectDevice();
  });
  els.deviceConfirmCancel?.addEventListener('click', () => {
    setDeviceConfirm(false);
    setDeviceStatus('Nothing was connected.');
  });
  els.deviceStop?.addEventListener('click', () => {
    state.devices?.stopNow();
    setDeviceStatus('Stopped.');
  });
  els.deviceTest?.addEventListener('click', () => {
    void (async () => {
      if (state.deviceTesting) return;
      state.deviceTesting = true;
      syncDeviceControls();
      setDeviceStatus('Sending a one-second test pulse…');
      try {
        await state.devices?.pulse();
        setDeviceStatus('Test pulse finished. If nothing moved, check the device is on and not in a mode of its own.');
      } catch (error) {
        setDeviceStatus(String(error?.message || error || 'The test pulse failed.'));
        console.warn('Varden: device test failed', error);
      } finally {
        state.deviceTesting = false;
        renderDeviceStatus();
      }
    })();
  });
  els.deviceDisconnect?.addEventListener('click', () => {
    void (async () => {
      await state.devices?.disconnect();
      setDeviceStatus('Disconnected.');
      renderDeviceStatus();
    })();
  });

  // A reply that keeps driving a toy while the tab is hidden or closing is the failure
  // mode worth designing against.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.devices?.stopNow();
  });
  window.addEventListener('pagehide', () => state.devices?.stopNow());

  els.personaSelect.addEventListener('change', () => {
    state.settings.personaId = els.personaSelect.value;
    saveSettings();
    renderThread();
  });

  els.editPersona.addEventListener('click', openPersonaDialog);
  els.personaCancel.addEventListener('click', () => els.personaDialog.close());
  els.personaClose.addEventListener('click', () => els.personaDialog.close());
  els.personaSave.addEventListener('click', async (event) => {
    event.preventDefault();
    await savePersonaFromDialog(false);
  });
  els.personaSaveNew.addEventListener('click', async () => {
    await savePersonaFromDialog(true);
  });
  els.personaForm.addEventListener('submit', (event) => {
    event.preventDefault();
    savePersonaFromDialog(false);
  });

  els.authorNote.addEventListener('input', () => {
    if (!state.chat) return;
    state.chat.authorNote = els.authorNote.value;
    clearTimeout(els.authorNote.timer);
    els.authorNote.timer = setTimeout(() => persistChat(), 600);
  });

  els.temperature.addEventListener('input', () => {
    state.settings.temperature = Number(els.temperature.value);
    els.tempOut.value = Number(els.temperature.value).toFixed(2);
    saveSettings();
  });
  els.topP.addEventListener('input', () => {
    state.settings.topP = Number(els.topP.value);
    els.topPOut.value = Number(els.topP.value).toFixed(2);
    saveSettings();
  });
  els.maxTokens.addEventListener('input', () => {
    state.settings.maxTokens = Number(els.maxTokens.value);
    els.maxOut.value = String(state.settings.maxTokens);
    saveSettings();
  });

  els.loadModel.addEventListener('click', async () => {
    if (state.generating || state.loading) return;
    try {
      await ensureEngine();
      showLoad(true, 'Model ready — weights are cached for next time.', 1);
    } catch (error) {
      showLoad(false);
      els.loadText.textContent = describeError(error);
    }
  });
  els.unloadModel.addEventListener('click', unloadEngine);

  els.exportChat.addEventListener('click', () => {
    const format = window.confirm('Export as JSON? Choose Cancel for a plain text transcript.') ? 'json' : 'txt';
    exportActiveChat(format);
  });

  window.addEventListener('beforeunload', (event) => {
    if (state.generating) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

/* ---------------- boot ---------------- */

async function init() {
  loadSettings();
  buildModelSelect();
  loadHostedKey();
  buildHostedSelect();
  buildKeylessSelect();
  state.devices = createDevices({ onStatus: setDeviceStatus });
  buildDeviceUi();
  bindEvents();
  syncSettingsUi();

  await ensureSeeded();
  await migrateLegacyChats();

  state.characters = await listCharacters();
  state.personas = await listPersonas();
  if (!state.settings.personaId || !state.personas.some((persona) => persona.id === state.settings.personaId)) {
    state.settings.personaId = state.personas[0]?.id || null;
  }
  renderPersonaSelect();

  await detectWebGPU();
  renderGpuState();
  renderHostedStatus();
  renderKeylessStatus();
  syncLocalFields();
  renderLocalStatus();
  // Both catalogs are public requests with no credentials, so they load even when
  // WebGPU is missing entirely. The server list is not fetched here: it is only ever
  // asked when the visitor presses Find models.
  setTimeout(() => {
    loadHostedModels();
    loadKeylessModels();
  }, 600);

  const params = new URLSearchParams(window.location.search);
  const requested = params.get('character');
  const fallback = state.settings.characterId && state.characters.some((item) => item.id === state.settings.characterId)
    ? state.settings.characterId
    : state.characters[0]?.id;

  if (requested && state.characters.some((character) => character.id === requested)) {
    // Starting from a character card: always open a clean scene.
    state.character = await getCharacter(requested);
    state.settings.characterId = state.character.id;
    saveSettings();
    state.chats = await listChats(state.character.id);
    await startChat();
    syncCharacterHeader();
    renderCharacterList();
    await loadMemories();
  } else {
    await selectCharacter(fallback);
  }

  syncControls();

  if (state.webgpu?.ok) {
    setTimeout(() => {
      loadWebLLM().catch((error) => console.warn('Varden: WebLLM prefetch failed', error));
    }, 1200);
  }
}

init().catch((error) => {
  console.error('Varden chat: failed to start', error);
  els.notice.hidden = false;
  els.notice.textContent = `Chat failed to start: ${error?.message || error}`;
});
