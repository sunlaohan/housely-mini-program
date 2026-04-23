const { ensureAuth } = require('../../utils/page');
const { getDocumentById } = require('../../utils/docs');
const { withPageShare } = require('../../utils/share');
const { getCurrentUser, updatePreviewFontScale } = require('../../utils/account');

const DEFAULT_TITLE = '未命名文档';
const MIN_FONT_SCALE = 1;
const MAX_FONT_SCALE = 2.4;
const FONT_STEP_RATIO = 1.2;
const FONT_SCALE_SAVE_DELAY = 300;

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 20;
  const windowWidth = systemInfo.windowWidth || 375;

  if (!wx.getMenuButtonBoundingClientRect) {
    return {
      statusBarHeight,
      navBarHeight: 44,
      capsuleSafeWidth: 88
    };
  }

  const menuRect = wx.getMenuButtonBoundingClientRect();
  const navBarHeight = (menuRect.top - statusBarHeight) * 2 + menuRect.height;

  return {
    statusBarHeight,
    navBarHeight,
    capsuleSafeWidth: windowWidth - menuRect.left + 8
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeKeyword(keyword = '') {
  return String(keyword || '').trim().toLowerCase();
}

function buildFontState(scale = 1) {
  const nextScale = clamp(Number(scale) || 1, MIN_FONT_SCALE, MAX_FONT_SCALE);
  const titleFontSize = (32 * nextScale).toFixed(1).replace(/\.0$/, '');
  const titleLineHeight = (48 * nextScale).toFixed(1).replace(/\.0$/, '');
  const contentFontSize = (28 * nextScale).toFixed(1).replace(/\.0$/, '');
  const contentLineHeight = (44 * nextScale).toFixed(1).replace(/\.0$/, '');

  return {
    fontScale: nextScale,
    titleTextStyle: `font-size:${titleFontSize}rpx;line-height:${titleLineHeight}rpx;`,
    contentTextStyle: `font-size:${contentFontSize}rpx;line-height:${contentLineHeight}rpx;`,
    emptyLineStyle: `height:${contentLineHeight}rpx;`
  };
}

function getUserPreviewFontScale(user) {
  const fontScale = Number(user && user.previewFontScale);
  if (!Number.isFinite(fontScale)) {
    return MIN_FONT_SCALE;
  }

  return clamp(fontScale, MIN_FONT_SCALE, MAX_FONT_SCALE);
}

function normalizePreviewSource(source, index = 0) {
  const fileId = String(source && (source.fileId || source.sourceFileId) || '').trim();
  const previewUrl = String(source && source.previewUrl || '').trim();
  const tempFilePath = String(source && source.tempFilePath || '').trim();

  return {
    key: String(source && source.key || '').trim() || fileId || tempFilePath || `document-source-${index}`,
    fileId,
    fileName: String(source && (source.fileName || source.sourceName || source.name) || '').trim(),
    type: String(source && (source.type || source.sourceType) || 'image').trim() || 'image',
    previewUrl: previewUrl || tempFilePath,
    tempFilePath
  };
}

function normalizePreviewSources(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .map((source, index) => normalizePreviewSource(source, index))
    .filter((source) => source.fileId || source.previewUrl);
}

function buildSegments(text = '', keyword = '') {
  const sourceText = String(text || '');
  const normalizedKeyword = normalizeKeyword(keyword);

  if (!normalizedKeyword) {
    return [{
      text: sourceText,
      matched: false
    }];
  }

  const normalizedText = sourceText.toLowerCase();
  const segments = [];
  let cursor = 0;

  while (cursor < sourceText.length) {
    const foundIndex = normalizedText.indexOf(normalizedKeyword, cursor);
    if (foundIndex < 0) {
      segments.push({
        text: sourceText.slice(cursor),
        matched: false
      });
      break;
    }

    if (foundIndex > cursor) {
      segments.push({
        text: sourceText.slice(cursor, foundIndex),
        matched: false
      });
    }

    segments.push({
      text: sourceText.slice(foundIndex, foundIndex + normalizedKeyword.length),
      matched: true
    });
    cursor = foundIndex + normalizedKeyword.length;
  }

  if (!segments.length) {
    return [{
      text: sourceText,
      matched: false
    }];
  }

  return segments.filter((segment) => segment.text !== '');
}

function buildPreviewData(doc, keyword = '') {
  const normalizedKeyword = normalizeKeyword(keyword);
  const title = String(doc && doc.name || '').trim() || DEFAULT_TITLE;
  const content = String(doc && (doc.markdown || doc.description) || '')
    .replace(/\r/g, '');
  const sourceLines = content ? content.split('\n') : ['暂无文档内容'];
  const titleSegments = buildSegments(title, normalizedKeyword)
    .map((segment, index) => ({
      id: `detail-title-segment-${index}`,
      text: segment.text,
      matched: segment.matched
    }));
  const titleMatched = titleSegments.some((segment) => segment.matched);

  const contentLines = sourceLines.map((line, index) => {
    const segments = buildSegments(line, normalizedKeyword)
      .map((segment, segmentIndex) => ({
        id: `detail-line-${index}-segment-${segmentIndex}`,
        text: segment.text,
        matched: segment.matched
      }));

    return {
      id: `detail-line-${index}`,
      isEmpty: line === '',
      matched: segments.some((segment) => segment.matched),
      segments
    };
  });

  let firstAnchorId = '';
  if (normalizedKeyword) {
    if (titleMatched) {
      firstAnchorId = 'detail-title-anchor';
    } else {
      const matchedLine = contentLines.find((line) => line.matched);
      firstAnchorId = matchedLine ? matchedLine.id : '';
    }
  }

  return {
    title,
    titleSegments,
    contentLines,
    firstAnchorId
  };
}

Page(withPageShare({
  data: {
    currentUser: null,
    docId: '',
    doc: null,
    statusBarHeight: 20,
    navBarHeight: 44,
    capsuleSafeWidth: 88,
    titleSegments: [],
    contentLines: [],
    searchMode: false,
    searchFocus: false,
    searchKeyword: '',
    scrollIntoView: '',
    fontScale: 1,
    titleTextStyle: '',
    contentTextStyle: '',
    emptyLineStyle: '',
    sourcePreviewUrls: []
  },

  onLoad(options) {
    const docId = String(options && options.id || '').trim();
    const currentUser = getCurrentUser();
    const initialFontScale = getUserPreviewFontScale(currentUser);

    this.setData({
      docId,
      ...getNavMetrics(),
      ...buildFontState(initialFontScale)
    });
  },

  onShow() {
    ensureAuth(this, async (user) => {
      this.lastSavedFontScale = getUserPreviewFontScale(user);
      getApp().setCurrentUser(user);
      this.applyFontScale(this.lastSavedFontScale);
      await this.loadDocument(user);
    });
  },

  onHide() {
    this.flushPendingFontScaleSave();
  },

  onUnload() {
    this.flushPendingFontScaleSave();

    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }
  },

  async loadDocument(user) {
    const docId = this.data.docId;
    if (!docId) {
      wx.showToast({ title: '文件不存在', icon: 'none' });
      this.goBack();
      return;
    }

    try {
      const doc = await getDocumentById(user, docId);
      if (!doc) {
        wx.showToast({ title: '文件不存在', icon: 'none' });
        this.goBack();
        return;
      }

      const sourceFiles = await this.hydrateSourceFiles(doc.sourceFiles || []);
      const hydratedDoc = {
        ...doc,
        sourceFiles
      };

      this.updatePreviewData(hydratedDoc, this.data.searchKeyword, {
        searchMode: this.data.searchMode,
        searchFocus: false,
        shouldScroll: Boolean(normalizeKeyword(this.data.searchKeyword))
      });
    } catch (error) {
      wx.showToast({ title: '加载文件失败', icon: 'none' });
    }
  },

  async hydrateSourceFiles(sourceFiles) {
    const normalizedSources = normalizePreviewSources(sourceFiles);
    const pendingFileIds = normalizedSources
      .filter((source) => !source.previewUrl && source.fileId)
      .map((source) => source.fileId);

    if (!pendingFileIds.length) {
      return normalizedSources;
    }

    try {
      const result = await wx.cloud.getTempFileURL({
        fileList: pendingFileIds
      });
      const urlMap = {};

      (result.fileList || []).forEach((file) => {
        if (file && file.fileID && file.tempFileURL) {
          urlMap[file.fileID] = file.tempFileURL;
        }
      });

      return normalizedSources.map((source) => ({
        ...source,
        previewUrl: source.previewUrl || urlMap[source.fileId] || ''
      }));
    } catch (error) {
      console.error('hydrateSourceFiles failed', error);
      return normalizedSources;
    }
  },

  updatePreviewData(doc, keyword, options = {}) {
    if (!doc) {
      return;
    }

    const previewData = buildPreviewData(doc, keyword);
    const nextData = {
      doc,
      titleSegments: previewData.titleSegments,
      contentLines: previewData.contentLines,
      searchKeyword: keyword,
      sourcePreviewUrls: (doc.sourceFiles || [])
        .map((source) => source.previewUrl || source.tempFilePath || '')
        .filter(Boolean)
    };

    if (typeof options.searchMode === 'boolean') {
      nextData.searchMode = options.searchMode;
    }

    if (typeof options.searchFocus === 'boolean') {
      nextData.searchFocus = options.searchFocus;
    }

    this.setData(nextData, () => {
      if (options.shouldScroll === false) {
        return;
      }

      if (previewData.firstAnchorId) {
        this.scrollToAnchor(previewData.firstAnchorId);
        return;
      }

      if (!normalizeKeyword(keyword)) {
        this.scrollToAnchor('detail-top-anchor');
      }
    });
  },

  scrollToAnchor(anchorId) {
    if (this.scrollTimer) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
    }

    this.setData({
      scrollIntoView: ''
    }, () => {
      this.scrollTimer = setTimeout(() => {
        this.setData({
          scrollIntoView: anchorId
        });
        this.scrollTimer = null;
      }, 0);
    });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    wx.switchTab({
      url: '/pages/home/index'
    });
  },

  goEdit() {
    if (!this.data.docId) {
      return;
    }

    wx.navigateTo({
      url: `/pages/editor/index?id=${this.data.docId}`
    });
  },

  openSearch() {
    if (!this.data.doc) {
      return;
    }

    this.updatePreviewData(this.data.doc, '', {
      searchMode: true,
      searchFocus: true
    });
  },

  clearSearch() {
    if (!this.data.doc) {
      return;
    }

    this.updatePreviewData(this.data.doc, '', {
      searchMode: true,
      searchFocus: true
    });
  },

  cancelSearch() {
    if (!this.data.doc) {
      this.setData({
        searchMode: false,
        searchFocus: false,
        searchKeyword: ''
      });
      return;
    }

    this.updatePreviewData(this.data.doc, '', {
      searchMode: false,
      searchFocus: false
    });
  },

  onSearchInput(event) {
    if (!this.data.doc) {
      return;
    }

    const searchKeyword = String(event.detail.value || '');
    this.updatePreviewData(this.data.doc, searchKeyword, {
      searchMode: true,
      searchFocus: true
    });
  },

  previewSource(event) {
    const key = String(event.currentTarget.dataset.key || '').trim();
    const sourceFiles = Array.isArray(this.data.doc && this.data.doc.sourceFiles) ? this.data.doc.sourceFiles : [];
    const currentSource = sourceFiles.find((source) => source.key === key);
    const previewUrls = this.data.sourcePreviewUrls;

    if (!currentSource || !currentSource.previewUrl || !previewUrls.length) {
      return;
    }

    wx.previewImage({
      current: currentSource.previewUrl,
      urls: previewUrls
    });
  },

  applyFontScale(nextScale) {
    this.setData(buildFontState(nextScale));
  },

  scheduleFontScaleSave(nextScale) {
    this.pendingFontScale = clamp(Number(nextScale) || MIN_FONT_SCALE, MIN_FONT_SCALE, MAX_FONT_SCALE);

    if (this.fontScaleSaveTimer) {
      clearTimeout(this.fontScaleSaveTimer);
      this.fontScaleSaveTimer = null;
    }

    this.fontScaleSaveTimer = setTimeout(() => {
      this.fontScaleSaveTimer = null;
      this.flushPendingFontScaleSave();
    }, FONT_SCALE_SAVE_DELAY);
  },

  flushPendingFontScaleSave() {
    if (this.fontScaleSaveTimer) {
      clearTimeout(this.fontScaleSaveTimer);
      this.fontScaleSaveTimer = null;
    }

    if (!Number.isFinite(this.pendingFontScale)) {
      return;
    }

    const nextScale = this.pendingFontScale;
    this.pendingFontScale = null;
    this.persistFontScalePreference(nextScale);
  },

  async persistFontScalePreference(nextScale) {
    const currentUser = this.data.currentUser || getCurrentUser();
    const username = String(currentUser && currentUser.username || '').trim();
    const normalizedScale = clamp(Number(nextScale) || MIN_FONT_SCALE, MIN_FONT_SCALE, MAX_FONT_SCALE);

    if (!username || normalizedScale === this.lastSavedFontScale) {
      return;
    }

    this.lastSavedFontScale = normalizedScale;

    try {
      const result = await updatePreviewFontScale(username, normalizedScale);
      if (result.ok && result.user) {
        getApp().setCurrentUser(result.user);
        this.setData({
          currentUser: result.user
        });
      }
    } catch (error) {
      console.error('persistFontScalePreference failed', error);
      this.lastSavedFontScale = null;
    }
  },

  zoomOutText() {
    const nextScale = clamp(Number((this.data.fontScale * 0.8).toFixed(2)), MIN_FONT_SCALE, MAX_FONT_SCALE);
    if (nextScale === this.data.fontScale) {
      return;
    }

    this.applyFontScale(nextScale);
    this.scheduleFontScaleSave(nextScale);
  },

  zoomInText() {
    const nextScale = clamp(Number((this.data.fontScale * FONT_STEP_RATIO).toFixed(2)), MIN_FONT_SCALE, MAX_FONT_SCALE);
    if (nextScale === this.data.fontScale) {
      return;
    }

    this.applyFontScale(nextScale);
    this.scheduleFontScaleSave(nextScale);
  }
}));
