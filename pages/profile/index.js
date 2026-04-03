const { ensureAuth, formatDate } = require('../../utils/page');
const { logout, updateAvatar, deleteAccount } = require('../../utils/account');

Page({
  data: {
    currentUser: null,
    createdLabel: '',
    avatarInitial: 'H'
  },

  onShow() {
    ensureAuth(this, (user) => {
      this.setData({
        createdLabel: formatDate(user.createdAt),
        avatarInitial: user.username ? user.username.slice(0, 1).toUpperCase() : 'H'
      });
      getApp().setCurrentUser(user);
    });
  },

  pickAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        try {
          const result = await updateAvatar(this.data.currentUser.username, res.tempFiles[0].tempFilePath);
          if (!result.ok) {
            wx.showToast({ title: '头像更新失败', icon: 'none' });
            return;
          }
          getApp().setCurrentUser(result.user);
          this.onShow();
        } catch (error) {
          wx.showToast({ title: '头像更新失败', icon: 'none' });
        }
      }
    });
  },

  goPassword() {
    wx.navigateTo({
      url: '/pages/profile/password/index'
    });
  },

  goSecurity() {
    wx.navigateTo({
      url: '/pages/profile/security/index'
    });
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
});
