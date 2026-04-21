Component({
  data: {
    selected: 0,
    hidden: false,
    list: [
      {
        pagePath: 'pages/home/index',
        text: '家',
        iconPath: '../assets/auth/wap-home-o.svg',
        selectedIconPath: '../assets/auth/wap-home.svg'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: '../assets/auth/smile-o.svg',
        selectedIconPath: '../assets/auth/smile.svg'
      }
    ]
  },

  lifetimes: {
    attached() {
      this.syncSelected();
    }
  },

  methods: {
    syncSelected(route) {
      const currentRoute = route || this.getCurrentRoute();
      const selected = this.data.list.findIndex((item) => item.pagePath === currentRoute);
      if (selected < 0 || selected === this.data.selected) {
        if (selected < 0) {
          return;
        }

        return;
      }

      this.setData({ selected });
    },

    getCurrentRoute() {
      const pages = getCurrentPages();
      if (!pages.length) {
        return '';
      }

      return pages[pages.length - 1].route || '';
    },

    onSwitchTab(event) {
      const { index, path } = event.currentTarget.dataset;
      const nextSelected = Number(index);

      if (Number.isNaN(nextSelected)) {
        return;
      }

      if (nextSelected === this.data.selected) {
        return;
      }

      this.setData({
        selected: nextSelected
      });

      wx.switchTab({
        url: `/${path}`
      });
    }
  }
});
