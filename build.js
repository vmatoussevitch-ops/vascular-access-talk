const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DIST = path.join(process.cwd(), 'dist');

// ── Helpers ───────────────────────────────────────────────

function slugify(text) {
  return (text || '').toLowerCase()
    .replace(/[\u00e4\u00c4]/g, 'ae').replace(/[\u00f6\u00d6]/g, 'oe').replace(/[\u00fc\u00dc]/g, 'ue')
    .replace(/\u00df/g, 'ss').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').substring(0, 60);
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
function renderMarkdown(text) {
  if (!text) return '';
  var lines = String(text).split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\s+$/, '');
    if (line === '') continue;
    if (line === '---') { out.push('<hr>'); continue; }
    var m;
    if ((m = line.match(/^###\s+(.*)$/))) { out.push('<h3>' + inline(m[1]) + '</h3>'); continue; }
    if ((m = line.match(/^##\s+(.*)$/)))  { out.push('<h2>' + inline(m[1]) + '</h2>'); continue; }
    if ((m = line.match(/^#\s+(.*)$/)))   { out.push('<h2>' + inline(m[1]) + '</h2>'); continue; }
    out.push('<p>' + inline(line) + '</p>');
  }
  return out.join('\n');
}

function fetchArticles() {
  return new Promise(function (resolve, reject) {
    var options = {
      hostname: 'api.github.com',
      path: '/repos/vmatoussevitch-ops/vat-articles/contents/articles.json',
      headers: {
        'Authorization': 'token ' + GITHUB_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'vascular-access-talk-build'
      }
    };
    https.get(options, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try {
          var json = JSON.parse(data);
          var text = Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf8');
          resolve(JSON.parse(text).articles || []);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Article page ──────────────────────────────────────────

function generateArticlePage(article) {
  var slug = slugify(article.title || article.titleEn || 'artikel');

  // Markdown rendered here, in Node. The browser only swaps ready HTML.
  var langs = {
    de: {
      title: article.title || article.titleEn || '',
      body: renderMarkdown(article.body || article.bodyEn || ''),
      dir: 'ltr'
    },
    en: {
      title: article.titleEn || article.title || '',
      body: renderMarkdown(article.bodyEn || article.body || ''),
      dir: 'ltr'
    },
    ru: {
      title: article.titleRu || article.titleEn || article.title || '',
      body: renderMarkdown(article.bodyRu || article.bodyEn || article.body || ''),
      dir: 'ltr'
    },
    he: {
      title: article.titleHe || article.titleEn || article.title || '',
      body: renderMarkdown(article.bodyHe || article.bodyEn || article.body || ''),
      dir: 'rtl'
    }
  };

  var title = article.title || article.titleEn || '';
  var excerpt = (article.excerpt || article.excerptEn || '').substring(0, 155);
  var date = article.date || '';
  var author = article.author || 'Dr. V. Matoussevitch';
  var img = article.img && (article.img.indexOf('data:image') === 0 || /\.(jpg|jpeg|png|webp)$/i.test(article.img)) ? article.img : '';

  // Optional action buttons - plain, robust links
  var buttons = [];
  if (article.linkInfo)     buttons.push({ label: 'Programm & Informationen', url: article.linkInfo });
  if (article.linkRegister) buttons.push({ label: 'Zur Anmeldung', url: article.linkRegister });
  if (article.linkCalendar) buttons.push({ label: 'Termin vormerken', url: article.linkCalendar });

  var buttonHtml = '';
  if (buttons.length) {
    buttonHtml = '<div class="action-buttons">' + buttons.map(function (b) {
      return '<a class="action-btn" href="' + esc(b.url) + '" target="_blank" rel="noopener">' + esc(b.label) + '</a>';
    }).join('') + '</div>';
  }

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
    publisher: { '@type': 'Organization', name: 'Vascular Access Talk', url: 'https://vascularaccesstalk.com' },
    url: 'https://vascularaccesstalk.com/artikel/' + slug + '/'
  });

  var html = '<!DOCTYPE html>\n'
+ '<html lang="de">\n'
+ '<head>\n'
+ '<meta charset="UTF-8">\n'
+ '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
+ '<title>' + esc(title) + ' \u2013 Vascular Access Talk</title>\n'
+ '<meta name="description" content="' + esc(excerpt) + '">\n'
+ '<meta name="author" content="' + esc(author) + '">\n'
+ '<link rel="canonical" href="https://vascularaccesstalk.com/artikel/' + slug + '/">\n'
+ '<meta property="og:title" content="' + esc(title) + ' \u2013 Vascular Access Talk">\n'
+ '<meta property="og:description" content="' + esc(excerpt) + '">\n'
+ '<meta property="og:url" content="https://vascularaccesstalk.com/artikel/' + slug + '/">\n'
+ '<meta property="og:type" content="article">\n'
+ '<meta property="og:site_name" content="Vascular Access Talk">\n'
+ (img ? '<meta property="og:image" content="' + esc(img) + '">\n' : '')
+ '<meta property="article:published_time" content="' + esc(date) + '">\n'
+ '<script type="application/ld+json">\n' + schema + '\n<\/script>\n'
+ '<link rel="preconnect" href="https://fonts.bunny.net">\n'
+ '<link href="https://fonts.bunny.net/css2?family=playfair-display:ital,wght@0,400;0,600;1,400&family=lora:ital,wght@0,400;0,500;1,400&family=jost:wght@300;400;500&display=swap" rel="stylesheet">\n'
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
+ '.li-btn{background:#0077b5;color:#fff;padding:0.5rem 1.25rem;font-size:0.8rem;text-decoration:none;display:inline-block;}\n'
+ '<\/style>\n'
+ '</head>\n'
+ '<body>\n'
+ '<nav class="nav">\n'
+ '  <a href="/" class="nav-logo">Vascular Access <em>Talk</em></a>\n'
+ '  <div class="nav-right">\n'
+ '    <div class="lang-switcher">' + langButtons + '</div>\n'
+ '    <a href="/" class="nav-back">\u2190 Zur\u00fcck</a>\n'
+ '  </div>\n'
+ '</nav>\n'
+ '<article class="article-wrap">\n'
+ '  <p class="article-cat">' + esc(article.cat || 'Allgemeines') + '</p>\n'
+ '  <h1 class="article-title" id="art-title">' + esc(title) + '</h1>\n'
+ '  <p class="article-meta">' + esc(author) + ' \u00b7 ' + esc(date) + '</p>\n'
+ (img ? '  <img src="' + esc(img) + '" class="article-img" alt="' + esc(title) + '">\n' : '')
+ '  <div class="article-body" id="art-body">' + langs.de.body + '</div>\n'
+ '  ' + buttonHtml + '\n'
+ '  <div class="article-footer">\n'
+ '    <a href="/" class="back-link">\u2190 Zur\u00fcck zur \u00dcbersicht</a>\n'
+ '    <a href="https://www.linkedin.com/sharing/share-offsite/?url=https://vascularaccesstalk.com/artikel/' + slug + '/" target="_blank" rel="noopener" class="li-btn">Auf LinkedIn teilen</a>\n'
+ '  </div>\n'
+ '</article>\n'
+ '<script id="langs-data" type="application/json">' + safeJson(langs) + '<\/script>\n'
+ '<script>\n'
+ 'var LANGS = JSON.parse(document.getElementById("langs-data").textContent);\n'
+ 'function setLang(lang) {\n'
+ '  var l = LANGS[lang];\n'
+ '  if (!l) return;\n'
+ '  try { localStorage.setItem("vat_lang", lang); } catch (e) {}\n'
+ '  var t = document.getElementById("art-title");\n'
+ '  var b = document.getElementById("art-body");\n'
+ '  t.textContent = l.title || "";\n'
+ '  b.innerHTML = l.body || "";\n'
+ '  t.setAttribute("dir", l.dir || "ltr");\n'
+ '  b.setAttribute("dir", l.dir || "ltr");\n'
+ '  var keys = ["de", "en", "ru", "he"];\n'
+ '  for (var i = 0; i < keys.length; i++) {\n'
+ '    var btn = document.getElementById("btn-" + keys[i]);\n'
+ '    if (btn) { btn.className = (keys[i] === lang) ? "lang-btn active" : "lang-btn"; }\n'
+ '  }\n'
+ '}\n'
+ 'var saved = "de";\n'
+ 'try { saved = localStorage.getItem("vat_lang") || "de"; } catch (e) {}\n'
+ 'setLang(saved);\n'
+ '<\/script>\n'
+ '</body>\n'
+ '</html>';

  return { slug: slug, html: html };
}

// ── Sitemap ───────────────────────────────────────────────

function generateSitemap(articles) {
  var urls = ['<url><loc>https://vascularaccesstalk.com/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>'];
  articles.forEach(function (a) {
    var slug = slugify(a.title || a.titleEn || 'artikel');
    var lastmod = a.date || new Date().toISOString().split('T')[0];
    urls.push('<url><loc>https://vascularaccesstalk.com/artikel/' + slug + '/</loc><lastmod>' + lastmod + '</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>');
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>';
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
    articles = await fetchArticles();
    console.log('Found ' + articles.length + ' articles');
  } catch (e) {
    console.log('Could not fetch articles:', e.message);
  }

  var indexHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  indexHtml = indexHtml.replace(/id="stat-count">[^<]*/, 'id="stat-count">' + articles.length);
  fs.writeFileSync(path.join(DIST, 'index.html'), indexHtml);
  console.log('Written:', path.join(DIST, 'index.html'));

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

  var artikelDir = path.join(DIST, 'artikel');
  fs.mkdirSync(artikelDir);
  articles.forEach(function (article) {
    var page = generateArticlePage(article);
    var dir = path.join(artikelDir, page.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page.html);
    console.log('Written:', path.join(dir, 'index.html'));
  });

  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), generateSitemap(articles));
  console.log('Written:', path.join(DIST, 'sitemap.xml'));

  console.log('Build complete!');
}

build().catch(function (e) { console.error(e); process.exit(1); });
