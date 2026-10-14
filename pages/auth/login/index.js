const {
  changePassword,
  getCurrentUser,
  loginWithPassword,
  recoverAccount,
  recoverAccountByRecoveryCode,
  regenerateRecoveryCode,
  registerAccount,
  resetPasswordByRecoveryCode,
  resetPasswordByWechat,
  upgradeLegacyAccount
} = require('../../../utils/account');
const { getAboutBannerMedia } = require('../../../utils/about');
const { withPageShare } = require('../../../utils/share');

const MODE_CONFIG = {
  login: { title: '账号登录', tip: '使用账号和密码登录', submitText: '登录' },
  register: { title: '注册账号', tip: '注册后会自动绑定当前微信，并生成恢复码', submitText: '注册' },
  upgrade: { title: '设置登录密码', tip: '老账号升级后，下次即可使用账号和密码登录', submitText: '完成升级' },
  'recover-account': { title: '找回账号', tip: '通过当前微信身份查找已绑定的账号', submitText: '查找我的账号' },
  'reset-password': { title: '找回密码', tip: '可通过当前微信或恢复码重置密码', submitText: '重置密码' },
  security: { title: '账号与安全', tip: '修改登录密码或重新生成恢复码', submitText: '修改密码' }
};

function normalizeMode(mode) {
  return MODE_CONFIG[mode] ? mode : 'login';
}

Page(withPageShare({
  data: {
    mode: 'login',
    modeTitle: MODE_CONFIG.login.title,
    modeTip: MODE_CONFIG.login.tip,
    submitText: MODE_CONFIG.login.submitText,
    currentUser: null,
    username: '',
    password: '',
    confirmPassword: '',
    currentPassword: '',
    recoveryCode: '',
    resetMethod: 'wechat',
    accountRecoveryMethod: 'wechat',
    wechatAccountStatus: 'idle',
    wechatBoundUsername: '',
    wechatAccountMessage: '',
    recoveredUsername: '',
    newRecoveryCode: '',
    recoveryDialogVisible: false,
    recoveryDialogRoute: 'home',
    isSubmitting: false,
    aboutShow: false,
    aboutVisible: false,
    aboutVideoUrl: '',
    aboutPosterUrl: '',
    aboutVideoReady: false,
    aboutVideoPlaying: false
  },

  onLoad(options = {}) {
    const currentUser = getCurrentUser();
    let mode = normalizeMode(options.mode);
    if (mode === 'security' && !currentUser) {
      mode = 'login';
    }
    if (currentUser && currentUser.hasPassword !== true && mode === 'login') {
      mode = 'upgrade';
    }
    this.applyMode(mode, {
      currentUser,
      username: currentUser ? currentUser.username : String(options.username || '').trim()
    });
  },

  onShow() {
    const currentUser = getCurrentUser();
    if (this.data.mode === 'login' && currentUser && currentUser.hasPassword === true) {
      getApp().setCurrentUser(currentUser);
      wx.switchTab({ url: '/pages/home/index' });
    }
  },

  applyMode(mode, patch = {}) {
    const normalizedMode = normalizeMode(mode);
    const config = MODE_CONFIG[normalizedMode];
    if (typeof wx.setNavigationBarTitle === 'function') {
      wx.setNavigationBarTitle({
        title: normalizedMode === 'login' ? '家物小记' : config.title
      });
    }
    this.setData({
      mode: normalizedMode,
      modeTitle: config.title,
      modeTip: config.tip,
      submitText: config.submitText,
      password: '',
      confirmPassword: '',
      currentPassword: '',
      recoveryCode: '',
      recoveredUsername: '',
      resetMethod: 'wechat',
      accountRecoveryMethod: 'wechat',
      wechatAccountStatus: normalizedMode === 'reset-password' ? 'loading' : 'idle',
      wechatBoundUsername: '',
      wechatAccountMessage: normalizedMode === 'reset-password' ? '正在识别当前微信...' : '',
      ...patch
    }, () => {
      if (normalizedMode === 'reset-password') {
        this.loadWechatBoundAccount();
      }
    });
  },

  switchMode(event) {
    const mode = normalizeMode(event.currentTarget.dataset.mode);
    wx.navigateTo({
      url: `/pages/auth/login/index?mode=${encodeURIComponent(mode)}`
    });
  },

  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [field]: event.detail.value });
  },

  chooseResetMethod(event) {
    const resetMethod = event.currentTarget.dataset.method;
    this.setData({
      resetMethod,
      recoveryCode: ''
    }, () => {
      if (resetMethod === 'wechat' && this.data.wechatAccountStatus !== 'bound') {
        this.loadWechatBoundAccount();
      }
    });
  },

  async loadWechatBoundAccount() {
    if (this._wechatAccountLoading) {
      return;
    }

    this._wechatAccountLoading = true;
    this.setData({
      wechatAccountStatus: 'loading',
      wechatBoundUsername: '',
      wechatAccountMessage: '正在识别当前微信...'
    });

    try {
      const result = await recoverAccount();
      if (result.ok && result.username) {
        this.setData({
          wechatAccountStatus: 'bound',
          wechatBoundUsername: result.username,
          wechatAccountMessage: ''
        });
        return;
      }

      this.setData({
        wechatAccountStatus: 'unbound',
        wechatBoundUsername: '',
        wechatAccountMessage: result.message || '当前微信尚未绑定账号，请使用恢复码'
      });
    } catch (error) {
      console.error('loadWechatBoundAccount failed', error);
      this.setData({
        wechatAccountStatus: 'error',
        wechatBoundUsername: '',
        wechatAccountMessage: '账号识别失败，请稍后重试'
      });
    } finally {
      this._wechatAccountLoading = false;
    }
  },

  chooseAccountRecoveryMethod(event) {
    this.setData({
      accountRecoveryMethod: event.currentTarget.dataset.method,
      recoveryCode: '',
      recoveredUsername: ''
    });
  },

  validateNewPassword() {
    const password = String(this.data.password || '');
    if (password.length < 8) {
      wx.showToast({ title: '密码至少需要8位', icon: 'none' });
      return false;
    }
    if (password !== String(this.data.confirmPassword || '')) {
      wx.showToast({ title: '两次输入的密码不一致', icon: 'none' });
      return false;
    }
    return true;
  },

  async submit() {
    if (this.data.isSubmitting) {
      return;
    }

    const handlers = {
      login: this.submitLogin,
      register: this.submitRegister,
      upgrade: this.submitUpgrade,
      'recover-account': this.submitRecoverAccount,
      'reset-password': this.submitResetPassword,
      security: this.submitChangePassword
    };
    const handler = handlers[this.data.mode];
    if (typeof handler !== 'function') {
      return;
    }

    this.setData({ isSubmitting: true });
    try {
      await handler.call(this);
    } catch (error) {
      console.error('auth submit failed', this.data.mode, error);
      wx.showToast({
        title: String(error && (error.errMsg || error.message) || '操作失败，请稍后再试').slice(0, 30),
        icon: 'none'
      });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  async submitLogin() {
    const username = String(this.data.username || '').trim();
    const password = String(this.data.password || '');
    if (!username || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' });
      return;
    }

    const result = await loginWithPassword(username, password);
    if (!result.ok) {
      if (result.code === 'PASSWORD_SETUP_REQUIRED') {
        const legacyUsername = encodeURIComponent(result.username || username);
        wx.navigateTo({
          url: `/pages/auth/login/index?mode=upgrade&username=${legacyUsername}`
        });
        wx.showToast({ title: '请先为老账号设置密码', icon: 'none' });
        return;
      }
      wx.showToast({ title: result.message || '账号或密码错误', icon: 'none' });
      return;
    }
    this.enterHome(result.user);
  },

  async submitRegister() {
    const username = String(this.data.username || '').trim();
    if (!username) {
      wx.showToast({ title: '请输入账号', icon: 'none' });
      return;
    }
    if (!this.validateNewPassword()) {
      return;
    }

    const result = await registerAccount(username, this.data.password);
    if (!result.ok) {
      wx.showToast({ title: result.message || '注册失败', icon: 'none' });
      return;
    }
    this.showRecoveryCode(result, 'home');
  },

  async submitUpgrade() {
    const username = String(this.data.username || '').trim();
    if (!username) {
      wx.showToast({ title: '请输入老账号', icon: 'none' });
      return;
    }
    if (!this.validateNewPassword()) {
      return;
    }

    const result = await upgradeLegacyAccount(username, this.data.password);
    if (!result.ok) {
      if (result.code === 'PASSWORD_ALREADY_SET') {
        this.applyMode('login', { username });
      }
      wx.showToast({ title: result.message || '账号升级失败', icon: 'none' });
      return;
    }
    this.showRecoveryCode(result, 'home');
  },

  async submitRecoverAccount() {
    let result;
    if (this.data.accountRecoveryMethod === 'code') {
      const recoveryCode = String(this.data.recoveryCode || '').trim();
      if (!recoveryCode) {
        wx.showToast({ title: '请输入恢复码', icon: 'none' });
        return;
      }
      result = await recoverAccountByRecoveryCode(recoveryCode);
    } else {
      result = await recoverAccount();
    }
    if (!result.ok) {
      wx.showToast({ title: result.message || '未找到绑定账号', icon: 'none' });
      return;
    }
    this.setData({ recoveredUsername: result.username || '' });
  },

  async submitResetPassword() {
    if (!this.validateNewPassword()) {
      return;
    }

    let result;
    if (this.data.resetMethod === 'code') {
      const recoveryCode = String(this.data.recoveryCode || '').trim();
      if (!recoveryCode) {
        wx.showToast({ title: '请输入恢复码', icon: 'none' });
        return;
      }
      result = await resetPasswordByRecoveryCode(recoveryCode, this.data.password);
    } else {
      result = await resetPasswordByWechat(this.data.password);
    }

    if (!result.ok) {
      wx.showToast({ title: result.message || '密码重置失败', icon: 'none' });
      return;
    }
    this.showRecoveryCode(result, 'home');
  },

  async submitChangePassword() {
    if (!String(this.data.currentPassword || '')) {
      wx.showToast({ title: '请输入当前密码', icon: 'none' });
      return;
    }
    if (!this.validateNewPassword()) {
      return;
    }

    const result = await changePassword(this.data.currentPassword, this.data.password);
    if (!result.ok) {
      wx.showToast({ title: result.message || '密码修改失败', icon: 'none' });
      return;
    }
    getApp().setCurrentUser(result.user);
    wx.showToast({ title: '密码已修改', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 500);
  },

  async createNewRecoveryCode() {
    if (this.data.isSubmitting) {
      return;
    }
    const currentPassword = String(this.data.currentPassword || '');
    if (!currentPassword) {
      wx.showToast({ title: '请先输入当前密码', icon: 'none' });
      return;
    }

    this.setData({ isSubmitting: true });
    try {
      const result = await regenerateRecoveryCode(currentPassword);
      if (!result.ok) {
        wx.showToast({ title: result.message || '生成失败', icon: 'none' });
        return;
      }
      this.showRecoveryCode(result, 'security');
    } catch (error) {
      wx.showToast({ title: '生成失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  showRecoveryCode(result, route) {
    if (result.user) {
      getApp().setCurrentUser(result.user);
    }
    this.setData({
      recoveredUsername: result.username || (result.user && result.user.username) || this.data.username,
      newRecoveryCode: result.recoveryCode || '',
      recoveryDialogRoute: route,
      recoveryDialogVisible: true
    });
  },

  copyRecoveryCode() {
    if (this.data.newRecoveryCode) {
      wx.setClipboardData({ data: this.data.newRecoveryCode });
    }
  },

  confirmRecoveryCodeSaved() {
    const route = this.data.recoveryDialogRoute;
    this.setData({ recoveryDialogVisible: false });
    if (route === 'home') {
      this.enterHome(getCurrentUser());
    }
  },

  useRecoveredAccount() {
    this.applyMode('login', { username: this.data.recoveredUsername });
  },

  enterHome(user) {
    if (user) {
      getApp().setCurrentUser(user);
    }
    wx.switchTab({ url: '/pages/home/index' });
  },

  async showAbout() {
    this.setData({ aboutShow: true });
    setTimeout(() => {
      this.setData({ aboutVisible: true });
    }, 30);

    try {
      const media = await getAboutBannerMedia();
      this.setData({
        aboutVideoUrl: media.videoUrl,
        aboutPosterUrl: media.posterUrl,
        aboutVideoReady: Boolean(media.videoUrl),
        aboutVideoPlaying: false
      });
    } catch (error) {
      console.error('getAboutBannerMedia failed', error);
      this.setData({
        aboutVideoReady: false,
        aboutVideoPlaying: false
      });
    }
  },

  hideAbout() {
    setTimeout(() => {
      this.setData({ aboutVisible: false });
      setTimeout(() => {
        this.setData({ aboutShow: false });
      }, 350);
    }, 50);
  },

  playAboutVideo() {
    if (!this.data.aboutVideoReady) {
      return;
    }

    this.setData({ aboutVideoPlaying: true });
    setTimeout(() => {
      const context = wx.createVideoContext('login-about-video', this);
      if (context && typeof context.play === 'function') {
        context.play();
      }
    }, 30);
  },

  onAboutVideoPlay() {
    this.setData({ aboutVideoPlaying: true });
  },

  onAboutVideoPause() {
    this.setData({ aboutVideoPlaying: false });
  },

  onAboutVideoEnded() {
    this.setData({ aboutVideoPlaying: false });
  },

  noop() {}
}, {
  enableTimeline: true
}));
