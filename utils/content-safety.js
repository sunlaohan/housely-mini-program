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

    if (!data.ok) {
      console.warn('content safety check skipped because api failed', data);
      return {
        ...data,
        skipped: true
      };
    }

    const error = new Error(data.message || '内容含有不合规信息，请修改后再保存');
    error.code = 'CONTENT_RISKY';
    error.result = data;
    throw error;
  } catch (error) {
    if (error && error.code === 'CONTENT_RISKY') {
      throw error;
    }

    console.warn('content safety check skipped because cloud call failed', error);
    return {
      ok: false,
      safe: false,
      skipped: true
    };
  }
}

module.exports = {
  checkDocumentContent
};
