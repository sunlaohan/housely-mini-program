const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const MAX_CHUNK_LENGTH = 1800;
const DEFAULT_SCENE = 1;
const RISKY_ERR_CODE = 87014;
const IMAGE_MEDIA_TYPE = 2;

function normalizeText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectText(payload = {}) {
  return [
    payload.title,
    payload.description,
    payload.markdown,
    payload.content
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join('\n\n');
}

function splitText(text) {
  const chunks = [];
  let cursor = 0;

  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + MAX_CHUNK_LENGTH));
    cursor += MAX_CHUNK_LENGTH;
  }

  return chunks;
}

function isRiskyResult(result) {
  if (!result) {
    return false;
  }

  if (result.errCode === RISKY_ERR_CODE || result.errcode === RISKY_ERR_CODE) {
    return true;
  }

  const suggest = String(result.result && result.result.suggest || '').trim();
  return suggest && suggest !== 'pass';
}

function getSafeMessage(error) {
  const message = String(error && (error.errMsg || error.message) || '').trim();

  if (message.includes(String(RISKY_ERR_CODE))) {
    return '内容含有不合规信息，请修改后再保存';
  }

  return '内容安全校验失败，请稍后再试';
}

function normalizeMediaFiles(files = []) {
  const seen = new Set();

  return (Array.isArray(files) ? files : [])
    .map((file) => ({
      fileId: String(file && (file.fileId || file.fileID || file.sourceFileId) || '').trim(),
      type: String(file && (file.type || file.sourceType) || 'image').trim() || 'image'
    }))
    .filter((file) => file.fileId && file.type === 'image')
    .filter((file) => {
      if (seen.has(file.fileId)) {
        return false;
      }

      seen.add(file.fileId);
      return true;
    });
}

async function getTempUrlMap(fileIds) {
  if (!fileIds.length) {
    return {};
  }

  const result = await cloud.getTempFileURL({
    fileList: fileIds
  });
  const urlMap = {};

  (result.fileList || []).forEach((file) => {
    if (file && file.fileID && file.tempFileURL) {
      urlMap[file.fileID] = file.tempFileURL;
    }
  });

  return urlMap;
}

async function checkText(event) {
  const text = collectText(event);
  if (!text) {
    return {
      ok: true,
      safe: true
    };
  }

  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid || '';
  const chunks = splitText(text);

  for (let index = 0; index < chunks.length; index += 1) {
    try {
      const result = await cloud.openapi.security.msgSecCheck({
        content: chunks[index],
        version: 2,
        scene: Number(event.scene || DEFAULT_SCENE) || DEFAULT_SCENE,
        openid
      });

      if (isRiskyResult(result)) {
        return {
          ok: true,
          safe: false,
          message: '内容含有不合规信息，请修改后再保存'
        };
      }
    } catch (error) {
      console.error('msgSecCheck failed', {
        index,
        errMsg: error && (error.errMsg || error.message)
      });

      return {
        ok: false,
        safe: false,
        message: getSafeMessage(error)
      };
    }
  }

  return {
    ok: true,
    safe: true
  };
}

async function checkMedia(event) {
  const mediaFiles = normalizeMediaFiles(event.sourceFiles || event.mediaFiles || []);
  if (!mediaFiles.length) {
    return {
      ok: true,
      safe: true
    };
  }

  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid || '';
  const urlMap = await getTempUrlMap(mediaFiles.map((file) => file.fileId));

  for (let index = 0; index < mediaFiles.length; index += 1) {
    const file = mediaFiles[index];
    const mediaUrl = urlMap[file.fileId];

    if (!mediaUrl) {
      return {
        ok: false,
        safe: false,
        message: '图片安全校验失败，请稍后再试'
      };
    }

    try {
      await cloud.openapi.security.mediaCheckAsync({
        mediaUrl,
        mediaType: IMAGE_MEDIA_TYPE,
        version: 2,
        scene: Number(event.scene || DEFAULT_SCENE) || DEFAULT_SCENE,
        openid
      });
    } catch (error) {
      console.error('mediaCheckAsync failed', {
        index,
        errMsg: error && (error.errMsg || error.message)
      });

      return {
        ok: false,
        safe: false,
        message: getSafeMessage(error)
      };
    }
  }

  return {
    ok: true,
    safe: true
  };
}

async function checkDocument(event) {
  const textResult = await checkText(event);
  if (!textResult.ok || !textResult.safe) {
    return textResult;
  }

  const mediaResult = await checkMedia(event);
  if (!mediaResult.ok || !mediaResult.safe) {
    return mediaResult;
  }

  return {
    ok: true,
    safe: true
  };
}

exports.main = async (event = {}) => {
  switch (event.action) {
    case 'checkText':
      return checkText(event);
    case 'checkMedia':
      return checkMedia(event);
    case 'checkDocument':
      return checkDocument(event);
    default:
      return {
        ok: false,
        safe: false,
        message: '不支持的内容安全操作'
      };
  }
};
