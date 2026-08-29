# Music Player — SillyTavern 音乐播放器插件

酒馆（SillyTavern）第三方扩展：一个悬浮小窗音乐播放器，顶部栏按钮打开，支持本地音乐与网络直链。

## 功能

- 顶部栏 🎵 按钮，播放时脉冲高亮
- 播放/暂停、上一首/下一首、随机、循环（关/列表/单曲）
- 进度条拖拽跳转、音量滑杆
- 播放列表：本地音频（IndexedDB 持久化）、网络直链
- 窗口可拖动、可最小化、可关闭，不占满屏幕

## 安装

1. 在酒馆「扩展 → 安装扩展（Install Extension）」粘贴本仓库 URL，安装。
2. 刷新/重启后，在扩展列表勾选 **Music Player** 启用。

或手动：把本目录复制到 `data/default-user/extensions/music-player/`（单用户）或
`public/scripts/extensions/third-party/music-player/`（全局），然后重启服务。

## 要求

- 现代版 SillyTavern（1.11+，manifest 格式）
