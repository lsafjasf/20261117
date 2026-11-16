// Round-trip support: parse the metadata embedded by serializeSVG so an
// exported SVG can restore the exact scene/view without external files.

export function parseEmbeddedState(svgText) {
  if (typeof svgText !== 'string' || svgText.trim().length === 0) {
    return { ok: false, reason: 'SVG 内容为空' };
  }
  const match = svgText.match(
    /<metadata id="typo-studio-state"[^>]*>([\s\S]*?)<\/metadata>/
  );
  if (!match) {
    return { ok: false, reason: 'SVG 中未找到 typo-studio 状态元数据' };
  }
  try {
    const json = match[1]
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"');
    const payload = JSON.parse(json);
    if (!payload.scene || !Array.isArray(payload.scene.layers)) {
      throw new Error('元数据缺少 scene.layers');
    }
    return { ok: true, scene: payload.scene, view: payload.view };
  } catch (error) {
    return { ok: false, reason: `元数据解析失败：${error.message}` };
  }
}
