// app.js
App({
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: "当前微信版本过低",
        content: "请升级微信后重新打开小程序",
        showCancel: false
      });
      return;
    }
    wx.cloud.init({
      env: "cloud1-d6g62xhtcd0751ff6",
      traceUser: true
    });
  }
});
