const DEFAULT_SHARE_TITLE = '家物小记｜把家里的说明书、票据和户号都存起来';
const DEFAULT_SHARE_PATH = '/pages/launch/index';

function buildQueryString(query = {}) {
  return Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]))}`)
    .join('&');
}

function buildSharePath(path = DEFAULT_SHARE_PATH, query = {}) {
  const normalizedPath = String(path || DEFAULT_SHARE_PATH).trim() || DEFAULT_SHARE_PATH;
  const queryString = buildQueryString(query);

  if (!queryString) {
    return normalizedPath;
  }

  return `${normalizedPath}${normalizedPath.includes('?') ? '&' : '?'}${queryString}`;
}

function getShareContent(options = {}) {
  return {
    title: String(options.title || DEFAULT_SHARE_TITLE).trim() || DEFAULT_SHARE_TITLE,
    path: buildSharePath(options.path || DEFAULT_SHARE_PATH, options.query || {})
  };
}

function showShareMenu() {
  if (typeof wx.showShareMenu !== 'function') {
    return;
  }

  try {
    wx.showShareMenu({
      menus: ['shareAppMessage']
    });
  } catch (error) {
    wx.showShareMenu();
  }
}

function withPageShare(pageConfig = {}, shareOptions = {}) {
  const originalOnLoad = pageConfig.onLoad;
  const originalOnShow = pageConfig.onShow;
  const originalOnShareAppMessage = pageConfig.onShareAppMessage;

  return {
    ...pageConfig,

    onLoad(...args) {
      showShareMenu();

      if (typeof originalOnLoad === 'function') {
        return originalOnLoad.apply(this, args);
      }

      return undefined;
    },

    onShow(...args) {
      showShareMenu();

      if (typeof originalOnShow === 'function') {
        return originalOnShow.apply(this, args);
      }

      return undefined;
    },

    onShareAppMessage(...args) {
      if (typeof originalOnShareAppMessage === 'function') {
        const result = originalOnShareAppMessage.apply(this, args);
        if (result) {
          return result;
        }
      }

      const options = typeof shareOptions === 'function'
        ? shareOptions.call(this, ...args)
        : shareOptions;

      return getShareContent(options);
    }
  };
}

module.exports = {
  withPageShare,
  showShareMenu,
  getShareContent,
  DEFAULT_SHARE_TITLE,
  DEFAULT_SHARE_PATH
};
