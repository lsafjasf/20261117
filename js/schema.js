export const SCHEMA_ID = "mise.restaurant-menu";
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = "mise.menu.autosave.v1";
export const SAVED_KEY = "mise.menu.saved.v1";

export const PAGE_PRESETS = {
  "a4-portrait": { width: 1240, height: 1754, margin: 88 },
  "a4-landscape": { width: 1754, height: 1240, margin: 88 },
  "a5-portrait": { width: 874, height: 1240, margin: 66 },
  square: { width: 1240, height: 1240, margin: 80 },
  custom: null,
};

export const PAPER_TONES = {
  cream: {
    background: "#f4eee1",
    ink: "#1f2a23",
    muted: "#6f746b",
    line: "#d8cdb8",
    soft: "#ece2d0",
    motif: "#c9b898",
  },
  white: {
    background: "#fbfaf5",
    ink: "#202821",
    muted: "#777b74",
    line: "#ddd9cb",
    soft: "#f0ede4",
    motif: "#d5cfbe",
  },
  sage: {
    background: "#e8ebdf",
    ink: "#26332a",
    muted: "#6b766c",
    line: "#c8d0c1",
    soft: "#dce3d5",
    motif: "#aebca8",
  },
  ink: {
    background: "#1c2721",
    ink: "#f1ecdf",
    muted: "#b5b8ad",
    line: "#405146",
    soft: "#28372e",
    motif: "#53685a",
  },
};

export const ALLERGEN_TERMS = [
  "麸质",
  "小麦",
  "乳",
  "奶",
  "蛋",
  "鱼",
  "虾",
  "蟹",
  "贝",
  "花生",
  "坚果",
  "大豆",
  "芝麻",
  "亚硫酸",
  "芥末",
  "芹菜",
  "羽扇豆",
  "软体动物",
  "过敏原",
  "gluten",
  "dairy",
  "milk",
  "egg",
  "fish",
  "shellfish",
  "peanut",
  "nut",
  "soy",
  "sesame",
];

const STANDARD_ITEMS = [
  {
    name: "炭烤春鸡",
    description: "自制味噌、焦糖小洋葱、烤时蔬",
    price: "128",
    tags: ["含麸质", "大豆"],
  },
  {
    name: "松露菌菇烩饭",
    description: "意大利米、牛肝菌、帕玛森芝士、黑松露",
    price: "98",
    tags: ["含乳制品"],
  },
  {
    name: "青柠海鲈鱼",
    description: "香煎海鲈、青柠黄油汁、季节嫩叶",
    price: "138",
    tags: ["含鱼", "含乳制品"],
  },
  {
    name: "烟熏南瓜汤",
    description: "烤南瓜、椰浆、烘烤南瓜籽、香草油",
    price: "48",
    tags: ["纯素"],
  },
  {
    name: "红油抄手",
    description: "手工猪肉馅、花椒红油、熟芝麻",
    price: "52",
    tags: ["含麸质", "含芝麻"],
  },
  {
    name: "炭火和牛",
    description: "谷饲和牛、烤芦笋、黑椒汁",
    price: "258",
    tags: ["含乳制品"],
  },
  {
    name: "柚子冰霜",
    description: "鲜榨柚子、蜂蜜、薄荷",
    price: "38",
    tags: ["纯素"],
  },
  {
    name: "桂花酒酿",
    description: "酒酿、小圆子、桂花蜜",
    price: "32",
    tags: ["含麸质"],
  },
];

const EXTREME_ITEMS = [
  {
    name: "慢烤香草柠檬填馅春鸡配焦糖小洋葱与山野菌菇汁",
    description:
      "选用本地散养春鸡，以迷迭香、百里香与柠檬皮低温腌渍十二小时，炭火慢烤至表皮金黄，搭配焦糖小洋葱、烤根茎蔬菜与山野菌菇熬制的浓郁酱汁。",
    price: "168",
    tags: ["含乳制品", "含麸质", "含芹菜", "含亚硫酸盐"],
  },
  {
    name: "黑松露帕玛森菌菇烩饭",
    description: "意大利卡纳罗利米、牛肝菌、鸡油菌、帕玛森芝士与现刨黑松露。",
    price: "128",
    tags: ["含乳制品"],
  },
  {
    name: "青柠黄油香煎海鲈鱼配季节嫩叶与烤南瓜泥",
    description:
      "海鲈鱼柳香煎至外皮酥脆，佐以青柠黄油汁、烤南瓜泥、嫩菠菜与烘烤南瓜籽。鱼类过敏的宾客请避免选择此道菜，并请提前告知服务人员。",
    price: "198",
    tags: ["含鱼", "含乳制品", "含坚果"],
  },
  {
    name: "炭火谷饲和牛西冷配黑椒汁与烤芦笋",
    description: "谷饲和牛、烤绿芦笋、黑胡椒汁、海盐与烟熏黄油。",
    price: "328",
    tags: ["含乳制品"],
  },
  {
    name: "桂花酒酿小圆子",
    description: "酒酿、糯米小圆子、桂花蜜与枸杞。",
    price: "42",
    tags: ["含麸质"],
  },
];

const TINY_ITEMS = [
  {
    name: "春鸡",
    description: "炭烤 · 时蔬 · 味噌汁",
    price: "88",
    tags: ["含麸质"],
  },
  {
    name: "菌菇饭",
    description: "牛肝菌 · 帕玛森",
    price: "68",
    tags: ["含乳制品"],
  },
  {
    name: "南瓜汤",
    description: "椰浆 · 南瓜籽",
    price: "38",
    tags: ["纯素"],
  },
  {
    name: "柚子冰",
    description: "鲜柚 · 薄荷",
    price: "28",
    tags: ["纯素"],
  },
];

export function makeDocument(overrides = {}) {
  return normalizeDocument({
    schema: SCHEMA_ID,
    version: SCHEMA_VERSION,
    restaurant: "青禾小馆",
    headline: "晚 市 菜 单",
    subheading: "一席山野，四时有味 · 每日现做",
    note: "如有食物过敏，请在点单前告知服务人员。红色标签为过敏原提示。",
    currency: "¥",
    page: {
      preset: "a4-portrait",
      width: 1240,
      height: 1754,
      margin: 88,
    },
    theme: {
      accent: "#ad4a32",
      motif: "arch",
      paper: "cream",
    },
    items: STANDARD_ITEMS,
    ...overrides,
  });
}

export function makeSample(kind) {
  if (kind === "extreme") {
    return normalizeDocument({
      ...makeDocument(),
      headline: "山 海 与 季 节",
      subheading: "一份为长名称与详细过敏原说明准备的晚市菜单",
      page: { preset: "a4-portrait", width: 1240, height: 1754, margin: 70 },
      items: EXTREME_ITEMS,
    });
  }
  if (kind === "tiny") {
    return normalizeDocument({
      ...makeDocument(),
      restaurant: "青禾",
      headline: "小 菜 单",
      subheading: "MINI · 360 × 520",
      note: "红色为过敏原提示。",
      page: { preset: "custom", width: 360, height: 520, margin: 26 },
      items: TINY_ITEMS,
    });
  }
  return makeDocument();
}

function makeId() {
  return `dish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeItem(item = {}) {
  const rawTags = Array.isArray(item.tags) ? item.tags : String(item.tags || "").split(/[,，、]/);
  return {
    id: String(item.id || makeId()),
    name: String(item.name ?? ""),
    description: String(item.description ?? ""),
    price: String(item.price ?? ""),
    tags: rawTags.map((tag) => String(tag).trim()).filter(Boolean),
  };
}

export function normalizeDocument(input) {
  const source = input?.document && typeof input.document === "object" ? input.document : input;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("JSON 根节点必须是菜单对象。");
  }
  if (!Array.isArray(source.items)) {
    throw new Error("缺少 items 数组，无法恢复菜品。");
  }
  if (source.items.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("items 中的每一道菜都必须是对象。");
  }
  const pageInput = source.page && typeof source.page === "object" ? source.page : {};
  const themeInput = source.theme && typeof source.theme === "object" ? source.theme : {};
  const usedIds = new Set();
  const items = source.items.map((item) => {
    const normalized = normalizeItem(item);
    if (usedIds.has(normalized.id)) normalized.id = makeId();
    usedIds.add(normalized.id);
    return normalized;
  });
  return {
    schema: SCHEMA_ID,
    version: SCHEMA_VERSION,
    restaurant: String(source.restaurant ?? "未命名餐厅"),
    headline: String(source.headline ?? "菜 单"),
    subheading: String(source.subheading ?? ""),
    note: String(source.note ?? ""),
    currency: String(source.currency ?? "¥"),
    page: {
      preset: PAGE_PRESETS[pageInput.preset] ? pageInput.preset : "custom",
      width: numericOr(pageInput.width, 1240, "画布宽度"),
      height: numericOr(pageInput.height, 1754, "画布高度"),
      margin: numericOr(pageInput.margin, 88, "安全边距"),
    },
    theme: {
      accent: validColor(themeInput.accent) ? themeInput.accent : "#ad4a32",
      motif: ["arch", "grid", "sun", "none"].includes(themeInput.motif) ? themeInput.motif : "arch",
      paper: PAPER_TONES[themeInput.paper] ? themeInput.paper : "cream",
    },
    items,
  };
}

function numericOr(value, fallback, label = "数值") {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}必须是数字。`);
  return number;
}

function validColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function makeItem() {
  return normalizeItem({
    name: "新菜品",
    description: "",
    price: "",
    tags: [],
  });
}

export function isAllergenTag(tag) {
  const value = String(tag).trim().toLowerCase();
  if (/^(无|不含|免|零)/.test(value) || /(^|[\s-])free\b/.test(value)) return false;
  return ALLERGEN_TERMS.some((term) => value.includes(term.toLowerCase()));
}

export function serializedExport(doc, layout = null) {
  return {
    schema: SCHEMA_ID,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    document: {
      restaurant: doc.restaurant,
      headline: doc.headline,
      subheading: doc.subheading,
      note: doc.note,
      currency: doc.currency,
      page: { ...doc.page },
      theme: { ...doc.theme },
      items: doc.items.map(({ id, name, description, price, tags }) => ({
        id,
        name,
        description,
        price,
        tags: [...tags],
      })),
    },
    layout: layout
      ? {
          computedColumns: layout.columns,
          columnWidth: Number(layout.columnWidth.toFixed(2)),
          columnGap: Number(layout.columnGap.toFixed(2)),
          fitScale: layout.fitScale,
          heightAlgorithm: "measured-text-balanced-columns",
          safeMargin: doc.page.margin,
        }
      : undefined,
  };
}
