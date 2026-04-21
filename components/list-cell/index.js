Component({
  properties: {
    title: {
      type: String,
      value: ''
    },
    note: {
      type: String,
      value: ''
    },
    value: {
      type: String,
      value: ''
    },
    danger: {
      type: Boolean,
      value: false
    },
    showDivider: {
      type: Boolean,
      value: true
    },
    arrow: {
      type: Boolean,
      value: true
    },
    centered: {
      type: Boolean,
      value: true
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('press');
    }
  }
});
