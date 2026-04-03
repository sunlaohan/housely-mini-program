const { ensureAuth } = require('../../../utils/page');
const { updateSecurity } = require('../../../utils/account');

Page({
  data: {
    currentUser: null,
    password: '',
    securityQuestion: '',
    securityAnswer: ''
  },

  onShow() {
    ensureAuth(this, (user) => {
      this.setData({
        securityQuestion: user.securityQuestion || ''
      });
    });
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [field]: event.detail.value
    });
  },

  async submit() {
    const { currentUser, password, securityQuestion, securityAnswer } = this.data;

    if (!password || !securityQuestion || !securityAnswer) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }

    try {
      const result = await updateSecurity(
        currentUser.username,
        password,
        securityQuestion.trim(),
        securityAnswer.trim()
      );

      if (!result.ok) {
        wx.showToast({ title: result.message, icon: 'none' });
        return;
      }

      getApp().setCurrentUser(result.user);
      wx.showToast({ title: '密保已更新', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 500);
    } catch (error) {
      wx.showToast({ title: '修改密保失败', icon: 'none' });
    }
  }
});
