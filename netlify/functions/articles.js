const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = 'vmatoussevitch-ops';
const REPO = 'vat-articles';
const FILE = 'articles.json';
const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };

  try {
    if (event.httpMethod === 'GET') {
      const res = await fetch(API_URL, { headers: ghHeaders });
      const data = await res.json();
      // Decode base64 to UTF-8 and return parsed articles + sha
      const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ articles: parsed.articles || [], sha: data.sha })
      };
    }

    if (event.httpMethod === 'PUT') {
      const { articles, sha } = JSON.parse(event.body);
      // Encode articles back to base64
      const content = Buffer.from(JSON.stringify({ articles, version: 1 }, null, 2)).toString('base64');
      const res = await fetch(API_URL, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify({
          message: `Update articles ${new Date().toISOString()}`,
          content,
          sha
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'GitHub save failed');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ sha: data.content.sha })
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
