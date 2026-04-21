Component({
  options: {
    multipleSlots: true
  },

  properties: {
    text: {
      type: String,
      value: ''
    },
    variant: {
      type: String,
      value: 'dark'
    },
    widthMode: {
      type: String,
      value: 'full'
    },
    fixedWidth: {
      type: String,
      value: ''
    },
    loading: {
      type: Boolean,
      value: false
    },
    disabled: {
      type: Boolean,
      value: false
    },
    formType: {
      type: String,
      value: ''
    },
    openType: {
      type: String,
      value: ''
    }
  },

  data: {
    rootClassName: '',
    rootStyleText: ''
  },

  observers: {
    'variant, widthMode, fixedWidth, disabled'(variant, widthMode, fixedWidth, disabled) {
      const classNames = [
        'app-button',
        `app-button--${variant || 'dark'}`,
        `app-button--${widthMode || 'full'}`
      ];

      if (disabled) {
        classNames.push('app-button--disabled');
      }

      const styleText = widthMode === 'fixed' && fixedWidth
        ? `width: ${fixedWidth};`
        : '';

      this.setData({
        rootClassName: classNames.join(' '),
        rootStyleText: styleText
      });
    }
  },

  lifetimes: {
    attached() {
      const classNames = [
        'app-button',
        `app-button--${this.data.variant || 'dark'}`,
        `app-button--${this.data.widthMode || 'full'}`
      ];

      if (this.data.disabled) {
        classNames.push('app-button--disabled');
      }

      this.setData({
        rootClassName: classNames.join(' '),
        rootStyleText: this.data.widthMode === 'fixed' && this.data.fixedWidth
          ? `width: ${this.data.fixedWidth};`
          : ''
      });
    }
  },

  methods: {
    onTap(event) {
      this.triggerEvent('press', event.detail);
    },

    onChooseAvatar(event) {
      this.triggerEvent('chooseavatar', event.detail);
    }
  }
});
