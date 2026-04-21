const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const users = db.collection('users');
const documents = db.collection('documents');
const ocrTasks = db.collection('ocr_tasks');
const feedbacks = db.collection('feedbacks');
const DEFAULT_AVATAR = '/assets/auth/boy-1.png';

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id || user.id || '',
    username: user.username || '',
    avatar: user.avatar || DEFAULT_AVATAR,
    createdAt: user.createdAt || ''
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
        createdAt
      }
    });

    user = {
      _id: result._id,
      username,
      avatar: DEFAULT_AVATAR,
      createdAt
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

  await users.doc(user._id).update({
    data: {
      avatar
    }
  });

  return {
    ok: true,
    user: sanitizeUser({
      ...user,
      avatar
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
  const [ownedDocuments, ownedTasks, ownedFeedbacks] = await Promise.all([
    queryOwnedRecords(documents, ownerKey, user._id),
    queryOwnedRecords(ocrTasks, ownerKey, user._id),
    queryOwnedRecords(feedbacks, ownerKey, user._id)
  ]);

  await Promise.all(ownedDocuments.map((doc) => documents.doc(doc._id).remove()));
  await Promise.all(ownedTasks.map((task) => ocrTasks.doc(task._id).remove()));
  await Promise.all(ownedFeedbacks.map((item) => feedbacks.doc(item._id).remove()));
  await users.doc(user._id).remove();

  return { ok: true };
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
