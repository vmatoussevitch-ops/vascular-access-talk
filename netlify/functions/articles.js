exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const TOKEN = process.env.GITHUB_TOKEN;
  const URL = 'https://api.github.com/repos/vmatoussevitch-ops/vat-articles/contents/articles.json';
  const GH = { 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'vat' };

  try {
    if (event.httpMethod === 'GET') {
      const res = await fetch(URL, { headers: GH });
      const d = await res.json();
      const text = Buffer.from(d.content.replace(/\n/g,''), 'base64').toString('utf8');
      const parsed = JSON.parse(text);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ articles: parsed.articles || [], sha: d.sha }) };
    }

    if (event.httpMethod === 'PUT') {
      const { articles, sha } = JSON.parse(event.body);
      const content = Buffer.from(JSON.stringify({ articles, version: 1 }, null, 2)).toString('base64');
      const res = await fetch(URL, {
        method: 'PUT', headers: GH,
        body: JSON.stringify({ message: 'Update articles', content, sha })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ sha: d.content.sha }) };
    }
  } catch(e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
