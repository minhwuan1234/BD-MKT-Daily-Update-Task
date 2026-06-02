/**
 * Cloudflare Worker — Daily Report Proxy
 *
 * Nhận POST từ morning.html / evening.html
 * Ghi file JSON vào GitHub repo qua API
 * Trigger repository_dispatch để GitHub Actions collect + gửi PM
 *
 * Secrets cần set trong Worker:
 *   GITHUB_PAT  — Personal Access Token (repo scope)
 *
 * Env vars (Worker settings → Variables):
 *   GITHUB_OWNER = "minhwuan1234"
 *   GITHUB_REPO  = "daily-report"
 */

const GITHUB_OWNER    = 'minhwuan1234';
const GITHUB_REPO     = 'daily-report';
const GITHUB_API      = 'https://api.github.com';

// Paste Web app URL tu Apps Script vao day
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxxHT2knb2x_Z5bH-271uvVhtG_0ItIVrLAYRJWCezO0wel-d_peJKoTq_NJb2pzagyAA/exec';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const { type, userId, date, tasks, submittedAt } = body;

    // Validate
    if (!type || !userId || !date || !tasks) {
      return json({ error: 'Missing required fields: type, userId, date, tasks' }, 400);
    }
    if (type !== 'morning' && type !== 'evening') {
      return json({ error: 'type must be "morning" or "evening"' }, 400);
    }

    // Build file path: reports/YYYY-MM-DD/morning|evening/ou_xxx.json
    const filePath = `reports/${date}/${type}/${userId}.json`;
    // Lookup tên từ members.json
const membersRes = await fetch(
  `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/members.json`
);
const members = await membersRes.json();
const idToName = Object.fromEntries(Object.entries(members).map(([n, id]) => [id, n]));
const memberName = idToName[userId] || userId;

const fileContent = JSON.stringify({ userId, memberName, tasks, submittedAt }, null, 2);

    try {
      // Ghi file vào GitHub
      await writeToGitHub(env.GITHUB_PAT, filePath, fileContent, date, type, userId);

      // Trigger repository_dispatch → GitHub Actions collect workflow
      await triggerDispatch(env.GITHUB_PAT, type, { userId, date, filePath });

      // Ghi vao Google Sheets (non-blocking — loi khong anh huong den response)
      fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, memberName }),
      }).catch(function(e) { console.error('Sheets error:', e); });

      return json({ ok: true, path: filePath });
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: err.message }, 500);
    }
  }
};

// ─── Write file to GitHub ───────────────────────────────────────────────────
async function writeToGitHub(pat, filePath, content, date, type, userId) {
  const url = `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const encodedContent = btoa(unescape(encodeURIComponent(content)));

  // Check if file exists (to get SHA for update)
  let sha;
  const getRes = await fetch(url, {
    headers: {
      Authorization: `token ${pat}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'daily-report-worker',
    },
  });
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
  }

  const body = {
    message: `report: ${type} ${userId} ${date}`,
    content: encodedContent,
    ...(sha ? { sha } : {}),
  };

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${pat}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'daily-report-worker',
    },
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const errBody = await putRes.text();
    throw new Error(`GitHub write failed ${putRes.status}: ${errBody}`);
  }
}

// ─── Trigger repository_dispatch ────────────────────────────────────────────
async function triggerDispatch(pat, type, clientPayload) {
  const eventType = type === 'morning' ? 'morning-submitted' : 'evening-submitted';

  const res = await fetch(
    `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${pat}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'daily-report-worker',
      },
      body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
    }
  );

  if (!res.ok && res.status !== 204) {
    const errBody = await res.text();
    throw new Error(`Dispatch failed ${res.status}: ${errBody}`);
  }
}

// ─── Helper ─────────────────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
