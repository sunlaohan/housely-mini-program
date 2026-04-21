Component({
  properties: {
    label: {
      type: String,
      value: ''
    },
    items: {
      type: Array,
      value: []
    },
    maxCount: {
      type: Number,
      value: 9
    },
    showDivider: {
      type: Boolean,
      value: false
    },
    disabled: {
      type: Boolean,
      value: false
    },
    addIcon: {
      type: String,
      value: ''
    }
  },

  methods: {
    onAdd() {
      if (this.data.disabled) {
        return;
      }

      this.triggerEvent('add');
    },

    onRemove(event) {
      this.triggerEvent('remove', {
        key: event.currentTarget.dataset.key
      });
    },

    onPreview(event) {
      this.triggerEvent('preview', {
        key: event.currentTarget.dataset.key
      });
    }
  }
});
