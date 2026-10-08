// RavenPyros Helper: Godforge Duels (godforge.gg/duels)
//
// - Reward panel: free hero / weapon / imprint progress with deadline maths, today's quests, and
//   anything waiting to be claimed. Read-only: it reads the same /api/duels/bootstrap the game
//   loads, only while a Duels page is open, and never clicks or plays anything.
// - Open duel rooms: the button shows how many Duel a Friend rooms are listed on ravenpyros.com, and
//   the panel lists them with a Copy button, so you can tell whether to join or host before you pick.
//   Checks every 30 s while a Duels tab is visible (10 s while the panel is open); those requests
//   send nothing about you. Listing your own room is rooms.js.
//
// Settings (chrome.storage.local, set from the popup): rp_duels_panel, rp_rooms.

(() => {
    const SITE = 'https://www.ravenpyros.com';
    // Fateless: Duels stops on 20 November 2026. Time of day not announced, so treat
    // 00:00 UTC as the end: the last full day you can log in is 19 November.
    const END_DAY = Date.UTC(2026, 10, 20) / 86400000;
    const ICON = chrome.runtime.getURL('icon.png');

    // Rough per-game rates measured on our test account (see ravenpyros.com/godforge-duels).
    const WEAPON_USES_PER_GAME = 7;
    const IMPRINTS_PER_GAME = 8;

    // The panel starts minimised to a button (red dot when something needs doing), so it never
    // covers the game until you open it.
    const settings = { rp_duels_panel: true, rp_duels_panel_open: false, rp_rooms: true };
    const ROOMS_API = `${SITE}/api/duels/v1/rooms`;
    let rooms = null;         // open rooms (when the panel has loaded the list)
    let roomCount = null;     // number of open rooms, null until known
    let roomsFetched = 0;
    let copiedCode = null;
    let data = null;          // last bootstrap response
    let picked = {};          // kind -> true/false from /profile/rewards; missing = unknown
    let loadError = null;     // 'login' | 'network' | null
    let lastFetch = 0;
    let lastPath = '';
    let host = null;

    const isDuels = () => location.pathname.startsWith('/duels');
    const inMatch = () => location.pathname.startsWith('/duels/play');
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dayIndexNow = () => Math.floor(Date.now() / 86400000);
    const dateOfDay = (day) => new Date(day * 86400000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

    // ---------- data ----------

    async function refresh(force = false) {
        if (!isDuels() || inMatch() || document.hidden) return;
        if (!force && Date.now() - lastFetch < 120000) return;
        lastFetch = Date.now();
        try {
            const res = await fetch('/api/duels/bootstrap', { credentials: 'include' });
            if (res.status === 401 || res.status === 403) { loadError = 'login'; data = null; render(); return; }
            if (!res.ok) throw new Error(String(res.status));
            data = await res.json();
            loadError = null;
            report();
            await refreshPicks();
        } catch (e) {
            loadError = data ? null : 'network';
        }
        render();
    }

    // The bootstrap's mainGameRewards[].claimed stays false after you pick on the website, so it
    // can't tell "earned, not picked" from "picked". The Pre-launch vault page can: each tile links
    // to /profile/rewards/select/<kind> and reads "Not selected" until you choose. Only fetched
    // while a pick could be waiting.
    async function refreshPicks() {
        const kinds = rewards().filter((r) => r.ach?.done && r.ach.claimed && pick(r.key)).map((r) => r.kind);
        if (!kinds.length) return;
        try {
            const res = await fetch('/profile/rewards', { credentials: 'include' });
            if (!res.ok) return;
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            kinds.forEach((kind) => {
                let tile = doc.querySelector(`a[href^="/profile/rewards/select/${kind}"]`);
                // Walk up from the Select/Change link to the tile, the first box that has the label.
                while (tile && !tile.textContent.toLowerCase().includes(kind)) tile = tile.parentElement;
                if (tile) picked[kind] = !/not selected/i.test(tile.textContent);
            });
        } catch (e) { /* keep the last answer */ }
    }

    const achievement = (name) => (data?.achievements || []).find((a) => a.name === name) || null;
    const pick = (key) => (data?.profile?.mainGameRewards || []).find((r) => r.key === key) || null;

    function rewards() {
        return [
            { label: 'Legendary hero', ach: achievement("Can't Stay Away"), key: 'legendary_choice', kind: 'hero' },
            { label: 'Weapon', ach: achievement('Weapon Master'), key: 'weapon_choice', kind: 'weapon' },
            { label: 'Imprint', ach: achievement('Imprint Master'), key: 'imprint_choice', kind: 'imprint' },
        ];
    }

    function unclaimed() {
        if (!data) return [];
        const out = [];
        const quests = (data.quests?.quests || []).filter((q) => q.done && !q.claimed).length;
        if (quests) out.push([`${quests} daily quest${quests > 1 ? 's' : ''}`, '/duels/daily']);
        const ach = (data.achievements || []).filter((a) => a.done && !a.claimed).length;
        if (ach) out.push([`${ach} achievement${ach > 1 ? 's' : ''}`, '/duels/achievements']);
        const trials = (data.trials?.pendingClaims || []).length;
        if (trials) out.push([`${trials} trial reward${trials > 1 ? 's' : ''}`, '/duels/journey']);
        const points = data.starRoad?.points || 0;
        const road = (data.starRoad?.milestones || []).filter((m) => !m.claimed && points >= m.at).length;
        if (road) out.push([`${road} Star Road reward${road > 1 ? 's' : ''}`, '/duels/achievements']);
        const packs = data.wallet?.packs || 0;
        if (packs) out.push([`${packs} pack${packs > 1 ? 's' : ''} to open`, '/duels/packs']);
        return out;
    }

    // Tell the background worker we've seen Duels today, so the daily reminder can stand down.
    function report() {
        const hero = achievement("Can't Stay Away");
        try {
            chrome.runtime.sendMessage({
                type: 'DUELS_SEEN',
                day: data.serverDayIndex ?? dayIndexNow(),
                hero: hero ? { progress: hero.progress, target: hero.target, done: !!hero.done } : null,
            });
        } catch (e) { /* extension reloaded; ignore */ }
    }

    // ---------- reward status lines ----------

    function statusLine(r) {
        const a = r.ach;
        if (!a) return '';
        const p = pick(r.key);
        if (a.done && !a.claimed) return `<a href="/duels/achievements" class="go">Done! Claim it in Achievements &rsaquo;</a>`;
        if (a.done && p && picked[r.kind] === false) return `<a href="/profile/rewards" class="go">Choose your ${esc(r.kind)} on your profile &rsaquo;</a>`;
        if (a.done) return `<span class="ok">Done &#10003;</span>`;

        const left = a.target - a.progress;
        if (r.kind === 'hero') {
            const today = data.serverDayIndex ?? dayIndexNow();
            const daysLeft = END_DAY - today; // includes today
            if (daysLeft <= 0) return `<span class="bad">Duels has ended</span>`;
            if (left > daysLeft) return `<span class="bad">Not enough days left: ${left} more needed, ${daysLeft} left</span>`;
            const spare = daysLeft - left;
            return spare === 0
                ? `<span class="warn">Log in every day until ${dateOfDay(END_DAY - 1)}, no days to spare</span>`
                : `${left} more day${left > 1 ? 's' : ''} &middot; you can miss ${spare} day${spare > 1 ? 's' : ''}`;
        }
        const perGame = r.kind === 'weapon' ? WEAPON_USES_PER_GAME : IMPRINTS_PER_GAME;
        const games = Math.max(1, Math.ceil(left / perGame));
        const tip = r.kind === 'imprint'
            ? `<a href="${SITE}/godforge-duels/decks#deck-imprint-farm" target="_blank" rel="noopener">imprint deck</a>`
            : `<a href="${SITE}/godforge-duels#duels-reward-1" target="_blank" rel="noopener">tips</a>`;
        return `${left} to go &middot; about ${games} game${games > 1 ? 's' : ''} &middot; ${tip}`;
    }

    // ---------- open duel rooms ----------

    // Panel open: the full list every 10 s. Closed: just the count for the button, every 30 s.
    async function loadRooms(force = false) {
        if (!settings.rp_rooms || !settings.rp_duels_panel || !isDuels() || inMatch() || document.hidden) return;
        const wait = settings.rp_duels_panel_open ? 10000 : 30000;
        if (!force && Date.now() - roomsFetched < wait - 500) return;
        roomsFetched = Date.now();
        try {
            const res = await fetch(settings.rp_duels_panel_open ? ROOMS_API : `${ROOMS_API}/count`, { credentials: 'omit', cache: 'no-store' });
            if (!res.ok) return;
            const body = await res.json();
            if (Array.isArray(body.rooms)) { rooms = body.rooms; roomCount = body.rooms.length; } else { roomCount = body.open | 0; }
            render();
        } catch (e) { /* keep the last answer */ }
    }

    const ago = (iso) => {
        const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
        return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
    };

    function roomsHtml() {
        if (!settings.rp_rooms) return '';
        const all = `<a href="${SITE}/godforge-duels/rooms" target="_blank" rel="noopener">All open rooms</a>`;
        if (rooms === null) return `<div class="sec"><div class="t"><span>Open duel rooms</span></div><div class="muted">Loading&hellip;</div></div>`;
        if (!rooms.length) {
            return `<div class="sec"><div class="t"><span>Open duel rooms</span><span>0</span></div>
                <div class="s">No one is waiting right now. Host one: <b>Duel a Friend &rsaquo; Create a room</b>, then click <b>List this room</b> so others can find you.</div></div>`;
        }
        const rows = rooms.slice(0, 6).map((r) => `<div class="room">
                <span class="code">${esc(r.code)}</span>
                <span class="info">${r.note ? `<b>${esc(r.note)}</b>` : ''}${esc(ago(r.created_at))}</span>
                <button class="${copiedCode === r.code ? 'ghost' : 'primary'}" data-act="copy" data-code="${esc(r.code)}">${copiedCode === r.code ? 'Copied' : 'Copy'}</button>
            </div>`).join('');
        return `<div class="sec"><div class="t"><span>Open duel rooms</span><span>${rooms.length}</span></div>${rows}
            <div class="s" style="margin-top:6px">Copy a code, then <b>Duel a Friend &rsaquo; Join a room</b> and paste it. ${rooms.length > 6 ? all : ''}</div></div>`;
    }

    async function copyCode(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {                               // clipboard API refused (focus): old-style copy
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0';
            host.shadowRoot.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        copiedCode = text;
        render();
    }

    // ---------- panel ----------

    const CSS = `
        :host { all: initial; }
        .wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e8e8ee; }
        .fab { width: 44px; height: 44px; border-radius: 50%; border: 2px solid #ffb200; background: #0b1024 url(${ICON}) center/30px no-repeat; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.5); position: relative; padding: 0; }
        .fab .dot { position: absolute; top: -2px; right: -2px; width: 12px; height: 12px; border-radius: 50%; background: #e23d3d; border: 2px solid #0b1024; }
        .panel { width: 300px; max-height: 70vh; overflow: auto; background: #0b1024; border: 1px solid #3a4160; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.6); }
        .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #262c45; }
        .head img { width: 20px; height: 20px; }
        .head b { color: #ffb200; flex: 1; font-size: 13px; }
        .head .x { background: none; border: 0; color: #9aa0b8; cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; }
        .sec { padding: 10px 12px; border-bottom: 1px solid #262c45; }
        .sec:last-child { border-bottom: 0; }
        .t { text-transform: uppercase; font-size: 10px; letter-spacing: .06em; color: #9aa0b8; font-weight: 700; margin-bottom: 6px; display: flex; justify-content: space-between; }
        .row { margin-bottom: 8px; }
        .row:last-child { margin-bottom: 0; }
        .top { display: flex; justify-content: space-between; font-weight: 600; }
        .bar { height: 5px; background: #262c45; border-radius: 3px; margin: 4px 0 3px; overflow: hidden; }
        .bar > i { display: block; height: 100%; background: #ffb200; }
        .s { font-size: 12px; color: #b7bccf; }
        a { color: #ffb200; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .ok { color: #5fd38a; } .warn { color: #ffb200; } .bad { color: #ff6b6b; }
        .go { font-weight: 600; }
        ul { margin: 0; padding-left: 16px; }
        li { margin: 2px 0; }
        .foot { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; }
        .muted { color: #9aa0b8; font-size: 12px; }
        .fab .count { position: absolute; bottom: -4px; right: -6px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
            border-radius: 9px; background: #ffb200; color: #0b1024; font: 700 11px/14px system-ui, sans-serif; text-align: center; border: 2px solid #0b1024; }
        .room { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-top: 1px solid #262c45; }
        .room:first-of-type { border-top: 0; }
        .room .code { font: 700 15px/1 ui-monospace, Consolas, monospace; letter-spacing: .12em; color: #ffb200; }
        .room .info { flex: 1; min-width: 0; font-size: 12px; color: #b7bccf; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .room .info b { color: #e8e8ee; font-weight: 600; margin-right: 4px; }
        .room button { font: inherit; font-size: 12px; font-weight: 600; border-radius: 6px; padding: 3px 9px; cursor: pointer; border: 1px solid #ffb200; }
        .room .primary { background: #ffb200; color: #0b1024; }
        .room .ghost { background: none; color: #ffb200; }
    `;

    function ensureHost() {
        if (host && document.documentElement.contains(host)) return host;
        host = document.createElement('div');
        host.id = 'rp-duels-helper';
        host.attachShadow({ mode: 'open' });
        document.documentElement.appendChild(host);
        host.shadowRoot.addEventListener('click', (e) => {
            const t = e.target.closest('[data-act]');
            if (!t) return;
            if (t.dataset.act === 'copy') { copyCode(t.dataset.code); return; }
            const open = t.dataset.act === 'open';
            settings.rp_duels_panel_open = open;
            chrome.storage.local.set({ rp_duels_panel_open: open });
            render();
            if (open) { refresh(true); loadRooms(true); }
        });
        return host;
    }

    function removeHost() {
        if (host) { host.remove(); host = null; }
    }

    function panelHtml() {
        if (loadError === 'login') return `${roomsHtml()}<div class="sec muted">Log in to Godforge to see your Duels progress.</div>`;
        if (!data) return `${roomsHtml()}<div class="sec muted">${loadError ? 'Could not load your Duels progress.' : 'Loading&hellip;'}</div>`;

        const today = data.serverDayIndex ?? dayIndexNow();
        const daysLeft = Math.max(0, END_DAY - today);
        const rows = rewards().filter((r) => r.ach).map((r) => {
            const pct = Math.min(100, Math.round((r.ach.progress / r.ach.target) * 100));
            return `<div class="row"><div class="top"><span>${esc(r.label)}</span><span>${r.ach.progress}/${r.ach.target}</span></div>
                <div class="bar"><i style="width:${pct}%"></i></div><div class="s">${statusLine(r)}</div></div>`;
        }).join('');

        const quests = data.quests?.quests || [];
        const qDone = quests.filter((q) => q.done).length;
        const resetH = 24 - new Date().getUTCHours();
        const questList = quests.map((q) => `<li class="${q.done ? 'ok' : ''}">${esc(q.text)} ${q.done ? '&#10003;' : `(${q.progress}/${q.target})`}</li>`).join('');

        const todo = unclaimed();
        const todoHtml = todo.length
            ? `<ul>${todo.map(([label, href]) => `<li><a href="${href}">${esc(label)}</a></li>`).join('')}</ul>`
            : `<div class="muted">Nothing waiting. &#10003;</div>`;

        return `${roomsHtml()}
            <div class="sec"><div class="t"><span>Free Godforge rewards</span><span>${daysLeft} day${daysLeft === 1 ? '' : 's'} left</span></div>${rows}</div>
            <div class="sec"><div class="t"><span>Today's quests ${qDone}/${quests.length}</span><span>reset in ${resetH}h</span></div><ul>${questList}</ul></div>
            <div class="sec"><div class="t"><span>Waiting to be claimed</span></div>${todoHtml}</div>
            <div class="sec foot">
                <a href="${SITE}/godforge-duels" target="_blank" rel="noopener">Guide</a>
                <a href="${SITE}/godforge-duels/decks" target="_blank" rel="noopener">Which deck?</a>
                <a href="${SITE}/godforge-duels/cards" target="_blank" rel="noopener">Card database</a>
            </div>`;
    }

    function render() {
        if (!settings.rp_duels_panel || !isDuels() || inMatch()) { removeHost(); return; }
        const root = ensureHost().shadowRoot;
        const pickWaiting = rewards().some((r) => r.ach?.done && (!r.ach.claimed || (pick(r.key) && picked[r.kind] === false)));
        const attention = data && (unclaimed().length > 0 || pickWaiting);
        root.innerHTML = `<style>${CSS}</style><div class="wrap">${settings.rp_duels_panel_open
            ? `<div class="panel"><div class="head"><img src="${ICON}" alt=""><b>RavenPyros &middot; Duels</b><button class="x" data-act="close" title="Minimise">&#8211;</button></div>${panelHtml()}</div>`
            : `<button class="fab" data-act="open" title="${esc(fabTitle())}">${attention ? '<span class="dot"></span>' : ''}${settings.rp_rooms && roomCount ? `<span class="count">${roomCount > 99 ? '99+' : roomCount}</span>` : ''}</button>`}</div>`;
    }

    function fabTitle() {
        if (!settings.rp_rooms || roomCount === null) return 'RavenPyros Duels helper';
        return roomCount ? `RavenPyros Duels helper: ${roomCount} open duel room${roomCount === 1 ? '' : 's'}` : 'RavenPyros Duels helper: no open duel rooms right now';
    }

    // ---------- loop ----------

    function tick() {
        if (location.pathname !== lastPath) {
            lastPath = location.pathname;
            render();
            refresh(true);
            loadRooms(true);
        }
    }

    chrome.storage.local.get(Object.keys(settings), (saved) => {
        Object.keys(settings).forEach((k) => { if (saved[k] !== undefined) settings[k] = saved[k]; });
        tick();
        setInterval(tick, 1500);
        setInterval(() => refresh(), 30000);
        setInterval(() => loadRooms(), 10000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); loadRooms(true); } });
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        let touched = false;
        Object.keys(settings).forEach((k) => { if (changes[k]) { settings[k] = !!changes[k].newValue; touched = true; } });
        if (!touched) return;
        if (changes.rp_rooms && !settings.rp_rooms) { rooms = null; roomCount = null; }
        render();
        if (settings.rp_duels_panel) { refresh(true); loadRooms(true); }
    });
})();
