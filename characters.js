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
import { fetchSharedCard, getSharedUser, listSharedCards, shareCard } from './shared.js';

const state = {
  characters: [],
  chats: [],
  query: '',
  tag: 'all',
  sort: 'recent',
  editingId: null,
  avatar: null,
  lore: [],
  shared: { cards: [], error: null, user: null, loading: false },
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

  els.sharedNote.textContent = `${cards.length} card${cards.length === 1 ? '' : 's'} published. Download saves the PNG card and adds it to your library.`;
  els.sharedGrid.append(...cards.map(sharedCardRow));
}

async function loadShared() {
  state.shared = { ...state.shared, loading: true };
  renderShared();
  const [listing, user] = await Promise.all([listSharedCards(), getSharedUser()]);
  state.shared = { cards: listing.cards, error: listing.error, user, loading: false };
  renderShared();
  return state.shared;
}

async function shareToLibrary(character) {
  toast(`Publishing ${character.name}…`);
  try {
    await shareCard(character);
    toast(`${character.name} published. Anyone can download it now.`);
    await loadShared();
  } catch (error) {
    toast(error?.message || String(error), 'bad');
  }
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

function initShared() {
  els.refreshShared?.addEventListener('click', () => loadShared());
  document.addEventListener('click', (event) => {
    const shareButton = event.target.closest?.('[data-share]');
    if (shareButton) {
      const character = state.characters.find((item) => item.id === shareButton.dataset.share);
      if (character) shareToLibrary(character);
      return;
    }
    const pullButton = event.target.closest?.('[data-pull]');
    if (pullButton) pullSharedCard(pullButton.dataset.pull);
  });
  loadShared();
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
