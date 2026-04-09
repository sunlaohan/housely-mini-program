const { ensureAuth, formatDate } = require('../../utils/page');
const { getDocuments, deleteDocument, deleteDocuments } = require('../../utils/docs');

Page({
  data: {
    currentUser: null,
    docs: [],
    batchMode: false,
    selectedIds: [],
    swipeId: '',
    touchStartX: 0,
    touchCurrentX: 0,
    swipeThreshold: 88,
    swipeMaxOffset: 144
  },

  onShow() {
    ensureAuth(this, async (user) => {
      try {
        const docs = (await getDocuments(user)).map(this.decorateDoc);
        this.setData({
          currentUser: user,
          docs
        });
        getApp().setCurrentUser(user);
      } catch (error) {
        wx.showToast({ title: '加载文档失败', icon: 'none' });
      }
    });
  },

  decorateDoc(doc) {
    return {
      ...doc,
      createdLabel: formatDate(doc.createdAt),
      updatedLabel: formatDate(doc.updatedAt),
      swipeOffset: 0
    };
  },

  goAdd() {
    wx.navigateTo({
      url: '/pages/editor/index'
    });
  },

  openDoc(event) {
    if (this.data.batchMode) {
      return;
    }

    if (this.data.swipeId) {
      this.closeSwipe();
      return;
    }

    const { id } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/editor/index?id=${id}`
    });
  },

  toggleBatch() {
    this.setData({
      batchMode: !this.data.batchMode,
      selectedIds: [],
      swipeId: '',
      docs: this.resetSwipeOffsets()
    });
  },

  onSelectChange(event) {
    this.setData({
      selectedIds: event.detail.value
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
          .then(() => this.onShow())
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
  }
});
