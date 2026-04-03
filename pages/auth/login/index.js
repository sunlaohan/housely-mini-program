const { loginAccount } = require('../../../utils/account');

Page({
  data: {
    username: '',
    password: ''
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

  async submitLogin() {
    const { username, password } = this.data;
    if (!username || !password) {
      wx.showToast({ title: '请填写账号和密码', icon: 'none' });
      return;
    }

    try {
      const result = await loginAccount(username.trim(), password);
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: 'none' });
        return;
      }

      getApp().setCurrentUser(result.user);
      wx.switchTab({
        url: '/pages/home/index'
      });
    } catch (error) {
      wx.showToast({ title: '登录失败，请检查数据表', icon: 'none' });
      return;
    }
  },

  goRegister() {
    wx.navigateTo({
      url: '/pages/auth/register/index'
    });
  },

  goReset() {
    wx.navigateTo({
      url: '/pages/auth/reset/index'
    });
  }
});
