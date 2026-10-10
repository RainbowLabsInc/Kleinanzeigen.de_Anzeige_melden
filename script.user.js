// ==UserScript==
// @name          Kleinanzeigen - Anzeige melden (aus der Übersicht)
// @namespace     https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden
// @description   Fügt in der Suchergebnis-Übersicht von Kleinanzeigen.de neben dem Preis einen "Melden"-Button ein. Der offizielle Melden-Dialog öffnet sich in einem Overlay – ohne die Übersicht zu verlassen.
// @copyright     2026, RainbowLabsInc
// @license       MIT
// @version       0.1.0
// @homepage      https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden
// @updateURL     https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/script.user.js
// @downloadURL   https://github.com/RainbowLabsInc/Kleinanzeigen.de_Anzeige_melden/raw/main/script.user.js
// @match         https://www.kleinanzeigen.de/*
// @grant         none
// @run-at        document-idle
// ==/UserScript==

/*
 * Funktionsweise
 * --------------
 * 1. Übersicht (Suchergebnisse, /s-...):
 *    Jede Anzeigen-Karte bekommt neben dem Preis einen "Melden"-Button.
 *    Ein Klick öffnet ein Overlay mit einem iframe auf die Detailseite der Anzeige
 *    (URL-Hash #klm-report). Die Übersicht bleibt dabei unverändert offen.
 *
 * 2. Detailseite im iframe (/s-anzeige/...#klm-report):
 *    Das gleiche Script läuft auch im iframe. Es sucht den offiziellen
 *    "Anzeige melden"-Button, klickt ihn und blendet alles außer dem Melden-Dialog aus.
 *    Status-Meldungen gehen per postMessage an die Übersicht zurück.
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
        // Wie lange auf die Detailseite / den Melden-Button gewartet wird
        frameTimeoutMs: 15000,
        triggerTimeoutMs: 10000,
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

    const path = window.location.pathname;
    const isDetailPage = path.startsWith('/s-anzeige/');
    const isSearchPage = path.startsWith('/s-') && !isDetailPage;
    const isInFrame = window.top !== window.self;

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
    // Teil 1: Detailseite im iframe / Popup – Melden-Dialog automatisch öffnen
    // ------------------------------------------------------------------

    function runReportFrame() {
        const target = isInFrame ? window.parent : window.opener;
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
                if (!isInFrame && success) setTimeout(() => window.close(), 1500);
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
    // Teil 2: Übersicht – Melden-Buttons einfügen + Overlay
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

        window.addEventListener('message', onFrameMessage);
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

            .klm-overlay {
                position: fixed; inset: 0; z-index: 2147483000;
                background: rgba(0,0,0,.45);
                display: flex; align-items: center; justify-content: center;
                padding: 16px;
            }
            .klm-modal {
                background: #fff; color: #1e1e1e; border-radius: 12px;
                width: min(560px, 100%); height: min(760px, 100%);
                display: flex; flex-direction: column; overflow: hidden;
                box-shadow: 0 12px 40px rgba(0,0,0,.3);
                font-family: inherit;
            }
            .klm-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #eee; }
            .klm-title { flex: 1; font-weight: 700; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .klm-x { border: 0; background: transparent; font-size: 22px; line-height: 1; cursor: pointer; color: #666; padding: 4px 8px; }
            .klm-status { padding: 8px 16px; font-size: 13px; background: #f6f6f3; color: #444; }
            .klm-status[data-kind="warn"] { background: #fff4e5; color: #8a4b00; }
            .klm-status[data-kind="ok"] { background: #edf7ee; color: #2e7d32; }
            .klm-frame { flex: 1; width: 100%; border: 0; background: #fff; }
            .klm-foot { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; padding: 10px 16px; border-top: 1px solid #eee; }
            .klm-foot button {
                padding: 6px 12px; border-radius: 8px; border: 1px solid #d0d0cc; background: #fff;
                font: inherit; font-size: 13px; cursor: pointer;
            }
            .klm-foot button:hover { background: #f3f3f0; }
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
                openReportOverlay(info, btn);
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
    // Overlay
    // ------------------------------------------------------------------

    let current = null; // { overlay, frame, info, btn, timer, popup }

    function openReportOverlay(info, btn) {
        closeOverlay();

        const reportUrl = info.href.split('#')[0] + CONFIG.hash;

        const overlay = document.createElement('div');
        overlay.className = 'klm-overlay';
        overlay.innerHTML = `
            <div class="klm-modal" role="dialog" aria-modal="true" aria-label="Anzeige melden">
                <div class="klm-head">
                    <span class="klm-title"></span>
                    <button type="button" class="klm-x" aria-label="Schließen">×</button>
                </div>
                <div class="klm-status">Anzeige wird geladen …</div>
                <iframe class="klm-frame" title="Anzeige melden"></iframe>
                <div class="klm-foot">
                    <button type="button" data-act="popup">Im Popup öffnen</button>
                    <button type="button" data-act="mark">Als gemeldet markieren</button>
                    <button type="button" data-act="close">Schließen</button>
                </div>
            </div>`;
        overlay.querySelector('.klm-title').textContent = 'Melden: ' + (info.title || 'Anzeige ' + info.adId);

        const frame = overlay.querySelector('.klm-frame');
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeOverlay();
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'close') closeOverlay();
            if (act === 'mark') markReported();
            if (act === 'popup') openPopup(reportUrl);
        });
        overlay.querySelector('.klm-x').addEventListener('click', closeOverlay);
        document.addEventListener('keydown', onKeydown);

        document.body.appendChild(overlay);
        setButtonState(btn, btn.dataset.state === 'reported' ? 'reported' : 'idle');
        btn.dataset.state = 'busy';

        current = { overlay, frame, info, btn, timer: null, popup: null, gotMessage: false };

        current.timer = setTimeout(() => {
            if (current && !current.gotMessage) {
                setStatus('Die Anzeige konnte im Overlay nicht geladen werden (evtl. blockiert Kleinanzeigen die Einbettung). Nutze „Im Popup öffnen“.', 'warn');
            }
        }, CONFIG.frameTimeoutMs);

        frame.src = reportUrl;
    }

    function openPopup(url) {
        if (!current) return;
        const w = 560, h = 760;
        const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
        const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
        current.popup = window.open(url, 'klm-report', `width=${w},height=${h},left=${left},top=${top}`);
        current.frame.src = 'about:blank';
        setStatus('Melden-Dialog wurde in einem Popup-Fenster geöffnet.');
    }

    function setStatus(text, kind) {
        if (!current) return;
        const el = current.overlay.querySelector('.klm-status');
        el.textContent = text;
        if (kind) el.dataset.kind = kind; else delete el.dataset.kind;
    }

    function markReported() {
        if (!current) return;
        saveReported(current.info.adId);
        document.querySelectorAll(`.klm-btn[data-adid="${current.info.adId}"]`).forEach(b => setButtonState(b, 'reported'));
        current.reported = true;
        closeOverlay();
    }

    function closeOverlay() {
        if (!current) return;
        clearTimeout(current.timer);
        document.removeEventListener('keydown', onKeydown);
        current.overlay.remove();
        if (current.btn.dataset.state === 'busy') {
            setButtonState(current.btn, loadReported()[current.info.adId] ? 'reported' : 'idle');
        }
        current = null;
    }

    function onKeydown(e) {
        if (e.key === 'Escape') closeOverlay();
    }

    function onFrameMessage(e) {
        if (e.origin !== window.location.origin) return;
        const data = e.data;
        if (!data || data.type !== CONFIG.msgType || !current) return;
        const fromFrame = current.frame && e.source === current.frame.contentWindow;
        const fromPopup = current.popup && e.source === current.popup;
        if (!fromFrame && !fromPopup) return;
        if (data.adId && data.adId !== current.info.adId) return;

        current.gotMessage = true;
        switch (data.status) {
            case 'loading':
                setStatus('Melden-Funktion wird gesucht …');
                break;
            case 'dialog-open':
                setStatus('Bitte Grund auswählen und im Dialog absenden.');
                break;
            case 'trigger-not-found':
                setStatus('Der „Anzeige melden“-Button wurde nicht automatisch gefunden. Bitte unten in der Anzeige manuell auf „Melden“ klicken.', 'warn');
                break;
            case 'dialog-not-found':
                setStatus('Der Melden-Dialog wurde nicht erkannt. Bitte in der Anzeige manuell fortfahren.', 'warn');
                break;
            case 'success':
                setStatus('Meldung offenbar gesendet.', 'ok');
                break;
            case 'closed':
                if (data.success) {
                    setStatus('Meldung gesendet – Anzeige wird als gemeldet markiert.', 'ok');
                    setTimeout(markReported, 1000);
                } else {
                    // Dialog geschlossen ohne erkannte Erfolgsmeldung: Nutzer entscheidet selbst
                    setStatus('Dialog geschlossen. Falls du die Meldung abgeschickt hast: „Als gemeldet markieren“ klicken.');
                }
                break;
        }
    }
    // ------------------------------------------------------------------
    // Start
    // ------------------------------------------------------------------

    if (isDetailPage && window.location.hash === CONFIG.hash) {
        runReportFrame();
    } else if (isSearchPage && !isInFrame) {
        runOverview();
    }
})();
