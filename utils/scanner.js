const ocrConfig = require('../config/ocr');
const { getCurrentUser } = require('./account');

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

function isCloudFunctionTimeout(error) {
  const errMsg = error && error.errMsg ? String(error.errMsg) : '';
  const message = error && error.message ? String(error.message) : '';
  return errMsg.includes('timeout') || message.includes('timeout');
}

function sanitizeCloudPathSegment(value, fallback = 'anonymous') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^\w\-\u4e00-\u9fa5]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || fallback;
}

function makeCloudPath(ownerKey, fileName, index = 0) {
  const safeName = (fileName || 'scan-file').replace(/[^\w.\-\u4e00-\u9fa5]/g, '-');
  const safeOwnerKey = sanitizeCloudPathSegment(ownerKey, 'anonymous');
  const suffix = index > 0 ? `-${index}` : '';
  return `ocr/${safeOwnerKey}/${Date.now()}${suffix}-${safeName}`;
}

function buildDescription(summary, sourceCount) {
  if (summary) {
    return summary;
  }

  return sourceCount > 1 ? `来自${sourceCount}张图片扫描生成` : '来自图片扫描生成';
}

function buildImageSourceName(tempFilePath, index = 0) {
  const matchedExt = (tempFilePath || '').match(/\.(jpg|jpeg|png|webp|bmp|heic)$/i);
  const extension = matchedExt ? matchedExt[0].toLowerCase() : '.jpg';
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join('') + '-' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
  const suffix = index > 0 ? `-${index + 1}` : '';

  return `图片扫描-${stamp}${suffix}${extension}`;
}

function normalizeSourceItem(source, index = 0) {
  const tempFilePath = String(source && source.tempFilePath || '').trim();
  const fileId = String(source && (source.fileId || source.fileID || source.sourceFileId) || '').trim();
  const cloudPath = String(source && (source.cloudPath || source.sourceCloudPath) || '').trim();
  const previewUrl = String(source && source.previewUrl || '').trim() || tempFilePath;
  const fileName = String(
    source && (
      source.fileName ||
      source.sourceName ||
      source.name ||
      (tempFilePath ? buildImageSourceName(tempFilePath, index) : '')
    ) || ''
  ).trim() || `图片-${index + 1}.jpg`;

  return {
    key: String(source && source.key || '').trim() || fileId || tempFilePath || `source-${Date.now()}-${index}`,
    fileName,
    type: String(source && (source.type || source.sourceType) || 'image').trim() || 'image',
    size: Number(source && (source.size || source.fileSize) || 0) || 0,
    tempFilePath,
    previewUrl,
    fileId,
    cloudPath
  };
}

function normalizeSourceList(sources = [], fallbackRecord = {}) {
  const list = Array.isArray(sources) ? sources : [];
  const normalized = list
    .map((source, index) => normalizeSourceItem(source, index))
    .filter((source) => source.fileId || source.tempFilePath);

  if (normalized.length) {
    return normalized;
  }

  const legacySource = normalizeSourceItem({
    fileName: fallbackRecord.sourceName,
    type: fallbackRecord.sourceType,
    fileId: fallbackRecord.sourceFileId,
    cloudPath: fallbackRecord.sourceCloudPath
  });

  return legacySource.fileId ? [legacySource] : [];
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

function toDraftFromTask(task, sources = []) {
  const sourceFiles = normalizeSourceList(sources, task);
  const sourceName = task.sourceName || buildSourceDisplayName(sourceFiles);
  const baseName = sourceName.replace(/\.[^.]+$/, '') || '未命名扫描件';

  return {
    sourceFiles,
    sourceType: task.sourceType || (sourceFiles[0] && sourceFiles[0].type) || 'image',
    sourceName,
    sourceFileId: task.sourceFileId || (sourceFiles[0] && sourceFiles[0].fileId) || '',
    ocrTaskId: task.id,
    ocrStatus: task.status,
    ocrProvider: task.provider || ocrConfig.provider,
    name: baseName,
    description: buildDescription(task.summary, sourceFiles.length || 1),
    markdown: task.markdown || ''
  };
}

function buildSingleTaskPayload(ownerKey, legacyUserId, source) {
  return {
    ownerKey,
    userId: legacyUserId,
    sourceName: source.fileName,
    sourceType: source.type || 'image',
    sourceFileId: source.fileId,
    sourceCloudPath: source.cloudPath || '',
    fileSize: source.size || 0,
    sourceFiles: [{
      fileName: source.fileName,
      type: source.type,
      fileId: source.fileId,
      cloudPath: source.cloudPath,
      fileSize: source.size
    }]
  };
}

function makeBatchProgressHandler(onProgress, index, total) {
  if (typeof onProgress !== 'function') {
    return null;
  }

  return (progress = {}) => {
    const nextProgress = {
      ...progress
    };

    if (total > 1) {
      const prefix = `正在识别第 ${index + 1}/${total} 张图片`;
      nextProgress.message = progress.message
        ? `${prefix}，${progress.message}`
        : prefix;
    }

    onProgress(nextProgress);
  };
}

function buildCombinedMarkdown(taskEntries) {
  const validEntries = (Array.isArray(taskEntries) ? taskEntries : [])
    .filter((entry) => entry && entry.task && entry.task.markdown);

  if (!validEntries.length) {
    return '';
  }

  if (validEntries.length === 1) {
    return validEntries[0].task.markdown;
  }

  return validEntries.map((entry, index) => [
    `### 图片${index + 1}：${entry.source.fileName || `第${index + 1}张图片`}`,
    entry.task.markdown
  ].join('\n')).join('\n\n');
}

function toDraftFromTaskEntries(taskEntries, sources = []) {
  const sourceFiles = normalizeSourceList(sources);
  const sourceName = buildSourceDisplayName(sourceFiles);
  const baseName = sourceName.replace(/\.[^.]+$/, '') || '未命名扫描件';
  const latestTask = taskEntries[taskEntries.length - 1] && taskEntries[taskEntries.length - 1].task;

  return {
    sourceFiles,
    sourceType: (sourceFiles[0] && sourceFiles[0].type) || 'image',
    sourceName,
    sourceFileId: (sourceFiles[0] && sourceFiles[0].fileId) || '',
    ocrTaskId: latestTask && latestTask.id ? latestTask.id : '',
    ocrStatus: latestTask && latestTask.status ? latestTask.status : 'success',
    ocrProvider: latestTask && latestTask.provider ? latestTask.provider : ocrConfig.provider,
    name: baseName,
    description: buildDescription(`已识别${sourceFiles.length}张图片`, sourceFiles.length || 1),
    markdown: buildCombinedMarkdown(taskEntries)
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

function chooseImageSources(limit = 6) {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: limit,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFiles = Array.isArray(res.tempFiles) ? res.tempFiles : [];
        resolve(tempFiles.map((file, index) => normalizeSourceItem({
          fileName: buildImageSourceName(file.tempFilePath, index),
          tempFilePath: file.tempFilePath,
          previewUrl: file.tempFilePath,
          size: file.size || 0,
          type: 'image'
        }, index)));
      },
      fail: reject
    });
  });
}

function getTaskOwner(user) {
  const sessionUser = getCurrentUser() || {};
  const targetUser = user && (user.username || user.id || user._id) ? user : sessionUser;

  return {
    ownerKey: String((targetUser && targetUser.username) || '').trim(),
    legacyUserId: String((targetUser && (targetUser.id || targetUser._id)) || '').trim()
  };
}

async function uploadSourceToCloud(source, ownerKey, index = 0) {
  const cloudPath = makeCloudPath(ownerKey, source.fileName, index);
  const result = await wx.cloud.uploadFile({
    cloudPath,
    filePath: source.tempFilePath
  });

  return {
    fileID: result.fileID,
    cloudPath
  };
}

async function uploadSourcesToCloud(sources, ownerKey, onProgress) {
  const uploadedSources = [];

  for (let index = 0; index < sources.length; index += 1) {
    const source = normalizeSourceItem(sources[index], index);

    if (!source.fileId && source.tempFilePath) {
      if (typeof onProgress === 'function') {
        onProgress({
          stage: 'uploading',
          message: `正在上传图片（${index + 1}/${sources.length}）`,
          sources: uploadedSources.concat(source)
        });
      }

      const uploaded = await uploadSourceToCloud(source, ownerKey, index);
      uploadedSources.push(normalizeSourceItem({
        ...source,
        fileId: uploaded.fileID,
        cloudPath: uploaded.cloudPath
      }, index));
      continue;
    }

    uploadedSources.push(source);
  }

  return uploadedSources;
}

async function getTask(taskId, currentUser) {
  const { ownerKey, legacyUserId } = getTaskOwner(currentUser);
  const result = await callOcr('getTask', {
    taskId,
    ownerKey,
    userId: legacyUserId
  });

  if (!result.ok || !result.task) {
    throw buildTaskError(result.message || 'OCR 任务查询失败', 'OCR_TASK_QUERY_FAILED');
  }

  return result.task;
}

async function triggerTaskProcessing(taskId, currentUser, options = {}) {
  const { onProgress } = options;
  const { ownerKey, legacyUserId } = getTaskOwner(currentUser);

  if (typeof onProgress === 'function') {
    onProgress({
      stage: 'processing',
      message: 'OCR 任务已创建，正在请求识别服务'
    });
  }

  let result = null;

  try {
    result = await callOcr('processTask', {
      taskId,
      ownerKey,
      userId: legacyUserId
    });
  } catch (error) {
    if (!isCloudFunctionTimeout(error)) {
      throw error;
    }

    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'polling',
        message: 'OCR 请求时间较长，已自动切换为后台处理并继续查询结果',
        task: {
          id: taskId,
          status: 'processing',
          provider: ocrConfig.provider
        }
      });
    }

    return null;
  }

  if (!result.ok && !result.task) {
    throw buildTaskError(result.message || 'OCR 任务处理失败', 'OCR_PROCESS_FAILED');
  }

  return result.task || null;
}

async function pollTaskResult(taskId, currentUser, options = {}) {
  const maxAttempts = options.maxAttempts || ocrConfig.maxPollAttempts;
  const interval = options.interval || ocrConfig.pollInterval;
  const onProgress = options.onProgress;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const task = await getTask(taskId, currentUser);

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

async function createDraftFromSources(currentUser, sources, options = {}) {
  const { ownerKey, legacyUserId } = getTaskOwner(currentUser);
  if (!ownerKey && !legacyUserId) {
    throw buildTaskError('未获取到当前登录用户', 'AUTH_REQUIRED');
  }

  const sourceFiles = normalizeSourceList(sources);
  if (!sourceFiles.length) {
    throw buildTaskError('请先选择图片', 'OCR_SOURCE_REQUIRED');
  }

  const { onProgress } = options;
  const uploadedSources = await uploadSourcesToCloud(sourceFiles, ownerKey, onProgress);
  if (uploadedSources.length === 1) {
    const primarySource = uploadedSources[0] || null;
    const totalFileSize = uploadedSources.reduce((sum, source) => sum + (source.size || 0), 0);
    const created = await callOcr('createTask', {
      ownerKey,
      userId: legacyUserId,
      // Keep the legacy single-file fields for older deployed cloud functions.
      sourceName: buildSourceDisplayName(uploadedSources),
      sourceType: primarySource ? primarySource.type : 'image',
      sourceFileId: primarySource ? primarySource.fileId : '',
      sourceCloudPath: primarySource ? primarySource.cloudPath : '',
      fileSize: totalFileSize,
      sourceFiles: uploadedSources.map((source) => ({
        fileName: source.fileName,
        type: source.type,
        fileId: source.fileId,
        cloudPath: source.cloudPath,
        fileSize: source.size
      }))
    });

    if (!created.ok || !created.task) {
      throw buildTaskError(created.message || 'OCR 任务创建失败', 'OCR_TASK_CREATE_FAILED');
    }

    if (typeof onProgress === 'function') {
      onProgress({
        stage: 'created',
        message: 'OCR 任务已创建，正在等待识别结果',
        task: created.task,
        sources: uploadedSources
      });
    }

    const processingTask = await triggerTaskProcessing(created.task.id, currentUser, { onProgress });
    const task = processingTask && processingTask.status === 'success'
      ? processingTask
      : await pollTaskResult(created.task.id, currentUser, { onProgress });

    return toDraftFromTask(task, uploadedSources);
  }

  const taskEntries = [];

  for (let index = 0; index < uploadedSources.length; index += 1) {
    const source = uploadedSources[index];
    const itemProgress = makeBatchProgressHandler(onProgress, index, uploadedSources.length);
    const created = await callOcr('createTask', buildSingleTaskPayload(ownerKey, legacyUserId, source));

    if (!created.ok || !created.task) {
      throw buildTaskError(created.message || `第 ${index + 1} 张图片 OCR 任务创建失败`, 'OCR_TASK_CREATE_FAILED');
    }

    if (typeof itemProgress === 'function') {
      itemProgress({
        stage: 'created',
        message: 'OCR 任务已创建，正在等待识别结果',
        task: created.task,
        sources: uploadedSources.slice(0, index + 1)
      });
    }

    const processingTask = await triggerTaskProcessing(created.task.id, currentUser, { onProgress: itemProgress });
    const task = processingTask && processingTask.status === 'success'
      ? processingTask
      : await pollTaskResult(created.task.id, currentUser, { onProgress: itemProgress });

    taskEntries.push({
      source,
      task
    });
  }

  return toDraftFromTaskEntries(taskEntries, uploadedSources);
}

async function refreshDraftFromTask(currentUser, taskId, options = {}) {
  if (!currentUser || !currentUser.username || !taskId) {
    throw buildTaskError('缺少 OCR 任务信息', 'OCR_TASK_INVALID');
  }

  const { onProgress, sources = [] } = options;
  const task = await pollTaskResult(taskId, currentUser, { onProgress });
  return toDraftFromTask(task, sources);
}

module.exports = {
  chooseImageSources,
  createDraftFromSources,
  refreshDraftFromTask
};
