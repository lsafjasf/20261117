# 磁带修复工作台（Web Audio 实时合成）

纯 Web Audio 实现的 10 秒“受损磁带”合成与修复工作台，无任何音频素材文件：
所有声音（旋律、节拍、抖晃、咔哒声、底噪）均由 AudioWorklet 实时生成。

## 运行

AudioWorklet 要求 http(s) 协议，需通过本地服务器打开：

```bash
cd tape-repair
python3 -m http.server 8080
# 浏览器访问 http://127.0.0.1:8080/
```

## 功能

- 走带控制：播放、暂停（AudioContext 挂起，声音严格停止、无尾音）、重播、
  单步（每次精确推进一个 128 采样量子）、回到起点。
- 修复参数：带速、抖晃深度、咔哒/底噪量、去齿音（peaking 滤波）、
  陷波（notch 滤波）、噪声门（独立 worklet，带保持/释放包络）、输出增益。
- 三种试听：主输出（完整修复链）、旁路（干声直达）、静音，平滑切换无爆音。
- Canvas：实时波形、修复前/修复后频谱与峰值、节点链活动状态。
- 电平表：左右声道峰值 dB、声道差异、活动节点计数。
- 参数保存/重载：localStorage 持久化，带范围校验；重载后可自动播放。
- WAV 导出：16-bit PCM 立体声；任何削波样本都会阻止导出并提示降低增益。

## 验证

```bash
node test/node-test.mjs      # 纯逻辑：WAV 编解码、FFT 频段、节拍、参数校验
node test/browser-test.mjs    # Playwright 真实 Chromium 端到端验证
node test/screenshot.mjs      # 生成界面截图 test/screenshot.png
```

端到端验证覆盖：

- 三个以上维度随操作真实变化：频段能量（陷波/去齿音）、节拍间隔（带速）、
  左右声道平衡，外加导出时长随带速变化。
- 节拍漂移：最大间隔偏差 < 20 ms。
- 削波：增益 1.5 时可检出削波样本并阻断导出；默认参数零削波。
- WAV 回读：时长、声道数、关键峰值与渲染结果一致。
- 参数保存→重载→再次导出：两次导出的时长、左右声道峰值、平衡全部一致。
- 节点生命周期：验证用引擎 14 个节点拆除后剩余 0，无未关闭节点。
- 暂停：context 进入 suspended，暂停态离线渲染峰值为 0，无尾音。

## 文件结构

- `js/worklet-tape.js`：磁带合成源 worklet（确定性 PRNG，同参数可复现）。
- `js/worklet-gate.js`：立体声噪声门 worklet。
- `js/audio-engine.js`：实时图与离线渲染共用同一套建图逻辑。
- `js/metrics.js`：FFT 频段能量、节拍检测、峰值/削波、声道平衡。
- `js/wav-encoder.js`：16-bit PCM WAV 编码与回读解码。
- `js/verification.js`：离线渲染驱动的验证套件与导出对比。
- `js/draw.js`：波形、频谱、节点链 Canvas 渲染。
- `js/params.js`：参数 schema、默认值、localStorage 持久化。
- `js/app.js`：UI 绑定与导出流程。
