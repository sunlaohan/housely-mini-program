const { ensureAuth } = require('../../utils/page');
const { logout, updateAvatar, deleteAccount } = require('../../utils/account');
const { normalizeAttachment, submitFeedback } = require('../../utils/feedback');
const { getAboutBannerMedia } = require('../../utils/about');
const { withPageShare } = require('../../utils/share');
const DEFAULT_AVATAR = '/assets/auth/boy-1.png';

const BUILTIN_AVATARS = [
  { key: 'boy-1', src: DEFAULT_AVATAR },
  { key: 'girl-1', src: '/assets/auth/girl-1.png' },
  { key: 'boy-2', src: '/assets/auth/boy-2.png' },
  { key: 'girl-2', src: '/assets/auth/girl-2.png' }
];

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

function normalizeFeedbackErrorMessage(error) {
  const rawMessage = String(error && (error.errMsg || error.message) || '提交失败，请稍后再试').trim();
  if (!rawMessage) {
    return '提交失败，请稍后再试';
  }

  let message = rawMessage
    .replace(/^cloud\.callFunction:fail\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();

  if (message.includes('|')) {
    const segments = message.split('|').map((item) => item.trim()).filter(Boolean);
    if (segments.length) {
      message = segments[segments.length - 1];
    }
  }

  message = message.replace(/^Error:\s*/i, '').trim();

  if (message.includes('collection not exists') || message.includes('Db or Table not exist: feedbacks')) {
    return '当前云环境缺少 feedbacks 集合，请先在云开发数据库中创建 feedbacks 集合';
  }

  return message || rawMessage;
}

Page(withPageShare({
  data: {
    currentUser: null,
    statusBarHeight: 20,
    navBarHeight: 44,
    capsuleSafeWidth: 88,
    defaultAvatar: DEFAULT_AVATAR,
    avatarPanelVisible: false,
    avatarBuiltinOptions: BUILTIN_AVATARS,
    avatarBuiltinDefaultKey: 'boy-1',
    avatarSelectionKey: 'boy-1',
    avatarPreviewSrc: DEFAULT_AVATAR,
    avatarDraftCustomSrc: '',
    avatarDraftSourceType: 'builtin',
    avatarSaving: false,
    aboutShow: false,
    aboutVisible: false,
    aboutVideoUrl: '',
    aboutPosterUrl: '',
    aboutVideoReady: false,
    aboutVideoPlaying: false,
    feedbackVisible: false,
    feedbackSubmitting: false,
    feedbackMaxCount: 9,
    feedbackForm: {
      contact: '',
      content: '',
      attachments: []
    }
  },

  onLoad() {
    this.setData(getNavMetrics());
  },

  onShow() {
    this.syncTabBar();
    ensureAuth(this, (user) => {
      getApp().setCurrentUser(user);
    });
  },

  syncTabBar() {
    if (typeof this.getTabBar !== 'function') {
      return;
    }

    const tabBar = this.getTabBar();
    if (tabBar && typeof tabBar.setData === 'function') {
      tabBar.setData({ selected: 1 });
    }
  },

  pickAvatar() {
    this.openAvatarPanel();
  },

  openAvatarPanel() {
    const currentAvatar = String(this.data.currentUser && this.data.currentUser.avatar || '').trim();
    const matchedBuiltin = BUILTIN_AVATARS.find((item) => item.src === currentAvatar);
    const nextSelectionKey = matchedBuiltin
      ? matchedBuiltin.key
      : (currentAvatar ? 'custom' : this.data.avatarBuiltinDefaultKey);
    const nextPreviewSrc = matchedBuiltin
      ? matchedBuiltin.src
      : (currentAvatar || BUILTIN_AVATARS[0].src);

    this.setData({
      avatarPanelVisible: true,
      avatarSelectionKey: nextSelectionKey,
      avatarPreviewSrc: nextPreviewSrc,
      avatarDraftCustomSrc: matchedBuiltin ? '' : currentAvatar,
      avatarDraftSourceType: matchedBuiltin ? 'builtin' : (currentAvatar ? 'custom' : 'builtin')
    });
  },

  closeAvatarPanel() {
    if (this.data.avatarSaving) {
      return;
    }

    this.setData({
      avatarPanelVisible: false
    });
  },

  chooseBuiltinAvatar(event) {
    const { key, src } = event.currentTarget.dataset;
    if (!key || !src) {
      return;
    }

    this.setData({
      avatarSelectionKey: key,
      avatarPreviewSrc: src,
      avatarDraftSourceType: 'builtin'
    });
  },

  async chooseLocalAvatar() {
    if (this.data.avatarSaving) {
      return;
    }

    try {
      const result = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album'],
          success: resolve,
          fail: reject
        });
      });

      const tempFile = Array.isArray(result.tempFiles) ? result.tempFiles[0] : null;
      if (!tempFile || !tempFile.tempFilePath) {
        return;
      }

      this.setData({
        avatarSelectionKey: 'custom',
        avatarPreviewSrc: tempFile.tempFilePath,
        avatarDraftCustomSrc: tempFile.tempFilePath,
        avatarDraftSourceType: 'custom'
      });
    } catch (error) {
      const message = String(error && (error.errMsg || error.message) || '');
      if (message && !message.includes('cancel')) {
        wx.showToast({ title: '选择头像失败', icon: 'none' });
      }
    }
  },

  onChooseWechatAvatar(event) {
    const avatarUrl = String(event.detail && event.detail.avatarUrl || '').trim();
    if (!avatarUrl) {
      wx.showToast({ title: '未获取到微信头像', icon: 'none' });
      return;
    }

    this.setData({
      avatarSelectionKey: 'custom',
      avatarPreviewSrc: avatarUrl,
      avatarDraftCustomSrc: avatarUrl,
      avatarDraftSourceType: 'wechat'
    });
  },

  sanitizeAvatarPathSegment(value, fallback = 'anonymous') {
    const normalized = String(value || '')
      .trim()
      .replace(/[^\w\-\u4e00-\u9fa5]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return normalized || fallback;
  },

  async uploadAvatarToCloud(filePath) {
    const ownerKey = this.sanitizeAvatarPathSegment(this.data.currentUser && this.data.currentUser.username, 'anonymous');
    const extensionMatch = String(filePath || '').match(/\.(jpg|jpeg|png|webp|bmp|heic)$/i);
    const extension = extensionMatch ? extensionMatch[0].toLowerCase() : '.png';
    const cloudPath = `avatars/${ownerKey}/${Date.now()}${extension}`;
    const result = await wx.cloud.uploadFile({
      cloudPath,
      filePath
    });

    return result.fileID;
  },

  async confirmAvatarSelection() {
    if (this.data.avatarSaving) {
      return;
    }

    let nextAvatar = '';
    if (this.data.avatarSelectionKey === 'custom') {
      nextAvatar = this.data.avatarDraftCustomSrc;
    } else {
      const builtin = BUILTIN_AVATARS.find((item) => item.key === this.data.avatarSelectionKey) || BUILTIN_AVATARS[0];
      nextAvatar = builtin.src;
    }

    if (!nextAvatar) {
      wx.showToast({ title: '请选择头像', icon: 'none' });
      return;
    }

    this.setData({
      avatarSaving: true
    });

    try {
      let savedAvatar = nextAvatar;
      if (this.data.avatarSelectionKey === 'custom' && !String(nextAvatar).startsWith('cloud://') && !String(nextAvatar).startsWith('/assets/')) {
        savedAvatar = await this.uploadAvatarToCloud(nextAvatar);
      }

      const result = await updateAvatar(this.data.currentUser.username, savedAvatar);
      if (!result.ok || !result.user) {
        wx.showToast({ title: '保存失败', icon: 'none' });
        return;
      }

      getApp().setCurrentUser(result.user);
      this.setData({
        currentUser: result.user,
        avatarPanelVisible: false
      });
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });
    } catch (error) {
      console.error('confirmAvatarSelection failed', error);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({
        avatarSaving: false
      });
    }
  },

  async showAbout() {
    this.setData({ aboutShow: true });
    setTimeout(() => {
      this.setData({ aboutVisible: true });
    }, 30);

    try {
      const media = await getAboutBannerMedia();
      this.setData({
        aboutVideoUrl: media.videoUrl,
        aboutPosterUrl: media.posterUrl,
        aboutVideoReady: Boolean(media.videoUrl),
        aboutVideoPlaying: false
      });
    } catch (error) {
      console.error('getAboutBannerMedia failed', error);
      this.setData({
        aboutVideoReady: false,
        aboutVideoPlaying: false
      });
    }
  },

  hideAbout() {
    setTimeout(() => {
      this.setData({ aboutVisible: false });
      setTimeout(() => {
        this.setData({ aboutShow: false });
      }, 350);
    }, 50);
  },

  playAboutVideo() {
    if (!this.data.aboutVideoReady) {
      return;
    }

    this.setData({ aboutVideoPlaying: true });
    setTimeout(() => {
      const context = wx.createVideoContext('profile-about-video', this);
      if (context && typeof context.play === 'function') {
        context.play();
      }
    }, 30);
  },

  onAboutVideoPlay() {
    this.setData({ aboutVideoPlaying: true });
  },

  onAboutVideoPause() {
    this.setData({ aboutVideoPlaying: false });
  },

  onAboutVideoEnded() {
    this.setData({ aboutVideoPlaying: false });
  },

  noop() {},

  showFeedback() {
    this.setData({
      feedbackVisible: true
    });
  },

  closeFeedbackPanel() {
    if (this.data.feedbackSubmitting) {
      return;
    }

    this.setData({
      feedbackVisible: false
    });
  },

  updateFeedbackField(field, value) {
    this.setData({
      [`feedbackForm.${field}`]: value
    });
  },

  onFeedbackContactChange(event) {
    this.updateFeedbackField('contact', event.detail.value);
  },

  onFeedbackContentChange(event) {
    this.updateFeedbackField('content', event.detail.value);
  },

  async addFeedbackAttachment() {
    if (this.data.feedbackSubmitting) {
      return;
    }

    const attachments = this.data.feedbackForm.attachments || [];
    const remainCount = this.data.feedbackMaxCount - attachments.length;

    if (remainCount <= 0) {
      wx.showToast({
        title: `最多上传 ${this.data.feedbackMaxCount} 个文件`,
        icon: 'none'
      });
      return;
    }

    try {
      const result = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: remainCount,
          mediaType: ['image', 'video'],
          sourceType: ['album', 'camera'],
          maxDuration: 30,
          camera: 'back',
          success: resolve,
          fail: reject
        });
      });

      const tempFiles = Array.isArray(result.tempFiles) ? result.tempFiles : [];
      if (!tempFiles.length) {
        return;
      }

      const nextAttachments = attachments.concat(
        tempFiles.map((file, index) => normalizeAttachment({
          fileName: file.tempFilePath.split('/').pop(),
          tempFilePath: file.tempFilePath,
          thumbTempFilePath: file.thumbTempFilePath || '',
          size: file.size || 0,
          type: file.fileType === 'video' ? 'video' : 'image',
          poster: file.thumbTempFilePath || ''
        }, attachments.length + index))
      );

      this.updateFeedbackField('attachments', nextAttachments);
    } catch (error) {
      const message = String(error && (error.errMsg || error.message) || '');
      if (message && !message.includes('cancel')) {
        wx.showToast({
          title: '选择文件失败',
          icon: 'none'
        });
      }
    }
  },

  removeFeedbackAttachment(event) {
    if (this.data.feedbackSubmitting) {
      return;
    }

    const { key } = event.detail;
    const attachments = (this.data.feedbackForm.attachments || []).filter((item) => item.key !== key);
    this.updateFeedbackField('attachments', attachments);
  },

  previewFeedbackAttachment(event) {
    const { key } = event.detail;
    const attachments = this.data.feedbackForm.attachments || [];
    const targetIndex = attachments.findIndex((item) => item.key === key);

    if (targetIndex < 0) {
      return;
    }

    const target = attachments[targetIndex];
    if (wx.previewMedia) {
      wx.previewMedia({
        current: targetIndex,
        sources: attachments.map((item) => ({
          url: item.tempFilePath || item.previewUrl,
          type: item.type === 'video' ? 'video' : 'image',
          poster: item.previewUrl || item.thumbTempFilePath || '',
          altText: item.fileName || ''
        }))
      });
      return;
    }

    if (target.type === 'video') {
      wx.showToast({
        title: '当前微信版本不支持视频预览',
        icon: 'none'
      });
      return;
    }

    wx.previewImage({
      current: target.tempFilePath || target.previewUrl,
      urls: attachments
        .filter((item) => item.type !== 'video')
        .map((item) => item.tempFilePath || item.previewUrl)
    });
  },

  resetFeedbackForm() {
    this.setData({
      feedbackForm: {
        contact: '',
        content: '',
        attachments: []
      }
    });
  },

  async submitFeedbackForm() {
    if (this.data.feedbackSubmitting) {
      return;
    }

    const contact = String(this.data.feedbackForm.contact || '').trim();
    const content = String(this.data.feedbackForm.content || '').trim();

    if (!contact) {
      wx.showToast({
        title: '请填写联系方式',
        icon: 'none'
      });
      return;
    }

    if (!content) {
      wx.showToast({
        title: '请填写问题描述',
        icon: 'none'
      });
      return;
    }

    this.setData({
      feedbackSubmitting: true
    });

    try {
      const result = await submitFeedback(this.data.currentUser, this.data.feedbackForm);
      if (!result.ok) {
        throw new Error(result.message || '提交失败，请稍后再试');
      }

      this.resetFeedbackForm();
      this.setData({
        feedbackVisible: false
      });

      if (result.mailDelivered === false) {
        wx.showToast({
          title: String(result.message || '反馈已保存，但邮件发送失败').slice(0, 30),
          icon: 'none'
        });
        return;
      }

      wx.showToast({
        title: '提交成功',
        icon: 'success'
      });
    } catch (error) {
      console.error('submitFeedback failed', error);
      wx.showModal({
        title: '提交失败',
        content: normalizeFeedbackErrorMessage(error),
        showCancel: false
      });
    } finally {
      this.setData({
        feedbackSubmitting: false
      });
    }
  },

  logoutAccount() {
    logout();
    getApp().setCurrentUser(null);
    wx.reLaunch({
      url: '/pages/auth/login/index'
    });
  },

  removeAccount() {
    wx.showModal({
      title: '注销账号',
      content: '注销后会删除该账号及全部文档，本地数据无法恢复，确定继续吗？',
      confirmColor: '#1b2129',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        try {
          await deleteAccount(this.data.currentUser);
          getApp().setCurrentUser(null);
          wx.reLaunch({
            url: '/pages/auth/login/index'
          });
        } catch (error) {
          wx.showToast({ title: '注销失败', icon: 'none' });
        }
      }
    });
  }
}));
