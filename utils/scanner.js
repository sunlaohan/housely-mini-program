const ocrConfig = require('../config/ocr');

function sleep(duration) {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

function buildTaskError(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function makeCloudPath(userId, fileName) {
  const safeName = (fileName || 'scan-file').replace(/[^\w.\-\u4e00-\u9fa5]/g, '-');
  return `ocr/${userId}/${Date.now()}-${safeName}`;
}

function buildDescription(sourceType, summary) {
  if (summary) {
    return summary;
  }

  return sourceType === 'image' ? '来自图片扫描生成' : '来自文件导入生成';
}

function toDraftFromTask(task, source, fileId) {
  const baseName = (task.sourceName || source.fileName || '未命名扫描件').replace(/\.[^.]+$/, '');

  return {
    sourceType: task.sourceType || source.type,
    sourceName: task.sourceName || source.fileName,
    sourcePath: source.tempFilePath,
    sourceFileId: fileId || task.sourceFileId || '',
    ocrTaskId: task.id,
    ocrStatus: task.status,
    ocrProvider: task.provider || ocrConfig.provider,
    name: baseName,
    description: buildDescription(task.sourceType || source.type, task.summary),
    markdown: task.markdown || ''
  };
}

async function callOcr(action, payload = {}) {
  const result = await wx.cloud.callFunction({
    name: 'ocr',
    data: {
      action,
      ...payload
    }
  });

  return result.result || {};
}

function chooseSource() {
  return new Promise((resolve, reject) => {
    wx.showActionSheet({
      itemList: ['扫描图片', '导入文件'],
      success: (sheetRes) => {
        if (sheetRes.tapIndex === 0) {
          wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType: ['camera', 'album'],
            success: (res) => resolve({
              type: 'image',
              fileName: res.tempFiles[0].tempFilePath.split('/').pop(),
              tempFilePath: res.tempFiles[0].tempFilePath,
              size: res.tempFiles[0].size || 0
            }),
            fail: reject
          });
          return;
        }

        wx.chooseMessageFile({
          count: 1,
          type: 'file',
          success: (res) => resolve({
            type: 'file',
            fileName: res.tempFiles[0].name,
            tempFilePath: res.tempFiles[0].path,
            size: res.tempFiles[0].size || 0
          }),
          fail: reject
        });
      },
      fail: reject
    });
  });
}

async function uploadSourceToCloud(source, userId) {
  const cloudPath = makeCloudPath(userId, source.fileName);
  const result = await wx.cloud.uploadFile({
    cloudPath,
    filePath: source.tempFilePath
  });

  return {
    fileID: result.fileID,
    cloudPath
  };
}

async function getTask(taskId, userId) {
  const result = await callOcr('getTask', {
    taskId,
    userId
  });

  if (!result.ok || !result.task) {
    throw buildTaskError(result.message || 'OCR 任务查询失败', 'OCR_TASK_QUERY_FAILED');
  }

  return result.task;
}

async function triggerTaskProcessing(taskId, userId, options = {}) {
  const { onProgress } = options;

  if (typeof onProgress === 'function') {
    onProgress({
      stage: 'processing',
      message: 'OCR 任务已创建，正在请求识别服务'
    });
  }

  const result = await callOcr('processTask', {
    taskId,
    userId
  });

  if (!result.ok && !result.task) {
    throw buildTaskError(result.message || 'OCR 任务处理失败', 'OCR_PROCESS_FAILED');
  }

  return result.task || null;
}

async function pollTaskResult(taskId, userId, options = {}) {
  const maxAttempts = options.maxAttempts || ocrConfig.maxPollAttempts;
  const interval = options.interval || ocrConfig.pollInterval;
  const onProgress = options.onProgress;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const task = await getTask(taskId, userId);

    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'polling',
        message: `正在识别文档（第 ${attempt}/${maxAttempts} 次检查）`,
        task
      });
    }

    if (task.status === 'success') {
      return task;
    }

    if (task.status === 'failed') {
      throw buildTaskError(task.errorMessage || 'OCR 识别失败', 'OCR_TASK_FAILED', {
        task
      });
    }

    await sleep(interval);
  }

  throw buildTaskError('OCR 识别仍在处理中，请稍后重试', 'OCR_TASK_TIMEOUT', {
    taskId
  });
}

async function createDraftFromScan(currentUser, options = {}) {
  if (!currentUser || !currentUser.id) {
    throw buildTaskError('未获取到当前登录用户', 'AUTH_REQUIRED');
  }

  const { onProgress } = options;
  const source = await chooseSource();

  if (typeof onProgress === 'function') {
    onProgress({
      stage: 'uploading',
      message: '文件已选择，正在上传到云存储',
      source
    });
  }

  const uploaded = await uploadSourceToCloud(source, currentUser.id);
  const created = await callOcr('createTask', {
    userId: currentUser.id,
    sourceName: source.fileName,
    sourceType: source.type,
    sourceFileId: uploaded.fileID,
    sourceCloudPath: uploaded.cloudPath,
    fileSize: source.size
  });

  if (!created.ok || !created.task) {
    throw buildTaskError(created.message || 'OCR 任务创建失败', 'OCR_TASK_CREATE_FAILED');
  }

  if (typeof onProgress === 'function') {
    onProgress({
      stage: 'created',
      message: 'OCR 任务已创建，正在等待识别结果',
      task: created.task
    });
  }

  const processingTask = await triggerTaskProcessing(created.task.id, currentUser.id, { onProgress });
  const task = processingTask && processingTask.status === 'success'
    ? processingTask
    : await pollTaskResult(created.task.id, currentUser.id, { onProgress });
  return toDraftFromTask(task, source, uploaded.fileID);
}

async function refreshDraftFromTask(currentUser, taskId, options = {}) {
  if (!currentUser || !currentUser.id || !taskId) {
    throw buildTaskError('缺少 OCR 任务信息', 'OCR_TASK_INVALID');
  }

  const { onProgress, source = {} } = options;
  const task = await pollTaskResult(taskId, currentUser.id, { onProgress });
  return toDraftFromTask(task, source, task.sourceFileId);
}

module.exports = {
  createDraftFromScan,
  refreshDraftFromTask
};
