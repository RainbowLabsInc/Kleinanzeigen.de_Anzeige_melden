// ==UserScript==
// @name          Kleinanzeigen - Anzeige melden (aus der Übersicht)
// @namespace     https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden
// @description   Fügt in der Suchergebnis-Übersicht von Kleinanzeigen.de neben dem Preis einen "Melden"-Button ein. Grund und Text wählst du direkt in der Übersicht aus selbst konfigurierbaren Bausteinen – oder öffnest den offiziellen Melden-Dialog in einem kleinen Popup.
// @author        RainbowlabsInc
// @copyright     2026, RainbowlabsInc
// @license       MIT
// @version       0.4.5
// @icon          https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/assets/icon48.png
// @homepage      https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden
// @updateURL     https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/script.user.js
// @downloadURL   https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/script.user.js
// @match         https://www.kleinanzeigen.de/
// @match         https://www.kleinanzeigen.de/?*
// @match         https://www.kleinanzeigen.de/s-*
// @grant         none
// @run-at        document-idle
// ==/UserScript==

/*
 * Funktionsweise
 * --------------
 * 1. Übersicht (Suchergebnisse, /s-..., und die Startseite):
 *    Jede Anzeigen-Karte bekommt neben dem Preis einen "Melden"-Button.
 *    Ein Klick öffnet ein kleines Menü direkt am Button: Baustein (Grund + Text) wählen,
 *    Text bei Bedarf anpassen, Meldung bestätigen, absenden.
 *    Gesendet wird genau die Anfrage, die auch der offizielle Melden-Dialog schickt
 *    (POST /flags/ads/<id>.json mit dem Sicherheits-Token der Anzeigenseite).
 *    Pro Klick wird genau eine Anzeige gemeldet, jeweils mit Bestätigung.
 *
 * 2. Rückfall "Offiziellen Dialog öffnen":
 *    Die Anzeige öffnet sich in einem kleinen Popup-Fenster (URL-Hash #klm-report).
 *    (Ein eingebettetes iframe ist nicht möglich: Kleinanzeigen verbietet das Einbetten
 *    seiner Seiten per X-Frame-Options/CSP.) Das Script klickt dort "Anzeige melden",
 *    blendet alles außer dem Dialog aus und meldet den Status per postMessage zurück;
 *    nach dem Absenden schließt sich das Popup selbst.
 *
 * Hinweis: Kleinanzeigen ändert das Frontend häufig. Das Script sucht Elemente daher
 * zuerst über feste Merkmale (z. B. die ID des Melden-Buttons) und fällt sonst auf
 * Text und Struktur zurück. Alle Selektoren und Texte stehen gesammelt in CONFIG.
 */

(function () {
    'use strict';

    const CONFIG = {
        hash: '#klm-report',
        msgType: 'klm-report',
        // Fenstername des Popups – bleibt erhalten, auch wenn die Seite den URL-Hash entfernt
        popupName: 'klm-report',
        storageKey: 'klm-reported-ads',
        // Wie lange auf den Melden-Button / -Dialog gewartet wird
        triggerTimeoutMs: 10000,
        // Abstand zwischen Klick-Versuchen auf den Melden-Button
        clickRetryMs: 1500,
        // Größe des Popup-Fensters
        popupWidth: 600,
        popupHeight: 780,
        // Offizieller Melden-Button auf der Detailseite (Stand 10/2026: <button id="viewad-action-flag-link">)
        triggerSelectors: ['#viewad-action-flag-link'],
        // Fallback über den Text, falls sich die ID ändert
        triggerText: /^\s*(anzeige\s+)?melden\s*$/i,
        triggerTextLoose: /anzeige\s+melden/i,
        // Mögliche Container des Melden-Dialogs
        dialogSelectors: [
            '[role="dialog"]',
            '[aria-modal="true"]',
            'dialog[open]',
            '.mfp-content',
            '.modal-dialog',
        ],
        // Beschriftung des Absenden-Buttons im Melden-Dialog
        submitText: /(absenden|abschicken|senden|melden)/i,
        // Texte, die nach erfolgreichem Absenden erscheinen können (zusätzlich zur
        // Erkennung der Bestätigungsansicht ohne Eingabefelder)
        successText: /(vielen dank|danke für (deine|ihre) meldung|erfolgreich gemeldet|meldung (wurde )?(erhalten|gesendet|übermittelt))/i,

        // Direktes Melden aus der Übersicht (Stand 10/2026, aus dem offiziellen Dialog abgelesen)
        flagUrl: (adId) => `/flags/ads/${encodeURIComponent(adId)}.json`,
        textMaxLength: 500,
        templatesKey: 'klm-templates',
        lastTemplateKey: 'klm-last-template',
        userNameKey: 'klm-user-name',
        // Gesendet wird die reasonId der zweiten Ebene. Bisher bekannt sind nur die
        // Unterpunkte von "Verdächtiger oder betrügerischer Inhalt"; alle anderen Gründe
        // gehen über den offiziellen Dialog.
        reasonGroup: 'Verdächtiger oder betrügerischer Inhalt',
        reasons: [
            { id: 'FRAUD_SUSPICIOUS_PRICE', label: 'Verdächtiger Preis' },
            { id: 'FRAUD_IDENTITY_THEFT', label: 'Identitätsdiebstahl/-missbrauch' },
            { id: 'FRAUD_SUSPICIOUS_EXCHANGES_WITH_SELLER', label: 'Verdächtiges Verhalten' },
            { id: 'FRAUD_OTHER', label: 'Anderer Verstoß (verdächtiger Inhalt)' },
        ],
        // Fertige Bausteine; Platzhalter: {titel}, {preis}, {id}, {link}
        defaultTemplates: [
            { name: 'Lockpreis', reasonId: 'FRAUD_SUSPICIOUS_PRICE',
                text: 'Der angegebene Preis ({preis}) ist nicht der tatsächliche Verkaufspreis. Laut Beschreibung wird ein deutlich anderer Preis verlangt.' },
            { name: 'Platzhalter-Preis für die Sortierung', reasonId: 'FRAUD_SUSPICIOUS_PRICE',
                text: 'Der Preis {preis} ist nur ein Platzhalter, damit die Anzeige bei der Sortierung nach Preis ganz oben erscheint.' },
            { name: 'Nur Tausch statt Verkauf', reasonId: 'FRAUD_SUSPICIOUS_PRICE',
                text: 'Angegeben ist ein Preis von {preis}, laut Beschreibung wird aber nur getauscht und nicht verkauft.' },
            { name: 'Verdacht auf Betrug', reasonId: 'FRAUD_OTHER',
                text: 'Die Anzeige wirkt betrügerisch: ' },
        ],
        // Bestätigung wie im offiziellen Dialog
        confirmText: 'Ich bestätige, dass ich diese Meldung in gutem Glauben abgebe und sie auf einem tatsächlichen Verstoß der Grundsätze basiert. Mir ist bewusst, dass falsche Meldungen Konsequenzen haben können.',
    };

    // Nur auf kleinanzeigen.de laufen – zusätzlich zu @match, falls der Script-Manager
    // die Header ignoriert oder das Script manuell mit breiteren Regeln eingebunden wird.
    const ALLOWED_HOST = 'www.kleinanzeigen.de';
    if (window.location.protocol !== 'https:' || window.location.hostname !== ALLOWED_HOST) return;

    // Es gibt zwei Varianten dieses Scripts (Bausteine / offizieller Dialog). Sind beide
    // installiert, arbeitet nur die zuerst gestartete – sonst gäbe es doppelte Buttons und Klicks.
    const root = document.documentElement;
    if (root.hasAttribute('data-klm-variant')) {
        console.warn(`[Anzeige melden] Variante "${root.getAttribute('data-klm-variant')}" ist bereits aktiv, "bausteine" bleibt inaktiv. Bitte nur eine Variante installieren.`);
        return;
    }
    root.setAttribute('data-klm-variant', 'bausteine');

    const path = window.location.pathname;
    const isDetailPage = path.startsWith('/s-anzeige/');
    // Übersicht: Suchergebnisse und Bestandslisten (/s-…) sowie die Startseite
    const isSearchPage = (path === '/' || path.startsWith('/s-')) && !isDetailPage;

    // ------------------------------------------------------------------
    // Gemeinsame Helfer
    // ------------------------------------------------------------------

    function isVisible(el) {
        if (!el || !el.isConnected) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function getAdIdFromUrl(url) {
        // /s-anzeige/<slug>/<adId>-<kategorie>-<ort>
        const m = String(url).match(/\/s-anzeige\/[^/]+\/(\d+)/);
        return m ? m[1] : null;
    }

    function loadReported() {
        try {
            return JSON.parse(localStorage.getItem(CONFIG.storageKey) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function saveReported(adId) {
        try {
            const data = loadReported();
            data[adId] = Date.now();
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
        } catch (e) { /* Storage nicht verfügbar – Markierung gilt nur bis zum Neuladen */ }
    }

    // RainbowLabsInc-Logo (48x48 PNG, eingebettet – das Script lädt nichts von externen Servern)
    const logoDataUri = 'data:image/png;base64,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';
    const logoImg = `<img class="klm-logo" src="${logoDataUri}" alt="" aria-hidden="true" width="20" height="20">`;

    const checkSvg = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    // ------------------------------------------------------------------
    // Teil 1: Detailseite im Popup – Melden-Dialog automatisch öffnen
    // ------------------------------------------------------------------

    function runReportPopup() {
        const target = window.opener;
        const adId = getAdIdFromUrl(window.location.href);

        function post(status, extra = {}) {
            if (!target) return;
            try {
                target.postMessage({ type: CONFIG.msgType, status, adId, ...extra }, window.location.origin);
            } catch (e) { /* Opener geschlossen */ }
        }

        const style = document.createElement('style');
        style.textContent = `
            html.klm-focus, html.klm-focus body { background: transparent !important; overflow: hidden !important; }
            html.klm-focus body * { visibility: hidden !important; }
            html.klm-focus [data-klm-dialog], html.klm-focus [data-klm-dialog] * { visibility: visible !important; }
        `;
        document.head.appendChild(style);

        function findTrigger() {
            for (const sel of CONFIG.triggerSelectors) {
                const el = Array.from(document.querySelectorAll(sel)).find(isVisible);
                if (el) return el;
            }
            // Nur sichtbare Kandidaten – Kleinanzeigen rendert Buttons teils doppelt (Desktop/Mobil)
            const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], [role="menuitem"]')).filter(isVisible);
            const byText = (re) => candidates.find(el => {
                const label = [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' ');
                return re.test(label.trim());
            });
            return byText(CONFIG.triggerText) || byText(CONFIG.triggerTextLoose) || null;
        }

        // Dialoge/Formulare, die schon vor dem Klick da waren (z. B. Cookie-Banner, Suchfeld), ignorieren
        let preExisting = new Set();
        const allDialogs = () => CONFIG.dialogSelectors.flatMap(sel => Array.from(document.querySelectorAll(sel)));
        const allForms = () => Array.from(document.querySelectorAll('form, [role="radiogroup"]'));

        function findDialog() {
            const dialog = allDialogs().find(el => !preExisting.has(el) && isVisible(el));
            if (dialog) return dialog;
            // Fallback: neu aufgetauchtes Formular mit Auswahlfeldern rund ums Melden
            const form = allForms().find(el => !preExisting.has(el) && isVisible(el)
                && el.querySelector('input, textarea, select') && /meld|grund/i.test(el.textContent));
            if (!form) return null;
            // Bis zum fixierten Container (Modal) hochlaufen, sonst das Formular selbst nehmen
            for (let el = form; el && el !== document.body; el = el.parentElement) {
                if (getComputedStyle(el).position === 'fixed') return el;
            }
            return form;
        }

        function pageShowsSuccess() {
            return CONFIG.successText.test(document.body ? document.body.innerText : '');
        }

        function waitFor(fn, timeoutMs) {
            return new Promise(resolve => {
                const found = fn();
                if (found) return resolve(found);
                const obs = new MutationObserver(() => {
                    const hit = fn();
                    if (hit) { obs.disconnect(); clearTimeout(timer); resolve(hit); }
                });
                obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
                const timer = setTimeout(() => { obs.disconnect(); resolve(fn() || null); }, timeoutMs);
            });
        }

        function watchDialog(dialog) {
            let finished = false;
            let closing = false;
            let submitted = false;

            // Popup schließen – egal ob gemeldet oder abgebrochen. Die Übersicht fragt
            // selbst nach, falls keine Meldung erkannt wurde.
            const finish = (success) => {
                if (finished) return;
                finished = true;
                obs.disconnect();
                document.removeEventListener('click', onClick, true);
                document.removeEventListener('submit', onSubmit, true);
                document.documentElement.classList.remove('klm-focus');
                post('closed', { success });
                if (target) setTimeout(() => window.close(), success ? 1500 : 300);
            };

            // Klick auf "Absenden"/"Melden" im Dialog merken
            const onClick = (e) => {
                const btn = e.target.closest('button, [type="submit"], [role="button"]');
                if (btn && dialog.contains(btn) && CONFIG.submitText.test(btn.textContent || btn.value || '')) {
                    submitted = true;
                }
            };
            const onSubmit = (e) => { if (dialog.contains(e.target)) submitted = true; };
            document.addEventListener('click', onClick, true);
            document.addEventListener('submit', onSubmit, true);

            // Nach dem Absenden zeigt der Dialog eine Bestätigung ohne Eingabefelder
            const showsConfirmation = () => submitted && isVisible(dialog)
                && !Array.from(dialog.querySelectorAll('input:not([type="hidden"]), textarea, select')).some(isVisible);

            const obs = new MutationObserver(() => {
                if (closing || finished) return;
                // Erfolg, während der Dialog noch offen ist (Danke-Text oder Bestätigungsansicht)
                if (pageShowsSuccess() || showsConfirmation()) {
                    closing = true;
                    post('success');
                    finish(true);
                    return;
                }
                // Dialog geschlossen? (entfernt oder unsichtbar, und kein neuer Dialog offen)
                if (!isVisible(dialog)) {
                    const next = findDialog();
                    if (next && next !== dialog) {
                        // Dialog wurde ersetzt (z. B. Schritt 2 / Danke-Seite) – weiter beobachten
                        dialog.removeAttribute('data-klm-dialog');
                        dialog = next;
                        dialog.setAttribute('data-klm-dialog', '');
                        return;
                    }
                    // Fokus-Modus aufheben, damit innerText auch Toasts außerhalb des Dialogs sieht,
                    // dann kurz warten – eine Erfolgsmeldung kann erst nach dem Schließen erscheinen
                    closing = true;
                    document.documentElement.classList.remove('klm-focus');
                    setTimeout(() => finish(submitted || pageShowsSuccess()), 1200);
                }
            });
            obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        }

        (async () => {
            const trigger = await waitFor(findTrigger, CONFIG.triggerTimeoutMs);
            if (!trigger) {
                post('trigger-not-found');
                return;
            }
            preExisting = new Set([...allDialogs(), ...allForms()].filter(isVisible));
            trigger.scrollIntoView({ block: 'center' });

            // Der Button ist oft schon sichtbar, bevor React die Klick-Logik angehängt hat.
            // Darum mehrfach klicken, bis der Dialog erscheint.
            let dialog = null;
            const deadline = Date.now() + CONFIG.triggerTimeoutMs;
            while (!dialog && Date.now() < deadline) {
                const btn = findTrigger() || trigger;
                btn.click();
                dialog = await waitFor(findDialog, CONFIG.clickRetryMs);
            }
            if (!dialog) {
                post('dialog-not-found');
                return;
            }
            dialog.setAttribute('data-klm-dialog', '');
            document.documentElement.classList.add('klm-focus');
            post('dialog-open');
            watchDialog(dialog);
        })();
    }

    // ------------------------------------------------------------------
    // Teil 2: Übersicht – Melden-Buttons einfügen + Popup steuern
    // ------------------------------------------------------------------

    function runOverview() {
        injectOverviewStyles();

        let scheduled = false;
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => { scheduled = false; injectButtons(); });
        };
        injectButtons();
        new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

        window.addEventListener('message', onPopupMessage);
    }

    // Die Seite baut Teile des Dokuments nach dem Laden neu auf; dann die Styles erneut einhängen
    const overviewStyle = document.createElement('style');
    const ensureOverviewStyles = () => { if (!overviewStyle.isConnected) (document.head || document.documentElement).appendChild(overviewStyle); };

    function injectOverviewStyles() {
        const style = overviewStyle;
        style.textContent = `
            .klm-price-row { display: flex !important; align-items: center; flex-wrap: wrap; gap: 8px; }
            /* Wrapper: der Button darin ist ein atomares Inline-Element und erbt so keine Link-Unterstreichung der Karte */
            .klm-wrap { margin-left: auto; display: block; }
            .kx-btn-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; margin: 6px 0 0; }
            .klm-btn {
                display: inline-flex; align-items: center; gap: 6px;
                padding: 4px 12px; border-radius: 999px;
                border: 1px solid #d0d0cc; background: #fff; color: #555;
                font: inherit; font-size: 13px; font-weight: 600; line-height: 20px;
                cursor: pointer; white-space: nowrap; text-decoration: none;
                transition: background-color .15s, border-color .15s, color .15s;
            }
            .klm-logo { width: 20px; height: 20px; border-radius: 5px; flex: none; display: block; margin-left: -6px; }
            .klm-btn:hover, .klm-btn:focus-visible { border-color: #c62828; color: #c62828; background: #fdecea; outline: none; }
            .klm-btn[data-state="reported"] { border-color: #a5d6a7; color: #2e7d32; background: #edf7ee; }
            .klm-btn[data-state="busy"] { opacity: .6; cursor: progress; }

            .klm-toast {
                position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
                z-index: 2147483000; max-width: min(560px, calc(100vw - 32px));
                display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px;
                padding: 10px 14px; border-radius: 10px;
                background: #1e1e1e; color: #fff; font: inherit; font-size: 14px; line-height: 1.4;
                box-shadow: 0 8px 24px rgba(0,0,0,.25);
            }
            .klm-toast[data-kind="ok"] { background: #2e7d32; }
            .klm-toast[data-kind="warn"] { background: #8a4b00; }
            .klm-toast-text { flex: 1 1 220px; }
            .klm-toast button {
                padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,.6);
                background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer;
            }
            .klm-toast button:hover { background: rgba(255,255,255,.15); }

            .klm-menu {
                position: absolute; z-index: 2147482000; box-sizing: border-box;
                max-height: calc(100vh - 32px); overflow: auto;
                background: #fff; color: #1e1e1e; border: 1px solid #d0d0cc; border-radius: 12px;
                box-shadow: 0 12px 32px rgba(0,0,0,.22);
                font: inherit; font-size: 14px; line-height: 1.4; text-align: left;
            }
            .klm-menu *, .klm-menu *::before, .klm-menu *::after { box-sizing: border-box; }
            .klm-menu-head {
                position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px;
                padding: 10px 10px 10px 14px; background: #fff; border-bottom: 1px solid #eceae6;
            }
            .klm-menu-title { flex: 1; min-width: 0; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .klm-menu-body { padding: 12px 14px 14px; display: grid; gap: 12px; }
            .klm-menu button, .klm-menu input, .klm-menu select, .klm-menu textarea { font: inherit; font-size: 14px; color: inherit; }
            .klm-icon-btn {
                flex: none; width: 32px; height: 32px; display: inline-grid; place-items: center;
                border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-size: 18px; line-height: 1;
            }
            .klm-icon-btn:hover, .klm-icon-btn:focus-visible { background: #f2f1ee; outline: none; }
            .klm-list { display: grid; gap: 4px; margin: 0; padding: 0; border: 0; }
            .klm-option {
                display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px;
                border: 1px solid #e3e1dc; border-radius: 8px; cursor: pointer;
            }
            .klm-option:hover { border-color: #c62828; }
            .klm-option:has(input:checked) { border-color: #c62828; background: #fdecea; }
            .klm-option input { margin: 3px 0 0; accent-color: #c62828; flex: none; }
            .klm-option-name { font-weight: 600; display: block; }
            .klm-option-reason { display: block; font-size: 12px; color: #6b6b6b; }
            .klm-field { display: grid; gap: 4px; }
            .klm-field > span { font-size: 12px; font-weight: 600; color: #555; }
            .klm-input {
                width: 100%; padding: 8px 10px; border: 1px solid #c9c7c2; border-radius: 8px; background: #fff;
            }
            .klm-input:focus { outline: 2px solid #1e1e1e; outline-offset: -1px; }
            textarea.klm-input { resize: vertical; min-height: 96px; }
            .klm-counter { justify-self: end; font-size: 12px; color: #6b6b6b; }
            .klm-confirm { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: #444; cursor: pointer; }
            .klm-confirm input { margin: 2px 0 0; accent-color: #c62828; flex: none; }
            .klm-note { margin: 0; padding: 8px 10px; border-radius: 8px; background: #f2f1ee; font-size: 13px; }
            .klm-note[data-kind="error"] { background: #fdecea; color: #8e1c1c; }
            .klm-note[data-kind="ok"] { background: #edf7ee; color: #1f5e23; }
            .klm-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
            .klm-actions .klm-spacer { flex: 1; }
            .klm-action {
                padding: 7px 14px; border-radius: 999px; border: 1px solid #c9c7c2; background: #fff;
                font-weight: 600; cursor: pointer; white-space: nowrap;
            }
            .klm-action:hover:not(:disabled), .klm-action:focus-visible { border-color: #1e1e1e; outline: none; }
            .klm-action[data-primary] { background: #c62828; border-color: #c62828; color: #fff; }
            .klm-action[data-primary]:hover:not(:disabled) { background: #a51f1f; border-color: #a51f1f; }
            .klm-action:disabled { opacity: .45; cursor: not-allowed; }
            .klm-link {
                justify-self: start; padding: 0; border: 0; background: none; color: #555; text-decoration: underline;
                font-size: 13px; cursor: pointer;
            }
            .klm-link:hover { color: #c62828; }
            .klm-tpl { display: grid; gap: 8px; padding: 10px; border: 1px solid #e3e1dc; border-radius: 8px; }
            .klm-tpl-head { display: flex; gap: 4px; align-items: center; }
            .klm-tpl-head .klm-input { flex: 1; font-weight: 600; }
            .klm-tpl-head .klm-icon-btn { width: 28px; height: 28px; font-size: 15px; }
            .klm-tpl-head .klm-icon-btn:disabled { opacity: .3; cursor: default; background: transparent; }
            .klm-hint { margin: 0; font-size: 12px; color: #6b6b6b; }
            .klm-hint code { font-size: 12px; background: #f2f1ee; padding: 0 3px; border-radius: 3px; }
        `;
        ensureOverviewStyles();
    }

    function findAdCards() {
        const cards = new Set();

        // Klassisches Layout
        document.querySelectorAll('article.aditem[data-adid]').forEach(el => cards.add(el));

        // Generisch: vom Anzeigen-Link so weit nach oben laufen, wie der Container
        // nur Links auf genau diese eine Anzeige enthält -> das ist die Karte.
        document.querySelectorAll('a[href*="/s-anzeige/"]').forEach(link => {
            if (link.closest('article.aditem[data-adid]')) return;
            // Karte schon versorgt? Nur überspringen, solange ihr Button noch da ist
            const done = link.closest('[data-klm-injected]');
            if (done && done.querySelector('.klm-btn')) return;
            const adId = getAdIdFromUrl(link.href);
            if (!adId) return;
            let card = null;
            let el = link.parentElement;
            while (el && el !== document.body && containsOnlyAd(el, adId)) {
                card = el;
                el = el.parentElement;
            }
            if (card) cards.add(card);
        });

        return Array.from(cards);
    }

    function containsOnlyAd(el, adId) {
        return Array.from(el.querySelectorAll('a[href*="/s-anzeige/"]'))
            .every(a => getAdIdFromUrl(a.href) === adId);
    }

    function getCardInfo(card) {
        const link = card.querySelector('a[href*="/s-anzeige/"]');
        const href = card.dataset.href ? new URL(card.dataset.href, location.origin).href : (link ? link.href : null);
        const adId = card.dataset.adid || (href ? getAdIdFromUrl(href) : null);
        const titleEl = card.querySelector('h2, h3, .text-module-begin a, .ellipsis');
        const title = (titleEl ? titleEl.textContent : (link ? link.textContent : '')).trim();
        return { href, adId, title };
    }

    // Preis-Bestandteile: "2 €", "3.399 €", "VB", "Zu verschenken", "ab"
    const pricePartsRe = /\d[\d.,]*\s*€|zu verschenken|VB|ab/gi;

    function isPriceOnly(text) {
        const t = text.trim();
        // „VB“ allein (Verhandlungsbasis ohne Betrag) zählt auch als Preis
        return t.length > 0 && (/€|zu verschenken/i.test(t) || /^vb$/i.test(t)) && t.replace(pricePartsRe, '').replace(/\s+/g, '') === '';
    }

    // Buttons dieses und anderer Scripts (Nutzer ausblenden, Superscript) beim Lesen des Preises
    // ignorieren. Sonst findet das zweite Script die Preiszeile nicht mehr, sobald das erste seinen
    // Button hineingesetzt hat, und setzt keinen Button.
    const FOREIGN_UI = '.klm-wrap, .kua-ui, .kps-ui, .kss-ui';

    function textWithoutUi(node) {
        let text = node.textContent;
        node.querySelectorAll(FOREIGN_UI).forEach(ui => { text = text.split(ui.textContent).join(''); });
        return text;
    }

    // Reines Preis-Element: keine eigenen Kind-Elemente außer fremden Buttons, nur Preistext
    const isPriceLeaf = (el) => Array.from(el.children).every(c => c.matches(FOREIGN_UI))
        && !el.closest(FOREIGN_UI) && isPriceOnly(textWithoutUi(el));

    function findPriceRow(card) {
        // Klassisches Layout
        const classic = card.querySelector('.aditem-main--middle--price-shipping');
        if (classic) return classic;

        // Generisch: erstes Element, das nur aus Preistext besteht ...
        const first = Array.from(card.querySelectorAll('p, span, div, strong, b')).find(isPriceLeaf);
        if (!first) return null;

        // ... dann hoch bis zur Zeile, die noch ausschließlich Preise enthält
        // (z. B. "2 € VB" + durchgestrichener Altpreis "3.399 €"), aber keine km/EZ-Tags.
        let row = first;
        while (row.parentElement && row.parentElement !== card && isPriceOnly(textWithoutUi(row.parentElement))) {
            row = row.parentElement;
        }
        return row;
    }

    // Rückfall ohne Preiszeile (z. B. „VB“ ohne Betrag oder „Zu verschenken“ auf der Startseite,
    // wo die Karte dann keinen Preis zeigt): eigene Button-Zeile unter dem Titel. Die Zeile
    // (.kx-btn-row) teilen sich „Anzeige melden“ und „Nutzer ausblenden“, damit beide Buttons
    // nebeneinander stehen.
    function buttonRowFallback(card) {
        const existing = card.querySelector('.kx-btn-row');
        if (existing) return existing;
        const title = card.querySelector('h2, h3, .text-module-begin a, .ellipsis');
        if (!title) return null;
        const link = title.closest('a');
        const anchor = link && link !== card && card.contains(link) ? link : title;
        const row = document.createElement('div');
        row.className = 'kx-btn-row';
        anchor.insertAdjacentElement('afterend', row);
        return row;
    }

    function injectButtons() {
        const reported = loadReported();
        ensureOverviewStyles();

        findAdCards().forEach(card => {
            // Schon da? Baut die Seite die Karte neu auf, fehlt der Button: dann neu einsetzen
            if (card.dataset.klmInjected && card.querySelector('.klm-btn')) return;
            const info = getCardInfo(card);
            if (!info.href || !info.adId) return;

            const row = findPriceRow(card) || buttonRowFallback(card);
            if (!row) return;
            card.dataset.klmInjected = 'true';
            // Aktueller Preis = erstes reines Preis-Element (ohne durchgestrichenen Altpreis)
            const priceEl = [row, ...row.querySelectorAll('*')].find(isPriceLeaf) || row;
            info.price = textWithoutUi(priceEl).replace(/\s+/g, ' ').trim();

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'klm-btn';
            btn.dataset.adid = info.adId;
            setButtonState(btn, reported[info.adId] ? 'reported' : 'idle');

            // Karte ist oft komplett verlinkt – Klick darf nicht zur Anzeige navigieren
            const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
            ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(t => btn.addEventListener(t, e => e.stopPropagation()));
            btn.addEventListener('click', (e) => {
                stop(e);
                if (btn.dataset.state === 'busy') return;
                toggleMenu(info, btn);
            });

            const wrap = document.createElement('span');
            wrap.className = 'klm-wrap';
            wrap.appendChild(btn);
            row.classList.add('klm-price-row');
            row.appendChild(wrap);
        });
    }

    function setButtonState(btn, state) {
        btn.dataset.state = state;
        if (state === 'reported') {
            btn.innerHTML = `${logoImg}${checkSvg}<span>Gemeldet</span>`;
            btn.title = 'Diese Anzeige wurde von dir bereits gemeldet (erneut melden: klicken)';
        } else {
            btn.innerHTML = `${logoImg}<span>Melden</span>`;
            btn.title = 'Anzeige melden, ohne die Übersicht zu verlassen';
        }
    }


    // ------------------------------------------------------------------
    // Bausteine (lokal gespeichert)
    // ------------------------------------------------------------------

    const newId = () => Math.random().toString(36).slice(2, 10);
    const knownReason = (id) => CONFIG.reasons.find(r => r.id === id);

    function loadTemplates() {
        try {
            const list = JSON.parse(localStorage.getItem(CONFIG.templatesKey) || 'null');
            if (Array.isArray(list)) {
                const valid = list.filter(t => t && typeof t.name === 'string' && typeof t.text === 'string' && knownReason(t.reasonId));
                if (valid.length) return valid.map(t => ({ id: t.id || newId(), name: t.name, reasonId: t.reasonId, text: t.text }));
            }
        } catch (e) { /* kaputter Speicher -> Standard */ }
        return defaultTemplates();
    }

    function defaultTemplates() {
        return CONFIG.defaultTemplates.map(t => ({ id: newId(), ...t }));
    }

    function saveTemplates(list) {
        try { localStorage.setItem(CONFIG.templatesKey, JSON.stringify(list)); return true; } catch (e) { return false; }
    }

    function readSetting(key) {
        try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
    }

    function writeSetting(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* egal */ }
    }

    function fillPlaceholders(text, info) {
        const values = {
            titel: info.title || '',
            preis: info.price || '',
            id: info.adId || '',
            link: info.href ? info.href.split('#')[0] : '',
        };
        return text.replace(/\{(titel|preis|id|link)\}/g, (_, key) => values[key]).slice(0, CONFIG.textMaxLength);
    }

    // ------------------------------------------------------------------
    // Direkt melden: Token + Name von der Anzeigenseite, dann derselbe Request wie der Dialog
    // ------------------------------------------------------------------

    function parseReportContext(html) {
        const pick = (patterns) => {
            for (const re of patterns) {
                const m = html.match(re);
                if (m) return m[1];
            }
            return null;
        };
        const token = pick([
            /const csrfToken = "([^"\\]+)"/,
            /"csrfToken":"([^"\\]+)"/,
            /csrfToken&quot;:\[0,&quot;([^&]+)&quot;\]/,
        ]);
        let userName = null;
        const m = html.match(/const loggedInUserName = ("(?:[^"\\]|\\.)*")/);
        if (m) {
            try { userName = JSON.parse(m[1]); } catch (e) { /* egal */ }
        }
        return { token, userName };
    }

    // Lädt die Anzeigenseite (wie beim Öffnen) und liest dort Sicherheits-Token und Namen aus –
    // dieselben Werte, die der offizielle Dialog verwendet.
    async function loadReportContext(info) {
        let ctx = { token: null, userName: null };
        try {
            const res = await fetch(info.href.split('#')[0], { credentials: 'same-origin' });
            if (res.ok) ctx = parseReportContext(await res.text());
        } catch (e) { /* Rückfall unten */ }
        if (!ctx.token) {
            const own = parseReportContext(document.documentElement.innerHTML);
            ctx = { token: own.token, userName: ctx.userName || own.userName };
        }
        return ctx;
    }

    async function sendReport(adId, { reasonId, text, userName, token }) {
        const res = await fetch(CONFIG.flagUrl(adId), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
            body: JSON.stringify([{ reasonId, text, userName, anonymousExplicitContentReport: false }]),
        });
        // Antworttext für die Fehleranzeige (gekürzt, ohne HTML-Tags)
        let detail = '';
        if (!res.ok) {
            try {
                detail = (await res.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
            } catch (e) { /* egal */ }
        }
        return { code: res.status, detail };
    }

    // ------------------------------------------------------------------
    // Melden-Menü an der Karte
    // ------------------------------------------------------------------

    function el(tag, props = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v == null || v === false) continue;
            if (k === 'dataset') Object.assign(node.dataset, v);
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else if (k in node && k !== 'list') node[k] = v;
            else node.setAttribute(k, v === true ? '' : v);
        }
        children.flat().forEach(c => c != null && node.append(c));
        return node;
    }

    let menu = null; // { root, info, btn, ctx, cleanup }

    function toggleMenu(info, btn) {
        if (menu && menu.btn === btn) { closeMenu(); return; }
        openMenu(info, btn);
    }

    function closeMenu() {
        if (!menu) return;
        menu.cleanup();
        menu.root.remove();
        const btn = menu.btn;
        menu = null;
        if (btn.isConnected) btn.focus({ preventScroll: true });
    }

    function openMenu(info, btn) {
        closeMenu();
        const root = el('div', { className: 'klm-menu', role: 'dialog', 'aria-label': 'Anzeige melden' });
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
        const onOutside = (e) => {
            if (!menu || root.contains(e.target) || btn.contains(e.target)) return;
            closeMenu();
        };
        const onResize = () => menu && positionMenu();
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onOutside, true);
        window.addEventListener('resize', onResize);

        menu = {
            root, info, btn,
            ctx: loadReportContext(info),
            cleanup: () => {
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('pointerdown', onOutside, true);
                window.removeEventListener('resize', onResize);
            },
        };
        document.body.appendChild(root);
        renderReportView();
    }

    function positionMenu() {
        const { root, btn } = menu;
        const r = btn.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const width = Math.min(400, vw - 32);
        root.style.width = width + 'px';
        const left = Math.min(Math.max(16, r.right - width), vw - 16 - width);
        root.style.left = (left + window.scrollX) + 'px';
        root.style.top = (r.bottom + 8 + window.scrollY) + 'px';
    }

    function revealMenu() {
        positionMenu();
        menu.root.scrollIntoView({ block: 'nearest' });
    }

    function menuHeader(title, extraButtons = []) {
        return el('div', { className: 'klm-menu-head' },
            el('span', { className: 'klm-menu-title', title }, title),
            extraButtons,
            el('button', { type: 'button', className: 'klm-icon-btn', 'aria-label': 'Schließen', title: 'Schließen', onclick: closeMenu }, '×'));
    }

    function renderReportView() {
        const { root, info, btn } = menu;
        const templates = loadTemplates();
        const lastId = readSetting(CONFIG.lastTemplateKey);
        let selected = templates.find(t => t.id === lastId) || templates[0];
        let sending = false;

        const text = el('textarea', { className: 'klm-input', rows: 4, maxLength: CONFIG.textMaxLength, required: true });
        const counter = el('span', { className: 'klm-counter' });
        const name = el('input', { className: 'klm-input', type: 'text', autocomplete: 'name', required: true, placeholder: 'wird geladen …' });
        const confirm = el('input', { type: 'checkbox' });
        const status = el('p', { className: 'klm-note', role: 'status', hidden: true });
        const sendBtn = el('button', { type: 'button', className: 'klm-action', dataset: { primary: '' } }, 'Melden');
        let token = null;
        let ctxLoaded = false;

        const showStatus = (msg, kind) => {
            status.hidden = !msg;
            status.textContent = msg || '';
            if (kind) status.dataset.kind = kind; else delete status.dataset.kind;
        };
        const update = () => {
            counter.textContent = `${text.value.length}/${CONFIG.textMaxLength}`;
            sendBtn.disabled = sending || !ctxLoaded || !token || !selected
                || !text.value.trim() || !name.value.trim() || !confirm.checked;
        };
        const applyTemplate = (t) => {
            selected = t;
            text.value = fillPlaceholders(t.text, info);
            update();
        };

        const options = templates.map(t => {
            const radio = el('input', { type: 'radio', name: 'klm-template', value: t.id, checked: t === selected,
                onchange: () => applyTemplate(t) });
            return el('label', { className: 'klm-option' }, radio,
                el('span', {},
                    el('span', { className: 'klm-option-name' }, t.name),
                    el('span', { className: 'klm-option-reason' }, knownReason(t.reasonId).label)));
        });

        text.addEventListener('input', update);
        name.addEventListener('input', update);
        confirm.addEventListener('change', update);

        sendBtn.addEventListener('click', async () => {
            if (sendBtn.disabled) return;
            sending = true;
            update();
            showStatus('Meldung wird gesendet …');
            const userName = name.value.trim();
            let code = 0, detail = '';
            try {
                ({ code, detail } = await sendReport(info.adId, { reasonId: selected.reasonId, text: text.value.trim(), userName, token }));
            } catch (e) { code = 0; }
            if (!menu || menu.root !== root) return;
            if (code >= 200 && code < 300) {
                writeSetting(CONFIG.lastTemplateKey, selected.id);
                writeSetting(CONFIG.userNameKey, userName);
                markReported(info.adId);
                closeMenu();
                showToast(`Anzeige gemeldet: ${knownReason(selected.reasonId).label}`, 'ok', [], 4000);
                return;
            }
            sending = false;
            update();
            const server = detail ? ` Antwort von Kleinanzeigen: „${detail}“` : '';
            showStatus(code === 0
                ? 'Die Meldung konnte nicht gesendet werden (Netzwerkfehler). Du kannst es erneut versuchen oder den offiziellen Dialog nutzen.'
                : code === 401 || code === 403
                    ? `Kleinanzeigen hat die Meldung abgelehnt (Status ${code}). Mögliche Gründe: Du hast diese Anzeige schon gemeldet, oder du bist nicht eingeloggt.${server}`
                    : `Kleinanzeigen hat die Meldung abgelehnt (Status ${code}). Bitte den offiziellen Dialog nutzen.${server}`, 'error');
        });

        const reportedAt = loadReported()[info.adId];
        const body = el('div', { className: 'klm-menu-body' },
            reportedAt ? el('p', { className: 'klm-note', dataset: { kind: 'ok' } },
                `Du hast diese Anzeige am ${new Date(reportedAt).toLocaleDateString('de-DE')} bereits gemeldet.`) : null,
            el('fieldset', { className: 'klm-list' },
                el('legend', { className: 'klm-hint', style: 'margin-bottom:4px' }, `Grund (${CONFIG.reasonGroup})`),
                options),
            el('label', { className: 'klm-field' }, el('span', {}, 'Nachricht'), text, counter),
            el('label', { className: 'klm-field' }, el('span', {}, 'Name (wird wie im offiziellen Dialog mitgesendet)'), name),
            el('label', { className: 'klm-confirm' }, confirm, el('span', {}, CONFIG.confirmText)),
            status,
            el('div', { className: 'klm-actions' },
                el('span', { className: 'klm-spacer' }),
                el('button', { type: 'button', className: 'klm-action', onclick: closeMenu }, 'Abbrechen'),
                sendBtn),
            el('button', { type: 'button', className: 'klm-link', onclick: () => { closeMenu(); openReportPopup(info, btn); } },
                'Anderer Grund? Offiziellen Melden-Dialog öffnen'));

        const gear = el('button', { type: 'button', className: 'klm-icon-btn', 'aria-label': 'Bausteine bearbeiten',
            title: 'Bausteine bearbeiten', onclick: renderSettingsView }, '⚙');
        root.replaceChildren(menuHeader(`Melden: ${info.title || 'Anzeige ' + info.adId}`, [gear]), body);
        if (selected) applyTemplate(selected);
        update();
        revealMenu();
        (root.querySelector('input[name="klm-template"]:checked') || text).focus({ preventScroll: true });

        menu.ctx.then(ctx => {
            if (!menu || menu.root !== root) return;
            ctxLoaded = true;
            token = ctx.token;
            if (!name.value.trim()) name.value = ctx.userName || readSetting(CONFIG.userNameKey);
            name.placeholder = 'Dein Name';
            if (!token) showStatus('Kein Sicherheits-Token gefunden. Bist du eingeloggt? Alternativ den offiziellen Dialog nutzen.', 'error');
            update();
        });
    }

    function renderSettingsView() {
        const { root } = menu;
        let list = loadTemplates();
        const listBox = el('div', { className: 'klm-list' });
        const status = el('p', { className: 'klm-note', role: 'status', hidden: true });

        const drawList = () => {
            listBox.replaceChildren(...list.map((t, i) => {
                const reason = el('select', { className: 'klm-input', onchange: (e) => { t.reasonId = e.target.value; } },
                    CONFIG.reasons.map(r => el('option', { value: r.id, selected: r.id === t.reasonId }, r.label)));
                const move = (d) => { list.splice(i + d, 0, list.splice(i, 1)[0]); drawList(); };
                return el('div', { className: 'klm-tpl' },
                    el('div', { className: 'klm-tpl-head' },
                        el('input', { className: 'klm-input', type: 'text', value: t.name, 'aria-label': 'Name des Bausteins',
                            maxLength: 60, oninput: (e) => { t.name = e.target.value; } }),
                        el('button', { type: 'button', className: 'klm-icon-btn', title: 'Nach oben', 'aria-label': 'Nach oben',
                            disabled: i === 0, onclick: () => move(-1) }, '↑'),
                        el('button', { type: 'button', className: 'klm-icon-btn', title: 'Nach unten', 'aria-label': 'Nach unten',
                            disabled: i === list.length - 1, onclick: () => move(1) }, '↓'),
                        el('button', { type: 'button', className: 'klm-icon-btn', title: 'Löschen', 'aria-label': 'Baustein löschen',
                            disabled: list.length === 1, onclick: () => { list.splice(i, 1); drawList(); } }, '🗑')),
                    reason,
                    el('textarea', { className: 'klm-input', rows: 3, maxLength: CONFIG.textMaxLength, value: t.text,
                        'aria-label': 'Text des Bausteins', oninput: (e) => { t.text = e.target.value; } }));
            }));
        };

        const save = () => {
            const clean = list.map(t => ({ ...t, name: t.name.trim(), text: t.text.trim() }));
            if (clean.some(t => !t.name || !t.text)) {
                status.hidden = false;
                status.dataset.kind = 'error';
                status.textContent = 'Jeder Baustein braucht einen Namen und einen Text.';
                return;
            }
            if (!saveTemplates(clean)) {
                status.hidden = false;
                status.dataset.kind = 'error';
                status.textContent = 'Speichern nicht möglich (Browser-Speicher nicht verfügbar).';
                return;
            }
            renderReportView();
        };

        drawList();
        const body = el('div', { className: 'klm-menu-body' },
            el('p', { className: 'klm-hint' }, 'Platzhalter im Text: ',
                el('code', {}, '{titel}'), ' ', el('code', {}, '{preis}'), ' ', el('code', {}, '{id}'), ' ', el('code', {}, '{link}'),
                '. Gespeichert wird nur lokal in deinem Browser.'),
            listBox,
            el('div', { className: 'klm-actions' },
                el('button', { type: 'button', className: 'klm-action',
                    onclick: () => { list.push({ id: newId(), name: 'Neuer Baustein', reasonId: CONFIG.reasons[0].id, text: '' }); drawList(); } },
                    '+ Neuer Baustein'),
                el('button', { type: 'button', className: 'klm-link',
                    onclick: () => { list = defaultTemplates(); drawList(); } }, 'Standard wiederherstellen')),
            status,
            el('div', { className: 'klm-actions' },
                el('span', { className: 'klm-spacer' }),
                el('button', { type: 'button', className: 'klm-action', onclick: renderReportView }, 'Zurück'),
                el('button', { type: 'button', className: 'klm-action', dataset: { primary: '' }, onclick: save }, 'Speichern')));

        root.replaceChildren(menuHeader('Bausteine bearbeiten'), body);
        revealMenu();
        root.querySelector('input').focus({ preventScroll: true });
    }

    // ------------------------------------------------------------------
    // Popup + Statusleiste
    // ------------------------------------------------------------------

    let current = null; // { info, btn, popup, poll, done }

    function openReportPopup(info, btn) {
        finishCurrent();

        const url = info.href.split('#')[0] + CONFIG.hash;
        const w = CONFIG.popupWidth, h = CONFIG.popupHeight;
        const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
        const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
        // Muss direkt im Klick-Handler passieren, sonst blockiert der Browser das Popup
        const popup = window.open(url, CONFIG.popupName, `popup=yes,width=${w},height=${h},left=${left},top=${top}`);

        if (!popup) {
            showToast('Popup wurde vom Browser blockiert. Bitte Popups für kleinanzeigen.de erlauben.', 'warn', [
                { label: 'In neuem Tab öffnen', onClick: () => { window.open(url, '_blank'); hideToast(); } },
            ]);
            return;
        }
        try { popup.focus(); } catch (e) { /* egal */ }

        btn.dataset.state = 'busy';
        current = { info, btn, popup, done: false, poll: null };
        showToast(`Melden-Fenster geöffnet: ${info.title || 'Anzeige ' + info.adId}`);

        // Erkennen, wenn der Nutzer das Popup selbst schließt
        current.poll = setInterval(() => {
            if (!current || !current.popup.closed) return;
            const c = current;
            finishCurrent();
            if (!c.done) askMarkReported(c.info);
        }, 500);
    }

    function finishCurrent() {
        if (!current) return;
        clearInterval(current.poll);
        if (current.btn.dataset.state === 'busy') {
            setButtonState(current.btn, loadReported()[current.info.adId] ? 'reported' : 'idle');
        }
        current = null;
    }

    function markReported(adId) {
        saveReported(adId);
        document.querySelectorAll(`.klm-btn[data-adid="${adId}"]`).forEach(b => setButtonState(b, 'reported'));
    }

    function askMarkReported(info) {
        showToast('Melden-Fenster geschlossen. Hast du die Anzeige gemeldet?', null, [
            { label: 'Als gemeldet markieren', onClick: () => { markReported(info.adId); hideToast(); } },
            { label: 'Nein', onClick: hideToast },
        ], 10000);
    }

    let toastTimer = null;

    function showToast(text, kind, actions = [], autoHideMs = 0) {
        hideToast();
        const toast = document.createElement('div');
        toast.className = 'klm-toast';
        toast.setAttribute('role', 'status');
        if (kind) toast.dataset.kind = kind;
        const span = document.createElement('span');
        span.className = 'klm-toast-text';
        span.textContent = text;
        toast.appendChild(span);
        actions.forEach(a => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = a.label;
            b.addEventListener('click', a.onClick);
            toast.appendChild(b);
        });
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.setAttribute('aria-label', 'Hinweis schließen');
        x.addEventListener('click', hideToast);
        toast.appendChild(x);
        document.body.appendChild(toast);
        if (autoHideMs) toastTimer = setTimeout(hideToast, autoHideMs);
    }

    function hideToast() {
        clearTimeout(toastTimer);
        document.querySelectorAll('.klm-toast').forEach(t => t.remove());
    }

    function onPopupMessage(e) {
        if (e.origin !== window.location.origin) return;
        const data = e.data;
        if (!data || data.type !== CONFIG.msgType || !current) return;
        if (e.source !== current.popup) return;
        if (data.adId && data.adId !== current.info.adId) return;

        switch (data.status) {
            case 'dialog-open':
                showToast('Bitte im Melden-Fenster den Grund auswählen und absenden.');
                break;
            case 'trigger-not-found':
                showToast('„Anzeige melden“ wurde nicht automatisch gefunden – bitte im Fenster manuell auf „Melden“ klicken.', 'warn');
                break;
            case 'dialog-not-found':
                showToast('Der Melden-Dialog wurde nicht erkannt – bitte im Fenster manuell fortfahren.', 'warn');
                break;
            case 'success':
            case 'closed':
                if ((data.status === 'success' || data.success) && !current.done) {
                    current.done = true;
                    markReported(current.info.adId);
                    showToast('Anzeige gemeldet.', 'ok', [], 4000);
                }
                break;
        }
    }

    // ------------------------------------------------------------------
    // Start
    // ------------------------------------------------------------------

    const isReportPopup = window.location.hash === CONFIG.hash || (window.name === CONFIG.popupName && !!window.opener);
    if (isDetailPage && isReportPopup) {
        runReportPopup();
    } else if (isSearchPage && window.top === window.self) {
        runOverview();
    }
})();
