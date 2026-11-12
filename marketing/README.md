# LGTM Studio marketing page

This is the single-page marketing site for LGTM Studio.
It is separate from the working product and its mockups.
Its palette and layout live in this folder.
The product's `design/` folder is read-only input for the screenshots.

## Open the page on the local network

The review address on this machine is `http://192.168.143.9:9999`.
The server listens on `0.0.0.0:9999` by default.
It serves an explicit list of public assets and the email signup endpoint.
It never imports the engine or exposes its application programming interface (API).

For this review, it runs as the transient user service `lgtm-studio-marketing`.
The service survives closing the terminal or this chat.
It does not start automatically after a reboot.
Use these commands to manage it:

```sh
systemctl --user status lgtm-studio-marketing
systemctl --user restart lgtm-studio-marketing
systemctl --user stop lgtm-studio-marketing
```

To start a foreground server after stopping that service, use the repository root:

```sh
nvm use
node marketing/server.ts
```

Set `LGTM_MARKETING_HOST=127.0.0.1` to restrict it to this computer.
Set `LGTM_MARKETING_PORT` to change the port.
This server is for local network review.
Public deployment needs an HTTPS reverse proxy.

## Choose light or dark mode

The sun or moon button in the top navigation switches the page's theme.
The first visit follows the device's color preference.
The browser remembers a manual choice when local storage is available.
The choice applies only to this marketing page.

## Add the walkthrough video

Save the recording as `marketing/public/assets/demo.mp4`.
Reload the page.
The preview toolbar automatically gains a Watch demo button.
The recording starts only after the visitor chooses it.
The player defaults to 1.25 times the recorded speed.
Visitors can change the speed through the browser's playback controls.
Set `video.playbackRate` in `browser.ts` to 1 if the recording is already sped up.

Use an MP4 file with H.264 video for broad browser support.
The server supports byte-range requests for seeking.
The recording stays out of Git.
The screenshot previews remain available alongside the video.
The current page has no recording because the owner will supply it.

## Find the collected email addresses

Signups are stored in `marketing/.state/waitlist.sqlite`.
The `waitlist` table contains `email`, `created_at`, and `consent_version`.
Email addresses are normalized and deduplicated.
The database survives server restarts.
The form requires explicit consent to receive early-access updates.
The server records consent as `early-access-v1`.
It records no Internet Protocol (IP) address.
It sends no email and does not connect to a mailing provider.

The database is private to the local filesystem.
There is no public endpoint for listing signups.
The `.state/` directory is ignored by Git.
Back up this file before moving or deleting the checkout.

To export the list as JavaScript Object Notation (JSON) from the repository root:

```sh
nvm use
node marketing/export.ts > ~/lgtm-studio-signups.json
```

The export contains personal email addresses.
Keep it private.
Remove an address from the local table if its owner asks to leave the list.

## Reproduce the screenshots and checks

The public images were captured from `design/workbench.html` with its sample data.
They show the current mockup, which still displays the LGcode name.
They do not claim that every mockup feature is released.
The mockup server used for capture is bound to loopback.
It is never exposed through the marketing server.

```sh
nvm use
python3 -m http.server 4178 --bind 127.0.0.1 --directory design
```

In another terminal:

```sh
nvm use
node marketing/scripts/capture-product.mjs
node --test marketing/server.test.ts
node node_modules/typescript/bin/tsc -p marketing/tsconfig.json
node marketing/scripts/verify.mjs
```

The capture script writes three product screenshots to `public/assets/`.
The browser check writes full-page landing screenshots to `verification/`.
It checks desktop, tablet, and phone layouts at widths of 1440, 768, 390, and 320 pixels.
It also checks preview switching, keyboard operation, signup recovery, and reduced motion.
Its signup requests use a temporary database.
The live waitlist is untouched.
The video transport test uses a temporary byte fixture.
It does not establish playback of the owner's future recording.

Inter is served unchanged from the repository's existing `third_party/inter/` font.
Its licence and attribution remain there and in the root `NOTICE`.
The marketing mark and the team diagram are original work.
