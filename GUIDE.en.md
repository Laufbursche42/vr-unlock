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

Right after connecting the page reads your scooter's settings by itself. You do not have to trigger
anything. If the tempo card shows a line like "your controller allows up to X km/h", the readout
worked and the page sets the open value accordingly.

## Step 2: Set the speed

In the tempo card you enter two values:

- Open: your desired speed.
- Throttled: the legal 20 km/h.

The big button toggles between them. Unlock writes the open value to the scooter and turns the throttle
off. Lock writes the throttled value and turns the throttle on again. The browser remembers both values
on this device. Start with a small step and measure the reaction on the vehicle.

## Step 3: Shortcuts (optional)

The shortcuts card has ready-made addresses for quick access. If you add a home-screen shortcut to one
of them, opening it reconnects to the last scooter and sets the speed at once: one shortcut unlocks,
the other locks. The scooter has to be on and in range.

## Expert functions (only if needed)

If you understand the protocol, tick "Show expert functions" further down. Tools to read and write
single registers and to send raw commands appear. Normal users do not need this.

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
