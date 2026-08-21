const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = 'vmatoussevitch-ops';
const REPO = 'vat-articles';
const FILE = 'articles.json';

function githubRequest(method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/contents/${FILE}`,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'vascular-access-talk',
        'Content-Type': 'application/json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    
    const req = https.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: result }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
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
      const res = await githubRequest('GET');
      const data = JSON.parse(res.body);
      const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ articles: parsed.articles || [], sha: data.sha })
      };
    }

    if (event.httpMethod === 'PUT') {
      const { articles, sha } = JSON.parse(event.body);
      const content = Buffer.from(
        JSON.stringify({ articles, version: 1 }, null, 2)
      ).toString('base64');
      
      const res = await githubRequest('PUT', {
        message: `Update articles ${new Date().toISOString()}`,
        content,
        sha
      });
      
      const data = JSON.parse(res.body);
      if (res.status !== 200) throw new Error(data.message || 'Save failed');
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ sha: data.content.sha })
      };
    }

    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch(e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: e.message })
    };
  }
};
