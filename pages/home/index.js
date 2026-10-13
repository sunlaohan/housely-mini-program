const { ensureAuth, formatDate } = require('../../utils/page');
const {
  getDocuments,
  deleteDocument,
  deleteDocuments,
  moveDocumentCategory,
  moveDocumentsCategory
} = require('../../utils/docs');
const { withPageShare } = require('../../utils/share');
const { getCurrentUser } = require('../../utils/account');
const { KEYS, read, write, remove } = require('../../utils/storage');
const {
  DEFAULT_CATEGORY_ID,
  createCategory,
  deleteCategory,
  getCategories,
  getDefaultCategory,
  updateCategory,
  updateCategoryOrder
} = require('../../utils/categories');

const CATEGORY_NAME_MAX_LENGTH = 16;
const ALL_CATEGORY_ID = 'all';
const TIMELINE_ENTRY = 'timeline';
const TIMELINE_SCENE = 1154;
const SHARE_HIGHLIGHTS = [
  {
    key: 'capture',
    icon: '/assets/auth/photograph.svg',
    title: '拍照入库',
    description: '说明书、票据、户号纸条，拍一下就能收进小程序。'
  },
  {
    key: 'ocr',
    icon: '/assets/auth/description.svg',
    title: '自动成稿',
    description: 'OCR 会帮你整理标题、摘要和正文草稿，省下手动录入。'
  },
  {
    key: 'search',
    icon: '/assets/auth/search.svg',
    title: '随手可搜',
    description: '标题和正文都支持搜索，找资料不用翻抽屉。'
  },
  {
    key: 'family',
    icon: '/assets/auth/smile.svg',
    title: '全家省心',
    description: '常用家庭资料集中存放，搬家、报修、缴费都更顺手。'
  }
];

function limitCategoryName(value = '') {
  return Array.from(String(value || '')).slice(0, CATEGORY_NAME_MAX_LENGTH).join('');
}

function moveArrayItem(items, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }

  const nextItems = items.slice();
  const [item] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

function getCategoryRowHeightPx() {
  const systemInfo = wx.getSystemInfoSync();
  return Math.max(44, ((systemInfo.windowWidth || 375) / 750) * 96);
}

function getTouchY(event) {
  const touch = event.changedTouches && event.changedTouches[0];
  return touch ? touch.clientY : 0;
}

function buildCategoryDragPreviewItems(categories, sourceIndex, hoverIndex, offsetY, rowHeight) {
  if (sourceIndex < 0 || hoverIndex < 0) {
    return categories;
  }

  return categories.map((category, index) => {
    let dragStyle = '';
    const shift = rowHeight || getCategoryRowHeightPx();

    if (index === sourceIndex) {
      dragStyle = `transform: translateY(${offsetY}px) scale(1.025); z-index: 4;`;
    } else if (hoverIndex > sourceIndex && index > sourceIndex && index <= hoverIndex) {
      dragStyle = `transform: translateY(-${shift}px);`;
    } else if (hoverIndex < sourceIndex && index >= hoverIndex && index < sourceIndex) {
      dragStyle = `transform: translateY(${shift}px);`;
    }

    return {
      ...category,
      dragStyle,
      dragging: index === sourceIndex
    };
  });
}

const SHARE_SCENES = [
  '空调说明书找不到时，搜一下就能看',
  '水电燃气户号要填时，不用再翻票据',
  '老人不会用家电时，直接把文档发给家里人看'
];

function getEnterScene() {
  if (typeof wx.getEnterOptionsSync !== 'function') {
    return 0;
  }

  try {
    const options = wx.getEnterOptionsSync();
    return Number(options && options.scene) || 0;
  } catch (error) {
    return 0;
  }
}

function isTimelineShareEntry(options = {}) {
  return String(options && options.entry || '').trim() === TIMELINE_ENTRY
    || getEnterScene() === TIMELINE_SCENE;
}

function escapeHtml(text = '') {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripMarkdownSyntax(text = '') {
  return String(text || '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/#{1,6}\s*/g, ' ')
    .replace(/[*_>`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDocPreview(doc) {
  const rawMarkdown = String(doc && doc.markdown || '').replace(/\r/g, '');
  const text = rawMarkdown
    .split('\n')
    .map((line) => stripMarkdownSyntax(line))
    .filter(Boolean)
    .filter((line) => !/^文件标题[:：]/.test(line))
    .filter((line) => !/^识别引擎[:：]/.test(line))
    .filter((line) => !/^来源类型[:：]/.test(line))
    .filter((line) => !/^图片\d+[:：]/.test(line))
    .filter((line) => !/^已通过.*OCR.*$/.test(line))
    .filter((line) => !/^已识别\d+张图片$/.test(line))
    .filter((line) => line !== String(doc && doc.name || '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function normalizeKeyword(keyword = '') {
  return String(keyword || '')
    .trim()
    .toLowerCase();
}

function countKeywordMatches(text = '', keyword = '') {
  if (!text || !keyword) {
    return 0;
  }

  const normalizedText = String(text).toLowerCase();
  let fromIndex = 0;
  let count = 0;

  while (fromIndex < normalizedText.length) {
    const foundIndex = normalizedText.indexOf(keyword, fromIndex);
    if (foundIndex < 0) {
      break;
    }

    count += 1;
    fromIndex = foundIndex + keyword.length;
  }

  return count;
}

function buildHighlightedTitle(title = '', keyword = '') {
  const safeTitle = String(title || '');
  const normalizedKeyword = normalizeKeyword(keyword);

  if (!safeTitle || !normalizedKeyword) {
    return escapeHtml(safeTitle);
  }

  const normalizedTitle = safeTitle.toLowerCase();
  let cursor = 0;
  let html = '';

  while (cursor < safeTitle.length) {
    const foundIndex = normalizedTitle.indexOf(normalizedKeyword, cursor);
    if (foundIndex < 0) {
      html += escapeHtml(safeTitle.slice(cursor));
      break;
    }

    html += escapeHtml(safeTitle.slice(cursor, foundIndex));
    html += `<span style="color:#246FE5;">${escapeHtml(safeTitle.slice(foundIndex, foundIndex + normalizedKeyword.length))}</span>`;
    cursor = foundIndex + normalizedKeyword.length;
  }

  return html;
}

function buildSearchableDoc(doc) {
  return {
    ...doc,
    categoryId: String(doc && doc.categoryId || DEFAULT_CATEGORY_ID).trim() || DEFAULT_CATEGORY_ID,
    categoryName: String(doc && doc.categoryId || DEFAULT_CATEGORY_ID).trim() === DEFAULT_CATEGORY_ID
      ? '未分类'
      : (String(doc && doc.categoryName || '未分类').trim() || '未分类'),
    coverFileId: getDocCoverFileId(doc),
    coverUrl: '',
    previewText: buildDocPreview(doc),
    titleRichText: escapeHtml(doc.name || ''),
    searchScore: 0
  };
}

function getAllCategory() {
  return {
    id: ALL_CATEGORY_ID,
    name: '全部',
    isAll: true,
    isDefault: true,
    swipeOffset: 0,
    editing: false,
    draftName: '全部',
    focus: false
  };
}

function buildHomeCategories(categories = [], docs = [], preservedCategoryId = '') {
  const categoryIdsWithDocs = new Set((docs || []).map((doc) => {
    const categoryId = String(doc && doc.categoryId || DEFAULT_CATEGORY_ID).trim() || DEFAULT_CATEGORY_ID;
    return categoryId;
  }));
  const normalizedPreservedCategoryId = String(preservedCategoryId || '').trim();

  return [getAllCategory()].concat((categories || []).filter((category) =>
    categoryIdsWithDocs.has(category.id) || category.id === normalizedPreservedCategoryId
  ));
}

function getDocCoverFileId(doc) {
  const sourceFiles = Array.isArray(doc && doc.sourceFiles) ? doc.sourceFiles : [];
  const coverSource = sourceFiles.find((source) => {
    const fileId = String(source && source.fileId || '').trim();
    const type = String(source && source.type || 'image').trim();
    return fileId && type === 'image';
  });

  return coverSource ? String(coverSource.fileId || '').trim() : '';
}

function scoreDocMatch(doc, keyword = '') {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) {
    return null;
  }

  const title = String(doc && doc.name || '');
  const content = String(doc && doc.previewText || '');
  const normalizedTitle = title.toLowerCase();
  const normalizedContent = content.toLowerCase();
  const titleFirstIndex = normalizedTitle.indexOf(normalizedKeyword);
  const contentFirstIndex = normalizedContent.indexOf(normalizedKeyword);
  const titleMatchCount = countKeywordMatches(title, normalizedKeyword);
  const contentMatchCount = countKeywordMatches(content, normalizedKeyword);
  const matched = titleFirstIndex >= 0 || contentFirstIndex >= 0;

  if (!matched) {
    return null;
  }

  let score = 0;

  if (titleFirstIndex === 0) {
    score += 1000;
  } else if (titleFirstIndex > 0) {
    score += 800;
  }

  score += titleMatchCount * 100;

  if (contentFirstIndex === 0) {
    score += 90;
  } else if (contentFirstIndex > 0) {
    score += 60;
  }

  score += contentMatchCount * 10;

  return {
    ...doc,
    searchScore: score,
    titleRichText: buildHighlightedTitle(title, normalizedKeyword)
  };
}

function consumePendingHomeCategoryId() {
  const categoryId = String(read(KEYS.PENDING_HOME_CATEGORY_ID, '') || '').trim();
  if (categoryId) {
    remove(KEYS.PENDING_HOME_CATEGORY_ID);
  }

  return categoryId;
}

function getPendingHomeDocument() {
  const document = read(KEYS.PENDING_HOME_DOCUMENT, null);
  const documentId = String(document && (document.id || document._id) || '').trim();
  return documentId ? document : null;
}

function isPendingHomeDocumentOwnedByUser(document, user) {
  const ownerKey = String(document && (document.ownerKey || document.username) || '').trim();
  const documentUserId = String(document && document.userId || '').trim();
  const username = String(user && user.username || '').trim();
  const userId = String(user && user.id || '').trim();

  return Boolean(
    (ownerKey && username && ownerKey === username)
    || (documentUserId && userId && documentUserId === userId)
  );
}

function mergePendingHomeDocument(documents = [], pendingDocument = null) {
  const pendingDocumentId = String(
    pendingDocument && (pendingDocument.id || pendingDocument._id) || ''
  ).trim();

  if (!pendingDocumentId) {
    return documents;
  }

  return [pendingDocument].concat(documents.filter((document) =>
    String(document && (document.id || document._id) || '').trim() !== pendingDocumentId
  ));
}

function getDocumentCategoryId(document) {
  return String(document && document.categoryId || DEFAULT_CATEGORY_ID).trim() || DEFAULT_CATEGORY_ID;
}

function mergeRefreshedCategoryDocuments(
  existingDocuments = [],
  refreshedDocuments = [],
  categoryId = ''
) {
  const normalizedCategoryId = String(categoryId || '').trim();
  if (!normalizedCategoryId || normalizedCategoryId === ALL_CATEGORY_ID) {
    return refreshedDocuments;
  }

  const refreshedDocumentIds = new Set(refreshedDocuments.map((document) =>
    String(document && (document.id || document._id) || '').trim()
  ).filter(Boolean));
  const preservedDocuments = existingDocuments.filter((document) => {
    const documentId = String(document && (document.id || document._id) || '').trim();
    return getDocumentCategoryId(document) !== normalizedCategoryId
      && !refreshedDocumentIds.has(documentId);
  });

  return refreshedDocuments.concat(preservedDocuments);
}

function sortDocumentsByUpdatedAt(documents = []) {
  return documents.slice().sort((left, right) => {
    const leftTime = new Date(left && (left.updatedAt || left.createdAt) || 0).getTime();
    const rightTime = new Date(right && (right.updatedAt || right.createdAt) || 0).getTime();
    return rightTime - leftTime;
  });
}

function waitForNextRender(callback) {
  if (typeof wx.nextTick === 'function') {
    wx.nextTick(callback);
    return;
  }

  setTimeout(callback, 50);
}

function waitForNextRenderAsync() {
  return new Promise((resolve) => {
    waitForNextRender(resolve);
  });
}

Page(withPageShare({
  data: {
    currentUser: null,
    shareEntry: '',
    shareLandingVisible: false,
    shareHighlights: SHARE_HIGHLIGHTS,
    shareScenes: SHARE_SCENES,
    categories: [getDefaultCategory()],
    homeCategories: [getAllCategory()],
    selectedCategoryId: ALL_CATEGORY_ID,
    showCategoryMore: false,
    categoryHasOverflow: false,
    categoryScrollLeft: 0,
    categoryScrollTargetLeft: 0,
    categoryScrollWidth: 0,
    categoryWrapWidth: 0,
    categoryScrollIntoView: '',
    categoryChooserVisible: false,
    categoryChooserMode: 'manage',
    moveDocumentId: '',
    moveDocumentIds: [],
    moveCategoryId: DEFAULT_CATEGORY_ID,
    categoryEditDialogVisible: false,
    categoryEditId: '',
    categoryEditName: '',
    categoryEditFocus: false,
    categoryEditSaving: false,
    categorySwipeId: '',
    categoryTouchStartX: 0,
    categoryTouchMoved: false,
    categorySwipeThreshold: 28,
    categorySwipeMaxOffset: 240,
    categoryDragKey: '',
    categoryDragIndex: -1,
    categoryDragStartY: 0,
    categoryDragMoved: false,
    categoryDragHoverIndex: -1,
    categoryDragSaving: false,
    categoryDragBaseList: [],
    allDocs: [],
    docs: [],
    docGroups: [],
    isLoadingDocs: false,
    contentRefreshing: false,
    searchKeyword: '',
    searchLoading: false,
    batchMode: false,
    selectedIds: [],
    selectedVisibleCount: 0,
    allVisibleSelected: false,
    deleteSelectedText: '删除选中项',
    swipeId: '',
    touchStartX: 0,
    touchCurrentX: 0,
    touchMoved: false,
    swipeThreshold: 28,
    swipeMaxOffset: 228
  },

  onLoad(options) {
    this.setData({
      shareEntry: isTimelineShareEntry(options) ? TIMELINE_ENTRY : ''
    });
  },

  async onShow() {
    const currentUser = getCurrentUser();
    const shareLandingVisible = !currentUser && this.data.shareEntry === TIMELINE_ENTRY;

    if (!currentUser) {
      getApp().setCurrentUser(null);
      this.setData({
        currentUser: null,
        shareLandingVisible,
        categories: [getDefaultCategory()],
        homeCategories: [getAllCategory()],
        selectedCategoryId: ALL_CATEGORY_ID,
        showCategoryMore: false,
        categoryHasOverflow: false,
        categoryScrollLeft: 0,
        categoryScrollTargetLeft: 0,
        categoryScrollWidth: 0,
        categoryWrapWidth: 0,
        categoryScrollIntoView: '',
        categoryChooserVisible: false,
        allDocs: [],
        docs: [],
        docGroups: [],
        isLoadingDocs: false,
        contentRefreshing: false,
        searchKeyword: '',
        searchLoading: false,
        batchMode: false,
        selectedIds: [],
        selectedVisibleCount: 0,
        allVisibleSelected: false,
        deleteSelectedText: '删除选中项',
        swipeId: ''
      }, () => {
        this.syncTabBar();
      });
      return;
    }

    const pendingCategoryId = String(read(KEYS.PENDING_HOME_CATEGORY_ID, '') || '').trim();
    const pendingDocument = getPendingHomeDocument();
    const pendingHomeRefresh = Boolean(read(KEYS.PENDING_HOME_REFRESH, ''));
    const shouldShowReturnLoading = Boolean(pendingCategoryId || pendingDocument || pendingHomeRefresh);
    if (shouldShowReturnLoading) {
      wx.showLoading({ title: '加载中...', mask: true });
    }

    try {
      const categories = await getCategories(currentUser);
      this.setData({
        shareLandingVisible: false,
        categories,
        isLoadingDocs: shouldShowReturnLoading || (!this.data.allDocs.length && !this.data.docs.length)
      }, () => {
        this.syncCategoryMoreVisibility();
      });
      this.syncTabBar();
      ensureAuth(this, async (user) => {
        await this.loadDocuments(user, {
          pendingCategoryId,
          pendingDocument,
          forceRefresh: pendingHomeRefresh,
          showLoadingOverlay: shouldShowReturnLoading
        });
      });
    } catch (error) {
      if (shouldShowReturnLoading) {
        wx.hideLoading();
      }
      this.setData({
        isLoadingDocs: false,
        contentRefreshing: false
      });
      wx.showToast({ title: '加载文档失败', icon: 'none' });
    }
  },

  async onListRefresh() {
    const currentUser = getCurrentUser();
    if (!currentUser || this.data.shareLandingVisible) {
      this.setData({ contentRefreshing: false });
      return;
    }

    this.setData({ contentRefreshing: true });

    try {
      await this.loadDocuments(currentUser, {
        silent: true,
        queryCategoryId: this.data.selectedCategoryId || ALL_CATEGORY_ID
      });
    } finally {
      this.setData({ contentRefreshing: false });
    }
  },

  async loadDocuments(user, options = {}) {
    const {
      silent = false,
      pendingCategoryId = '',
      pendingDocument: requestedPendingDocument = null,
      queryCategoryId = '',
      forceRefresh = false,
      showLoadingOverlay = false
    } = options;
    const pendingDocument = requestedPendingDocument || getPendingHomeDocument();
    const normalizedQueryCategoryId = String(queryCategoryId || '').trim();
    const targetCategoryId = String(pendingCategoryId || '').trim() || consumePendingHomeCategoryId();
    if (targetCategoryId) {
      remove(KEYS.PENDING_HOME_CATEGORY_ID);
    }
    try {
      const fetchedDocuments = await getDocuments(user, normalizedQueryCategoryId);
      const ownedPendingDocument = isPendingHomeDocumentOwnedByUser(pendingDocument, user)
        ? pendingDocument
        : null;
      const pendingDocumentId = String(
        ownedPendingDocument && (ownedPendingDocument.id || ownedPendingDocument._id) || ''
      ).trim();
      const pendingDocumentCategoryId = getDocumentCategoryId(ownedPendingDocument);
      const pendingDocumentCategoryWasFetched = Boolean(
        !normalizedQueryCategoryId
        || normalizedQueryCategoryId === ALL_CATEGORY_ID
        || normalizedQueryCategoryId === pendingDocumentCategoryId
      );
      const pendingDocumentConfirmed = Boolean(
        pendingDocumentCategoryWasFetched
        && pendingDocumentId
        && fetchedDocuments.some((document) =>
          String(document && (document.id || document._id) || '').trim() === pendingDocumentId
        )
      );
      const refreshedDocuments = mergeRefreshedCategoryDocuments(
        this.data.allDocs,
        fetchedDocuments,
        normalizedQueryCategoryId
      );
      const mergedDocuments = sortDocumentsByUpdatedAt(
        mergePendingHomeDocument(refreshedDocuments, ownedPendingDocument)
      );
      const docs = await this.hydrateDocCovers(mergedDocuments.map(this.decorateDoc));
      const categories = await getCategories(user);
      const requestedCategoryId = targetCategoryId || this.data.selectedCategoryId;
      const homeCategories = buildHomeCategories(categories, docs, requestedCategoryId);
      const currentCategory = homeCategories.find((category) => category.id === requestedCategoryId)
        || getAllCategory();
      const lastCategory = homeCategories[homeCategories.length - 1] || null;
      const isLastCategory = Boolean(lastCategory && lastCategory.id === currentCategory.id);
      const categoryScrollState = targetCategoryId ? {
        categoryScrollIntoView: isLastCategory ? '' : `category-tab-${currentCategory.id}`,
        categoryScrollTargetLeft: isLastCategory ? 99999 : this.data.categoryScrollLeft,
        showCategoryMore: isLastCategory ? false : this.data.showCategoryMore
      } : {};
      const existingIds = new Set(docs.map((doc) => doc.id));
      const selectedIds = this.data.selectedIds.filter((id) => existingIds.has(id));
      const visibleDocs = this.getVisibleDocs(docs, this.data.searchKeyword, selectedIds, currentCategory.id, categories);
      const batchSelection = this.getBatchSelectionState(visibleDocs, selectedIds);
      this.setData({
        currentUser: user,
        categories,
        homeCategories,
        selectedCategoryId: currentCategory.id,
        allDocs: docs,
        selectedIds,
        docs: visibleDocs,
        docGroups: this.buildDocGroups(visibleDocs, currentCategory.id),
        swipeId: '',
        isLoadingDocs: false,
        contentRefreshing: false,
        ...categoryScrollState,
        ...batchSelection
      }, () => {
        this.syncCategoryMoreVisibility();
        if (showLoadingOverlay) {
          waitForNextRender(() => {
            wx.hideLoading();
          });
        }
      });
      getApp().setCurrentUser(user);
      if (pendingDocument && (!ownedPendingDocument || pendingDocumentConfirmed)) {
        remove(KEYS.PENDING_HOME_DOCUMENT);
      }
      if (forceRefresh) {
        remove(KEYS.PENDING_HOME_REFRESH);
      }
    } catch (error) {
      this.setData({
        isLoadingDocs: false,
        contentRefreshing: false
      });
      if (showLoadingOverlay) {
        wx.hideLoading();
      }
      wx.showToast({ title: silent ? '刷新失败' : '加载文档失败', icon: 'none' });
    }
  },

  syncCategoryMoreVisibility() {
    if (!this.data.allDocs.length || !this.data.homeCategories || this.data.homeCategories.length <= 1) {
      this.setData({
        showCategoryMore: Boolean(this.data.allDocs.length && this.data.homeCategories && this.data.homeCategories.length),
        categoryHasOverflow: false
      });
      return;
    }

    const query = wx.createSelectorQuery().in(this);
    query.select('.home-category-tabs').boundingClientRect();
    query.select('.home-category-tabs__inner').boundingClientRect();
    query.exec((result) => {
      const wrapRect = result && result[0];
      const innerRect = result && result[1];
      const fallbackVisible = this.data.homeCategories.length > 3;

      if (!wrapRect || !innerRect) {
        this.setData({
          showCategoryMore: true,
          categoryHasOverflow: fallbackVisible
        });
        return;
      }

      const wrapWidth = wrapRect.width || 0;
      const innerWidth = Math.max(0, (innerRect.width || 0) - 32);
      const hasOverflow = innerWidth > wrapWidth + 4;
      this.setData({
        categoryHasOverflow: hasOverflow,
        categoryWrapWidth: wrapWidth,
        categoryScrollWidth: innerWidth,
        showCategoryMore: true
      });
    });
  },

  updateCategoryMoreVisibility(scrollLeft = this.data.categoryScrollLeft, scrollWidth = this.data.categoryScrollWidth) {
    const wrapWidth = this.data.categoryWrapWidth || 0;
    const fullWidth = Math.max(0, (scrollWidth || this.data.categoryScrollWidth || 0) - 32);
    const hasOverflow = Boolean(wrapWidth && fullWidth > wrapWidth + 4);

    this.setData({
      categoryScrollLeft: Math.max(0, scrollLeft),
      categoryScrollWidth: fullWidth,
      categoryHasOverflow: hasOverflow,
      showCategoryMore: true
    });
  },

  onCategoryTabsScroll(event) {
    const detail = event.detail || {};
    this.updateCategoryMoreVisibility(
      Number(detail.scrollLeft) || 0,
      Number(detail.scrollWidth) || this.data.categoryScrollWidth
    );
  },

  syncTabBar() {
    if (typeof this.getTabBar !== 'function') {
      return;
    }

    const tabBar = this.getTabBar();
    if (tabBar && typeof tabBar.setData === 'function') {
      tabBar.setData({
        selected: 0,
        hidden: this.data.batchMode || this.data.shareLandingVisible
      });
    }
  },

  goLogin() {
    wx.reLaunch({
      url: '/pages/auth/login/index'
    });
  },

  decorateDoc(doc) {
    const docCovers = read(KEYS.DOC_COVERS, {}) || {};
    const cachedCover = docCovers[doc.id] || null;
    const decoratedDoc = buildSearchableDoc(doc);

    if (cachedCover && cachedCover.coverFileId && cachedCover.coverUrl) {
      decoratedDoc.coverFileId = cachedCover.coverFileId;
      decoratedDoc.coverUrl = cachedCover.coverUrl;
    }

    return {
      ...decoratedDoc,
      createdLabel: formatDate(doc.createdAt),
      updatedLabel: formatDate(doc.updatedAt),
      selected: false,
      swipeOffset: 0
    };
  },

  async hydrateDocCovers(docs = []) {
    const cachedCoverUrlMap = read(KEYS.COVER_URLS, {}) || {};
    const cachedDocCoverMap = read(KEYS.DOC_COVERS, {}) || {};
    const previousCoverUrlMap = { ...cachedCoverUrlMap };
    Object.keys(cachedDocCoverMap).forEach((docId) => {
      const cachedCover = cachedDocCoverMap[docId];
      if (cachedCover && cachedCover.coverFileId && cachedCover.coverUrl) {
        previousCoverUrlMap[cachedCover.coverFileId] = cachedCover.coverUrl;
      }
    });
    (this.data.allDocs || []).concat(this.data.docs || []).forEach((doc) => {
      if (doc && doc.coverFileId && doc.coverUrl) {
        previousCoverUrlMap[doc.coverFileId] = doc.coverUrl;
      }
    });

    const pendingFileIds = Array.from(new Set(
      docs
        .map((doc) => doc.coverFileId)
        .filter(Boolean)
    ));

    if (!pendingFileIds.length || !wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
      return docs.map((doc) => ({
        ...doc,
        coverUrl: doc.coverFileId ? (previousCoverUrlMap[doc.coverFileId] || doc.coverUrl || '') : ''
      }));
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
      write(KEYS.COVER_URLS, {
        ...cachedCoverUrlMap,
        ...urlMap
      });

      return docs.map((doc) => ({
        ...doc,
        coverUrl: doc.coverFileId
          ? (urlMap[doc.coverFileId] || previousCoverUrlMap[doc.coverFileId] || doc.coverUrl || '')
          : ''
      }));
    } catch (error) {
      console.error('hydrateDocCovers failed', error);
      return docs.map((doc) => ({
        ...doc,
        coverUrl: doc.coverFileId ? (previousCoverUrlMap[doc.coverFileId] || doc.coverUrl || '') : ''
      }));
    }
  },

  syncDocSelection(selectedIds = this.data.selectedIds, docs = this.data.docs) {
    const selectedSet = new Set(selectedIds);
    return docs.map((doc) => ({
      ...doc,
      selected: selectedSet.has(doc.id)
    }));
  },

  getBatchSelectionState(docs = this.data.docs, selectedIds = this.data.selectedIds) {
    const selectedSet = new Set(selectedIds);
    const visibleIds = docs.map((doc) => doc.id).filter(Boolean);
    const selectedVisibleCount = visibleIds.filter((id) => selectedSet.has(id)).length;

    return {
      selectedVisibleCount,
      allVisibleSelected: Boolean(visibleIds.length && selectedVisibleCount === visibleIds.length),
      deleteSelectedText: selectedIds.length ? `删除选中项（${selectedIds.length}）` : '删除选中项'
    };
  },

  buildDocGroups(docs = [], selectedCategoryId = this.data.selectedCategoryId) {
    if (selectedCategoryId !== ALL_CATEGORY_ID) {
      return [{ id: 'current-category', name: '', docs }];
    }

    const groups = new Map();
    docs.forEach((doc) => {
      const categoryId = doc.categoryId || DEFAULT_CATEGORY_ID;
      if (!groups.has(categoryId)) {
        groups.set(categoryId, {
          id: categoryId,
          name: doc.categoryName || '未分类',
          docs: []
        });
      }
      groups.get(categoryId).docs.push(doc);
    });
    const categoryOrder = new Map((this.data.categories || []).map((category, index) => [
      category.id,
      index
    ]));
    return Array.from(groups.values()).sort((left, right) => {
      const leftOrder = categoryOrder.has(left.id) ? categoryOrder.get(left.id) : Number.MAX_SAFE_INTEGER;
      const rightOrder = categoryOrder.has(right.id) ? categoryOrder.get(right.id) : Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
  },

  getVisibleDocs(
    allDocs = this.data.allDocs,
    keyword = this.data.searchKeyword,
    selectedIds = this.data.selectedIds,
    selectedCategoryId = this.data.selectedCategoryId,
    categories = this.data.categories
  ) {
    const normalizedKeyword = normalizeKeyword(keyword);
    const categoryId = selectedCategoryId || ALL_CATEGORY_ID;
    const knownCategoryIds = new Set((categories || []).map((category) => category.id));
    const categoryDocs = allDocs.filter((doc) => {
      if (categoryId === ALL_CATEGORY_ID) {
        return true;
      }
      const docCategoryId = knownCategoryIds.has(doc.categoryId) ? doc.categoryId : DEFAULT_CATEGORY_ID;
      return docCategoryId === categoryId;
    });
    const baseDocs = this.syncDocSelection(selectedIds, categoryDocs);

    if (!normalizedKeyword) {
      return baseDocs.map((doc) => ({
        ...doc,
        titleRichText: escapeHtml(doc.name || ''),
        searchScore: 0
      }));
    }

    return baseDocs
      .map((doc) => scoreDocMatch(doc, normalizedKeyword))
      .filter(Boolean)
      .sort((left, right) => {
        if (right.searchScore !== left.searchScore) {
          return right.searchScore - left.searchScore;
        }

        const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
        return rightTime - leftTime;
      });
  },

  scheduleSearch(keyword) {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }

    const normalizedKeyword = String(keyword || '');
    if (!normalizeKeyword(normalizedKeyword)) {
      const docs = this.getVisibleDocs(this.data.allDocs, '', this.data.selectedIds, this.data.selectedCategoryId);
      this.setData({
        searchLoading: false,
        docs,
        docGroups: this.buildDocGroups(docs),
        ...this.getBatchSelectionState(docs, this.data.selectedIds)
      });
      return;
    }

    this.setData({ searchLoading: true });

    this.searchTimer = setTimeout(() => {
      const docs = this.getVisibleDocs(this.data.allDocs, normalizedKeyword, this.data.selectedIds, this.data.selectedCategoryId);
      this.searchTimer = null;
      this.setData({
        searchLoading: false,
        docs,
        docGroups: this.buildDocGroups(docs),
        ...this.getBatchSelectionState(docs, this.data.selectedIds)
      });
    }, 1000);
  },

  onSearchInput(event) {
    const searchKeyword = event.detail.value || '';
    this.setData({ searchKeyword });
    this.scheduleSearch(searchKeyword);
  },

  clearSearch() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }

    const docs = this.getVisibleDocs(this.data.allDocs, '', this.data.selectedIds, this.data.selectedCategoryId);
    this.setData({
      searchKeyword: '',
      searchLoading: false,
      docs,
      docGroups: this.buildDocGroups(docs),
      ...this.getBatchSelectionState(docs, this.data.selectedIds)
    });
  },

  cancelSearch() {
    this.clearSearch();
  },

  goAdd() {
    const selectedCategoryId = String(this.data.selectedCategoryId || '').trim();
    const categoryId = encodeURIComponent(
      selectedCategoryId && selectedCategoryId !== ALL_CATEGORY_ID
        ? selectedCategoryId
        : DEFAULT_CATEGORY_ID
    );
    wx.navigateTo({
      url: `/pages/editor/index?categoryId=${categoryId}`
    });
  },

  switchCategory(event) {
    const { id } = event.currentTarget.dataset;
    this.applyCategory(id);
  },

  applyCategory(id) {
    if (!id || id === this.data.selectedCategoryId) {
      if (this.data.categoryChooserVisible) {
        this.setData({ categoryChooserVisible: false });
      }
      return;
    }

    const lastCategory = this.data.homeCategories[this.data.homeCategories.length - 1] || null;
    const isLastCategory = Boolean(lastCategory && lastCategory.id === id);
    const docs = this.getVisibleDocs(this.data.allDocs, this.data.searchKeyword, this.data.selectedIds, id);
    this.setData({
      selectedCategoryId: id,
      categoryChooserVisible: false,
      categoryScrollIntoView: isLastCategory ? '' : `category-tab-${id}`,
      categoryScrollTargetLeft: isLastCategory ? 99999 : this.data.categoryScrollLeft,
      showCategoryMore: isLastCategory ? false : this.data.showCategoryMore,
      docs,
      docGroups: this.buildDocGroups(docs, id),
      swipeId: '',
      ...this.getBatchSelectionState(docs, this.data.selectedIds)
    }, () => {
      setTimeout(() => {
        this.syncCategoryMoreVisibility();
      }, 120);
    });
  },

  async openCategoryChooser() {
    this.closeSwipe();
    this.setData({
      categoryChooserVisible: true,
      categoryChooserMode: 'manage',
      moveDocumentId: '',
      moveDocumentIds: [],
      categorySwipeId: '',
      homeCategories: this.data.homeCategories.map((category) => ({
        ...category,
        swipeOffset: 0
      }))
    });

    wx.showLoading({ title: '加载中', mask: true });
    try {
      const categories = await getCategories(this.data.currentUser);
      this.refreshHomeCategories(categories);
    } finally {
      wx.hideLoading();
    }
  },

  closeCategoryChooser() {
    this.setData({
      categoryChooserVisible: false,
      categoryChooserMode: 'manage',
      moveDocumentId: '',
      moveDocumentIds: []
    });
  },

  async chooseCategoryFromSheet(event) {
    if (this.data.categoryTouchMoved) {
      return;
    }
    const { id } = event.currentTarget.dataset;
    if (this.data.categoryChooserMode === 'move') {
      await this.moveDocumentToCategory(id);
      return;
    }
    this.applyCategory(id);
  },

  async openMoveCategoryChooser(event) {
    const { id } = event.currentTarget.dataset;
    const doc = this.data.allDocs.find((item) => item.id === id);
    if (!doc) {
      return;
    }

    this.setData({
      categoryChooserVisible: true,
      categoryChooserMode: 'move',
      moveDocumentId: id,
      moveDocumentIds: [],
      moveCategoryId: doc.categoryId || DEFAULT_CATEGORY_ID,
      swipeId: '',
      docs: this.resetSwipeOffsets(),
      categorySwipeId: '',
      categories: this.data.categories.map((category) => ({
        ...category,
        swipeOffset: 0
      }))
    });

    wx.showLoading({ title: '加载中', mask: true });
    try {
      const categories = await getCategories(this.data.currentUser);
      this.setData({ categories });
    } finally {
      wx.hideLoading();
    }
  },

  async openBatchMoveCategoryChooser() {
    const selectedIds = this.data.selectedIds.filter(Boolean);
    if (!selectedIds.length) {
      wx.showToast({ title: '请先选择文件', icon: 'none' });
      return;
    }

    const selectedIdSet = new Set(selectedIds);
    const selectedDocs = this.data.allDocs.filter((doc) => selectedIdSet.has(doc.id));
    const categoryIds = Array.from(new Set(selectedDocs.map((doc) =>
      doc.categoryId || DEFAULT_CATEGORY_ID
    )));

    this.setData({
      categoryChooserVisible: true,
      categoryChooserMode: 'move',
      moveDocumentId: '',
      moveDocumentIds: selectedIds,
      moveCategoryId: categoryIds.length === 1 ? categoryIds[0] : '',
      categorySwipeId: '',
      categories: this.data.categories.map((category) => ({
        ...category,
        swipeOffset: 0
      }))
    });

    wx.showLoading({ title: '加载中', mask: true });
    try {
      const categories = await getCategories(this.data.currentUser);
      this.setData({ categories });
    } finally {
      wx.hideLoading();
    }
  },

  async moveDocumentToCategory(categoryId) {
    const docId = this.data.moveDocumentId;
    const docIds = this.data.moveDocumentIds;
    const category = this.data.categories.find((item) => item.id === categoryId);
    if ((!docId && !docIds.length) || !category) {
      return;
    }

    if (categoryId === this.data.moveCategoryId) {
      this.closeCategoryChooser();
      return;
    }

    wx.showLoading({ title: '移动中', mask: true });
    try {
      if (docIds.length) {
        await moveDocumentsCategory(
          this.data.currentUser,
          docIds,
          category.id,
          category.name
        );
      } else {
        await moveDocumentCategory(
          this.data.currentUser,
          docId,
          category.id,
          category.name
        );
      }
      this.setData({
        categoryChooserVisible: false,
        categoryChooserMode: 'manage',
        moveDocumentId: '',
        moveDocumentIds: [],
        moveCategoryId: category.id,
        batchMode: docIds.length ? false : this.data.batchMode,
        selectedIds: docIds.length ? [] : this.data.selectedIds
      });
      await this.loadDocuments(this.data.currentUser, { silent: true });
      this.syncTabBar();
      await waitForNextRenderAsync();
      wx.hideLoading();
      setTimeout(() => {
        wx.showToast({ title: '移动成功', icon: 'success' });
      }, 80);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: '移动失败，请稍后重试', icon: 'none' });
    }
  },

  refreshHomeCategories(categories, preferredCategoryId = this.data.selectedCategoryId) {
    const homeCategories = buildHomeCategories(categories, this.data.allDocs);
    const selectedCategory = homeCategories.find((category) => category.id === preferredCategoryId)
      || getAllCategory();
    const docs = this.getVisibleDocs(
      this.data.allDocs,
      this.data.searchKeyword,
      this.data.selectedIds,
      selectedCategory.id,
      categories
    );
    this.setData({
      categories,
      homeCategories,
      selectedCategoryId: selectedCategory.id,
      docs,
      docGroups: this.buildDocGroups(docs, selectedCategory.id),
      categorySwipeId: '',
      ...this.getBatchSelectionState(docs, this.data.selectedIds)
    }, () => {
      this.syncCategoryMoreVisibility();
    });
  },

  openHomeNewCategoryDialog() {
    this.setData({
      categorySwipeId: '',
      categories: this.data.categories.map((category) => ({
        ...category,
        swipeOffset: 0
      })),
      categoryEditDialogVisible: true,
      categoryEditId: '',
      categoryEditName: '',
      categoryEditFocus: false
    });
    this.focusHomeCategoryDialog();
  },

  openHomeCategoryEditDialog(event) {
    const { id } = event.currentTarget.dataset;
    const category = this.data.homeCategories.find((item) => item.id === id);
    if (!category || category.isDefault) {
      return;
    }

    this.setData({
      categorySwipeId: '',
      homeCategories: this.data.homeCategories.map((item) => ({
        ...item,
        swipeOffset: 0
      })),
      categoryEditDialogVisible: true,
      categoryEditId: id,
      categoryEditName: category.name,
      categoryEditFocus: false
    });
    this.focusHomeCategoryDialog();
  },

  focusHomeCategoryDialog() {
    setTimeout(() => {
      if (this.data.categoryEditDialogVisible) {
        this.setData({ categoryEditFocus: true });
      }
    }, 80);
  },

  closeHomeCategoryDialog() {
    if (this.data.categoryEditSaving) {
      return;
    }

    this.setData({
      categoryEditDialogVisible: false,
      categoryEditId: '',
      categoryEditName: '',
      categoryEditFocus: false
    });
  },

  onHomeCategoryDialogInput(event) {
    const limitedValue = limitCategoryName(event.detail.value || '');
    this.setData({ categoryEditName: limitedValue });
    return limitedValue;
  },

  async confirmHomeCategoryDialog() {
    const id = this.data.categoryEditId;
    const name = String(this.data.categoryEditName || '').trim();
    if (!name || this.data.categoryEditSaving) {
      if (!name) {
        wx.showToast({ title: '请输入分类名称', icon: 'none' });
      }
      return;
    }

    const duplicateCategory = this.data.categories.find((category) =>
      category.id !== id && category.name === name
    );
    if (duplicateCategory) {
      wx.showToast({ title: '分类名称已存在', icon: 'none' });
      return;
    }

    this.setData({ categoryEditSaving: true, categoryEditFocus: false });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const categories = id
        ? await updateCategory(this.data.currentUser, id, name)
        : await createCategory(this.data.currentUser, name);

      this.refreshHomeCategories(categories);
      this.setData({
        categoryEditDialogVisible: false,
        categoryEditId: '',
        categoryEditName: '',
        categoryEditSaving: false
      });
      wx.hideLoading();
      setTimeout(() => {
        wx.showToast({ title: '保存成功', icon: 'success' });
      }, 80);
    } catch (error) {
      this.setData({ categoryEditSaving: false });
      wx.hideLoading();
      wx.showToast({ title: '分类保存失败，请检查云端集合', icon: 'none' });
    }
  },

  confirmHomeDeleteCategory(event) {
    const { id } = event.currentTarget.dataset;
    const category = this.data.homeCategories.find((item) => item.id === id);
    if (!category || category.isDefault) {
      return;
    }

    wx.showModal({
      title: '删除提示',
      content: '被删除分类下如果还有记忆会自动移动到【未分类】，是否确认删除',
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#f55047',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({ title: '删除中', mask: true });
        try {
          const categories = await deleteCategory(this.data.currentUser, id);
          const preferredCategoryId = id === this.data.selectedCategoryId
            ? DEFAULT_CATEGORY_ID
            : this.data.selectedCategoryId;
          this.refreshHomeCategories(categories, preferredCategoryId);
          wx.hideLoading();
          setTimeout(() => {
            wx.showToast({ title: '删除成功', icon: 'success' });
          }, 80);
        } catch (error) {
          wx.hideLoading();
          wx.showToast({ title: '分类删除失败，请检查云端集合', icon: 'none' });
        }
      }
    });
  },

  onHomeCategoryTouchStart(event) {
    if (this.data.categoryChooserMode === 'move') {
      return;
    }
    if (this.data.categoryDragKey) {
      return;
    }

    const { id } = event.currentTarget.dataset;
    const category = this.data.homeCategories.find((item) => item.id === id);
    if (!category || category.isDefault) {
      return;
    }

    this.setData({
      categoryTouchStartX: event.changedTouches[0].clientX,
      categoryTouchMoved: false,
      categorySwipeId: this.data.categorySwipeId && this.data.categorySwipeId !== id ? '' : this.data.categorySwipeId,
      homeCategories: this.data.homeCategories.map((item) => ({
        ...item,
        swipeOffset: item.id === id ? item.swipeOffset || 0 : 0
      }))
    });
  },

  onHomeCategoryTouchMove(event) {
    if (this.data.categoryChooserMode === 'move') {
      return;
    }
    if (this.data.categoryDragKey) {
      return;
    }

    const { id } = event.currentTarget.dataset;
    const category = this.data.homeCategories.find((item) => item.id === id);
    if (!category || category.isDefault) {
      return;
    }

    const moveX = event.changedTouches[0].clientX - this.data.categoryTouchStartX;
    const currentOffset = moveX < 0
      ? Math.min(this.data.categorySwipeMaxOffset, Math.abs(moveX))
      : 0;
    this.setData({
      categoryTouchMoved: Math.abs(moveX) > 6 || this.data.categoryTouchMoved,
      homeCategories: this.data.homeCategories.map((item) => ({
        ...item,
        swipeOffset: item.id === id ? currentOffset : 0
      }))
    });
  },

  onHomeCategoryTouchEnd(event) {
    if (this.data.categoryChooserMode === 'move') {
      return;
    }
    if (this.data.categoryDragKey) {
      return;
    }

    const { id } = event.currentTarget.dataset;
    const category = this.data.homeCategories.find((item) => item.id === id);
    if (!category || category.isDefault) {
      return;
    }

    const moveX = event.changedTouches[0].clientX - this.data.categoryTouchStartX;
    const shouldOpen = moveX < -this.data.categorySwipeThreshold;
    this.setData({
      categorySwipeId: shouldOpen ? id : '',
      homeCategories: this.data.homeCategories.map((item) => ({
        ...item,
        swipeOffset: item.id === id && shouldOpen ? this.data.categorySwipeMaxOffset : 0
      }))
    });

    if (this.homeCategoryTouchGuardTimer) {
      clearTimeout(this.homeCategoryTouchGuardTimer);
    }
    this.homeCategoryTouchGuardTimer = setTimeout(() => {
      this.setData({ categoryTouchMoved: false });
      this.homeCategoryTouchGuardTimer = null;
    }, 180);
  },

  startHomeCategoryDrag(event) {
    if (this.data.categoryChooserMode === 'move') {
      return;
    }

    const { id, index } = event.currentTarget.dataset;
    const dragIndex = Number(index);
    const category = this.data.homeCategories[dragIndex];
    if (!category || category.id !== id || category.isDefault || this.data.categoryDragSaving) {
      return;
    }

    this.setData({
      categoryDragKey: id,
      categoryDragIndex: dragIndex,
      categoryDragStartY: getTouchY(event),
      categoryDragMoved: false,
      categoryDragHoverIndex: dragIndex,
      categorySwipeId: '',
      categoryTouchMoved: true,
      categoryDragBaseList: this.data.homeCategories.map((item) => ({
        ...item,
        swipeOffset: 0,
        dragStyle: ''
      })),
      homeCategories: this.data.homeCategories.map((item) => ({
        ...item,
        swipeOffset: 0,
        dragging: item.id === id,
        dragStyle: ''
      }))
    });
  },

  moveHomeCategoryDrag(event) {
    if (!this.data.categoryDragKey) {
      return;
    }

    const baseList = this.data.categoryDragBaseList.length
      ? this.data.categoryDragBaseList
      : this.data.homeCategories;
    const rowHeight = getCategoryRowHeightPx();
    const offsetY = getTouchY(event) - this.data.categoryDragStartY;
    const rawIndex = this.data.categoryDragIndex + Math.round(offsetY / rowHeight);
    const hoverIndex = Math.max(1, Math.min(baseList.length - 1, rawIndex));
    const moved = hoverIndex !== this.data.categoryDragIndex || Math.abs(offsetY) > 8;
    const nextCategories = buildCategoryDragPreviewItems(
      baseList,
      this.data.categoryDragIndex,
      hoverIndex,
      offsetY,
      rowHeight
    );

    this.setData({
      categoryDragMoved: moved,
      categoryDragHoverIndex: hoverIndex,
      homeCategories: nextCategories
    });
  },

  async endHomeCategoryDrag() {
    if (!this.data.categoryDragKey) {
      return;
    }

    const moved = this.data.categoryDragMoved;
    const baseList = this.data.categoryDragBaseList.length
      ? this.data.categoryDragBaseList
      : this.data.homeCategories;
    const finalIndex = Math.max(1, Math.min(baseList.length - 1, this.data.categoryDragHoverIndex));
    const orderedCategories = moved
      ? moveArrayItem(baseList, this.data.categoryDragIndex, finalIndex)
      : baseList;
    const nextCategories = orderedCategories.map((item) => ({
      ...item,
      dragging: false,
      dragOver: false,
      swipeOffset: 0,
      dragStyle: ''
    }));

    this.setData({
      homeCategories: nextCategories,
      categoryDragKey: '',
      categoryDragIndex: -1,
      categoryDragStartY: 0,
      categoryDragMoved: false,
      categoryDragHoverIndex: -1,
      categoryDragBaseList: []
    });

    if (!moved) {
      setTimeout(() => {
        this.setData({ categoryTouchMoved: false });
      }, 180);
      return;
    }

    this.setData({ categoryDragSaving: true });
    try {
      const categories = await updateCategoryOrder(
        this.data.currentUser,
        nextCategories.map((category) => category.id)
      );
      this.refreshHomeCategories(categories, this.data.selectedCategoryId);
      this.setData({ categoryDragSaving: false });
    } catch (error) {
      this.setData({ categoryDragSaving: false });
      wx.showToast({ title: '分类排序保存失败', icon: 'none' });
    } finally {
      setTimeout(() => {
        this.setData({ categoryTouchMoved: false });
      }, 180);
    }
  },

  openDoc(event) {
    if (this.data.touchMoved) {
      return;
    }

    if (this.data.batchMode) {
      this.toggleDocSelection(event);
      return;
    }

    if (this.data.swipeId) {
      this.closeSwipe();
      return;
    }

    const { id } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/document/index?id=${id}`
    });
  },

  toggleBatch() {
    const nextBatchMode = !this.data.batchMode;
    const selectedIds = [];
    const docs = this.syncDocSelection(selectedIds, this.resetSwipeOffsets());
    this.setData({
      batchMode: nextBatchMode,
      selectedIds,
      swipeId: '',
      docs,
      docGroups: this.buildDocGroups(docs),
      ...this.getBatchSelectionState(docs, selectedIds)
    }, () => {
      this.syncTabBar();
    });
  },

  exitBatchMode() {
    const selectedIds = [];
    const docs = this.syncDocSelection(selectedIds, this.resetSwipeOffsets());
    this.setData({
      batchMode: false,
      selectedIds,
      swipeId: '',
      docs,
      docGroups: this.buildDocGroups(docs),
      ...this.getBatchSelectionState(docs, selectedIds)
    }, () => {
      this.syncTabBar();
    });
  },

  toggleSelectAll() {
    const visibleIds = this.data.docs.map((doc) => doc.id).filter(Boolean);
    if (!visibleIds.length) {
      return;
    }

    const selectedSet = new Set(this.data.selectedIds);
    const allVisibleSelected = visibleIds.every((id) => selectedSet.has(id));

    if (allVisibleSelected) {
      visibleIds.forEach((id) => selectedSet.delete(id));
    } else {
      visibleIds.forEach((id) => selectedSet.add(id));
    }

    const nextSelectedIds = Array.from(selectedSet);
    const docs = this.getVisibleDocs(this.data.allDocs, this.data.searchKeyword, nextSelectedIds, this.data.selectedCategoryId);

    this.setData({
      selectedIds: nextSelectedIds,
      docs,
      docGroups: this.buildDocGroups(docs),
      ...this.getBatchSelectionState(docs, nextSelectedIds)
    });
  },

  toggleDocSelection(event) {
    const { id } = event.currentTarget.dataset;
    if (!id) {
      return;
    }

    const selectedSet = new Set(this.data.selectedIds);
    if (selectedSet.has(id)) {
      selectedSet.delete(id);
    } else {
      selectedSet.add(id);
    }

    const nextSelectedIds = Array.from(selectedSet);
    const docs = this.getVisibleDocs(this.data.allDocs, this.data.searchKeyword, nextSelectedIds, this.data.selectedCategoryId);
    this.setData({
      selectedIds: nextSelectedIds,
      docs,
      docGroups: this.buildDocGroups(docs),
      ...this.getBatchSelectionState(docs, nextSelectedIds)
    });
  },

  async deleteSelected() {
    if (!this.data.selectedIds.length) {
      wx.showToast({ title: '请先选择文件', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认删除',
      content: `确定删除选中的 ${this.data.selectedIds.length} 个文件吗？`,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        const currentUser = this.data.currentUser;
        const selectedIds = this.data.selectedIds.slice();

        wx.showLoading({
          title: '删除中...',
          mask: true
        });

        try {
          await deleteDocuments(currentUser, selectedIds);
          this.exitBatchMode();
          await this.loadDocuments(currentUser, { silent: true });
          this.syncTabBar();
          await waitForNextRenderAsync();
          wx.hideLoading();
        } catch (error) {
          wx.hideLoading();
          wx.showToast({ title: '批量删除失败', icon: 'none' });
        }
      }
    });
  },

  onTouchStart(event) {
    if (this.data.batchMode) {
      return;
    }

    const { id } = event.currentTarget.dataset;
    const hasOpenItem = this.data.swipeId && this.data.swipeId !== id;

    this.setData({
      touchStartX: event.changedTouches[0].clientX,
      touchCurrentX: event.changedTouches[0].clientX,
      touchMoved: false,
      swipeId: hasOpenItem ? '' : this.data.swipeId,
      docs: hasOpenItem ? this.resetSwipeOffsets() : this.data.docs
    });
  },

  onTouchMove(event) {
    if (this.data.batchMode) {
      return;
    }

    const { id } = event.currentTarget.dataset;
    const moveX = event.changedTouches[0].clientX - this.data.touchStartX;
    const moved = Math.abs(moveX) > 6;
    const currentOffset = moveX < 0
      ? Math.min(this.data.swipeMaxOffset, Math.abs(moveX))
      : 0;

    this.setData({
      touchCurrentX: event.changedTouches[0].clientX,
      touchMoved: moved || this.data.touchMoved,
      docs: this.data.docs.map((doc) => ({
        ...doc,
        swipeOffset: doc.id === id ? currentOffset : 0
      }))
    });
  },

  onTouchEnd(event) {
    if (this.data.batchMode) {
      return;
    }

    const { id } = event.currentTarget.dataset;
    const moveX = event.changedTouches[0].clientX - this.data.touchStartX;
    const shouldOpen = moveX < -this.data.swipeThreshold;

    this.setData({
      swipeId: shouldOpen ? id : '',
      docs: this.data.docs.map((doc) => ({
        ...doc,
        swipeOffset: doc.id === id && shouldOpen ? this.data.swipeMaxOffset : 0
      }))
    });

    if (this.touchGuardTimer) {
      clearTimeout(this.touchGuardTimer);
    }

    this.touchGuardTimer = setTimeout(() => {
      this.setData({
        touchMoved: false
      });
      this.touchGuardTimer = null;
    }, 180);
  },

  closeSwipe() {
    if (this.data.touchMoved) {
      return;
    }

    if (this.data.swipeId) {
      this.setData({
        swipeId: '',
        docs: this.resetSwipeOffsets()
      });
    }
  },

  confirmDelete(event) {
    const { id } = event.currentTarget.dataset;
    wx.showModal({
      title: '删除文件',
      content: '删除后无法恢复，确定继续吗？',
      confirmColor: '#1b2129',
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({
          title: '删除中...',
          mask: true
        });

        deleteDocument(this.data.currentUser, id)
          .then(() => this.onShow())
          .catch(() => {
            wx.showToast({ title: '删除失败', icon: 'none' });
          })
          .finally(() => {
            wx.hideLoading();
          });
      }
    });
  },

  noop() {},

  resetSwipeOffsets() {
    return this.data.docs.map((doc) => ({
      ...doc,
      swipeOffset: 0
    }));
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }

    if (this.touchGuardTimer) {
      clearTimeout(this.touchGuardTimer);
      this.touchGuardTimer = null;
    }

    if (this.homeCategoryTouchGuardTimer) {
      clearTimeout(this.homeCategoryTouchGuardTimer);
      this.homeCategoryTouchGuardTimer = null;
    }
  }
}, {
  enableTimeline: true,
  timeline: {
    title: '家物小记｜把家里的说明书、票据和户号都存起来',
    query: {
      entry: TIMELINE_ENTRY
    }
  }
}));
