# PixShare — P2P 图片无损直传

**纯 WebRTC 手动 SDP 交换，零服务器依赖，永不掉线，永远不断连。**

双方只需浏览器打开网页，交换两段文本即可建立 P2P 连接，原图直传。

## 工作原理

不使用信令服务器，通过**手动交换 SDP** 建立 WebRTC P2P 连接：

```
发送方                                      接收方
  │                                           │
  │ ① 选图 → 生成 Offer                       │
  │   复制 Offer → 微信发给好友                 │
  │                                    ② 粘贴 Offer → 生成 Answer
  │                                      复制 Answer → 微信发回
  │ ③ 粘贴 Answer ←─────────────────────────  │
  │                                           │
  │ ═══════════ P2P 直传原图 ═══════════════════→
  │                                           │
  │                             ④ 在线看原图/一键保存
```

## 使用方式

**发送方：**

1. 打开 https://mapl1n.github.io/pixshare/
2. 选择图片 → 点「生成链接，发送给好友」
3. 点「复制文本发给好友」→ 到微信粘贴发给好友
4. 等待好友回传 Answer → 粘贴 → 点「完成连接」
5. P2P 连接建立，图片自动传输 ✅

**接收方（好友）：**

1. 打开同一个网址 https://mapl1n.github.io/pixshare/
2. 往下拉到「我是接收方」→ 粘贴发送方的 Offer → 点「连接发送方」
3. 点「复制 Answer 发回给对方」→ 到微信粘贴发给发送方
4. 连接建立 → 自动接收原图 → 在线查看 / 全部保存 ✅

## 为什么 100% 可靠？

- **不依赖任何信令服务器** — SDP 交换通过微信文字完成
- **不依赖 PeerJS Cloud** — 纯浏览器 WebRTC API
- **没有「Session ID」** — 不存在 ID 被释放的问题
- **微信只管传文字** — SDP 文本就几 KB，微信发文字不压缩

## 画质保证

- P2P Data Channel 传输原始二进制数据
- 不经过微信图片通道
- 好友收到的文件与你的原图**字节完全一致**

## 支持的图片格式

JPG · PNG · HEIC · HEIF · WebP · GIF · BMP · AVIF · TIFF · SVG

## 技术栈

- 纯 HTML + CSS + JavaScript，零框架
- 浏览器原生 **RTCPeerConnection** + **RTCDataChannel**
- Google STUN 服务器（仅 NAT 穿透用，不传输数据）
- GitHub Pages 托管

## 本地运行

```bash
git clone https://github.com/Mapl1n/pixshare.git
cd pixshare
python -m http.server 8888
```
