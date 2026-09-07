'use strict';

const crypto = require('crypto');
const { google } = require('googleapis');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getHeader(headers, name) {
  return headers.find((header) => String(header.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBase64Url(input) {
  return Buffer.from(String(input || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function flattenParts(payload, target = []) {
  if (!payload) return target;
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) flattenParts(part, target);
  }
  target.push(payload);
  return target;
}

function sanitizeGmailSettings(settings = {}) {
  return {
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    refreshToken: settings.refreshToken,
    accessToken: settings.accessToken,
    expiryDate: settings.expiryDate,
    query: settings.query,
    historyId: settings.historyId,
    maxResults: settings.maxResults,
  };
}

async function syncGmail(account) {
  const settings = sanitizeGmailSettings(account.settings || {});
  if (!settings.clientId || !settings.clientSecret || !settings.refreshToken) {
    throw new Error('Gmail settings require clientId, clientSecret and refreshToken');
  }

  const oauth2 = new google.auth.OAuth2(
    settings.clientId,
    settings.clientSecret,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost'
  );

  oauth2.setCredentials({
    refresh_token: settings.refreshToken,
    access_token: settings.accessToken,
    expiry_date: settings.expiryDate ? Number(settings.expiryDate) : undefined,
  });

  const refreshed = {};
  oauth2.on('tokens', (tokens) => {
    if (tokens.access_token) refreshed.accessToken = tokens.access_token;
    if (tokens.expiry_date) refreshed.expiryDate = tokens.expiry_date;
    if (tokens.refresh_token) refreshed.refreshToken = tokens.refresh_token;
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const query = settings.query || 'has:attachment filename:pdf newer_than:30d';
  const maxResults = Math.min(Math.max(Number(settings.maxResults || 20), 1), 50);

  const listResp = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });

  const messages = listResp.data.messages || [];
  const records = [];

  for (const item of messages) {
    const detail = await gmail.users.messages.get({ userId: 'me', id: item.id, format: 'full' });
    const payload = detail.data.payload;
    const headers = payload?.headers || [];
    const fromEmail = getHeader(headers, 'From');
    const subject = getHeader(headers, 'Subject');
    const receivedAt = detail.data.internalDate ? new Date(Number(detail.data.internalDate)).toISOString() : new Date().toISOString();
    const parts = flattenParts(payload, []);
    const attachments = [];

    for (const part of parts) {
      const filename = part.filename || '';
      const mimeType = part.mimeType || '';
      const attachmentId = part.body?.attachmentId;
      if (!filename || !attachmentId) continue;
      if (!/\.pdf$/i.test(filename) && mimeType !== 'application/pdf') continue;

      const attachment = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: item.id,
        id: attachmentId,
      });
      const buffer = decodeBase64Url(attachment.data.data);
      attachments.push({
        filename,
        mimeType: mimeType || 'application/pdf',
        fileSize: buffer.length,
        checksum: sha256(buffer),
        buffer,
        metadata: {
          provider: 'gmail',
          partId: part.partId || null,
          threadId: detail.data.threadId || null,
        },
      });
    }

    if (attachments.length) {
      records.push({
        externalMessageId: item.id,
        fromEmail,
        subject,
        receivedAt,
        attachments,
      });
    }
  }

  const nextSettings = {
    ...account.settings,
    ...settings,
    ...refreshed,
    historyId: listResp.data.historyId || settings.historyId || null,
    lastQueryAt: new Date().toISOString(),
  };

  return { records, settings: nextSettings };
}

const SSRF_BLOCKED_RE = /^(?:localhost|127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|::1|fc00:|fd|0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0*1|::ffff:(?:127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.))/i;

const ALLOWED_IMAP_PORTS = new Set([143, 993]);

function validateImapHost(host, port) {
  const numPort = parseInt(port, 10);
  if (!ALLOWED_IMAP_PORTS.has(numPort)) {
    throw new Error(`Puerto IMAP no permitido: ${numPort}. Solo se permiten 143 y 993`);
  }
  if (!host || typeof host !== 'string') {
    throw new Error('IMAP host inválido');
  }
  const normalized = host.trim().toLowerCase();
  if (SSRF_BLOCKED_RE.test(normalized)) {
    throw new Error(`Host IMAP bloqueado por política SSRF: ${host}`);
  }
}

function buildImapClient(settings = {}, account) {
  if (!settings.host || !settings.username || !settings.password) {
    throw new Error('IMAP settings require host, username and password');
  }
  const port = Number(settings.port || 993);
  validateImapHost(settings.host, port);
  return new ImapFlow({
    host: settings.host,
    port,
    secure: settings.secure !== false,
    auth: {
      user: settings.username || account.email_address,
      pass: settings.password,
    },
    logger: false,
  });
}

async function syncImap(account) {
  const settings = account.settings || {};
  const client = buildImapClient(settings, account);
  const records = [];

  await client.connect();
  try {
    const mailbox = account.folder_name || settings.folderName || 'INBOX';
    const lock = await client.getMailboxLock(mailbox);
    try {
      const searchCriteria = ['ALL'];
      const lastSyncAt = settings.lastSyncAt ? new Date(settings.lastSyncAt) : null;
      if (lastSyncAt && !Number.isNaN(lastSyncAt.getTime())) {
        searchCriteria.push(['SINCE', lastSyncAt]);
      }

      const uids = await client.search(searchCriteria);
      const recentUids = uids.slice(-20).reverse();

      for await (const message of client.fetch(recentUids, { uid: true, envelope: true, source: true })) {
        const parsed = await simpleParser(message.source);
        const pdfs = (parsed.attachments || []).filter((attachment) =>
          attachment.contentType === 'application/pdf' || /\.pdf$/i.test(attachment.filename || '')
        );
        if (!pdfs.length) continue;

        records.push({
          externalMessageId: String(message.uid),
          fromEmail: parsed.from?.text || parsed.from?.value?.[0]?.address || account.email_address,
          subject: parsed.subject || '',
          receivedAt: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
          attachments: pdfs.map((attachment) => ({
            filename: attachment.filename || `attachment-${message.uid}.pdf`,
            mimeType: attachment.contentType || 'application/pdf',
            fileSize: attachment.size || attachment.content?.length || 0,
            checksum: sha256(attachment.content),
            buffer: attachment.content,
            metadata: {
              provider: 'imap',
              contentDisposition: attachment.contentDisposition || null,
              messageUid: message.uid,
            },
          })),
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  const nextSettings = {
    ...settings,
    lastSyncAt: new Date().toISOString(),
  };

  return { records, settings: nextSettings };
}

async function syncAccountDocuments(account) {
  if (account.provider === 'gmail') return syncGmail(account);
  if (account.provider === 'imap') return syncImap(account);
  if (account.provider === 'manual') return { records: [], settings: account.settings || {} };
  throw new Error(`Provider '${account.provider}' is not implemented yet`);
}

module.exports = {
  sha256,
  syncAccountDocuments,
};
