const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const users = db.collection('users');
const documents = db.collection('documents');
const ocrTasks = db.collection('ocr_tasks');
const feedbacks = db.collection('feedbacks');
const categories = db.collection('categories');
const DEFAULT_AVATAR = '/assets/auth/boy-1.png';
const DEFAULT_PREVIEW_FONT_SCALE = 1;
const MIN_PREVIEW_FONT_SCALE = 1;
const MAX_PREVIEW_FONT_SCALE = 2.4;
const DELETE_FILE_BATCH_SIZE = 50;

function isMissingCollectionError(error) {
  const text = `${(error && error.errMsg) || ''}${(error && error.message) || ''}`;
  return text.includes('collection') && (text.includes('does not exist') || text.includes('不存在'))
    || text.includes('Db or Table not exist');
}

function normalizePreviewFontScale(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_PREVIEW_FONT_SCALE;
  }

  return Math.min(Math.max(numericValue, MIN_PREVIEW_FONT_SCALE), MAX_PREVIEW_FONT_SCALE);
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id || user.id || '',
    username: user.username || '',
    avatar: user.avatar || DEFAULT_AVATAR,
    createdAt: user.createdAt || '',
    previewFontScale: normalizePreviewFontScale(user.previewFontScale)
  };
}

function normalizeUsername(username) {
  return String(username || '').trim();
}

async function findUserByUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return null;
  }

  const { data } = await users.where({
    username: normalizedUsername
  }).limit(1).get();

  return data[0] || null;
}

async function queryOwnedRecords(collection, ownerKey, legacyUserId) {
  const tasks = [];

  if (ownerKey) {
    tasks.push(collection.where({ ownerKey }).get().catch(() => ({ data: [] })));
    tasks.push(collection.where({ username: ownerKey }).get().catch(() => ({ data: [] })));
  }

  if (legacyUserId) {
    tasks.push(collection.where({ userId: legacyUserId }).get().catch(() => ({ data: [] })));
  }

  const results = await Promise.all(tasks);
  const recordMap = new Map();

  results.forEach((result) => {
    (result.data || []).forEach((item) => {
      if (item && item._id) {
        recordMap.set(item._id, item);
      }
    });
  });

  return Array.from(recordMap.values());
}

async function queryOwnedRecordsSafe(collection, ownerKey, legacyUserId) {
  try {
    return await queryOwnedRecords(collection, ownerKey, legacyUserId);
  } catch (error) {
    if (isMissingCollectionError(error)) {
      return [];
    }
    throw error;
  }
}

async function removeRecordsSafe(collection, records) {
  try {
    await Promise.all(records.map((record) => collection.doc(record._id).remove()));
  } catch (error) {
    if (isMissingCollectionError(error)) {
      return;
    }
    throw error;
  }
}

function addFileId(target, value) {
  const fileId = String(value || '').trim();
  if (fileId && fileId.startsWith('cloud://')) {
    target.add(fileId);
  }
}

function collectSourceFileIds(target, record) {
  addFileId(target, record && record.sourceFileId);

  const sourceFiles = Array.isArray(record && record.sourceFiles) ? record.sourceFiles : [];
  sourceFiles.forEach((source) => {
    addFileId(target, source && (source.fileId || source.fileID || source.sourceFileId));
  });
}

function collectFeedbackAttachmentFileIds(target, record) {
  const attachments = Array.isArray(record && record.attachments) ? record.attachments : [];
  attachments.forEach((attachment) => {
    addFileId(target, attachment && (attachment.fileId || attachment.fileID));
  });
}

function collectUserFileIds(target, user) {
  addFileId(target, user && user.avatar);
}

async function deleteCloudFiles(fileIds) {
  const uniqueFileIds = Array.from(new Set(fileIds)).filter(Boolean);
  let deletedCount = 0;
  const failed = [];

  for (let index = 0; index < uniqueFileIds.length; index += DELETE_FILE_BATCH_SIZE) {
    const fileList = uniqueFileIds.slice(index, index + DELETE_FILE_BATCH_SIZE);

    try {
      const result = await cloud.deleteFile({ fileList });
      const results = Array.isArray(result && result.fileList) ? result.fileList : [];
      deletedCount += results.filter((item) => !item.status && !item.errMsg).length;
      results.forEach((item) => {
        if (item && (item.status || item.errMsg)) {
          failed.push({
            fileID: item.fileID || item.fileId || '',
            status: item.status || 0,
            errMsg: item.errMsg || ''
          });
        }
      });
    } catch (error) {
      console.error('deleteCloudFiles failed', {
        count: fileList.length,
        errMsg: error && (error.errMsg || error.message)
      });
      fileList.forEach((fileID) => {
        failed.push({
          fileID,
          status: -1,
          errMsg: error && (error.errMsg || error.message) || 'deleteFile failed'
        });
      });
    }
  }

  return {
    total: uniqueFileIds.length,
    deletedCount,
    failed
  };
}

async function handleLoginOrCreate(event) {
  const username = normalizeUsername(event.username);

  if (!username) {
    return { ok: false, message: '请输入用户名' };
  }

  let user = await findUserByUsername(username);

  if (!user) {
    const createdAt = new Date();
    const result = await users.add({
      data: {
        username,
        avatar: DEFAULT_AVATAR,
        createdAt,
        previewFontScale: DEFAULT_PREVIEW_FONT_SCALE
      }
    });

    user = {
      _id: result._id,
      username,
      avatar: DEFAULT_AVATAR,
      createdAt,
      previewFontScale: DEFAULT_PREVIEW_FONT_SCALE
    };
  }

  return {
    ok: true,
    user: sanitizeUser(user)
  };
}

async function handleUpdateAvatar(event) {
  const username = normalizeUsername(event.username);
  const { avatar } = event;
  const user = await findUserByUsername(username);

  if (!user) {
    return { ok: false, message: '账号不存在' };
  }

  const oldAvatarFileIds = new Set();
  addFileId(oldAvatarFileIds, user.avatar);

  await users.doc(user._id).update({
    data: {
      avatar
    }
  });

  if (String(user.avatar || '').trim() !== String(avatar || '').trim()) {
    await deleteCloudFiles(Array.from(oldAvatarFileIds));
  }

  return {
    ok: true,
    user: sanitizeUser({
      ...user,
      avatar
    })
  };
}

async function handleUpdatePreviewFontScale(event) {
  const username = normalizeUsername(event.username);
  const previewFontScale = normalizePreviewFontScale(event.previewFontScale);
  const user = await findUserByUsername(username);

  if (!user) {
    return { ok: false, message: '账号不存在' };
  }

  await users.doc(user._id).update({
    data: {
      previewFontScale
    }
  });

  return {
    ok: true,
    user: sanitizeUser({
      ...user,
      previewFontScale
    })
  };
}

async function handleDeleteAccount(event) {
  const username = normalizeUsername(event.username);
  const legacyUserId = String(event.userId || '').trim();
  const user = username
    ? await findUserByUsername(username)
    : await users.doc(legacyUserId).get().then((res) => res.data).catch(() => null);

  if (!user) {
    return { ok: false, message: '账号不存在' };
  }

  const ownerKey = user.username || username;
  const [ownedDocuments, ownedTasks, ownedFeedbacks, ownedCategories] = await Promise.all([
    queryOwnedRecords(documents, ownerKey, user._id),
    queryOwnedRecords(ocrTasks, ownerKey, user._id),
    queryOwnedRecords(feedbacks, ownerKey, user._id),
    queryOwnedRecordsSafe(categories, ownerKey, user._id)
  ]);
  const fileIds = new Set();

  ownedDocuments.forEach((doc) => collectSourceFileIds(fileIds, doc));
  ownedTasks.forEach((task) => collectSourceFileIds(fileIds, task));
  ownedFeedbacks.forEach((item) => collectFeedbackAttachmentFileIds(fileIds, item));
  collectUserFileIds(fileIds, user);

  await Promise.all(ownedDocuments.map((doc) => documents.doc(doc._id).remove()));
  await Promise.all(ownedTasks.map((task) => ocrTasks.doc(task._id).remove()));
  await Promise.all(ownedFeedbacks.map((item) => feedbacks.doc(item._id).remove()));
  await removeRecordsSafe(categories, ownedCategories);
  await users.doc(user._id).remove();

  const fileDeleteResult = await deleteCloudFiles(Array.from(fileIds));

  return {
    ok: true,
    deleted: {
      documents: ownedDocuments.length,
      ocrTasks: ownedTasks.length,
      feedbacks: ownedFeedbacks.length,
      categories: ownedCategories.length,
      files: fileDeleteResult.deletedCount,
      fileFailures: fileDeleteResult.failed.length
    }
  };
}

function unsupportedAuthMode() {
  return {
    ok: false,
    message: '当前版本已改为纯用户名登录，请返回登录页重新进入'
  };
}

exports.main = async (event) => {
  try {
    switch (event.action) {
      case 'loginOrCreate':
      case 'login':
      case 'register':
        return handleLoginOrCreate(event);
      case 'updateAvatar':
        return handleUpdateAvatar(event);
      case 'updatePreviewFontScale':
        return handleUpdatePreviewFontScale(event);
      case 'deleteAccount':
        return handleDeleteAccount(event);
      case 'loginByPhoneCode':
      case 'getSecurityQuestion':
      case 'resetPassword':
      case 'updatePassword':
      case 'updateSecurity':
        return unsupportedAuthMode();
      default:
        return { ok: false, message: '不支持的操作' };
    }
  } catch (error) {
    console.error('auth main failed', event && event.action, error);
    return {
      ok: false,
      message: error && error.message ? error.message : 'auth 云函数执行失败',
      debug: {
        action: event && event.action,
        errorName: error && error.name ? error.name : '',
        errorMessage: error && error.message ? error.message : ''
      }
    };
  }
};
