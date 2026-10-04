// RavenPyros Helper: Godforge reward pickers (godforge.gg/profile/rewards/select/{hero,weapon,imprint})
//
// Adds a small RavenPyros link next to each choice so you can read up on it (hero page, or the
// weapon/imprint list filtered to it) before picking. Never selects anything.
// Setting (chrome.storage.local, set from the popup): rp_reward_links.

(() => {
    const SITE = 'https://www.ravenpyros.com';
    const ICON = chrome.runtime.getURL('icon.png');
    let enabled = true;

    const toSlug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const kind = () => (location.pathname.match(/^\/profile\/rewards\/select\/(hero|weapon|imprint)/) || [])[1] || null;

    const linkFor = (k, name) => {
        if (k === 'hero') return `${SITE}/heroes/${toSlug(name)}`;
        if (k === 'weapon') return `${SITE}/godforge/weapons?s=${encodeURIComponent(name)}`;
        if (k === 'imprint') return `${SITE}/godforge/imprints?s=${encodeURIComponent(name)}`;
        return null;
    };

    function inject() {
        const k = kind();
        if (!enabled || !k) return;
        document.querySelectorAll('button[class*="__optionCard"]:not([data-rp-link])').forEach((card) => {
            card.setAttribute('data-rp-link', '1');
            const nameEl = card.querySelector('[class*="__optionName"]');
            let name = nameEl && nameEl.textContent.trim();
            // Imprints: search our list by the source hero ("From Achilles"). Some imprints were
            // renamed in Godforge after our data was taken, but every row shows its hero.
            const from = (card.querySelector('[class*="__optionSubtitle"]')?.textContent || '').match(/^From\s+(.+)$/);
            if (k === 'imprint' && from) name = from[1].trim();
            const href = name && linkFor(k, name);
            if (!href) return;
            const a = document.createElement('a');
            a.className = 'rp-reward-link';
            a.href = href;
            a.target = '_blank';
            a.rel = 'noopener';
            a.title = k === 'imprint' && from ? `${name}'s imprint on RavenPyros` : `Read about ${name} on RavenPyros`;
            a.style.cssText = 'position:absolute;top:6px;right:6px;z-index:2;width:20px;height:20px;border-radius:50%;'
                + `background:#0b1024 url(${ICON}) center/15px no-repeat;border:1px solid #ffb200;box-shadow:0 1px 3px rgba(0,0,0,.6);`;
            ['pointerdown', 'mousedown', 'click'].forEach((ev) => a.addEventListener(ev, (e) => e.stopPropagation()));
            // The choice card is a <button> (it expands on click), and a link can't live inside a
            // button, so pin the icon to the card's corner from its list item instead.
            const holder = card.parentElement;
            if (getComputedStyle(holder).position === 'static') holder.style.position = 'relative';
            holder.appendChild(a);
        });
    }

    function removeAll() {
        document.querySelectorAll('.rp-reward-link').forEach((a) => a.remove());
        document.querySelectorAll('[data-rp-link]').forEach((c) => c.removeAttribute('data-rp-link'));
    }

    chrome.storage.local.get(['rp_reward_links'], (saved) => {
        enabled = saved.rp_reward_links !== false;
        setInterval(inject, 1500);
        inject();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.rp_reward_links) return;
        enabled = changes.rp_reward_links.newValue !== false;
        if (!enabled) removeAll();
    });
})();
