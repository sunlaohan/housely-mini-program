const { loginWithUsername } = require('../../../utils/account');
const { getAboutBannerMedia } = require('../../../utils/about');

Page({
  data: {
    username: '',
    isSubmitting: false,
    aboutShow: false,
    aboutVisible: false,
    nicknameTipShown: false,
    aboutVideoUrl: '',
    aboutPosterUrl: '',
    aboutVideoReady: false,
    aboutVideoPlaying: false
  },

  onShow() {
    const app = getApp();
    if (app.globalData.currentUser) {
      wx.switchTab({
        url: '/pages/home/index'
      });
    }
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [field]: event.detail.value
    });
  },

  onUsernameFocus() {
    if (this.data.nicknameTipShown) {
      return;
    }

    this.setData({ nicknameTipShown: true });
    wx.showToast({
      title: '可直接使用微信昵称快速填写',
      icon: 'none'
    });
  },

  async submitLogin() {
    if (this.data.isSubmitting) {
      return;
    }

    const username = String(this.data.username || '').trim();
    if (!username) {
      wx.showToast({ title: '请输入用户名', icon: 'none' });
      return;
    }

    try {
      this.setData({ isSubmitting: true });
      const result = await loginWithUsername(username);
      if (!result.ok) {
        wx.showToast({ title: result.message || '登录失败，请稍后再试', icon: 'none' });
        return;
      }

      getApp().setCurrentUser(result.user);
      wx.switchTab({
        url: '/pages/home/index'
      });
    } catch (error) {
      console.error('submitLogin failed', error);
      const message = error && error.code === 'AUTH_CLOUD_CALL_FAILED'
        ? '云端登录不可用，请检查 auth 云函数和云环境'
        : ((error && (error.errMsg || error.message)) || '登录失败，请检查云函数');
      wx.showToast({ title: message.slice(0, 30), icon: 'none' });
    } finally {
      this.setData({ isSubmitting: false });
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
      const context = wx.createVideoContext('login-about-video', this);
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

  noop() {}

});
