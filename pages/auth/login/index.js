const { loginWithUsername } = require('../../../utils/account');

Page({
  data: {
    username: '',
    isSubmitting: false,
    aboutShow: false,
    aboutVisible: false,
    videoReady: false,
    nicknameTipShown: false
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
      const message = (error && (error.errMsg || error.message)) || '登录失败，请检查云函数';
      wx.showToast({ title: message.slice(0, 30), icon: 'none' });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  showAbout() {
    this.setData({ aboutShow: true });
    setTimeout(() => {
      this.setData({ aboutVisible: true });
    }, 30);
    setTimeout(() => {
      this.setData({ videoReady: true });
    }, 380);
  },

  hideAbout() {
    this.setData({ videoReady: false });
    setTimeout(() => {
      this.setData({ aboutVisible: false });
      setTimeout(() => {
        this.setData({ aboutShow: false });
      }, 350);
    }, 50);
  }
});
