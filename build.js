const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DIST = path.join(process.cwd(), 'dist');


function parseMarkdown(text) {
  if(!text) return '';
  // Use RegExp constructor to avoid regex literal parsing issues
  text = text.replace(new RegExp('^### (.+)$', 'gm'), '<h3>$1</h3>');
  text = text.replace(new RegExp('^## (.+)$', 'gm'), '<h2>$1</h2>');
  text = text.replace(new RegExp('^# (.+)$', 'gm'), '<h1>$1</h1>');
  text = text.replace(new RegExp('\\*\\*\\*(.+?)\\*\\*\\*', 'g'), '<strong><em>$1</em></strong>');
  text = text.replace(new RegExp('\\*\\*(.+?)\\*\\*', 'g'), '<strong>$1</strong>');
  text = text.replace(new RegExp('\\*(.+?)\\*', 'g'), '<em>$1</em>');
  text = text.replace(new RegExp('\\[(.+?)\\]\\((.+?)\\)', 'g'), function(m, t, u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>'; });
  text = text.replace(new RegExp('^---$', 'gm'), '<hr>');
  text = text.replace(new RegExp('\n', 'g'), '<br>');
  return text;
}

function slugify(text) {
  return (text||'').toLowerCase()
    .replace(/[äÄ]/g,'ae').replace(/[öÖ]/g,'oe').replace(/[üÜ]/g,'ue')
    .replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'').substring(0,60);
}

function fetchArticles() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/vmatoussevitch-ops/vat-articles/contents/articles.json',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'vascular-access-talk-build'
      }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const content = JSON.parse(Buffer.from(json.content.replace(/\n/g,''), 'base64').toString('utf8'));
          resolve(content.articles || []);
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function generateArticlePage(article) {
  const slug = slugify(article.title || article.titleEn || 'artikel');

  // Language versions
  const langs = {
    de: { title: article.title, excerpt: article.excerpt, body: article.body, label: 'DE', dir: 'ltr' },
    en: { title: article.titleEn || article.title, excerpt: article.excerptEn || article.excerpt, body: article.bodyEn || article.body, label: 'EN', dir: 'ltr' },
    ru: { title: article.titleRu || article.titleEn || article.title, excerpt: article.excerptRu || article.excerptEn || article.excerpt, body: article.bodyRu || article.bodyEn || article.body, label: 'RU', dir: 'ltr' },
    he: { title: article.titleHe || article.titleEn || article.title, excerpt: article.excerptHe || article.excerptEn || article.excerpt, body: article.bodyHe || article.bodyEn || article.body, label: 'HE', dir: 'rtl' }
  };

  const title = article.title || article.titleEn || '';
  const excerpt = article.excerpt || article.excerptEn || '';
  const date = article.date || '';
  const author = article.author || 'Dr. V. Matoussevitch';
  const img = article.img && (article.img.startsWith('data:image') || article.img.match(/\.(jpg|jpeg|png|webp)$/i)) ? article.img : '';

  const langButtons = Object.keys(langs).map(l =>
    `<button onclick="setLang('${l}')" id="btn-${l}" style="padding:0.4rem 0.75rem;border:none;background:none;color:rgba(242,236,224,0.5);font-family:'Jost',sans-serif;font-size:0.75rem;letter-spacing:0.1em;cursor:pointer;">${l.toUpperCase()}</button>`
  ).join('<span style="color:rgba(242,236,224,0.2)">·</span>');

  // Safely escape for embedding in HTML/JS
  const langData = JSON.stringify(langs).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

  return { slug, html: `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} – Vascular Access Talk</title>
<meta name="description" content="${excerpt.substring(0,155)}">
<meta name="author" content="${author}">
<link rel="canonical" href="https://vascularaccesstalk.com/artikel/${slug}/">
<meta property="og:title" content="${title} – Vascular Access Talk">
<meta property="og:description" content="${excerpt.substring(0,155)}">
<meta property="og:url" content="https://vascularaccesstalk.com/artikel/${slug}/">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Vascular Access Talk">
${img ? `<meta property="og:image" content="${img}">` : ''}
<meta property="article:published_time" content="${date}">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"MedicalWebPage","headline":"${title}","description":"${excerpt.substring(0,155)}","author":{"@type":"Person","name":"${author}"},"datePublished":"${date}","publisher":{"@type":"Organization","name":"Vascular Access Talk","url":"https://vascularaccesstalk.com"},"url":"https://vascularaccesstalk.com/artikel/${slug}/"}
</script>
<link rel="preconnect" href="https://fonts.bunny.net">
<link href="https://fonts.bunny.net/css2?family=playfair-display:ital,wght@0,400;0,600;1,400&family=lora:ital,wght@0,400;0,500;1,400&family=jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>
:root{--bordeaux:#4d1520;--bordeaux-d:#2a0a0e;--gold:#b08a50;--beige:#f2ece0;--text:#2a1a1a;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Jost',sans-serif;background:var(--beige);color:var(--text);line-height:1.7;}
.nav{background:var(--bordeaux-d);padding:1rem 2rem;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--gold);flex-wrap:wrap;gap:0.5rem;}
.nav-logo{font-family:'Playfair Display',serif;font-size:1.25rem;color:var(--beige);text-decoration:none;}
.nav-logo em{color:var(--gold);font-style:italic;}
.nav-right{display:flex;align-items:center;gap:1rem;}
.nav-back{color:rgba(242,236,224,0.6);text-decoration:none;font-size:0.8rem;letter-spacing:0.1em;}
.nav-back:hover{color:var(--gold);}
.lang-switcher{display:flex;align-items:center;gap:0.15rem;border:1px solid rgba(242,236,224,0.2);padding:0.15rem;}
.lang-switcher button.active{color:var(--gold)!important;font-weight:500;}
.article-wrap{max-width:720px;margin:3rem auto;padding:0 1.5rem 4rem;}
.article-cat{font-size:0.7rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold);margin-bottom:1rem;}
.article-title{font-family:'Playfair Display',serif;font-size:2.25rem;font-weight:400;line-height:1.25;margin-bottom:1rem;}
.article-meta{font-size:0.8rem;color:#8a7060;margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid rgba(42,26,26,0.1);}
.article-img{width:100%;max-height:600px;object-fit:contain;background:#f0ece0;margin-bottom:2rem;}
.article-body{font-family:'Lora',serif;font-size:1rem;line-height:1.85;white-space:pre-wrap;}
.article-footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid rgba(42,26,26,0.1);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;}
.back-link{color:var(--bordeaux);text-decoration:none;font-size:0.85rem;}
.li-btn{background:#0077b5;color:#fff;border:none;padding:0.5rem 1.25rem;font-size:0.8rem;cursor:pointer;text-decoration:none;display:inline-block;}
</style>
</head>
<body>
<nav class="nav">
  <a href="/" class="nav-logo">Vascular Access <em>Talk</em></a>
  <div class="nav-right">
    <div class="lang-switcher">${langButtons}</div>
    <a href="/" class="nav-back">← Zurück</a>
  </div>
</nav>
<article class="article-wrap">
  <p class="article-cat">${article.cat||'Allgemeines'}</p>
  <h1 class="article-title" id="art-title">${title}</h1>
  <p class="article-meta">${author} · ${date}</p>
  ${img ? `<img src="${img}" class="article-img" alt="${title}">` : ''}
  <div class="article-body" id="art-body"></div>
  <div class="article-footer">
    <a href="/" class="back-link">← Zurück zur Übersicht</a>
    <a href="https://www.linkedin.com/sharing/share-offsite/?url=https://vascularaccesstalk.com/artikel/${slug}/" target="_blank" class="li-btn">Auf LinkedIn teilen</a>
  </div>
</article>
<script id="langs-data" type="application/json">${langData}</script>
<script>
const LANGS = JSON.parse(document.getElementById('langs-data').textContent);
let currentLang = localStorage.getItem('vat_lang') || 'de';



function parseMarkdown(text) {
  if(!text) return '';
  // Use RegExp constructor to avoid regex literal parsing issues
  text = text.replace(new RegExp('^### (.+)$', 'gm'), '<h3>$1</h3>');
  text = text.replace(new RegExp('^## (.+)$', 'gm'), '<h2>$1</h2>');
  text = text.replace(new RegExp('^# (.+)$', 'gm'), '<h1>$1</h1>');
  text = text.replace(new RegExp('\\*\\*\\*(.+?)\\*\\*\\*', 'g'), '<strong><em>$1</em></strong>');
  text = text.replace(new RegExp('\\*\\*(.+?)\\*\\*', 'g'), '<strong>$1</strong>');
  text = text.replace(new RegExp('\\*(.+?)\\*', 'g'), '<em>$1</em>');
  text = text.replace(new RegExp('\\[(.+?)\\]\\((.+?)\\)', 'g'), function(m, t, u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>'; });
  text = text.replace(new RegExp('^---$', 'gm'), '<hr>');
  text = text.replace(new RegExp('\n', 'g'), '<br>');
  return text;
}

function setLang(lang) {
  if(!LANGS[lang]) return;
  currentLang = lang;
  localStorage.setItem('vat_lang', lang);
  const l = LANGS[lang];
  document.getElementById('art-title').innerHTML = l.title || '';
  document.getElementById('art-body').innerHTML = parseMarkdown(l.body || '');
  document.getElementById('art-body').style.direction = l.dir || 'ltr';
  document.getElementById('art-title').style.direction = l.dir || 'ltr';
  Object.keys(LANGS).forEach(k => {
    const btn = document.getElementById('btn-' + k);
    if(btn) btn.classList.toggle('active', k === lang);
  });
}

// Init
setLang(currentLang);
</script>
</body>
</html>`};
}


function generateSitemap(articles) {
  const urls = [
    '<url><loc>https://vascularaccesstalk.com/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>'
  ];
  articles.forEach(a => {
    const slug = slugify(a.title || a.titleEn || 'artikel');
    urls.push(`<url><loc>https://vascularaccesstalk.com/artikel/${slug}/</loc><lastmod>${a.date||new Date().toISOString().split('T')[0]}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
}

async function build() {
  console.log('Build directory:', process.cwd());
  console.log('Dist directory:', DIST);

  // 1. Clean and create dist
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
    console.log('Cleaned dist/');
  }
  fs.mkdirSync(DIST);

  // 2. Copy index.html to dist
  let indexHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');

  // 3. Fetch articles
  let articles = [];
  try {
    articles = await fetchArticles();
    console.log(`Found ${articles.length} articles`);
  } catch(e) {
    console.log('Could not fetch articles:', e.message);
  }

  // 4. Update article count in index.html
  indexHtml = indexHtml.replace(/id="stat-count">[^<]*/, `id="stat-count">${articles.length}`);

  // 5. Write index.html to dist
  fs.writeFileSync(path.join(DIST, 'index.html'), indexHtml);
  console.log('Written:', path.join(DIST, 'index.html'));

  // 6. Copy admin folder
  const adminSrc = path.join(process.cwd(), 'admin');
  const adminDst = path.join(DIST, 'admin');
  fs.mkdirSync(adminDst);
  fs.copyFileSync(path.join(adminSrc, 'index.html'), path.join(adminDst, 'index.html'));
  console.log('Written:', path.join(adminDst, 'index.html'));

  // 7. Copy Google verification file if exists
  const googleFile = fs.readdirSync(process.cwd()).find(f => f.startsWith('google') && f.endsWith('.html'));
  if (googleFile) {
    fs.copyFileSync(path.join(process.cwd(), googleFile), path.join(DIST, googleFile));
    console.log('Written:', path.join(DIST, googleFile));
  }

  // 8. Generate article pages in dist
  const artikelDir = path.join(DIST, 'artikel');
  fs.mkdirSync(artikelDir);
  articles.forEach(article => {
    const { slug, html } = generateArticlePage(article);
    const dir = path.join(artikelDir, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    console.log('Written:', path.join(dir, 'index.html'));
  });

  // 9. Generate sitemap
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), generateSitemap(articles));
  console.log('Written:', path.join(DIST, 'sitemap.xml'));

  console.log('Build complete!');
}

build().catch(console.error);
