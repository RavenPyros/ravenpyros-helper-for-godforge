// RavenPyros Helper: Open Duel Rooms (godforge.gg Duel a Friend)
//
// Hosting: when you create a Duel a Friend room, a small panel offers to list it on
// ravenpyros.com/godforge-duels/rooms (and our Discord), so someone can join. While listed it checks
// in with ravenpyros.com every ~20 s; when the lobby goes away (a friend joined, you left, the tab
// closed) it removes the listing, so every code on the list still works. Only the room code and your
// optional note are sent, and only after you click List.
//
// Joining: while the "Join a room" code box is on screen, the panel (bottom-left, clear of the
// duels.js button) shows the open rooms with a Copy button for each code. duels.js also shows the
// count on its button and the list in its panel on every Duels page.
//
// Read-only on godforge.gg: it reads the page and never clicks, types, creates rooms or plays.
//
// Setting (chrome.storage.local, set from the popup): rp_rooms (default on).

(() => {
    const SITE = 'https://www.ravenpyros.com';
    const API = `${SITE}/api/duels/v1/rooms`;
    const ROOMS_URL = `${SITE}/godforge-duels/rooms`;
    const ICON = chrome.runtime.getURL('icon.png');
    // Godforge's room codes: 5 characters, no I/O/0/1 (from the Duels client).
    const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

    let enabled = true;
    let code = null;        // code on screen, or null when no lobby
    let listing = null;     // { id, secret, code } once listed
    let state = 'idle';     // idle | ready | sending | listed | error
    let message = '';
    let note = '';
    let beatTimer = null;
    let host = null;

    let joinMode = false;   // the "Join a room" code box is showing
    let openRooms = null;   // last GET /rooms result, null until loaded
    let roomsError = false;
    let roomsTimer = null;
    let copied = null;      // code last copied, for the button label

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // The lobby shows <p aria-label="Room code A K F Y N">AKFYN</p> while waiting for a friend. Once
    // they join, the same page swaps it for the board (no URL change).
    function readCode() {
        if (!location.pathname.startsWith('/duels/play')) return null;
        const el = document.querySelector('[data-testid="pvp-duel-screen"] p[aria-label^="Room code"]');
        const text = (el?.textContent || '').trim().toUpperCase();
        return CODE_RE.test(text) ? text : null;
    }

    // Duel a Friend → "Join a room" shows <input aria-label="Room code" placeholder="ROOM CODE">.
    const joinScreen = () => !!document.querySelector('input[aria-label="Room code"]');

    const boardShowing = () => !!document.querySelector('[data-testid="end-turn"], [data-testid="duel-stage"]');

    // text/plain keeps these "simple" requests, so the browser sends no CORS preflight.
    function post(path, body, keepalive = false) {
        return fetch(API + path, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(body),
            credentials: 'omit',
            keepalive,
        });
    }

    // ---------- listing ----------

    async function list() {
        if (!code || state === 'sending') return;
        state = 'sending';
        render();
        try {
            const res = await post('', { code, note });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.id && data.secret) {
                if (readCode() !== code) {           // lobby went away while we were listing
                    post(`/${data.id}/close`, { secret: data.secret, reason: boardShowing() ? 'filled' : 'left' });
                    return reset();
                }
                listing = { id: data.id, secret: data.secret, code };
                state = 'listed';
                startBeats((data.heartbeat_seconds || 20) * 1000);
            } else {
                state = 'error';
                message = {
                    already_listed: 'This room is already listed.',
                    rate_limited: 'Too many rooms listed from here. Try again later.',
                    busy: 'Too many rooms are open right now. Try again in a few minutes.',
                    invalid_code: 'That room code does not look right.',
                }[data.error] || 'Could not list the room. Try again.';
            }
        } catch (e) {
            state = 'error';
            message = 'Could not reach RavenPyros. Try again.';
        }
        render();
    }

    function startBeats(ms) {
        stopBeats();
        beatTimer = setInterval(beat, ms);
    }

    function stopBeats() {
        if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
    }

    async function beat() {
        if (!listing) return;
        try {
            const res = await post(`/${listing.id}/heartbeat`, { secret: listing.secret });
            if (res.status === 410) {               // expired (e.g. the computer slept): offer to list again
                listing = null;
                stopBeats();
                state = code ? 'ready' : 'idle';
                message = code ? 'Your listing timed out. List it again?' : '';
                render();
            }
        } catch (e) { /* network blip: the next beat will do */ }
    }

    // While the page is going away (tab closed, navigated) only sendBeacon reliably gets out.
    function unlist(reason, leaving = false) {
        if (!listing) return;
        const { id, secret } = listing;
        listing = null;
        stopBeats();
        const body = JSON.stringify({ secret, reason });
        if (leaving && navigator.sendBeacon(`${API}/${id}/close`, new Blob([body], { type: 'text/plain' }))) return;
        post(`/${id}/close`, { secret, reason }, leaving).catch(() => {});
    }

    function reset() {
        listing = null;
        stopBeats();
        state = code ? 'ready' : 'idle';
        message = '';
        render();
    }

    // ---------- joining: the open rooms list ----------

    async function loadRooms() {
        if (document.hidden) return;
        try {
            const res = await fetch(API, { credentials: 'omit', cache: 'no-store' });
            if (!res.ok) throw new Error(String(res.status));
            openRooms = (await res.json()).rooms || [];
            roomsError = false;
        } catch (e) {
            roomsError = true;
        }
        if (joinMode) render();
    }

    function setJoinMode(on) {
        if (on === joinMode) return;
        joinMode = on;
        clearInterval(roomsTimer);
        roomsTimer = null;
        copied = null;
        if (on) {
            loadRooms();
            roomsTimer = setInterval(loadRooms, 10000);
        }
        render();
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
        copied = text;
        render();
    }

    const ago = (iso) => {
        const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
        return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
    };

    // ---------- watching the lobby ----------

    let checkQueued = false;
    function check() {
        if (checkQueued) return;
        checkQueued = true;
        // Let the page finish swapping the lobby for the board before deciding why it went away.
        setTimeout(() => {
            checkQueued = false;
            const now = enabled ? readCode() : null;
            setJoinMode(enabled && !now && joinScreen());
            if (now === code) return;
            if (listing && listing.code !== now) unlist(boardShowing() ? 'filled' : 'left');
            code = now;
            note = '';
            state = code ? 'ready' : 'idle';
            message = '';
            render();
        }, 400);
    }

    // ---------- panel ----------

    const CSS = `
        :host { all: initial; }
        .wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 280px; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e8e8ee;
            background: #0b1024; border: 1px solid #3a4160; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.6); }
        .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #262c45; }
        .head img { width: 20px; height: 20px; }
        .head b { color: #ffb200; flex: 1; font-size: 13px; }
        .wrap.left { right: auto; left: 16px; }
        .body { padding: 10px 12px; }
        .code { font: 700 18px/1 ui-monospace, Consolas, monospace; letter-spacing: .15em; color: #ffb200; }
        input { box-sizing: border-box; width: 100%; margin: 8px 0; padding: 6px 8px; border-radius: 6px; border: 1px solid #3a4160; background: #070b1e; color: #e8e8ee; font: inherit; }
        button { font: inherit; font-weight: 600; border-radius: 6px; padding: 6px 12px; cursor: pointer; border: 1px solid #ffb200; }
        .primary { background: #ffb200; color: #0b1024; }
        .ghost { background: none; color: #ffb200; }
        button:disabled { opacity: .6; cursor: default; }
        .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .s { font-size: 12px; color: #b7bccf; margin-top: 8px; }
        .ok { color: #5fd38a; font-weight: 600; } .bad { color: #ff6b6b; }
        a { color: #ffb200; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .rooms { max-height: 45vh; overflow: auto; margin: 8px 0; }
        .room { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid #262c45; }
        .room:first-child { border-top: 0; }
        .room .info { flex: 1; min-width: 0; font-size: 12px; color: #b7bccf; }
        .room .info b { display: block; color: #e8e8ee; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .room button { padding: 4px 10px; }
    `;

    function joinHtml() {
        const roomsLink = `<a href="${ROOMS_URL}" target="_blank" rel="noopener">All open rooms</a>`;
        if (openRooms === null) return `<div class="s">${roomsError ? 'Could not load open rooms.' : 'Loading open rooms&hellip;'}</div>`;
        if (!openRooms.length) {
            return `<div>No open rooms right now.</div>
                <div class="s">This list updates by itself. Or create a room and list it so others can join you.</div>`;
        }
        const rows = openRooms.slice(0, 10).map((r) => `<div class="room">
                <span class="code">${esc(r.code)}</span>
                <span class="info">${r.note ? `<b>${esc(r.note)}</b>` : ''}listed ${esc(ago(r.created_at))}</span>
                <button class="${copied === r.code ? 'ghost' : 'primary'}" data-act="copy" data-code="${esc(r.code)}">${copied === r.code ? 'Copied' : 'Copy'}</button>
            </div>`).join('');
        return `<div>Open rooms waiting for an opponent:</div>
            <div class="rooms">${rows}</div>
            <div class="s">${copied ? 'Paste the code into the room code box, then press Battle.' : 'Copy a code, paste it into the room code box, then press Battle.'} ${roomsLink}</div>`;
    }

    function bodyHtml() {
        const roomsLink = `<a href="${ROOMS_URL}" target="_blank" rel="noopener">open rooms</a>`;
        if (state === 'listed') {
            return `<div class="row"><span class="ok">&#10003; Listed</span><span class="code">${esc(listing.code)}</span></div>
                <div class="s">Stay on this screen until someone joins. It comes off the list by itself when they do.
                See the ${roomsLink}.</div>
                <div class="row" style="margin-top:8px"><span></span><button class="ghost" data-act="unlist">Unlist</button></div>`;
        }
        return `<div class="row"><span>List this room so someone can join?</span><span class="code">${esc(code)}</span></div>
            <input data-note maxlength="60" placeholder="Note (optional), e.g. any deck, going for trials" value="${esc(note)}">
            <div class="row"><button class="primary" data-act="list" ${state === 'sending' ? 'disabled' : ''}>${state === 'sending' ? 'Listing&hellip;' : 'List this room'}</button>${roomsLink}</div>
            ${message ? `<div class="s ${state === 'error' ? 'bad' : ''}">${esc(message)}</div>` : ''}
            <div class="s">Sends the room code and note to ravenpyros.com and our Discord. Removed when the room fills or you leave.</div>`;
    }

    function render() {
        const hosting = enabled && code && state !== 'idle';
        if (!hosting && !(enabled && joinMode)) {
            if (host) { host.remove(); host = null; }
            return;
        }
        if (!host || !document.documentElement.contains(host)) {
            host = document.createElement('div');
            host.id = 'rp-duels-rooms';
            host.attachShadow({ mode: 'open' });
            document.documentElement.appendChild(host);
            host.shadowRoot.addEventListener('click', (e) => {
                const act = e.target.closest('[data-act]')?.dataset.act;
                if (act === 'list') list();
                if (act === 'copy') copyCode(e.target.closest('[data-code]').dataset.code);
                if (act === 'unlist') { unlist('left'); state = 'ready'; message = ''; render(); }
            });
            host.shadowRoot.addEventListener('input', (e) => { if (e.target.matches('[data-note]')) note = e.target.value; });
            host.shadowRoot.addEventListener('keydown', (e) => {
                e.stopPropagation();                // keep typing out of the game's shortcuts
                if (e.key === 'Enter' && e.target.matches('[data-note]')) list();
            });
        }
        host.shadowRoot.innerHTML = `<style>${CSS}</style><div class="wrap${hosting ? '' : ' left'}">
            <div class="head"><img src="${ICON}" alt=""><b>RavenPyros &middot; Open rooms</b></div>
            <div class="body">${hosting ? bodyHtml() : joinHtml()}</div></div>`;
    }

    // ---------- start ----------

    chrome.storage.local.get(['rp_rooms'], (s) => {
        enabled = s.rp_rooms !== false;
        new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        check();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.rp_rooms) return;
        enabled = changes.rp_rooms.newValue !== false;
        if (!enabled) unlist('left');
        code = null;
        state = 'idle';
        message = '';
        render();
        check();
    });

    // Tab closing or navigating away: take the room off the list now rather than waiting for it to time out.
    window.addEventListener('pagehide', () => unlist('left', true));
})();
