# Doubao watermark remover

一个原生微信小程序，提供：

- 豆包公开分享链接无水印视频解析、预览和保存。
- 图片手动框选水印区域、OpenCV 修复、预览和保存。

## 本地运行

```powershell
Set-Location "D:\Code\微信去水印小程序\Doubao watermark remover"
.\backend\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

然后使用微信开发者工具打开项目根目录。详细需求、验收记录和公网化路线参见
[PROJECT_HANDOFF.md](PROJECT_HANDOFF.md)。

## 测试

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m unittest -v
```

## 当前边界

- 当前前端固定访问 `http://127.0.0.1:8000`，只适合本地开发。
- 视频解析依赖 BugPk 第三方服务，详见
  [backend/THIRD_PARTY_NOTICES.md](backend/THIRD_PARTY_NOTICES.md)。
- 图片结果当前只保留本机最新一份；面向多用户前需迁移到独立临时文件和对象存储。
- 仅处理自己拥有或已获授权使用的媒体。
