exports.handler = async (event) => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const apiUrl = 'https://api.github.com/repos/vmatoussevitch-ops/vat-articles/contents/articles.json';
  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    if (event.httpMethod === 'GET') {
      const res = await fetch(apiUrl, { headers: ghHeaders });
      const data = await res.json();
      // Decode base64 to UTF-8 string properly
      const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
      const articles = JSON.parse(decoded);
      // Return the parsed articles AND the sha for saving
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ articles: articles.articles || [], sha: data.sha })
      };
    }

    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body);
      const res = await fetch(apiUrl, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify(body)
      });
      const data = await res.json();
      return {
        statusCode: res.status,
        headers: corsHeaders,
        body: JSON.stringify({ sha: data.content ? data.content.sha : null })
      };
    }
  } catch(e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: e.message })
    };
  }
};
