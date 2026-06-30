const DEFAULT_SHARE_TITLE = '家物小记｜把家里的说明书、票据和户号都存起来';
const DEFAULT_SHARE_PATH = '/pages/launch/index';
const DEFAULT_TIMELINE_QUERY = {
  entry: 'timeline'
};
const TIMELINE_ENTRY = DEFAULT_TIMELINE_QUERY.entry;
const TIMELINE_LANDING_ROUTE = 'pages/home/index';

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
  const content = {
    title: String(options.title || DEFAULT_SHARE_TITLE).trim() || DEFAULT_SHARE_TITLE,
    path: buildSharePath(options.path || DEFAULT_SHARE_PATH, options.query || {})
  };

  const imageUrl = String(options.imageUrl || '').trim();
  if (imageUrl) {
    content.imageUrl = imageUrl;
  }

  return content;
}

function getTimelineShareContent(options = {}) {
  const timelineQuery = {
    ...DEFAULT_TIMELINE_QUERY,
    ...(options.query || {})
  };
  const content = {
    title: String(options.title || DEFAULT_SHARE_TITLE).trim() || DEFAULT_SHARE_TITLE,
    query: buildQueryString(timelineQuery)
  };

  const imageUrl = String(options.imageUrl || '').trim();
  if (imageUrl) {
    content.imageUrl = imageUrl;
  }

  return content;
}

function showShareMenu(options = {}) {
  if (typeof wx.showShareMenu !== 'function') {
    return;
  }

  const menus = ['shareAppMessage'];
  if (options.enableTimeline) {
    menus.push('shareTimeline');
  }

  try {
    wx.showShareMenu({
      menus
    });
  } catch (error) {
    wx.showShareMenu();
  }
}

function isTimelineEntry(options = {}) {
  return String(options && options.entry || '').trim() === TIMELINE_ENTRY;
}

function redirectTimelineEntryToLanding(pageInstance, options = {}) {
  if (!isTimelineEntry(options)) {
    return false;
  }

  if (pageInstance && pageInstance.route === TIMELINE_LANDING_ROUTE) {
    return false;
  }

  wx.reLaunch({
    url: `/${TIMELINE_LANDING_ROUTE}?${buildQueryString(DEFAULT_TIMELINE_QUERY)}`
  });

  return true;
}

function normalizeShareOptions(shareOptions = {}) {
  if (!shareOptions || typeof shareOptions !== 'object' || Array.isArray(shareOptions)) {
    return {
      appMessage: shareOptions
    };
  }

  const hasAdvancedOptions = ['appMessage', 'timeline', 'enableTimeline'].some((key) =>
    Object.prototype.hasOwnProperty.call(shareOptions, key)
  );

  if (!hasAdvancedOptions) {
    return {
      appMessage: shareOptions
    };
  }

  return shareOptions;
}

function resolveShareOptions(shareConfig = {}, shareType, pageInstance, args = []) {
  const source = shareType === 'timeline'
    ? shareConfig.timeline
    : shareConfig.appMessage;

  if (typeof source === 'function') {
    return source.apply(pageInstance, args);
  }

  if (source && typeof source === 'object') {
    return source;
  }

  return {};
}

function withPageShare(pageConfig = {}, shareOptions = {}) {
  const normalizedShareOptions = normalizeShareOptions(shareOptions);
  const shareMenuOptions = {
    enableTimeline: normalizedShareOptions.enableTimeline !== false
  };
  const originalOnLoad = pageConfig.onLoad;
  const originalOnShow = pageConfig.onShow;
  const originalOnShareAppMessage = pageConfig.onShareAppMessage;
  const originalOnShareTimeline = pageConfig.onShareTimeline;

  return {
    ...pageConfig,

    onLoad(...args) {
      showShareMenu(shareMenuOptions);

      if (redirectTimelineEntryToLanding(this, args[0])) {
        return undefined;
      }

      if (typeof originalOnLoad === 'function') {
        return originalOnLoad.apply(this, args);
      }

      return undefined;
    },

    onShow(...args) {
      showShareMenu(shareMenuOptions);

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

      const options = resolveShareOptions(normalizedShareOptions, 'appMessage', this, args);

      return getShareContent(options);
    },

    onShareTimeline(...args) {
      if (typeof originalOnShareTimeline === 'function') {
        const result = originalOnShareTimeline.apply(this, args);
        if (result) {
          return result;
        }
      }

      const options = resolveShareOptions(normalizedShareOptions, 'timeline', this, args);
      return getTimelineShareContent(options);
    }
  };
}

module.exports = {
  withPageShare,
  showShareMenu,
  getShareContent,
  getTimelineShareContent,
  DEFAULT_SHARE_TITLE,
  DEFAULT_SHARE_PATH,
  DEFAULT_TIMELINE_QUERY
};
