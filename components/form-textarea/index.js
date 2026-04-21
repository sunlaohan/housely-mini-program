Component({
  properties: {
    label: {
      type: String,
      value: ''
    },
    value: {
      type: String,
      value: ''
    },
    placeholder: {
      type: String,
      value: '请输入'
    },
    required: {
      type: Boolean,
      value: false
    },
    maxlength: {
      type: Number,
      value: 200
    },
    showDivider: {
      type: Boolean,
      value: true
    },
    disabled: {
      type: Boolean,
      value: false
    }
  },

  data: {
    currentLength: 0
  },

  observers: {
    value(nextValue) {
      this.setData({
        currentLength: String(nextValue || '').length
      });
    }
  },

  methods: {
    onInput(event) {
      const value = event.detail.value;
      this.triggerEvent('change', { value });
    }
  }
});
