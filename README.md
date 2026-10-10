# 🚩 Kleinanzeigen – Anzeige melden (direkt aus der Übersicht)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.1.0-blue.svg)]()
[![Plattform](https://img.shields.io/badge/Plattform-Kleinanzeigen.de-green.svg)]()

Ein Userscript für **Kleinanzeigen.de**, das in der Suchergebnis-Übersicht direkt neben dem Preis einen **„Melden“-Button** einfügt.

Typischer Fall: In der Liste steht ein Auto für „2 € VB“, im Text steht etwas ganz anderes – also ein Lockpreis. Mit einem Klick öffnest du den **offiziellen Melden-Dialog** von Kleinanzeigen in einem Overlay, wählst den Grund aus und schickst die Meldung ab. **Die Übersicht verlässt du dabei nicht**, und Scroll-Position, Filter und Seite bleiben erhalten.

---

## ✨ Features

* 🚩 **Melden-Button in der Übersicht:** Er sitzt in jeder Anzeigen-Karte rechts neben dem Preis.
* 🪟 **Overlay statt Seitenwechsel:** Die Anzeige wird im Hintergrund geladen. Das Script klickt dort automatisch auf „Anzeige melden“ und blendet alles außer dem Melden-Dialog aus.
* ✅ **„Gemeldet“-Markierung:** Nach erfolgreichem Absenden wird der Button grün („Gemeldet“). Die Markierung bleibt lokal in deinem Browser gespeichert, damit du nichts doppelt meldest.
* 🪄 **Fallbacks:** Wenn die Automatik den Dialog nicht findet, kannst du in der Anzeige manuell auf „Melden“ klicken, die Anzeige im Popup öffnen oder sie per Button selbst „als gemeldet markieren“.
* 🛡️ **Nur offizieller Weg:** Das Script sendet **keine** eigenen Requests an Kleinanzeigen. Gemeldet wird ausschließlich über den originalen Dialog der Plattform.

---

## ⚙️ Installation

**Schritt 1: Userscript-Erweiterung installieren** (kostenlos)

* **Chrome / Edge:** [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) oder [Violentmonkey](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)
* **Firefox:** [Tampermonkey](https://addons.mozilla.org/de/firefox/addon/tampermonkey/) oder [Violentmonkey](https://addons.mozilla.org/de/firefox/addon/violentmonkey/)

> **Chrome/Edge:** Bei neueren Tampermonkey-Versionen muss in den Erweiterungs-Details „Benutzerskripte zulassen“ bzw. der Entwicklermodus aktiviert sein.

**Schritt 2: Skript installieren**

[![Installieren](https://img.shields.io/badge/Installieren-Skript-00aa00?style=for-the-badge&logo=tampermonkey)](https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/script.user.js)

*(Alternativ: Inhalt von `script.user.js` kopieren und in Tampermonkey als neues Skript einfügen.)*

---

## 🛠️ Bedienung

1. Auf Kleinanzeigen.de **einloggen**, denn Melden setzt in der Regel ein Konto voraus.
2. Ganz normal suchen, z. B. in der Kategorie Autos.
3. Bei einer unsauberen Anzeige rechts neben dem Preis auf **„Melden“** klicken.
4. Im Overlay im offiziellen Dialog den Grund wählen und absenden.
5. Das Overlay schließt sich, und der Button zeigt **„Gemeldet“**.

Schließen kannst du das Overlay jederzeit mit **Esc**, mit **×** oder per Klick neben das Fenster.

---

## 🔧 Wie es technisch funktioniert

| Seite | Was passiert |
|---|---|
| Suchergebnisse (`/s-…`) | Das Script erkennt die Anzeigen-Karten über ihre Links auf `/s-anzeige/…` und setzt den Button in die Preiszeile. Nachgeladene Ergebnisse werden per `MutationObserver` ebenfalls erfasst. |
| Overlay | Ein `iframe` lädt die Anzeige mit dem Hash `#klm-report`. |
| Detailseite im iframe | Dasselbe Script erkennt den Hash, klickt auf „Anzeige melden“, hebt den Dialog hervor und meldet den Status per `postMessage` an die Übersicht zurück. |

Alle Selektoren und Texte, an denen sich das Script orientiert, stehen gesammelt im `CONFIG`-Block am Anfang von `script.user.js`.

---

## ⚠️ Stand & bekannte Grenzen (v0.1.0)

Diese erste Version wurde **nur gegen eine nachgebaute Testseite** geprüft, nicht gegen die Live-Seite von Kleinanzeigen. Diese Punkte sind deshalb noch ungeprüft:

* ob Kleinanzeigen das Einbetten der Detailseite im iframe erlaubt (sonst Hinweis und Popup-Fallback),
* der genaue Wortlaut bzw. Aufbau des „Anzeige melden“-Buttons und des Dialogs,
* der Text, den Kleinanzeigen nach erfolgreicher Meldung anzeigt (für die automatische „Gemeldet“-Markierung).

**Hilf mit:** Wenn etwas nicht klappt, öffne ein Issue und hänge Folgendes an (DevTools → Element → Rechtsklick → *Copy → Copy outerHTML*):

1. das HTML **einer Anzeigen-Karte** aus den Suchergebnissen,
2. das HTML des **„Anzeige melden“-Buttons** und des **geöffneten Melden-Dialogs** auf der Detailseite,
3. den Text, der nach dem Absenden erscheint.

Bitte **keine** Cookies, Tokens oder persönlichen Daten mitschicken.

---

## 🗺️ Ideen für später

* Vollständig unsichtbares Melden: Grund direkt im Overlay wählen, sobald der Dialog-Aufbau bekannt ist.
* Optionale Hervorhebung verdächtiger Anzeigen (z. B. 1–15 € bei Autos).
* Browser-Extension (Chrome/Edge/Firefox) auf Basis desselben Codes.

---

## ⚖️ Disclaimer

> Dieses Skript ist ein inoffizielles Tool und steht in keiner Verbindung zu Kleinanzeigen. Die Nutzung erfolgt auf eigene Gefahr. Bitte melde nur Anzeigen, die tatsächlich gegen die Regeln verstoßen. Missbräuchliche Massenmeldungen können zur Sperrung deines Kontos führen.

* Es liest keine Passwörter oder Nachrichten aus.
* Es nutzt keine externen Server, alles läuft lokal in deinem Browser.
* Inspiriert vom Aufbau des Userscripts [Kleinanzeigen.de – Anzeige duplizieren & neu einstellen](https://github.com/Zer089/Kleinanzeigen.de-Anzeige_duplizieren_neu_einstellen) von Zer089 (MIT).

---

## 📜 Lizenz

[MIT](LICENSE) © 2026 RainbowLabsInc
