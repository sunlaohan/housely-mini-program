async function checkDocumentContent(payload = {}) {
  try {
    const result = await wx.cloud.callFunction({
      name: 'contentSafety',
      data: {
        action: 'checkDocument',
        title: payload.name || payload.title || '',
        description: payload.description || '',
        markdown: payload.markdown || '',
        sourceFiles: payload.sourceFiles || []
      }
    });

    const data = result.result || {};
    if (data.ok && data.safe) {
      return data;
    }

    const error = new Error(data.message || '内容含有不合规信息，请修改后再保存');
    error.code = data.ok ? 'CONTENT_RISKY' : 'CONTENT_CHECK_FAILED';
    error.result = data;
    throw error;
  } catch (error) {
    if (error && (error.code === 'CONTENT_RISKY' || error.code === 'CONTENT_CHECK_FAILED')) {
      throw error;
    }

    const nextError = new Error('内容安全校验失败，请稍后再试');
    nextError.code = 'CONTENT_CHECK_FAILED';
    nextError.originalError = error;
    throw nextError;
  }
}

module.exports = {
  checkDocumentContent
};
