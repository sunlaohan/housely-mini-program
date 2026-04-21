const FEEDBACK_RECEIVER_EMAIL = '1291362786@qq.com';

function feedbackCollection() {
  return wx.cloud.database().collection('feedbacks');
}

function sanitizeCloudPathSegment(value, fallback = 'anonymous') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^\w\-\u4e00-\u9fa5]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || fallback;
}

function buildAttachmentName(source, index = 0) {
  const sourceName = String(source && (source.fileName || source.name) || '').trim();
  if (sourceName) {
    return sourceName;
  }

  const tempFilePath = String(source && source.tempFilePath || '').trim();
  const matchedExt = tempFilePath.match(/\.(jpg|jpeg|png|webp|bmp|heic|mp4|mov|m4v)$/i);
  const extension = matchedExt ? matchedExt[0].toLowerCase() : '.jpg';
  return `feedback-${Date.now()}-${index + 1}${extension}`;
}

function normalizeAttachment(source, index = 0) {
  const tempFilePath = String(source && source.tempFilePath || '').trim();
  const thumbTempFilePath = String(source && (source.thumbTempFilePath || source.poster) || '').trim();
  const fileId = String(source && source.fileId || '').trim();
  const fileName = buildAttachmentName(source, index);
  const type = String(source && source.type || '').trim() || (fileName.match(/\.(mp4|mov|m4v)$/i) ? 'video' : 'image');

  return {
    key: String(source && source.key || '').trim() || fileId || tempFilePath || `feedback-${Date.now()}-${index}`,
    fileName,
    type,
    size: Number(source && source.size || 0) || 0,
    tempFilePath,
    thumbTempFilePath,
    previewUrl: String(source && source.previewUrl || '').trim() || thumbTempFilePath || tempFilePath,
    fileId,
    cloudPath: String(source && source.cloudPath || '').trim()
  };
}

function makeCloudPath(ownerKey, fileName, index = 0) {
  const safeOwnerKey = sanitizeCloudPathSegment(ownerKey, 'anonymous');
  const safeFileName = String(fileName || 'feedback-file').replace(/[^\w.\-\u4e00-\u9fa5]/g, '-');
  const suffix = index > 0 ? `-${index}` : '';
  return `feedback/${safeOwnerKey}/${Date.now()}${suffix}-${safeFileName}`;
}

async function uploadAttachment(source, ownerKey, index = 0) {
  const normalized = normalizeAttachment(source, index);

  if (normalized.fileId || !normalized.tempFilePath) {
    return normalized;
  }

  const cloudPath = makeCloudPath(ownerKey, normalized.fileName, index);
  const result = await wx.cloud.uploadFile({
    cloudPath,
    filePath: normalized.tempFilePath
  });

  return {
    ...normalized,
    fileId: result.fileID,
    cloudPath
  };
}

async function uploadAttachments(sources, ownerKey) {
  const uploaded = [];

  for (let index = 0; index < sources.length; index += 1) {
    uploaded.push(await uploadAttachment(sources[index], ownerKey, index));
  }

  return uploaded;
}

async function submitFeedback(user, payload) {
  const ownerKey = String(user && user.username || '').trim();
  const userId = String(user && user.id || '').trim();
  const now = new Date();
  const attachments = await uploadAttachments(payload.attachments || [], ownerKey);

  const record = {
    ownerKey,
    username: ownerKey,
    userId,
    receiverEmail: FEEDBACK_RECEIVER_EMAIL,
    contact: String(payload.contact || '').trim(),
    content: String(payload.content || '').trim(),
    attachments: attachments.map((attachment) => ({
      fileName: attachment.fileName,
      type: attachment.type,
      fileId: attachment.fileId,
      cloudPath: attachment.cloudPath,
      fileSize: attachment.size || 0
    })),
    createdAt: now,
    updatedAt: now
  };

  const result = await feedbackCollection().add({
    data: record
  });

  return {
    id: result._id,
    ...record
  };
}

module.exports = {
  FEEDBACK_RECEIVER_EMAIL,
  normalizeAttachment,
  submitFeedback
};
