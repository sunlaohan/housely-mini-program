const { getCurrentUser, logout, validateSession } = require('../../utils/account');
const { withPageShare } = require('../../utils/share');

Page(withPageShare({
  async onLoad() {
    const user = getCurrentUser();

    if (user) {
      getApp().setCurrentUser(user);
      if (user.hasPassword !== true) {
        wx.redirectTo({
          url: '/pages/auth/login/index?mode=upgrade'
        });
        return;
      }

      try {
        const result = await validateSession();
        if (!result.ok || !result.user) {
          await logout();
          getApp().setCurrentUser(null);
          wx.redirectTo({ url: '/pages/auth/login/index' });
          return;
        }
        getApp().setCurrentUser(result.user);
      } catch (error) {
        console.error('validateSession failed', error);
        wx.showToast({ title: '登录状态校验失败', icon: 'none' });
      }
    }

    wx.switchTab({
      url: '/pages/home/index'
    });
  }
}));
