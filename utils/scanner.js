function formatMarkdownFromName(name) {
  return `# ${name}\n\n## 扫描概览\n- 来源：移动端扫描导入\n- 状态：待人工校对\n\n## 提取正文\n> 这里是扫描后的 Markdown 结果占位内容。\n> 当前项目已预留 OCR 适配层，推荐后续接入 GitHub 开源项目 MinerU 或 PaddleOCR 后端，把真实识别文本回填到这里。\n\n## 后续整理\n- 补充标题层级\n- 修正 OCR 错别字\n- 添加关键信息摘要\n`;
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

async function createDraftFromScan() {
  const source = await chooseSource();
  const baseName = (source.fileName || '未命名扫描件').replace(/\.[^.]+$/, '');

  return {
    sourceType: source.type,
    sourceName: source.fileName,
    sourcePath: source.tempFilePath,
    name: baseName,
    description: source.type === 'image' ? '来自图片扫描生成' : '来自文件导入生成',
    markdown: formatMarkdownFromName(baseName)
  };
}

module.exports = {
  createDraftFromScan
};
