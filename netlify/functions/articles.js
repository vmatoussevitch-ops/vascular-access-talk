// Netlify Function: Proxy for GitHub articles API
// Token stays on server, never exposed to browser

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = 'vmatoussevitch-ops';
const REPO = 'vat-articles';
const FILE = 'articles.json';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://vascularaccesstalk.com',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;
  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };

  try {
    if (event.httpMethod === 'GET') {
      // Load articles
      const res = await fetch(apiUrl, { headers: ghHeaders });
      const data = await res.json();
      // Decode and re-encode properly to fix UTF-8
      if (data.content) {
        const decoded = Buffer.from(data.content.replace(/\n/g,''), 'base64').toString('utf8');
        data.content = Buffer.from(decoded).toString('base64');
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data)
      };
    }

    if (event.httpMethod === 'PUT') {
      // Save articles
      const body = JSON.parse(event.body);
      const res = await fetch(apiUrl, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify(body)
      });
      const data = await res.json();
      return {
        statusCode: res.status,
        headers,
        body: JSON.stringify(data)
      };
    }

  } catch(e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message })
    };
  }
};
