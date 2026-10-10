// ==UserScript==
// @name          Kleinanzeigen - Anzeige melden (aus der Übersicht)
// @namespace     https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden
// @description   Fügt in der Suchergebnis-Übersicht von Kleinanzeigen.de neben dem Preis einen "Melden"-Button ein. Der offizielle Melden-Dialog öffnet sich in einem kleinen Popup-Fenster – die Übersicht bleibt offen.
// @author        RainbowlabsInc
// @copyright     2026, RainbowlabsInc
// @license       MIT
// @version       0.2.0
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
        storageKey: 'klm-reported-ads',
        // Wie lange auf den Melden-Button / -Dialog gewartet wird
        triggerTimeoutMs: 10000,
        // Größe des Popup-Fensters
        popupWidth: 600,
        popupHeight: 780,
        // Text des offiziellen Melden-Links/Buttons auf der Detailseite
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

    const flagSvg = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V3"/><path d="M4 3h13l-3 4.5L17 12H4"/></svg>`;
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
            const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], [role="menuitem"]'));
            const byText = (re) => candidates.find(el => {
                const label = [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' ');
                return re.test(label.trim());
            });
            return byText(CONFIG.triggerText) || byText(CONFIG.triggerTextLoose) || null;
        }

        // Dialoge, die schon vor dem Klick offen waren (z. B. Cookie-Banner), ignorieren
        let preExisting = new Set();
        const allDialogs = () => CONFIG.dialogSelectors.flatMap(sel => Array.from(document.querySelectorAll(sel)));

        function findDialog() {
            return allDialogs().find(el => !preExisting.has(el) && isVisible(el)) || null;
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
            const finish = (success) => {
                if (finished) return;
                finished = true;
                obs.disconnect();
                document.documentElement.classList.remove('klm-focus');
                post('closed', { success });
                if (success && target) setTimeout(() => window.close(), 1500);
            };

            const obs = new MutationObserver(() => {
                if (closing) return;
                if (pageShowsSuccess()) post('success');
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
                    setTimeout(() => finish(pageShowsSuccess()), 1200);
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
            preExisting = new Set(allDialogs().filter(isVisible));
            trigger.scrollIntoView({ block: 'center' });
            trigger.click();

            const dialog = await waitFor(findDialog, CONFIG.triggerTimeoutMs);
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
            btn.innerHTML = `${checkSvg}<span>Gemeldet</span>`;
            btn.title = 'Diese Anzeige wurde von dir bereits gemeldet (erneut melden: klicken)';
        } else {
            btn.innerHTML = `${flagSvg}<span>Melden</span>`;
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
        const popup = window.open(url, 'klm-report', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);

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

    if (isDetailPage && window.location.hash === CONFIG.hash) {
        runReportFrame();
    } else if (isSearchPage && window.top === window.self) {
        runOverview();
    }
})();
