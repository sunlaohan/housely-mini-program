Component({
  data: {
    selected: 0,
    hidden: false,
    list: [
      {
        pagePath: 'pages/home/index',
        text: '家',
        iconPath: '../assets/tabbar/home.png',
        selectedIconPath: '../assets/tabbar/home-active.png'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: '../assets/tabbar/profile.png',
        selectedIconPath: '../assets/tabbar/profile-active.png'
      }
    ]
  },

  lifetimes: {
    attached() {
      const app = getApp();
      const cachedSelected = app.globalData && app.globalData.tabBarSelected;
      const routeSelected = this.getSelectedByRoute();
      const selected = cachedSelected === 0 || cachedSelected === 1
        ? cachedSelected
        : (routeSelected >= 0 ? routeSelected : 0);

      if (app.globalData) {
        app.globalData.tabBarSelected = selected;
      }

      if (selected !== this.data.selected) {
        this.setData({ selected });
      }
    }
  },

  methods: {
    syncSelected(route) {
      const selected = this.getSelectedByRoute(route);
      if (selected < 0 || selected === this.data.selected) {
        return;
      }

      const app = getApp();
      if (app.globalData) {
        app.globalData.tabBarSelected = selected;
      }
      this.setTabBarState({ selected });
    },

    setTabBarState(nextState = {}) {
      const updates = {};

      if (Object.prototype.hasOwnProperty.call(nextState, 'selected')) {
        const selected = Number(nextState.selected);
        const app = getApp();
        if (!Number.isNaN(selected) && app.globalData) {
          app.globalData.tabBarSelected = selected;
        }
      }

      Object.keys(nextState).forEach((key) => {
        if (this.data[key] !== nextState[key]) {
          updates[key] = nextState[key];
        }
      });

      if (Object.keys(updates).length) {
        this.setData(updates);
      }
    },

    getCurrentRoute() {
      const pages = getCurrentPages();
      if (!pages.length) {
        return '';
      }

      return pages[pages.length - 1].route || '';
    },

    getSelectedByRoute(route) {
      const currentRoute = route || this.getCurrentRoute();
      return this.data.list.findIndex((item) => item.pagePath === currentRoute);
    },

    onSwitchTab(event) {
      if (this.switching) {
        return;
      }

      const { index, path } = event.currentTarget.dataset;
      const nextSelected = Number(index);

      if (Number.isNaN(nextSelected)) {
        return;
      }

      if (nextSelected === this.data.selected) {
        return;
      }

      this.switching = true;
      const previousSelected = this.data.selected;
      const app = getApp();
      if (app.globalData) {
        app.globalData.tabBarSelected = nextSelected;
      }
      this.setTabBarState({ selected: nextSelected });

      wx.switchTab({
        url: `/${path}`,
        fail: () => {
          if (app.globalData) {
            app.globalData.tabBarSelected = previousSelected;
          }
          this.setTabBarState({ selected: previousSelected });
        },
        complete: () => {
          this.switching = false;
        }
      });
    }
  }
});
