// RavenPyros Helper: background worker - the Godforge Duels daily login reminder.
//
// The free Legendary hero needs 14 different login days. duels.js reports each day you open
// Duels (DUELS_SEEN). If a day passes the reminder hour without that, the toolbar icon gets a
// red "!" and, if you allowed notifications in the popup, one notification that day.
// This never contacts godforge.gg itself: logging in stays something you do.
//
// Settings (chrome.storage.local): rp_reminder (default on), rp_reminder_hour (local hour, default 18),
// rp_notify (default off; needs the optional "notifications" permission).
// State: rp_duels_seen_day, rp_duels_hero ({progress, target, done}), rp_notified_day.

const END_DAY = Date.UTC(2026, 10, 20) / 86400000; // Duels stops 20 Nov 2026 (00:00 UTC assumed)
const ALARM = 'rp-duels-reminder';
const DUELS_URL = 'https://godforge.gg/duels';

const today = () => Math.floor(Date.now() / 86400000); // UTC day index, same as Duels' serverDayIndex

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(ALARM, { periodInMinutes: 30 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(ALARM, { periodInMinutes: 30 }));

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) check(); });

chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'DUELS_SEEN') return;
    chrome.storage.local.set({ rp_duels_seen_day: msg.day ?? today(), rp_duels_hero: msg.hero ?? null }, check);
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.rp_reminder || changes.rp_reminder_hour)) check();
});

// chrome.notifications only exists once the optional permission is granted, which can happen
// while this worker is already running.
let notifyClickBound = false;
function bindNotificationClick() {
    if (notifyClickBound || !chrome.notifications) return;
    notifyClickBound = true;
    chrome.notifications.onClicked.addListener((id) => {
        if (id.startsWith('rp-duels-')) {
            chrome.tabs.create({ url: DUELS_URL });
            chrome.notifications.clear(id);
        }
    });
}
bindNotificationClick();
chrome.permissions.onAdded.addListener(bindNotificationClick);

async function check() {
    const s = await chrome.storage.local.get(['rp_reminder', 'rp_reminder_hour', 'rp_notify', 'rp_duels_seen_day', 'rp_duels_hero', 'rp_notified_day']);
    const day = today();
    const hero = s.rp_duels_hero;
    const remind = s.rp_reminder !== false
        && day < END_DAY
        && !(hero && hero.done)
        && (s.rp_duels_seen_day ?? -1) < day
        && new Date().getHours() >= (s.rp_reminder_hour ?? 18);

    if (!remind) {
        chrome.action.setBadgeText({ text: '' });
        chrome.action.setTitle({ title: 'RavenPyros Helper for Godforge' });
        return;
    }

    const next = hero ? Math.min(hero.progress + 1, hero.target) : null;
    const message = next ? `Open Duels today for login day ${next} of ${hero.target}.` : 'Open Godforge Duels today to count a login day.';
    chrome.action.setBadgeBackgroundColor({ color: '#e23d3d' });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setTitle({ title: `RavenPyros: ${message}` });

    if (s.rp_notify && s.rp_notified_day !== day && chrome.notifications
        && await chrome.permissions.contains({ permissions: ['notifications'] })) {
        chrome.notifications.create(`rp-duels-${day}`, {
            type: 'basic',
            iconUrl: 'icon.png',
            title: 'Godforge Duels: free hero',
            message: `${message} Click to open Duels.`,
        });
        chrome.storage.local.set({ rp_notified_day: day });
    }
}
