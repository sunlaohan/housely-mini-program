const { KEYS, read, write, remove } = require('./storage');
const { clearLocalCategories } = require('./categories');
const DEFAULT_AVATAR = '/assets/auth/boy-1.png';
const DEFAULT_PREVIEW_FONT_SCALE = 1;
const MIN_PREVIEW_FONT_SCALE = 1;
const MAX_PREVIEW_FONT_SCALE = 2.4;

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
    id: user.id || user._id || '',
    username: user.username || '',
    avatar: user.avatar || DEFAULT_AVATAR,
    createdAt: user.createdAt || '',
    previewFontScale: normalizePreviewFontScale(user.previewFontScale),
    hasPassword: user.hasPassword === true,
    hasRecoveryCode: user.hasRecoveryCode === true,
    wechatBound: user.wechatBound === true
  };
}

function saveCurrentUser(user) {
  const sanitizedUser = sanitizeUser(user);
  if (!sanitizedUser) {
    remove(KEYS.SESSION);
    remove(KEYS.AUTH_TOKEN);
    return null;
  }

  write(KEYS.SESSION, sanitizedUser);
  return sanitizedUser;
}

function saveAuthResult(result) {
  if (result && result.sessionToken) {
    write(KEYS.AUTH_TOKEN, result.sessionToken);
  }
  if (result && result.ok && result.user) {
    saveCurrentUser(result.user);
  }
  return result;
}

async function callAuth(action, payload = {}) {
  try {
    const result = await wx.cloud.callFunction({
      name: 'auth',
      data: {
        action,
        sessionToken: read(KEYS.AUTH_TOKEN, ''),
        ...payload
      }
    });

    return result.result || {};
  } catch (error) {
    console.error('callAuth failed', action, payload, error);
    const errMsg = (error && (error.errMsg || error.message)) || '';
    const nextError = new Error(errMsg || '云端登录失败');
    nextError.code = 'AUTH_CLOUD_CALL_FAILED';
    nextError.errMsg = errMsg;
    throw nextError;
  }
}

async function loginWithPassword(username, password) {
  return saveAuthResult(await callAuth('login', { username, password }));
}

async function registerAccount(username, password) {
  return saveAuthResult(await callAuth('register', { username, password }));
}

async function upgradeLegacyAccount(username, password) {
  return saveAuthResult(await callAuth('upgradeLegacyAccount', { username, password }));
}

async function recoverAccount() {
  return callAuth('recoverAccount');
}

async function recoverAccountByRecoveryCode(recoveryCode) {
  return callAuth('recoverAccountByRecoveryCode', { recoveryCode });
}

async function resetPasswordByWechat(password) {
  return saveAuthResult(await callAuth('resetPasswordByWechat', { password }));
}

async function resetPasswordByRecoveryCode(recoveryCode, password) {
  return saveAuthResult(await callAuth('resetPasswordByRecoveryCode', {
    recoveryCode,
    password
  }));
}

async function changePassword(currentPassword, password) {
  return saveAuthResult(await callAuth('changePassword', {
    currentPassword,
    password
  }));
}

async function regenerateRecoveryCode(currentPassword) {
  const result = await callAuth('regenerateRecoveryCode', { currentPassword });
  if (result.ok && result.user) {
    saveCurrentUser(result.user);
  }
  return result;
}

async function validateSession() {
  const result = await callAuth('validateSession');
  if (result.ok && result.user) {
    saveCurrentUser(result.user);
  }
  return result;
}

async function updateAvatar(username, avatar) {
  const result = await callAuth('updateAvatar', {
    username,
    avatar
  });

  if (result.ok && result.user) {
    saveCurrentUser(result.user);
  }
  return result;
}

async function updatePreviewFontScale(username, previewFontScale) {
  const result = await callAuth('updatePreviewFontScale', {
    username,
    previewFontScale: normalizePreviewFontScale(previewFontScale)
  });

  if (result.ok && result.user) {
    saveCurrentUser(result.user);
  }

  return result;
}

function updateLocalPreviewFontScale(previewFontScale) {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    return null;
  }

  return saveCurrentUser({
    ...currentUser,
    previewFontScale: normalizePreviewFontScale(previewFontScale)
  });
}

function getCurrentUser() {
  return read(KEYS.SESSION, null);
}

function clearLocalAuth() {
  remove(KEYS.SESSION);
  remove(KEYS.AUTH_TOKEN);
}

function requireAuth() {
  const user = getCurrentUser();
  if (!user) {
    wx.reLaunch({
      url: '/pages/auth/login/index'
    });
    return null;
  }
  if (user.hasPassword !== true) {
    wx.reLaunch({
      url: '/pages/auth/login/index?mode=upgrade'
    });
    return null;
  }
  return user;
}

async function logout() {
  try {
    await callAuth('logout');
  } catch (error) {
    console.warn('remote logout failed', error);
  }
  clearLocalAuth();
}

async function deleteAccount(user) {
  const result = await callAuth('deleteAccount', {
    userId: user.id,
    username: user.username
  });

  if (result.ok) {
    clearLocalCategories(user);
    clearLocalAuth();
    return result;
  }

  const error = new Error(result.message || '注销失败');
  error.code = result.code || 'DELETE_ACCOUNT_FAILED';
  error.result = result;
  throw error;
}

module.exports = {
  changePassword,
  deleteAccount,
  getCurrentUser,
  loginWithPassword,
  logout,
  recoverAccount,
  recoverAccountByRecoveryCode,
  regenerateRecoveryCode,
  registerAccount,
  resetPasswordByRecoveryCode,
  resetPasswordByWechat,
  requireAuth,
  saveCurrentUser,
  upgradeLegacyAccount,
  updateAvatar,
  updateLocalPreviewFontScale,
  updatePreviewFontScale,
  validateSession
};
