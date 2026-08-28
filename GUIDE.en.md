# Guide

This guide walks you through the Viron Tool step by step: connect, read registers, write the speed
registers and read the live values. Everything runs locally between your browser and the scooter,
nothing goes to a server.

## Requirements

- A browser with Web Bluetooth: Chrome or Edge on Android/desktop, the Bluefy app on iPhone. Safari
  has no Web Bluetooth.
- The page must run over https or localhost. Double-clicking the file is not enough for the browser.
- The Viron powered on and in range.

## Step 1: Connect

Tap Connect. The Bluetooth dialog shows your scooter with a name part like M0Robot. Pick it. If the
dialog shows nothing, use the "Diagnostics: all devices" button in the log section. It shows every
Bluetooth device and, after connecting, the GATT services. Then copy the log and send it.

After connecting, the line under the button shows the detected transport (usually Nordic UART) and the
control cards become active.

## Step 2: Read registers (always first)

Before writing anything, read the real limits from the controller. The read card has 0xc2 as the
default target. The "Read 0xc2..0xc7" button fetches the per-mode speed limits. Also useful are
0x1d/0x1e (model/region signature) and the BLE register 0x15. The answers appear in the live values
and raw as hex in the log.

## Step 3: The speed levers

The speed card holds the proven registers:

- Speed limit (reg 0x72): Limit OFF writes 0, Limit ON writes 1.
- MaxSpeed raw value (reg 0x7d): a 16-bit raw value. The app default is 6000. This is not km/h but an
  internal motor unit.
- Gear limit: pick the register (0x1e, 0xf1, 0xf3, 0xef, 0xf0) and write a value. These are close to
  km/h.

Go in small steps and measure the reaction on the vehicle after each write.

## Step 4: Free command

For your own experiments the free command builds a clean write frame from address plus value. The raw
frame sender sends exactly the entered bytes, without recomputing the checksum. An example for
"limit off" is in the field as a placeholder: 55 AA 04 06 03 72 00 00 80 FF.

## What the live values mean

The values come from the scooter's cmd6 messages. Register 0x22 is the main display (scaling times
0.21944, the meaning "speed" is inferred), 0x26 the second ring, 0x7e the ride mode, 0x72 the limit
bool, 0x7d MaxSpeed and 0x4e the firmware. Not every field is firmly mapped; a real capture sharpens
the mapping.

## Honest about the cap

The 25 km/h limit the manufacturer app shows in the slider is only a display bound. The BLE write path
is unauthenticated. Whether the scooter actually rides a raised value is up to the controller. It has
its own hard cap that lives in its firmware. This is confirmed in Ghidra on a plaintext controller
firmware. A BLE tool can reach that internal limit; beyond it only a firmware change helps.

## Legal notice

Raising the top speed removes the throttle limit. The road approval lapses and riding on public roads
is then not allowed. Everything is only for your own device on private ground and at your own risk.
