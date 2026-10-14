const cloud = require('wx-server-sdk');
const crypto = require('crypto');

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
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 64;
const PASSWORD_ITERATIONS = 600000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
    previewFontScale: normalizePreviewFontScale(user.previewFontScale),
    hasPassword: Boolean(user.passwordHash),
    hasRecoveryCode: Boolean(user.recoveryCodeHash),
    wechatBound: Boolean(user.wechatOpenIdHash)
  };
}

function normalizeUsername(username) {
  return String(username || '').trim();
}

function normalizePassword(password) {
  return String(password || '');
}

function validatePassword(password) {
  const normalizedPassword = normalizePassword(password);
  if (normalizedPassword.length < PASSWORD_MIN_LENGTH) {
    return `密码至少需要${PASSWORD_MIN_LENGTH}位`;
  }
  if (normalizedPassword.length > PASSWORD_MAX_LENGTH) {
    return `密码不能超过${PASSWORD_MAX_LENGTH}位`;
  }
  return '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function hashOpenId(openId) {
  return openId ? sha256(openId) : '';
}

function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashRecoveryCode(code) {
  const normalizedCode = normalizeRecoveryCode(code);
  return normalizedCode ? sha256(normalizedCode) : '';
}

function generateRecoveryCode() {
  const raw = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `HML-${raw.match(/.{1,4}/g).join('-')}`;
}

function hashPassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      normalizePassword(password),
      salt,
      iterations,
      PASSWORD_KEY_LENGTH,
      PASSWORD_DIGEST,
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey.toString('base64'));
      }
    );
  });
}

async function createPasswordFields(password) {
  const salt = crypto.randomBytes(16).toString('base64');
  return {
    passwordHash: await hashPassword(password, salt),
    passwordSalt: salt,
    passwordIterations: PASSWORD_ITERATIONS,
    passwordDigest: PASSWORD_DIGEST,
    passwordUpdatedAt: new Date()
  };
}

async function verifyPassword(user, password) {
  if (!user || !user.passwordHash || !user.passwordSalt) {
    return false;
  }

  const candidateHash = await hashPassword(
    password,
    user.passwordSalt,
    Number(user.passwordIterations || PASSWORD_ITERATIONS)
  );
  const actual = Buffer.from(String(user.passwordHash || ''), 'base64');
  const candidate = Buffer.from(candidateHash, 'base64');
  return actual.length === candidate.length && crypto.timingSafeEqual(actual, candidate);
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

async function findUserByWechatOpenId(openId) {
  const wechatOpenIdHash = hashOpenId(openId);
  if (!wechatOpenIdHash) {
    return null;
  }

  const { data } = await users.where({ wechatOpenIdHash }).limit(1).get();
  return data[0] || null;
}

async function findUserByRecoveryCode(recoveryCode) {
  const recoveryCodeHash = hashRecoveryCode(recoveryCode);
  if (!recoveryCodeHash) {
    return null;
  }

  const { data } = await users.where({ recoveryCodeHash }).limit(1).get();
  return data[0] || null;
}

async function findUserBySessionToken(sessionToken) {
  const authSessionHash = sha256(sessionToken);
  if (!sessionToken || !authSessionHash) {
    return null;
  }

  const { data } = await users.where({ authSessionHash }).limit(1).get();
  const user = data[0] || null;
  if (!user) {
    return null;
  }

  const expiresAt = new Date(user.authSessionExpiresAt || 0).getTime();
  return expiresAt > Date.now() ? user : null;
}

async function requireSession(event) {
  const user = await findUserBySessionToken(String(event && event.sessionToken || '').trim());
  if (!user) {
    const error = new Error('登录状态已失效，请重新登录');
    error.code = 'AUTH_SESSION_EXPIRED';
    throw error;
  }
  return user;
}

async function createSession(user, openId, options = {}) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const authSessionHash = sha256(sessionToken);
  const now = new Date();
  const patch = {
    authSessionHash,
    authSessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    lastLoginAt: now,
    loginFailedCount: 0,
    lockedUntil: null
  };
  const wechatOpenIdHash = hashOpenId(openId);
  if (wechatOpenIdHash && (options.bindWechat || !user.wechatOpenIdHash)) {
    patch.wechatOpenIdHash = wechatOpenIdHash;
  }

  await users.doc(user._id).update({ data: patch });
  return {
    sessionToken,
    user: {
      ...user,
      ...patch
    }
  };
}

async function recordLoginFailure(user) {
  const failedCount = Number(user.loginFailedCount || 0) + 1;
  const patch = {
    loginFailedCount: failedCount
  };
  if (failedCount >= MAX_LOGIN_FAILURES) {
    patch.lockedUntil = new Date(Date.now() + LOGIN_LOCK_MS);
    patch.loginFailedCount = 0;
  }
  await users.doc(user._id).update({ data: patch });
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

async function handleRegister(event, openId) {
  const username = normalizeUsername(event.username);
  const password = normalizePassword(event.password);

  if (!openId) {
    return { ok: false, code: 'WECHAT_ID_UNAVAILABLE', message: '无法识别当前微信，请重新进入小程序' };
  }

  if (!username) {
    return { ok: false, message: '请输入用户名' };
  }
  if (username.length > 32) {
    return { ok: false, message: '账号不能超过32个字符' };
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return { ok: false, message: passwordError };
  }

  const existingUser = await findUserByUsername(username);
  if (existingUser) {
    return { ok: false, code: 'USERNAME_TAKEN', message: '该账号已存在，请直接登录' };
  }

  const boundUser = await findUserByWechatOpenId(openId);
  if (boundUser) {
    return { ok: false, code: 'WECHAT_ALREADY_BOUND', message: '当前微信已绑定账号，请直接登录或找回账号' };
  }

  const createdAt = new Date();
  const passwordFields = await createPasswordFields(password);
  const recoveryCode = generateRecoveryCode();
  const payload = {
    username,
    avatar: DEFAULT_AVATAR,
    createdAt,
    previewFontScale: DEFAULT_PREVIEW_FONT_SCALE,
    wechatOpenIdHash: hashOpenId(openId),
    recoveryCodeHash: hashRecoveryCode(recoveryCode),
    recoveryCodeUpdatedAt: createdAt,
    ...passwordFields
  };
  const result = await users.add({ data: payload });
  const user = {
    _id: result._id,
    ...payload
  };
  const session = await createSession(user, openId);

  return {
    ok: true,
    user: sanitizeUser(session.user),
    sessionToken: session.sessionToken,
    recoveryCode
  };
}

async function handleLegacyLoginOrCreate(event) {
  const username = normalizeUsername(event.username);
  const user = await findUserByUsername(username);

  if (!user) {
    return {
      ok: false,
      code: 'CLIENT_UPGRADE_REQUIRED',
      message: '请更新小程序后注册账号'
    };
  }

  if (user.passwordHash) {
    return {
      ok: false,
      code: 'CLIENT_UPGRADE_REQUIRED',
      message: '该账号已启用密码，请更新小程序后登录'
    };
  }

  return {
    ok: true,
    user: sanitizeUser(user),
    legacyClient: true
  };
}

async function handleLogin(event, openId) {
  const username = normalizeUsername(event.username);
  const password = normalizePassword(event.password);
  const user = await findUserByUsername(username);

  if (!user) {
    return { ok: false, code: 'INVALID_CREDENTIALS', message: '账号或密码错误' };
  }

  if (!user.passwordHash) {
    return {
      ok: false,
      code: 'PASSWORD_SETUP_REQUIRED',
      message: '该账号需要先设置登录密码',
      username: user.username
    };
  }

  const lockedUntil = new Date(user.lockedUntil || 0).getTime();
  if (lockedUntil > Date.now()) {
    return {
      ok: false,
      code: 'ACCOUNT_LOCKED',
      message: '密码错误次数过多，请15分钟后再试'
    };
  }

  if (!await verifyPassword(user, password)) {
    await recordLoginFailure(user);
    return { ok: false, code: 'INVALID_CREDENTIALS', message: '账号或密码错误' };
  }

  const session = await createSession(user, openId);
  return {
    ok: true,
    user: sanitizeUser(session.user),
    sessionToken: session.sessionToken
  };
}

async function handleUpgradeLegacyAccount(event, openId) {
  const username = normalizeUsername(event.username);
  const password = normalizePassword(event.password);
  const user = await findUserByUsername(username);

  if (!openId) {
    return { ok: false, code: 'WECHAT_ID_UNAVAILABLE', message: '无法识别当前微信，请重新进入小程序' };
  }

  if (!user) {
    return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: '账号不存在' };
  }
  if (user.passwordHash) {
    return { ok: false, code: 'PASSWORD_ALREADY_SET', message: '该账号已设置密码，请直接登录' };
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return { ok: false, message: passwordError };
  }

  const boundUser = await findUserByWechatOpenId(openId);
  if (boundUser && boundUser._id !== user._id) {
    return {
      ok: false,
      code: 'WECHAT_ALREADY_BOUND',
      message: '当前微信已绑定其他账号，无法用于升级此账号'
    };
  }

  const passwordFields = await createPasswordFields(password);
  const recoveryCode = generateRecoveryCode();
  const patch = {
    ...passwordFields,
    wechatOpenIdHash: hashOpenId(openId),
    recoveryCodeHash: hashRecoveryCode(recoveryCode),
    recoveryCodeUpdatedAt: new Date()
  };
  await users.doc(user._id).update({ data: patch });
  const session = await createSession({ ...user, ...patch }, openId, { bindWechat: true });

  return {
    ok: true,
    user: sanitizeUser(session.user),
    sessionToken: session.sessionToken,
    recoveryCode
  };
}

async function handleRecoverAccount(openId) {
  if (!openId) {
    return { ok: false, code: 'WECHAT_ID_UNAVAILABLE', message: '无法识别当前微信，请重新进入小程序' };
  }
  const user = await findUserByWechatOpenId(openId);
  if (!user) {
    return {
      ok: false,
      code: 'WECHAT_NOT_BOUND',
      message: '当前微信尚未绑定账号，请使用恢复码或联系管理员'
    };
  }

  return {
    ok: true,
    username: user.username
  };
}

async function handleRecoverAccountByRecoveryCode(event) {
  const user = await findUserByRecoveryCode(event.recoveryCode);
  if (!user) {
    return { ok: false, code: 'INVALID_RECOVERY_CODE', message: '恢复码无效，请核对后重试' };
  }

  return {
    ok: true,
    username: user.username
  };
}

async function resetUserPassword(user, password, openId, options = {}) {
  const passwordError = validatePassword(password);
  if (passwordError) {
    return { ok: false, message: passwordError };
  }

  const passwordFields = await createPasswordFields(password);
  const recoveryCode = generateRecoveryCode();
  const patch = {
    ...passwordFields,
    recoveryCodeHash: hashRecoveryCode(recoveryCode),
    recoveryCodeUpdatedAt: new Date(),
    loginFailedCount: 0,
    lockedUntil: null
  };

  if (options.bindWechat) {
    patch.wechatOpenIdHash = hashOpenId(openId);
  }

  await users.doc(user._id).update({ data: patch });
  const session = await createSession({ ...user, ...patch }, openId, {
    bindWechat: options.bindWechat
  });
  return {
    ok: true,
    user: sanitizeUser(session.user),
    username: user.username,
    sessionToken: session.sessionToken,
    recoveryCode
  };
}

async function handleResetPasswordByWechat(event, openId) {
  if (!openId) {
    return { ok: false, code: 'WECHAT_ID_UNAVAILABLE', message: '无法识别当前微信，请重新进入小程序' };
  }
  const user = await findUserByWechatOpenId(openId);
  if (!user) {
    return { ok: false, code: 'WECHAT_NOT_BOUND', message: '当前微信尚未绑定账号，请使用恢复码找回' };
  }
  return resetUserPassword(user, event.password, openId);
}

async function handleResetPasswordByRecoveryCode(event, openId) {
  const user = await findUserByRecoveryCode(event.recoveryCode);
  if (!user) {
    return { ok: false, code: 'INVALID_RECOVERY_CODE', message: '恢复码无效，请核对后重试' };
  }

  const boundUser = await findUserByWechatOpenId(openId);
  const canBindWechat = !boundUser || boundUser._id === user._id;
  const result = await resetUserPassword(user, event.password, openId, {
    bindWechat: canBindWechat
  });
  if (result.ok && !canBindWechat) {
    result.message = '密码已重置；当前微信已绑定其他账号，本次未更改微信绑定';
  }
  return result;
}

async function handleChangePassword(event, openId) {
  const user = await requireSession(event);
  if (!await verifyPassword(user, event.currentPassword)) {
    return { ok: false, code: 'INVALID_CURRENT_PASSWORD', message: '当前密码错误' };
  }
  const passwordError = validatePassword(event.password);
  if (passwordError) {
    return { ok: false, message: passwordError };
  }

  const passwordFields = await createPasswordFields(event.password);
  await users.doc(user._id).update({ data: passwordFields });
  const session = await createSession({ ...user, ...passwordFields }, openId);
  return {
    ok: true,
    user: sanitizeUser(session.user),
    sessionToken: session.sessionToken
  };
}

async function handleRegenerateRecoveryCode(event) {
  const user = await requireSession(event);
  if (!await verifyPassword(user, event.currentPassword)) {
    return { ok: false, code: 'INVALID_CURRENT_PASSWORD', message: '当前密码错误' };
  }

  const recoveryCode = generateRecoveryCode();
  const patch = {
    recoveryCodeHash: hashRecoveryCode(recoveryCode),
    recoveryCodeUpdatedAt: new Date()
  };
  await users.doc(user._id).update({ data: patch });
  return {
    ok: true,
    recoveryCode,
    user: sanitizeUser({ ...user, ...patch })
  };
}

async function handleLogout(event) {
  const user = await findUserBySessionToken(String(event.sessionToken || '').trim());
  if (user) {
    await users.doc(user._id).update({
      data: {
        authSessionHash: '',
        authSessionExpiresAt: new Date(0)
      }
    });
  }

  return { ok: true };
}

async function handleValidateSession(event) {
  const user = await requireSession(event);
  return {
    ok: true,
    user: sanitizeUser(user)
  };
}

async function handleUpdateAvatar(event) {
  const { avatar } = event;
  const user = await requireSession(event);

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
  const previewFontScale = normalizePreviewFontScale(event.previewFontScale);
  const user = await requireSession(event);

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
  const user = await requireSession(event);

  const ownerKey = user.username;
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

exports.main = async (event) => {
  try {
    const { OPENID = '' } = cloud.getWXContext();
    switch (event.action) {
      case 'loginOrCreate':
        return await handleLegacyLoginOrCreate(event);
      case 'login':
        return await handleLogin(event, OPENID);
      case 'register':
        return await handleRegister(event, OPENID);
      case 'upgradeLegacyAccount':
        return await handleUpgradeLegacyAccount(event, OPENID);
      case 'recoverAccount':
        return await handleRecoverAccount(OPENID);
      case 'recoverAccountByRecoveryCode':
        return await handleRecoverAccountByRecoveryCode(event);
      case 'resetPasswordByWechat':
        return await handleResetPasswordByWechat(event, OPENID);
      case 'resetPasswordByRecoveryCode':
      case 'resetPassword':
        return await handleResetPasswordByRecoveryCode(event, OPENID);
      case 'changePassword':
      case 'updatePassword':
        return await handleChangePassword(event, OPENID);
      case 'regenerateRecoveryCode':
        return await handleRegenerateRecoveryCode(event);
      case 'logout':
        return await handleLogout(event);
      case 'validateSession':
        return await handleValidateSession(event);
      case 'updateAvatar':
        return await handleUpdateAvatar(event);
      case 'updatePreviewFontScale':
        return await handleUpdatePreviewFontScale(event);
      case 'deleteAccount':
        return await handleDeleteAccount(event);
      case 'loginByPhoneCode':
      case 'getSecurityQuestion':
      case 'updateSecurity':
        return { ok: false, message: '当前版本不支持该认证方式' };
      default:
        return { ok: false, message: '不支持的操作' };
    }
  } catch (error) {
    console.error('auth main failed', event && event.action, error);
    return {
      ok: false,
      message: error && error.message ? error.message : 'auth 云函数执行失败',
      code: error && error.code ? error.code : 'AUTH_FUNCTION_FAILED'
    };
  }
};
