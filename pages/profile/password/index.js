const { ensureAuth } = require('../../../utils/page');
const { updatePassword } = require('../../../utils/account');

Page({
  data: {
    currentUser: null,
    oldPassword: '',
    nextPassword: '',
    confirmPassword: ''
  },

  onShow() {
    ensureAuth(this);
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [field]: event.detail.value
    });
  },

  async submit() {
    const { currentUser, oldPassword, nextPassword, confirmPassword } = this.data;

    if (!oldPassword || !nextPassword || !confirmPassword) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }

    if (nextPassword !== confirmPassword) {
      wx.showToast({ title: '两次新密码不一致', icon: 'none' });
      return;
    }

    try {
      const result = await updatePassword(currentUser.username, oldPassword, nextPassword);
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: 'none' });
        return;
      }

      wx.showToast({ title: '密码已更新', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 500);
    } catch (error) {
      wx.showToast({ title: '修改密码失败', icon: 'none' });
    }
  }
});
