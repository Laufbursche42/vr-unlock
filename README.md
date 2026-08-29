# Laufbursche Viron unlock

A static web page that talks to the Viron e-scooter over Web Bluetooth (manufacturer app family
MiniRobot / XBOT / M1ROBOT, vendor LebiTEC). Connect from the browser, and the page reads the
scooter's configuration by itself and then lets you set the speed, toggle the throttle limit, lock and
unlock the immobilizer and change the other settings the app exposes. Nothing to install: no app
store, no signing, no developer account. It runs in **Bluefy** on iOS and in **Chrome** on Android or
desktop.

> **This is a feasibility study.** It exists to show what the Viron Bluetooth protocol makes possible,
> not to be a finished product. The protocol was reconstructed from the official app
> (com.loby.balance.car.google 11.3.7) and the plaintext controller firmware, cross checked in Ghidra,
> and is documented byte for byte. It is not verified on a vehicle. Error-free operation is not
> promised and there is no warranty of any kind. Whatever you do with it, you do at your own risk.

**Open the web app: [laufbursche42.github.io/vr-unlock](https://laufbursche42.github.io/vr-unlock/)**

Or run it yourself, no build step, no dependencies: clone the repo and serve the folder over a local
HTTP server. Opening `index.html` directly as a `file://` URL will not work, the page fetches its own
documents and browsers block that over `file://`.

```
git clone https://github.com/Laufbursche42/vr-unlock.git
cd vr-unlock
python -m http.server 50001
```

Any static server works. With Node installed, this does the same job:

```
npx serve .
```

Then open the printed address in a browser that supports Web Bluetooth.

**Guide: [Deutsch](GUIDE.de.md) | [English](GUIDE.en.md)** covers everything step by step, from
connecting to the first send.

## Connecting

The Viron models do not share one advertised name, so the page opens the chooser with all nearby
Bluetooth devices, exactly like the manufacturer app, which scans unfiltered. Pick your scooter (the
name usually starts with `M0Robot`). After connecting, the page finds the right GATT service by itself:
it supports the five transports the app uses (Nordic UART plus the AE00, FFE0 and two FFF0 sets) and
picks whichever one the scooter exposes.

Right after connecting the page reads the scooter's settings on its own and shows what the controller
allows, so you do not have to read anything manually.

## What it does

- **Set the speed.** Two values, Open and Throttled, and one Unlock/Lock button. Unlock writes the
  open km/h to the per-mode limit register (`0xf0` / `0xef` / `0xf1`) with the HB frame and turns the
  throttle off; Lock writes the throttled value and turns the throttle on. This replicates the app's
  `onTouchLimitSpeed1` path exactly.
- **Toggle the speed throttle** (register `0x72`) on and off.
- **Lock and unlock the immobilizer** (register `0x70` / `0x71`). This is the anti-theft lock, not the
  speed.
- **More settings** where the model exposes them: electronic lock (`0xf6`), zero-start (`0x7d` bit 0),
  headlight (`0xf2`), the warning bits in the collective register `0xd3` (hub light, reverse-too-fast,
  lock warning, lock shut-down), motor type (`0x6e`), battery capacity (`0x21`), the display unit
  km/h vs mph (`0x1b`, BLE frame cmd `0x21`) and the turn and ride scales (`0xa1` / `0xa2`). Each
  command uses the byte-exact frame type of the app.
- **Ride mode, cruise control and recuperation** (`0x7e` / `0x7c` / `0x7b`). The app does not send
  these with a bare write; it writes them with `SendWriteCmd_HB` (cmd `0x20`) and then, after a 0.1 s
  delay, reads the same register back to confirm (belegt: `onClickDriveType`,
  `onClickSetDriveTypeOK`, `onClickNLHSQD` build exactly this write -> DelayTime(0.1) -> read sequence).
  The tool replicates that flow, so the value is written and then read back; the "?" on each control
  explains it.
- **Read the telemetry** the scooter sends back (speed, battery, ride mode, throttle state, firmware),
  and keep the raw notifications in an on-screen diagnostic log as plain hex.
- **Expert panel** to read any register, write the max-speed value (`0x7d`) or send any raw frame.
- **Home-screen shortcuts** for speed (`?do=fast` / `?do=slow`): opened through such a shortcut the
  page reconnects to the last scooter and unlocks or locks in one tap.

## Encryption

For the Viron the default is **plaintext**: a `55 AA` frame with a 16-bit one's-complement checksum, no
AES. The app carries three optional XOR layers (a whole-frame scramble, a 12-byte XoTable for register
`0xE0`, a checksum XOR) but they depend on the model variant and are off in the default configuration.
A frame self-test runs on load and is written to the diagnostic log.

## Browser support

- **iOS:** the **Bluefy** browser. Safari and every other iOS browser run on the Safari engine, which
  has no Web Bluetooth at all.
- **Android or desktop:** **Chrome** or another Chromium browser. Web Bluetooth is built in.

There is no OTA firmware flashing here; the app does firmware updates over its own cloud, not part of
this page.

## Project structure

```
index.html   - the single page: cards, dialogs, the settings and expert sections
app.js       - all logic: frame builders (cmd 0x06/0x0A/0x20), transports, connect,
               auto-read, the settings table, decode, UI and the diagnostic log
i18n.js      - the German and English string table
styles.css   - theme and layout
PROTOCOL.md  - the reverse-engineered BLE protocol reference
GUIDE.de.md, GUIDE.en.md - the step-by-step guide
scripts/     - check-i18n.js and security-scan.py (run in CI and the git hooks)
.github/workflows/ - CI (JS syntax plus security scan) and CodeQL
.githooks/   - pre-commit and pre-push checks
```

## How it works

- On connect the page resolves the GATT service among the five known transports and starts
  notifications, then auto-reads the relevant registers.
- Every write is one of three frames that differ only in the command byte: `SendWriteCmd` (0x06),
  `SendWriteCmd2` (0x0A) and `SendWriteCmd_HB` (0x20). The register, frame type and value formula per
  control come straight from the app's UI handlers (Ghidra). The full table is in `PROTOCOL.md`.
- Incoming cmd6 frames fill a register store that feeds the live tiles.
- The real speed cap lives in the controller firmware, confirmed in Ghidra on a plaintext controller
  image. The page can raise the limits; whether the scooter rides the value is up to the controller.

## Development

No build step and no dependencies. Edit the files and reload the page. Serve locally, Web Bluetooth
needs `https` or `localhost`:

```
python -m http.server 50001
```

Run the same checks as the CI and the git hooks:

```
node scripts/check-i18n.js
python scripts/security-scan.py
```

Enable the git hooks with `git config core.hooksPath .githooks`. New user-facing strings go into both
languages in `i18n.js`; `check-i18n.js` fails on a missing or unused key. The security scan blocks
XSS/injection sinks, inline handlers, external resources and a missing CSP; CodeQL runs on GitHub.

## Honest limits

- **Not every model is guaranteed to connect.** The five supported transports cover every model the
  app supports, and the chooser shows all devices, but this is not verified on real hardware and a
  model with a different service cannot work here.
- **The effective speed register is model-variant-dependent.** Which control a given Viron uses is
  decided at runtime from the model variant (set from the model string) and the drive mode. The Unlock
  button uses the common per-mode path; the expert panel reaches the other registers with their exact
  frames.
- **Some telemetry labels are inferred**, not hard-proven.
- **Nothing here is verified on a vehicle.** A single BLE capture from the original app pins the exact
  register and confirms the telemetry.

## Reporting

Found a problem or want to confirm what works on a real scooter? Open a
[GitHub issue](https://github.com/Laufbursche42/vr-unlock/issues). The copy button under the log gives
you the full diagnostic transcript to paste in.

## Legal

Raising the maximum speed lifts the factory limit. The operating permit (Betriebserlaubnis, ABE) is
then void and riding the scooter in public traffic is no longer allowed. Use it on your own vehicle
only. Everything you do with this page is at your own risk.

## License

PolyForm Noncommercial 1.0.0 with two additional terms, in full in [LICENSE.md](LICENSE.md).

## Privacy

Nothing leaves your device but the page load itself. The details are in [PRIVACY.md](PRIVACY.md).

## Trademarks

An independent project, not affiliated with the manufacturer. "Viron" and the model names are
trademarks of their respective owners and are used here only to say which scooters this page works
with. See [TRADEMARKS.md](TRADEMARKS.md).
