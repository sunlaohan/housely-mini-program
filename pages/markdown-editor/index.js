function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 20;
  const windowHeight = systemInfo.windowHeight || 667;

  const buildMetrics = (navBarHeight) => {
    const navSafeHeight = statusBarHeight + navBarHeight;
    const actionTop = navSafeHeight + 8;
    const editorContentTop = actionTop + 44;
    return {
      statusBarHeight,
      navBarHeight,
      actionTop,
      editorContentTop,
      windowHeight,
      editorHeight: windowHeight - editorContentTop
    };
  };

  if (!wx.getMenuButtonBoundingClientRect) {
    return buildMetrics(44);
  }

  const menuRect = wx.getMenuButtonBoundingClientRect();
  const navBarHeight = (menuRect.top - statusBarHeight) * 2 + menuRect.height;
  return buildMetrics(navBarHeight);
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    actionTop: 72,
    editorContentTop: 116,
    windowHeight: 667,
    editorHeight: 551,
    keyboardHeight: 0,
    value: '',
    editing: true,
    inputFocus: false,
    leaveConfirmVisible: false
  },

  onLoad() {
    this.setData(getNavMetrics());
    const eventChannel = this.getOpenerEventChannel();
    eventChannel.on('initMarkdown', ({ value }) => {
      const initialValue = String(value || '');
      this.setData({ value: initialValue });
      this.initialValue = initialValue;
      this.draftValue = initialValue;
    });
  },

  onReady() {
    setTimeout(() => {
      if (this.data.editing) {
        this.setData({ inputFocus: true });
      }
    }, 80);
  },

  onInput(event) {
    // Do not call setData for each keystroke. On iOS this re-renders the
    // controlled textarea while a Chinese candidate is being confirmed and
    // moves the caret to the end of the content.
    this.draftValue = event.detail.value || '';
  },

  onKeyboardHeightChange(event) {
    const keyboardHeight = Number(event.detail && event.detail.height) || 0;
    this.setData({
      keyboardHeight,
      editorHeight: Math.max(0, this.data.windowHeight - this.data.editorContentTop - keyboardHeight)
    });
  },

  finishEditing() {
    this.setData({
      value: this.getCurrentValue(),
      editing: false,
      inputFocus: false,
      keyboardHeight: 0,
      editorHeight: this.data.windowHeight - this.data.editorContentTop
    });
    wx.hideKeyboard();
  },

  resumeEditing() {
    this.setData({
      editing: true,
      inputFocus: false
    }, () => {
      setTimeout(() => this.setData({ inputFocus: true }), 30);
    });
  },

  saveEditor() {
    this.getOpenerEventChannel().emit('saveMarkdown', { value: this.getCurrentValue() });
    wx.navigateBack();
  },

  exitEditor() {
    if (this.getCurrentValue() === (this.initialValue || '')) {
      wx.navigateBack();
      return;
    }

    this._leaveFromEditing = this.data.editing;
    if (this.data.editing) {
      this.setData({ inputFocus: false });
      wx.hideKeyboard();
    }
    this.setData({ leaveConfirmVisible: true });
  },

  cancelLeave() {
    this.setData({ leaveConfirmVisible: false }, () => {
      if (this._leaveFromEditing) {
        this.resumeEditing();
      }
      this._leaveFromEditing = false;
    });
  },

  discardAndExit() {
    this.setData({ leaveConfirmVisible: false }, () => {
      wx.navigateBack();
    });
  },

  saveAndExit() {
    this.setData({ leaveConfirmVisible: false }, () => {
      this.saveEditor();
    });
  },

  getCurrentValue() {
    return typeof this.draftValue === 'string' ? this.draftValue : this.data.value;
  },

  onBackPress() {
    this.exitEditor();
    return true;
  }
});
