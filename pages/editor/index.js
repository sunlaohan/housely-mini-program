const { ensureAuth } = require('../../utils/page');
const { getCurrentUser } = require('../../utils/account');
const { addDocument, getDocumentById, updateDocument } = require('../../utils/docs');
const { chooseImageSources, createDraftFromSources, uploadSourcesForStorage } = require('../../utils/scanner');
const { checkDocumentContent } = require('../../utils/content-safety');
const { withPageShare } = require('../../utils/share');
const { KEYS, read, write } = require('../../utils/storage');
const {
  DEFAULT_CATEGORY_ID,
  createCategory,
  deleteCategory,
  getCategoryByIdFromList,
  getCategories,
  getDefaultCategory,
  updateCategory,
  updateCategoryOrder
} = require('../../utils/categories');

const CATEGORY_NAME_MAX_LENGTH = 16;

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 20;
  const windowWidth = systemInfo.windowWidth || 375;

  if (!wx.getMenuButtonBoundingClientRect) {
    return {
      statusBarHeight,
      navBarHeight: 44,
      navSafeHeight: statusBarHeight + 44,
      capsuleSafeWidth: 88
    };
  }

  const menuRect = wx.getMenuButtonBoundingClientRect();
  const navBarHeight = (menuRect.top - statusBarHeight) * 2 + menuRect.height;

  return {
    statusBarHeight,
    navBarHeight,
    navSafeHeight: statusBarHeight + navBarHeight,
    capsuleSafeWidth: windowWidth - menuRect.left + 8
  };
}

function normalizePageSource(source, index = 0) {
  const tempFilePath = String(source && source.tempFilePath || '').trim();
  const fileId = String(source && (source.fileId || source.sourceFileId) || '').trim();

  return {
    key: String(source && source.key || '').trim() || fileId || tempFilePath || `source-${Date.now()}-${index}`,
    fileName: String(source && (source.fileName || source.sourceName || source.name) || '').trim() || `图片-${index + 1}.jpg`,
    type: String(source && (source.type || source.sourceType) || 'image').trim() || 'image',
    size: Number(source && (source.size || source.fileSize) || 0) || 0,
    tempFilePath,
    previewUrl: String(source && source.previewUrl || '').trim() || tempFilePath,
    fileId,
    cloudPath: String(source && (source.cloudPath || source.sourceCloudPath) || '').trim()
  };
}

function normalizePageSources(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .map((source, index) => normalizePageSource(source, index))
    .filter((source) => source.fileId || source.tempFilePath || source.previewUrl);
}

function buildSourceDisplayName(sourceFiles) {
  if (!sourceFiles.length) {
    return '';
  }

  const firstName = sourceFiles[0].fileName || '未命名扫描件';
  if (sourceFiles.length === 1) {
    return firstName;
  }

  return `${firstName.replace(/\.[^.]+$/, '')} 等${sourceFiles.length}张图片`;
}

function getPrimarySource(sourceFiles) {
  return sourceFiles[0] || null;
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

function buildDragPreviewItems(sourceFiles, rects, sourceIndex, hoverIndex, offsetX, offsetY) {
  if (sourceIndex < 0 || hoverIndex < 0 || !rects.length) {
    return sourceFiles;
  }

  return sourceFiles.map((source, index) => {
    let dragStyle = '';

    if (index === sourceIndex) {
      dragStyle = `transform: translate(${offsetX}px, ${offsetY}px) scale(1.06); z-index: 3;`;
    } else if (hoverIndex > sourceIndex && index > sourceIndex && index <= hoverIndex) {
      const fromRect = rects[index] || {};
      const toRect = rects[index - 1] || {};
      dragStyle = `transform: translate(${(toRect.left || 0) - (fromRect.left || 0)}px, ${(toRect.top || 0) - (fromRect.top || 0)}px) scale(0.98);`;
    } else if (hoverIndex < sourceIndex && index >= hoverIndex && index < sourceIndex) {
      const fromRect = rects[index] || {};
      const toRect = rects[index + 1] || {};
      dragStyle = `transform: translate(${(toRect.left || 0) - (fromRect.left || 0)}px, ${(toRect.top || 0) - (fromRect.top || 0)}px) scale(0.98);`;
    } else {
      dragStyle = 'transform: scale(0.98);';
    }

    return {
      ...source,
      dragStyle
    };
  });
}

function clearDragPreviewItems(sourceFiles) {
  return sourceFiles.map((source) => ({
    ...source,
    dragStyle: ''
  }));
}

function cacheCoverPreview(sourceFiles, targetDocId = '') {
  const coverSource = (Array.isArray(sourceFiles) ? sourceFiles : []).find((source) => {
    const fileId = String(source && source.fileId || '').trim();
    const type = String(source && source.type || 'image').trim();
    const previewUrl = String(source && source.previewUrl || source.tempFilePath || '').trim();
    return fileId && type === 'image' && previewUrl;
  });

  if (targetDocId && !coverSource) {
    const docCovers = read(KEYS.DOC_COVERS, {}) || {};
    docCovers[targetDocId] = {
      coverFileId: '',
      coverUrl: ''
    };
    write(KEYS.DOC_COVERS, docCovers);
    return;
  }

  if (!coverSource) {
    return;
  }

  const coverUrl = coverSource.previewUrl || coverSource.tempFilePath;
  const coverUrls = read(KEYS.COVER_URLS, {}) || {};
  coverUrls[coverSource.fileId] = coverUrl;
  write(KEYS.COVER_URLS, coverUrls);

  if (targetDocId) {
    const docCovers = read(KEYS.DOC_COVERS, {}) || {};
    docCovers[targetDocId] = {
      coverFileId: coverSource.fileId,
      coverUrl
    };
    write(KEYS.DOC_COVERS, docCovers);
  }
}

function toStoredSources(sourceFiles) {
  return sourceFiles.map((source) => ({
    fileName: source.fileName,
    type: source.type,
    fileId: source.fileId || '',
    cloudPath: source.cloudPath || '',
    fileSize: source.size || 0
  })).filter((source) => source.fileId);
}

function getOcrFallbackMessage(error) {
  const text = String(error && (error.errMsg || error.message) || '');
  if (text.includes('FUNCTIONS_TIME_LIMIT_EXCEEDED') || text.includes('timed out') || text.includes('timeout')) {
    return '识别时间较长，请稍后重试';
  }

  return '识别失败，请稍后重试';
}

function getCategoryNameFromList(categories = [], categoryId = DEFAULT_CATEGORY_ID) {
  const category = categories.find((item) => item.id === categoryId);
  return category ? category.name : '默认分类';
}

function getCategoryByNameFromList(categories = [], name = '') {
  const normalizedName = String(name || '').trim();
  return categories.find((category) => category.name === normalizedName) || null;
}

function limitCategoryName(value = '') {
  return Array.from(String(value || '')).slice(0, CATEGORY_NAME_MAX_LENGTH).join('');
}

Page(withPageShare({
  data: {
    currentUser: null,
    pageTitle: '添加',
    statusBarHeight: 20,
    navBarHeight: 44,
    navSafeHeight: 64,
    capsuleSafeWidth: 88,
    maxSourceCount: 9,
    docId: '',
    sourceFiles: [],
    sourceName: '',
    sourceType: '',
    sourceFileId: '',
    ocrTaskId: '',
    ocrProvider: '',
    ocrStatus: '',
    ocrMessage: '',
    categories: [getDefaultCategory()],
    selectedCategoryId: DEFAULT_CATEGORY_ID,
    selectedCategoryName: '默认分类',
    categoryPanelVisible: false,
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
    name: '',
    description: '',
    markdown: '',
    markdownFocused: false,
    markdownInputDisabled: false,
    editorBodyBottomPadding: 220,
    editorKeyboardSpacerHeight: 220,
    mode: 'create',
    isScanning: false,
    isSaving: false,
    dragSourceKey: '',
    dragSourceIndex: -1,
    dragHoverIndex: -1,
    dragActive: false,
    dragMoved: false,
    dragStartX: 0,
    dragStartY: 0,
    dragRects: []
  },

  async onShow() {
    const currentUser = getCurrentUser();
    const categories = await getCategories(currentUser);
    const selectedCategory = getCategoryByIdFromList(categories, this.data.selectedCategoryId);
    this.setData({
      currentUser,
      categories,
      selectedCategoryId: selectedCategory.id,
      selectedCategoryName: selectedCategory.name
    });

    if (this.data.mode === 'edit') {
      ensureAuth(this);
    }
  },

  async refreshCategories(selectedCategoryId = this.data.selectedCategoryId) {
    const categories = await getCategories(this.data.currentUser);
    const selectedCategory = getCategoryByIdFromList(categories, selectedCategoryId);
    this.setData({
      categories,
      selectedCategoryId: selectedCategory.id,
      selectedCategoryName: selectedCategory.name
    });
    return categories;
  },

  async openCategoryPanel() {
    this.setData({
      categoryPanelVisible: true,
      categorySwipeId: '',
      categories: this.data.categories.map((category) => ({
        ...category,
        swipeOffset: 0,
        editing: false,
        focus: false
      }))
    });

    wx.showLoading({ title: '加载中', mask: true });
    try {
      await this.refreshCategories();
    } finally {
      wx.hideLoading();
    }
  },

  closeCategoryPanel() {
    this.setData({
      categoryPanelVisible: false,
      categories: this.data.categories.map((category) => ({
        ...category,
        swipeOffset: 0,
        editing: false,
        focus: false
      })),
      categorySwipeId: ''
    });
  },

  selectCategory(event) {
    if (this.data.categoryTouchMoved) {
      return;
    }

    const { id } = event.currentTarget.dataset;
    const category = this.data.categories.find((item) => item.id === id) || getDefaultCategory();
    this.setData({
      selectedCategoryId: category.id,
      selectedCategoryName: category.name,
      categoryPanelVisible: false,
      categorySwipeId: '',
      categories: this.data.categories.map((item) => ({
        ...item,
        swipeOffset: 0
      }))
    });
  },

  openNewCategoryDialog() {
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

    setTimeout(() => {
      if (this.data.categoryEditDialogVisible) {
        this.setData({ categoryEditFocus: true });
      }
    }, 80);
  },

  openCategoryEditDialog(event) {
    const { id } = event.currentTarget.dataset;
    const category = this.data.categories.find((item) => item.id === id);
    if (!category || category.isDefault) {
      return;
    }

    this.setData({
      categorySwipeId: '',
      categories: this.data.categories.map((category) => ({
        ...category,
        swipeOffset: 0
      })),
      categoryEditDialogVisible: true,
      categoryEditId: id,
      categoryEditName: category.name,
      categoryEditFocus: false
    });

    setTimeout(() => {
      if (this.data.categoryEditDialogVisible) {
        this.setData({ categoryEditFocus: true });
      }
    }, 80);
  },

  closeCategoryEditDialog() {
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

  onCategoryDialogInput(event) {
    const value = event.detail.value || '';
    const limitedValue = limitCategoryName(value);
    this.setData({ categoryEditName: limitedValue });
    return limitedValue;
  },

  async confirmCategoryEdit() {
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
      const createdCategory = id ? null : getCategoryByNameFromList(categories, name);
      const selectedCategoryId = createdCategory
        ? createdCategory.id
        : this.data.selectedCategoryId;
      const selectedCategoryName = createdCategory
        ? createdCategory.name
        : (id === this.data.selectedCategoryId
          ? getCategoryNameFromList(categories, id)
          : this.data.selectedCategoryName);

      this.setData({
        categories,
        selectedCategoryId,
        selectedCategoryName,
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

  confirmDeleteCategory(event) {
    const { id } = event.currentTarget.dataset;
    const category = this.data.categories.find((item) => item.id === id);
    if (!category || category.isDefault) {
      return;
    }

    wx.showModal({
      title: '删除提示',
      content: '被删除分类下如果还有记忆会自动移动到【默认分类】，是否确认删除',
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
          const selectedCategory = id === this.data.selectedCategoryId
            ? getDefaultCategory()
            : getCategoryByIdFromList(categories, this.data.selectedCategoryId);

          this.setData({
            categories,
            selectedCategoryId: selectedCategory.id,
            selectedCategoryName: selectedCategory.name,
            categorySwipeId: ''
          });
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

  noop() {},

  onCategoryTouchStart(event) {
    if (this.data.categoryDragKey) {
      return;
    }

    const { id } = event.currentTarget.dataset;
    const category = this.data.categories.find((item) => item.id === id);
    if (!category || category.isDefault || category.editing) {
      return;
    }

    this.setData({
      categoryTouchStartX: event.changedTouches[0].clientX,
      categoryTouchMoved: false,
      categorySwipeId: this.data.categorySwipeId && this.data.categorySwipeId !== id ? '' : this.data.categorySwipeId,
      categories: this.data.categories.map((item) => ({
        ...item,
        swipeOffset: item.id === id ? item.swipeOffset || 0 : 0
      }))
    });
  },

  onCategoryTouchMove(event) {
    if (this.data.categoryDragKey) {
      return;
    }

    const { id } = event.currentTarget.dataset;
    const category = this.data.categories.find((item) => item.id === id);
    if (!category || category.isDefault || category.editing) {
      return;
    }

    const moveX = event.changedTouches[0].clientX - this.data.categoryTouchStartX;
    const currentOffset = moveX < 0
      ? Math.min(this.data.categorySwipeMaxOffset, Math.abs(moveX))
      : 0;

    this.setData({
      categoryTouchMoved: Math.abs(moveX) > 6 || this.data.categoryTouchMoved,
      categories: this.data.categories.map((item) => ({
        ...item,
        swipeOffset: item.id === id ? currentOffset : 0
      }))
    });
  },

  onCategoryTouchEnd(event) {
    if (this.data.categoryDragKey) {
      return;
    }

    const { id } = event.currentTarget.dataset;
    const category = this.data.categories.find((item) => item.id === id);
    if (!category || category.isDefault || category.editing) {
      return;
    }

    const moveX = event.changedTouches[0].clientX - this.data.categoryTouchStartX;
    const shouldOpen = moveX < -this.data.categorySwipeThreshold;

    this.setData({
      categorySwipeId: shouldOpen ? id : '',
      categories: this.data.categories.map((item) => ({
        ...item,
        swipeOffset: item.id === id && shouldOpen ? this.data.categorySwipeMaxOffset : 0
      }))
    });

    if (this.categoryTouchGuardTimer) {
      clearTimeout(this.categoryTouchGuardTimer);
    }

    this.categoryTouchGuardTimer = setTimeout(() => {
      this.setData({ categoryTouchMoved: false });
      this.categoryTouchGuardTimer = null;
    }, 180);
  },

  startCategoryDrag(event) {
    const { id, index } = event.currentTarget.dataset;
    const dragIndex = Number(index);
    const category = this.data.categories[dragIndex];
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
      categoryDragBaseList: this.data.categories.map((item) => ({
        ...item,
        swipeOffset: 0,
        dragStyle: ''
      })),
      categories: this.data.categories.map((item) => ({
        ...item,
        swipeOffset: 0,
        dragging: item.id === id,
        dragStyle: ''
      }))
    });
  },

  moveCategoryDrag(event) {
    if (!this.data.categoryDragKey) {
      return;
    }

    const baseList = this.data.categoryDragBaseList.length
      ? this.data.categoryDragBaseList
      : this.data.categories;
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
      categories: nextCategories
    });
  },

  async endCategoryDrag() {
    if (!this.data.categoryDragKey) {
      return;
    }

    const moved = this.data.categoryDragMoved;
    const baseList = this.data.categoryDragBaseList.length
      ? this.data.categoryDragBaseList
      : this.data.categories;
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
      categories: nextCategories,
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
      const selectedCategory = getCategoryByIdFromList(categories, this.data.selectedCategoryId);
      this.setData({
        categories,
        selectedCategoryId: selectedCategory.id,
        selectedCategoryName: selectedCategory.name,
        categoryDragSaving: false
      });
    } catch (error) {
      this.setData({ categoryDragSaving: false });
      wx.showToast({ title: '分类排序保存失败', icon: 'none' });
    } finally {
      setTimeout(() => {
        this.setData({ categoryTouchMoved: false });
      }, 180);
    }
  },

  onLoad(options) {
    this.setData(getNavMetrics());
    if (options.id) {
      this.setData({ pageTitle: '编辑' });
    }

    if (!options.id) {
      const currentUser = getCurrentUser();
      this.setData({
        currentUser
      });
      return;
    }

    ensureAuth(this, async (user) => {
      try {
        const doc = await getDocumentById(user, options.id);
        if (!doc) {
          wx.showToast({ title: '文件不存在', icon: 'none' });
          return;
        }

        const sourceFiles = await this.hydrateSourceFiles(doc.sourceFiles || []);
        const categories = await getCategories(user);
        const selectedCategory = getCategoryByIdFromList(categories, doc.categoryId || DEFAULT_CATEGORY_ID);
        this.setData({
          docId: doc.id,
          sourceFiles,
          sourceName: doc.sourceName || buildSourceDisplayName(sourceFiles),
          sourceType: doc.sourceType || 'image',
          sourceFileId: doc.sourceFileId || (getPrimarySource(sourceFiles) && getPrimarySource(sourceFiles).fileId) || '',
          ocrTaskId: doc.ocrTaskId || '',
          ocrProvider: doc.ocrProvider || '',
          ocrStatus: doc.ocrStatus || '',
          ocrMessage: doc.ocrStatus === 'success' ? '识别结果已同步到当前文档' : '',
          categories,
          selectedCategoryId: selectedCategory.id,
          selectedCategoryName: selectedCategory.name,
          name: doc.name,
          description: doc.description,
          markdown: doc.markdown,
          mode: 'edit'
        });
      } catch (error) {
        wx.showToast({ title: '加载文件失败', icon: 'none' });
      }
    });
  },

  async hydrateSourceFiles(sourceFiles) {
    const normalizedSources = normalizePageSources(sourceFiles);
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

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    const detail = event.detail || {};
    const value = typeof detail === 'object' && detail !== null && Object.prototype.hasOwnProperty.call(detail, 'value')
      ? detail.value
      : detail;

    if (!field) {
      return;
    }

    this.setData({
      [field]: value
    });
  },

  applySourceFiles(sourceFiles, extraData = {}) {
    const normalizedSources = normalizePageSources(sourceFiles);
    const primarySource = getPrimarySource(normalizedSources);

    this.setData({
      sourceFiles: normalizedSources,
      sourceName: buildSourceDisplayName(normalizedSources),
      sourceType: primarySource ? primarySource.type : '',
      sourceFileId: primarySource ? primarySource.fileId : '',
      ...extraData
    });
  },

  startSourceDrag(event) {
    if (this.data.isScanning || this.data.isSaving || this.data.sourceFiles.length < 2) {
      return;
    }

    const { key, index } = event.currentTarget.dataset;
    const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
    const dragSourceIndex = Number(index);
    const query = wx.createSelectorQuery().in(this);

    query.selectAll('.editor-upload-preview').boundingClientRect();
    query.exec((result) => {
      const rects = result && result[0] ? result[0] : [];

      this.setData({
        dragSourceKey: key,
        dragSourceIndex,
        dragHoverIndex: dragSourceIndex,
        dragActive: true,
        dragMoved: false,
        dragStartX: touch ? touch.clientX : 0,
        dragStartY: touch ? touch.clientY : 0,
        dragRects: rects
      });
    });
  },

  onSourceDragMove(event) {
    if (!this.data.dragActive) {
      return;
    }

    const touch = event.touches && event.touches[0];
    if (!touch) {
      return;
    }

    const rects = this.data.dragRects || [];
    const targetIndex = rects.findIndex((rect) =>
      touch.clientX >= rect.left &&
      touch.clientX <= rect.right &&
      touch.clientY >= rect.top &&
      touch.clientY <= rect.bottom
    );
    const nextHoverIndex = targetIndex >= 0 ? targetIndex : this.data.dragHoverIndex;
    const offsetX = touch.clientX - this.data.dragStartX;
    const offsetY = touch.clientY - this.data.dragStartY;
    const sourceFiles = buildDragPreviewItems(
      this.data.sourceFiles,
      rects,
      this.data.dragSourceIndex,
      nextHoverIndex,
      offsetX,
      offsetY
    );

    this.setData({
      sourceFiles,
      dragHoverIndex: nextHoverIndex,
      dragMoved: true
    });
  },

  endSourceDrag() {
    if (!this.data.dragActive) {
      return;
    }

    const fromIndex = this.data.dragSourceIndex;
    const toIndex = this.data.dragHoverIndex;
    const nextSourceFiles = clearDragPreviewItems(
      this.data.dragMoved && toIndex >= 0
        ? moveArrayItem(this.data.sourceFiles, fromIndex, toIndex)
        : this.data.sourceFiles
    );

    this.applySourceFiles(nextSourceFiles, {
      dragSourceKey: '',
      dragSourceIndex: -1,
      dragHoverIndex: -1,
      dragActive: false,
      dragStartX: 0,
      dragStartY: 0,
      dragRects: []
    });

    if (this.data.dragMoved) {
      setTimeout(() => {
        this.setData({ dragMoved: false });
      }, 120);
    }
  },

  onMarkdownFocus(event) {
    if (this.data.markdownInputDisabled) {
      wx.hideKeyboard();
      setTimeout(() => {
        wx.hideKeyboard();
      }, 80);
      this.restoreEditorFooter();
      return;
    }

    const keyboardHeight = Number(event.detail && event.detail.height) || 0;
    this.applyMarkdownKeyboardHeight(keyboardHeight);
  },

  onMarkdownBlur() {
    this.restoreEditorFooter();
  },

  onMarkdownKeyboardHeightChange(event) {
    const keyboardHeight = Number(event.detail && event.detail.height) || 0;
    if (keyboardHeight <= 0) {
      this.restoreEditorFooter();
      return;
    }

    this.applyMarkdownKeyboardHeight(keyboardHeight);
  },

  prepareFooterAction() {
    this.temporarilyDisableMarkdownInput();
    wx.hideKeyboard();
    setTimeout(() => {
      wx.hideKeyboard();
    }, 80);
    this.restoreEditorFooter();
  },

  temporarilyDisableMarkdownInput(duration = 900) {
    if (this.markdownInputRestoreTimer) {
      clearTimeout(this.markdownInputRestoreTimer);
      this.markdownInputRestoreTimer = null;
    }

    this.setData({ markdownInputDisabled: true });

    if (!duration) {
      return;
    }

    this.markdownInputRestoreTimer = setTimeout(() => {
      this.markdownInputRestoreTimer = null;
      if (!this._isSaving && !this.data.isSaving) {
        this.setData({ markdownInputDisabled: false });
      }
    }, duration);
  },

  restoreMarkdownInput() {
    if (this.markdownInputRestoreTimer) {
      clearTimeout(this.markdownInputRestoreTimer);
      this.markdownInputRestoreTimer = null;
    }

    if (this.data.markdownInputDisabled) {
      this.setData({ markdownInputDisabled: false });
    }
  },

  restoreEditorFooter() {
    if (this.markdownScrollTimer) {
      clearTimeout(this.markdownScrollTimer);
      this.markdownScrollTimer = null;
    }

    this.setData({
      markdownFocused: false,
      editorBodyBottomPadding: 220,
      editorKeyboardSpacerHeight: 220
    });
  },

  applyMarkdownKeyboardHeight(keyboardHeight = 0) {
    const safeHeight = Math.max(0, keyboardHeight);
    const bottomSpace = safeHeight ? safeHeight + 120 : 420;

    this.setData({
      markdownFocused: true,
      editorBodyBottomPadding: bottomSpace,
      editorKeyboardSpacerHeight: bottomSpace
    }, () => {
      this.scrollMarkdownIntoView(safeHeight);
    });
  },

  scrollMarkdownIntoView(keyboardHeight = 0) {
    if (this.markdownScrollTimer) {
      clearTimeout(this.markdownScrollTimer);
    }

    this.markdownScrollTimer = setTimeout(() => {
      const systemInfo = wx.getSystemInfoSync();
      const visibleBottom = (systemInfo.windowHeight || 0) - keyboardHeight - 24;
      const query = wx.createSelectorQuery();

      query.select('.editor-field-card--textarea').boundingClientRect();
      query.selectViewport().scrollOffset();
      query.exec((result) => {
        const rect = result && result[0];
        const viewport = result && result[1];

        if (!rect || !viewport || !visibleBottom) {
          return;
        }

        const minTop = this.data.navSafeHeight + 12;
        let nextScrollTop = viewport.scrollTop;

        if (rect.bottom > visibleBottom) {
          nextScrollTop += rect.bottom - visibleBottom + 24;
        } else if (rect.top < minTop) {
          nextScrollTop -= minTop - rect.top;
        }

        wx.pageScrollTo({
          scrollTop: Math.max(0, nextScrollTop),
          duration: 180
        });
      });
    }, 180);
  },

  updateOcrProgress(progress) {
    const nextData = {
      ocrStatus: progress.stage || this.data.ocrStatus
    };

    if (['uploading', 'created', 'processing', 'polling'].includes(progress.stage)) {
      nextData.isScanning = true;
    }

    if (progress.task) {
      nextData.ocrTaskId = progress.task.id || this.data.ocrTaskId;
      nextData.ocrStatus = progress.task.status || this.data.ocrStatus;
      nextData.ocrProvider = progress.task.provider || this.data.ocrProvider;
    }

    this.setData(nextData);
  },

  async pickImages() {
    if (this.data.isScanning) {
      return;
    }

    const remainCount = this.data.maxSourceCount - this.data.sourceFiles.length;
    if (remainCount <= 0) {
      wx.showToast({ title: `最多上传 ${this.data.maxSourceCount} 张图片`, icon: 'none' });
      return;
    }

    try {
      const pickedSources = await chooseImageSources(remainCount);
      if (!pickedSources.length) {
        return;
      }

      const nextSources = await this.hydrateSourceFiles(this.data.sourceFiles.concat(pickedSources));
      const hasRecognizedContent = Boolean(this.data.markdown || this.data.ocrTaskId);

      this.applySourceFiles(nextSources, {
        ocrTaskId: '',
        ocrProvider: '',
        ocrStatus: '',
        ocrMessage: hasRecognizedContent ? '图片已更新，请重新识别内容' : ''
      });
    } catch (error) {
      if (error && error.code === 'OCR_IMAGE_TOO_LARGE') {
        wx.showToast({ title: error.message || '图片过大，请压缩后再上传', icon: 'none' });
        return;
      }

      if (error && error.errMsg && !error.errMsg.includes('cancel')) {
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      }
    }
  },

  async startScan() {
    if (this.data.isScanning) {
      return;
    }

    if (!this.data.sourceFiles.length) {
      wx.showToast({ title: '请先上传图片', icon: 'none' });
      return;
    }

    const primarySource = getPrimarySource(this.data.sourceFiles);

    try {
      wx.showLoading({
        title: '识别中...',
        mask: true
      });

      this.setData({
        isScanning: true,
        ocrStatus: 'preparing',
        ocrMessage: '',
        sourceName: buildSourceDisplayName(this.data.sourceFiles),
        sourceType: primarySource ? primarySource.type : 'image',
        sourceFileId: primarySource ? primarySource.fileId : '',
        ocrTaskId: '',
        ocrProvider: ''
      });

      const draft = await createDraftFromSources(this.data.currentUser, this.data.sourceFiles, {
        onProgress: (progress) => this.updateOcrProgress(progress)
      });
      const sourceFiles = await this.hydrateSourceFiles(draft.sourceFiles || []);

      if (draft.noText) {
        this.setData({
          sourceFiles,
          sourceName: draft.sourceName,
          sourceType: draft.sourceType,
          sourceFileId: draft.sourceFileId || '',
          ocrTaskId: draft.ocrTaskId || '',
          ocrProvider: draft.ocrProvider || '',
          ocrStatus: draft.ocrStatus || 'success',
          ocrMessage: '未识别到文字'
        });
        setTimeout(() => {
          wx.showToast({
            title: '未识别到文字，但你可以自己随便写点',
            icon: 'none',
            duration: 2000
          });
        }, 80);
        return;
      }

      this.setData({
        sourceFiles,
        sourceName: draft.sourceName,
        sourceType: draft.sourceType,
        sourceFileId: draft.sourceFileId || '',
        ocrTaskId: draft.ocrTaskId || '',
        ocrProvider: draft.ocrProvider || '',
        ocrStatus: draft.ocrStatus || 'success',
        ocrMessage: 'OCR 识别完成，已回填识别内容',
        name: this.data.name || draft.name,
        description: draft.description,
        markdown: draft.markdown
      });
    } catch (error) {
      if (error && error.code === 'OCR_SOURCE_REQUIRED') {
        wx.showToast({ title: error.message || '请先上传图片', icon: 'none' });
        return;
      }

      if (error && error.code === 'OCR_TASK_TIMEOUT') {
        this.setData({
          ocrTaskId: error.taskId || this.data.ocrTaskId,
          ocrStatus: 'pending',
          ocrMessage: ''
        });
        wx.showToast({ title: '识别时间较长，请稍后重试', icon: 'none' });
        return;
      }

      if (error && error.code === 'OCR_TASK_FAILED') {
        this.setData({
          ocrStatus: 'failed',
          ocrMessage: error.message || 'OCR 识别失败'
        });
        wx.showToast({ title: error.message || 'OCR 识别失败', icon: 'none' });
        return;
      }

      if (error && error.code === 'OCR_PROCESS_FAILED') {
        this.setData({
          ocrStatus: 'failed',
          ocrMessage: error.message || 'OCR 服务处理失败'
        });
        wx.showToast({ title: error.message || 'OCR 服务处理失败', icon: 'none' });
        return;
      }

      if (error && error.code === 'OCR_TASK_CREATE_FAILED') {
        this.setData({
          ocrStatus: 'failed',
          ocrMessage: error.message || 'OCR 任务创建失败'
        });
        wx.showToast({ title: error.message || 'OCR 任务创建失败', icon: 'none' });
        return;
      }

      if (error && error.code === 'AUTH_REQUIRED') {
        this.setData({
          ocrStatus: 'failed',
          ocrMessage: error.message || '请先登录后再试'
        });
        wx.showToast({ title: error.message || '请先登录后再试', icon: 'none' });
        return;
      }

      if (error && error.errMsg && !error.errMsg.includes('cancel')) {
        wx.showToast({ title: getOcrFallbackMessage(error), icon: 'none' });
        return;
      }

      wx.showToast({ title: getOcrFallbackMessage(error), icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({
        isScanning: false
      });
    }
  },

  previewSource(event) {
    if (this.data.dragActive || this.data.dragMoved) {
      return;
    }

    const { key } = event.currentTarget.dataset;
    const currentSource = this.data.sourceFiles.find((source) => source.key === key);
    const previewUrls = this.data.sourceFiles
      .map((source) => source.previewUrl)
      .filter(Boolean);

    if (!currentSource || !currentSource.previewUrl || !previewUrls.length) {
      return;
    }

    wx.previewImage({
      current: currentSource.previewUrl,
      urls: previewUrls
    });
  },

  async removeSource(event) {
    if (this.data.isScanning) {
      return;
    }

    const { key } = event.currentTarget.dataset;
    const sourceFiles = normalizePageSources(this.data.sourceFiles.filter((source) => source.key !== key));
    const hasRecognizedContent = Boolean(this.data.markdown || this.data.ocrTaskId);

    this.applySourceFiles(sourceFiles, {
      ocrTaskId: '',
      ocrProvider: '',
      ocrStatus: '',
      ocrMessage: sourceFiles.length && hasRecognizedContent ? '图片已更新，请重新识别内容' : ''
    });
  },

  async saveDocument() {
    if (this._isSaving) {
      return;
    }

    this.temporarilyDisableMarkdownInput(0);
    wx.hideKeyboard();
    setTimeout(() => {
      wx.hideKeyboard();
    }, 80);
    setTimeout(() => {
      wx.hideKeyboard();
    }, 220);
    if (this.data.markdownFocused) {
      this.restoreEditorFooter();
    }

    const {
      currentUser,
      docId,
      mode,
      name,
      description,
      markdown,
      sourceFiles,
      ocrTaskId,
      ocrProvider,
      ocrStatus,
      selectedCategoryId,
      selectedCategoryName,
      isScanning,
      isSaving
    } = this.data;

    if (isScanning) {
      this.restoreMarkdownInput();
      wx.showToast({ title: 'OCR 处理中，请稍候', icon: 'none' });
      return;
    }

    if (isSaving) {
      this.restoreMarkdownInput();
      wx.showToast({ title: '正在保存，请稍候', icon: 'none' });
      return;
    }

    if (!currentUser) {
      this.restoreMarkdownInput();
      wx.showToast({ title: '请先登录后保存', icon: 'none' });
      setTimeout(() => {
        wx.switchTab({
          url: '/pages/profile/index'
        });
      }, 500);
      return;
    }

    const trimmedName = String(name || '').trim();
    const normalizedDescription = String(description || '').trim();
    const normalizedMarkdown = String(markdown || '');

    if (!trimmedName) {
      this.restoreMarkdownInput();
      wx.showToast({ title: '请填写记忆名称', icon: 'none' });
      return;
    }

    try {
      this._isSaving = true;
      this.setData({ isSaving: true });

      const uploadedSourceFiles = await uploadSourcesForStorage(currentUser, sourceFiles);
      const storedSources = toStoredSources(uploadedSourceFiles);
      const primarySource = getPrimarySource(storedSources);
      const nextSourceName = buildSourceDisplayName(uploadedSourceFiles);
      const nextSourceType = primarySource ? primarySource.type : '';
      const nextSourceFileId = primarySource ? primarySource.fileId : '';

      this.setData({
        sourceFiles: uploadedSourceFiles,
        sourceName: nextSourceName,
        sourceType: nextSourceType,
        sourceFileId: nextSourceFileId
      });

      await checkDocumentContent({
        name: trimmedName,
        description: normalizedDescription,
        markdown: normalizedMarkdown,
        sourceFiles: storedSources
      });

      if (mode === 'edit') {
        const savedDoc = await updateDocument(currentUser, docId, {
          name: trimmedName,
          description: normalizedDescription,
          markdown: normalizedMarkdown,
          sourceFiles: storedSources,
          sourceName: buildSourceDisplayName(storedSources),
          sourceType: nextSourceType,
          sourceFileId: nextSourceFileId,
          sourceCloudPath: primarySource ? primarySource.cloudPath : '',
          categoryId: selectedCategoryId || DEFAULT_CATEGORY_ID,
          categoryName: selectedCategoryName || '默认分类',
          ocrTaskId,
          ocrProvider,
          ocrStatus
        });
        cacheCoverPreview(uploadedSourceFiles, savedDoc && savedDoc.id ? savedDoc.id : docId);
      } else {
        const savedDoc = await addDocument(currentUser, {
          name: trimmedName,
          description: normalizedDescription,
          markdown: normalizedMarkdown,
          sourceFiles: storedSources,
          sourceName: buildSourceDisplayName(storedSources),
          sourceType: nextSourceType,
          sourceFileId: nextSourceFileId,
          sourceCloudPath: primarySource ? primarySource.cloudPath : '',
          categoryId: selectedCategoryId || DEFAULT_CATEGORY_ID,
          categoryName: selectedCategoryName || '默认分类',
          ocrTaskId,
          ocrProvider,
          ocrStatus
        });
        cacheCoverPreview(uploadedSourceFiles, savedDoc && savedDoc.id);
      }

      write(KEYS.PENDING_HOME_CATEGORY_ID, selectedCategoryId || DEFAULT_CATEGORY_ID);
      wx.showToast({ title: mode === 'edit' ? '已更新' : '已保存', icon: 'success' });
      setTimeout(() => {
        wx.switchTab({
          url: '/pages/home/index'
        });
      }, 500);
    } catch (error) {
      if (error && error.code === 'CONTENT_RISKY') {
        wx.showModal({
          title: '内容需修改',
          content: error.message || '内容含有不合规信息，请修改后再保存',
          showCancel: false
        });
        return;
      }

      if (error && error.code === 'CONTENT_CHECK_FAILED') {
        console.warn('content safety check failed', error.result || error.originalError || error);
        wx.showModal({
          title: '保存失败',
          content: error.message || '内容安全校验失败，请稍后再试',
          showCancel: false
        });
        return;
      }

      wx.showToast({ title: '保存失败，请检查数据表', icon: 'none' });
    } finally {
      this._isSaving = false;
      this.setData({
        isSaving: false,
        markdownInputDisabled: false
      });
    }
  },

  onUnload() {
    if (this.markdownScrollTimer) {
      clearTimeout(this.markdownScrollTimer);
      this.markdownScrollTimer = null;
    }

    if (this.categoryTouchGuardTimer) {
      clearTimeout(this.categoryTouchGuardTimer);
      this.categoryTouchGuardTimer = null;
    }

    if (this.markdownInputRestoreTimer) {
      clearTimeout(this.markdownInputRestoreTimer);
      this.markdownInputRestoreTimer = null;
    }
  }
}));
