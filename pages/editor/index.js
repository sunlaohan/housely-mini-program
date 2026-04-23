const { ensureAuth } = require('../../utils/page');
const { addDocument, getDocumentById, updateDocument } = require('../../utils/docs');
const { chooseImageSources, createDraftFromSources, refreshDraftFromTask } = require('../../utils/scanner');
const { withPageShare } = require('../../utils/share');

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

function toStoredSources(sourceFiles) {
  return sourceFiles.map((source) => ({
    fileName: source.fileName,
    type: source.type,
    fileId: source.fileId || '',
    cloudPath: source.cloudPath || '',
    fileSize: source.size || 0
  })).filter((source) => source.fileId);
}

Page(withPageShare({
  data: {
    currentUser: null,
    pageTitle: '添加',
    statusBarHeight: 20,
    navBarHeight: 44,
    capsuleSafeWidth: 88,
    maxSourceCount: 6,
    docId: '',
    sourceFiles: [],
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
    isScanning: false,
    isSaving: false
  },

  onShow() {
    ensureAuth(this);
  },

  onLoad(options) {
    this.setData(getNavMetrics());
    if (options.id) {
      this.setData({ pageTitle: '编辑' });
    }

    ensureAuth(this, async (user) => {
      if (!options.id) {
        return;
      }

      try {
        const doc = await getDocumentById(user, options.id);
        if (!doc) {
          wx.showToast({ title: '文件不存在', icon: 'none' });
          return;
        }

        const sourceFiles = await this.hydrateSourceFiles(doc.sourceFiles || []);
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
    this.setData({
      [field]: event.detail.value
    });
  },

  updateOcrProgress(progress) {
    const nextData = {
      ocrStatus: progress.stage || this.data.ocrStatus
    };

    if (['uploading', 'created', 'processing', 'polling'].includes(progress.stage)) {
      nextData.isScanning = true;
    }

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
      const primarySource = getPrimarySource(nextSources);
      const hasRecognizedContent = Boolean(this.data.markdown || this.data.ocrTaskId);

      this.setData({
        sourceFiles: nextSources,
        sourceName: buildSourceDisplayName(nextSources),
        sourceType: primarySource ? primarySource.type : '',
        sourceFileId: primarySource ? primarySource.fileId : '',
        ocrTaskId: '',
        ocrProvider: '',
        ocrStatus: '',
        ocrMessage: hasRecognizedContent ? '图片已更新，请重新识别内容' : '',
        description: '',
        markdown: ''
      });
    } catch (error) {
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
      this.setData({
        isScanning: true,
        ocrStatus: 'preparing',
        ocrMessage: '正在准备识别内容',
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
        wx.showToast({ title: error.errMsg || '识别失败，请稍后重试', icon: 'none' });
        return;
      }

      wx.showToast({ title: (error && error.message) || '识别失败，请稍后重试', icon: 'none' });
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
        sources: this.data.sourceFiles,
        onProgress: (progress) => this.updateOcrProgress(progress)
      });
      const sourceFiles = await this.hydrateSourceFiles(draft.sourceFiles || this.data.sourceFiles);

      this.setData({
        sourceFiles,
        sourceName: draft.sourceName,
        sourceType: draft.sourceType,
        sourceFileId: draft.sourceFileId || '',
        ocrTaskId: draft.ocrTaskId || '',
        ocrProvider: draft.ocrProvider || '',
        ocrStatus: draft.ocrStatus || 'success',
        ocrMessage: 'OCR 识别完成，已回填最新识别内容',
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

  previewSource(event) {
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
    const primarySource = getPrimarySource(sourceFiles);
    const hasRecognizedContent = Boolean(this.data.markdown || this.data.ocrTaskId);

    this.setData({
      sourceFiles,
      sourceName: buildSourceDisplayName(sourceFiles),
      sourceType: primarySource ? primarySource.type : '',
      sourceFileId: primarySource ? primarySource.fileId : '',
      ocrTaskId: '',
      ocrProvider: '',
      ocrStatus: '',
      ocrMessage: sourceFiles.length && hasRecognizedContent ? '图片已更新，请重新识别内容' : '',
      description: '',
      markdown: ''
    });
  },

  async saveDocument() {
    if (this._isSaving) {
      return;
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
      isScanning,
      isSaving
    } = this.data;

    if (isScanning) {
      wx.showToast({ title: 'OCR 处理中，请稍候', icon: 'none' });
      return;
    }

    if (isSaving) {
      wx.showToast({ title: '正在保存，请稍候', icon: 'none' });
      return;
    }

    if (!name || !markdown) {
      wx.showToast({ title: '请先生成并完善识别内容', icon: 'none' });
      return;
    }

    const storedSources = toStoredSources(sourceFiles);
    const primarySource = getPrimarySource(storedSources);

    try {
      this._isSaving = true;
      this.setData({ isSaving: true });

      if (mode === 'edit') {
        await updateDocument(currentUser, docId, {
          name: name.trim(),
          description: description.trim(),
          markdown,
          sourceFiles: storedSources,
          sourceName: buildSourceDisplayName(storedSources),
          sourceType: primarySource ? primarySource.type : '',
          sourceFileId: primarySource ? primarySource.fileId : '',
          sourceCloudPath: primarySource ? primarySource.cloudPath : '',
          ocrTaskId,
          ocrProvider,
          ocrStatus
        });
      } else {
        await addDocument(currentUser, {
          name: name.trim(),
          description: description.trim(),
          markdown,
          sourceFiles: storedSources,
          sourceName: buildSourceDisplayName(storedSources),
          sourceType: primarySource ? primarySource.type : '',
          sourceFileId: primarySource ? primarySource.fileId : '',
          sourceCloudPath: primarySource ? primarySource.cloudPath : '',
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
    } finally {
      this._isSaving = false;
      this.setData({ isSaving: false });
    }
  }
}));
