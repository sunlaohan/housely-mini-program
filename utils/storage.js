const KEYS = {
  USERS: 'housely_users',
  SESSION: 'housely_session',
  GUEST_ID: 'housely_guest_id',
  COVER_URLS: 'housely_cover_urls',
  DOC_COVERS: 'housely_doc_covers',
  CATEGORIES_PREFIX: 'housely_categories_',
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
