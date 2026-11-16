# 红树林修复区模拟

Canvas + WebAudio 的红树林修复模拟:布置幼苗、控制潮沟、拦截漂浮垃圾,
潮位决定幼苗被淹时间,90 天后存活率 ≥70% 即成功。

## 运行

直接用浏览器打开 `index.html`,或:

```
python3 -m http.server 8000   # 然后访问 http://localhost:8000
```

## 验证

```
node test_sim.js
```

无头验证:稳态、临界阈值事件、处置失败(拦污带风暴中断裂)、
干预前后指标对比、恢复确认期(固定 10 天,无隐藏残留)、
同一 seed 重开时目标位置与天气序列完全复现。

## 文件

- `sim.js` — 确定性模拟核心(纯逻辑,Node/浏览器通用)
- `app.js` — Canvas 渲染、UI、WebAudio(潮水随水位、鸟鸣随天气)
- `index.html` / `style.css` — 页面
- `test_sim.js` — 无头验证脚本
