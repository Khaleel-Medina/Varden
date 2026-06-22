// Varden — main app (Supabase auth + DB, Vercel Blob images, IndexedDB cache)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// IndexedDB cache (inlined to avoid MIME type issues with local .js imports)
const CACHE_DB = 'varden-cache';
const CACHE_STORE = 'characters';

function openCache() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToCache(userId, data) {
  try {
    const db = await openCache();
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    await new Promise((resolve, reject) => {
      tx.objectStore(CACHE_STORE).put(JSON.stringify(data), `user:${userId}`);
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  } catch (e) { console.warn('Cache save failed:', e); }
}

async function getFromCache(userId) {
  try {
    const db = await openCache();
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const result = await new Promise((resolve, reject) => {
      const req = tx.objectStore(CACHE_STORE).get(`user:${userId}`);
      req.onsuccess = () => resolve(req.result);
      req.onerror = reject;
    });
    return result ? JSON.parse(result) : null;
  } catch (e) { console.warn('Cache read failed:', e); return null; }
}

async function clearCache() {
  try {
    const db = await openCache();
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    await new Promise((resolve, reject) => {
      tx.objectStore(CACHE_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  } catch (e) { console.warn('Cache clear failed:', e); }
}

const SUPABASE_URL = 'https://ljruzruhbqkbxkflrvzi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqcnV6cnVoYmtiY3hrbGZydnppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzQ0NjMsImV4cCI6MjA4NDQxMDQ2M30.ZlJcgo3KzQ9ND9VSEpH0yzHyeZFHid'; // public anon key

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
console.log('Varden: Supabase client initialized');

// Auth helpers (inline to avoid importing from lib/supabase.js)
async function signUp(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { display_name: displayName } }
  });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((event, session) => {
    cb(session?.user ?? null);
  });
}

// Seed data (shown only to non-authenticated users as demo)
const SEED_CHARACTERS = [
  {
    id: "natsume-kafka",
    name: "Natsume Kafka",
    source: "Eidolon Academy",
    creator: "Mira Vale",
    visibility: "public",
    tagline: "A quiet archivist who notices every lie before anyone speaks it.",
    greeting: "She closes the ledger with one hand and looks past you, as if your shadow arrived first.",
    personality: "Reserved, precise, observant, and difficult to impress. She rewards patience and honest questions.",
    tags: ["academy", "mystery", "slow burn"],
    likes: 1840,
    bookmarks: 612,
    rating: "4.9",
    created: "2026-06-19",
    art: ["#6d5dfc", "#141827", "#3ad6c6"],
  },
  {
    id: "seren-aldera",
    name: "Seren Aldera",
    source: "Original",
    creator: "Northstar",
    visibility: "public",
    tagline: "A starship medic carrying contraband memories through border space.",
    greeting: "Seren locks the medbay door and lowers her voice. \"You did not get that wound in a docking accident.\"",
    personality: "Warm under pressure, morally flexible, protective of crews, allergic to official paperwork.",
    tags: ["sci-fi", "healer", "found family"],
    likes: 1294,
    bookmarks: 488,
    rating: "4.8",
    created: "2026-06-18",
    art: ["#3ad6c6", "#121721", "#f3b35a"],
  },
  {
    id: "marcellus-vane",
    name: "Marcellus Vane",
    source: "The Glass Court",
    creator: "Ink Chapel",
    visibility: "unlisted",
    tagline: "A disgraced royal tutor with a talent for surviving elegant disasters.",
    greeting: "\"Stand straight,\" Marcellus says, dusting ash from his sleeve. \"If we are doomed, we can still be composed.\"",
    personality: "Dry, brilliant, theatrical, loyal only after great reluctance. Turns every conversation into a chessboard.",
    tags: ["fantasy", "politics", "mentor"],
    likes: 940,
    bookmarks: 321,
    rating: "4.7",
    created: "2026-06-12",
    art: ["#f3b35a", "#1d1720", "#a78bfa"],
  },
  {
    id: "iora-sable",
    name: "Iora Sable",
    source: "Original",
    creator: "Velvet Lab",
    visibility: "private",
    tagline: "A nightclub oracle who answers questions only after midnight.",
    greeting: "Iora smiles into the rim of her glass. \"Careful. The future hates being called early.\"",
    personality: "Playful, cryptic, affectionate, and dangerous when underestimated. Speaks in polished fragments.",
    tags: ["urban fantasy", "oracle", "noir"],
    likes: 734,
    bookmarks: 255,
    rating: "4.6",
    created: "2026-06-10",
    art: ["#f27b9b", "#14131f", "#6d5dfc"],
  },
  {
    id: "tavi-emberlock",
    name: "Tavi Emberlock",
    source: "Clockwork Saints",
    creator: "Brass Fox",
    visibility: "public",
    tagline: "A shrine mechanic who fixes machines by arguing with their ghosts.",
    greeting: "\"Hold this wrench and do not scream if it whispers,\" Tavi says, already elbow-deep in the altar engine.",
    personality: "Direct, inventive, superstitious in a practical way, brave when the repair estimate is impossible.",
    tags: ["steampunk", "comedy", "adventure"],
    likes: 1108,
    bookmarks: 402,
    rating: "4.8",
    created: "2026-06-16",
    art: ["#8bd672", "#111a18", "#f3b35a"],
  },
  {
    id: "elias-rook",
    name: "Elias Rook",
    source: "The Hollow Mile",
    creator: "Signal Nine",
    visibility: "public",
    tagline: "A paranormal investigator who keeps finding his own name in old case files.",
    greeting: "Elias slides a photo across the table. The figure in the window has your face. \"Tell me you have a twin.\"",
    personality: "Tired, careful, empathetic, skeptical until evidence corners him. Carries guilt like a second coat.",
    tags: ["horror", "detective", "modern"],
    likes: 1512,
    bookmarks: 530,
    rating: "4.9",
    created: "2026-06-20",
    art: ["#9aa0ac", "#10131d", "#3ad6c6"],
  },
];

let characters = [];
let selectedId = null;
let currentFilter = "all";
let currentImageData = null;
let currentUser = null;
let isDemo = true;

// Cache: IndexedDB fallback
let dbReady = openDB();

const grid = document.querySelector("#characterGrid");
const resultCount = document.querySelector("#resultCount");
const searchInput = document.querySelector("#searchInput");
const sortSelect = document.querySelector("#sortSelect");
const segments = document.querySelectorAll(".segment");
const dialog = document.querySelector("#creatorDialog");
const form = document.querySelector("#creatorForm");
const reviewPanel = document.querySelector("#reviewPanel");

const detail = {
  art: document.querySelector("#detailArt"),
  visibility: document.querySelector("#detailVisibility"),
  source: document.querySelector("#detailSource"),
  name: document.querySelector("#detailName"),
  tagline: document.querySelector("#detailTagline"),
  likes: document.querySelector("#detailLikes"),
  bookmarks: document.querySelector("#detailBookmarks"),
  rating: document.querySelector("#detailRating"),
  greeting: document.querySelector("#detailGreeting"),
  personality: document.querySelector("#detailPersonality"),
  tags: document.querySelector("#detailTags"),
};

// Auth UI elements
const accountStrip = document.querySelector(".account-strip");
const authDialog = document.getElementById('authDialog');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmit = document.getElementById('authSubmit');
const authToggle = document.getElementById('authToggle');
const authCancel = document.getElementById('authCancel');
let authMode = 'signin';

function updateAuthUI(user) {
  currentUser = user;
  isDemo = !user;
  
  if (user) {
    accountStrip.innerHTML = `
      <div class="avatar avatar-user"></div>
      <div>
        <strong>${user.email?.split('@')[0] || 'User'}</strong>
        <span>My vault</span>
      </div>
      <button class="ghost-button" id="signOutBtn" style="margin-top:8px;width:100%;font-size:0.8rem;">Sign out</button>
    `;
    document.getElementById('signOutBtn')?.addEventListener('click', handleSignOut);
    document.getElementById('openCreate')?.removeAttribute('disabled');
    document.getElementById('openCreateTop')?.removeAttribute('disabled');
  } else {
    accountStrip.innerHTML = `
      <div class="avatar avatar-user"></div>
      <div>
        <strong>Guest</strong>
        <span>Sign in to create characters</span>
      </div>
      <button class="ghost-button" id="signInBtn" style="margin-top:8px;width:100%;font-size:0.8rem;">Sign in</button>
    `;
    document.getElementById('signInBtn')?.addEventListener('click', () => authDialog.showModal());
    document.getElementById('openCreate')?.setAttribute('disabled', '');
    document.getElementById('openCreateTop')?.setAttribute('disabled', '');
  }
}

async function handleSignIn(email, password) {
  try {
    await signIn(email, password);
  } catch (e) {
    alert(e.message || 'Sign in failed');
  }
}

async function handleSignUp(email, password, displayName) {
  try {
    await signUp(email, password, displayName);
    alert('Check your email to confirm your account');
  } catch (e) {
    alert(e.message || 'Sign up failed');
  }
}

async function handleSignOut() {
  await signOut();
  updateAuthUI(null);
  loadCharacters();
}

onAuthChange((user) => {
  updateAuthUI(user);
  loadCharacters();
  if (user) authDialog?.close();
});

authSubmit?.addEventListener('click', async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  
  if (authMode === 'signin') {
    await handleSignIn(email, password);
  } else {
    await handleSignUp(email, password, email.split('@')[0]);
  }
});

authToggle?.addEventListener('click', (e) => {
  e.preventDefault();
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  authSubmit.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
  authToggle.textContent = authMode === 'signin' ? 'Create one' : 'Sign in instead';
});

authCancel?.addEventListener('click', () => authDialog?.close());

function setArt(element, art) {
  element.style.setProperty("--art-a", art[0]);
  element.style.setProperty("--art-b", art[1]);
  element.style.setProperty("--art-c", art[2]);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

// Load characters: cache first, then Supabase
async function loadCharacters() {
  if (isDemo) {
    characters = [...SEED_CHARACTERS];
    renderGrid();
    return;
  }
  
  if (!currentUser) {
    characters = [...SEED_CHARACTERS];
    renderGrid();
    return;
  }

  // Try cache first
  const cached = await getFromCache(currentUser.id);
  if (cached) {
    characters = cached;
    renderGrid();
    // Refresh from Supabase in background
    refreshFromServer();
    return;
  }

  await refreshFromServer();
}

async function refreshFromServer() {
  try {
    const dbChars = await supabase
      .from('characters')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    
    if (dbChars.data && dbChars.data.length > 0) {
      characters = dbChars.data;
      // Save to cache
      await saveToCache(currentUser.id, characters);
    } else {
      // New user: show seed data as demo
      characters = [...SEED_CHARACTERS];
    }
    renderGrid();
  } catch (e) {
    console.error('Failed to load from server:', e);
    // Fall back to cache
    const cached = await getFromCache(currentUser.id);
    if (cached) {
      characters = cached;
      renderGrid();
    } else {
      characters = [...SEED_CHARACTERS];
      renderGrid();
    }
  }
}

function filteredCharacters() {
  const query = searchInput.value.trim().toLowerCase();
  const sorted = [...characters].sort((a, b) => {
    if (sortSelect.value === "newest") {
      return new Date(b.created) - new Date(a.created);
    }
    if (sortSelect.value === "likes") {
      return b.likes - a.likes;
    }
    return b.likes + b.bookmarks - (a.likes + a.bookmarks);
  });

  return sorted.filter((character) => {
    const matchesVisibility = currentFilter === "all" || character.visibility === currentFilter;
    const haystack = [
      character.name,
      character.source,
      character.creator,
      character.tagline,
      character.tags.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return matchesVisibility && haystack.includes(query);
  });
}

async function renderGrid() {
  const visible = filteredCharacters();
  resultCount.textContent = `${visible.length} profile${visible.length === 1 ? "" : "s"}`;
  grid.innerHTML = "";

  if (visible.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <p>No characters found.</p>
      <p class="muted">${isDemo ? 'Sign in to create your first character.' : 'Try adjusting your search or filters.'}</p>
    </div>`;
    return;
  }

  for (const character of visible) {
    const card = document.createElement("div");
    card.className = `character-card ${selectedId === character.id ? "selected" : ""}`;
    card.dataset.id = character.id || character.slug;

    const art = character.art || character.art_a ? [character.art_a, character.art_b, character.art_c] : ["#6d5dfc", "#141827", "#3ad6c6"];

    card.innerHTML = `
      <div class="card-art" style="--art-a:${art[0]};--art-b:${art[1]};--art-c:${art[2]}">
        ${character.art_url ? `<img src="${character.art_url}" alt="${character.name}" style="width:100%;height:100%;object-fit:cover;" />` : ''}
      </div>
      <div class="card-body">
        <div class="card-meta">
          <div>
            <strong>${character.name}</strong>
            <span>${character.source}</span>
          </div>
          <span class="visibility-badge ${character.visibility || 'public'}">${character.visibility || 'public'}</span>
        </div>
        <p class="card-tagline">${character.tagline}</p>
        <div class="card-tags">
          ${(character.tags || []).slice(0, 3).map((tag) => `<span>${tag}</span>`).join("")}
        </div>
        <div class="card-stats">
          <span>❤️ ${formatNumber(character.likes || 0)}</span>
          <span>🔖 ${formatNumber(character.bookmarks || 0)}</span>
        </div>
      </div>
    `;
    grid.appendChild(card);
  }
}

grid.addEventListener("click", (event) => {
  const card = event.target.closest(".character-card");
  if (!card) return;
  selectedId = card.dataset.id;
  renderGrid();
  const character = characters.find(c => (c.id || c.slug) === selectedId);
  if (character) showDetail(character);
});

searchInput.addEventListener("input", renderGrid);
sortSelect.addEventListener("change", renderGrid);

segments.forEach((segment) => {
  segment.addEventListener("click", () => {
    segments.forEach((item) => item.classList.remove("active"));
    segment.classList.add("active");
    segment.dataset.filter && (currentFilter = segment.dataset.filter);
    renderGrid();
  });
});

document.querySelector("#openCreate").addEventListener("click", () => {
  if (!currentUser) {
    alert('Sign in to create characters');
    return;
  }
  dialog.showModal();
});

document.querySelector("#openCreateTop").addEventListener("click", () => {
  if (!currentUser) {
    alert('Sign in to create characters');
    return;
  }
  dialog.showModal();
});

document.querySelector("#toggleReview").addEventListener("click", () => {
  reviewPanel.classList.toggle("open");
});

// Image upload preview
const imageInput = document.querySelector("#cardImageInput");
const imagePreview = document.querySelector("#imagePreview");

if (imageInput) {
  imageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      currentImageData = ev.target.result;
      if (imagePreview) {
        imagePreview.innerHTML = `<img src="${currentImageData}" alt="Preview" style="max-width:100%;border-radius:8px;margin-top:8px;" />`;
      }
    };
    reader.readAsDataURL(file);
  });
}

form.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  
  if (isDemo || !currentUser) {
    alert('Sign in to create characters');
    return;
  }
  
  const data = new FormData(form);
  const name = data.get("name").toString().trim();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const palette = [
    ["#a78bfa", "#10131d", "#3ad6c6"],
    ["#f3b35a", "#151923", "#f27b9b"],
    ["#8bd672", "#101818", "#6d5dfc"],
  ][characters.length % 3];

  let artUrl = null;
  
  // Upload image to Vercel Blob
  if (currentImageData) {
    try {
      const res = await fetch(currentImageData);
      const blob = await res.blob();
      const file = new File([blob], `character-${slug}.png`, { type: 'image/png' });
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', currentUser.id);
      formData.append('slug', slug);
      
      const uploadRes = await fetch('/api/blob-upload', {
        method: 'POST',
        body: formData,
      });
      
      if (uploadRes.ok) {
        const result = await uploadRes.json();
        artUrl = result.url;
      }
    } catch (e) {
      console.warn('Image upload failed:', e);
    }
  }

  const character = {
    name,
    slug,
    source: data.get("source").toString().trim(),
    creator: data.get("creator")?.toString().trim() || "Varden Studio",
    visibility: data.get("visibility").toString(),
    tagline: data.get("tagline").toString().trim(),
    greeting: data.get("greeting").toString().trim(),
    personality: data.get("personality").toString().trim(),
    tags: data.get("tags").toString().split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 5),
    art_a: palette[0],
    art_b: palette[1],
    art_c: palette[2],
    art_url: artUrl,
  };

  try {
    // Save to Supabase
    const result = await supabase.from('characters').insert({
      user_id: currentUser.id,
      ...character,
    }).select().single();
    
    if (result.error) throw result.error;
    
    // Update local state
    characters.unshift(result.data);
    selectedId = null;
    currentImageData = null;
    form.reset();
    if (imagePreview) imagePreview.innerHTML = "";
    dialog.close();
    
    // Refresh cache
    await saveToCache(currentUser.id, characters);
    renderGrid();
  } catch (e) {
    alert('Failed to save character: ' + (e.message || 'Unknown error'));
  }
});

loadCharacters();
