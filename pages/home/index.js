const { ensureAuth, formatDate } = require('../../utils/page');
const { getDocuments, deleteDocument, deleteDocuments } = require('../../utils/docs');

Page({
  data: {
    currentUser: null,
    docs: [],
    batchMode: false,
    selectedIds: [],
    swipeId: '',
    touchStartX: 0
  },

  onShow() {
    ensureAuth(this, async (user) => {
      try {
        const docs = (await getDocuments(user.id)).map(this.decorateDoc);
        this.setData({
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
      updatedLabel: formatDate(doc.updatedAt)
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
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/editor/index?id=${id}`
    });
  },

  toggleBatch() {
    this.setData({
      batchMode: !this.data.batchMode,
      selectedIds: [],
      swipeId: ''
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

        deleteDocuments(this.data.currentUser.id, this.data.selectedIds)
          .then(() => this.onShow())
          .catch(() => {
            wx.showToast({ title: '批量删除失败', icon: 'none' });
          });
      }
    });
  },

  onTouchStart(event) {
    this.setData({
      touchStartX: event.changedTouches[0].clientX
    });
  },

  onTouchEnd(event) {
    const moveX = event.changedTouches[0].clientX - this.data.touchStartX;
    const { id } = event.currentTarget.dataset;
    this.setData({
      swipeId: moveX < -60 ? id : ''
    });
  },

  closeSwipe() {
    if (this.data.swipeId) {
      this.setData({
        swipeId: ''
      });
    }
  },

  confirmDelete(event) {
    const { id } = event.currentTarget.dataset;
    wx.showModal({
      title: '删除文件',
      content: '删除后无法恢复，确定继续吗？',
      confirmColor: '#be123c',
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        deleteDocument(this.data.currentUser.id, id)
          .then(() => this.onShow())
          .catch(() => {
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
      }
    });
  },

  noop() {}
});
