Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(nextVisible) {
        if (nextVisible) {
          this.showSheet();
          return;
        }

        this.hideSheet();
      }
    },
    duration: {
      type: Number,
      value: 240
    }
  },

  data: {
    mounted: false,
    show: false
  },

  methods: {
    noop() {},

    showSheet() {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }

      this.setData({
        mounted: true
      });

      setTimeout(() => {
        this.setData({
          show: true
        });
      }, 16);
    },

    hideSheet() {
      if (!this.data.mounted) {
        return;
      }

      this.setData({
        show: false
      });

      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
      }

      this.hideTimer = setTimeout(() => {
        this.setData({
          mounted: false
        });
        this.hideTimer = null;
      }, this.data.duration);
    },

    onMaskTap() {
      this.triggerEvent('close');
    }
  },

  lifetimes: {
    detached() {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
    }
  }
});
