function docsCollection() {
  return wx.cloud.database().collection('documents');
}

function isMissingCollectionError(error) {
  const text = `${(error && error.errMsg) || ''}${(error && error.message) || ''}`;
  return text.includes('collection') && (text.includes('does not exist') || text.includes('不存在'));
}

function mapDoc(doc) {
  return {
    id: doc._id || doc.id,
    userId: doc.userId,
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

async function getDocuments(userId) {
  try {
    const { data } = await docsCollection().where({
      userId
    }).orderBy('updatedAt', 'desc').get();
    return data.map(mapDoc);
  } catch (error) {
    if (isMissingCollectionError(error)) {
      return [];
    }
    throw error;
  }
}

async function addDocument(userId, doc) {
  const now = new Date();
  const payload = {
    userId,
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

async function getDocumentById(userId, docId) {
  const { data } = await docsCollection().where({
    _id: docId,
    userId
  }).limit(1).get();
  return data[0] ? mapDoc(data[0]) : null;
}

async function updateDocument(userId, docId, patch) {
  const doc = await getDocumentById(userId, docId);
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

async function deleteDocument(userId, docId) {
  const doc = await getDocumentById(userId, docId);
  if (!doc) {
    return;
  }

  await docsCollection().doc(docId).remove();
}

async function deleteDocuments(userId, docIds) {
  if (!docIds.length) {
    return;
  }

  const tasks = docIds.map((docId) => deleteDocument(userId, docId));
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
