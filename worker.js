/**
 * Cloudflare Worker — Daily Report Proxy v2
 *
 * POST /          — nhận submit từ morning.html / evening.html
 * POST /lark-callback — nhận button action từ Lark card (PM approve/clarify)
 *
 * Secrets:
 *   GITHUB_PAT          — Personal Access Token (repo scope)
 *   LARK_APP_ID         — Lark App ID
 *   LARK_APP_SECRET     — Lark App Secret
 *   LARK_VERIFY_TOKEN   — Lark verification token (từ Lark app config)
 *
 * Env vars:
 *   GITHUB_OWNER = "minhwuan1234"
 *   GITHUB_REPO  = "BD-MKT-Daily-Update-Task"
 */

const GITHUB_OWNER = 'minhwuan1234';
const GITHUB_REPO  = 'BD-MKT-Daily-Update-Task';
const GITHUB_API   = 'https://api.github.com';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxS3n4cKggCmuss8yo9P6mQ9NyW1OX3xviwK_W9z5IOVx1Ff--amH1GQH5Ug2iwevlt/exec';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // ── ROUTE: Lark callback ────────────────────────────────────
    if (url.pathname === '/lark-callback') {
      return handleLarkCallback(request, env);
    }

    // ── ROUTE: Form submit (morning / evening) ──────────────────
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

    if (!type || !userId || !date || !tasks) {
      return json({ error: 'Missing required fields: type, userId, date, tasks' }, 400);
    }
    if (type !== 'morning' && type !== 'evening') {
      return json({ error: 'type must be "morning" or "evening"' }, 400);
    }

    const filePath = `reports/${date}/${type}/${userId}.json`;

    // Lookup tên từ members.json
    const membersRes = await fetch(
      `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/members.json`
    );
    const members   = await membersRes.json();
    const idToName  = Object.fromEntries(Object.entries(members).map(([n, o]) => [o.id, n]));
    const memberName = idToName[userId] || userId;

    const fileContent = JSON.stringify({ userId, memberName, tasks, submittedAt }, null, 2);

    try {
      await writeToGitHub(env.GITHUB_PAT, filePath, fileContent, date, type, userId);
      await triggerDispatch(env.GITHUB_PAT, type, { userId, date, filePath });

      // Ghi vào Sheets (non-blocking)
      fetch(APPS_SCRIPT_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...body, memberName }),
      }).catch(e => console.error('Sheets error:', e));

      return json({ ok: true, path: filePath });
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: err.message }, 500);
    }
  }
};

// ─── Lark Callback Handler ───────────────────────────────────────────────────
async function handleLarkCallback(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // Lark URL verification challenge
  if (body.type === 'url_verification') {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Chỉ xử lý card action (button click)
  const action = body?.event?.action;
  if (!action) return new Response('OK');

  const actionValue = action.value || {};
  const pmOpenId    = body?.event?.operator?.operator_id?.open_id;
  const actionType  = actionValue.type;       // 'approve' | 'clarify'
  const userId      = actionValue.userId;
  const date        = actionValue.date;
  const messageId   = body?.event?.context?.open_message_id;

  if (!actionType || !userId || !date) return new Response('OK');

  // Lấy Lark token
  const token = await getLarkToken(env.LARK_APP_ID, env.LARK_APP_SECRET);
  if (!token) return new Response('OK');

  // Lookup member name
  const membersRes = await fetch(
    `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/members.json`
  );
  const members  = await membersRes.json();
  const idToName = Object.fromEntries(Object.entries(members).map(([n, o]) => [o.id, n]));
  const memberName = idToName[userId] || userId;

  const dateFormatted = (() => {
    try {
      const d = new Date(date);
      return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });
    } catch { return date; }
  })();

  if (actionType === 'approve') {
    // 1. Cập nhật trạng thái trong file GitHub
    await updateApprovalStatus(env.GITHUB_PAT, userId, date, { status: 'approved', pmId: pmOpenId });

    // 2. Gửi notification cho junior
    await larkPost(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
      {
        receive_id: userId,
        msg_type:   'interactive',
        content:    JSON.stringify(buildApprovedCard(memberName, dateFormatted)),
      },
      token
    );

    // 3. Update card PM (thay nút bằng trạng thái đã duyệt)
    if (messageId) {
      await updateLarkCard(token, messageId, buildCardApprovedState(memberName, dateFormatted));
    }

  } else if (actionType === 'clarify') {
    // Lark card với input box để PM gõ note
    // Do Lark không hỗ trợ input trong callback trực tiếp,
    // ta gửi PM một card mới để PM reply
    await larkPost(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
      {
        receive_id: pmOpenId,
        msg_type:   'interactive',
        content:    JSON.stringify(buildClarifyInputCard(userId, memberName, date, dateFormatted)),
      },
      token
    );

  } else if (actionType === 'clarify_submit') {
    // PM đã gõ note và bấm submit
    const note = actionValue.note || '';

    // Update file GitHub
    await updateApprovalStatus(env.GITHUB_PAT, userId, date, { status: 'needs_clarify', note, pmId: pmOpenId });

    // Gửi notification cho junior kèm note
    await larkPost(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
      {
        receive_id: userId,
        msg_type:   'interactive',
        content:    JSON.stringify(buildClarifyCard(memberName, dateFormatted, note)),
      },
      token
    );

    // Update card clarify input (đóng lại)
    if (messageId) {
      await updateLarkCard(token, messageId, buildCardClarifySentState(memberName, dateFormatted, note));
    }
  }

  return new Response('OK');
}

// ─── Lark Cards ──────────────────────────────────────────────────────────────
function buildApprovedCard(name, dateStr) {
  return {
    header: {
      title: { tag: 'plain_text', content: '✅ Plan của bạn đã được duyệt!' },
      template: 'green',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${name}** ơi, plan ngày **${dateStr}** của bạn đã được PM approve rồi nhé!\n\nHãy thực hiện đúng theo plan và nhớ update chiều nha 🚀`,
        },
      },
    ],
  };
}

function buildClarifyCard(name, dateStr, note) {
  return {
    header: {
      title: { tag: 'plain_text', content: '💬 PM cần clarify thêm về plan của bạn' },
      template: 'orange',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${name}** ơi, PM có note về plan ngày **${dateStr}**:`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: { tag: 'lark_md', content: `📝 ${note}` },
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: 'Hãy điều chỉnh và báo lại PM nhé!' }],
      },
    ],
  };
}

function buildClarifyInputCard(userId, name, date, dateStr) {
  return {
    header: {
      title: { tag: 'plain_text', content: `💬 Gửi clarify cho ${name}` },
      template: 'orange',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `Nhập note clarify cho **${name}** — plan ngày **${dateStr}**:`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'input',
        placeholder: { tag: 'plain_text', content: 'Nhập note clarify ở đây...' },
        name: 'note',
      },
      {
        tag: 'action',
        actions: [
          {
            tag:  'button',
            text: { tag: 'plain_text', content: '📨 Gửi clarify' },
            type: 'primary',
            value: JSON.stringify({ type: 'clarify_submit', userId, date }),
          },
        ],
      },
    ],
  };
}

function buildCardApprovedState(name, dateStr) {
  return {
    header: {
      title: { tag: 'plain_text', content: '☀️ Kế hoạch sáng — đã duyệt' },
      template: 'green',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `✅ **Đã approve** plan của **${name}** — ${dateStr}`,
        },
      },
    ],
  };
}

function buildCardClarifySentState(name, dateStr, note) {
  return {
    header: {
      title: { tag: 'plain_text', content: '💬 Đã gửi clarify' },
      template: 'orange',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `Đã gửi clarify cho **${name}** — ${dateStr}\n📝 ${note}`,
        },
      },
    ],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function getLarkToken(appId, appSecret) {
  try {
    const res = await larkPost(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      { app_id: appId, app_secret: appSecret }
    );
    return res.tenant_access_token || null;
  } catch { return null; }
}

async function larkPost(url, payload, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, {
    method:  'POST',
    headers,
    body:    JSON.stringify(payload),
  });
  return res.json();
}

async function updateLarkCard(token, messageId, card) {
  return fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
    method:  'PATCH',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      msg_type: 'interactive',
      content:  JSON.stringify(card),
    }),
  });
}

async function updateApprovalStatus(pat, userId, date, data) {
  const filePath = `reports/${date}/morning/${userId}.approval.json`;
  const content  = JSON.stringify({ userId, date, ...data, updatedAt: new Date().toISOString() }, null, 2);
  try {
    await writeToGitHub(pat, filePath, content, date, 'approval', userId);
  } catch (e) {
    console.error('updateApprovalStatus error:', e);
  }
}

// ─── Write file to GitHub ────────────────────────────────────────────────────
async function writeToGitHub(pat, filePath, content, date, type, userId) {
  const url = `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const encodedContent = btoa(unescape(encodeURIComponent(content)));

  let sha;
  const getRes = await fetch(url, {
    headers: {
      Authorization:  `token ${pat}`,
      Accept:         'application/vnd.github.v3+json',
      'User-Agent':   'daily-report-worker',
    },
  });
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
  }

  const putRes = await fetch(url, {
    method:  'PUT',
    headers: {
      Authorization:  `token ${pat}`,
      Accept:         'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent':   'daily-report-worker',
    },
    body: JSON.stringify({
      message: `report: ${type} ${userId} ${date}`,
      content: encodedContent,
      ...(sha ? { sha } : {}),
    }),
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
      method:  'POST',
      headers: {
        Authorization:  `token ${pat}`,
        Accept:         'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent':   'daily-report-worker',
      },
      body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
    }
  );
  if (!res.ok && res.status !== 204) {
    const errBody = await res.text();
    throw new Error(`Dispatch failed ${res.status}: ${errBody}`);
  }
}

// ─── JSON response helper ────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
