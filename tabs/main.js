// Routes live in the hash: #/?q=&type=  #/artist/<id>?type=  #/tab/<id>
// Tab text comes from the dataset, so it only ever reaches the page via textContent.

const TYPES = ["Chords", "Tab"];
const SCROLL_SPEEDS = [8, 12, 18, 26, 36, 50, 70, 95]; // px per second
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const CHORD = /^([A-G])([#b]?)((?:maj|min|m|M|dim|aug|sus|add|\+|°|ø)*[0-9]*(?:(?:maj|sus|add|b|#|\+|-)?[0-9]+)*(?:\([^)\s]*\))?)(?:\/([A-G])([#b]?))?$/;
// Tokens allowed on a chord line besides chords: bars, repeats, rests.
const FILLER = /^(\||\|\||-+|\/+|\.+|%|\*|x\d+|\(x?\d+x?\)|\d+x|N\.?C\.?|\(|\))$/i;
const SECTION = /^\s*\[[^\]]+\]\s*$/;

const $ = (id) => document.getElementById(id);
const cache = new Map();

const state = {
    transpose: 0,
    speed: 2,
    scrolling: false,
    size: load("tabs.size", 14),
    tab: null,
};

function load(key, fallback) {
    try {
        const v = JSON.parse(localStorage.getItem(key));
        return v ?? fallback;
    } catch {
        return fallback;
    }
}

function save(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {}
}

async function api(path) {
    if (!cache.has(path)) {
        cache.set(path, fetch(`api/${path}`, { cache: "no-cache" }).then((r) => {
            if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
            return r.json();
        }));
    }
    try {
        return await cache.get(path);
    } catch (e) {
        cache.delete(path);
        throw e;
    }
}

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
}

function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, query = ""] = raw.split("?");
    return { parts: path.split("/").filter(Boolean), params: new URLSearchParams(query) };
}

function show(view) {
    for (const id of ["search-view", "artist-view", "tab-view"]) $(id).hidden = id !== view;
    $("tab-controls").hidden = view !== "tab-view";
    if (view !== "tab-view") stopScroll();
}

// A song row: the title opens the best tab of the filtered type (or the first
// type it has), and each type it has gets its own link.
function resultItem(song, type, withArtist = true) {
    const types = Object.keys(song.tabs);
    const open = song.tabs[type] ?? song.tabs[types[0]];
    const li = el("li", {},
        el("a", { className: "result-title", href: `#/tab/${open}`, textContent: song.title }),
        el("span", { className: "result-types label" }, ...types.map((t) =>
            el("a", { href: `#/tab/${song.tabs[t]}`, textContent: t }))));
    if (withArtist) {
        li.append(el("a", { className: "result-artist", href: `#/artist/${song.artist_id}`, textContent: song.artist }));
    }
    return li;
}

function typeParam(params) {
    const t = params.get("type");
    return TYPES.includes(t) ? t : null;
}

function typeButtons(container, active, hrefFor) {
    container.replaceChildren(...[null, ...TYPES].map((c) =>
        el("a", {
            className: "bar-btn" + (c === active ? " is-active" : ""),
            href: hrefFor(c),
            textContent: c ?? "All",
        })));
}

// Search

let searchSeq = 0;

async function renderSearch(params) {
    show("search-view");
    const q = params.get("q") ?? "";
    const type = typeParam(params);
    if ($("search").value !== q) $("search").value = q;
    document.title = q ? `${q} · Philip's Tabs` : "Philip's Tabs";
    typeButtons($("type-filter"), type, (t) => searchHash(q, t));

    const seq = ++searchSeq;
    if (!q.trim()) {
        $("search-status").textContent = "885,752 guitar tabs. Search by song or artist.";
        $("results").replaceChildren();
        return;
    }
    $("search-status").textContent = "Searching…";
    try {
        const qs = new URLSearchParams({ q, limit: 100 });
        if (type) qs.set("type", type);
        const songs = await api(`search?${qs}`);
        if (seq !== searchSeq) return;
        $("search-status").textContent = songs.length ? "" : "No matches.";
        $("results").replaceChildren(...songs.map((s) => resultItem(s, type)));
    } catch (e) {
        if (seq === searchSeq) $("search-status").textContent = `Search failed: ${e.message}`;
    }
}

function searchHash(q, type) {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (type) qs.set("type", type);
    const s = qs.toString();
    return s ? `#/?${s}` : "#/";
}

let typing;
$("search").addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
        history.replaceState(null, "", searchHash($("search").value, typeParam(parseHash().params)));
        route();
    }, 200);
});
$("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    $("search").blur();
});

// Artist

async function renderArtist(id, params) {
    show("artist-view");
    const type = typeParam(params);
    typeButtons($("artist-filter"), type, (t) => `#/artist/${id}` + (t ? `?type=${t}` : ""));
    $("artist-status").textContent = "Loading…";
    $("artist-results").replaceChildren();
    try {
        const a = await api(`artist/${id}` + (type ? `?type=${type}` : ""));
        $("artist-name").textContent = a.name;
        document.title = `${a.name} · Philip's Tabs`;
        const n = a.songs.length;
        $("artist-status").textContent = n ? `${n.toLocaleString()} song${n === 1 ? "" : "s"}` : "Nothing here.";
        $("artist-results").replaceChildren(...a.songs.map((s) => resultItem(s, type, false)));
    } catch (e) {
        $("artist-status").textContent = `Couldn't load artist: ${e.message}`;
    }
}

// Tab

async function renderTab(id) {
    show("tab-view");
    window.scrollTo(0, 0);
    let t;
    try {
        t = await api(`tab/${id}`);
    } catch (e) {
        $("tab-title").textContent = "Couldn't load this tab";
        $("tab-meta").textContent = e.message;
        $("tab-body").replaceChildren();
        return;
    }
    state.tab = t;
    state.transpose = 0;
    document.title = `${t.title} · ${t.artist} · Philip's Tabs`;
    $("tab-title").textContent = t.title;
    const artistLink = $("tab-artist").firstElementChild;
    artistLink.textContent = t.artist;
    artistLink.href = `#/artist/${t.artist_id}`;
    $("tab-meta").textContent = [
        t.tuning && t.tuning !== "Standard" ? t.tuning : null,
        t.tonality ? `Key ${t.tonality}` : null,
    ].filter(Boolean).join(" · ");

    $("tab-types").replaceChildren(...Object.entries(t.tabs).map(([type, id]) =>
        el("a", {
            className: "bar-btn" + (type === t.type ? " is-active" : ""),
            href: `#/tab/${type === t.type ? t.id : id}`,
            textContent: type,
        })));

    // Versions come best first, so the number is the rank.
    const n = t.versions.length;
    $("tab-versions-label").hidden = n < 2;
    $("tab-versions").replaceChildren(...t.versions.map((id, i) => el("option", {
        value: id,
        selected: id === t.id,
        textContent: i === 0 ? `1 of ${n} (best)` : `${i + 1} of ${n}`,
    })));
    renderBody();
}

$("tab-versions").addEventListener("change", (e) => {
    location.hash = `#/tab/${e.target.value}`;
});

function transposeNote(letter, accidental, steps, useFlats) {
    let n = NOTE_INDEX[letter] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
    n = (((n + steps) % 12) + 12) % 12;
    return (useFlats ? FLATS : SHARPS)[n];
}

function transposeChord(token, steps) {
    const m = token.match(CHORD);
    if (!m || steps === 0) return token;
    const [, root, acc, quality, bass, bassAcc] = m;
    const flats = acc === "b" || bassAcc === "b";
    let out = transposeNote(root, acc, steps, flats) + quality;
    if (bass) out += "/" + transposeNote(bass, bassAcc, steps, flats);
    return out;
}

function isChordLine(tokens) {
    let chords = 0;
    for (const { text } of tokens) {
        if (CHORD.test(text)) chords++;
        else if (!FILLER.test(text)) return false;
    }
    return chords > 0;
}

// Rebuilds a chord line with transposed chords, keeping each chord at its
// original column unless the one before it grew into that space.
function chordLine(line, steps) {
    const tokens = [...line.matchAll(/\S+/g)].map((m) => ({ text: m[0], col: m.index }));
    if (!isChordLine(tokens)) return null;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const { text, col } of tokens) {
        const isChord = CHORD.test(text);
        const out = isChord ? transposeChord(text, steps) : text;
        const at = Math.max(col, cursor === 0 ? 0 : cursor + 1);
        frag.append(" ".repeat(at - cursor));
        frag.append(isChord ? el("span", { className: "chord", textContent: out }) : out);
        cursor = at + out.length;
    }
    return frag;
}

function renderBody() {
    const t = state.tab;
    if (!t) return;
    const steps = state.transpose;
    const frag = document.createDocumentFragment();
    for (const line of t.body.split("\n")) {
        const chords = chordLine(line, steps);
        if (chords) frag.append(chords);
        else if (SECTION.test(line)) frag.append(el("span", { className: "section", textContent: line }));
        else frag.append(line);
        frag.append("\n");
    }
    $("tab-body").replaceChildren(frag);
    $("transpose-readout").textContent = `Key ${steps > 0 ? "+" : ""}${steps}`;
}

function setTranspose(delta) {
    state.transpose = Math.max(-11, Math.min(11, state.transpose + delta));
    renderBody();
}

function setSize(delta) {
    state.size = Math.max(9, Math.min(28, state.size + delta));
    document.documentElement.style.setProperty("--tab-size", `${state.size}px`);
    save("tabs.size", state.size);
}

$("transpose-down").addEventListener("click", () => setTranspose(-1));
$("transpose-up").addEventListener("click", () => setTranspose(1));
$("size-down").addEventListener("click", () => setSize(-1));
$("size-up").addEventListener("click", () => setSize(1));

// Autoscroll

let lastFrame = 0;
let carry = 0;

function scrollFrame(now) {
    if (!state.scrolling) return;
    const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
    lastFrame = now;
    carry += SCROLL_SPEEDS[state.speed] * dt;
    const px = Math.floor(carry);
    if (px > 0) {
        carry -= px;
        window.scrollBy(0, px);
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1) {
            return stopScroll();
        }
    }
    requestAnimationFrame(scrollFrame);
}

function startScroll() {
    state.scrolling = true;
    lastFrame = 0;
    carry = 0;
    $("scroll-toggle").classList.add("is-active");
    $("scroll-toggle").setAttribute("aria-pressed", "true");
    requestAnimationFrame(scrollFrame);
}

function stopScroll() {
    state.scrolling = false;
    $("scroll-toggle").classList.remove("is-active");
    $("scroll-toggle").setAttribute("aria-pressed", "false");
}

function setSpeed(delta) {
    state.speed = Math.max(0, Math.min(SCROLL_SPEEDS.length - 1, state.speed + delta));
    $("scroll-readout").textContent = String(state.speed + 1);
}

$("scroll-toggle").addEventListener("click", () => (state.scrolling ? stopScroll() : startScroll()));
$("scroll-slower").addEventListener("click", () => setSpeed(-1));
$("scroll-faster").addEventListener("click", () => setSpeed(1));

document.addEventListener("keydown", (e) => {
    if ($("tab-view").hidden || e.target.closest("input, select, textarea")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === " ") {
        e.preventDefault();
        state.scrolling ? stopScroll() : startScroll();
    } else if (e.key === "ArrowUp" && state.scrolling) {
        e.preventDefault();
        setSpeed(1);
    } else if (e.key === "ArrowDown" && state.scrolling) {
        e.preventDefault();
        setSpeed(-1);
    }
});

// Theme: system (default) → light → dark. The inline script in index.html
// applies a saved choice before first paint.

const THEMES = ["system", "light", "dark"];

function applyTheme(theme) {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    $("theme-toggle").textContent = theme[0].toUpperCase() + theme.slice(1);
    $("theme-toggle").title = `Theme: ${theme}. Click to change.`;
}

let theme = THEMES.includes(load("tabs.theme", "system")) ? load("tabs.theme", "system") : "system";
applyTheme(theme);
$("theme-toggle").addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    save("tabs.theme", theme);
    applyTheme(theme);
});

// Router

function route() {
    const { parts, params } = parseHash();
    if (parts[0] === "tab" && /^\d+$/.test(parts[1] ?? "")) return renderTab(parts[1]);
    if (parts[0] === "artist" && /^\d+$/.test(parts[1] ?? "")) return renderArtist(parts[1], params);
    renderSearch(params);
}

window.addEventListener("hashchange", route);
setSize(0);
setSpeed(0);
route();
if (!$("search-view").hidden) $("search").focus();
