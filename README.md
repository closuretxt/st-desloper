# ST Desloper

A SillyTavern extension that cleans the stock phrases and habits out of AI replies: "It wasn't
anger. It was something softer.", em dashes everywhere, the same gesture three replies in a row,
leaked thinking tags, and so on.

It doesn't call a model. Every fix is plain code, so it's fast, free, and gives the same result
every time for the same message.

## What it changes

By default, only two things:

- **What you see.** Replies show cleaned on screen.
- **What the model sees.** The chat history sent with each request is cleaned too, so the model
  stops copying its own habits.

The saved messages stay as written. Edit always shows the original, and turning the extension off
brings everything back.

If you want other extensions (TTS, summaries, memory) to get the cleaned text as well, turn on
**Rewrite saved messages**. The original is kept in the chat file and put back if you turn it off.

> **Before uninstalling with Rewrite saved messages on:** turn it off first, then open each chat
> you used it in. The originals are put back only when a chat is opened with Desloper installed;
> a chat you never reopen keeps the cleaned text (its original stays in the file, under
> `extra.st_desloper`).

## Install

In SillyTavern, open **Extensions → Install extension** and paste this repository's URL. Or copy
this folder into `SillyTavern/data/<your user>/extensions/` and reload. Then enable it in the
Extensions panel.

## Using it

Open the **ST Desloper** drawer in the Extensions panel.

- **Enabled** turns everything on or off.
- **Show originals** shows each reply as written, with removed text in red and added text in green.
  Useful for checking what a fix did.
- **Clean while streaming** cleans a reply as it comes in instead of after it finishes.
- **Fixes and options** lists every fix with its settings. Some are off by default; turn on the
  ones you want. This is also where you add your own patterns.
- **Tester** lets you paste a reply and see the cleaned version without touching the chat.
- **Open stats** shows how often the current chat's replies use each kind of slop, and whether it's
  getting better. Also available as `/desloper-stats`.

## When a fix gets it wrong

Fixes are written to leave text alone when they aren't sure, but they will miss sometimes. Use
**Show originals** to see what changed, then turn off or adjust that fix in **Fixes and options**.

Found a misfire or a new pattern worth fixing? Open an issue on this repository with a short
example (made-up text of the same shape is fine) or report it in the ST Discord thread for ST Desloper.

## Your own patterns

Patterns you add or import are regular expressions that run on every reply. A badly written one
(nested repeats like `(a+)+`) can freeze the page on a long reply, so only import pattern files
from people you trust.

## License

AGPL-3.0. See [LICENSE](LICENSE).
