const KEYS = {
  USERS: 'housely_users',
  SESSION: 'housely_session',
  DOCS_PREFIX: 'housely_docs_'
};

function read(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === '' || typeof value === 'undefined' ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function write(key, value) {
  wx.setStorageSync(key, value);
}

function remove(key) {
  wx.removeStorageSync(key);
}

module.exports = {
  KEYS,
  read,
  write,
  remove
};
