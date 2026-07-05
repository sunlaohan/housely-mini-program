const { ensureAuth, formatDate } = require('../../utils/page');
const { getDocuments, deleteDocument, deleteDocuments } = require('../../utils/docs');
const { withPageShare } = require('../../utils/share');
const { getCurrentUser } = require('../../utils/account');
const { KEYS, read, write } = require('../../utils/storage');
const {
  DEFAULT_CATEGORY_ID,
  getCategories,
  getCategoryByIdFromList,
  getDefaultCategory
} = require('../../utils/categories');

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
    categoryName: String(doc && doc.categoryName || '默认分类').trim() || '默认分类',
    coverFileId: getDocCoverFileId(doc),
    coverUrl: '',
    previewText: buildDocPreview(doc),
    titleRichText: escapeHtml(doc.name || ''),
    searchScore: 0
  };
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

Page(withPageShare({
  data: {
    currentUser: null,
    shareEntry: '',
    shareLandingVisible: false,
    shareHighlights: SHARE_HIGHLIGHTS,
    shareScenes: SHARE_SCENES,
    categories: [getDefaultCategory()],
    selectedCategoryId: DEFAULT_CATEGORY_ID,
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
    swipeMaxOffset: 114
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
        selectedCategoryId: DEFAULT_CATEGORY_ID,
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

    const categories = await getCategories(currentUser);
    this.setData({
      shareLandingVisible: false,
      categories,
      isLoadingDocs: !this.data.allDocs.length && !this.data.docs.length
    }, () => {
      this.syncCategoryMoreVisibility();
    });
    this.syncTabBar();
    ensureAuth(this, async (user) => {
      await this.loadDocuments(user);
    });
  },

  async onListRefresh() {
    const currentUser = getCurrentUser();
    if (!currentUser || this.data.shareLandingVisible) {
      this.setData({ contentRefreshing: false });
      return;
    }

    this.setData({ contentRefreshing: true });

    try {
      await this.loadDocuments(currentUser, { silent: true });
    } finally {
      this.setData({ contentRefreshing: false });
    }
  },

  async loadDocuments(user, options = {}) {
    const { silent = false } = options;

    try {
      const docs = await this.hydrateDocCovers((await getDocuments(user)).map(this.decorateDoc));
      const categories = await getCategories(user);
      const currentCategory = getCategoryByIdFromList(categories, this.data.selectedCategoryId);
      const existingIds = new Set(docs.map((doc) => doc.id));
      const selectedIds = this.data.selectedIds.filter((id) => existingIds.has(id));
      const visibleDocs = this.getVisibleDocs(docs, this.data.searchKeyword, selectedIds, currentCategory.id, categories);
      const batchSelection = this.getBatchSelectionState(visibleDocs, selectedIds);
      this.setData({
        currentUser: user,
        categories,
        selectedCategoryId: currentCategory.id,
        allDocs: docs,
        selectedIds,
        docs: visibleDocs,
        swipeId: '',
        isLoadingDocs: false,
        contentRefreshing: false,
        ...batchSelection
      }, () => {
        this.syncCategoryMoreVisibility();
      });
      getApp().setCurrentUser(user);
    } catch (error) {
      this.setData({
        isLoadingDocs: false,
        contentRefreshing: false
      });
      wx.showToast({ title: silent ? '刷新失败' : '加载文档失败', icon: 'none' });
    }
  },

  syncCategoryMoreVisibility() {
    if (!this.data.allDocs.length || !this.data.categories || this.data.categories.length <= 1) {
      this.setData({
        showCategoryMore: false,
        categoryHasOverflow: false
      });
      return;
    }

    const query = wx.createSelectorQuery().in(this);
    query.select('.home-category-wrap').boundingClientRect();
    query.select('.home-category-tabs__inner').boundingClientRect();
    query.exec((result) => {
      const wrapRect = result && result[0];
      const innerRect = result && result[1];
      const fallbackVisible = this.data.categories.length > 3;

      if (!wrapRect || !innerRect) {
        this.setData({
          showCategoryMore: fallbackVisible,
          categoryHasOverflow: fallbackVisible
        });
        return;
      }

      const wrapWidth = wrapRect.width || 0;
      const innerWidth = Math.max(0, (innerRect.width || 0) - 32);
      const hasOverflow = innerWidth > wrapWidth + 4;
      const maxScrollLeft = Math.max(0, innerWidth - wrapWidth);
      const hasMoreOnRight = hasOverflow && this.data.categoryScrollLeft < maxScrollLeft - 4;

      this.setData({
        categoryHasOverflow: hasOverflow,
        categoryWrapWidth: wrapWidth,
        categoryScrollWidth: innerWidth,
        showCategoryMore: hasMoreOnRight
      });
    });
  },

  updateCategoryMoreVisibility(scrollLeft = this.data.categoryScrollLeft, scrollWidth = this.data.categoryScrollWidth) {
    const wrapWidth = this.data.categoryWrapWidth || 0;
    const fullWidth = Math.max(0, (scrollWidth || this.data.categoryScrollWidth || 0) - 32);
    const maxScrollLeft = Math.max(0, fullWidth - wrapWidth);
    const hasOverflow = Boolean(wrapWidth && fullWidth > wrapWidth + 4);

    this.setData({
      categoryScrollLeft: Math.max(0, scrollLeft),
      categoryScrollWidth: fullWidth,
      categoryHasOverflow: hasOverflow,
      showCategoryMore: hasOverflow && scrollLeft < maxScrollLeft - 4
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

  getVisibleDocs(
    allDocs = this.data.allDocs,
    keyword = this.data.searchKeyword,
    selectedIds = this.data.selectedIds,
    selectedCategoryId = this.data.selectedCategoryId,
    categories = this.data.categories
  ) {
    const normalizedKeyword = normalizeKeyword(keyword);
    const categoryId = selectedCategoryId || DEFAULT_CATEGORY_ID;
    const knownCategoryIds = new Set((categories || []).map((category) => category.id));
    const categoryDocs = allDocs.filter((doc) => {
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
      ...this.getBatchSelectionState(docs, this.data.selectedIds)
    });
  },

  cancelSearch() {
    this.clearSearch();
  },

  goAdd() {
    wx.navigateTo({
      url: '/pages/editor/index'
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

    const lastCategory = this.data.categories[this.data.categories.length - 1] || null;
    const isLastCategory = Boolean(lastCategory && lastCategory.id === id);
    const docs = this.getVisibleDocs(this.data.allDocs, this.data.searchKeyword, this.data.selectedIds, id);
    this.setData({
      selectedCategoryId: id,
      categoryChooserVisible: false,
      categoryScrollIntoView: isLastCategory ? '' : `category-tab-${id}`,
      categoryScrollTargetLeft: isLastCategory ? 99999 : this.data.categoryScrollLeft,
      showCategoryMore: isLastCategory ? false : this.data.showCategoryMore,
      docs,
      swipeId: '',
      ...this.getBatchSelectionState(docs, this.data.selectedIds)
    }, () => {
      setTimeout(() => {
        this.syncCategoryMoreVisibility();
      }, 120);
    });
  },

  openCategoryChooser() {
    this.closeSwipe();
    this.setData({
      categoryChooserVisible: true
    });
  },

  closeCategoryChooser() {
    this.setData({
      categoryChooserVisible: false
    });
  },

  chooseCategoryFromSheet(event) {
    const { id } = event.currentTarget.dataset;
    this.applyCategory(id);
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
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({
          title: '删除中...',
          mask: true
        });

        deleteDocuments(this.data.currentUser, this.data.selectedIds)
          .then(() => {
            this.exitBatchMode();
            this.onShow();
          })
          .catch(() => {
            wx.showToast({ title: '批量删除失败', icon: 'none' });
          })
          .finally(() => {
            wx.hideLoading();
          });
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
