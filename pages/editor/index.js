const { ensureAuth } = require('../../utils/page');
const { addDocument, getDocumentById, updateDocument } = require('../../utils/docs');
const { createDraftFromScan, refreshDraftFromTask } = require('../../utils/scanner');

Page({
  data: {
    currentUser: null,
    docId: '',
    sourceName: '',
    sourceType: '',
    sourceFileId: '',
    ocrTaskId: '',
    ocrProvider: '',
    ocrStatus: '',
    ocrMessage: '',
    name: '',
    description: '',
    markdown: '',
    mode: 'create',
    isScanning: false
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
          sourceFileId: doc.sourceFileId || '',
          ocrTaskId: doc.ocrTaskId || '',
          ocrProvider: doc.ocrProvider || '',
          ocrStatus: doc.ocrStatus || '',
          ocrMessage: doc.ocrStatus === 'success' ? '识别结果已同步到当前文档' : '',
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

  updateOcrProgress(progress) {
    const nextData = {
      ocrStatus: progress.stage || this.data.ocrStatus
    };

    if (progress.message) {
      nextData.ocrMessage = progress.message;
    }

    if (progress.task) {
      nextData.ocrTaskId = progress.task.id || this.data.ocrTaskId;
      nextData.ocrStatus = progress.task.status || this.data.ocrStatus;
      nextData.ocrProvider = progress.task.provider || this.data.ocrProvider;
    }

    this.setData(nextData);
  },

  async startScan() {
    if (this.data.isScanning) {
      return;
    }

    try {
      this.setData({
        isScanning: true,
        ocrStatus: 'uploading',
        ocrMessage: '正在准备识别任务',
        sourceName: '',
        sourceType: '',
        sourceFileId: '',
        ocrTaskId: '',
        markdown: ''
      });

      const draft = await createDraftFromScan(this.data.currentUser, {
        onProgress: (progress) => this.updateOcrProgress(progress)
      });

      this.setData({
        sourceName: draft.sourceName,
        sourceType: draft.sourceType,
        sourceFileId: draft.sourceFileId || '',
        ocrTaskId: draft.ocrTaskId || '',
        ocrProvider: draft.ocrProvider || '',
        ocrStatus: draft.ocrStatus || 'success',
        ocrMessage: 'OCR 识别完成，已回填 Markdown 草稿',
        name: draft.name,
        description: draft.description,
        markdown: draft.markdown
      });
    } catch (error) {
      if (error && error.code === 'OCR_TASK_TIMEOUT') {
        this.setData({
          ocrTaskId: error.taskId || this.data.ocrTaskId,
          ocrStatus: 'pending',
          ocrMessage: '识别仍在处理中，可稍后点击“查询识别结果”继续获取'
        });
        wx.showToast({ title: '识别中，请稍后刷新', icon: 'none' });
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

      if (error && error.code === 'OCR_MOCK_COMPLETE_FAILED') {
        this.setData({
          ocrStatus: 'failed',
          ocrMessage: error.message || '演示模式回写失败'
        });
        wx.showToast({ title: error.message || '演示模式回写失败', icon: 'none' });
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

      if (error && error.errMsg && !error.errMsg.includes('cancel')) {
        wx.showToast({ title: '扫描或导入失败', icon: 'none' });
      }
    } finally {
      this.setData({
        isScanning: false
      });
    }
  },

  async refreshOcrResult() {
    if (!this.data.ocrTaskId || this.data.isScanning) {
      return;
    }

    try {
      this.setData({
        isScanning: true,
        ocrMessage: '正在查询 OCR 结果',
        ocrStatus: this.data.ocrStatus || 'pending'
      });

      const draft = await refreshDraftFromTask(this.data.currentUser, this.data.ocrTaskId, {
        source: {
          fileName: this.data.sourceName,
          type: this.data.sourceType
        },
        onProgress: (progress) => this.updateOcrProgress(progress)
      });

      this.setData({
        sourceName: draft.sourceName,
        sourceType: draft.sourceType,
        sourceFileId: draft.sourceFileId || '',
        ocrTaskId: draft.ocrTaskId || '',
        ocrProvider: draft.ocrProvider || '',
        ocrStatus: draft.ocrStatus || 'success',
        ocrMessage: 'OCR 识别完成，已回填最新结果',
        name: this.data.name || draft.name,
        description: draft.description,
        markdown: draft.markdown
      });
      wx.showToast({ title: '已同步识别结果', icon: 'success' });
    } catch (error) {
      if (error && error.code === 'OCR_TASK_TIMEOUT') {
        this.setData({
          ocrStatus: 'pending',
          ocrMessage: '识别仍在处理中，请稍后再试'
        });
        wx.showToast({ title: '结果未完成', icon: 'none' });
      } else if (error && error.code === 'OCR_TASK_FAILED') {
        this.setData({
          ocrStatus: 'failed',
          ocrMessage: error.message || 'OCR 识别失败'
        });
        wx.showToast({ title: error.message || 'OCR 识别失败', icon: 'none' });
      } else {
        wx.showToast({ title: '查询识别结果失败', icon: 'none' });
      }
    } finally {
      this.setData({
        isScanning: false
      });
    }
  },

  async saveDocument() {
    const {
      currentUser,
      docId,
      mode,
      name,
      description,
      markdown,
      sourceName,
      sourceType,
      sourceFileId,
      ocrTaskId,
      ocrProvider,
      ocrStatus,
      isScanning
    } = this.data;

    if (isScanning) {
      wx.showToast({ title: 'OCR 处理中，请稍候', icon: 'none' });
      return;
    }

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
          sourceType,
          sourceFileId,
          ocrTaskId,
          ocrProvider,
          ocrStatus
        });
      } else {
        await addDocument(currentUser.id, {
          name: name.trim(),
          description: description.trim(),
          markdown,
          sourceName,
          sourceType,
          sourceFileId,
          ocrTaskId,
          ocrProvider,
          ocrStatus
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
