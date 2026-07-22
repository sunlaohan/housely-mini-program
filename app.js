const { getCurrentUser } = require('./utils/account');
const { envId } = require('./config/cloud');

App({
  globalData: {
    currentUser: null,
    tabBarSelected: null
  },

  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '基础库版本过低',
        content: '请使用支持云开发的微信基础库版本后再运行。'
      });
      return;
    }

    wx.cloud.init({
      env: envId,
      traceUser: true
    });

    this.setupUpdateManager();
    this.preloadTabBarIcons();
    this.globalData.currentUser = getCurrentUser();
  },

  preloadTabBarIcons() {
    if (typeof wx.getImageInfo !== 'function') {
      return;
    }

    [
      '/assets/tabbar/home.png',
      '/assets/tabbar/home-active.png',
      '/assets/tabbar/profile.png',
      '/assets/tabbar/profile-active.png'
    ].forEach((src) => {
      wx.getImageInfo({
        src,
        fail() {}
      });
    });
  },

  setupUpdateManager() {
    if (typeof wx.getUpdateManager !== 'function') {
      return;
    }

    const updateManager = wx.getUpdateManager();

    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '发现新版本',
        content: '新版本已经准备好，重启后即可体验最新功能。',
        confirmText: '立即重启',
        cancelText: '稍后',
        success: (res) => {
          if (res.confirm) {
            updateManager.applyUpdate();
          }
        }
      });
    });

    updateManager.onUpdateFailed(() => {
      wx.showToast({
        title: '新版本下载失败，请稍后再试',
        icon: 'none'
      });
    });
  },

  setCurrentUser(user) {
    this.globalData.currentUser = user;
  }
});
