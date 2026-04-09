const cloud = require('wx-server-sdk');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const ocrConfig = require('./config');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const tasks = db.collection('ocr_tasks');
const SUPPORTED_MODES = ['mock', 'official', 'http', 'auto'];

function sanitizeTask(task) {
  if (!task) {
    return null;
  }

  return {
    id: task._id || task.id,
    ownerKey: task.ownerKey || task.username || task.userId || '',
    userId: task.userId,
    provider: task.provider || ocrConfig.provider || 'WeChat OCR',
    status: task.status || 'pending',
    sourceName: task.sourceName || '',
    sourceType: task.sourceType || '',
    sourceFileId: task.sourceFileId || '',
    sourceCloudPath: task.sourceCloudPath || '',
    markdown: task.markdown || '',
    rawJson: task.rawJson || null,
    summary: task.summary || '',
    errorMessage: task.errorMessage || '',
    createdAt: task.createdAt || '',
    updatedAt: task.updatedAt || ''
  };
}

function getEventOwner(event) {
  return {
    ownerKey: String((event && event.ownerKey) || '').trim(),
    legacyUserId: String((event && event.userId) || '').trim()
  };
}

function isTaskOwnedBy(task, event) {
  const { ownerKey, legacyUserId } = getEventOwner(event);
  return Boolean(
    (ownerKey && (task.ownerKey === ownerKey || task.username === ownerKey)) ||
    (legacyUserId && task.userId === legacyUserId)
  );
}

function makeMockContent(sourceName, sourceType) {
  const title = (sourceName || '未命名扫描件').replace(/\.[^.]+$/, '');

  return [
    `文件标题：${title}`,
    `识别引擎：MinerU 演示模式`,
    `来源类型：${sourceType === 'image' ? '图片扫描' : '文件导入'}`,
    '',
    '这是一份演示识别结果，用于验证上传、任务创建、状态轮询与结果回填流程。',
    '切换到微信 OCR 或 HTTP OCR 服务后，这里会显示真实识别文本。',
    '',
    '建议人工复核关键数字、专有名词与换行位置。'
  ].join('\n');
}

function extractPrintedText(result) {
  if (!result) {
    return '';
  }

  if (Array.isArray(result.items)) {
    const lines = result.items
      .map((item) => item && (item.text || item.string || item.words))
      .filter(Boolean);

    if (lines.length) {
      return lines.join('\n');
    }
  }

  if (Array.isArray(result.PrintedTextResult)) {
    const lines = result.PrintedTextResult
      .map((item) => item && (item.Text || item.text))
      .filter(Boolean);

    if (lines.length) {
      return lines.join('\n');
    }
  }

  if (Array.isArray(result.WordsResult)) {
    const lines = result.WordsResult
      .map((item) => item && (item.Words || item.words))
      .filter(Boolean);

    if (lines.length) {
      return lines.join('\n');
    }
  }

  if (typeof result.text === 'string' && result.text.trim()) {
    return result.text.trim();
  }

  return '';
}

function getOcrMode() {
  const mode = typeof ocrConfig.mode === 'string' ? ocrConfig.mode.trim() : '';
  return SUPPORTED_MODES.includes(mode) ? mode : 'mock';
}

function hasConfiguredHttpService() {
  const endpoint = ocrConfig.service && typeof ocrConfig.service.endpoint === 'string'
    ? ocrConfig.service.endpoint.trim()
    : '';

  return Boolean(endpoint) && !endpoint.includes('YOUR_SERVER_IP');
}

function isQuotaExceededError(error) {
  const message = error && error.message ? String(error.message) : '';
  return message.includes('101003') || message.includes('not enough market quota');
}

function normalizeOfficialOcrError(error) {
  const message = error && error.message ? String(error.message) : '';

  if (isQuotaExceededError(error)) {
    return '微信官方 OCR 配额已用尽，请改用 HTTP OCR 服务，或切回 mock 模式后重新部署云函数';
  }

  if (message.includes('invalid img url')) {
    return '微信官方 OCR 无法访问当前图片链接，请稍后重试';
  }

  return message || '微信官方 OCR 调用失败';
}

function requestJson(urlString, options = {}, payload) {
  const target = new URL(urlString);
  const client = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || ocrConfig.requestTimeoutMs
    }, (res) => {
      const chunks = [];

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;

        try {
          data = raw ? JSON.parse(raw) : null;
        } catch (error) {
          reject(new Error(`OCR 服务返回了非 JSON 内容：${raw.slice(0, 200)}`));
          return;
        }

        if (res.statusCode >= 400) {
          reject(new Error((data && (data.message || data.errorMessage)) || `OCR 服务请求失败：HTTP ${res.statusCode}`));
          return;
        }

        resolve(data || {});
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('请求 OCR 服务超时'));
    });

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

async function updateTask(taskId, data) {
  await tasks.doc(taskId).update({ data });
}

async function markTask(taskId, patch, baseTask) {
  await updateTask(taskId, patch);
  return sanitizeTask({
    ...baseTask,
    ...patch
  });
}

async function getTaskById(taskId) {
  return tasks.doc(taskId).get().then((res) => res.data).catch(() => null);
}

async function handleCreateTask(event) {
  const {
    ownerKey,
    userId,
    sourceName,
    sourceType,
    sourceFileId,
    sourceCloudPath,
    fileSize
  } = event;

  const normalizedOwnerKey = String(ownerKey || '').trim();
  const legacyUserId = String(userId || '').trim();

  if ((!normalizedOwnerKey && !legacyUserId) || !sourceName || !sourceFileId) {
    return { ok: false, message: '创建 OCR 任务缺少必要参数' };
  }

  const now = new Date();
  const payload = {
    ownerKey: normalizedOwnerKey || legacyUserId,
    username: normalizedOwnerKey || '',
    userId: legacyUserId,
    provider: ocrConfig.provider || 'WeChat OCR',
    status: 'pending',
    sourceName,
    sourceType: sourceType || 'file',
    sourceFileId,
    sourceCloudPath: sourceCloudPath || '',
    fileSize: fileSize || 0,
    markdown: '',
    rawJson: {},
    summary: '',
    errorMessage: '',
    createdAt: now,
    updatedAt: now
  };

  const result = await tasks.add({
    data: payload
  });

  return {
    ok: true,
    task: sanitizeTask({
      _id: result._id,
      ...payload
    })
  };
}

async function handleGetTask(event) {
  const { taskId } = event;
  const { ownerKey, legacyUserId } = getEventOwner(event);
  if (!taskId || (!ownerKey && !legacyUserId)) {
    return { ok: false, message: '查询 OCR 任务缺少必要参数' };
  }

  const task = await getTaskById(taskId);
  if (!task || !isTaskOwnedBy(task, event)) {
    return { ok: false, message: '任务不存在或无权限访问' };
  }

  return {
    ok: true,
    task: sanitizeTask(task)
  };
}

async function handleSubmitResult(event) {
  const {
    taskId,
    userId,
    status,
    markdown,
    rawJson,
    summary,
    errorMessage
  } = event;

  if (!taskId || (!event.ownerKey && !event.userId)) {
    return { ok: false, message: '回写 OCR 任务缺少必要参数' };
  }

  const task = await getTaskById(taskId);
  if (!task || !isTaskOwnedBy(task, event)) {
    return { ok: false, message: '任务不存在或无权限访问' };
  }

  const nextStatus = status || 'success';
  const data = {
    status: nextStatus,
    markdown: markdown || '',
    rawJson: _.set(rawJson || {}),
    summary: summary || '',
    errorMessage: errorMessage || '',
    updatedAt: new Date()
  };

  await tasks.doc(taskId).update({ data });

  return {
    ok: true,
    task: sanitizeTask({
      ...task,
      ...data
    })
  };
}

async function handleMockCompleteTask(event) {
  const { taskId } = event;
  if (!taskId || (!event.ownerKey && !event.userId)) {
    return { ok: false, message: '模拟 OCR 缺少必要参数' };
  }

  const task = await getTaskById(taskId);
  if (!task || !isTaskOwnedBy(task, event)) {
    return { ok: false, message: '任务不存在或无权限访问' };
  }

  const data = {
    status: 'success',
    provider: 'MinerU',
    markdown: makeMockContent(task.sourceName, task.sourceType),
    rawJson: _.set({
      mock: true,
      sourceName: task.sourceName,
      provider: 'MinerU'
    }),
    summary: '已通过内置演示模式生成演示识别内容',
    errorMessage: '',
    updatedAt: new Date()
  };

  await tasks.doc(taskId).update({ data });

  return {
    ok: true,
    task: sanitizeTask({
      ...task,
      ...data
    })
  };
}

async function getSourceTempUrl(sourceFileId) {
  const tempFile = await cloud.getTempFileURL({
    fileList: [sourceFileId]
  });

  return tempFile.fileList && tempFile.fileList[0] && tempFile.fileList[0].tempFileURL;
}

async function processTaskWithOfficial(taskId, task, tempUrl) {
  const officialResult = await cloud.openapi.ocr.printedText({
    type: 'photo',
    imgUrl: tempUrl
  });

  const plainText = extractPrintedText(officialResult);
  if (!plainText) {
    throw new Error('微信官方 OCR 已返回结果，但未提取到文本内容');
  }

  const successTask = await markTask(taskId, {
    status: 'success',
    provider: 'WeChat OCR',
    markdown: plainText,
    rawJson: _.set(officialResult || {}),
    summary: '已通过微信官方 OCR 提取图片文本',
    errorMessage: '',
    updatedAt: new Date()
  }, task);

  return {
    ok: true,
    task: successTask
  };
}

async function processTaskWithHttp(taskId, task, tempUrl) {
  if (!hasConfiguredHttpService()) {
    return { ok: false, message: '未配置真实 OCR 服务地址，请先更新 cloudfunctions/ocr/config.js' };
  }

  const payload = JSON.stringify({
    taskId,
    ownerKey: task.ownerKey || task.username || task.userId,
    userId: task.userId,
    provider: ocrConfig.provider,
    sourceName: task.sourceName,
    sourceType: task.sourceType,
    sourceFileId: task.sourceFileId,
    sourceCloudPath: task.sourceCloudPath,
    fileUrl: tempUrl
  });

  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  };

  if (ocrConfig.service.bearerToken) {
    headers.Authorization = `Bearer ${ocrConfig.service.bearerToken}`;
  }

  const result = await requestJson(ocrConfig.service.endpoint, {
    method: 'POST',
    headers
  }, payload);

  if (!result.ok) {
    const failedTask = await markTask(taskId, {
      status: 'failed',
      errorMessage: result.message || 'OCR 服务处理失败',
      updatedAt: new Date()
    }, task);

    return {
      ok: false,
      message: failedTask.errorMessage,
      task: failedTask
    };
  }

  if (!result.markdown) {
    return {
      ok: true,
      task: task
    };
  }

  const successTask = await markTask(taskId, {
    status: 'success',
    provider: ocrConfig.provider || task.provider,
    markdown: result.markdown,
    rawJson: _.set(result.rawJson || {}),
    summary: result.summary || '识别完成',
    errorMessage: '',
    updatedAt: new Date()
  }, task);

  return {
    ok: true,
    task: successTask
  };
}

async function handleProcessTask(event) {
  const { taskId } = event;

  if (!taskId || (!event.ownerKey && !event.userId)) {
    return { ok: false, message: '处理 OCR 任务缺少必要参数' };
  }

  const task = await getTaskById(taskId);
  if (!task || !isTaskOwnedBy(task, event)) {
    return { ok: false, message: '任务不存在或无权限访问' };
  }

  const mode = getOcrMode();

  if (mode === 'mock') {
    return handleMockCompleteTask(event);
  }

  if (mode === 'http' && !hasConfiguredHttpService()) {
    return { ok: false, message: '未配置真实 OCR 服务地址，请先更新 cloudfunctions/ocr/config.js' };
  }

  const processingTask = await markTask(taskId, {
    status: 'processing',
    provider: mode === 'official' ? 'WeChat OCR' : (ocrConfig.provider || task.provider),
    errorMessage: '',
    updatedAt: new Date()
  }, task);

  try {
    const tempUrl = await getSourceTempUrl(task.sourceFileId);
    if (!tempUrl) {
      throw new Error('获取云存储临时下载链接失败');
    }

    if (mode === 'official') {
      return processTaskWithOfficial(taskId, processingTask, tempUrl);
    }

    if (mode === 'http') {
      return processTaskWithHttp(taskId, processingTask, tempUrl);
    }

    try {
      return await processTaskWithOfficial(taskId, processingTask, tempUrl);
    } catch (officialError) {
      if (hasConfiguredHttpService()) {
        return processTaskWithHttp(taskId, processingTask, tempUrl);
      }

      throw new Error(normalizeOfficialOcrError(officialError));
    }
  } catch (error) {
    const failedTask = await markTask(taskId, {
      status: 'failed',
      errorMessage: mode === 'official'
        ? normalizeOfficialOcrError(error)
        : (error.message || '调用 OCR 服务失败'),
      updatedAt: new Date()
    }, task);

    return {
      ok: false,
      message: failedTask.errorMessage,
      task: failedTask
    };
  }
}

exports.main = async (event) => {
  switch (event.action) {
    case 'createTask':
      return handleCreateTask(event);
    case 'getTask':
      return handleGetTask(event);
    case 'submitResult':
      return handleSubmitResult(event);
    case 'mockCompleteTask':
      return handleMockCompleteTask(event);
    case 'processTask':
      return handleProcessTask(event);
    default:
      return { ok: false, message: '不支持的 OCR 操作' };
  }
};
