const { getCurrentUser } = require('../../utils/account');
const { withPageShare } = require('../../utils/share');

Page(withPageShare({
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
}));
