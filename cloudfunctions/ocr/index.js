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

function sanitizeTask(task) {
  if (!task) {
    return null;
  }

  return {
    id: task._id || task.id,
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

function makeMockMarkdown(sourceName, sourceType) {
  const title = (sourceName || '未命名扫描件').replace(/\.[^.]+$/, '');

  return `# ${title}

## 文档信息
- OCR 引擎：MinerU
- 来源：${sourceType === 'image' ? '图片扫描' : '文件导入'}
- 状态：自动识别完成，建议人工复核

## 识别摘要
这是一份通过 OCR 任务流生成的 Markdown 草稿。当前项目已经接入上传、任务创建、状态轮询与结果回填能力。

## 建议整理项
1. 检查标题层级是否准确
2. 核对关键数字与专有名词
3. 如含表格，可按原版式进一步微调
`;
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
    userId,
    sourceName,
    sourceType,
    sourceFileId,
    sourceCloudPath,
    fileSize
  } = event;

  if (!userId || !sourceName || !sourceFileId) {
    return { ok: false, message: '创建 OCR 任务缺少必要参数' };
  }

  const now = new Date();
  const payload = {
    userId,
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
  const { taskId, userId } = event;
  if (!taskId || !userId) {
    return { ok: false, message: '查询 OCR 任务缺少必要参数' };
  }

  const task = await getTaskById(taskId);
  if (!task || task.userId !== userId) {
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

  if (!taskId || !userId) {
    return { ok: false, message: '回写 OCR 任务缺少必要参数' };
  }

  const task = await getTaskById(taskId);
  if (!task || task.userId !== userId) {
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
  const { taskId, userId } = event;
  if (!taskId || !userId) {
    return { ok: false, message: '模拟 OCR 缺少必要参数' };
  }

  const task = await getTaskById(taskId);
  if (!task || task.userId !== userId) {
    return { ok: false, message: '任务不存在或无权限访问' };
  }

  const data = {
    status: 'success',
    markdown: makeMockMarkdown(task.sourceName, task.sourceType),
    rawJson: _.set({
      mock: true,
      sourceName: task.sourceName,
      provider: 'MinerU'
    }),
    summary: '已通过内置演示模式生成 Markdown 草稿',
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

async function handleProcessTask(event) {
  const { taskId, userId } = event;

  if (!taskId || !userId) {
    return { ok: false, message: '处理 OCR 任务缺少必要参数' };
  }

  const task = await getTaskById(taskId);
  if (!task || task.userId !== userId) {
    return { ok: false, message: '任务不存在或无权限访问' };
  }

  if (ocrConfig.mode === 'mock') {
    return handleMockCompleteTask(event);
  }

  if (ocrConfig.mode === 'official') {
    try {
      const tempFile = await cloud.getTempFileURL({
        fileList: [task.sourceFileId]
      });

      const tempUrl = tempFile.fileList && tempFile.fileList[0] && tempFile.fileList[0].tempFileURL;
      if (!tempUrl) {
        throw new Error('获取云存储临时下载链接失败');
      }

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
    } catch (error) {
      const failedTask = await markTask(taskId, {
        status: 'failed',
        errorMessage: error.message || '微信官方 OCR 调用失败',
        updatedAt: new Date()
      }, task);

      return {
        ok: false,
        message: failedTask.errorMessage,
        task: failedTask
      };
    }
  }

  if (!ocrConfig.service || !ocrConfig.service.endpoint) {
    return { ok: false, message: '未配置真实 OCR 服务地址，请先更新 cloudfunctions/ocr/config.js' };
  }

  const processingTask = await markTask(taskId, {
    status: 'processing',
    errorMessage: '',
    updatedAt: new Date()
  }, task);

  try {
    const tempFile = await cloud.getTempFileURL({
      fileList: [task.sourceFileId]
    });

    const tempUrl = tempFile.fileList && tempFile.fileList[0] && tempFile.fileList[0].tempFileURL;
    if (!tempUrl) {
      throw new Error('获取云存储临时下载链接失败');
    }

    const payload = JSON.stringify({
      taskId,
      userId,
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
        task: processingTask
      };
    }

    const successTask = await markTask(taskId, {
      status: 'success',
      markdown: result.markdown,
      rawJson: _.set(result.rawJson || {}),
      summary: result.summary || '',
      errorMessage: '',
      updatedAt: new Date()
    }, task);

    return {
      ok: true,
      task: successTask
    };
  } catch (error) {
    const failedTask = await markTask(taskId, {
      status: 'failed',
      errorMessage: error.message || '调用 OCR 服务失败',
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
