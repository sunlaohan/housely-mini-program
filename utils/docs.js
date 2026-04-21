function docsCollection() {
  return wx.cloud.database().collection('documents');
}

function isMissingCollectionError(error) {
  const text = `${(error && error.errMsg) || ''}${(error && error.message) || ''}`;
  return text.includes('collection') && (text.includes('does not exist') || text.includes('不存在'));
}

function getOwnerInfo(user) {
  return {
    ownerKey: String((user && user.username) || '').trim(),
    legacyUserId: String((user && user.id) || '').trim()
  };
}

function normalizeSourceFile(source) {
  return {
    fileName: String(source && (source.fileName || source.sourceName || source.name) || '').trim(),
    type: String(source && (source.type || source.sourceType) || 'image').trim() || 'image',
    fileId: String(source && (source.fileId || source.sourceFileId) || '').trim(),
    cloudPath: String(source && (source.cloudPath || source.sourceCloudPath) || '').trim(),
    fileSize: Number(source && (source.fileSize || source.size) || 0) || 0
  };
}

function getSourceFiles(record) {
  const sourceFiles = Array.isArray(record && record.sourceFiles)
    ? record.sourceFiles.map(normalizeSourceFile).filter((source) => source.fileId)
    : [];

  if (sourceFiles.length) {
    return sourceFiles;
  }

  const legacySource = normalizeSourceFile({
    fileName: record && record.sourceName,
    type: record && record.sourceType,
    fileId: record && record.sourceFileId,
    cloudPath: record && record.sourceCloudPath
  });

  return legacySource.fileId ? [legacySource] : [];
}

function buildSourceName(sourceFiles, fallbackName = '') {
  if (fallbackName) {
    return fallbackName;
  }

  if (!sourceFiles.length) {
    return '';
  }

  const firstName = sourceFiles[0].fileName || '未命名扫描件';
  if (sourceFiles.length === 1) {
    return firstName;
  }

  return `${firstName.replace(/\.[^.]+$/, '')} 等${sourceFiles.length}张图片`;
}

function buildSourcePayload(record) {
  const sourceFiles = getSourceFiles(record);
  const primarySource = sourceFiles[0] || null;

  return {
    sourceFiles,
    sourceName: buildSourceName(sourceFiles, record && record.sourceName),
    sourceType: String(record && record.sourceType || (primarySource && primarySource.type) || '').trim(),
    sourceFileId: String(record && record.sourceFileId || (primarySource && primarySource.fileId) || '').trim(),
    sourceCloudPath: String(record && record.sourceCloudPath || (primarySource && primarySource.cloudPath) || '').trim()
  };
}

function isOwnedByUser(doc, user) {
  const { ownerKey, legacyUserId } = getOwnerInfo(user);
  return Boolean(
    (ownerKey && (doc.ownerKey === ownerKey || doc.username === ownerKey)) ||
    (legacyUserId && doc.userId === legacyUserId)
  );
}

function mapDoc(doc) {
  const sourcePayload = buildSourcePayload(doc);

  return {
    id: doc._id || doc.id,
    ownerKey: doc.ownerKey || doc.username || doc.userId || '',
    userId: doc.userId || '',
    name: doc.name,
    description: doc.description || '',
    markdown: doc.markdown || '',
    sourceFiles: sourcePayload.sourceFiles,
    sourceName: sourcePayload.sourceName,
    sourceType: sourcePayload.sourceType,
    sourceFileId: sourcePayload.sourceFileId,
    sourceCloudPath: sourcePayload.sourceCloudPath,
    ocrTaskId: doc.ocrTaskId || '',
    ocrProvider: doc.ocrProvider || '',
    ocrStatus: doc.ocrStatus || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

async function runSafeQuery(query) {
  try {
    return await query.get();
  } catch (error) {
    if (isMissingCollectionError(error)) {
      return { data: [] };
    }
    throw error;
  }
}

async function getDocuments(user) {
  const { ownerKey, legacyUserId } = getOwnerInfo(user);
  const queries = [];

  if (ownerKey) {
    queries.push(runSafeQuery(docsCollection().where({ ownerKey })));
    queries.push(runSafeQuery(docsCollection().where({ username: ownerKey })));
  }

  if (legacyUserId) {
    queries.push(runSafeQuery(docsCollection().where({ userId: legacyUserId })));
  }

  const results = await Promise.all(queries);
  const docMap = new Map();

  results.forEach((result) => {
    (result.data || []).forEach((doc) => {
      if (doc && doc._id) {
        docMap.set(doc._id, mapDoc(doc));
      }
    });
  });

  return Array.from(docMap.values()).sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
    return rightTime - leftTime;
  });
}

async function addDocument(user, doc) {
  const now = new Date();
  const { ownerKey, legacyUserId } = getOwnerInfo(user);
  const sourcePayload = buildSourcePayload(doc);
  const payload = {
    ownerKey,
    username: ownerKey,
    userId: legacyUserId,
    name: doc.name,
    description: doc.description,
    markdown: doc.markdown,
    sourceFiles: sourcePayload.sourceFiles,
    sourceName: sourcePayload.sourceName,
    sourceType: sourcePayload.sourceType,
    sourceFileId: sourcePayload.sourceFileId,
    sourceCloudPath: sourcePayload.sourceCloudPath,
    ocrTaskId: doc.ocrTaskId || '',
    ocrProvider: doc.ocrProvider || '',
    ocrStatus: doc.ocrStatus || '',
    createdAt: now,
    updatedAt: now
  };
  const result = await docsCollection().add({
    data: payload
  });
  return mapDoc({
    _id: result._id,
    ...payload
  });
}

async function getDocumentById(user, docId) {
  const result = await runSafeQuery(docsCollection().where({
    _id: docId
  }).limit(1));

  const doc = result.data && result.data[0] ? mapDoc(result.data[0]) : null;
  return doc && isOwnedByUser(doc, user) ? doc : null;
}

async function updateDocument(user, docId, patch) {
  const doc = await getDocumentById(user, docId);
  if (!doc) {
    return null;
  }

  const sourcePayload = buildSourcePayload(patch);
  const payload = {
    name: patch.name,
    description: patch.description,
    markdown: patch.markdown,
    sourceFiles: sourcePayload.sourceFiles,
    sourceName: sourcePayload.sourceName,
    sourceType: sourcePayload.sourceType,
    sourceFileId: sourcePayload.sourceFileId,
    sourceCloudPath: sourcePayload.sourceCloudPath,
    ocrTaskId: patch.ocrTaskId || '',
    ocrProvider: patch.ocrProvider || '',
    ocrStatus: patch.ocrStatus || '',
    updatedAt: new Date()
  };

  await docsCollection().doc(docId).update({
    data: payload
  });

  return {
    ...doc,
    ...payload
  };
}

async function deleteDocument(user, docId) {
  const doc = await getDocumentById(user, docId);
  if (!doc) {
    return;
  }

  await docsCollection().doc(docId).remove();
}

async function deleteDocuments(user, docIds) {
  if (!docIds.length) {
    return;
  }

  const tasks = docIds.map((docId) => deleteDocument(user, docId));
  await Promise.all(tasks);
}

module.exports = {
  addDocument,
  deleteDocument,
  deleteDocuments,
  getDocumentById,
  getDocuments,
  updateDocument
};
