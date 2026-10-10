// ==UserScript==
// @name          Kleinanzeigen - Anzeige melden (aus der Übersicht)
// @namespace     https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden
// @description   Fügt in der Suchergebnis-Übersicht von Kleinanzeigen.de neben dem Preis einen "Melden"-Button ein. Der offizielle Melden-Dialog öffnet sich in einem kleinen Popup-Fenster – die Übersicht bleibt offen.
// @author        RainbowlabsInc
// @copyright     2026, RainbowlabsInc
// @license       MIT
// @version       0.3.0
// @icon          https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/assets/icon48.png
// @homepage      https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden
// @updateURL     https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/script.user.js
// @downloadURL   https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/script.user.js
// @match         https://www.kleinanzeigen.de/s-*
// @grant         none
// @run-at        document-idle
// ==/UserScript==

/*
 * Funktionsweise
 * --------------
 * 1. Übersicht (Suchergebnisse, /s-...):
 *    Jede Anzeigen-Karte bekommt neben dem Preis einen "Melden"-Button.
 *    Ein Klick öffnet die Anzeige in einem kleinen Popup-Fenster (URL-Hash #klm-report).
 *    Die Übersicht bleibt dabei unverändert offen. (Ein eingebettetes iframe ist nicht
 *    möglich: Kleinanzeigen verbietet das Einbetten seiner Seiten per X-Frame-Options/CSP.)
 *
 * 2. Detailseite im Popup (/s-anzeige/...#klm-report):
 *    Das Script sucht den offiziellen "Anzeige melden"-Button, klickt ihn und blendet
 *    alles außer dem Melden-Dialog aus. Status-Meldungen gehen per postMessage an die
 *    Übersicht zurück; nach erfolgreichem Absenden schließt sich das Popup selbst.
 *
 * Es wird KEIN eigener/inoffizieller Server-Request gesendet – die Meldung läuft
 * ausschließlich über den originalen Dialog von Kleinanzeigen.
 *
 * Hinweis: Die Selektoren für Karten, Preis und Melden-Dialog sind bewusst
 * text-/strukturbasiert gehalten, weil Kleinanzeigen das Frontend häufig ändert.
 * Sie sind in CONFIG gesammelt und können dort angepasst werden.
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
        // Heuristik: Texte, die nach erfolgreichem Absenden erscheinen könnten.
        // Ungeprüft – Kleinanzeigen-Wortlaut bitte bei Bedarf ergänzen.
        // Beschriftung des Absenden-Buttons im Melden-Dialog
        submitText: /(absenden|abschicken|senden|melden)/i,
        successText: /(vielen dank|danke für (deine|ihre) meldung|erfolgreich gemeldet|meldung (wurde )?(erhalten|gesendet|übermittelt))/i,
    };

    // Nur auf kleinanzeigen.de laufen – zusätzlich zu @match, falls der Script-Manager
    // die Header ignoriert oder das Script manuell mit breiteren Regeln eingebunden wird.
    const ALLOWED_HOST = 'www.kleinanzeigen.de';
    if (window.location.protocol !== 'https:' || window.location.hostname !== ALLOWED_HOST) return;

    const path = window.location.pathname;
    const isDetailPage = path.startsWith('/s-anzeige/');
    const isSearchPage = path.startsWith('/s-') && !isDetailPage;

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

    function runReportFrame() {
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
            post('loading');
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
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

        window.addEventListener('message', onPopupMessage);
    }

    function injectOverviewStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .klm-price-row { display: flex !important; align-items: center; flex-wrap: wrap; gap: 8px; }
            /* Wrapper: der Button darin ist ein atomares Inline-Element und erbt so keine Link-Unterstreichung der Karte */
            .klm-wrap { margin-left: auto; display: block; }
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
            .klm-btn[data-state="reported"] { border-color: #a5d6a7; color: #2e7d32; background: #edf7ee; cursor: default; }
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
        `;
        document.head.appendChild(style);
    }

    function findAdCards() {
        const cards = new Set();

        // Klassisches Layout
        document.querySelectorAll('article.aditem[data-adid]').forEach(el => cards.add(el));

        // Generisch: vom Anzeigen-Link so weit nach oben laufen, wie der Container
        // nur Links auf genau diese eine Anzeige enthält -> das ist die Karte.
        document.querySelectorAll('a[href*="/s-anzeige/"]').forEach(link => {
            if (link.closest('[data-klm-injected], article.aditem[data-adid]')) return;
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
        return t.length > 0 && /€|zu verschenken/i.test(t) && t.replace(pricePartsRe, '').replace(/\s+/g, '') === '';
    }

    function findPriceRow(card) {
        // Klassisches Layout
        const classic = card.querySelector('.aditem-main--middle--price-shipping');
        if (classic) return classic;

        // Generisch: erstes Element, das nur aus Preistext besteht ...
        const first = Array.from(card.querySelectorAll('p, span, div, strong, b'))
            .find(el => el.children.length === 0 && isPriceOnly(el.textContent));
        if (!first) return null;

        // ... dann hoch bis zur Zeile, die noch ausschließlich Preise enthält
        // (z. B. "2 € VB" + durchgestrichener Altpreis "3.399 €"), aber keine km/EZ-Tags.
        let row = first;
        while (row.parentElement && row.parentElement !== card && isPriceOnly(row.parentElement.textContent)) {
            row = row.parentElement;
        }
        return row;
    }

    function injectButtons() {
        const reported = loadReported();

        findAdCards().forEach(card => {
            if (card.dataset.klmInjected) return;
            const info = getCardInfo(card);
            if (!info.href || !info.adId) return;

            const row = findPriceRow(card);
            if (!row) return;
            card.dataset.klmInjected = 'true';

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
                openReportPopup(info, btn);
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
        runReportFrame();
    } else if (isSearchPage && window.top === window.self) {
        runOverview();
    }
})();
