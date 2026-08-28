# Laufbursche Viron Tool (vr-unlock)

A single-page Web Bluetooth client for the Viron e-scooter (manufacturer app family MiniRobot /
XBOT / M1ROBOT, vendor LebiTEC). It talks to the scooter locally over Bluetooth: connect, read the
configuration, set the speed and watch the live values. Nothing leaves your device.

The page framework (design, dark/light theme, two languages, document viewer, log) is shared 1:1 with
the sibling project [sf-unlock](https://github.com/Laufbursche42/sf-unlock). Only the protocol layer is
Viron. Protocol details are in [PROTOCOL.md](PROTOCOL.md).

This is a feasibility study, not a finished product, and it is not verified on a vehicle. No warranty.
Read [Honest limits](#honest-limits-please-read) before you rely on anything here.

## The normal flow (no technical knowledge needed)

1. **Connect.** The chooser shows all nearby Bluetooth devices, because the Viron models do not share
   one advertised name. Pick your scooter (usually named `M0Robot`).
2. **Automatic read-out.** Right after connecting the page reads the scooter's settings by itself and
   shows a line like "your controller allows up to X km/h". You do not press anything.
3. **Set the speed.** Enter two values, Open (your desired speed) and Throttled (20 km/h). One button
   toggles: Unlock writes the open value and turns the throttle off, Lock writes the throttled value
   and turns the throttle on.
4. **Shortcuts (optional).** Home-screen links (`?do=fast` / `?do=slow`) reconnect to the last scooter
   and unlock or lock in one tap.

## Live values

The tiles are filled from the scooter's cmd6 messages: Speed (register 0x22, scaled), Battery (0x26),
Speed limit (0x1e), Ride mode (0x7e), Throttle on/off (0x72) and Firmware (0x4e). Not every model
sends every value, and the mapping of some fields is inferred, not proven. Treat them as a help, not a
calibrated readout.

## Expert functions (the collapsible section)

The "Expert functions" card is collapsed by default. It exposes the raw protocol. **Everything here
writes directly to the scooter with no password and no undo.** Only use it if you understand the
protocol. Each item below is exactly what a control does and why it exists.

### Read register (diagnostics)

- **Register address (hex).** A single register number, e.g. `c2`. The scooter stores its state in a
  numbered register map; this reads one entry.
- **Read.** Sends a read request for that register. The answer comes back as a cmd6 message and shows
  up in the live values and raw in the protocol log.
- **Read speed limits.** Reads registers `0xc2`..`0xc7` in one go. These are the per-mode speed limits
  the controller itself reports, so you can see what the controller allows before writing anything.

### Fine tuning (write register)

- **Motor value (raw), register 0x7d.** A raw 16-bit motor value, not km/h. The app's slider computes
  it as `percent * 1000 + 2000` (default 6000). Writing it directly is for experiments; the effect is
  model-dependent.
- **Speed limit per step.** Pick a register and write a value:
  - `0x1e` step 1, `0xf1` step 2 (comfort), `0xf3` step 3 (cruise), `0xef` mode limit 1, `0xf0` mode
    limit 0. These are close to km/h and are what the normal Unlock/Lock button writes under the hood.
- **Write.** Sends the value to the chosen register as a `SendWriteCmd` frame.

### Free command (raw)

- **Address (hex) + Value.** Builds a proper `SendWriteCmd(addr, value)` frame: header `55 AA`, cmd
  `06`, type `03`, the value as 16-bit little-endian, and a correct 16-bit one's-complement checksum.
  This is the exact frame the manufacturer app sends. Use it to poke any register you know.
- **Raw frame (hex).** Sends the exact bytes you type, computing nothing (no checksum, no header). For
  replaying a captured frame or testing malformed input.

### Register reference (from static analysis)

| Register | Meaning | Status |
|---|---|---|
| 0x72 | Speed throttle on/off (bool) | proven, write path |
| 0x7d | Max speed (raw motor value) | proven register; effect model-dependent |
| 0x1e / 0xef / 0xf0 / 0xf1 / 0xf3 | Gear / mode speed limits (km/h-near) | proven register |
| 0xc2..0xc7 | Per-mode speed limits reported by the controller | read only |
| 0x22 | Main display value (scaled * 0.21944) | speed inferred |
| 0x26 | Second ring | battery inferred |
| 0x7e | Ride mode | proven |
| 0x4e | Firmware version | proven |
| 0x1d + 0x1e | Model / region id (part of the EU 25 km/h signature) | proven |

## Honest limits (please read)

Before making this public, be clear about what is and is not certain:

- **Not every Viron model is guaranteed to connect.** The tool supports the five GATT transports the
  manufacturer app uses (Nordic UART, AE00, FFE0, two FFF0 sets) and auto-detects them. A model that
  uses a different service cannot work here, and this has not been tested on real hardware. If your
  scooter connects but no known service is found, the log says so; send it in.
- **The effective speed register is not proven for a specific model.** The write path, the frame and
  the registers are proven from the binary, and the controller firmware confirms the frame and that
  the real cap lives in the controller. But which single register actually raises the speed on a given
  Viron is model-dependent (register `0x7d` is overloaded across models). The Unlock button therefore
  writes several registers (throttle `0x72` plus the gear limits) as a best effort, not a proven
  single field. Whether the scooter rides the value only the test on the vehicle shows.
- **Some telemetry labels are inferred.** Speed and battery are reasoned from the display code, not
  hard-proven. A real BLE capture would confirm them.
- **Nothing here is verified on a vehicle.** Raising the speed can take a vehicle out of its approved
  condition; that responsibility is the rider's.

## Run it locally

Web Bluetooth needs a secure context (https or localhost) in Chrome/Edge (Android, desktop) or Bluefy
(iOS). From the project folder:

```
py -3 -m http.server 50001
```

then open `http://localhost:50001/`.

## Legal

Only for your own device on private ground. Raising the top speed removes the throttle limit, the road
approval lapses and riding on public roads is then not allowed. See
[LICENSE.md](LICENSE.md), [PRIVACY.md](PRIVACY.md) and [TRADEMARKS.md](TRADEMARKS.md).
