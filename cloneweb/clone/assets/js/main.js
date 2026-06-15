// Pathé clone — interactions
(function () {
    'use strict';

    var navbar = document.getElementById('navbar');
    var burger = document.getElementById('burger');

    // sticky navbar (white -> opaque on scroll)
    function onScroll() {
        if (window.scrollY > 80) {
            navbar.classList.add('is-stuck');
        } else {
            navbar.classList.remove('is-stuck');
        }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // burger toggle (mobile)
    if (burger) {
        burger.addEventListener('click', function () {
            navbar.classList.toggle('is-open');
        });
    }

    // submenu toggle on click (for submenus that don't have a real URL)
    document.querySelectorAll('.navbar__item.has-children > .navbar__link, .navbar__item--websites > .navbar__link').forEach(function (link) {
        link.addEventListener('click', function (e) {
            if (window.innerWidth > 860) return; // desktop uses hover
            e.preventDefault();
            var item = link.parentElement;
            item.classList.toggle('is-open');
        });
    });

    // reveal on scroll
    if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-in');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });
        document.querySelectorAll('.vb, .news-card, .news__top').forEach(function (el) {
            el.classList.add('reveal');
            io.observe(el);
        });
    }
})();
