const { findUser, resetPassword } = require('../../../utils/account');

Page({
  data: {
    username: '',
    securityQuestion: '',
    securityAnswer: '',
    nextPassword: ''
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [field]: event.detail.value
    });
  },

  async fillQuestion() {
    try {
      const user = await findUser(this.data.username.trim());
      if (!user) {
        wx.showToast({ title: '账号不存在', icon: 'none' });
        return;
      }

      this.setData({
        securityQuestion: user.securityQuestion || '未设置密保问题'
      });
    } catch (error) {
      wx.showToast({ title: '获取密保问题失败', icon: 'none' });
    }
  },

  async submitReset() {
    const { username, securityAnswer, nextPassword } = this.data;
    if (!username || !securityAnswer || !nextPassword) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }

    try {
      const result = await resetPassword(username.trim(), securityAnswer.trim(), nextPassword);
      if (!result.ok) {
        wx.showToast({ title: result.message, icon: 'none' });
        return;
      }

      wx.showToast({ title: '密码已重置', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 500);
    } catch (error) {
      wx.showToast({ title: '重置失败，请稍后再试', icon: 'none' });
    }
  }
});
