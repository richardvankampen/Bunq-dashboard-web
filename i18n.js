// ============================================
// UI LANGUAGE (NL / EN)
// ============================================
// Texts in index.html and app.js are written in one language (mostly Dutch, some English).
// `t(text, params)` returns the text in the chosen UI language: TO_EN holds the English for
// every Dutch text, TO_NL the Dutch for every English text; a text without an entry is shown
// as is. `{name}` placeholders are filled from `params` (Plotly's `%{...}` is left alone).
//
// Static texts (index.html, and fixed strings app.js puts in the DOM) are translated by a
// MutationObserver on text nodes and the title/placeholder/aria-label/data-tooltip attributes, so they
// need no code changes. Composed texts, chart labels and dialogs call t() in app.js; on a
// language switch app.js re-renders ('uilanguagechange' event).
// Elements with `data-no-i18n` (transaction rows, account names) are never translated.

(function () {
    const STORAGE_KEY = 'uiLanguage';
    const SUPPORTED = ['nl', 'en'];
    const LOCALES = { nl: 'nl-NL', en: 'en-GB' };

    let currentLang = 'nl';
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (SUPPORTED.includes(stored)) currentLang = stored;
    } catch (error) {
        // Storage unavailable (private mode): default language.
    }

    const TO_EN = {};
    const TO_NL = {};
    // Translation -> source text, so a text that reaches the DOM already translated (e.g. a
    // tooltip copied from a translated title) still switches back.
    const REVERSE = {};

    function normalizeKey(text) {
        return String(text).replace(/\s+/g, ' ').trim();
    }

    function t(text, params) {
        if (text === null || text === undefined) return text;
        const source = String(text);
        const map = currentLang === 'en' ? TO_EN : TO_NL;
        const key = normalizeKey(source);
        let out = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : source;
        if (params) {
            out = out.replace(/(^|[^%])\{(\w+)\}/g, (match, before, name) => (
                Object.prototype.hasOwnProperty.call(params, name) ? `${before}${params[name]}` : match
            ));
        }
        return out;
    }

    function uiLang() {
        return currentLang;
    }

    function uiLocale() {
        return LOCALES[currentLang] || LOCALES.nl;
    }

    function addTranslations(toEn, toNl) {
        Object.entries(toEn || {}).forEach(([key, value]) => {
            TO_EN[normalizeKey(key)] = value;
            REVERSE[normalizeKey(value)] = normalizeKey(key);
        });
        Object.entries(toNl || {}).forEach(([key, value]) => {
            TO_NL[normalizeKey(key)] = value;
            REVERSE[normalizeKey(value)] = normalizeKey(key);
        });
    }

    // ---------- DOM translation ----------
    const TRANSLATED_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'data-tooltip'];
    const SKIP_SELECTOR = '[data-no-i18n], .js-plotly-plot, svg, canvas, script, style, pre, code, textarea';
    const textState = new WeakMap();   // Text node -> { original, written }
    const attrState = new WeakMap();   // Element -> { [attr]: { original, written } }

    function isSkipped(element) {
        return !element || Boolean(element.closest(SKIP_SELECTOR));
    }

    function translateString(original) {
        const text = normalizeKey(original);
        if (!text) return original;
        const key = Object.prototype.hasOwnProperty.call(REVERSE, text) ? REVERSE[text] : text;
        const translated = t(key);
        if (translated === text) return original;
        const leading = original.match(/^\s*/)[0];
        const trailing = original.match(/\s*$/)[0];
        return `${leading}${translated}${trailing}`;
    }

    function translateTextNode(node) {
        const value = node.nodeValue;
        if (!value || !value.trim()) return;
        if (isSkipped(node.parentElement)) return;
        let state = textState.get(node);
        if (!state || value !== state.written) {
            state = { original: value, written: null };
            textState.set(node, state);
        }
        const next = translateString(state.original);
        state.written = next;
        if (node.nodeValue !== next) node.nodeValue = next;
    }

    function translateAttribute(element, attr) {
        const value = element.getAttribute(attr);
        if (!value || !value.trim()) return;
        let states = attrState.get(element);
        if (!states) {
            states = {};
            attrState.set(element, states);
        }
        let state = states[attr];
        if (!state || value !== state.written) {
            state = { original: value, written: null };
            states[attr] = state;
        }
        const next = translateString(state.original);
        state.written = next;
        if (value !== next) element.setAttribute(attr, next);
    }

    function translateElement(element) {
        if (isSkipped(element)) return;
        TRANSLATED_ATTRIBUTES.forEach((attr) => {
            if (element.hasAttribute(attr)) translateAttribute(element, attr);
        });
    }

    function translateTree(root) {
        if (!root) return;
        if (root.nodeType === Node.TEXT_NODE) {
            translateTextNode(root);
            return;
        }
        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
        if (root.nodeType === Node.ELEMENT_NODE) {
            if (isSkipped(root)) return;
            translateElement(root);
        }
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        return node.matches(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        let node = walker.nextNode();
        while (node) {
            if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
            else translateElement(node);
            node = walker.nextNode();
        }
    }

    let documentTitleSource = null;

    function translateDocument() {
        if (documentTitleSource === null) documentTitleSource = document.title;
        document.title = t(documentTitleSource);
        document.documentElement.lang = currentLang;
        translateTree(document.body);
        updateLanguageToggle();
    }

    function updateLanguageToggle() {
        document.querySelectorAll('[data-lang-option]').forEach((option) => {
            const active = option.getAttribute('data-lang-option') === currentLang;
            option.classList.toggle('active', active);
            option.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function startObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => translateTree(node));
                } else if (mutation.type === 'characterData') {
                    translateTextNode(mutation.target);
                } else if (mutation.type === 'attributes') {
                    if (!isSkipped(mutation.target)) translateAttribute(mutation.target, mutation.attributeName);
                }
            });
        });
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: TRANSLATED_ATTRIBUTES
        });
    }

    function setLanguage(lang) {
        if (!SUPPORTED.includes(lang) || lang === currentLang) {
            updateLanguageToggle();
            return;
        }
        currentLang = lang;
        try {
            localStorage.setItem(STORAGE_KEY, lang);
        } catch (error) {
            // Not persisted; still switch for this page view.
        }
        translateDocument();
        document.dispatchEvent(new CustomEvent('uilanguagechange', { detail: { lang } }));
    }

    function init() {
        translateDocument();
        startObserver();
        document.querySelectorAll('[data-lang-option]').forEach((option) => {
            option.addEventListener('click', () => setLanguage(option.getAttribute('data-lang-option')));
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    window.t = t;
    window.uiLang = uiLang;
    window.uiLocale = uiLocale;
    window.setUiLanguage = setLanguage;
    window.addTranslations = addTranslations;
    window.__i18nMaps = { TO_EN, TO_NL };
})();
