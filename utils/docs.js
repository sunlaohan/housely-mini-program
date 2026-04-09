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

function isOwnedByUser(doc, user) {
  const { ownerKey, legacyUserId } = getOwnerInfo(user);
  return Boolean(
    (ownerKey && (doc.ownerKey === ownerKey || doc.username === ownerKey)) ||
    (legacyUserId && doc.userId === legacyUserId)
  );
}

function mapDoc(doc) {
  return {
    id: doc._id || doc.id,
    ownerKey: doc.ownerKey || doc.username || doc.userId || '',
    userId: doc.userId || '',
    name: doc.name,
    description: doc.description || '',
    markdown: doc.markdown || '',
    sourceName: doc.sourceName || '',
    sourceType: doc.sourceType || '',
    sourceFileId: doc.sourceFileId || '',
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
  const payload = {
    ownerKey,
    username: ownerKey,
    userId: legacyUserId,
    name: doc.name,
    description: doc.description,
    markdown: doc.markdown,
    sourceName: doc.sourceName,
    sourceType: doc.sourceType,
    sourceFileId: doc.sourceFileId || '',
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

  const payload = {
    name: patch.name,
    description: patch.description,
    markdown: patch.markdown,
    sourceName: patch.sourceName,
    sourceType: patch.sourceType,
    sourceFileId: patch.sourceFileId || '',
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
