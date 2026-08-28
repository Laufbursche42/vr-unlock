# Anleitung

Diese Anleitung führt dich Schritt für Schritt durch das Viron Tool: verbinden, Register lesen, die
Speed-Register schreiben und die Live-Werte deuten. Alles läuft lokal zwischen deinem Browser und dem
Scooter, nichts geht an einen Server.

## Voraussetzungen

- Einen Browser mit Web Bluetooth: auf Android oder Desktop Chrome oder Edge, auf dem iPhone die App
  Bluefy. Safari kann kein Web Bluetooth.
- Die Seite muss über https oder localhost laufen. Ein Doppelklick auf die Datei reicht dem Browser
  nicht.
- Den Viron in Reichweite und eingeschaltet.

## Schritt 1: Verbinden

Tippe auf Verbinden. Im Bluetooth-Dialog erscheint dein Scooter mit einem Namensteil wie M0Robot.
Wähle ihn aus. Findet der Dialog nichts, hilft der Knopf Diagnose: alle Geräte im Protokoll-Bereich.
Er zeigt jedes Bluetooth-Gerät sowie nach dem Verbinden die GATT-Dienste. Danach den Log kopieren und
schicken.

Nach dem Verbinden zeigt die Zeile unter dem Knopf den erkannten Transport (in der Regel Nordic UART)
und die Steuer-Karten werden aktiv.

## Schritt 2: Register lesen (immer zuerst)

Bevor du etwas schreibst, lies die echten Grenzwerte aus dem Controller. In der Karte Register lesen
steht als Ziel schon 0xc2. Der Knopf 0xc2..0xc7 auslesen holt die Speed-Grenzen aller Fahrmodi.
Interessant sind auch 0x1d/0x1e (Modell-/Regionskennung) und das BLE-Register 0x15. Die Antworten
erscheinen in den Live-Werten und roh als Hex im Log.

## Schritt 3: Die Speed-Hebel

In der Karte Speed-Hebel liegen die belegten Register:

- Tempolimit (Reg 0x72): Limit AUS schreibt 0, Limit AN schreibt 1.
- MaxSpeed-Rohwert (Reg 0x7d): ein 16-Bit-Rohwert. Der App-Default ist 6000. Das ist kein km/h-Wert
  sondern eine interne Motoreinheit.
- Gang-Limit: wähle das Register (0x1e, 0xf1, 0xf3, 0xef, 0xf0) und schreibe einen Wert. Diese Werte
  sind km/h-nah.

Gehe in kleinen Schritten vor und miss nach jedem Schreiben die Reaktion am Fahrzeug.

## Schritt 4: Freier Befehl

Für eigene Versuche baut der freie Befehl aus Adresse plus Wert einen sauberen Schreibframe. Der
Rohframe-Sender schickt genau die eingegebenen Bytes, ohne die Prüfsumme nachzurechnen. Ein Beispiel
für Limit aus steht als Platzhalter im Feld: 55 AA 04 06 03 72 00 00 80 FF.

## Was die Live-Werte bedeuten

Die Werte kommen aus den cmd6-Meldungen des Scooters. Register 0x22 ist die Hauptanzeige (Skalierung
mal 0.21944, die Bedeutung Speed ist erschlossen), 0x26 der zweite Ring, 0x7e der Fahrmodus, 0x72 das
Limit-Bool, 0x7d MaxSpeed sowie 0x4e die Firmware. Nicht jedes Feld ist sicher zugeordnet, ein echter
Mitschnitt schärft die Zuordnung.

## Ehrlich zum Deckel

Die 25-km/h-Grenze, die die Hersteller-App im Slider zeigt, ist nur eine Anzeigegrenze. Der
BLE-Schreibweg ist ungesichert. Ob der Scooter einen hochgeschriebenen Wert wirklich fährt, entscheidet
der Controller. Der besitzt einen eigenen harten Deckel, der in seiner Firmware sitzt. Das ist per
Ghidra an einer Klartext-Controller-Firmware bestätigt. Ein BLE-Tool kann bis zu dieser internen Grenze
kommen, darüber hinaus hilft nur eine Firmware-Änderung.

## Rechtlicher Hinweis

Das Anheben der Höchstgeschwindigkeit hebt die Drossel auf. Die ABE erlischt und der Betrieb auf
öffentlichen Wegen ist dann nicht erlaubt. Alles gilt nur für das eigene Gerät auf privatem Gelände
sowie auf eigenes Risiko.
