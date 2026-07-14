# PixShare — P2P 图片无损直传

点对点图片传输，**跳过微信压缩，不损失任何画质**。双方只需浏览器打开网页即可，无需安装任何软件。

## 使用方式

### 在线使用
打开 **[mapl1n.github.io/pixshare](https://mapl1n.github.io/pixshare/)** 即可使用。

### 发送图片
1. 打开网页 → 选择图片（支持多选、拖拽）
2. 点击「**开始分享**」→ 复制链接
3. 把链接通过微信发给好友

### 接收图片
1. 好友点开你发的链接
2. 自动建立 P2P 连接，开始接收图片
3. 接收完成后可在线查看 → 逐张保存或一键全部下载

## 原理

```
你的浏览器 ── P2P Data Channel ──→ 好友的浏览器
     ↑                                    ↑
     │  (图片数据直传，不经服务器)           │
     │                                    │
  PeerJS 信令服务器 (仅用于建立连接，不传输图片数据)
```

基于 **WebRTC**，浏览器与浏览器之间直接传输文件。信令服务器仅用于握手阶段，图片数据全程点对点传输，**不经过任何服务器**。

## 为什么不会压缩画质？

- 图片以原始二进制数据直接传输
- 不经过微信服务器，微信无法压缩
- 不经过任何第三方服务器
- 好友收到的文件和你电脑上的**一模一样，字节级完全一致**

## 支持的图片格式

JPG · PNG · HEIC · HEIF · WebP · GIF · BMP · AVIF · TIFF · SVG

## PWA 功能

- 可添加到手机主屏幕，像 App 一样使用
- 离线也可打开（首次访问后缓存界面）

## 与 Image Zipper 的区别

| | [Image Zipper](https://github.com/Mapl1n/image-zipper) | PixShare |
|------|:--:|:--:|
| 原理 | 图片打包成 ZIP 文件 | P2P 直传原始文件 |
| 发送方式 | 微信「文件」发 ZIP | 链接点开即连 |
| 好友体验 | 收到 ZIP 需解压 | 直接在线看图 ✅ |
| 需同时在线 | ❌ 异步发送 | ✅ 双方同时打开网页 |
| 文件大小限制 | 微信限制 ≤100MB/ZIP | 理论上无限制 |
| 适用场景 | 异步分享，好友随时下载 | 实时传输，即时查看 |

## 技术栈

- 纯 HTML + CSS + JavaScript，零框架，零构建步骤
- [PeerJS](https://peerjs.com/) — WebRTC 封装库
- GitHub Pages 托管，免费 HTTPS

## 本地运行

```bash
git clone https://github.com/Mapl1n/pixshare.git
cd pixshare
python -m http.server 8888
# 打开 http://localhost:8888
```
