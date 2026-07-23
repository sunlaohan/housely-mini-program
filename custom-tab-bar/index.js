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
      const app = getApp();
      const pendingRoute = app.globalData && app.globalData.pendingTabRoute;
      this.syncSelected(pendingRoute || this.getCurrentRoute());

      if (pendingRoute && app.globalData) {
        app.globalData.pendingTabRoute = '';
      }
    }
  },

  pageLifetimes: {
    show() {
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

      // The target tab bar is a fresh component instance. Pass its selected
      // route before switching so it never renders one frame with the home
      // tab's default selection.
      getApp().globalData.pendingTabRoute = path;

      wx.switchTab({
        url: `/${path}`,
        fail: () => {
          getApp().globalData.pendingTabRoute = '';
          this.syncSelected();
        }
      });
    }
  }
});
