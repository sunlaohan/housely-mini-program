const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const documents = db.collection('documents');
const shares = db.collection('document_shares');
const SHARE_TTL_DAYS = 30;

function normalizeSourceFile(source) {
  return {
    fileName: String(source && (source.fileName || source.sourceName || source.name) || '').trim(),
    type: String(source && (source.type || source.sourceType) || 'image').trim() || 'image',
    fileId: String(source && (source.fileId || source.sourceFileId) || '').trim(),
    cloudPath: String(source && (source.cloudPath || source.sourceCloudPath) || '').trim()
  };
}

function getSourceFiles(doc) {
  const sourceFiles = Array.isArray(doc && doc.sourceFiles)
    ? doc.sourceFiles.map(normalizeSourceFile).filter((source) => source.fileId)
    : [];
  if (sourceFiles.length) {
    return sourceFiles;
  }

  const legacySource = normalizeSourceFile({
    fileName: doc && doc.sourceName,
    type: doc && doc.sourceType,
    fileId: doc && doc.sourceFileId,
    cloudPath: doc && doc.sourceCloudPath
  });
  return legacySource.fileId ? [legacySource] : [];
}

function sanitizeDocument(doc) {
  const sourceFiles = getSourceFiles(doc);
  return {
    id: doc._id,
    name: String(doc.name || '').trim() || '未命名文档',
    description: String(doc.description || '').trim(),
    markdown: String(doc.markdown || '').trim(),
    ocrTaskId: String(doc.ocrTaskId || '').trim(),
    sourceFiles
  };
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function getTempSourceFiles(sourceFiles) {
  const fileIds = sourceFiles.map((source) => source.fileId).filter(Boolean);
  if (!fileIds.length) {
    return sourceFiles;
  }

  const result = await cloud.getTempFileURL({ fileList: fileIds });
  const urlMap = {};
  (result.fileList || []).forEach((file) => {
    if (file && file.fileID && file.tempFileURL) {
      urlMap[file.fileID] = file.tempFileURL;
    }
  });

  return sourceFiles.map((source) => ({
    ...source,
    previewUrl: urlMap[source.fileId] || ''
  }));
}

async function handleCreateShare(event) {
  const docId = String(event.docId || '').trim();
  const ownerKey = String(event.ownerKey || '').trim();
  if (!docId || !ownerKey) {
    return { ok: false, message: '缺少文档信息' };
  }

  const result = await documents.doc(docId).get().catch(() => null);
  const doc = result && result.data;
  if (!doc || (doc.ownerKey !== ownerKey && doc.username !== ownerKey)) {
    return { ok: false, message: '文档不存在或无权分享' };
  }

  const now = new Date();
  const expireAt = new Date(now.getTime() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const token = createToken();
  await shares.add({
    data: {
      token,
      documentId: doc._id,
      ownerKey,
      createdAt: now,
      expireAt
    }
  });

  return { ok: true, token, expireAt };
}

async function handleGetShare(event) {
  const token = String(event.token || '').trim();
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return { ok: false, message: '分享链接无效' };
  }

  const shareResult = await shares.where({ token }).limit(1).get().catch(() => ({ data: [] }));
  const share = shareResult.data && shareResult.data[0];
  if (!share || new Date(share.expireAt).getTime() <= Date.now()) {
    return { ok: false, message: '分享链接已失效' };
  }

  const docResult = await documents.doc(share.documentId).get().catch(() => null);
  const doc = docResult && docResult.data;
  if (!doc) {
    return { ok: false, message: '原文档已删除' };
  }

  const document = sanitizeDocument(doc);
  document.sourceFiles = await getTempSourceFiles(document.sourceFiles);
  return { ok: true, document };
}

exports.main = async (event = {}) => {
  try {
    if (event.action === 'createShare') {
      return await handleCreateShare(event);
    }
    if (event.action === 'getShare') {
      return await handleGetShare(event);
    }
    return { ok: false, message: '不支持的操作' };
  } catch (error) {
    console.error('documentShare failed', event.action, error);
    return { ok: false, message: '分享服务暂不可用' };
  }
};
