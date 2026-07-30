const API_BASE = "http://127.0.0.1:8000";

Page({
  data: {
    mode: "video",
    shareText: "",
    parsing: false,
    videoResult: null,
    savingVideo: false,
    imagePath: "",
    imageWidth: 0,
    imageHeight: 0,
    selection: null,
    repairing: false,
    resultUrl: "",
    savingImage: false
  },

  switchMode(e) {
    if (!this.data.parsing && !this.data.repairing) {
      this.setData({ mode: e.currentTarget.dataset.mode });
    }
  },

  onShareInput(e) {
    this.setData({ shareText: e.detail.value });
  },

  pasteLink() {
    wx.getClipboardData({
      success: ({ data }) => this.setData({ shareText: data || "" }),
      fail: () => wx.showToast({ title: "读取剪贴板失败", icon: "none" })
    });
  },

  clearLink() {
    if (!this.data.parsing) {
      this.setData({ shareText: "", videoResult: null });
    }
  },

  parseVideo() {
    const text = this.data.shareText.trim();
    if (this.data.parsing) return;
    if (!text) {
      wx.showToast({ title: "请先粘贴豆包分享链接", icon: "none" });
      return;
    }
    this.setData({ parsing: true });
    wx.request({
      url: `${API_BASE}/api/video/parse`,
      method: "POST",
      data: { text },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          this.setData({ videoResult: res.data });
        } else {
          this.showError(res.data, "解析失败，请检查链接后重试");
        }
      },
      fail: () => this.showError(null, "连接不到本地服务，请先启动后端"),
      complete: () => this.setData({ parsing: false })
    });
  },

  saveVideo() {
    const url = this.data.videoResult && this.data.videoResult.url;
    if (!url || this.data.savingVideo) return;
    this.setData({ savingVideo: true });
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200) {
          this.showError(null, "视频下载失败，请重试");
          this.setData({ savingVideo: false });
          return;
        }
        wx.saveVideoToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: "已保存到相册" }),
          fail: () => this.showError(null, "保存失败，请检查相册权限"),
          complete: () => this.setData({ savingVideo: false })
        });
      },
      fail: () => {
        this.showError(null, "视频下载失败，请重试");
        this.setData({ savingVideo: false });
      }
    });
  },

  chooseImage() {
    if (this.data.repairing) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      success: ({ tempFiles }) => {
        const path = tempFiles[0].tempFilePath;
        wx.getImageInfo({
          src: path,
          success: (info) => this.setData({
            imagePath: path,
            imageWidth: info.width,
            imageHeight: info.height,
            selection: null,
            resultUrl: ""
          }),
          fail: () => this.showError(null, "图片读取失败，请换一张图片")
        });
      }
    });
  },

  onImageLoad() {
    wx.createSelectorQuery()
      .select("#selection-stage")
      .boundingClientRect((rect) => {
        this.imageRect = rect;
      })
      .exec();
  },

  selectionStart(e) {
    if (!this.imageRect || this.data.repairing) return;
    const point = this.touchPoint(e.touches[0]);
    this.dragStart = point;
    this.setData({
      selection: { left: point.x, top: point.y, width: 0, height: 0 }
    });
  },

  selectionMove(e) {
    if (!this.dragStart || !this.imageRect) return;
    const point = this.touchPoint(e.touches[0]);
    const left = Math.min(this.dragStart.x, point.x);
    const top = Math.min(this.dragStart.y, point.y);
    this.setData({
      selection: {
        left,
        top,
        width: Math.abs(point.x - this.dragStart.x),
        height: Math.abs(point.y - this.dragStart.y)
      }
    });
  },

  selectionEnd(e) {
    if (e.changedTouches[0]) this.selectionMove({ touches: e.changedTouches });
    this.dragStart = null;
  },

  touchPoint(touch) {
    return {
      x: Math.max(0, Math.min(this.imageRect.width, touch.clientX - this.imageRect.left)),
      y: Math.max(0, Math.min(this.imageRect.height, touch.clientY - this.imageRect.top))
    };
  },

  clearSelection() {
    if (!this.data.repairing) this.setData({ selection: null, resultUrl: "" });
  },

  repairImage() {
    const selection = this.data.selection;
    const rect = this.imageRect;
    if (this.data.repairing) return;
    if (!selection || selection.width < 2 || selection.height < 2 || !rect) {
      wx.showToast({ title: "请先拖动框选水印区域", icon: "none" });
      return;
    }
    const x = Math.round(selection.left / rect.width * this.data.imageWidth);
    const y = Math.round(selection.top / rect.height * this.data.imageHeight);
    const width = Math.min(
      this.data.imageWidth - x,
      Math.round(selection.width / rect.width * this.data.imageWidth)
    );
    const height = Math.min(
      this.data.imageHeight - y,
      Math.round(selection.height / rect.height * this.data.imageHeight)
    );
    if (width < 8 || height < 8) {
      wx.showToast({ title: "框选区域太小，请重新框选", icon: "none" });
      return;
    }
    this.setData({ repairing: true });
    wx.uploadFile({
      url: `${API_BASE}/api/image/inpaint`,
      filePath: this.data.imagePath,
      name: "image",
      formData: { x, y, width, height },
      success: (res) => {
        let data;
        try {
          data = JSON.parse(res.data);
        } catch (_) {
          data = null;
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && data) {
          const url = data.url.startsWith("http") ? data.url : `${API_BASE}${data.url}`;
          this.setData({ resultUrl: `${url}?t=${Date.now()}` });
        } else {
          this.showError(data, "修复失败，请调整框选区域后重试");
        }
      },
      fail: () => this.showError(null, "连接不到本地服务，请先启动后端"),
      complete: () => this.setData({ repairing: false })
    });
  },

  saveImage() {
    if (!this.data.resultUrl || this.data.savingImage) return;
    this.setData({ savingImage: true });
    wx.downloadFile({
      url: this.data.resultUrl,
      success: (res) => {
        if (res.statusCode !== 200) {
          this.showError(null, "结果图片下载失败");
          this.setData({ savingImage: false });
          return;
        }
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: "已保存到相册" }),
          fail: () => this.showError(null, "保存失败，请检查相册权限"),
          complete: () => this.setData({ savingImage: false })
        });
      },
      fail: () => {
        this.showError(null, "结果图片下载失败");
        this.setData({ savingImage: false });
      }
    });
  },

  showError(data, fallback) {
    wx.showToast({
      title: data && typeof data.detail === "string" ? data.detail : fallback,
      icon: "none",
      duration: 2600
    });
  }
});
