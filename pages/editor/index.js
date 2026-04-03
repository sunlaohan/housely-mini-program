const { ensureAuth } = require('../../utils/page');
const { addDocument, getDocumentById, updateDocument } = require('../../utils/docs');
const { createDraftFromScan } = require('../../utils/scanner');

Page({
  data: {
    currentUser: null,
    docId: '',
    sourceName: '',
    sourceType: '',
    name: '',
    description: '',
    markdown: '',
    mode: 'create'
  },

  onShow() {
    ensureAuth(this);
  },

  onLoad(options) {
    ensureAuth(this, async (user) => {
      if (!options.id) {
        return;
      }

      try {
        const doc = await getDocumentById(user.id, options.id);
        if (!doc) {
          wx.showToast({ title: '文件不存在', icon: 'none' });
          return;
        }

        this.setData({
          docId: doc.id,
          sourceName: doc.sourceName || '',
          sourceType: doc.sourceType || '',
          name: doc.name,
          description: doc.description,
          markdown: doc.markdown,
          mode: 'edit'
        });

        wx.setNavigationBarTitle({
          title: '编辑 Markdown'
        });
      } catch (error) {
        wx.showToast({ title: '加载文件失败', icon: 'none' });
      }
    });
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [field]: event.detail.value
    });
  },

  async startScan() {
    try {
      wx.showLoading({
        title: '生成草稿中'
      });
      const draft = await createDraftFromScan();
      this.setData({
        sourceName: draft.sourceName,
        sourceType: draft.sourceType,
        name: draft.name,
        description: draft.description,
        markdown: draft.markdown
      });
    } catch (error) {
      if (error && error.errMsg && !error.errMsg.includes('cancel')) {
        wx.showToast({ title: '扫描或导入失败', icon: 'none' });
      }
    } finally {
      wx.hideLoading();
    }
  },

  async saveDocument() {
    const { currentUser, docId, mode, name, description, markdown, sourceName, sourceType } = this.data;
    if (!name || !markdown) {
      wx.showToast({ title: '请先生成并完善 Markdown 内容', icon: 'none' });
      return;
    }

    try {
      if (mode === 'edit') {
        await updateDocument(currentUser.id, docId, {
          name: name.trim(),
          description: description.trim(),
          markdown,
          sourceName,
          sourceType
        });
      } else {
        await addDocument(currentUser.id, {
          name: name.trim(),
          description: description.trim(),
          markdown,
          sourceName,
          sourceType
        });
      }

      wx.showToast({ title: mode === 'edit' ? '已更新' : '已保存', icon: 'success' });
      setTimeout(() => {
        wx.switchTab({
          url: '/pages/home/index'
        });
      }, 500);
    } catch (error) {
      wx.showToast({ title: '保存失败，请检查数据表', icon: 'none' });
    }
  }
});
