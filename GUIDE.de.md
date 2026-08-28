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

Direkt nach dem Verbinden liest die Seite selbst die Einstellungen deines Scooters aus. Du musst
nichts anstoßen. Steht in der Tempo-Karte eine Zeile wie "Deine Steuerung erlaubt bis zu X km/h",
hat das Auslesen geklappt und die Seite stellt den offenen Wert passend ein.

## Schritt 2: Tempo einstellen

In der Tempo-Karte trägst du zwei Werte ein:

- Offen: dein Wunschtempo.
- Gedrosselt: die zugelassenen 20 km/h.

Der große Knopf schaltet zwischen beiden um. Entsperren schreibt den offenen Wert an den Scooter und
schaltet die Drossel aus. Sperren schreibt den gedrosselten Wert und schaltet die Drossel wieder ein.
Beide Werte merkt sich der Browser auf diesem Gerät. Fang mit einem kleinen Schritt an und miss die
Reaktion am Fahrzeug.

## Schritt 3: Verknüpfungen (optional)

In der Karte Verknüpfungen findest du fertige Adressen für einen Schnellzugriff. Legst du dir auf dem
Handy eine Verknüpfung darauf an, verbindet sich die Seite beim Öffnen mit dem zuletzt genutzten
Scooter und setzt sofort das Tempo: die eine Verknüpfung entsperrt, die andere sperrt. Der Scooter
muss dabei an sein und in Reichweite.

## Fachfunktionen (nur bei Bedarf)

Wenn du das Protokoll verstehst, kannst du unten den Haken Fachfunktionen anzeigen setzen. Dann
erscheinen Werkzeuge, um einzelne Register zu lesen und zu schreiben sowie rohe Befehle zu senden.
Normale Nutzer brauchen das nicht.

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
