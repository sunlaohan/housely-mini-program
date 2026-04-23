const cloud = require('wx-server-sdk');
const { FEEDBACK_RECEIVER_EMAIL, mailConfig } = require('./config');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const feedbacks = db.collection('feedbacks');

function isMissingCollectionError(error) {
  const text = `${error && error.message ? error.message : ''}${error && error.errMsg ? error.errMsg : ''}`;
  return text.includes('collection not exists') || text.includes('Db or Table not exist');
}

function sanitizeAttachment(item) {
  return {
    fileName: String(item && item.fileName || '').trim(),
    type: String(item && item.type || 'image').trim() || 'image',
    fileId: String(item && item.fileId || '').trim(),
    cloudPath: String(item && item.cloudPath || '').trim(),
    fileSize: Number(item && item.fileSize || 0) || 0
  };
}

function sanitizeAttachments(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(sanitizeAttachment)
    .filter((item) => item.fileId);
}

function normalizeMailConfig() {
  return {
    host: String(mailConfig && mailConfig.host || '').trim(),
    port: Number(mailConfig && mailConfig.port || 465) || 465,
    secure: mailConfig && typeof mailConfig.secure === 'boolean' ? mailConfig.secure : true,
    user: String(mailConfig && mailConfig.user || '').trim(),
    pass: String(mailConfig && mailConfig.pass || '').trim(),
    senderName: String(mailConfig && mailConfig.senderName || '家物小记意见反馈').trim() || '家物小记意见反馈'
  };
}

function isMailConfigReady(config) {
  return Boolean(
    config.host &&
    config.port &&
    config.user &&
    config.pass &&
    !config.pass.includes('replace-with-qq-smtp-auth-code')
  );
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(date) {
  const value = date instanceof Date ? date : new Date(date);
  const pad = (num) => `${num}`.padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

async function getAttachmentLinks(attachments) {
  const fileList = attachments
    .map((item) => item.fileId)
    .filter(Boolean);

  if (!fileList.length) {
    return {};
  }

  try {
    const result = await cloud.getTempFileURL({
      fileList
    });
    const urlMap = {};

    (result.fileList || []).forEach((item) => {
      if (item && item.fileID && item.tempFileURL) {
        urlMap[item.fileID] = item.tempFileURL;
      }
    });

    return urlMap;
  } catch (error) {
    console.error('getAttachmentLinks failed', error);
    return {};
  }
}

function buildAttachmentHtml(attachments, linkMap) {
  if (!attachments.length) {
    return '<p style="margin:0;color:#7b8591;">无附件</p>';
  }

  const items = attachments.map((item, index) => {
    const url = linkMap[item.fileId];
    const label = `${index + 1}. ${escapeHtml(item.fileName || `附件${index + 1}`)} (${escapeHtml(item.type)})`;

    if (!url) {
      return `<li style="margin:0 0 8px;">${label}</li>`;
    }

    return `<li style="margin:0 0 8px;"><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${label}</a></li>`;
  }).join('');

  return `<ul style="padding-left:20px;margin:0;">${items}</ul>`;
}

function buildMailHtml(record, linkMap) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1b2129;line-height:1.7;">
      <h2 style="margin:0 0 16px;font-size:20px;">家物小记收到一条新意见反馈</h2>
      <p style="margin:0 0 8px;"><strong>提交时间：</strong>${escapeHtml(formatDateTime(record.createdAt))}</p>
      <p style="margin:0 0 8px;"><strong>用户账号：</strong>${escapeHtml(record.username || '-')}</p>
      <p style="margin:0 0 8px;"><strong>联系方式：</strong>${escapeHtml(record.contact || '-')}</p>
      <div style="margin:16px 0;padding:16px;background:#f7f9fa;border-radius:12px;">
        <div style="margin:0 0 8px;font-weight:600;">问题描述</div>
        <div style="white-space:pre-wrap;">${escapeHtml(record.content || '')}</div>
      </div>
      <div style="margin:16px 0 8px;font-weight:600;">附件</div>
      ${buildAttachmentHtml(record.attachments || [], linkMap)}
    </div>
  `;
}

function buildMailText(record, linkMap) {
  const attachmentLines = (record.attachments || []).map((item, index) => {
    const url = linkMap[item.fileId];
    const parts = [`${index + 1}. ${item.fileName || `附件${index + 1}`}`, item.type || 'image'];
    if (url) {
      parts.push(url);
    }
    return parts.join(' | ');
  });

  return [
    '家物小记收到一条新意见反馈',
    `提交时间：${formatDateTime(record.createdAt)}`,
    `用户账号：${record.username || '-'}`,
    `联系方式：${record.contact || '-'}`,
    '',
    '问题描述：',
    record.content || '',
    '',
    '附件：',
    attachmentLines.length ? attachmentLines.join('\n') : '无附件'
  ].join('\n');
}

function createTransport(config) {
  const nodemailer = require('nodemailer');

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
}

async function sendFeedbackMail(record) {
  const config = normalizeMailConfig();
  if (!isMailConfigReady(config)) {
    return {
      delivered: false,
      reason: 'SMTP 未配置，请先填写 QQ 邮箱 SMTP 授权码'
    };
  }

  try {
    require.resolve('nodemailer');
  } catch (error) {
    return {
      delivered: false,
      reason: `云函数缺少 nodemailer 依赖：${error && error.message ? error.message : '请重新上传并部署：云端安装依赖'}`
    };
  }

  const attachmentLinks = await getAttachmentLinks(record.attachments || []);
  const transporter = createTransport(config);
  const result = await transporter.sendMail({
    from: `"${config.senderName}" <${config.user}>`,
    to: record.receiverEmail || FEEDBACK_RECEIVER_EMAIL,
    subject: `[家物小记] 新意见反馈 - ${record.username || record.contact || '匿名用户'}`,
    text: buildMailText(record, attachmentLinks),
    html: buildMailHtml(record, attachmentLinks)
  });

  return {
    delivered: true,
    messageId: result && result.messageId ? result.messageId : '',
    reason: ''
  };
}

async function submitFeedback(event) {
  const now = new Date();
  const record = {
    ownerKey: String(event.ownerKey || '').trim(),
    username: String(event.ownerKey || '').trim(),
    userId: String(event.userId || '').trim(),
    receiverEmail: FEEDBACK_RECEIVER_EMAIL,
    contact: String(event.contact || '').trim(),
    content: String(event.content || '').trim(),
    attachments: sanitizeAttachments(event.attachments || []),
    createdAt: now,
    updatedAt: now,
    mailStatus: 'pending',
    mailError: '',
    mailMessageId: ''
  };

  if (!record.contact) {
    return { ok: false, message: '请填写联系方式' };
  }

  if (!record.content) {
    return { ok: false, message: '请填写问题描述' };
  }

  const addResult = await feedbacks.add({
    data: record
  });

  let mailResult;
  try {
    mailResult = await sendFeedbackMail(record);
  } catch (error) {
    console.error('sendFeedbackMail failed', error);
    mailResult = {
      delivered: false,
      reason: error && error.message ? error.message : '邮件发送失败'
    };
  }

  await feedbacks.doc(addResult._id).update({
    data: {
      updatedAt: new Date(),
      mailStatus: mailResult.delivered ? 'sent' : 'failed',
      mailError: mailResult.reason || '',
      mailMessageId: mailResult.messageId || ''
    }
  });

  return {
    ok: true,
    id: addResult._id,
    mailDelivered: mailResult.delivered,
    message: mailResult.delivered ? '提交成功' : `反馈已保存，但${mailResult.reason || '邮件发送失败'}`
  };
}

exports.main = async (event) => {
  try {
    switch (event.action) {
      case 'submit':
        return submitFeedback(event);
      default:
        return { ok: false, message: '不支持的操作' };
    }
  } catch (error) {
    console.error('feedback main failed', error);

    if (isMissingCollectionError(error)) {
      return {
        ok: false,
        message: '当前云环境缺少 feedbacks 集合，请先在云开发数据库中创建 feedbacks 集合'
      };
    }

    return {
      ok: false,
      message: error && error.message ? error.message : '反馈云函数执行失败'
    };
  }
};
