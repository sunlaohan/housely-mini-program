const { registerAccount } = require('../../../utils/account');

Page({
  data: {
    username: '',
    password: '',
    confirmPassword: '',
    securityQuestion: '',
    securityAnswer: ''
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [field]: event.detail.value
    });
  },

  async submitRegister() {
    const { username, password, confirmPassword, securityQuestion, securityAnswer } = this.data;

    if (!username || !password || !confirmPassword || !securityQuestion || !securityAnswer) {
      wx.showToast({ title: '请完整填写注册信息', icon: 'none' });
      return;
    }

    if (password !== confirmPassword) {
      wx.showToast({ title: '两次密码输入不一致', icon: 'none' });
      return;
    }

    try {
      const result = await registerAccount({
        username: username.trim(),
        password,
        securityQuestion: securityQuestion.trim(),
        securityAnswer: securityAnswer.trim()
      });

      if (!result.ok) {
        wx.showToast({ title: result.message, icon: 'none' });
        return;
      }

      getApp().setCurrentUser(result.user);
      wx.switchTab({
        url: '/pages/home/index'
      });
    } catch (error) {
      wx.showToast({ title: '注册失败，请检查数据表', icon: 'none' });
    }
  }
});
