<div align="center">

# 🚩 Kleinanzeigen – Anzeige melden

**Unsaubere Anzeigen direkt aus der Suchergebnis-Übersicht melden, mit einem Klick und ohne die Liste zu verlassen.**

[![Version](https://img.shields.io/badge/version-0.2.0-blue?style=flat-square)](https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/script.user.js)
[![Plattform](https://img.shields.io/badge/plattform-Kleinanzeigen.de-green?style=flat-square)](https://www.kleinanzeigen.de)
[![Userscript](https://img.shields.io/badge/Tampermonkey-Violentmonkey-black?style=flat-square&logo=tampermonkey)](#%EF%B8%8F-installation)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20RainbowlabsInc-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/rainbowlabsinc)

*Chrome · Firefox · Edge · Kein Server · Kein Tracking · Nur offizieller Melden-Weg*

</div>

---

Wer auf Kleinanzeigen nach Autos, Elektronik oder Wohnungen sucht, kennt das: **„2 € VB“**, **„6 € VB“**, **„15 € VB“**, und im Text steht dann ein ganz anderer Preis, „Tausch möglich“ oder „Preis ist nicht der Preis“. Solche Lockpreis-Anzeigen schieben sich nach oben, verfälschen die Sortierung nach Preis und kosten allen Zeit.

Melden kann man sie, aber dafür muss man jede Anzeige öffnen, nach unten scrollen, „Anzeige melden“ suchen und danach zurück zur Liste. Dabei geht oft die Scroll-Position verloren.

**Dieses Userscript setzt einen „Melden“-Button direkt neben den Preis jeder Anzeige in der Übersicht.** Ein Klick öffnet den **offiziellen Melden-Dialog** von Kleinanzeigen in einem kleinen Fenster. Du wählst den Grund, schickst ab, und das Fenster schließt sich wieder. Deine Suchergebnisse bleiben dabei unverändert offen.

---

## ✨ Features

* 🚩 **Melden-Button in der Übersicht:** Er sitzt in jeder Anzeigen-Karte rechts neben dem Preis und fügt sich ins Kleinanzeigen-Design ein.
* 🪟 **Kleines Melden-Fenster:** Die Anzeige öffnet sich in einem Popup. Das Script klickt dort automatisch auf „Anzeige melden“ und blendet alles außer dem Dialog aus.
* 📌 **Übersicht bleibt, wo sie ist:** Kein Seitenwechsel, kein Zurück-Button. Scroll-Position, Filter und Seite bleiben erhalten.
* ✅ **„Gemeldet“-Markierung:** Nach dem Absenden wird der Button grün und bleibt lokal in deinem Browser gespeichert. So meldest du nichts doppelt.
* 💬 **Statusleiste:** Unten in der Übersicht siehst du, was gerade passiert. Schließt du das Fenster ohne erkannte Meldung, fragt das Script nach, ob du die Anzeige als gemeldet markieren willst.
* 🛡️ **Nur offizieller Weg:** Das Script sendet **keine** eigenen Requests an Kleinanzeigen. Gemeldet wird ausschließlich über den originalen Dialog der Plattform.
* 🔒 **Strikt begrenzt:** Es läuft nur auf `https://www.kleinanzeigen.de` und dort nur auf Such- und Anzeigenseiten.

---

## ⚙️ Installation

**Schritt 1: Userscript-Erweiterung installieren** (kostenlos)

| Browser | Erweiterung |
|---|---|
| Chrome / Edge | [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) oder [Violentmonkey](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) |
| Firefox | [Tampermonkey](https://addons.mozilla.org/de/firefox/addon/tampermonkey/) oder [Violentmonkey](https://addons.mozilla.org/de/firefox/addon/violentmonkey/) |

> **Chrome/Edge:** Bei neueren Tampermonkey-Versionen muss in den Erweiterungs-Details „Benutzerskripte zulassen“ bzw. der Entwicklermodus aktiviert sein.

**Schritt 2: Skript installieren**

[![Installieren](https://img.shields.io/badge/Installieren-Skript-00aa00?style=for-the-badge&logo=tampermonkey)](https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/script.user.js)

*(Alternativ: Inhalt von `script.user.js` kopieren und in Tampermonkey als neues Skript einfügen.)*

Updates holt sich Tampermonkey automatisch aus diesem Repo.

---

## 🛠️ Bedienung

1. Auf Kleinanzeigen.de **einloggen**, denn Melden setzt ein Konto voraus.
2. Ganz normal suchen, z. B. in der Kategorie Autos.
3. Bei einer unsauberen Anzeige rechts neben dem Preis auf **„Melden“** klicken.
4. Im kleinen Fenster den Grund wählen und absenden.
5. Das Fenster schließt sich, und der Button zeigt **„Gemeldet“**.

> Falls der Browser das Fenster blockiert, erscheint unten ein Hinweis. Erlaube dann Popups für `kleinanzeigen.de`, oder öffne die Anzeige über den Hinweis in einem neuen Tab.

---

## 🔧 Wie es technisch funktioniert

| Seite | Was passiert |
|---|---|
| Suchergebnisse (`/s-…`) | Das Script erkennt die Anzeigen-Karten über ihre Links auf `/s-anzeige/…` und setzt den Button in die Preiszeile. Nachgeladene Ergebnisse werden per `MutationObserver` ebenfalls erfasst. |
| Klick auf „Melden“ | Die Anzeige wird mit dem Hash `#klm-report` in einem Popup-Fenster geöffnet. |
| Anzeige im Popup | Dasselbe Script erkennt den Hash, klickt auf „Anzeige melden“, hebt den Dialog hervor und meldet den Status per `postMessage` an die Übersicht zurück. |

> **Warum kein Overlay direkt auf der Seite?** Kleinanzeigen verbietet das Einbetten seiner Seiten in andere Seiten (Schutz gegen Clickjacking). Ein eingebettetes Fenster wird vom Browser blockiert, deshalb der Weg über ein eigenes kleines Fenster.

Alle Selektoren und Texte, an denen sich das Script orientiert, stehen gesammelt im `CONFIG`-Block am Anfang von `script.user.js`.

---

## ⚠️ Stand & bekannte Grenzen

Das Projekt ist noch jung. Der Ablauf ist gegen eine nachgebaute Testseite geprüft, aber noch **nicht vollständig gegen die Live-Seite** von Kleinanzeigen. Ungeprüft sind vor allem:

* der genaue Wortlaut bzw. Aufbau des „Anzeige melden“-Buttons und des Dialogs,
* der Text, den Kleinanzeigen nach erfolgreicher Meldung anzeigt. Davon hängt die automatische „Gemeldet“-Markierung ab. Wird er nicht erkannt, hilft die Nachfrage in der Statusleiste.

**Hilf mit:** Wenn etwas nicht klappt, öffne ein [Issue](https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/issues) und hänge Folgendes an (DevTools → Element → Rechtsklick → *Copy → Copy outerHTML*):

1. das HTML **einer Anzeigen-Karte** aus den Suchergebnissen,
2. das HTML des **„Anzeige melden“-Buttons** und des **geöffneten Melden-Dialogs**,
3. den Text, der nach dem Absenden erscheint.

Bitte **keine** Cookies, Tokens oder persönlichen Daten mitschicken.

---

## 🗺️ Ideen für später

* Grund direkt in der Übersicht auswählen, sobald der Dialog-Aufbau bekannt ist.
* Optionale Hervorhebung verdächtiger Anzeigen (z. B. 1–15 € bei Autos).
* Browser-Extension (Chrome/Edge/Firefox) auf Basis desselben Codes.

---

## ⚖️ Disclaimer

> Dieses Skript ist ein inoffizielles Tool und steht in keiner Verbindung zu Kleinanzeigen. Die Nutzung erfolgt auf eigene Gefahr. Bitte melde nur Anzeigen, die tatsächlich gegen die Regeln verstoßen. Missbräuchliche Massenmeldungen können zur Sperrung deines Kontos führen.

* Es liest keine Passwörter oder Nachrichten aus.
* Es nutzt keine externen Server, alles läuft lokal in deinem Browser.
* Es läuft **ausschließlich auf `https://www.kleinanzeigen.de`**, und dort nur auf Such- und Anzeigenseiten (`/s-…`). Auf allen anderen Websites ist es inaktiv.
* Inspiriert vom Aufbau des Userscripts [Kleinanzeigen.de – Anzeige duplizieren & neu einstellen](https://github.com/Zer089/Kleinanzeigen.de-Anzeige_duplizieren_neu_einstellen) von Zer089 (MIT).

---

## ☕ Unterstütze das Projekt

<a href="https://ko-fi.com/rainbowlabsinc" target="_blank">
  <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support on Ko-fi" height="36">
</a>

Dieses Userscript ist ein kostenloses Open-Source-Hobbyprojekt. Wenn es dir Zeit und Nerven bei der Suche auf Kleinanzeigen spart, freue ich mich über einen Kaffee. Jeder Beitrag fließt direkt in die Weiterentwicklung dieses und weiterer Projekte.

---

## 📄 Lizenz

MIT License: frei nutzbar, veränderbar und weitergebbar. Siehe [LICENSE](LICENSE).

---

<div align="center">

**Made with ❤️ by RainbowlabsInc**

[Installieren](https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/script.user.js) · [Issues](https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/issues) · [☕ Spenden](https://ko-fi.com/rainbowlabsinc)

</div>
