const { getCurrentUser } = require('./utils/account');
const { envId } = require('./config/cloud');

App({
  globalData: {
    currentUser: null
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

    this.globalData.currentUser = getCurrentUser();
  },

  setCurrentUser(user) {
    this.globalData.currentUser = user;
  }
});
