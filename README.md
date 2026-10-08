# RavenPyros Helper for Godforge

The source code of the [RavenPyros Helper for Godforge](https://chromewebstore.google.com/detail/cckkgbjaofgjeiepkfobeemmjnahaapd)
Chrome extension, a companion for Godforge Duels on godforge.gg, published so anyone can check what it does.
The files here are exactly the ones in the Chrome Web Store package for the version tagged.

**It is unofficial:** made by the RavenPyros fan site, not made, checked or supported by the Godforge team.
It never asks for your Godforge login.

**It is a helper, not a bot.** It reads what the game already shows you. It never clicks, types, creates
rooms, plays or makes choices for you. The one thing it can change is adding a deck to your Armory, and
only when you click Save and confirm (see `armory.js`).

## What it does

| File | Runs on | What it does |
|---|---|---|
| `duels.js` | godforge.gg/duels | A small panel with your free-reward progress (hero, weapon, imprint), today's quests and anything waiting to be claimed. It reads `/api/duels/bootstrap`, the same data the game loads, only while a Duels page is open. Its button also shows how many duel rooms are open, and the panel lists them. |
| `rewards.js` | godforge.gg reward pickers | Adds a link from each hero, weapon and imprint choice to its page on ravenpyros.com. |
| `rooms.js` | godforge.gg Duel a Friend | **Hosting:** offers to list the room you created on [Open Duel Rooms](https://www.ravenpyros.com/godforge-duels/rooms). **Joining:** shows the open rooms on the "Join a room" screen with a Copy button for each code. |
| `armory.js` | godforge.gg/duels/builder | **Deck import.** "Send to Godforge" on a [RavenPyros deck](https://www.ravenpyros.com/godforge-duels/deck-builder) opens the Armory with `#rp-deck=<code>`. The panel loads that public deck from ravenpyros.com, reads your collection and saved decks (`/api/duels/collection`, `/api/duels/decks`, as the Armory does) and shows which cards you own. Only if you own every card, the deck isn't already saved and your Armory has room does it offer **Save to my Armory**; after you confirm it sends one `POST /api/duels/decks`, the same request as the Armory's Save button, always as a new deck. It never edits or deletes decks. |
| `background.js` | your browser | Daily login reminder: a red **!** on the toolbar icon (and an optional notification) if you haven't opened Duels by your chosen time. It never contacts godforge.gg. |
| `popup.html`, `popup.js` | the toolbar popup | Turn each feature on or off. |

## What leaves your computer

Nothing from your Godforge account. The only requests to ravenpyros.com are these:

- **Deck import:** fetching the public deck you chose by its code. Your collection and decks are read in
  the godforge.gg tab and stay there. Saving a deck goes to godforge.gg only, after you confirm.
- **Open duel room counts and lists**, which send nothing about you.
- **Listing a room you host:** when you click "List this room", `rooms.js` sends the 5-character room code and your optional note
  to `https://www.ravenpyros.com/api/duels/v1/rooms`. While the room is listed it checks in about every
  20 seconds with only the listing number and a random key that proves the listing is yours. The room is
  removed when someone joins, you leave the room or you close the tab.

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
