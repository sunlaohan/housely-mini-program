const { getCurrentUser } = require('../../utils/account');

Page({
  onLoad() {
    const user = getCurrentUser();

    if (user) {
      getApp().setCurrentUser(user);
      wx.switchTab({
        url: '/pages/home/index'
      });
      return;
    }

    wx.redirectTo({
      url: '/pages/auth/login/index'
    });
  }
});
