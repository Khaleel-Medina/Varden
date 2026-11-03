// Varden — character library page.
// Local-first character cards: create, edit, import/export Tavern cards, favourite,
// duplicate, delete, then hand off to the chat page.

import {
  buildCardJson,
  buildCardPng,
  cardTokens,
  downloadBlob,
  ensureSeeded,
  deleteCharacter,
  getCharacter,
  listCharacters,
  listChats,
  migrateLegacyChats,
  normalizeCharacter,
  parseCardFile,
  saveCharacter,
  uid,
} from './cards.js';
import {
  cardArtUrl,
  deleteSharedCard,
  fetchSharedCard,
  getSharedUser,
  listMyCards,
  listSharedCards,
  OAUTH_PROVIDERS,
  oauthErrorFromUrl,
  onAuthChange,
  shareCard,
  signIn,
  signInWithProvider,
  signOut,
  signUp,
  updateSharedCard,
  viewerIsAdmin,
} from './shared.js';

const state = {
  characters: [],
  chats: [],
  query: '',
  tag: 'all',
  sort: 'recent',
  editingId: null,
  avatar: null,
  lore: [],
  shared: {
    cards: [],
    error: null,
    user: null,
    loading: false,
    mine: [],
    mineError: null,
    mineLoading: false,
    returning: false,
    showNsfw: false,
    isAdmin: false,
  },
  account: { mode: 'signin', busy: false },
  share: { character: null, busy: false },
  upload: { row: null, character: null, busy: false },
};

const els = {
  grid: document.getElementById('characterGrid'),
  search: document.getElementById('searchInput'),
  sort: document.getElementById('sortSelect'),
  tagFilter: document.getElementById('tagFilter'),
  statCharacters: document.getElementById('statCharacters'),
  statTokens: document.getElementById('statTokens'),
  statChats: document.getElementById('statChats'),
  newButton: document.getElementById('newCharacterBtn'),
  importButton: document.getElementById('importBtn'),
  importInput: document.getElementById('importInput'),
  dialog: document.getElementById('editorDialog'),
  form: document.getElementById('editorForm'),
  editorEyebrow: document.getElementById('editorEyebrow'),
  editorTitle: document.getElementById('editorTitle'),
  editorClose: document.getElementById('editorClose'),
  editorCancel: document.getElementById('editorCancel'),
  avatarPreview: document.getElementById('avatarPreview'),
  avatarInput: document.getElementById('avatarInput'),
  clearAvatar: document.getElementById('clearAvatar'),
  name: document.getElementById('fName'),
  creator: document.getElementById('fCreator'),
  tagline: document.getElementById('fTagline'),
  tags: document.getElementById('fTags'),
  description: document.getElementById('fDescription'),
  personality: document.getElementById('fPersonality'),
  scenario: document.getElementById('fScenario'),
  firstMessage: document.getElementById('fFirstMessage'),
  example: document.getElementById('fExample'),
  systemPrompt: document.getElementById('fSystemPrompt'),
  postHistory: document.getElementById('fPostHistory'),
  loreList: document.getElementById('loreList'),
  addLore: document.getElementById('addLoreBtn'),
  toast: document.getElementById('toast'),
  dropHint: document.getElementById('dropHint'),
  sharedGrid: document.getElementById('sharedGrid'),
  sharedNote: document.getElementById('sharedNote'),
  refreshShared: document.getElementById('refreshShared'),
  showNsfw: document.getElementById('showNsfw'),
  shareNsfw: document.getElementById('shareNsfw'),
  fUploadNsfw: document.getElementById('fUploadNsfw'),
  accountBtn: document.getElementById('accountBtn'),
  accountDialog: document.getElementById('accountDialog'),
  accountForm: document.getElementById('accountForm'),
  accountTitle: document.getElementById('accountTitle'),
  accountNote: document.getElementById('accountNote'),
  accountFields: document.getElementById('accountFields'),
  accountEmail: document.getElementById('accountEmail'),
  accountPassword: document.getElementById('accountPassword'),
  accountError: document.getElementById('accountError'),
  accountSignedOut: document.getElementById('accountSignedOut'),
  accountSignedIn: document.getElementById('accountSignedIn'),
  accountOauth: document.getElementById('accountOauth'),
  accountDivider: document.getElementById('accountDivider'),
  accountToggle: document.getElementById('accountToggle'),
  accountSubmit: document.getElementById('accountSubmit'),
  accountSignOut: document.getElementById('accountSignOut'),
  accountDone: document.getElementById('accountDone'),
  accountClose: document.getElementById('accountClose'),
  shareDialog: document.getElementById('shareDialog'),
  shareForm: document.getElementById('shareForm'),
  shareTitle: document.getElementById('shareTitle'),
  shareClose: document.getElementById('shareClose'),
  shareCancel: document.getElementById('shareCancel'),
  shareConfirm: document.getElementById('shareConfirm'),
  uploadDialog: document.getElementById('uploadDialog'),
  uploadForm: document.getElementById('uploadForm'),
  uploadTitle: document.getElementById('uploadTitle'),
  uploadClose: document.getElementById('uploadClose'),
  uploadCancel: document.getElementById('uploadCancel'),
  uploadSave: document.getElementById('uploadSave'),
  uploadDelete: document.getElementById('uploadDelete'),
  uploadError: document.getElementById('uploadError'),
  fUploadName: document.getElementById('fUploadName'),
  fUploadCreator: document.getElementById('fUploadCreator'),
  fUploadTagline: document.getElementById('fUploadTagline'),
  fUploadTags: document.getElementById('fUploadTags'),
  fUploadVisibility: document.getElementById('fUploadVisibility'),
  myCardsSection: document.getElementById('myCardsSection'),
  myCardsNote: document.getElementById('myCardsNote'),
  myGrid: document.getElementById('myGrid'),
  refreshMine: document.getElementById('refreshMine'),
};

function toast(message, tone = 'ok') {
  els.toast.textContent = message;
  els.toast.dataset.tone = tone;
  els.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function setAccent(element, accent) {
  const colors = accent && accent.length === 3 ? accent : ['#6d5dfc', '#10131d', '#3ad6c6'];
  element.style.setProperty('--art-a', colors[0]);
  element.style.setProperty('--art-b', colors[1]);
  element.style.setProperty('--art-c', colors[2]);
}

function formatTokens(count) {
  return new Intl.NumberFormat('en', { notation: 'compact' }).format(count || 0);
}

/* ---------------- rendering ---------------- */

function visibleCharacters() {
  const query = state.query.trim().toLowerCase();
  const filtered = state.characters.filter((character) => {
    if (state.tag !== 'all' && !character.tags.includes(state.tag)) return false;
    if (!query) return true;
    return [character.name, character.creator, character.tagline, character.description, character.tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  const sorted = [...filtered];
  switch (state.sort) {
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'tokens':
      sorted.sort((a, b) => cardTokens(b) - cardTokens(a));
      break;
    case 'favorites':
      sorted.sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.updatedAt || 0) - (a.updatedAt || 0));
      break;
    default:
      sorted.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return sorted;
}

function buildCard(character) {
  const chats = state.chats.filter((chat) => chat.characterId === character.id).length;
  const card = document.createElement('article');
  card.className = 'lib-card';

  const art = document.createElement('div');
  art.className = 'lib-card-art';
  setAccent(art, character.accent);
  if (character.avatar) {
    const image = document.createElement('img');
    image.src = character.avatar;
    image.alt = `${character.name} card art`;
    art.append(image);
  }

  const favorite = document.createElement('button');
  favorite.type = 'button';
  favorite.className = `favorite-toggle${character.favorite ? ' active' : ''}`;
  favorite.dataset.favorite = character.id;
  favorite.title = character.favorite ? 'Remove from favourites' : 'Add to favourites';
  favorite.setAttribute('aria-label', favorite.title);
  favorite.textContent = character.favorite ? '★' : '☆';
  art.append(favorite);

  const body = document.createElement('div');
  body.className = 'lib-card-body';

  const heading = document.createElement('div');
  heading.className = 'lib-card-heading';
  const name = document.createElement('strong');
  name.textContent = character.name;
  const creator = document.createElement('span');
  creator.textContent = `by ${character.creator || 'you'}`;
  heading.append(name, creator);

  const tagline = document.createElement('p');
  tagline.className = 'lib-card-tagline';
  tagline.textContent = character.tagline || character.description.slice(0, 110) || 'No tagline yet.';

  const tags = document.createElement('div');
  tags.className = 'lib-card-tags';
  for (const tag of character.tags.slice(0, 4)) {
    const pill = document.createElement('span');
    pill.textContent = tag;
    tags.append(pill);
  }

  const meta = document.createElement('div');
  meta.className = 'lib-card-meta';
  meta.innerHTML = `<span>${formatTokens(cardTokens(character))} tokens</span><span>${chats} chat${chats === 1 ? '' : 's'}</span>`;

  const actions = document.createElement('div');
  actions.className = 'lib-card-actions';

  const play = document.createElement('a');
  play.className = 'solid-button lib-play';
  play.href = `./chat.html?character=${encodeURIComponent(character.id)}`;
  play.textContent = 'Chat';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'ghost-button';
  edit.dataset.edit = character.id;
  edit.textContent = 'Edit';

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'icon-button';
  more.dataset.menu = character.id;
  more.title = 'More actions';
  more.setAttribute('aria-label', `More actions for ${character.name}`);
  more.textContent = '⋯';

  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'ghost-button';
  share.dataset.share = character.id;
  share.textContent = 'Share';
  share.title = 'Publish this card as a PNG anyone can download';

  actions.append(play, edit, share, more);
  body.append(heading, tagline, tags, meta, actions);
  card.append(art, body);
  return card;
}

function renderGrid() {
  const visible = visibleCharacters();
  els.grid.replaceChildren();

  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state lib-empty';
    const title = document.createElement('p');
    title.textContent = state.characters.length ? 'No characters match those filters.' : 'Your library is empty.';
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = state.characters.length
      ? 'Try a different search or tag.'
      : 'Create a character or import a Tavern card to begin.';
    empty.append(title, hint);
    els.grid.append(empty);
    return;
  }

  els.grid.append(...visible.map(buildCard));
}

function renderTagFilter() {
  const tags = [...new Set(state.characters.flatMap((character) => character.tags))].sort();
  const buttons = [
    (() => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `segment${state.tag === 'all' ? ' active' : ''}`;
      button.dataset.tag = 'all';
      button.textContent = `All (${state.characters.length})`;
      return button;
    })(),
    ...tags.map((tag) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `segment${state.tag === tag ? ' active' : ''}`;
      button.dataset.tag = tag;
      button.textContent = tag;
      return button;
    }),
  ];
  els.tagFilter.replaceChildren(...buttons);
}

function renderStats() {
  els.statCharacters.textContent = String(state.characters.length);
  els.statTokens.textContent = formatTokens(state.characters.reduce((total, character) => total + cardTokens(character), 0));
  els.statChats.textContent = String(state.chats.length);
}

async function refresh() {
  state.characters = await listCharacters();
  state.chats = await listChats();
  if (state.tag !== 'all' && !state.characters.some((character) => character.tags.includes(state.tag))) {
    state.tag = 'all';
  }
  renderTagFilter();
  renderGrid();
  renderStats();
}

/* ---------------- editor ---------------- */

function renderAvatarPreview() {
  els.avatarPreview.replaceChildren();
  if (state.avatar) {
    const image = document.createElement('img');
    image.src = state.avatar;
    image.alt = 'Card art preview';
    els.avatarPreview.append(image);
    els.avatarPreview.classList.add('has-image');
  } else {
    setAccent(els.avatarPreview, accentForName(els.name.value));
    els.avatarPreview.classList.remove('has-image');
  }
}

function accentForName(name) {
  const palettes = [
    ['#6d5dfc', '#10131d', '#3ad6c6'],
    ['#f3b35a', '#151923', '#f27b9b'],
    ['#8bd672', '#101818', '#6d5dfc'],
    ['#3ad6c6', '#121721', '#f3b35a'],
    ['#f27b9b', '#14131f', '#6d5dfc'],
  ];
  const key = String(name || 'a').toLowerCase();
  const index = [...key].reduce((total, character) => total + character.charCodeAt(0), 0) % palettes.length;
  return palettes[index];
}

function loreRow(entry = {}) {
  const row = document.createElement('div');
  row.className = 'lore-row';
  row.dataset.loreId = entry.id || uid();

  const keys = document.createElement('input');
  keys.className = 'lore-keys';
  keys.placeholder = 'keywords, comma separated';
  keys.value = (entry.keys || []).join(', ');

  const content = document.createElement('textarea');
  content.className = 'lore-content';
  content.rows = 2;
  content.placeholder = 'What the model should know when those words appear.';
  content.value = entry.content || '';

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'conversation-delete';
  removeButton.dataset.removeLore = row.dataset.loreId;
  removeButton.title = 'Remove entry';
  removeButton.setAttribute('aria-label', 'Remove world info entry');
  removeButton.textContent = '×';

  row.append(keys, content, removeButton);
  return row;
}

function renderLore() {
  els.loreList.replaceChildren(...state.lore.map((entry) => loreRow(entry)));
}

function readLoreRows() {
  return [...els.loreList.querySelectorAll('.lore-row')]
    .map((row) => ({
      id: row.dataset.loreId,
      keys: row.querySelector('.lore-keys').value.split(',').map((key) => key.trim()).filter(Boolean),
      content: row.querySelector('.lore-content').value.trim(),
      enabled: true,
    }))
    .filter((entry) => entry.content || entry.keys.length);
}

function openEditor(character) {
  state.editingId = character?.id || null;
  state.avatar = character?.avatar || null;
  state.lore = character?.lorebook?.length ? character.lorebook : [];

  els.editorEyebrow.textContent = character ? 'Edit character' : 'New character';
  els.editorTitle.textContent = character ? `Editing ${character.name}` : 'Create a character card';
  els.avatarInput.value = '';

  els.name.value = character?.name || '';
  els.creator.value = character?.creator || '';
  els.tagline.value = character?.tagline || '';
  els.tags.value = (character?.tags || []).join(', ');
  els.description.value = character?.description || '';
  els.personality.value = character?.personality || '';
  els.scenario.value = character?.scenario || '';
  els.firstMessage.value = character?.firstMessage || '';
  els.example.value = character?.exampleDialogue || '';
  els.systemPrompt.value = character?.systemPrompt || '';
  els.postHistory.value = character?.postHistoryInstructions || '';

  renderLore();
  renderAvatarPreview();
  els.dialog.showModal();
  els.name.focus();
}

async function saveEditor() {
  const name = els.name.value.trim();
  if (!name) {
    els.name.focus();
    toast('Give the character a name first.', 'bad');
    return;
  }
  const existing = state.editingId ? await getCharacter(state.editingId) : null;
  const lore = readLoreRows();
  const character = normalizeCharacter({
    ...(existing || {}),
    id: state.editingId || uid(),
    name,
    creator: els.creator.value.trim() || 'You',
    tagline: els.tagline.value.trim(),
    tags: els.tags.value.split(',').map((tag) => tag.trim()).filter(Boolean),
    description: els.description.value.trim(),
    personality: els.personality.value.trim(),
    scenario: els.scenario.value.trim(),
    firstMessage: els.firstMessage.value.trim(),
    exampleDialogue: els.example.value.trim(),
    systemPrompt: els.systemPrompt.value.trim(),
    postHistoryInstructions: els.postHistory.value.trim(),
    avatar: state.avatar,
    accent: existing?.accent || accentForName(name),
    lorebook: lore,
  });
  await saveCharacter(character);
  els.dialog.close();
  await refresh();
  toast(`${character.name} saved.`);
}

/* ---------------- import / export ---------------- */

// Same name from the same creator means the same card; a re-import should not
// leave two identical entries in the library.
function cardKey(character) {
  const name = String(character?.name || '').trim().toLowerCase();
  const creator = String(character?.creator || '').trim().toLowerCase();
  return `${name}|${creator}`;
}

async function importFiles(files) {
  const list = [...files].filter(Boolean);
  if (!list.length) return;

  const existing = new Map((await listCharacters()).map((card) => [cardKey(card), card.name]));
  let imported = 0;
  const duplicates = [];
  const failures = [];

  for (const file of list) {
    try {
      const { character } = await parseCardFile(file);
      const key = cardKey(character);
      if (existing.has(key)) {
        duplicates.push(existing.get(key));
        continue;
      }
      const saved = await saveCharacter({ ...character, id: uid(), createdAt: Date.now() });
      existing.set(key, saved.name);
      imported += 1;
      toast(`${saved.name} imported.`);
    } catch (error) {
      failures.push(error?.message || String(error));
    }
  }

  await refresh();

  const parts = [];
  if (imported) parts.push(`${imported} imported`);
  if (duplicates.length) parts.push(`${duplicates.length} already in your library`);
  if (failures.length) parts.push(`${failures.length} failed`);

  if (failures.length) {
    toast(imported || duplicates.length ? `${failures[0]} (${parts.join(', ')})` : failures[0], 'bad');
  } else if (duplicates.length) {
    toast(`${duplicates[0]} is already in your library.`, 'bad');
  } else if (imported > 1) {
    toast(parts.join(', '));
  }
}

async function exportAs(character, format) {
  const slug = character.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
  try {
    if (format === 'png') {
      downloadBlob(await buildCardPng(character), `${slug}.png`);
      toast('PNG card exported with embedded data.');
    } else {
      downloadBlob(buildCardJson(character), `${slug}.json`);
      toast('JSON card exported.');
    }
  } catch (error) {
    toast(`Export failed: ${error?.message || error}`, 'bad');
  }
}

async function duplicate(character) {
  const copy = normalizeCharacter({
    ...character,
    id: uid(),
    name: `${character.name} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  delete copy.favorite;
  await saveCharacter(copy);
  await refresh();
  toast('Character duplicated.');
}

function showMenu(character, anchor) {
  const existing = document.querySelector('.lib-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'lib-menu';
  const options = [
    ['Edit card', () => openEditor(character)],
    ['Export PNG card', () => exportAs(character, 'png')],
    ['Export JSON card', () => exportAs(character, 'json')],
    ['Duplicate', () => duplicate(character)],
    ['Delete', () => removeCharacter(character)],
  ];
  for (const [label, action] of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (label === 'Delete') button.classList.add('danger');
    button.addEventListener('click', () => {
      menu.remove();
      action();
    });
    menu.append(button);
  }
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${Math.max(12, rect.right + window.scrollX - 190)}px`;
  document.body.append(menu);
  setTimeout(() => {
    document.addEventListener(
      'click',
      (event) => {
        if (!menu.contains(event.target)) menu.remove();
      },
      { once: true }
    );
  }, 0);
}

async function removeCharacter(character) {
  const chats = await listChats(character.id);
  const warning = chats.length
    ? `Delete ${character.name} and ${chats.length} saved chat${chats.length === 1 ? '' : 's'}? This cannot be undone.`
    : `Delete ${character.name}? This cannot be undone.`;
  if (!window.confirm(warning)) return;
  await deleteCharacter(character.id);
  await refresh();
  toast(`${character.name} deleted.`);
}

/* ---------------- events ---------------- */

function bindEvents() {
  els.newButton.addEventListener('click', () => openEditor(null));
  els.importButton.addEventListener('click', () => els.importInput.click());
  els.importInput.addEventListener('change', async () => {
    await importFiles(els.importInput.files);
    els.importInput.value = '';
  });

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    renderGrid();
  });

  els.sort.addEventListener('change', () => {
    state.sort = els.sort.value;
    renderGrid();
  });

  els.tagFilter.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tag]');
    if (!button) return;
    state.tag = button.dataset.tag;
    renderTagFilter();
    renderGrid();
  });

  els.grid.addEventListener('click', (event) => {
    const favorite = event.target.closest('[data-favorite]');
    if (favorite) {
      const character = state.characters.find((item) => item.id === favorite.dataset.favorite);
      if (!character) return;
      character.favorite = !character.favorite;
      saveCharacter(character).then(refresh);
      return;
    }
    const edit = event.target.closest('[data-edit]');
    if (edit) {
      const character = state.characters.find((item) => item.id === edit.dataset.edit);
      if (character) openEditor(character);
      return;
    }
    const menu = event.target.closest('[data-menu]');
    if (menu) {
      const character = state.characters.find((item) => item.id === menu.dataset.menu);
      if (character) showMenu(character, menu);
    }
  });

  els.addLore.addEventListener('click', () => {
    state.lore = readLoreRows();
    state.lore.push({ id: uid(), keys: [], content: '' });
    renderLore();
    els.loreList.querySelector('.lore-row:last-child .lore-keys')?.focus();
  });

  els.loreList.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-lore]');
    if (!removeButton) return;
    const row = removeButton.closest('.lore-row');
    state.lore = readLoreRows().filter((entry) => entry.id !== row.dataset.loreId);
    renderLore();
  });

  els.avatarInput.addEventListener('change', () => {
    const file = els.avatarInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.avatar = String(reader.result);
      renderAvatarPreview();
    };
    reader.readAsDataURL(file);
  });

  els.clearAvatar.addEventListener('click', () => {
    state.avatar = null;
    els.avatarInput.value = '';
    renderAvatarPreview();
  });

  els.name.addEventListener('input', () => {
    if (!state.avatar) renderAvatarPreview();
  });

  els.form.addEventListener('submit', async (event) => {
    if (event.submitter && event.submitter.value === 'cancel') return;
    event.preventDefault();
    await saveEditor();
  });

  els.editorClose.addEventListener('click', () => els.dialog.close());
  els.editorCancel.addEventListener('click', () => els.dialog.close());
  els.dialog.addEventListener('close', () => {
    els.avatarInput.value = '';
  });

  for (const type of ['dragenter', 'dragover']) {
    window.addEventListener(type, (event) => {
      event.preventDefault();
      document.body.classList.add('dragging');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    window.addEventListener(type, (event) => {
      if (type === 'dragleave' && event.relatedTarget) return;
      event.preventDefault();
      if (type === 'dragleave') document.body.classList.remove('dragging');
    });
  }
  window.addEventListener('drop', async (event) => {
    document.body.classList.remove('dragging');
    if (event.dataTransfer?.files?.length) await importFiles(event.dataTransfer.files);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') document.querySelector('.lib-menu')?.remove();
    if (event.key === '/' && document.activeElement !== els.search && !els.dialog.open) {
      event.preventDefault();
      els.search.focus();
    }
  });
}

/* ---------------- shared cards ---------------- */

function sharedCardRow(card) {
  const article = document.createElement('article');
  article.className = 'shared-card';
  if (card.nsfw) article.classList.add('is-nsfw');

  const art = document.createElement('div');
  art.className = 'shared-card-art';
  setAccent(art, ['#6d5dfc', '#10131d', '#3ad6c6']);
  if (card.card_url) {
    const image = document.createElement('img');
    image.src = card.card_url;
    image.alt = `${card.name} card art`;
    image.loading = 'lazy';
    art.append(image);
  }

  if (card.nsfw) {
    const badge = document.createElement('span');
    badge.className = 'nsfw-badge';
    badge.textContent = 'NSFW';
    art.append(badge);
  }

  const body = document.createElement('div');
  body.className = 'shared-card-body';

  const title = document.createElement('strong');
  title.textContent = card.name || 'Untitled card';
  const by = document.createElement('span');
  by.className = 'shared-card-by';
  by.textContent = `by ${card.creator || 'unknown'}`;
  const tagline = document.createElement('p');
  tagline.textContent = card.tagline || '';

  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'solid-button';
  download.dataset.pull = card.id;
  download.textContent = 'Download';
  download.title = 'Save the PNG card and add this character to your library';

  body.append(title, by, tagline, download);

  // Admins may remove cards they did not publish. Their own cards are managed
  // through My cards, so this button never duplicates that.
  if (state.shared.isAdmin && card.user_id && card.user_id !== state.shared.user?.id) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost-button danger admin-action';
    remove.dataset.adminDelete = card.id;
    remove.textContent = 'Remove (admin)';
    remove.title = 'Delete this card for everyone';
    body.append(remove);
  }

  article.append(art, body);
  return article;
}

function renderShared() {
  if (!els.sharedGrid) return;
  els.sharedGrid.replaceChildren();
  const { cards, error, loading } = state.shared;

  if (loading) {
    els.sharedNote.textContent = 'Loading shared cards…';
    return;
  }
  if (error) {
    els.sharedNote.textContent = error;
    return;
  }
  if (!cards.length) {
    els.sharedNote.textContent =
      'No shared cards yet. Publishing one of yours puts a PNG here that anyone can download.';
    return;
  }

  const hiddenNote = state.shared.showNsfw ? '' : ' NSFW cards are hidden — use the filter to show them.';
  els.sharedNote.textContent = `${cards.length} card${cards.length === 1 ? '' : 's'} published. Download saves the PNG card and adds it to your library. Drafts marked private are not listed here.${hiddenNote}`;
  els.sharedGrid.append(...cards.map(sharedCardRow));
}

async function loadShared() {
  state.shared = { ...state.shared, loading: true };
  renderShared();
  const [listing, user] = await Promise.all([
    listSharedCards(60, { includeNsfw: state.shared.showNsfw }),
    getSharedUser(),
  ]);
  // Spread rather than replace: mine/returning/showNsfw live on this object too, and
  // replacing it wiped them whenever the feed refreshed.
  state.shared = {
    ...state.shared,
    cards: listing.cards,
    error: listing.error,
    user,
    isAdmin: user ? await viewerIsAdmin() : false,
    loading: false,
  };
  renderShared();
  return state.shared;
}

function shareToLibrary(character) {
  openShareDialog(character);
}

async function pullSharedCard(id) {
  const card = state.shared.cards.find((item) => item.id === id);
  if (!card) return;
  try {
    const { character, blob, filename } = await fetchSharedCard(card);
    const existing = (await listCharacters()).find((entry) => cardKey(entry) === cardKey(character));
    if (existing) {
      toast(`${existing.name} is already in your library; saved the PNG anyway.`, 'bad');
    } else {
      await saveCharacter({ ...character, id: uid(), createdAt: Date.now() });
      await refresh();
      toast(`${character.name} added to your library.`);
    }
    downloadBlob(blob, filename);
  } catch (error) {
    toast(error?.message || String(error), 'bad');
  }
}

// Captured at load: the Supabase client rewrites the URL while it looks for a
// session, so a provider's refusal would vanish before the dialog could show it.
const initialSearch = window.location.search;
const initialHash = window.location.hash;

/* ---------------- accounts ---------------- */

const ACCOUNT_NOTE =
  'An account exists only so you can edit or delete the cards you publish and keep drafts private. Characters and chats stay in this browser.';

function authUser() {
  return state.shared.user;
}

function renderAccount() {
  const user = authUser();
  if (els.accountBtn) {
    els.accountBtn.textContent = user ? 'Account' : 'Sign in';
    els.accountBtn.title = user ? `Signed in as ${user.email}` : 'Sign in to publish, edit or delete cards';
  }
  if (els.accountSignedIn) els.accountSignedIn.hidden = !user;
  if (els.accountSignedOut) els.accountSignedOut.hidden = Boolean(user);
  if (els.accountFields) els.accountFields.hidden = Boolean(user);
  if (els.accountOauth) els.accountOauth.hidden = Boolean(user);
  if (els.accountDivider) els.accountDivider.hidden = Boolean(user);
  if (els.accountTitle) {
    els.accountTitle.textContent = user
      ? 'Signed in'
      : state.account.mode === 'signup'
        ? 'Create an account'
        : 'Sign in';
  }
  if (els.accountSubmit) els.accountSubmit.textContent = state.account.mode === 'signup' ? 'Create account' : 'Sign in';
  if (els.accountToggle) {
    els.accountToggle.textContent = state.account.mode === 'signup' ? 'I already have an account' : 'Create an account';
  }
  if (els.accountNote && !authUser()) els.accountNote.textContent = ACCOUNT_NOTE;
}

function showAccountError(message) {
  if (!els.accountError) return;
  els.accountError.textContent = message || '';
  els.accountError.hidden = !message;
}

function openAccountDialog(note) {
  showAccountError('');
  // renderAccount() rewrites the note for signed-out visitors, so the reason the dialog
  // was opened has to be written after it. Setting it first silently gave way to the
  // generic line, which left "Share" opening a sign-in dialog with no explanation.
  renderAccount();
  if (els.accountNote) {
    els.accountNote.textContent = authUser()
      ? `Signed in as ${authUser().email}. You can edit or delete anything you publish.`
      : note || ACCOUNT_NOTE;
  }
  els.accountDialog?.showModal();
}

async function submitAccount() {
  if (state.account.busy) return;
  const email = els.accountEmail.value.trim();
  const password = els.accountPassword.value;
  if (!email || password.length < 6) {
    showAccountError('Enter an email address and a password of at least 6 characters.');
    return;
  }
  state.account.busy = true;
  if (els.accountSubmit) els.accountSubmit.disabled = true;
  showAccountError('');
  try {
    if (state.account.mode === 'signup') {
      const result = await signUp(email, password);
      if (result.needsConfirmation) {
        state.account.mode = 'signin';
        renderAccount();
        showAccountError('Account created. Open the confirmation email, then sign in here.');
        return;
      }
      toast('Account created. You can publish cards now.');
    } else {
      await signIn(email, password);
      toast('Signed in.');
    }
    els.accountPassword.value = '';
    els.accountDialog?.close();
  } catch (error) {
    showAccountError(error?.message || String(error));
  } finally {
    state.account.busy = false;
    if (els.accountSubmit) els.accountSubmit.disabled = false;
  }
}

async function handleSignOut() {
  try {
    await signOut();
    toast('Signed out.');
    els.accountDialog?.close();
  } catch (error) {
    showAccountError(error?.message || String(error));
  }
}

/* ---------------- my uploads ---------------- */

function visibilityBadge(card) {
  const badge = document.createElement('span');
  badge.className = `vis-badge ${card.visibility === 'private' ? 'is-private' : 'is-public'}`;
  badge.textContent = card.visibility === 'private' ? 'Private' : 'Public';
  return badge;
}

function myCardRow(card) {
  const article = document.createElement('article');
  article.className = 'shared-card my-card';

  const art = document.createElement('div');
  art.className = 'shared-card-art';
  setAccent(art, ['#6d5dfc', '#10131d', '#3ad6c6']);
  if (card.card_url) {
    const image = document.createElement('img');
    image.src = card.card_url;
    image.alt = `${card.name} card art`;
    image.loading = 'lazy';
    art.append(image);
  } else {
    cardArtUrl(card).then((url) => {
      if (!url) return;
      const image = document.createElement('img');
      image.src = url;
      image.alt = `${card.name} card art`;
      image.loading = 'lazy';
      art.append(image);
    });
  }
  art.append(visibilityBadge(card));

  const body = document.createElement('div');
  body.className = 'shared-card-body';

  const title = document.createElement('strong');
  title.textContent = card.name || 'Untitled card';
  const meta = document.createElement('span');
  meta.className = 'shared-card-by';
  const stamp = card.updated_at || card.created_at;
  const size = card.size ? `${Math.round(card.size / 1024)} KB · ` : '';
  meta.textContent = `${size}updated ${stamp ? new Date(stamp).toLocaleDateString() : 'just now'}`;
  const tagline = document.createElement('p');
  tagline.textContent = card.tagline || '';

  const actions = document.createElement('div');
  actions.className = 'my-card-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'solid-button';
  edit.dataset.editUpload = card.id;
  edit.textContent = 'Edit';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'ghost-button danger';
  remove.dataset.deleteUpload = card.id;
  remove.textContent = 'Delete';
  actions.append(edit, remove);

  body.append(title, meta, tagline, actions);
  article.append(art, body);
  return article;
}

function renderMine() {
  if (!els.myCardsSection) return;
  const user = authUser();
  els.myCardsSection.hidden = !user;
  if (!user) return;

  els.myGrid.replaceChildren();
  if (state.shared.mineLoading) {
    els.myCardsNote.textContent = 'Loading your uploads…';
    return;
  }
  if (state.shared.mineError) {
    els.myCardsNote.textContent = state.shared.mineError;
    return;
  }
  if (!state.shared.mine.length) {
    els.myCardsNote.textContent = 'Nothing published yet. Use Share on any card to upload it as public or private.';
    return;
  }
  const published = state.shared.mine.filter((card) => card.visibility !== 'private').length;
  const drafts = state.shared.mine.length - published;
  els.myCardsNote.textContent = `${state.shared.mine.length} upload${
    state.shared.mine.length === 1 ? '' : 's'
  } · ${published} public · ${drafts} private. Editing rebuilds the PNG so the download matches.`;
  els.myGrid.append(...state.shared.mine.map(myCardRow));
}

async function loadMine() {
  if (!authUser()) {
    state.shared.mine = [];
    state.shared.mineError = null;
    renderMine();
    return;
  }
  state.shared.mineLoading = true;
  renderMine();
  const { cards, error } = await listMyCards();
  state.shared.mine = cards;
  state.shared.mineError = error;
  state.shared.mineLoading = false;
  renderMine();
}

/* ---------------- publishing + editing ---------------- */

function openShareDialog(character) {
  state.share.character = character;
  if (!authUser()) {
    openAccountDialog('Sign in first — a published card needs an owner so it can be edited or deleted later.');
    return;
  }
  if (els.shareTitle) els.shareTitle.textContent = `Share ${character.name}`;
  const publicChoice = els.shareForm?.querySelector('input[name="shareVisibility"][value="public"]');
  if (publicChoice) publicChoice.checked = true;
  if (els.shareNsfw) els.shareNsfw.checked = false;
  els.shareDialog?.showModal();
}

async function confirmShare() {
  const character = state.share.character;
  if (!character || state.share.busy) return;
  const picked = els.shareForm?.querySelector('input[name="shareVisibility"]:checked');
  const visibility = picked?.value === 'private' ? 'private' : 'public';
  const nsfw = Boolean(els.shareNsfw?.checked);
  state.share.busy = true;
  if (els.shareConfirm) els.shareConfirm.disabled = true;
  try {
    await shareCard(character, { visibility, nsfw });
    toast(
      visibility === 'private'
        ? `${character.name} saved as a private draft. Only you can open it.`
        : nsfw
          ? `${character.name} published and tagged NSFW, so it stays behind the filter.`
          : `${character.name} published. Anyone can download it now.`
    );
    els.shareDialog?.close();
    await Promise.all([loadShared(), loadMine()]);
  } catch (error) {
    toast(error?.message || String(error), 'bad');
  } finally {
    state.share.busy = false;
    if (els.shareConfirm) els.shareConfirm.disabled = false;
  }
}

function showUploadError(message) {
  if (!els.uploadError) return;
  els.uploadError.textContent = message || '';
  els.uploadError.hidden = !message;
}

async function editUpload(id) {
  const row = state.shared.mine.find((card) => card.id === id);
  if (!row) return;
  showUploadError('');
  if (els.uploadTitle) els.uploadTitle.textContent = `Edit ${row.name}`;
  els.fUploadName.value = row.name || '';
  els.fUploadCreator.value = row.creator || '';
  els.fUploadTagline.value = row.tagline || '';
  els.fUploadTags.value = (row.tags || []).join(', ');
  els.fUploadVisibility.value = row.visibility === 'private' ? 'private' : 'public';
  if (els.fUploadNsfw) els.fUploadNsfw.checked = Boolean(row.nsfw);
  state.upload = { row, character: null, busy: false };
  els.uploadDialog?.showModal();
  try {
    const { character } = await fetchSharedCard(row);
    state.upload.character = character;
  } catch (error) {
    showUploadError(`Could not read the published card, so saving is disabled: ${error?.message || error}`);
  }
}

async function saveUpload(event) {
  event?.preventDefault?.();
  const { row, character } = state.upload;
  if (!row || !character || state.upload.busy) return;
  const visibility = els.fUploadVisibility.value === 'private' ? 'private' : 'public';
  const nsfw = Boolean(els.fUploadNsfw?.checked);
  const updated = normalizeCharacter({
    ...character,
    name: els.fUploadName.value.trim() || character.name,
    creator: els.fUploadCreator.value.trim() || 'Anonymous',
    tagline: els.fUploadTagline.value.trim(),
    tags: els.fUploadTags.value.split(',').map((tag) => tag.trim()).filter(Boolean),
  });
  state.upload.busy = true;
  if (els.uploadSave) els.uploadSave.disabled = true;
  showUploadError('');
  try {
    await updateSharedCard(row, updated, { visibility, nsfw });
    toast(`${updated.name} updated.`);
    els.uploadDialog?.close();
    await Promise.all([loadShared(), loadMine()]);
  } catch (error) {
    showUploadError(error?.message || String(error));
  } finally {
    state.upload.busy = false;
    if (els.uploadSave) els.uploadSave.disabled = false;
  }
}

async function removeUpload(id) {
  const row = state.shared.mine.find((card) => card.id === id);
  if (!row) return;
  const question = `Delete the published card "${row.name}"? The PNG and its listing are removed. This cannot be undone.`;
  if (!window.confirm(question)) return;
  try {
    await deleteSharedCard(row);
    toast(`${row.name} deleted.`);
    els.uploadDialog?.close();
    await Promise.all([loadShared(), loadMine()]);
  } catch (error) {
    toast(error?.message || String(error), 'bad');
  }
}

// One button per provider, built once. The list lives in shared.js so trimming a
// provider is a one-line change rather than markup plus wiring.
function renderProviders() {
  if (!els.accountOauth || els.accountOauth.childElementCount) return;
  els.accountOauth.append(
    ...OAUTH_PROVIDERS.map((provider) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'oauth-button';
      button.dataset.provider = provider.id;
      button.title = `Sign in with ${provider.label}`;

      const badge = document.createElement('span');
      badge.className = 'oauth-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = provider.label.slice(0, 1);

      const label = document.createElement('span');
      label.textContent = `Continue with ${provider.label}`;

      button.append(badge, label);
      return button;
    })
  );
}

async function startProviderSignIn(button) {
  const provider = button?.dataset.provider;
  if (!provider || state.account.busy) return;
  state.account.busy = true;
  button.disabled = true;
  showAccountError('');
  try {
    await signInWithProvider(provider);
    // Success navigates to the provider; the promise resolves just before the
    // page leaves, so nothing is re-enabled here.
  } catch (error) {
    showAccountError(error?.message || String(error));
    state.account.busy = false;
    button.disabled = false;
  }
}

// Admin removal of a card someone else published. Ownership is enforced by row
// policy on the server; this only decides whether to offer the button.
async function adminRemoveCard(id) {
  const card = state.shared.cards.find((item) => item.id === id);
  if (!card || !state.shared.isAdmin) return;
  const question = `Remove "${card.name}" by ${card.creator || 'another creator'}? This deletes the card and its file for everyone and cannot be undone.`;
  if (!window.confirm(question)) return;
  try {
    await deleteSharedCard(card);
    toast(`${card.name} removed.`);
    await loadShared();
  } catch (error) {
    toast(error?.message || String(error), 'bad');
  }
}

function initShared() {
  els.refreshShared?.addEventListener('click', () => loadShared());
  els.refreshMine?.addEventListener('click', () => loadMine());

  try {
    state.shared.showNsfw = localStorage.getItem('varden.showNsfw') === '1';
  } catch {
    state.shared.showNsfw = false;
  }
  if (els.showNsfw) els.showNsfw.checked = state.shared.showNsfw;
  els.showNsfw?.addEventListener('change', () => {
    state.shared.showNsfw = Boolean(els.showNsfw.checked);
    try {
      localStorage.setItem('varden.showNsfw', state.shared.showNsfw ? '1' : '0');
    } catch {
      // A browser with storage blocked still filters for this visit.
    }
    loadShared();
  });

  // Coming back from a provider: either tokens to consume or a refusal to report.
  const oauthError = oauthErrorFromUrl(initialSearch, initialHash);
  const hasTokens = /access_token=/.test(initialHash) || /[?&]code=/.test(initialSearch);
  if (oauthError) {
    showAccountError(oauthError);
    els.accountDialog?.showModal();
    history.replaceState(null, '', window.location.pathname);
  } else if (hasTokens) {
    state.shared.returning = true;
    toast('Finishing sign-in…');
  }

  renderProviders();
  els.accountOauth?.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-provider]');
    if (button) startProviderSignIn(button);
  });

  els.accountBtn?.addEventListener('click', () => openAccountDialog());
  els.accountClose?.addEventListener('click', () => els.accountDialog.close());
  els.accountDone?.addEventListener('click', () => els.accountDialog.close());
  els.accountSignOut?.addEventListener('click', handleSignOut);
  els.accountToggle?.addEventListener('click', () => {
    state.account.mode = state.account.mode === 'signup' ? 'signin' : 'signup';
    showAccountError('');
    renderAccount();
  });
  els.accountForm?.addEventListener('submit', (event) => {
    if (event.submitter && event.submitter.value === 'cancel') return;
    event.preventDefault();
    submitAccount();
  });

  els.shareClose?.addEventListener('click', () => els.shareDialog.close());
  els.shareCancel?.addEventListener('click', () => els.shareDialog.close());
  els.shareConfirm?.addEventListener('click', confirmShare);

  els.uploadClose?.addEventListener('click', () => els.uploadDialog.close());
  els.uploadCancel?.addEventListener('click', () => els.uploadDialog.close());
  els.uploadForm?.addEventListener('submit', (event) => {
    if (event.submitter && event.submitter.value === 'cancel') return;
    saveUpload(event);
  });
  els.uploadDelete?.addEventListener('click', () => {
    if (state.upload.row) removeUpload(state.upload.row.id);
  });

  document.addEventListener('click', (event) => {
    const target = event.target.closest?.(
      '[data-share], [data-pull], [data-edit-upload], [data-delete-upload], [data-admin-delete]'
    );
    if (!target) return;
    if (target.dataset.share) {
      const character = state.characters.find((item) => item.id === target.dataset.share);
      if (character) openShareDialog(character);
      return;
    }
    if (target.dataset.pull) {
      pullSharedCard(target.dataset.pull);
      return;
    }
    if (target.dataset.editUpload) {
      editUpload(target.dataset.editUpload);
      return;
    }
    if (target.dataset.deleteUpload) removeUpload(target.dataset.deleteUpload);
    if (target.dataset.adminDelete) adminRemoveCard(target.dataset.adminDelete);
  });

  onAuthChange((user) => {
    const changed = (state.shared.user?.id || null) !== (user?.id || null);
    state.shared.user = user;
    renderAccount();
    if (changed && user && state.shared.returning) {
      state.shared.returning = false;
      toast(`Signed in as ${user.email}.`);
    }
    if (changed) loadMine();
  });

  renderAccount();
  loadShared();
  getSharedUser().then((user) => {
    if (!state.shared.user && user) {
      state.shared.user = user;
      renderAccount();
      loadMine();
    }
  });
}

async function init() {
  bindEvents();
  await ensureSeeded();
  await migrateLegacyChats();
  await refresh();
  initShared();
}

init().catch((error) => {
  console.error('Varden library: failed to start', error);
  toast(`Library failed to load: ${error?.message || error}`, 'bad');
});
