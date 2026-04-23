const { KEYS, read, write, remove } = require('./storage');
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
    previewFontScale: normalizePreviewFontScale(user.previewFontScale)
  };
}

async function callAuth(action, payload = {}) {
  try {
    const result = await wx.cloud.callFunction({
      name: 'auth',
      data: {
        action,
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

async function loginWithUsername(username) {
  const result = await callAuth('loginOrCreate', { username });
  if (result.ok && result.user) {
    write(KEYS.SESSION, sanitizeUser(result.user));
  }
  return result;
}

async function updateAvatar(username, avatar) {
  const result = await callAuth('updateAvatar', {
    username,
    avatar
  });

  if (result.ok && result.user) {
    write(KEYS.SESSION, sanitizeUser(result.user));
  }
  return result;
}

async function updatePreviewFontScale(username, previewFontScale) {
  const result = await callAuth('updatePreviewFontScale', {
    username,
    previewFontScale: normalizePreviewFontScale(previewFontScale)
  });

  if (result.ok && result.user) {
    write(KEYS.SESSION, sanitizeUser(result.user));
  }

  return result;
}

function getCurrentUser() {
  return read(KEYS.SESSION, null);
}

function requireAuth() {
  const user = getCurrentUser();
  if (!user) {
    wx.reLaunch({
      url: '/pages/auth/login/index'
    });
    return null;
  }
  return user;
}

function logout() {
  remove(KEYS.SESSION);
}

async function deleteAccount(user) {
  const result = await callAuth('deleteAccount', {
    userId: user.id,
    username: user.username
  });

  if (result.ok) {
    logout();
  }

  return result;
}

module.exports = {
  deleteAccount,
  getCurrentUser,
  loginWithUsername,
  logout,
  requireAuth,
  updateAvatar,
  updatePreviewFontScale
};
