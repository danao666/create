# 合成大耄耋

一个基于浏览器的休闲合成小游戏。将两只同级猫咪碰到一起，合成为更大一级；持续投放、合成并避免猫咪堆过危险线。

## 开发

需要 Node.js 20.19+ 或 22.12+。

```sh
npm ci
npm run dev
```

Vite 会在终端显示本地开发地址。生产构建使用 `npm run build`，本地预览构建结果使用 `npm run preview`。

## 操作

- 移动鼠标并点击投放，触屏可直接点按。
- 使用 ← →（或 A、D）移动瞄准位置，空格投放。
- 历史最高分保存在浏览器本地。

## 游戏代码

物理模拟使用 Matter.js。圆形碰撞体、合成等级和占位外观集中在 `src/main.js` 的 `CAT_STAGES` 配置中；将 emoji 占位符替换成实际插图即可接入贴图。界面和画布样式在 `src/style.css`。

玩法参考：

- [kairess/suika-game](https://github.com/kairess/suika-game) — Matter.js 实现的 Suika Game 克隆，可参考下落物理、碰撞升级和画面边界设计。
- [paulantoine2/suika](https://github.com/paulantoine2/suika) — 上述项目 README 指向的原始实现。

当前仓库重新实现了游戏逻辑，没有复制参考项目的源代码或图片资源。
