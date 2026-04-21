const { ensureAuth, formatDate } = require('../../utils/page');
const { getDocuments, deleteDocument, deleteDocuments } = require('../../utils/docs');

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
    previewText: buildDocPreview(doc),
    titleRichText: escapeHtml(doc.name || ''),
    searchScore: 0
  };
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

Page({
  data: {
    currentUser: null,
    allDocs: [],
    docs: [],
    searchKeyword: '',
    searchLoading: false,
    batchMode: false,
    selectedIds: [],
    swipeId: '',
    touchStartX: 0,
    touchCurrentX: 0,
    swipeThreshold: 28,
    swipeMaxOffset: 114
  },

  onShow() {
    this.syncTabBar();
    ensureAuth(this, async (user) => {
      try {
        const docs = (await getDocuments(user)).map(this.decorateDoc);
        const visibleDocs = this.getVisibleDocs(docs, this.data.searchKeyword);
        this.setData({
          currentUser: user,
          allDocs: docs,
          docs: visibleDocs
        });
        getApp().setCurrentUser(user);
      } catch (error) {
        wx.showToast({ title: '加载文档失败', icon: 'none' });
      }
    });
  },

  syncTabBar() {
    if (typeof this.getTabBar !== 'function') {
      return;
    }

    const tabBar = this.getTabBar();
    if (tabBar && typeof tabBar.setData === 'function') {
      tabBar.setData({
        selected: 0,
        hidden: this.data.batchMode
      });
    }
  },

  decorateDoc(doc) {
    return {
      ...buildSearchableDoc(doc),
      createdLabel: formatDate(doc.createdAt),
      updatedLabel: formatDate(doc.updatedAt),
      selected: false,
      swipeOffset: 0
    };
  },

  syncDocSelection(selectedIds = this.data.selectedIds, docs = this.data.docs) {
    const selectedSet = new Set(selectedIds);
    return docs.map((doc) => ({
      ...doc,
      selected: selectedSet.has(doc.id)
    }));
  },

  getVisibleDocs(allDocs = this.data.allDocs, keyword = this.data.searchKeyword) {
    const normalizedKeyword = normalizeKeyword(keyword);
    const baseDocs = this.syncDocSelection(this.data.selectedIds, allDocs);

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
      this.setData({
        searchLoading: false,
        docs: this.getVisibleDocs(this.data.allDocs, '')
      });
      return;
    }

    this.setData({ searchLoading: true });

    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.setData({
        searchLoading: false,
        docs: this.getVisibleDocs(this.data.allDocs, normalizedKeyword)
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

    this.setData({
      searchKeyword: '',
      searchLoading: false,
      docs: this.getVisibleDocs(this.data.allDocs, '')
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

  openDoc(event) {
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
    this.setData({
      batchMode: !this.data.batchMode,
      selectedIds: [],
      swipeId: '',
      docs: this.syncDocSelection([], this.resetSwipeOffsets())
    }, () => {
      this.syncTabBar();
    });
  },

  exitBatchMode() {
    this.setData({
      batchMode: false,
      selectedIds: [],
      swipeId: '',
      docs: this.syncDocSelection([], this.resetSwipeOffsets())
    }, () => {
      this.syncTabBar();
    });
  },

  toggleSelectAll() {
    const allIds = this.data.docs.map((doc) => doc.id);
    const shouldSelectAll = this.data.selectedIds.length !== allIds.length;
    const nextSelectedIds = shouldSelectAll ? allIds : [];

    this.setData({
      selectedIds: nextSelectedIds,
      docs: this.getVisibleDocs(this.data.allDocs, this.data.searchKeyword)
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
    this.setData({
      selectedIds: nextSelectedIds,
      docs: this.getVisibleDocs(this.data.allDocs, this.data.searchKeyword)
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

        deleteDocuments(this.data.currentUser, this.data.selectedIds)
          .then(() => {
            this.exitBatchMode();
            this.onShow();
          })
          .catch(() => {
            wx.showToast({ title: '批量删除失败', icon: 'none' });
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
    const currentOffset = moveX < 0
      ? Math.min(this.data.swipeMaxOffset, Math.abs(moveX))
      : 0;

    this.setData({
      touchCurrentX: event.changedTouches[0].clientX,
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
  },

  closeSwipe() {
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

        deleteDocument(this.data.currentUser, id)
          .then(() => this.onShow())
          .catch(() => {
            wx.showToast({ title: '删除失败', icon: 'none' });
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
  }
});
