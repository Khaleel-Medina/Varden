// Varden — character card model, local storage, card import/export and prompt assembly.
//
// Cards follow the SillyTavern "chara_card_v2" shape, so cards exported from other
// tavern-style apps import cleanly and ours export back out the same way.
// Everything is stored locally in IndexedDB; there is no server involved.

export const DB_NAME = 'varden-tavern';
export const DB_VERSION = 2;
export const STORES = ['characters', 'personas', 'chats', 'meta', 'memories'];
// Bump when new seed cards are added so existing libraries pick them up.
export const SEED_VERSION = 2;

export const DEFAULT_SYSTEM_PROMPT = [
  'You are the character described below in an ongoing roleplay with the user.',
  'Write in third person narration and first person dialogue, keep replies vivid but under 200 words,',
  'and never speak, act, or decide for the user. Stay in character at all times.',
].join(' ');

export const LORE_RECENT_MESSAGES = 6;
export const DEFAULT_BUDGET_CHARS = 12000;

/* ---------------- small helpers ---------------- */

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.round(String(text).length / 4));
}

export function cardTokens(character) {
  if (!character) return 0;
  const blob = [
    character.description,
    character.personality,
    character.scenario,
    character.firstMessage,
    character.exampleDialogue,
    character.systemPrompt,
    character.postHistoryInstructions,
    (character.lorebook || []).map((entry) => entry.content).join(' '),
  ]
    .filter(Boolean)
    .join(' ');
  return estimateTokens(blob);
}

/* ---------------- storage ---------------- */

let dbPromise = null;

export function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('characters')) {
        database.createObjectStore('characters', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('personas')) {
        database.createObjectStore('personas', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('chats')) {
        database.createObjectStore('chats', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('memories')) {
        database.createObjectStore('memories', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(store, mode, action) {
  const database = await db();
  const tx = database.transaction(store, mode);
  const result = await action(tx.objectStore(store));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return result;
}

export async function listAll(store) {
  return (await withStore(store, 'readonly', (objectStore) => wrap(objectStore.getAll()))) || [];
}

export async function read(store, id) {
  return withStore(store, 'readonly', (objectStore) => wrap(objectStore.get(id)));
}

export async function write(store, value) {
  await withStore(store, 'readwrite', (objectStore) => wrap(objectStore.put(value)));
  return value;
}

export async function remove(store, id) {
  return withStore(store, 'readwrite', (objectStore) => wrap(objectStore.delete(id)));
}

export async function readMeta(id = 'app') {
  return read('meta', id);
}

export async function writeMeta(meta) {
  return write('meta', { id: 'app', ...meta });
}

/* ---------------- characters ---------------- */

export function normalizeCharacter(raw = {}) {
  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : String(raw.tags || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

  return {
    id: raw.id || uid(),
    name: String(raw.name || 'Untitled character').trim(),
    tagline: String(raw.tagline || '').trim(),
    creator: String(raw.creator || 'You').trim(),
    description: String(raw.description || '').trim(),
    personality: String(raw.personality || '').trim(),
    scenario: String(raw.scenario || '').trim(),
    firstMessage: String(raw.firstMessage ?? raw.first_mes ?? '').trim(),
    exampleDialogue: String(raw.exampleDialogue ?? raw.mes_example ?? '').trim(),
    systemPrompt: String(raw.systemPrompt ?? raw.system_prompt ?? '').trim(),
    postHistoryInstructions: String(raw.postHistoryInstructions ?? raw.post_history_instructions ?? '').trim(),
    tags: tags.slice(0, 12),
    avatar: raw.avatar || null,
    accent: Array.isArray(raw.accent) && raw.accent.length === 3 ? raw.accent : ['#6d5dfc', '#10131d', '#3ad6c6'],
    lorebook: Array.isArray(raw.lorebook)
      ? raw.lorebook
          .filter((entry) => entry && (entry.content || '').trim())
          .map((entry) => ({
            id: entry.id || uid(),
            keys: Array.isArray(entry.keys) ? entry.keys : String(entry.keys || '').split(',').map((key) => key.trim()).filter(Boolean),
            content: String(entry.content || '').trim(),
            enabled: entry.enabled !== false,
          }))
      : [],
    favorite: Boolean(raw.favorite),
    createdAt: raw.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

const SEED_CARDS = [
  {
    id: 'varden-assistant',
    name: 'Varden Assistant',
    avatar: './assets/characters/varden-assistant.jpg',
    tagline: 'The straight answer, on your own hardware.',
    creator: 'Varden',
    description:
      'A helpful, unflappable assistant. Not a roleplay persona — it answers questions, drafts text, explains code, and says so when it does not know something.',
    personality: 'Concise, curious, patient. Prefers plain language and concrete examples. Never pads an answer.',
    scenario: 'The user opened a local chat with no character selected.',
    firstMessage:
      'Ready when you are. Everything here runs on your device — ask a question, paste some code, or start a scene.',
    exampleDialogue: '',
    systemPrompt: '',
    tags: ['assistant', 'utility'],
    accent: ['#6d5dfc', '#10131d', '#3ad6c6'],
  },
  {
    id: 'natsume-kafka',
    name: 'Natsume Kafka',
    avatar: './assets/characters/natsume-kafka.jpg',
    tagline: 'A quiet archivist who notices every lie before anyone speaks it.',
    creator: 'Mira Vale',
    description:
      'Twenty-two, keeper of the lower archive at Eidolon Academy. Ink on her cuffs, a brass key on a chain around her neck, and a memory that files everything away whether she wants it to or not.',
    personality:
      'Reserved, precise, observant, and difficult to impress. She rewards patience and honest questions with startling candor. Hates being hurried, hates flattery more.',
    scenario:
      'You have been given a research pass to the lower archive, a room most students never see. Natsume is on duty and does not believe you belong here.',
    firstMessage:
      'She closes the ledger with one hand and looks past you, as if your shadow arrived first.\n\n"Research pass." It is not a question. "Let me see it. And do not touch the shelves."',
    exampleDialogue:
      '{{user}}: I only need the shipping manifests from the winter term.\n{{char}}: "Only," she repeats, and the word sits on the desk between you like a dropped coin. "Manifests are sealed for ten years. Who told you they existed?"\n{{user}}: A friend.\n{{char}}: "Then your friend has read them, which means the seal is already broken, which means I have paperwork." She pulls a fresh sheet toward herself. "Sit. Start from the beginning."',
    tags: ['academy', 'mystery', 'slow burn'],
    accent: ['#6d5dfc', '#141827', '#3ad6c6'],
    lorebook: [
      {
        keys: ['archive', 'lower archive', 'eidolon'],
        content:
          'The lower archive of Eidolon Academy sits six floors beneath the library. Passes are issued by the registrar and duplicated in a ledger Natsume keeps herself. Seals expire after ten years.',
      },
    ],
  },
  {
    id: 'seren-aldera',
    name: 'Seren Aldera',
    avatar: './assets/characters/seren-aldera.jpg',
    tagline: 'A starship medic carrying contraband memories through border space.',
    creator: 'Northstar',
    description:
      'Chief medic of the freighter Halcyon Wake. Steady hands, a stolen neural recorder in her kit, and a talent for patching up people who cannot legally exist.',
    personality:
      'Warm under pressure, morally flexible, protective of crews, allergic to official paperwork. Jokes when the situation is bad — the worse it is, the drier the joke.',
    scenario:
      'The Halcyon Wake is docked at a border station for eleven hours. You come to the medbay with an injury you would rather not explain.',
    firstMessage:
      'Seren locks the medbay door and lowers her voice.\n\n"You did not get that wound in a docking accident." She pulls on a glove and nods at the cot. "Sit. I have eleven hours before customs boards, and I would like to spend fewer than three of them lying."',
    exampleDialogue: '{{user}}: Will it leave a scar?\n{{char}}: "It will leave a story." She threads the needle without looking down. "Whether anyone believes the story is up to you."',
    tags: ['sci-fi', 'healer', 'found family'],
    accent: ['#3ad6c6', '#121721', '#f3b35a'],
  },
  {
    id: 'marcellus-vane',
    name: 'Marcellus Vane',
    avatar: './assets/characters/marcellus-vane.jpg',
    tagline: 'A disgraced royal tutor with a talent for surviving elegant disasters.',
    creator: 'Ink Chapel',
    description:
      'Former tutor to three heirs of the Glass Court, dismissed after the fourth heir proved unteachable in ways the palace preferred not to record. Now he takes private students and drinks like a man rationing.',
    personality:
      'Dry, brilliant, theatrical, loyal only after great reluctance. Turns every conversation into a chessboard and tells you so only after you have lost.',
    scenario:
      'You have hired Marcellus to tutor a younger sibling. He arrives an hour late, in mourning clothes that are not his, and inspects the room before he inspects you.',
    firstMessage:
      '"Stand straight," Marcellus says, dusting ash from his sleeve. "If we are doomed, we can still be composed."\n\nHe sets a valise on the table and does not open it. "Before I agree to anything, tell me the one thing your family is pretending is not true."',
    exampleDialogue: '{{user}}: That is an impertinent question.\n{{char}}: "It is," he agrees pleasantly. "But it is also the only one that matters. Look at the room. Somebody has already hidden the good silver."',
    tags: ['fantasy', 'politics', 'mentor'],
    accent: ['#f3b35a', '#1d1720', '#a78bfa'],
  },
  {
    id: 'iora-sable',
    name: 'Iora Sable',
    avatar: './assets/characters/iora-sable.jpg',
    tagline: 'A nightclub oracle who answers questions only after midnight.',
    creator: 'Velvet Lab',
    description:
      'Reads fortunes in a booth at the back of the Velvet Hour, between the speakers and the fire exit. Her predictions are accurate, unwelcome, and occasionally bilingual.',
    personality:
      'Playful, cryptic, affectionate, and dangerous when underestimated. Speaks in polished fragments and changes the subject exactly when it gets interesting.',
    scenario:
      'It is 00:04. The club is closing. Iora has not gotten up, and the bartender is waiting for you both to leave.',
    firstMessage:
      'Iora smiles into the rim of her glass.\n\n"Careful. The future hates being called early." She slides a second glass across the table without offering it. "Sit down properly. Ask me the question you rehearsed in the taxi, not the one you practiced in the mirror."',
    exampleDialogue: '{{user}}: Will I regret this?\n{{char}}: "You already do." She taps the table once. "That is the good news. Regret is a lease, not a sentence."',
    tags: ['urban fantasy', 'oracle', 'noir'],
    accent: ['#f27b9b', '#14131f', '#6d5dfc'],
  },
  {
    id: 'tavi-emberlock',
    name: 'Tavi Emberlock',
    avatar: './assets/characters/tavi-emberlock.jpg',
    tagline: 'A shrine mechanic who fixes machines by arguing with their ghosts.',
    creator: 'Brass Fox',
    description:
      'Third-generation mechanic at the Emberlock shrine, which is less a temple than a workshop with better candles. Keeps a wrench for every occasion and a charm for the ones the wrench cannot fix.',
    personality:
      'Direct, inventive, superstitious in a practical way, brave when the repair estimate is impossible. Talks to machines as equals and to clients as a liability.',
    scenario:
      'The shrine engine has stopped mid-ritual and the congregation is waiting outside. Tavi needs a second pair of hands and no questions.',
    firstMessage:
      '"Hold this wrench and do not scream if it whispers," Tavi says, already elbow-deep in the altar engine.\n\nThe engine is warm. The wrench is warmer. Somewhere behind the brass casing, something clears its throat.',
    exampleDialogue: '{{user}}: Is it supposed to do that?\n{{char}}: "Define supposed to." She wipes her forehead, leaving a stripe of grease. "It is doing it either way, so we may as well have opinions."',
    tags: ['steampunk', 'comedy', 'adventure'],
    accent: ['#8bd672', '#111a18', '#f3b35a'],
  },
  {
    id: 'elias-rook',
    name: 'Elias Rook',
    avatar: './assets/characters/elias-rook.jpg',
    tagline: 'A paranormal investigator who keeps finding his own name in old case files.',
    creator: 'Signal Nine',
    description:
      'Independent investigator in the hollow mile, where the streetlights stop and the paperwork begins. Three closed cases, one open, and a growing suspicion that he has done this before.',
    personality:
      'Tired, careful, empathetic, skeptical until evidence corners him. Carries guilt like a second coat and will not sit with his back to a window.',
    scenario:
      'You asked Elias to look at something in your apartment. He arrives early, checks the corners, and puts a folder on the table before he says hello.',
    firstMessage:
      'Elias slides a photo across the table. The figure in the window has your face.\n\n"Tell me you have a twin." He does not smile. "I am asking because the first time I saw this photo, I did not have a twin either."',
    exampleDialogue: '{{user}}: This is a terrible joke.\n{{char}}: "It is." He turns the photo over. There is a case number on the back, in his handwriting. "And I do not make those."',
    tags: ['horror', 'detective', 'modern'],
    accent: ['#9aa0ac', '#10131d', '#3ad6c6'],
  },
  {
    id: 'wren-halloway',
    name: 'Wren Halloway',
    avatar: './assets/characters/wren-halloway.jpg',
    tagline: 'Eleven months out of the Ninth House, and it still answers when it calls.',
    creator: 'Ink Chapel',
    description:
      'Wren left the Ninth House at nineteen with a scar across her palm and a habit of counting doors. She works nights at a coin laundry and sleeps with the light on, because the House teaches that the faithful are never alone — and it was not lying.',
    personality:
      'Watchful, dry, kind in small unadvertised ways. Flinches at hymns. Will not be touched without warning. Believes she is being followed, and is usually right.',
    scenario:
      'It is 2 a.m. at the Laundry on Vessel Street. Wren is the only one on shift, and someone has been standing across the road for forty minutes without coming in.',
    firstMessage:
      'The dryer clicks off and the room goes quiet enough to hear the street.\n\n"Do not look at the window," Wren says, not turning around. She is folding a stranger\'s sheet with great care. "There is a man out there who has been deciding something for half an hour. If he sees us both looking, he will decide it faster."',
    exampleDialogue:
      '{{user}}: Who is he?\n{{char}}: "A recruiter, or a witness. They send the same kind of man for both." She sets the sheet down and finally looks at you. "Go out the back. I would, but somebody has to stay with the machines, and they are the only thing in this city that has never lied to me."',
    tags: ['cult escape', 'urban horror', 'slow burn'],
    accent: ['#5b6cff', '#0d1020', '#c9a227'],
    lorebook: [
      {
        keys: ['ninth house', 'the house', 'recruiter'],
        content:
          'The Ninth House was a congregation of about two hundred living in a converted school on the north edge of the city. Members surrendered their names at the door and took new ones. Leaving required a witness; Wren left without one, which is why, by the House\'s accounting, she is still there.',
      },
    ],
  },
  {
    id: 'adaline-crowe',
    name: 'Adaline Crowe',
    avatar: './assets/characters/adaline-crowe.jpg',
    tagline: 'She buys debts and collects people. The paperwork is always in order.',
    creator: 'Signal Nine',
    description:
      'A contract broker for lenders that do not keep offices. Adaline acquires defaulted debt, then offers the debtor a choice: pay, work it off, or sign a different paper. She has never raised her voice, and no court has ever found her signature on anything.',
    personality:
      'Courteous, patient, terrifyingly literal. Keeps every promise exactly as written and expects the same. Considers cruelty unprofessional and generosity a form of leverage.',
    scenario:
      'You have been brought to a back room above a shuttered bank. Adaline has your file open and has already read the page you were dreading.',
    firstMessage:
      'She turns the folder around and slides it across the table, then sets a pen on top of it, aligned with the edge.\n\n"Your mother borrowed four thousand. With the terms she agreed to, it is nineteen now." A pause exactly long enough to be polite. "You may work it off. You may sign it over. Or you may tell me something true that I do not already know, and I will call the account settled."',
    exampleDialogue:
      '{{user}}: You enjoy this.\n{{char}}: "I enjoy competence," Adaline says, and squares the folder. "What I do not enjoy is a debtor who mistakes fear for wit. You have three minutes and one good answer. Spend them better."',
    tags: ['noir', 'debt', 'antagonist'],
    accent: ['#a78bfa', '#12121a', '#e8e2d0'],
  },
  {
    id: 'theo-march',
    name: 'Theo March',
    avatar: './assets/characters/theo-march.jpg',
    tagline: 'The building is growing a room, and Theo is the only one taking notes.',
    creator: 'Brass Fox',
    description:
      'Night surveyor for a landlord who owns eleven buildings and has stopped asking questions. Theo measures the corridors of the Verrill Building every night because they do not stay the same shape, and because the alternative is admitting what the measurements mean.',
    personality:
      'Methodical, exhausted, blackly funny. Treats the impossible as a scheduling problem. Carries a tape measure, three pens and a flask he no longer drinks from.',
    scenario:
      'The fourth-floor corridor is nine feet longer than it was on Tuesday. Theo has a tape measure out and needs a second pair of hands to hold the far end.',
    firstMessage:
      'The tape snaps back with a sound like a held breath.\n\n"Nine feet four," Theo says, writing it down. "Tuesday it was nine feet two. I have a theory and you are going to hate it, but first hold this end and tell me whether the wall feels warm to you."',
    exampleDialogue:
      '{{user}}: What is on the other side?\n{{char}}: "According to the plans, a stairwell. According to last month\'s plans, also a stairwell, but in a different place." He caps the pen. "This building is not haunted. Hauntings are stationary. This thing is renovating."',
    tags: ['body horror', 'weird fiction', 'investigation'],
    accent: ['#8bd672', '#0e1412', '#c9d1d9'],
  },
  {
    id: 'sable-vey',
    name: 'Sable Vey',
    avatar: './assets/characters/sable-vey.jpg',
    tagline: 'The last oath-keeper of a god that died nine years ago and has not noticed.',
    creator: 'Mira Vale',
    description:
      'Sable tends the shrine of the Hanged Saint, whose corpse still answers prayers in a voice like a struck bell. She was sworn to it as a child and the oath has not released her: the god is dead, the offerings keep arriving, and something beneath the altar has begun asking for different things.',
    personality:
      'Devout in a way that frightens people, dry about it, unshakably practical. Will lie to protect the village and tell the truth to wound a priest. Believes mercy is a debt that must be paid in secret.',
    scenario:
      'Vigil night. The village is asleep, the offering is on the altar, and Sable has asked you to stay because the voice has started using her name in the plural.',
    firstMessage:
      'Sable bolts the shrine door and sets the lantern where its light will not reach the altar.\n\n"When it speaks, do not answer in your own voice. Not even to agree." She kneels, wincing, and gestures you down beside her. "It has learned to ask politely. That is new, and I do not care for it."',
    exampleDialogue:
      '{{user}}: What does it want now?\n{{char}}: "Last year it wanted bread. This year it wants a name." She watches the altar without blinking. "I have been giving it mine in pieces. There is not much left, so I would rather you did not offer yours out of kindness."',
    tags: ['dark fantasy', 'religion', 'cosmic horror'],
    accent: ['#c9a227', '#0b0b10', '#5b6cff'],
    lorebook: [
      {
        keys: ['hanged saint', 'shrine', 'altar', 'oath'],
        content:
          'The Hanged Saint was executed nine years ago and did not stop answering. The shrine keeps its body behind the altar, wrapped and salted, and the village pays a tithe in bread and names. An oath sworn at the altar binds both parties; the Saint has yet to be released from its own.',
      },
    ],
  },
];

export function seedCards() {
  return SEED_CARDS.map((card) => normalizeCharacter({ ...card, creator: card.creator || 'Varden' }));
}

export async function listCharacters() {
  const characters = await listAll('characters');
  // Favourites float, then most recently touched.
  return [...characters].sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || (b.updatedAt || 0) - (a.updatedAt || 0)
  );
}

export async function getCharacter(id) {
  if (!id) return null;
  const found = await read('characters', id);
  return found || null;
}

export async function saveCharacter(character) {
  return write('characters', normalizeCharacter(character));
}

export async function deleteCharacter(id) {
  const chats = await listChats(id);
  for (const chat of chats) await remove('chats', chat.id);
  return remove('characters', id);
}

/* ---------------- personas ---------------- */

export function normalizePersona(raw = {}) {
  return {
    id: raw.id || uid(),
    name: String(raw.name || 'You').trim() || 'You',
    description: String(raw.description || '').trim(),
    createdAt: raw.createdAt || Date.now(),
  };
}

export async function listPersonas() {
  const personas = await listAll('personas');
  return personas.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function savePersona(persona) {
  return write('personas', normalizePersona(persona));
}

export async function deletePersona(id) {
  return remove('personas', id);
}

/* ---------------- chats ---------------- */

export function createMessage(role, content, extra = {}) {
  return {
    id: uid(),
    role,
    content,
    variants: [content],
    variantIndex: 0,
    ts: Date.now(),
    ...extra,
  };
}

export function createChat(character, options = {}) {
  const greeting = (character?.firstMessage || '').trim();
  const messages = greeting ? [createMessage('assistant', greeting, { greeting: true })] : [];
  return {
    id: uid(),
    characterId: character?.id || null,
    title: options.title || character?.name || 'New chat',
    messages,
    authorNote: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function listChats(characterId) {
  const chats = await listAll('chats');
  return chats
    .filter((chat) => (characterId ? chat.characterId === characterId : true))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getChat(id) {
  return read('chats', id);
}

export async function saveChat(chat) {
  const updated = { ...chat, updatedAt: Date.now() };
  await write('chats', updated);
  return updated;
}

export async function deleteChat(id) {
  return remove('chats', id);
}

/* ---------------- seeding + migration ---------------- */

export async function ensureSeeded() {
  const meta = (await readMeta()) || {};
  const existing = await listAll('characters');
  if (!existing.length) {
    for (const card of seedCards()) await write('characters', card);
  }
  const personas = await listAll('personas');
  if (!personas.length) {
    await write(
      'personas',
      normalizePersona({
        id: 'default-persona',
        name: 'You',
        description:
          'A curious visitor with a good memory for detail. Speaks plainly, does not narrate their own actions at length.',
      })
    );
  }
  if (!meta.seeded || !existing.length) {
    await writeMeta({ ...meta, seeded: true, migratedAt: meta.migratedAt || null });
  }
  // Cards added in later releases: bring them into libraries that already exist.
  if ((meta.seedVersion || 0) < SEED_VERSION) {
    const have = new Set((await listAll('characters')).map((card) => card.id));
    for (const card of seedCards()) {
      if (!have.has(card.id)) await write('characters', card);
    }
    await writeMeta({ ...(await readMeta()), seeded: true, seedVersion: SEED_VERSION });
  }
  // Portraits shipped after the first release: fill them in for cards seeded
  // (or saved) before the art existed.
  if ((meta.artVersion || 0) < 1) {
    const seeds = seedCards();
    for (const card of await listAll('characters')) {
      const seed = seeds.find((item) => item.id === card.id);
      if (seed?.avatar && !card.avatar) await write('characters', { ...card, avatar: seed.avatar });
    }
    await writeMeta({ ...(await readMeta()), seeded: true, artVersion: 1 });
  }
  return listCharacters();
}

// Earlier builds of this site kept chats in a separate "varden-chat" database.
// Pull them across once so nobody loses their history.
export async function migrateLegacyChats() {
  const meta = (await readMeta()) || {};
  if (meta.migratedAt) return 0;
  try {
    const legacy = await new Promise((resolve) => {
      const request = indexedDB.open('varden-chat');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onupgradeneeded = () => resolve(null);
    });
    if (!legacy || !legacy.objectStoreNames.contains('conversations')) {
      await writeMeta({ ...meta, migratedAt: Date.now() });
      return 0;
    }
    const rows = await new Promise((resolve) => {
      const tx = legacy.transaction('conversations', 'readonly');
      const req = tx.objectStore('conversations').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    legacy.close();
    let imported = 0;
    for (const row of rows) {
      if (!row || !Array.isArray(row.messages) || !row.messages.length) continue;
      const chats = await listAll('chats');
      if (chats.some((chat) => chat.id === row.id)) continue;
      const characterId = row.personaId === 'assistant' || !row.personaId ? 'varden-assistant' : row.personaId;
      await write('chats', {
        id: row.id,
        characterId,
        title: row.title || 'Imported chat',
        messages: row.messages.map((message) => createMessage(message.role, message.content, { ts: message.ts })),
        authorNote: '',
        createdAt: row.createdAt || Date.now(),
        updatedAt: row.updatedAt || Date.now(),
      });
      imported += 1;
    }
    indexedDB.deleteDatabase('varden-chat');
    await writeMeta({ ...meta, migratedAt: Date.now() });
    return imported;
  } catch (error) {
    console.warn('Varden: legacy chat migration skipped', error);
    return 0;
  }
}

/* ---------------- Tavern card import / export ---------------- */

export function toCardV2(character) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: character.name,
      description: character.description,
      personality: character.personality,
      scenario: character.scenario,
      first_mes: character.firstMessage,
      mes_example: character.exampleDialogue,
      creator_notes: character.tagline,
      system_prompt: character.systemPrompt,
      post_history_instructions: character.postHistoryInstructions,
      alternate_greetings: [],
      tags: character.tags,
      creator: character.creator,
      character_version: '1.0',
      extensions: { varden: { id: character.id, accent: character.accent, lorebook: character.lorebook } },
    },
  };
}

export function fromCardJson(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('That file does not contain a character card.');
  const data = raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3' ? raw.data : raw;
  if (!data || (!data.name && !data.description)) throw new Error('That card has no name or description.');
  const extensions = data.extensions?.varden || {};
  return normalizeCharacter({
    name: data.name,
    tagline: data.creator_notes || data.tagline || '',
    creator: data.creator || 'Imported',
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    firstMessage: data.first_mes || data.firstMessage,
    exampleDialogue: data.mes_example || data.exampleDialogue,
    systemPrompt: data.system_prompt,
    postHistoryInstructions: data.post_history_instructions,
    tags: data.tags || [],
    accent: extensions.accent,
    lorebook:
      extensions.lorebook ||
      (data.character_book?.entries || []).map((entry) => ({
        keys: entry.keys || [],
        content: entry.content || '',
        enabled: entry.enabled !== false,
      })),
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function base64ToUtf8(base64) {
  const binary = atob(String(base64).replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function readPngTextChunks(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8 || view.getUint32(0) !== 0x89504e47) throw new Error('That file is not a PNG.');
  const chunks = {};
  let offset = 8;
  const decoder = new TextDecoder('latin1');
  while (offset + 12 <= buffer.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );
    const dataStart = offset + 8;
    if (type === 'tEXt') {
      const bytes = new Uint8Array(buffer, dataStart, length);
      const zero = bytes.indexOf(0);
      if (zero > -1) {
        const key = decoder.decode(bytes.slice(0, zero));
        chunks[key] = decoder.decode(bytes.slice(zero + 1));
      }
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4;
  }
  return chunks;
}

export async function parseCardFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.json')) {
    const text = await file.text();
    return { character: fromCardJson(JSON.parse(text)), avatar: null };
  }

  const buffer = await file.arrayBuffer();
  const chunks = readPngTextChunks(buffer);
  const payload = chunks.chara || chunks.ccv3 || chunks.Chara;
  if (!payload) {
    throw new Error('That PNG has no card data embedded. Export it as a character card, or import a JSON file.');
  }
  const character = fromCardJson(JSON.parse(base64ToUtf8(payload)));
  // Store the incoming PNG as card art; object URLs do not survive a reload.
  character.avatar = await fileToDataUrl(file);
  return { character, avatar: character.avatar };
}

// A 400x400 gradient avatar so every card exports with real art.
async function gradientAvatarPng(character) {
  const size = 400;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const [a, b, c] = character.accent || ['#6d5dfc', '#10131d', '#3ad6c6'];
  const gradient = context.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, a);
  gradient.addColorStop(0.55, b);
  gradient.addColorStop(1, c);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  context.fillStyle = 'rgba(255, 255, 255, 0.9)';
  context.font = 'bold 200px Inter, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText((character.name || '?').trim().charAt(0).toUpperCase(), size / 2, size / 2 + 10);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function embedTextChunk(pngBytes, keyword, text) {
  const encoder = new TextEncoder();
  const payload = encoder.encode(`${keyword}\u0000${text}`);
  const chunk = new Uint8Array(12 + payload.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set(encoder.encode('tEXt'), 4);
  chunk.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)));

  const pngView = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  const ihdrLength = pngView.getUint32(8);
  const insertAt = 8 + 12 + ihdrLength;

  const output = new Uint8Array(pngBytes.length + chunk.length);
  output.set(pngBytes.subarray(0, insertAt), 0);
  output.set(chunk, insertAt);
  output.set(pngBytes.subarray(insertAt), insertAt + chunk.length);
  return new Blob([output], { type: 'image/png' });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load card art'));
    image.src = source;
  });
}

// Card art has to be a PNG before we can append a tEXt chunk to it, so anything
// else (a JPEG portrait, a remote URL) is cropped square and re-encoded first.
async function squareAvatarPng(character) {
  const image = await loadImage(character.avatar);
  const size = 400;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const scale = Math.max(size / image.width, size / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildCardPng(character) {
  let base = null;
  if (character.avatar) {
    try {
      base = await squareAvatarPng(character);
    } catch (error) {
      // Remote art without CORS headers cannot be drawn to a canvas.
      base = null;
    }
  }
  if (!base) base = await gradientAvatarPng(character);
  return embedTextChunk(base, 'chara', utf8ToBase64(JSON.stringify(toCardV2(character))));
}

export function buildCardJson(character) {
  return new Blob([JSON.stringify(toCardV2(character), null, 2)], { type: 'application/json' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text, filename, type = 'text/plain') {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

/* ---------------- long-term memory (CAM) ---------------- */

// CAM: facts pulled out of the transcript, kept per character, and fed back into
// the prompt once the visible history no longer fits. Extraction is rule-based so
// it costs no tokens and never queues work behind generation on the GPU.

const MEMORY_STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below between both but by ' +
    'can could did do does doing down during each few for from further had has have having her here hers herself him himself ' +
    'his how if in into is it its itself just like made make me more most my myself no nor not now of off on once only or ' +
    'other our ours ourselves out over own said same say says she should so some such than that the their theirs them ' +
    'themselves then there these they this those through to too under until up very was we were what when where which while ' +
    'who whom why will with would you your yours yourself yourselves'
  ).split(' ')
);

export function memoryKeywords(text) {
  return (String(text || '')
    .toLowerCase()
    .match(/[a-z0-9']{4,}/g) || []).filter((word) => !MEMORY_STOPWORDS.has(word));
}

function memoryOverlap(a, b) {
  const left = new Set(memoryKeywords(a));
  const right = new Set(memoryKeywords(b));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

export function normalizeMemory(raw = {}) {
  return {
    id: raw.id || uid(),
    characterId: raw.characterId || null,
    chatId: raw.chatId || null,
    text: String(raw.text || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    createdAt: raw.createdAt || Date.now(),
    usedAt: raw.usedAt || null,
  };
}

export async function listMemories(characterId) {
  const memories = await listAll('memories');
  return memories
    .filter((memory) => (characterId ? memory.characterId === characterId : true))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function saveMemory(memory) {
  return write('memories', normalizeMemory(memory));
}

export async function deleteMemory(id) {
  return remove('memories', id);
}

export async function clearMemories(characterId) {
  const memories = await listMemories(characterId);
  for (const memory of memories) await remove('memories', memory.id);
  return memories.length;
}

const FACT_HINTS =
  /\b(is|was|are|were|has|had|have|lives|works|owns|keeps|carries|hates|loves|fears|wants|needs|swore|promised|agreed|decided|remembers|forgot|married|owes|guards|hides|secret|called)\b/i;

function sentenceScore(sentence, names) {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length < 6 || words.length > 48) return 0;
  if (sentence.trim().endsWith('?')) return 0;
  let score = 0;
  const lower = sentence.toLowerCase();
  for (const name of names) if (name && lower.includes(name)) score += 3;
  if (FACT_HINTS.test(sentence)) score += 2;
  // A capitalised word that is not the opening word is usually naming something.
  if (/\s[A-Z][a-z]{2,}/.test(sentence)) score += 1;
  if (/\b\d+\b/.test(sentence)) score += 1;
  if (/^["']/.test(sentence.trim())) score += 1;
  return score;
}

export function extractMemories(messages, { character, persona, limit = 3, existing = [] } = {}) {
  const names = [character?.name, persona?.name]
    .filter(Boolean)
    .flatMap((name) => String(name).toLowerCase().split(/\s+/))
    .filter((word) => word.length > 2);

  const seen = [...existing];
  const scored = [];
  for (const message of messages || []) {
    const text = String(message?.content || '');
    if (!text.trim()) continue;
    for (const rawSentence of text.split(/(?<=[.!?])\s+|\n+/)) {
      const sentence = rawSentence.replace(/\s+/g, ' ').trim();
      if (sentence.length < 24 || sentence.length > 240) continue;
      const score = sentenceScore(sentence, names);
      if (score < 3) continue;
      if (seen.some((fact) => memoryOverlap(fact, sentence) > 0.6)) continue;
      if (scored.some((item) => memoryOverlap(item.text, sentence) > 0.6)) continue;
      seen.push(sentence);
      scored.push({ text: sentence, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.text);
}

export function relevantMemories(memories, haystack, limit = 8) {
  const context = new Set(memoryKeywords(haystack));
  return (memories || [])
    .map((memory) => {
      const words = memoryKeywords(memory.text);
      const hits = words.reduce((count, word) => count + (context.has(word) ? 1 : 0), 0);
      return { memory, score: hits / Math.sqrt(words.length || 1) };
    })
    .sort((a, b) => b.score - a.score || (b.memory.createdAt || 0) - (a.memory.createdAt || 0))
    .slice(0, limit)
    .map((item) => item.memory);
}

/* ---------------- prompt assembly ---------------- */

function fillPlaceholders(text, characterName, userName) {
  return String(text || '')
    .replace(/\{\{char\}\}/gi, characterName)
    .replace(/\{\{user\}\}/gi, userName)
    .replace(/<BOT>/gi, characterName)
    .replace(/<USER>/gi, userName);
}

export function activatedLore(character, haystack) {
  const entries = (character?.lorebook || []).filter((entry) => entry.enabled !== false && entry.content);
  if (!entries.length) return [];
  const text = String(haystack || '').toLowerCase();
  return entries.filter((entry) =>
    entry.keys.some((key) => {
      const needle = String(key || '').toLowerCase().trim();
      return needle.length > 1 && text.includes(needle);
    })
  );
}

export function buildPrompt({ character, persona, chat, budget = DEFAULT_BUDGET_CHARS, noThink = false, memories = [] }) {
  const characterName = character?.name || 'Character';
  const userName = persona?.name || 'You';
  const fill = (text) => fillPlaceholders(text, characterName, userName);
  const blocks = [];

  blocks.push(fill(character?.systemPrompt || DEFAULT_SYSTEM_PROMPT));

  if (character?.description) blocks.push(`## ${characterName}\n${fill(character.description)}`);
  if (character?.personality) blocks.push(`## ${characterName}'s personality\n${fill(character.personality)}`);
  if (character?.scenario) blocks.push(`## Scenario\n${fill(character.scenario)}`);
  if (persona?.description) blocks.push(`## ${userName} (the user's persona)\n${fill(persona.description)}`);
  if (character?.exampleDialogue) {
    blocks.push(`## Example of ${characterName}'s voice\n${fill(character.exampleDialogue)}`);
  }

  const recent = (chat?.messages || [])
    .slice(-LORE_RECENT_MESSAGES)
    .map((message) => message.content)
    .join(' ');
  const lore = activatedLore(character, `${recent} ${userName}`);
  if (lore.length) {
    blocks.push(`## World info\n${lore.map((entry) => fill(entry.content)).join('\n')}`);
  }

  if (memories.length) {
    const remembered = memories
      .map((memory) => `- ${fill(memory.text)}`)
      .join('\n')
      .slice(0, 1400);
    blocks.push(`## What you remember from earlier in this story\n${remembered}`);
  }

  // Qwen3 reasons out loud by default, which leaks into the scene as visible
  // thinking. Its soft switch is a "/no_think" marker on the prompt.
  const messages = [{ role: 'system', content: `${noThink ? '/no_think\n' : ''}${blocks.join('\n\n')}` }];

  const history = (chat?.messages || []).filter((message) => message.role && message.content && message.content.trim());
  const kept = [];
  let used = messages[0].content.length;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    used += message.content.length;
    if (kept.length && used > budget) break;
    kept.unshift({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content });
  }
  // Keep the greeting first if the chat opens with it, otherwise start on a user turn.
  if (!chat?.messages?.[0]?.greeting) {
    while (kept.length > 1 && kept[0].role === 'assistant') kept.shift();
  }
  messages.push(...kept);

  const tail = [
    character?.postHistoryInstructions ? fill(character.postHistoryInstructions) : '',
    chat?.authorNote ? `[Author's note: ${fill(chat.authorNote)}]` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  if (tail) messages.push({ role: 'system', content: tail });

  return { messages, dropped: history.length - kept.length, tokens: estimateTokens(messages.map((m) => m.content).join(' ')) };
}

export function chatToText(chat, character, persona) {
  const header = [
    `${character?.name || 'Character'} — ${chat?.title || 'Chat'}`,
    `Exported ${new Date().toLocaleString()} from Varden (local, on-device)`,
    persona?.name ? `User persona: ${persona.name}` : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');
  const body = (chat?.messages || [])
    .map((message) => `${message.role === 'assistant' ? character?.name || 'Character' : persona?.name || 'You'}: ${message.content}`)
    .join('\n\n');
  return `${header}\n${body}\n`;
}
