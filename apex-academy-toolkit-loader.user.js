// ==UserScript==
// @name         Apex Academy Toolkit
// @namespace    local.apex.academy.toolkit.loader
// @version      1.0.0
// @description  Loads the latest Apex Academy Toolkit from GitHub.
// @match        https://mail.google.com/*
// @match        https://calendar.google.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      raw.githubusercontent.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/1.10.100/pdf.combined.js
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    if (window.__APEX_ACADEMY_TOOLKIT_LOADER__) return;
    window.__APEX_ACADEMY_TOOLKIT_LOADER__ = true;

    const MASTER =
        'https://raw.githubusercontent.com/alvinhhh/scripting/refs/heads/main/apex-academy-toolkit.user.js';

    GM_xmlhttpRequest({
        method: 'GET',

        // Cache-bust so edits on GitHub are picked up immediately.
        url: `${MASTER}?t=${Date.now()}`,

        onload(response) {
            if (response.status < 200 || response.status >= 300) {
                console.error(
                    '[Apex Toolkit] GitHub returned HTTP',
                    response.status
                );
                return;
            }

            try {
                // Metadata has already been handled by this loader.
                const source = response.responseText.replace(
                    /^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/,
                    ''
                );

                eval(
                    source +
                    '\n//# sourceURL=apex-academy-toolkit.user.js'
                );
            } catch (error) {
                console.error(
                    '[Apex Toolkit] Could not start toolkit:',
                    error
                );
            }
        },

        onerror(error) {
            console.error(
                '[Apex Toolkit] Could not download toolkit from GitHub:',
                error
            );
        }
    });
})();
