const { requireAuth, getCurrentUser } = require('./account');

function ensureAuth(pageInstance, callback) {
  const user = requireAuth();
  if (!user) {
    return false;
  }

  if (pageInstance && typeof pageInstance.setData === 'function') {
    pageInstance.setData({
      currentUser: getCurrentUser()
    });
  }

  if (typeof callback === 'function') {
    callback(user);
  }

  return true;
}

function formatDate(isoString) {
  if (!isoString) {
    return '';
  }
  const date = new Date(isoString);
  const pad = (num) => `${num}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

module.exports = {
  ensureAuth,
  formatDate
};
