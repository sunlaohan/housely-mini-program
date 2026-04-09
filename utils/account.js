const { KEYS, read, write, remove } = require('./storage');

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id || user._id || '',
    username: user.username || '',
    avatar: user.avatar || '',
    createdAt: user.createdAt || ''
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
    throw error;
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
  updateAvatar
};
