# RavenPyros Helper for Godforge

The source code of the [RavenPyros Helper for Godforge](https://chromewebstore.google.com/detail/cckkgbjaofgjeiepkfobeemmjnahaapd)
Chrome extension, a companion for Godforge Duels on godforge.gg, published so anyone can check what it does.
The files here are exactly the ones in the Chrome Web Store package for the version tagged.

**It is a helper, not a bot.** It reads what the game already shows you. It never clicks, types, creates
rooms, plays or makes choices for you.

## What it does

| File | Runs on | What it does |
|---|---|---|
| `duels.js` | godforge.gg/duels | A small panel with your free-reward progress (hero, weapon, imprint), today's quests and anything waiting to be claimed. It reads `/api/duels/bootstrap`, the same data the game loads, only while a Duels page is open. |
| `rewards.js` | godforge.gg reward pickers | Adds a link from each hero, weapon and imprint choice to its page on ravenpyros.com. |
| `rooms.js` | godforge.gg Duel a Friend | **Hosting:** offers to list the room you created on [Open Duel Rooms](https://www.ravenpyros.com/godforge-duels/rooms). **Joining:** shows the open rooms on the "Join a room" screen with a Copy button for each code. |
| `background.js` | your browser | Daily login reminder: a red **!** on the toolbar icon (and an optional notification) if you haven't opened Duels by your chosen time. It never contacts godforge.gg. |
| `popup.html`, `popup.js` | the toolbar popup | Turn each feature on or off. |

## What leaves your computer

Nothing, except for Open Duel Rooms:

- **When you click "List this room"**, `rooms.js` sends the 5-character room code and your optional note
  to `https://www.ravenpyros.com/api/duels/v1/rooms`. While the room is listed it checks in about every
  20 seconds with only the listing number and a random key that proves the listing is yours. The room is
  removed when someone joins, you leave the room or you close the tab.
- **On the "Join a room" screen**, it loads the list of open rooms from the same address. That request
  sends nothing about you.

Listed rooms are shown on ravenpyros.com and posted in the RavenPyros Discord server. The server keeps
the code, the note and a one-way hash of your IP address (to limit how many rooms can be listed from one
place). No account, name, email or Godforge data is sent. You can turn room listing off in the popup.

Everything else (your settings and login-day count) stays in your browser's extension storage.

Full privacy policy: https://www.ravenpyros.com/godforge-helper-privacy-policy

## Permissions

`storage` and `alarms`, plus the optional `notifications` permission, which is only requested if you turn
on reminder notifications. Content scripts run on `https://godforge.gg/*` only.

## Licence

Copyright © 2026 Raven Pyros. All rights reserved. The code is published so it can be read and checked;
see [LICENSE](LICENSE).
