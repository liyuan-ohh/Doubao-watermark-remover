const cloud = require("wx-server-sdk");
const fetch = require("node-fetch");
const FormData = require("form-data");
const crypto = require("crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const CLOUDRUN_ORIGIN = "https://doubao1-297682-7-1463813300.sh.run.tcloudbase.com";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function fail(message) {
  const error = new Error(message);
  error.expose = true;
  throw error;
}

async function responseJson(response, fallback) {
  let data = null;
  try {
    data = await response.json();
  } catch (_) {}
  if (!response.ok) {
    fail(data && typeof data.detail === "string" ? data.detail : fallback);
  }
  return data;
}

async function readLimited(response, maxBytes, fallbackType) {
  if (!response.ok) fail("云端文件下载失败，请稍后重试");
  const announced = Number(response.headers.get("content-length") || 0);
  if (announced > maxBytes) fail("文件过大，暂不支持处理");
  const buffer = await response.buffer();
  if (buffer.length > maxBytes) fail("文件过大，暂不支持处理");
  return {
    buffer,
    contentType: (response.headers.get("content-type") || fallbackType).split(";", 1)[0]
  };
}

function objectPath(openid, category, extension) {
  const suffix = crypto.randomBytes(8).toString("hex");
  return `users/${openid}/${category}/${Date.now()}-${suffix}.${extension}`;
}

async function uploadResult(openid, category, extension, buffer) {
  const uploaded = await cloud.uploadFile({
    cloudPath: objectPath(openid, category, extension),
    fileContent: buffer
  });
  const signed = await cloud.getTempFileURL({
    fileList: [uploaded.fileID]
  });
  const item = signed.fileList && signed.fileList[0];
  if (!item || item.status !== 0 || !item.tempFileURL) {
    fail("结果文件生成失败，请重试");
  }
  return { fileID: uploaded.fileID, tempFileURL: item.tempFileURL };
}

async function parseVideo(event, openid) {
  const text = typeof event.text === "string" ? event.text.trim() : "";
  if (!text || text.length > 2000) fail("请粘贴有效的豆包分享链接");
  const parsedResponse = await fetch(`${CLOUDRUN_ORIGIN}/api/video/parse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    timeout: 15000
  });
  const parsed = await responseJson(parsedResponse, "解析失败，请检查链接后重试");
  if (!parsed || typeof parsed.url !== "string" || !parsed.url.startsWith("https://")) {
    fail("解析服务返回异常，请稍后重试");
  }
  const source = await fetch(parsed.url, { timeout: 60000 });
  const media = await readLimited(source, MAX_VIDEO_BYTES, "video/mp4");
  const result = await uploadResult(openid, "video", "mp4", media.buffer);
  return { ...result, contentType: media.contentType };
}

async function repairImage(event, openid) {
  if (typeof event.fileID !== "string" || !event.fileID.startsWith("cloud://")) {
    fail("请先选择图片");
  }
  const numbers = ["x", "y", "width", "height"].map((key) => Number(event[key]));
  if (!numbers.every(Number.isInteger)) fail("框选区域无效，请重新框选");
  const [x, y, width, height] = numbers;
  const downloaded = await cloud.downloadFile({ fileID: event.fileID });
  if (!downloaded.fileContent || downloaded.fileContent.length > MAX_IMAGE_BYTES) {
    fail("图片不能超过 15MB");
  }
  const form = new FormData();
  form.append("image", downloaded.fileContent, {
    filename: "source.png",
    contentType: "application/octet-stream"
  });
  form.append("x", String(x));
  form.append("y", String(y));
  form.append("width", String(width));
  form.append("height", String(height));
  const repairedResponse = await fetch(`${CLOUDRUN_ORIGIN}/api/image/inpaint`, {
    method: "POST",
    headers: form.getHeaders(),
    body: form,
    timeout: 30000
  });
  const repaired = await responseJson(repairedResponse, "修复失败，请调整框选区域后重试");
  if (!repaired || typeof repaired.url !== "string" || !repaired.url.startsWith("/files/")) {
    fail("修复服务返回异常，请重试");
  }
  const resultResponse = await fetch(`${CLOUDRUN_ORIGIN}${repaired.url}`, { timeout: 15000 });
  const resultImage = await readLimited(resultResponse, MAX_IMAGE_BYTES, "image/png");
  return uploadResult(openid, "image", "png", resultImage.buffer);
}

exports.main = async (event) => {
  if (event && event.action === "health") return { ok: true };
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) fail("无法识别当前微信用户，请重新进入小程序");
  try {
    if (event.action === "parseVideo") return await parseVideo(event, OPENID);
    if (event.action === "repairImage") return await repairImage(event, OPENID);
    fail("不支持的操作");
  } catch (error) {
    console.error("mediaGateway failed", {
      action: event && event.action,
      message: error && error.message
    });
    throw new Error(error && error.expose ? error.message : "云端服务暂时不可用，请稍后重试");
  } finally {
    if (event && event.action === "repairImage" && typeof event.fileID === "string") {
      await cloud.deleteFile({ fileList: [event.fileID] }).catch(() => {});
    }
  }
};
