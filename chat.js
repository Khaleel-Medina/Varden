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

const DEFAULT_SETTINGS = {
  modelId: DEFAULT_MODEL,
  temperature: 0.85,
  topP: 0.95,
  maxTokens: 384,
  personaId: null,
  characterId: null,
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
  exportChat: $('exportChatBtn'),
  personaDialog: $('personaDialog'),
  personaForm: $('personaForm'),
  personaName: $('personaNameInput'),
  personaDescription: $('personaDescription'),
  personaSave: $('personaSave'),
  personaSaveNew: $('personaSaveNew'),
  personaCancel: $('personaCancel'),
  personaClose: $('personaClose'),
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
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch (error) {
    console.warn('Varden: could not save settings', error);
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
    state.webgpu = { ok: true, hasF16, message: parts.join(' · ') };
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
  syncControls();
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
      const blocked = modelNeedsF16(model) && state.webgpu?.hasF16 === false;
      option.textContent = `${model.label} — ${(model.vram / 1024).toFixed(1)} GB VRAM${flags ? ` (${flags})` : ''}${
        blocked ? ' · needs f16' : ''
      }`;
      if (blocked) {
        option.disabled = true;
        option.title = 'This GPU cannot compile f16 shaders. Pick a model marked f32.';
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
  const extra = blocked
    ? ' This GPU cannot compile f16 shaders, so this model will not load here — pick one marked f32.'
    : '';
  els.modelNote.textContent = `${model.note}${warning}${extra} About ${(model.vram / 1024).toFixed(1)} GB of GPU memory; the weights stay cached after the first download.`;
}

function syncModelChip() {
  if (state.engine && state.engineModel) {
    const model = MODEL_CATALOG.find((item) => item.id === state.engineModel);
    els.modelChip.textContent = `${model ? model.label : state.engineModel} · loaded`;
    els.modelChip.dataset.state = 'ready';
  } else {
    els.modelChip.textContent = 'Model not loaded';
    delete els.modelChip.dataset.state;
  }
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
  if (/out of memory|oom|allocation|buffer size/i.test(message)) {
    return 'The GPU ran out of memory. Try a smaller model, or start a fresh chat to shorten the context.';
  }
  if (/device.?lost|lost device/i.test(message)) return 'The GPU device was lost. Unload the model and load it again.';
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

/* ---------------- generation ---------------- */

function syncControls() {
  const busy = state.generating;
  els.send.disabled = busy || !state.webgpu?.ok;
  els.continue.disabled = busy || !state.webgpu?.ok || !state.chat?.messages.some((message) => message.role === 'assistant');
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
  if (!state.webgpu?.ok) {
    els.notice.hidden = false;
    els.notice.textContent = state.webgpu?.message || 'WebGPU is unavailable, so local models cannot run here.';
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
    const engine = await ensureEngine();
    const stream = await engine.chat.completions.create({
      messages: prompt.messages,
      stream: true,
      temperature: Number(state.settings.temperature),
      top_p: Number(state.settings.topP),
      max_tokens: Number(state.settings.maxTokens),
      stream_options: { include_usage: true },
    });

    els.genStatus.hidden = false;
    els.genStatus.classList.add('busy');
    els.genText.textContent = prompt.dropped
      ? `Generating on your GPU · ${prompt.dropped} older message${prompt.dropped === 1 ? '' : 's'} trimmed for context`
      : 'Generating on your GPU…';

    for await (const chunk of stream) {
      if (state.stopRequested) break;
      const delta = chunk?.choices?.[0]?.delta?.content || '';
      if (delta) {
        if (!firstTokenAt) firstTokenAt = performance.now();
        text += delta;
        setMessageText(target, text);
        scheduleStream(targetIndex, text);
      }
      if (chunk?.usage) usage = chunk.usage;
    }
  } catch (error) {
    target.error = describeError(error);
    console.error('Varden: generation failed', error);
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
  els.genText.textContent = 'Stopping…';
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
    saveSettings();
    updateModelNote();
  });

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
