/* Documentation site behaviour: theme toggle, mobile nav, code copy buttons,
   on-page scrollspy and client-side search. No dependencies. */
(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;

  // Where the site root is relative to this page, taken from the stylesheet
  // link the generator already wrote with the correct depth.
  var base = (function () {
    var link = document.querySelector('link[rel="stylesheet"]');
    var href = link ? link.getAttribute('href') : 'style.css';
    return href.replace(/style\.css$/, '');
  })();

  /* ---------------------------------------------------------------- theme */

  function currentTheme() {
    var set = root.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  var themeBtn = document.querySelector('.theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('bbr-theme', next); } catch (e) {}
    });
  }

  /* ----------------------------------------------------------------- tabs */

  // Every tab group on the site shares one selection, stored per browser: pick
  // Arduino on the encoders page and the odometry page is already showing
  // Arduino when you get there. Groups that do not offer the remembered tab
  // (a page with no Arduino equivalent, say) keep their own first tab.
  var TAB_KEY = 'bbr-platform';
  var tabGroups = [].slice.call(document.querySelectorAll('.tabs'));

  function showTab(group, title) {
    var matched = false;
    group.querySelectorAll('.tab-panel').forEach(function (panel) {
      var on = panel.getAttribute('data-tab') === title;
      panel.hidden = !on;
      matched = matched || on;
    });
    group.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.setAttribute('aria-selected',
        btn.getAttribute('data-tab') === title ? 'true' : 'false');
    });
    return matched;
  }

  if (tabGroups.length) {
    var remembered = null;
    try { remembered = localStorage.getItem(TAB_KEY); } catch (e) {}

    tabGroups.forEach(function (group) {
      group.classList.add('tabs-ready');
      var first = group.querySelector('.tab-btn');
      if (!showTab(group, remembered) && first) {
        showTab(group, first.getAttribute('data-tab'));
      }

      group.addEventListener('click', function (event) {
        var btn = event.target.closest('.tab-btn');
        if (!btn || !group.contains(btn)) return;
        var title = btn.getAttribute('data-tab');
        try { localStorage.setItem(TAB_KEY, title); } catch (e) {}
        // Keep the clicked button where it is on screen: switching platform
        // half way down a long guide should not scroll the page.
        var before = btn.getBoundingClientRect().top;
        tabGroups.forEach(function (other) { showTab(other, title); });
        window.scrollBy(0, btn.getBoundingClientRect().top - before);
      });
    });
  }

  /* ------------------------------------------------------------ mobile nav */

  var menuBtn = document.querySelector('.menu-btn');
  var scrim = document.querySelector('.scrim');

  function setNav(open) {
    body.classList.toggle('nav-open', open);
    if (menuBtn) menuBtn.setAttribute('aria-expanded', String(open));
    if (scrim) scrim.hidden = !open;
  }
  if (menuBtn) menuBtn.addEventListener('click', function () {
    setNav(!body.classList.contains('nav-open'));
  });
  if (scrim) scrim.addEventListener('click', function () { setNav(false); });

  /* --------------------------------------------------------- code + tables */

  document.querySelectorAll('.prose .highlight').forEach(function (block) {
    var wrap = document.createElement('div');
    wrap.className = 'codeblock';
    block.parentNode.insertBefore(wrap, block);
    wrap.appendChild(block);

    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.addEventListener('click', function () {
      var code = block.querySelector('pre') ? block.querySelector('pre').innerText : '';
      var done = function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, function () { btn.textContent = 'Failed'; });
      } else {
        var ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = 'Failed'; }
        document.body.removeChild(ta);
      }
    });
    wrap.appendChild(btn);
  });

  document.querySelectorAll('.prose table').forEach(function (table) {
    var wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  /* ------------------------------------------------------------- scrollspy */

  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc-list a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    tocLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });

    var headings = tocLinks
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);

    var visible = new Set();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      });
      var active = null;
      for (var i = 0; i < headings.length; i++) {
        if (visible.has(headings[i].id)) { active = headings[i].id; break; }
      }
      if (!active) {
        // Nothing in the band: fall back to the last heading scrolled past.
        for (var j = 0; j < headings.length; j++) {
          if (headings[j].getBoundingClientRect().top < 120) active = headings[j].id;
        }
      }
      tocLinks.forEach(function (a) { a.classList.remove('active'); });
      if (active && byId[active]) byId[active].classList.add('active');
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });

    headings.forEach(function (h) { observer.observe(h); });
  }

  /* ---------------------------------------------------------------- search */

  var input = document.getElementById('search-input');
  var results = document.getElementById('search-results');
  if (!input || !results) return;

  var index = null;
  var loading = null;
  var selected = -1;

  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    loading = fetch(base + 'search-index.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { index = data; return index; })
      .catch(function () { loading = null; return null; });
    return loading;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function score(page, terms) {
    var title = page.title.toLowerCase();
    var headings = page.headings.join(' \n ').toLowerCase();
    var text = page.text.toLowerCase();
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      var hit = 0;
      if (title.indexOf(term) !== -1) hit += title.indexOf(term) === 0 ? 60 : 40;
      if (headings.indexOf(term) !== -1) hit += 18;
      var occurrences = text.split(term).length - 1;
      if (occurrences) hit += Math.min(12, 3 + occurrences);
      if (!hit) return 0;   // every term must appear somewhere
      total += hit;
    }
    return total;
  }

  function snippet(page, terms) {
    var text = page.text;
    var lower = text.toLowerCase();
    var at = -1;
    for (var i = 0; i < terms.length && at === -1; i++) at = lower.indexOf(terms[i]);
    if (at === -1) return escapeHtml(text.slice(0, 150));

    var start = Math.max(0, at - 60);
    var slice = (start ? '…' : '') + text.slice(start, start + 190) + '…';
    var out = escapeHtml(slice);
    terms.forEach(function (term) {
      var re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return out;
  }

  function render(matches, terms) {
    selected = -1;
    if (!matches.length) {
      results.innerHTML = '<p class="sr-empty">No matches.</p>';
      results.hidden = false;
      return;
    }
    results.innerHTML = matches.slice(0, 8).map(function (page) {
      var section = page.section ? ' <span class="sr-section">· ' + escapeHtml(page.section) + '</span>' : '';
      return '<a href="' + base + page.url + '">' +
             '<span class="sr-title">' + escapeHtml(page.title) + section + '</span>' +
             '<span class="sr-snippet">' + snippet(page, terms) + '</span></a>';
    }).join('');
    results.hidden = false;
  }

  function search() {
    var query = input.value.trim().toLowerCase();
    if (query.length < 2) { results.hidden = true; return; }

    loadIndex().then(function (data) {
      if (!data) {
        results.innerHTML = '<p class="sr-empty">Search index unavailable. ' +
          'When previewing locally, serve the site over HTTP rather than opening the file directly.</p>';
        results.hidden = false;
        return;
      }
      var terms = query.split(/\s+/).filter(Boolean);
      var matches = data
        .map(function (page) { return { page: page, s: score(page, terms) }; })
        .filter(function (m) { return m.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .map(function (m) { return m.page; });
      render(matches, terms);
    });
  }

  var timer;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(search, 90);
  });
  input.addEventListener('focus', function () { if (input.value.trim().length > 1) search(); });

  function move(delta) {
    var links = results.querySelectorAll('a');
    if (!links.length) return;
    if (selected >= 0) links[selected].classList.remove('sel');
    selected = (selected + delta + links.length) % links.length;
    links[selected].classList.add('sel');
    links[selected].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter') {
      var links = results.querySelectorAll('a');
      var target = selected >= 0 ? links[selected] : links[0];
      if (target) { event.preventDefault(); window.location.href = target.href; }
    } else if (event.key === 'Escape') {
      results.hidden = true;
      input.blur();
    }
  });

  document.addEventListener('click', function (event) {
    if (!results.contains(event.target) && event.target !== input) results.hidden = true;
  });

  document.addEventListener('keydown', function (event) {
    var tag = (event.target.tagName || '').toLowerCase();
    if (event.key === '/' && tag !== 'input' && tag !== 'textarea') {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });
})();
