const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DIST = path.join(process.cwd(), 'dist');

// ── Helpers ───────────────────────────────────────────────

function baseSlug(text) {
  return (text || '').toLowerCase()
    .replace(/[\u00e4\u00c4]/g, 'ae').replace(/[\u00f6\u00d6]/g, 'oe').replace(/[\u00fc\u00dc]/g, 'ue')
    .replace(/\u00df/g, 'ss').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Adresse aus dem Titel: h\u00f6chstens 80 Zeichen, immer am Wortende gek\u00fcrzt.
// Gleiche Regel wie slugify() in index.html \u2013 beide bei \u00c4nderungen angleichen.
var SLUG_MAX = 80;
function slugify(text) {
  var s = baseSlug(text);
  if (s.length <= SLUG_MAX) return s;
  var cut = s.substring(0, SLUG_MAX);
  if (s.charAt(SLUG_MAX) !== '-') cut = cut.replace(/-[^-]*$/, '');
  return cut.replace(/-+$/, '');
}

// Fr\u00fchere Regel (hart nach 60 Zeichen) \u2013 nur noch f\u00fcr Weiterleitungen alter Links
function legacySlugify(text) {
  return baseSlug(text).substring(0, 60);
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape JSON so it can never break out of a <script> block
function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Inline formatting: escape first, then apply markup
function inline(s) {
  var t = esc(s);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
    if (!/^https?:\/\//i.test(url) && !/^\//.test(url) && !/^mailto:/i.test(url)) return label;
    return '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
  });
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, function (m, pre, url) {
    return pre + '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>';
  });
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return t;
}

// Markdown -> HTML, executed in Node at build time
// Zusätzliche Bilder: Platzhalter wie [Bild 1] / [Image 1] im Text werden durch
// das entsprechende Bild ersetzt; nicht platzierte Bilder kommen ans Ende.
function figureHtml(src, caption) {
  return '<figure class="article-figure"><img src="' + esc(src) + '" alt="' + esc(caption || '') + '" loading="lazy">' +
    (caption ? '<figcaption>' + inline(caption) + '</figcaption>' : '') + '</figure>';
}
function renderMarkdown(text, imgs) {
  imgs = imgs || [];
  var used = {};
  if (!text) text = '';
  var lines = String(text).split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\s+$/, '');
    if (line === '') continue;
    if (line === '---') { out.push('<hr>'); continue; }
    var m;
    // [Bild 1] oder mit Unterschrift: [Bild 1 – Text] / [Bild 1: Text] / [Bild 1 | Text]
    if ((m = line.match(/^\[\s*(?:bild|image|abbildung|figure|fig\.?)\s*(\d+)\s*(?:[–—:|-]\s*([^\]]*?))?\s*\]$/i))) {
      var k = parseInt(m[1], 10) - 1;
      if (imgs[k]) { out.push(figureHtml(imgs[k], m[2])); used[k] = true; }
      continue;
    }
    // Video: [Video: /pfad/datei.mp4 | Bildunterschrift]
    if ((m = line.match(/^\[\s*video\s*:\s*([^|\]]+?)\s*(?:\|\s*([^\]]*?)\s*)?\]$/i))) {
      out.push('<figure class="article-figure article-video"><video src="' + esc(m[1]) + '" controls muted playsinline loop preload="metadata"></video>' +
        (m[2] ? '<figcaption>' + inline(m[2]) + '</figcaption>' : '') + '</figure>');
      continue;
    }
    if ((m = line.match(/^###\s+(.*)$/))) { out.push('<h3>' + inline(m[1]) + '</h3>'); continue; }
    if ((m = line.match(/^##\s+(.*)$/)))  { out.push('<h2>' + inline(m[1]) + '</h2>'); continue; }
    if ((m = line.match(/^#\s+(.*)$/)))   { out.push('<h2>' + inline(m[1]) + '</h2>'); continue; }
    out.push('<p>' + inline(line) + '</p>');
  }
  imgs.forEach(function (src, k) { if (!used[k] && src) out.push(figureHtml(src)); });
  return out.join('\n');
}

function fetchArticles() {
  return new Promise(function (resolve, reject) {
    var options = {
      hostname: 'api.github.com',
      path: '/repos/vmatoussevitch-ops/vat-articles/contents/articles.json',
      headers: {
        // Raw-Abruf: funktioniert auch, wenn articles.json größer als 1 MB ist
        'Accept': 'application/vnd.github.raw',
        'User-Agent': 'vascular-access-talk-build'
      }
    };
    // Das Artikel-Repo ist öffentlich: Token nur nutzen, wenn vorhanden
    if (GITHUB_TOKEN) options.headers['Authorization'] = 'token ' + GITHUB_TOKEN;
    https.get(options, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try {
          if (res.statusCode !== 200) throw new Error('GitHub ' + res.statusCode + ': ' + data.slice(0, 200));
          resolve(JSON.parse(data).articles || []);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Eingefügte Markdown-Reste bereinigen: „# “ vor Titeln, */_ in Kurzbeschreibungen,
// und eine Überschrift am Textanfang, die nur den Titel wiederholt
function cleanTitle(t) { return String(t || '').replace(/^\s*#+\s*/, '').trim(); }
function cleanExcerpt(t) {
  // Absätze zu einem Text verbinden, dabei fehlenden Satzpunkt ergänzen
  return String(t || '').replace(/^\s*#+\s*/gm, '').replace(/\*\*\*|\*\*|\*|__/g, '')
    .split(/\n\s*\n/).map(function (p) { return p.replace(/\s*\n\s*/g, ' ').trim(); })
    .filter(Boolean).map(function (p, i, arr) { return (i < arr.length - 1 && !/[.!?:;…]$/.test(p)) ? p + '.' : p; })
    .join(' ').replace(/\s{2,}/g, ' ').trim();
}
function cleanBody(body, title, excerpt) {
  var lines = String(body || '').split('\n');
  var norm = function (s) { return String(s || '').replace(/^\s*#+\s*/, '').replace(/[*_]/g, '').trim().toLowerCase(); };
  var i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  var lead = [];
  // Vorangestellte Kurzzeile wie BS"D beibehalten
  if (i < lines.length && /^b["'”″]?s["'”″]?d\.?$/i.test(lines[i].replace(/\s/g, ''))) { lead.push(lines[i]); i++; }
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && /^\s*#/.test(lines[i]) && norm(lines[i]) === norm(title)) {
    i++;
    while (i < lines.length && lines[i].trim() === '') i++;
    return lead.concat(lead.length ? [''] : [], lines.slice(i)).join('\n').replace(/^\n+/, lead.length ? '' : '');
  }
  return body;
}
function normalizeArticle(a) {
  var o = {};
  for (var k in a) o[k] = a[k];
  ['title', 'titleEn', 'titleRu', 'titleHe'].forEach(function (k) { if (o[k]) o[k] = cleanTitle(o[k]); });
  [['body', 'title', 'excerpt'], ['bodyEn', 'titleEn', 'excerptEn'], ['bodyRu', 'titleRu', 'excerptRu'], ['bodyHe', 'titleHe', 'excerptHe']].forEach(function (f) {
    if (o[f[0]]) o[f[0]] = cleanBody(o[f[0]], o[f[1]], a[f[2]]);
  });
  ['excerpt', 'excerptEn', 'excerptRu', 'excerptHe'].forEach(function (k) { if (o[k]) o[k] = cleanExcerpt(o[k]); });
  return o;
}

// ── URLs (DE unter /artikel/, EN unter /en/article/) ─────

var SITE = 'https://vascularaccesstalk.com';

function hasEn(a) {
  return !!(a.titleEn && a.bodyEn);
}

function dePath(a) {
  return '/artikel/' + slugify(a.title || a.titleEn || 'artikel') + '/';
}

function enPath(a) {
  return hasEn(a) ? '/en/article/' + slugify(a.titleEn) + '/' : null;
}

var CAT_EN = { 'Allgemeines': 'General', 'AV-Fistel': 'AV Fistula', 'Prothesenshunt': 'AV Graft',
  'Stenose & Thrombose': 'Stenosis & Thrombosis', 'Surveillance': 'Surveillance', 'Steal-Syndrom': 'Steal Syndrome',
  'Infektion': 'Infection', 'Aneurysma': 'Aneurysm', 'Planung & Mapping': 'Planning & Mapping' };

// ── Article page ──────────────────────────────────────────

// pageLang: 'de' (Standard) oder 'en' (eigene englische Seite)
function generateArticlePage(article, pageLang, allArticles) {
  pageLang = pageLang === 'en' ? 'en' : 'de';
  var deUrl = SITE + dePath(article);
  var enUrl = enPath(article) ? SITE + enPath(article) : null;
  var pageUrl = pageLang === 'en' ? enUrl : deUrl;
  var slug = slugify(pageLang === 'en' ? article.titleEn : (article.title || article.titleEn || 'artikel'));

  // Markdown rendered here, in Node. The browser only swaps ready HTML.
  var langs = {
    de: {
      title: article.title || article.titleEn || '',
      body: renderMarkdown(article.body || article.bodyEn || '', article.extraImgs),
      dir: 'ltr'
    },
    en: {
      title: article.titleEn || article.title || '',
      body: renderMarkdown(article.bodyEn || article.body || '', article.extraImgs),
      dir: 'ltr'
    },
    ru: {
      title: article.titleRu || article.titleEn || article.title || '',
      body: renderMarkdown(article.bodyRu || article.bodyEn || article.body || '', article.extraImgs),
      dir: 'ltr'
    },
    he: {
      title: article.titleHe || article.titleEn || article.title || '',
      body: renderMarkdown(article.bodyHe || article.bodyEn || article.body || '', article.extraImgs),
      dir: 'rtl'
    }
  };

  var title = langs[pageLang].title;
  var excerpt = (pageLang === 'en'
    ? (article.excerptEn || article.excerpt || '')
    : (article.excerpt || article.excerptEn || '')).substring(0, 155);
  var cat = article.cat || 'Allgemeines';
  if (pageLang === 'en') cat = CAT_EN[cat] || cat;
  var date = article.date || '';
  var author = article.author || 'Dr. V. Matoussevitch';
  var img = article.img && (article.img.indexOf('data:image') === 0 || /\.(jpg|jpeg|png|webp)$/i.test(article.img)) ? article.img : '';

  // Beschriftungen der Aktions-Buttons je Sprache
  var BTN_LABELS = {
    de: { info: 'Programm & Informationen', register: 'Zur Anmeldung',       calendar: 'Termin vormerken',
          back: '\u2190 Zur\u00fcck', backList: '\u2190 Zur\u00fcck zur \u00dcbersicht', share: 'Auf LinkedIn teilen' },
    en: { info: 'Programme & Information',  register: 'Registration',        calendar: 'Add to calendar',
          back: '\u2190 Back', backList: '\u2190 Back to all articles', share: 'Share on LinkedIn' },
    ru: { info: '\u041f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0430 \u0438 \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u044f', register: '\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f', calendar: '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432 \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c',
          back: '\u2190 \u041d\u0430\u0437\u0430\u0434', backList: '\u2190 \u041a\u043e \u0432\u0441\u0435\u043c \u0441\u0442\u0430\u0442\u044c\u044f\u043c', share: '\u041f\u043e\u0434\u0435\u043b\u0438\u0442\u044c\u0441\u044f \u0432 LinkedIn' },
    he: { info: '\u05ea\u05d5\u05db\u05e0\u05d9\u05ea \u05d5\u05de\u05d9\u05d3\u05e2', register: '\u05dc\u05d4\u05e8\u05e9\u05de\u05d4', calendar: '\u05d4\u05d5\u05e1\u05e3 \u05dc\u05d9\u05d5\u05de\u05df',
          back: '\u2192 \u05d7\u05d6\u05e8\u05d4', backList: '\u2192 \u05dc\u05db\u05dc \u05d4\u05de\u05d0\u05de\u05e8\u05d9\u05dd', share: '\u05e9\u05ea\u05e3 \u05d1-LinkedIn' }
  };

  // Optional action buttons - plain, robust links
  var buttons = [];
  if (article.linkInfo)     buttons.push({ key: 'info',     url: article.linkInfo });
  if (article.linkRegister) buttons.push({ key: 'register', url: article.linkRegister });
  if (article.linkCalendar) buttons.push({ key: 'calendar', url: article.linkCalendar });

  var buttonHtml = '';
  if (buttons.length) {
    buttonHtml = '<div class="action-buttons">' + buttons.map(function (b) {
      return '<a class="action-btn" id="abtn-' + b.key + '" href="' + esc(b.url) + '" target="_blank" rel="noopener">' + esc(BTN_LABELS[pageLang][b.key]) + '</a>';
    }).join('') + '</div>';
  }

  // Buttonbeschriftungen an die Sprachdaten hängen
  ['de', 'en', 'ru', 'he'].forEach(function (l) {
    langs[l].btn = BTN_LABELS[l];
  });

  // „Weitere Artikel“: die drei neuesten anderen Artikel, Text je Sprache,
  // Links auf die Fassung in der Sprache dieser Seite
  var RELATED_LABEL = { de: 'Weitere Artikel', en: 'More articles', ru: 'Другие статьи', he: 'מאמרים נוספים' };
  var others = sortArticles(allArticles || []).filter(function (x) {
    return x !== article && (x.id === undefined || x.id !== article.id);
  }).slice(0, 3);
  ['de', 'en', 'ru', 'he'].forEach(function (l) {
    if (!others.length) { langs[l].related = ''; return; }
    langs[l].related = '<h2 class="related-h">' + esc(RELATED_LABEL[l]) + '</h2><ul class="related-list">'
      + others.map(function (o) {
        var t = l === 'de' ? (o.title || o.titleEn)
          : l === 'en' ? (o.titleEn || o.title)
          : l === 'ru' ? (o.titleRu || o.titleEn || o.title)
          : (o.titleHe || o.titleEn || o.title);
        var url = pageLang === 'en' && enPath(o) ? enPath(o) : dePath(o);
        return '<li><a href="' + url + '">' + esc(t || '') + '</a><span class="related-date">' + esc(l === 'de' ? fmtDateDe(o.date) : fmtDateShort(o.date)) + '</span></li>';
      }).join('') + '</ul>';
  });

  var langButtons = ['de', 'en', 'ru', 'he'].map(function (l) {
    return '<button type="button" onclick="setLang(\'' + l + '\')" id="btn-' + l + '" class="lang-btn">' + l.toUpperCase() + '</button>';
  }).join('<span class="lang-sep">\u00b7</span>');

  var schema = safeJson({
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    headline: title,
    description: excerpt,
    author: { '@type': 'Person', name: author },
    datePublished: date,
    inLanguage: pageLang,
    publisher: { '@type': 'Organization', name: 'Vascular Access Talk', url: SITE },
    url: pageUrl
  });

  // hreflang: beide Sprachversionen verweisen gegenseitig aufeinander
  var hreflang = enUrl
    ? '<link rel="alternate" hreflang="de" href="' + deUrl + '">\n'
      + '<link rel="alternate" hreflang="en" href="' + enUrl + '">\n'
      + '<link rel="alternate" hreflang="x-default" href="' + enUrl + '">\n'
    : '';

  var html = '<!DOCTYPE html>\n'
+ '<html lang="' + pageLang + '">\n'
+ '<head>\n'
+ '<meta charset="UTF-8">\n'
+ '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
+ '<title>' + esc(title) + ' \u2013 Vascular Access Talk</title>\n'
+ '<meta name="description" content="' + esc(excerpt) + '">\n'
+ '<meta name="author" content="' + esc(author) + '">\n'
+ '<link rel="canonical" href="' + pageUrl + '">\n'
+ hreflang
+ '<meta property="og:title" content="' + esc(title) + ' \u2013 Vascular Access Talk">\n'
+ '<meta property="og:description" content="' + esc(excerpt) + '">\n'
+ '<meta property="og:url" content="' + pageUrl + '">\n'
+ '<meta property="og:locale" content="' + (pageLang === 'en' ? 'en_US' : 'de_DE') + '">\n'
+ '<meta property="og:type" content="article">\n'
+ '<meta property="og:site_name" content="Vascular Access Talk">\n'
+ (img ? '<meta property="og:image" content="' + esc(img) + '">\n' : '')
+ '<meta property="article:published_time" content="' + esc(date) + '">\n'
+ '<script type="application/ld+json">\n' + schema + '\n<\/script>\n'
+ '<link rel="preconnect" href="https://fonts.bunny.net">\n'
+ '<link href="https://fonts.bunny.net/css2?family=playfair-display:ital,wght@0,400;0,600;1,400&family=lora:ital,wght@0,400;0,500;1,400&family=jost:wght@300;400;500&family=frank-ruhl-libre:wght@400;500&display=swap" rel="stylesheet">\n'
+ '<style>\n'
+ ':root{--bordeaux:#4d1520;--bordeaux-d:#2a0a0e;--gold:#b08a50;--beige:#f2ece0;--text:#2a1a1a;}\n'
+ '*{box-sizing:border-box;margin:0;padding:0;}\n'
+ 'body{font-family:\'Jost\',sans-serif;background:var(--beige);color:var(--text);line-height:1.7;}\n'
+ '.nav{background:var(--bordeaux-d);padding:1rem 2rem;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--gold);flex-wrap:wrap;gap:0.75rem;}\n'
+ '.nav-logo{font-family:\'Playfair Display\',serif;font-size:1.25rem;color:var(--beige);text-decoration:none;}\n'
+ '.nav-logo em{color:var(--gold);font-style:italic;}\n'
+ '.nav-right{display:flex;align-items:center;gap:1rem;}\n'
+ '.nav-back{color:rgba(242,236,224,0.6);text-decoration:none;font-size:0.8rem;letter-spacing:0.1em;}\n'
+ '.nav-back:hover{color:var(--gold);}\n'
+ '.lang-switcher{display:flex;align-items:center;gap:0.15rem;border:1px solid rgba(242,236,224,0.2);padding:0.15rem 0.35rem;}\n'
+ '.lang-btn{padding:0.3rem 0.5rem;border:none;background:none;color:rgba(242,236,224,0.5);font-family:\'Jost\',sans-serif;font-size:0.75rem;letter-spacing:0.08em;cursor:pointer;}\n'
+ '.lang-btn.active{color:var(--gold);font-weight:500;}\n'
+ '.lang-sep{color:rgba(242,236,224,0.2);}\n'
+ '.article-wrap{max-width:720px;margin:3rem auto;padding:0 1.5rem 4rem;}\n'
+ '.article-cat{font-size:0.7rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold);margin-bottom:1rem;}\n'
+ '.article-title{font-family:\'Playfair Display\',serif;font-size:2.25rem;font-weight:400;line-height:1.25;margin-bottom:1rem;}\n'
+ '.article-meta{font-size:0.8rem;color:#8a7060;margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid rgba(42,26,26,0.1);}\n'
+ '.article-img{width:100%;max-height:600px;object-fit:contain;background:#f0ece0;margin-bottom:2rem;}\n'
+ '.article-body{font-family:\'Lora\',serif;font-size:1rem;line-height:1.85;}\n'
+ '.article-body p{margin-bottom:1.1rem;}\n'
+ '.article-body h2{font-family:\'Playfair Display\',serif;font-size:1.5rem;font-weight:400;margin:2rem 0 1rem;}\n'
+ '.article-body h3{font-family:\'Playfair Display\',serif;font-size:1.2rem;font-weight:400;margin:1.5rem 0 0.75rem;}\n'
+ '.article-body a{color:var(--bordeaux);text-decoration:underline;word-break:break-word;}\n'
+ '.article-body hr{border:none;border-top:1px solid rgba(42,26,26,0.15);margin:2rem 0;}\n'
+ '.action-buttons{display:flex;flex-wrap:wrap;gap:0.75rem;margin:2.5rem 0 1rem;}\n'
+ '.action-btn{background:var(--bordeaux);color:var(--beige);padding:0.7rem 1.4rem;font-size:0.82rem;letter-spacing:0.04em;text-decoration:none;display:inline-block;}\n'
+ '.action-btn:hover{background:var(--gold);color:var(--bordeaux-d);}\n'
+ '.article-footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid rgba(42,26,26,0.1);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;}\n'
+ '.back-link{color:var(--bordeaux);text-decoration:none;font-size:0.85rem;}\n'
+ '.related{margin-top:3rem;padding:1.5rem 1.75rem;background:rgba(77,21,32,0.04);border-left:3px solid var(--gold);}\n'
+ '[dir="rtl"] h1,[dir="rtl"] h2,[dir="rtl"] h3,[dir="rtl"].article-title,[dir="rtl"] .related-h,[dir="rtl"]{font-family:\'Frank Ruhl Libre\',\'Lora\',serif;}\n'
+ '.related-h{font-family:\'Playfair Display\',serif;font-size:1.2rem;font-weight:400;margin-bottom:0.75rem;}\n'
+ '.related-list{list-style:none;}\n'
+ '.related-list li{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding:0.55rem 0;border-bottom:1px solid rgba(42,26,26,0.08);}\n'
+ '.related-list li:last-child{border-bottom:none;}\n'
+ '.related-list a{color:var(--bordeaux);text-decoration:none;font-family:\'Lora\',serif;line-height:1.45;}\n'
+ '.related-list a:hover{text-decoration:underline;}\n'
+ '.related-date{font-size:0.75rem;color:#8a7060;white-space:nowrap;}\n'
+ '.article-figure{margin:2rem 0;}\n'
+ '.article-figure img{width:100%;height:auto;display:block;} .article-video video{display:block;max-width:100%;max-height:80vh;margin:0 auto;background:#000;} .article-figure figcaption{font-size:.9rem;color:#666;margin-top:.5rem;text-align:center;}\n'
+ '.li-btn{background:#0077b5;color:#fff;padding:0.5rem 1.25rem;font-size:0.8rem;text-decoration:none;display:inline-block;}\n'
+ '<\/style>\n'
+ '<!-- Privacy-friendly analytics by Plausible -->\n<script async src="https://plausible.io/js/pa-aDB8Ehh5xOrVykRMDJ3bp.js"></script>\n<script>\n  window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};\n  plausible.init()\n</script>\n'
+ '</head>\n'
+ '<body>\n'
+ '<nav class="nav">\n'
+ '  <a href="/" class="nav-logo">Vascular Access <em>Talk</em></a>\n'
+ '  <div class="nav-right">\n'
+ '    <div class="lang-switcher">' + langButtons + '</div>\n'
+ '    <a href="/" class="nav-back" id="nav-back">' + esc(BTN_LABELS[pageLang].back) + '</a>\n'
+ '  </div>\n'
+ '</nav>\n'
+ '<article class="article-wrap">\n'
+ '  <p class="article-cat">' + esc(cat) + '</p>\n'
+ '  <h1 class="article-title" id="art-title">' + esc(title) + '</h1>\n'
+ '  <p class="article-meta">' + esc(author) + ' \u00b7 ' + esc(date) + '</p>\n'
+ (img ? '  <img src="' + esc(img) + '" class="article-img" alt="' + esc(title) + '">\n' : '')
+ '  <div class="article-body" id="art-body">' + langs[pageLang].body + '</div>\n'
+ '  ' + buttonHtml + '\n'
+ (langs[pageLang].related ? '  <nav class="related" id="related">' + langs[pageLang].related + '</nav>\n' : '')
+ '  <div class="article-footer">\n'
+ '    <a href="/" class="back-link" id="back-list">' + esc(BTN_LABELS[pageLang].backList) + '</a>\n'
+ '    <a href="https://www.linkedin.com/sharing/share-offsite/?url=' + pageUrl + '" target="_blank" rel="noopener" class="li-btn" id="share-btn">' + esc(BTN_LABELS[pageLang].share) + '</a>\n'
+ '  </div>\n'
+ '</article>\n'
+ '<script id="langs-data" type="application/json">' + safeJson(langs) + '<\/script>\n'
+ '<script id="page-data" type="application/json">' + safeJson({ lang: pageLang, urls: { de: dePath(article), en: enPath(article) } }) + '<\/script>\n'
+ '<script>\n'
+ 'var LANGS = JSON.parse(document.getElementById("langs-data").textContent);\n'
+ 'var PAGE = JSON.parse(document.getElementById("page-data").textContent);\n'
+ 'function setLang(lang) {\n'
+ '  var l = LANGS[lang];\n'
+ '  if (!l) return;\n'
+ '  try { localStorage.setItem("vat_lang", lang); } catch (e) {}\n'
+ '  // DE und EN haben eigene Adressen: dorthin wechseln statt Text austauschen\n'
+ '  if ((lang === "de" || lang === "en") && lang !== PAGE.lang && PAGE.urls[lang]) {\n'
+ '    window.location.href = PAGE.urls[lang];\n'
+ '    return;\n'
+ '  }\n'
+ '  var t = document.getElementById("art-title");\n'
+ '  var b = document.getElementById("art-body");\n'
+ '  t.textContent = l.title || "";\n'
+ '  b.innerHTML = l.body || "";\n'
+ '  t.setAttribute("dir", l.dir || "ltr");\n'
+ '  b.setAttribute("dir", l.dir || "ltr");\n'
+ '  var rel = document.getElementById("related");\n'
+ '  if (rel && l.related) { rel.innerHTML = l.related; rel.setAttribute("dir", l.dir || "ltr"); }\n'
+ '  if (l.btn) {\n'
+ '    var wrap = document.querySelector(".action-buttons");\n'
+ '    if (wrap) { wrap.setAttribute("dir", l.dir || "ltr"); }\n'
+ '    var map = ["info", "register", "calendar"];\n'
+ '    for (var k = 0; k < map.length; k++) {\n'
+ '      var ab = document.getElementById("abtn-" + map[k]);\n'
+ '      if (ab && l.btn[map[k]]) { ab.textContent = l.btn[map[k]]; }\n'
+ '    }\n'
+ '    var nav = { "nav-back": "back", "back-list": "backList", "share-btn": "share" };\n'
+ '    for (var id in nav) {\n'
+ '      var el = document.getElementById(id);\n'
+ '      if (el && l.btn[nav[id]]) { el.textContent = l.btn[nav[id]]; }\n'
+ '    }\n'
+ '  }\n'
+ '  var keys = ["de", "en", "ru", "he"];\n'
+ '  for (var i = 0; i < keys.length; i++) {\n'
+ '    var btn = document.getElementById("btn-" + keys[i]);\n'
+ '    if (btn) { btn.className = (keys[i] === lang) ? "lang-btn active" : "lang-btn"; }\n'
+ '  }\n'
+ '}\n'
+ 'var saved = PAGE.lang;\n'
+ 'try { saved = localStorage.getItem("vat_lang") || PAGE.lang; } catch (e) {}\n'
+ '// Wer bewusst Englisch gewählt hat, landet von der deutschen Seite auf der englischen\n'
+ 'if (PAGE.lang === "de" && saved === "en" && PAGE.urls.en) { window.location.replace(PAGE.urls.en); }\n'
+ '// Beim Laden nie automatisch umleiten: RU/HE werden eingeblendet, sonst gilt die Sprache der Seite\n'
+ 'setLang(saved === "ru" || saved === "he" ? saved : PAGE.lang);\n'
+ '<\/script>\n'
+ '</body>\n'
+ '</html>';

  return { slug: slug, html: html };
}

// ── Sitemap ───────────────────────────────────────────────

function generateSitemap(articles) {
  var homeAlt = '<xhtml:link rel="alternate" hreflang="de" href="' + SITE + '/"/>'
    + '<xhtml:link rel="alternate" hreflang="en" href="' + SITE + '/en/"/>'
    + '<xhtml:link rel="alternate" hreflang="x-default" href="' + SITE + '/en/"/>';
  var urls = ['<url><loc>' + SITE + '/</loc><changefreq>weekly</changefreq><priority>1.0</priority>' + homeAlt + '</url>'];
  urls.push('<url><loc>' + SITE + '/en/</loc><changefreq>weekly</changefreq><priority>1.0</priority>' + homeAlt + '</url>');
  var symAlt = '<xhtml:link rel="alternate" hreflang="de" href="' + SITE + '/symposium/"/>'
    + '<xhtml:link rel="alternate" hreflang="en" href="' + SITE + '/en/symposium/"/>'
    + '<xhtml:link rel="alternate" hreflang="x-default" href="' + SITE + '/en/symposium/"/>';
  urls.push('<url><loc>' + SITE + '/symposium/</loc><changefreq>weekly</changefreq><priority>0.9</priority>' + symAlt + '</url>');
  urls.push('<url><loc>' + SITE + '/en/symposium/</loc><changefreq>weekly</changefreq><priority>0.9</priority>' + symAlt + '</url>');
  articles.forEach(function (a) {
    var lastmod = a.date || new Date().toISOString().split('T')[0];
    var de = SITE + dePath(a);
    var en = enPath(a) ? SITE + enPath(a) : null;
    var alt = en
      ? '<xhtml:link rel="alternate" hreflang="de" href="' + de + '"/>'
        + '<xhtml:link rel="alternate" hreflang="en" href="' + en + '"/>'
        + '<xhtml:link rel="alternate" hreflang="x-default" href="' + en + '"/>'
      : '';
    urls.push('<url><loc>' + de + '</loc><lastmod>' + lastmod + '</lastmod><changefreq>monthly</changefreq><priority>0.8</priority>' + alt + '</url>');
    if (en) {
      urls.push('<url><loc>' + en + '</loc><lastmod>' + lastmod + '</lastmod><changefreq>monthly</changefreq><priority>0.8</priority>' + alt + '</url>');
    }
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
    + urls.join('\n') + '\n</urlset>';
}


// ── Startseite vorrendern (für Google, LinkedIn & Co.) ────

var LINKEDIN_URL = 'https://www.linkedin.com/in/vladimir-matoussevitch-90879a4/';

function fmtDateDe(d) {
  if (!d) return '';
  var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(d);
  var months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  return parseInt(m[3], 10) + '. ' + months[parseInt(m[2], 10) - 1] + ' ' + m[1];
}

function fmtDateShort(d) {
  var m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '.' + m[2] + '.' + m[1] : String(d || '');
}

function sortArticles(list) {
  return list.slice().sort(function (x, y) {
    var dx = x.date || '', dy = y.date || '';
    if (dx !== dy) return dy.localeCompare(dx);
    return (y.id || 0) - (x.id || 0);
  });
}

// Kopfbereich der Startseite je Sprache: lang, Titel, Beschreibung, Canonical, hreflang
var HOME_META = {
  de: {
    title: 'Vascular Access Talk – Fachblog für Dialyseshuntchirurgie',
    desc: 'Expertenwissen zur Dialyseshuntchirurgie: AV-Fisteln, Prothesenshunts, Stenosen, Thrombosen. Vascular access surgery blog by Dr. V. Matoussevitch.',
    ogDesc: 'Fachblog für Dialyseshuntchirurgie – AV-Fisteln, Prothesenshunts, Komplikationen und aktuelle Forschung.',
    url: SITE + '/', locale: 'de_DE'
  },
  en: {
    title: 'Vascular Access Talk – Blog on Dialysis Access Surgery',
    desc: 'Clinical insight into dialysis access surgery: AV fistulas, AV grafts, stenoses, thromboses and complex revisions. A vascular access blog by Dr. V. Matoussevitch.',
    ogDesc: 'A blog on dialysis access surgery – AV fistulas, AV grafts, complications and current research.',
    url: SITE + '/en/', locale: 'en_US'
  }
};

// Übersetzungen aus index.html lesen (const TRANSLATIONS = {...};), damit die
// englische Startseite schon ohne JavaScript englischen Text enthält
function readTranslations(indexHtml) {
  var start = indexHtml.indexOf('const TRANSLATIONS = {');
  if (start < 0) return null;
  var i = indexHtml.indexOf('{', start), depth = 0, inStr = null;
  for (; i < indexHtml.length; i++) {
    var c = indexHtml[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) break;
  }
  try {
    return require('vm').runInNewContext('(' + indexHtml.slice(indexHtml.indexOf('{', start), i + 1) + ')');
  } catch (e) { console.log('Could not read translations:', e.message); return null; }
}

function translateStaticText(indexHtml, lang) {
  var all = readTranslations(indexHtml);
  var tr = all && all[lang];
  if (!tr) return indexHtml;
  // Wie setLang() im Browser: nur reine Textelemente ersetzen, hero.title als HTML, hero.cta mit Pfeil
  indexHtml = indexHtml.replace(/(<([a-z0-9]+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    function (m, open, tag, key, inner, close) {
      if (!tr[key]) return m;
      if (key === 'hero.title') return open + tr[key] + close;
      if (key === 'hero.cta') { var svgPos = inner.indexOf('<svg'); return open + esc(tr[key]) + ' ' + (svgPos >= 0 ? inner.slice(svgPos) : '') + close; }
      if (inner.indexOf('<') >= 0) return m;
      return open + esc(tr[key]) + close;
    });
  if (tr['author.bio']) {
    indexHtml = indexHtml.replace(/(<[a-z0-9]+\b[^>]*\bid="author-bio"[^>]*>)[^<]*/, '$1' + esc(tr['author.bio']));
  }
  return indexHtml;
}

function localizeIndexHead(indexHtml, lang) {
  var m = HOME_META[lang];
  if (lang !== 'de') indexHtml = translateStaticText(indexHtml, lang);
  // Symposium-Links auf der englischen Startseite zur englischen Symposiumsseite
  if (lang === 'en') indexHtml = indexHtml.split('href="/symposium/"').join('href="/en/symposium/"');
  indexHtml = indexHtml.replace(/<html lang="[^"]*"/, '<html lang="' + lang + '" data-page-lang="' + lang + '"');
  indexHtml = indexHtml.replace(/(<title id="page-title-tag">)[^<]*(<\/title>)/, '$1' + esc(m.title) + '$2');
  indexHtml = indexHtml.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + esc(m.desc) + '">');
  indexHtml = indexHtml.replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + esc(m.ogDesc) + '">');
  indexHtml = indexHtml.replace(/<meta property="og:url" content="[^"]*">/,
    '<meta property="og:url" content="' + m.url + '">\n<meta property="og:locale" content="' + m.locale + '">\n'
    + '<link rel="canonical" href="' + m.url + '">\n'
    + '<link rel="alternate" hreflang="de" href="' + HOME_META.de.url + '">\n'
    + '<link rel="alternate" hreflang="en" href="' + HOME_META.en.url + '">\n'
    + '<link rel="alternate" hreflang="x-default" href="' + HOME_META.en.url + '">');
  return indexHtml;
}

function prerenderIndex(indexHtml, articles, lang) {
  lang = lang === 'en' ? 'en' : 'de';
  var isEn = lang === 'en';
  function tTitle(a) { return isEn ? (a.titleEn || a.title || '') : (a.title || a.titleEn || ''); }
  function tExcerpt(a) { return isEn ? (a.excerptEn || a.excerpt || '') : (a.excerpt || a.excerptEn || ''); }
  function tUrl(a) { return isEn && enPath(a) ? enPath(a) : dePath(a); }
  function tCat(a) { return isEn ? (CAT_EN[a.cat] || a.cat || '') : (a.cat || ''); }

  indexHtml = localizeIndexHead(indexHtml, lang);
  var list = sortArticles(articles);
  indexHtml = indexHtml.replace(/id="stat-count">[^<]*/, 'id="stat-count">' + list.length);
  if (!list.length) return indexHtml;

  var rows = list.map(function (a, i) {
    var url = tUrl(a);
    return '<a class="article-row" href="' + url + '" style="display:flex;text-decoration:none;color:inherit;">'
      + '<div class="article-num">' + String(i + 1).padStart(2, '0') + '</div>'
      + '<div class="article-body"><p class="article-cat">' + esc(tCat(a)) + '</p>'
      + '<h3 class="article-title">' + esc(tTitle(a)) + '</h3>'
      + '<p class="article-excerpt">' + esc(tExcerpt(a)) + '</p></div>'
      + '<div class="article-aside"><p class="article-date">' + esc(fmtDateDe(a.date)) + '</p></div>'
      + '</a>';
  }).join('\n');
  indexHtml = indexHtml.replace(
    /(<div class="article-list" id="article-list">)[\s\S]*?(<\/div>\s*<\/div>\s*<\/section>)/,
    function (m, open, close) { return open + '\n' + rows + '\n    ' + close; });

  var a = list[0];
  var heroUrl = tUrl(a);
  var ex = tExcerpt(a);
  indexHtml = indexHtml.replace(
    /(<div class="featured-card" id="hero-featured">)[\s\S]*?(<\/div>\s*<\/div>\s*<\/div>\s*<\/section>)/,
    function (m, open, close) {
      return open + '\n        <h3><a href="' + heroUrl + '" style="color:inherit;text-decoration:none;">' + esc(tTitle(a)) + '</a></h3>\n'
        + '        <p>' + esc(ex.length > 120 ? ex.substring(0, 120) + '…' : ex) + '</p>\n'
        + '        <div class="card-meta"><span class="tag">' + esc(tCat(a)) + '</span><span class="meta-date">' + esc(fmtDateDe(a.date)) + '</span></div>\n'
        + '      ' + close;
    });

  if (LINKEDIN_URL) {
    ['nav-li-link', 'sidebar-li-link', 'footer-li-link'].forEach(function (id) {
      indexHtml = indexHtml.replace('id="' + id + '" href="#"', 'id="' + id + '" href="' + esc(LINKEDIN_URL) + '"');
    });
  }
  return indexHtml;
}

// ── Build ─────────────────────────────────────────────────

async function build() {
  console.log('Build directory:', process.cwd());
  console.log('Dist directory:', DIST);

  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
    console.log('Cleaned dist/');
  }
  fs.mkdirSync(DIST);

  var articles = [];
  try {
    articles = (await fetchArticles()).map(normalizeArticle);
    console.log('Found ' + articles.length + ' articles');
  } catch (e) {
    console.log('Could not fetch articles:', e.message);
  }

  var indexSrc = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  fs.writeFileSync(path.join(DIST, 'index.html'), prerenderIndex(indexSrc, articles, 'de'));
  console.log('Written:', path.join(DIST, 'index.html'));

  // Englische Startseite unter /en/
  fs.mkdirSync(path.join(DIST, 'en'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'en', 'index.html'), prerenderIndex(indexSrc, articles, 'en'));
  console.log('Written:', path.join(DIST, 'en', 'index.html'));

  var adminDst = path.join(DIST, 'admin');
  fs.mkdirSync(adminDst);
  fs.copyFileSync(path.join(process.cwd(), 'admin', 'index.html'), path.join(adminDst, 'index.html'));
  console.log('Written:', path.join(adminDst, 'index.html'));

  var googleFile = fs.readdirSync(process.cwd()).find(function (f) {
    return f.indexOf('google') === 0 && f.indexOf('.html') > 0;
  });
  if (googleFile) {
    fs.copyFileSync(path.join(process.cwd(), googleFile), path.join(DIST, googleFile));
    console.log('Written:', path.join(DIST, googleFile));
  }

  // Symposium-Seite (statisch)
  var symSrc = path.join(process.cwd(), 'symposium', 'index.html');
  if (fs.existsSync(symSrc)) {
    fs.cpSync(path.join(process.cwd(), 'symposium'), path.join(DIST, 'symposium'), { recursive: true });
    console.log('Written:', path.join(DIST, 'symposium', 'index.html'));
  }

  // Englische Symposiumsseite (statisch)
  if (fs.existsSync(path.join(process.cwd(), 'en', 'symposium', 'index.html'))) {
    fs.cpSync(path.join(process.cwd(), 'en', 'symposium'), path.join(DIST, 'en', 'symposium'), { recursive: true });
    console.log('Written:', path.join(DIST, 'en', 'symposium', 'index.html'));
  }

  // Statische Medien (z. B. Videos für Artikel)
  if (fs.existsSync(path.join(process.cwd(), 'media'))) {
    fs.cpSync(path.join(process.cwd(), 'media'), path.join(DIST, 'media'), { recursive: true });
    console.log('Written:', path.join(DIST, 'media'));
  }

  // Private Seite /ich (eigene Besuche nicht zählen)
  if (fs.existsSync(path.join(process.cwd(), 'ich', 'index.html'))) {
    fs.cpSync(path.join(process.cwd(), 'ich'), path.join(DIST, 'ich'), { recursive: true });
    console.log('Written:', path.join(DIST, 'ich', 'index.html'));
  }

  var artikelDir = path.join(DIST, 'artikel');
  fs.mkdirSync(artikelDir);
  var enArticleDir = path.join(DIST, 'en', 'article');
  articles.forEach(function (article) {
    var page = generateArticlePage(article, 'de', articles);
    var dir = path.join(artikelDir, page.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page.html);
    console.log('Written:', path.join(dir, 'index.html'));

    // Englische Version mit eigener Adresse, sofern übersetzt
    if (hasEn(article)) {
      var enPage = generateArticlePage(article, 'en', articles);
      var enDir = path.join(enArticleDir, enPage.slug);
      fs.mkdirSync(enDir, { recursive: true });
      fs.writeFileSync(path.join(enDir, 'index.html'), enPage.html);
      console.log('Written:', path.join(enDir, 'index.html'));
    }
  });

  // Alte, abgeschnittene Adressen dauerhaft (301) auf die neuen weiterleiten,
  // damit bereits geteilte Links weiter funktionieren
  var redirects = [];
  articles.forEach(function (a) {
    var pairs = [['/artikel/', a.title || a.titleEn || 'artikel']];
    if (hasEn(a)) pairs.push(['/en/article/', a.titleEn]);
    pairs.forEach(function (p) {
      var oldSlug = legacySlugify(p[1]), newSlug = slugify(p[1]);
      if (oldSlug === newSlug) return;
      redirects.push(p[0] + oldSlug + '  ' + p[0] + newSlug + '/  301');
      redirects.push(p[0] + oldSlug + '/  ' + p[0] + newSlug + '/  301');
    });
  });
  fs.writeFileSync(path.join(DIST, '_redirects'), redirects.join('\n') + '\n');
  console.log('Written:', path.join(DIST, '_redirects'), '(' + redirects.length / 2 + ' Weiterleitungen)');

  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), generateSitemap(articles));
  console.log('Written:', path.join(DIST, 'sitemap.xml'));

  fs.writeFileSync(path.join(DIST, 'robots.txt'),
    'User-agent: *\nDisallow: /admin/\nDisallow: /ich/\n\nSitemap: ' + SITE + '/sitemap.xml\n');
  console.log('Written:', path.join(DIST, 'robots.txt'));

  console.log('Build complete!');
}

build().catch(function (e) { console.error(e); process.exit(1); });
