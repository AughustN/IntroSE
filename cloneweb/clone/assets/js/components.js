// components.js — inject shared partials (sprite, navbar, footer) and mark active link
(function () {
    'use strict';

    function getCurrentPage() {
        return (document.body.dataset.page || 'home').toLowerCase();
    }

    function inject(url, selector) {
        return fetch(url, { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.text() : ''; })
            .then(function (html) {
                var el = document.querySelector(selector);
                if (el && html) el.innerHTML = html;
            })
            .catch(function () { /* silent — content still readable */ });
    }

    function markActive() {
        var page = getCurrentPage();
        document.querySelectorAll('[data-nav]').forEach(function (link) {
            if (link.dataset.nav === page) {
                link.classList.add('is-active');
            }
        });
    }

    function fireReady() {
        document.body.classList.add('is-ready');
        if (typeof window.onComponentsReady === 'function') {
            window.onComponentsReady();
        }
    }

    Promise.all([
        inject('partials/sprite.html', '#sprite-mount'),
        inject('partials/navbar.html', '#navbar-mount'),
        inject('partials/footer.html', '#footer-mount')
    ]).then(function () {
        markActive();
        fireReady();
    });
})();
