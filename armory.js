// RavenPyros Helper: deck import for the Godforge Duels Armory (unofficial)
//
// "Send to Godforge" on a RavenPyros deck page opens godforge.gg/duels/builder#rp-deck=<code>. Here
// that shows a panel with the deck next to the Armory: which of its cards you own and which you are
// missing. Only if you own every card does it offer "Save to my Armory", and only after you confirm
// does it send one request, the same one the Armory's own Save button sends (POST /api/duels/decks),
// always as a new deck. It never changes or deletes your other decks.
//
// What it reads on godforge.gg, only while the panel is open: your card collection and your saved
// decks (GET /api/duels/collection, /api/duels/decks). Nothing from Godforge is sent to RavenPyros;
// the only RavenPyros request is fetching the public deck by its code. It never asks for a login.
//
// Setting (chrome.storage.local, set from the popup): rp_armory (default on).

(() => {
    const SITE = 'https://www.ravenpyros.com';
    const DECK_API = `${SITE}/api/duels/v1/decks/`;
    const ICON = chrome.runtime.getURL('icon.png');
    const CODE_RE = /^[a-z0-9]{6,10}$/;
    const NAME_MAX = 24;      // the Armory caps deck names at 24 characters
    const DECK_LIMIT = 30;    // saved decks per player
    const DECK_SIZE = 30;
    const STASH = 'rp_armory_deck';   // sessionStorage: survives Godforge's log-in redirect in this tab

    let enabled = true;
    let code = null;
    let state = 'idle';       // idle | loading | ready | confirm | saving | saved | error
    let message = '';
    let deck = null;          // RavenPyros deck
    let check = null;         // { rows, owned, missing, full, dup, nameTooLong }
    let name = '';
    let host = null;

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // The Armory's card key: its cardKey(name) ("Destiny's Blessing" -> destiny_s_blessing).
    const cardKey = (n) => String(n).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    const onArmory = () => location.pathname.replace(/\/+$/, '') === '/duels/builder';

    // #rp-deck=<code> on any godforge.gg page (the log-in page keeps it through the redirect); kept
    // for this tab for 30 minutes so it is still there after logging in.
    function readCode() {
        const m = /(?:^#|&)rp-deck=([a-z0-9]{6,10})(?:&|$)/.exec(location.hash);
        if (m) {
            try { sessionStorage.setItem(STASH, JSON.stringify({ code: m[1], at: Date.now() })); } catch (e) { /* private mode */ }
            return m[1];
        }
        try {
            const s = JSON.parse(sessionStorage.getItem(STASH) || 'null');
            if (s && CODE_RE.test(s.code) && Date.now() - s.at < 30 * 60 * 1000) return s.code;
        } catch (e) { /* ignore */ }
        return null;
    }

    function forget() {
        try { sessionStorage.removeItem(STASH); } catch (e) { /* ignore */ }
        if (/rp-deck=/.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search);
    }

    // Same-origin read on godforge.gg, as the Armory does it. null = not logged in.
    async function gfGet(path) {
        const res = await fetch('/api/duels' + path, { credentials: 'same-origin', cache: 'no-store' });
        if (res.status === 401) return null;
        if (!res.ok) throw new Error(`godforge ${res.status}`);
        return res.json();
    }

    // ---------- load + compare ----------

    async function load() {
        state = 'loading';
        message = '';
        render();
        try {
            const res = await fetch(DECK_API + encodeURIComponent(code), { credentials: 'omit', cache: 'no-store' });
            if (res.status === 404) return fail('That deck is not on RavenPyros any more.');
            if (!res.ok) return fail('Could not load the deck from RavenPyros. Try again in a minute.');
            deck = await res.json();
            if (!deck || !deck.valid || !deck.general || !deck.weapon || !Array.isArray(deck.cards)) {
                return fail('This deck no longer adds up (cards changed since it was built). Open it on RavenPyros to fix it.');
            }

            const [collection, saved] = await Promise.all([gfGet('/collection'), gfGet('/decks')]);
            if (collection === null || saved === null) return fail('Log in to Godforge, then click Send to Godforge on RavenPyros again.', 'login');
            // Stop if the Armory's data looks different from what this was built against.
            if (!collection || typeof collection.cards !== 'object' || !Array.isArray(saved)
                || saved.some((d) => !d || !Array.isArray(d.cards) || typeof d.general !== 'string')) {
                return fail('Godforge has changed how the Armory works, so this is switched off until the extension is updated.');
            }

            const rows = deck.cards.map((c) => {
                const have = Math.max(0, collection.cards[cardKey(c.name)] | 0);
                return { name: c.name, cost: c.cost, need: c.count | 0, have, key: cardKey(c.name) };
            });
            const total = rows.reduce((n, r) => n + r.need, 0);
            const owned = rows.reduce((n, r) => n + Math.min(r.need, r.have), 0);
            const list = rows.flatMap((r) => Array(r.need).fill(r.key));
            const sig = (g, w, cards) => `${g}|${w}|${[...cards].sort().join(',')}`;
            const mine = sig(deck.general, deck.weapon, list);
            const dup = saved.find((d) => sig(d.general, d.weapon, d.cards) === mine) || null;
            check = { rows, total, owned, list, dup, full: saved.length >= DECK_LIMIT, count: saved.length, nameTooLong: deck.name.length > NAME_MAX };
            if (total !== DECK_SIZE) return fail('This deck does not have 30 cards. Open it on RavenPyros to fix it.');
            name = deck.name.slice(0, NAME_MAX).trim();
            state = 'ready';
            render();
        } catch (e) {
            fail('Could not read your Armory. Reload the page and try again.');
        }
    }

    function fail(text) {
        state = 'error';
        message = text;
        render();
    }

    // ---------- save (one request, only after the player confirms) ----------

    async function save() {
        if (state !== 'confirm' || !check || check.owned !== check.total || check.full || check.dup) return;
        state = 'saving';
        render();
        let res = null, body = null;
        try {
            res = await fetch('/api/duels/decks', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ deckId: crypto.randomUUID(), name, general: deck.general, weapon: deck.weapon, cards: check.list }),
            });
            body = await res.json().catch(() => null);
        } catch (e) {
            // Unknown whether it saved: don't offer to send it again, have them check the Armory.
            state = 'error';
            message = 'The connection dropped while saving. Reload the Armory to see whether the deck was saved before trying again.';
            return render();
        }
        if (res.ok) {
            state = 'saved';
            forget();
            return render();
        }
        const err = (body && body.error) || {};
        state = 'error';
        message = res.status === 401 ? 'Log in to Godforge, then try again.'
            : `Godforge did not save the deck: ${err.message || err.code || `error ${res.status}`}`;
        render();
    }

    // ---------- panel ----------

    const CSS = `
        :host { all: initial; }
        .wrap { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; width: 300px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
            font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e8e8ee;
            background: #0b1024; border: 1px solid #3a4160; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.6); }
        .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #262c45; }
        .head img { width: 20px; height: 20px; }
        .head b { color: #ffb200; flex: 1; font-size: 13px; }
        .head small { display: block; color: #9aa0b8; font-weight: 400; font-size: 11px; }
        .x { background: none; border: 0; color: #9aa0b8; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
        .body { padding: 10px 12px; overflow: auto; }
        .title { font-weight: 700; font-size: 14px; }
        .sub { color: #b7bccf; font-size: 12px; }
        .bar { height: 6px; background: #262c45; border-radius: 3px; overflow: hidden; margin: 8px 0 4px; }
        .bar span { display: block; height: 100%; background: #5fd38a; }
        .bar.part span { background: #ffb200; }
        ul { list-style: none; margin: 6px 0; padding: 0; max-height: 30vh; overflow: auto; }
        li { display: flex; gap: 6px; padding: 2px 0; font-size: 12px; }
        li .c { min-width: 16px; color: #9aa0b8; text-align: right; }
        li .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        li .m { color: #ff6b6b; white-space: nowrap; }
        input { box-sizing: border-box; width: 100%; margin: 4px 0 2px; padding: 6px 8px; border-radius: 6px; border: 1px solid #3a4160; background: #070b1e; color: #e8e8ee; font: inherit; }
        label { display: block; margin-top: 8px; font-size: 12px; color: #b7bccf; }
        button.b { font: inherit; font-weight: 600; border-radius: 6px; padding: 6px 12px; cursor: pointer; border: 1px solid #ffb200; }
        .primary { background: #ffb200; color: #0b1024; }
        .ghost { background: none; color: #ffb200; }
        button:disabled { opacity: .6; cursor: default; }
        .row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
        .s { font-size: 12px; color: #b7bccf; margin-top: 8px; }
        .ok { color: #5fd38a; font-weight: 600; } .bad { color: #ff6b6b; } .warn { color: #ffb200; }
        a { color: #ffb200; text-decoration: none; }
        a:hover { text-decoration: underline; }
    `;

    function bodyHtml() {
        const deckLink = deck && deck.url ? `<a href="${esc(deck.url)}" target="_blank" rel="noopener">Open on RavenPyros</a>` : '';
        if (state === 'loading') return `<div class="s">Checking the deck against your collection&hellip;</div>`;
        if (state === 'error') return `<div class="bad">${esc(message)}</div>${deckLink ? `<div class="s">${deckLink}</div>` : ''}`;
        if (!deck || !check) return '';

        const head = `<div class="title">${esc(deck.name)}</div>
            <div class="sub">${esc(deck.general)} &middot; ${esc(deck.weapon)}${deck.author ? ` &middot; by ${esc(deck.author)}` : ''}</div>`;
        if (state === 'saved') {
            return `${head}<div class="s ok">Saved to your Armory as &ldquo;${esc(name)}&rdquo;.</div>
                <div class="row"><button class="b primary" data-act="reload">Reload the Armory</button></div>`;
        }

        const missing = check.rows.filter((r) => r.have < r.need);
        const pct = Math.round((check.owned / check.total) * 100);
        let out = `${head}
            <div class="bar${missing.length ? ' part' : ''}"><span style="width:${pct}%"></span></div>
            <div class="${missing.length ? '' : 'ok'}">You own ${check.owned}/${check.total} cards${missing.length ? '' : ' &#10003;'}</div>`;
        if (missing.length) {
            out += `<div class="s">Missing:</div><ul>${missing.map((r) => `<li><span class="c">${esc(r.cost)}</span><span class="n">${esc(r.name)}</span>
                <span class="m">${r.have ? `have ${r.have}/${r.need}` : `need ${r.need}`}</span></li>`).join('')}</ul>
                <div class="s">Open packs or swap these for cards you own. Saving unlocks once you own every card.</div>`;
        } else if (check.dup) {
            out += `<div class="s warn">You already have this deck in your Armory: &ldquo;${esc(check.dup.name)}&rdquo;.</div>`;
        } else if (check.full) {
            out += `<div class="s warn">Your Armory is full (${check.count}/${DECK_LIMIT} decks). Delete one in the Armory first.</div>`;
        } else if (state === 'confirm' || state === 'saving') {
            out += `<div class="s">Save a <b>new</b> deck called &ldquo;${esc(name)}&rdquo;? Your other decks stay as they are.</div>
                <div class="row"><button class="b primary" data-act="save" ${state === 'saving' ? 'disabled' : ''}>${state === 'saving' ? 'Saving&hellip;' : 'Yes, save it'}</button>
                <button class="b ghost" data-act="back" ${state === 'saving' ? 'disabled' : ''}>Cancel</button></div>`;
        } else {
            out += `<label>Deck name in Godforge<input data-name maxlength="${NAME_MAX}" value="${esc(name)}"></label>
                ${check.nameTooLong ? `<div class="s warn">Godforge names are 24 characters at most, so it was shortened.</div>` : ''}
                <div class="row"><button class="b primary" data-act="confirm" ${name.trim() ? '' : 'disabled'}>Save to my Armory</button></div>
                <div class="s">Adds it as a new deck (${check.count}/${DECK_LIMIT} used).</div>`;
        }
        return out + `<div class="s">${deckLink}</div>`;
    }

    function render() {
        if (!enabled || !code || !onArmory() || state === 'idle') {
            if (host) { host.remove(); host = null; }
            return;
        }
        if (!host) {
            host = document.createElement('div');
            host.id = 'rp-armory-import';
            host.attachShadow({ mode: 'open' });
            host.shadowRoot.addEventListener('click', onClick);
            host.shadowRoot.addEventListener('input', (e) => {
                if (e.target.matches('[data-name]')) {
                    name = e.target.value.slice(0, NAME_MAX);
                    const btn = host.shadowRoot.querySelector('[data-act="confirm"]');
                    if (btn) btn.disabled = !name.trim();
                }
            });
            document.body.appendChild(host);
        }
        host.shadowRoot.innerHTML = `<style>${CSS}</style><div class="wrap">
            <div class="head"><img src="${ICON}" alt=""><b>Deck from RavenPyros<small>Unofficial &middot; not made by Godforge</small></b>
            <button class="x" data-act="close" title="Close" aria-label="Close">&times;</button></div>
            <div class="body">${bodyHtml()}</div></div>`;
    }

    function onClick(e) {
        const t = e.target.closest('[data-act]');
        if (!t) return;
        const act = t.dataset.act;
        if (act === 'close') {
            forget();
            code = null;
            state = 'idle';
            render();
        } else if (act === 'confirm') {
            name = name.trim().slice(0, NAME_MAX);
            if (name) { state = 'confirm'; render(); }
        } else if (act === 'back') {
            state = 'ready';
            render();
        } else if (act === 'save') {
            save();
        } else if (act === 'reload') {
            location.reload();
        }
    }

    // ---------- lifecycle ----------

    function update() {
        const next = readCode();
        if (!onArmory()) {
            if (host) { host.remove(); host = null; }
            return;
        }
        if (!enabled || !next) return render();
        if (next !== code) {
            code = next;
            deck = null;
            check = null;
            load();
        } else {
            render();
        }
    }

    chrome.storage.local.get(['rp_armory'], (s) => {
        enabled = s.rp_armory !== false;
        update();
        window.addEventListener('hashchange', update);
        let lastPath = location.pathname;
        setInterval(() => {                       // Godforge is a single-page app: watch for route changes
            if (location.pathname !== lastPath) { lastPath = location.pathname; update(); }
        }, 1000);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.rp_armory) return;
        enabled = changes.rp_armory.newValue !== false;
        if (!enabled) { code = null; state = 'idle'; }
        update();
    });
})();
