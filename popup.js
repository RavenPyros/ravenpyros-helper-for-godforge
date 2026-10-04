document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('version').textContent = `RavenPyros Helper for Godforge v${chrome.runtime.getManifest().version}`;

    // Duels on/off settings: default on.
    const toggles = document.querySelectorAll('input[data-key]');
    chrome.storage.local.get([...toggles].map((t) => t.dataset.key), (saved) => {
        toggles.forEach((t) => { t.checked = saved[t.dataset.key] !== false; });
    });
    toggles.forEach((t) => t.addEventListener('change', () => chrome.storage.local.set({ [t.dataset.key]: t.checked })));

    // Reminder hour (local time)
    const hour = document.getElementById('reminder-hour');
    for (let h = 0; h < 24; h++) {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
        hour.appendChild(opt);
    }
    chrome.storage.local.get(['rp_reminder_hour'], (s) => { hour.value = s.rp_reminder_hour ?? 18; });
    hour.addEventListener('change', () => chrome.storage.local.set({ rp_reminder_hour: Number(hour.value) }));

    // Notifications need an optional permission, asked for only when switched on.
    const notify = document.getElementById('notify-toggle');
    chrome.storage.local.get(['rp_notify'], async (s) => {
        notify.checked = !!s.rp_notify && await chrome.permissions.contains({ permissions: ['notifications'] });
    });
    notify.addEventListener('change', async () => {
        if (notify.checked) {
            const granted = await chrome.permissions.request({ permissions: ['notifications'] });
            notify.checked = granted;
            chrome.storage.local.set({ rp_notify: granted });
        } else {
            chrome.storage.local.set({ rp_notify: false });
        }
    });

    // Duels progress summary, from the last time Duels was open.
    chrome.storage.local.get(['rp_duels_seen_day', 'rp_duels_hero'], (s) => {
        const hero = s.rp_duels_hero;
        if (s.rp_duels_seen_day === undefined || !hero) return;
        const today = Math.floor(Date.now() / 86400000);
        const seen = s.rp_duels_seen_day >= today ? '<b>Today counted</b> &#10003;' : 'Not opened Duels today yet';
        // Duels days run on UTC, so a new login day starts at UTC midnight, not local midnight.
        const nextDay = new Date((today + 1) * 86400000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        document.getElementById('duels-status').innerHTML = hero.done
            ? 'Free hero: <b>login days done</b> &#10003;'
            : `Free hero: <b>${hero.progress}/${hero.target}</b> login days<br>${seen}<br><span style="color:#888">Next day starts at ${nextDay} your time</span>`;
    });
});
