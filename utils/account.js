const { KEYS, read, write, remove } = require('./storage');

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id || user._id,
    username: user.username,
    avatar: user.avatar || '',
    securityQuestion: user.securityQuestion || '',
    createdAt: user.createdAt || ''
  };
}

async function callAuth(action, payload = {}) {
  const result = await wx.cloud.callFunction({
    name: 'auth',
    data: {
      action,
      ...payload
    }
  });

  return result.result || {};
}

async function findUser(username) {
  const result = await callAuth('getSecurityQuestion', { username });
  if (!result.ok) {
    return null;
  }

  return {
    username,
    securityQuestion: result.securityQuestion || ''
  };
}

async function registerAccount(payload) {
  const result = await callAuth('register', payload);
  if (result.ok && result.user) {
    write(KEYS.SESSION, sanitizeUser(result.user));
  }
  return result;
}

async function loginAccount(username, password) {
  const result = await callAuth('login', { username, password });
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

async function resetPassword(username, answer, nextPassword) {
  return callAuth('resetPassword', {
    username,
    securityAnswer: answer,
    nextPassword
  });
}

async function updatePassword(username, oldPassword, nextPassword) {
  return callAuth('updatePassword', {
    username,
    oldPassword,
    nextPassword
  });
}

async function updateSecurity(username, password, securityQuestion, securityAnswer) {
  const result = await callAuth('updateSecurity', {
    username,
    password,
    securityQuestion,
    securityAnswer
  });

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
  findUser,
  getCurrentUser,
  loginAccount,
  logout,
  registerAccount,
  requireAuth,
  resetPassword,
  updateAvatar,
  updatePassword,
  updateSecurity
};
