# vr-unlock

Web-Bluetooth-Werkzeug für den Viron-E-Scooter (App-Familie MiniRobot / XBOT, Hersteller LebiTEC).
Es spricht das belegte BLE-Protokoll des Scooters direkt an: verbinden, Register lesen, die
Speed-Register schreiben sowie die Live-Telemetrie ansehen. Eine einzige, in sich geschlossene Seite
(`index.html`, CSS plus JS inline), analog zum Nachbarprojekt sf-unlock.

## Belegtes Protokoll

- Transport: Nordic UART. Dienst `6e400001`, Schreiben auf `6e400002`, Notifications auf `6e400003`.
  Die App kann zusätzlich vier weitere Hardware-Varianten (ae00, ffe0, fff0), die das Tool automatisch
  erkennt.
- Schreibframe: `55 AA <len+2> 06 03 <addr> <wert_lo> <wert_hi> <cks_lo> <cks_hi>`. Werte sind 16-Bit
  little-endian. Prüfsumme = 16-Bit-Einserkomplement der Byte-Summe ab dem Längenbyte, little-endian.
  Beispiel Tempolimit aus (Register 0x72 = 0): `55 AA 04 06 03 72 00 00 80 FF`.
- Der Sendeweg ist ungesichert (kein Passwort, kein Ack). Die App-seitige 25-km/h-Grenze ist nur eine
  Anzeigegrenze des Sliders.

## Speed-Register

- `0x72` Tempolimit an/aus (Bool)
- `0x7d` Höchstgeschwindigkeit (MaxSpeed)
- `0x1e`, `0xef`, `0xf0`, `0xf1`, `0xf3` Gang- bzw. Modus-Limits
- `0xc2..0xc7` Speed-Grenzen je Fahrmodus, vom Controller gemeldet (nur lesen)

Wichtig: Der eigentliche Deckel sitzt im Controller. Ein hochgeschriebenes Limit wird vom Controller
als Sollwert genommen, aber durch dessen eigene harte Klammern begrenzt. Das ist per Ghidra an der
Klartext-Controller-Firmware bestätigt. Erst lesen, dann in kleinen Schritten schreiben.

## Nutzung

Web-Bluetooth läuft nur im sicheren Kontext (https oder localhost) in Chrome/Edge (Android, Desktop)
oder Bluefy (iOS). Lokal starten:

```
py -3 -m http.server 50001
```

Dann `http://localhost:50001/` öffnen.

## Rechtlicher Hinweis

Das Anheben der Höchstgeschwindigkeit hebt die Drossel auf. Die ABE erlischt damit und der Betrieb auf
öffentlichen Wegen ist dann nicht erlaubt. Alles gilt nur für das eigene Gerät auf privatem Gelände
sowie auf eigenes Risiko.
