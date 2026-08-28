# Laufbursche Viron Tool (vr-unlock)

A single-page Web Bluetooth client for the Viron e-scooter (manufacturer app family MiniRobot /
XBOT / M1ROBOT, vendor LebiTEC). It talks to the scooter locally over Bluetooth: connect, read
registers, write the speed registers and watch the live telemetry. Nothing leaves your device.

The page framework (design, dark/light theme, two languages, document viewer, log) is shared 1:1 with
the sibling project [sf-unlock](https://github.com/Laufbursche42/sf-unlock). Only the protocol layer is
Viron.

## What it does

- Connects over Nordic UART (and the known alternative transports AE00, FFE0, FFF0), detected
  automatically.
- Builds command frames exactly like the app: `55 AA <len+2> 06 03 <addr> <val_lo> <val_hi> <cks_lo>
  <cks_hi>`, values 16-bit little-endian, checksum = 16-bit one's complement of the byte sum.
- Speed levers: speed-limit on/off (register `0x72`), max speed (`0x7d`) and the gear limits
  (`0x1e`, `0xef`, `0xf0`, `0xf1`, `0xf3`).
- Register read (diagnostics), a free `SendWriteCmd` and a raw-frame sender.
- Live telemetry from the scooter's cmd6 notifications, plus a full hex protocol log.

## Honest scope

The app-side 25 km/h limit is only a slider display bound. The BLE write path is unauthenticated
(no password, no ack). The real speed cap lives in the controller firmware: a raised limit is taken as
a target but bounded by the controller's own hard clamps. This was confirmed in Ghidra on the
plaintext controller firmware. See [PROTOCOL.md](PROTOCOL.md).

This is a feasibility study, not a finished product, and it is not verified on a vehicle. No warranty.

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
