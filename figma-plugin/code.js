/* =========================================================
   面试题背诵 · Figma 设计稿生成器
   运行后自动生成 4 个页面：
     1. 🎨 Design Tokens  颜色样式 + 文字样式 + 色卡板
     2. 🧩 Components     9 组组件（含变体）
     3. 📱 Screens        11 个 390×844 界面，已挂好原型跳转
     4. 🔗 Prototype      流程说明图
   用法：Figma → 插件 → 开发 → 从 manifest 导入 → 运行
   ========================================================= */

/* ---------------- 1. 设计令牌 ---------------- */

const COLORS = [
  ["primary",       "2563EB", "主按钮、进度条、选中态"],
  ["primary-soft",  "EFF4FF", "主色浅底"],
  ["success",       "0E9F6E", "已背完 / 会了"],
  ["success-soft",  "E9F7F1", "成功态浅底"],
  ["danger",        "E5484D", "录音中 / 错误"],
  ["danger-soft",   "FDEDED", "录音条底色"],
  ["bg",            "F5F6F8", "页面底色"],
  ["surface",       "FFFFFF", "卡片 / 输入框"],
  ["surface-2",     "F0F2F5", "次级块"],
  ["text-1",        "141A23", "题干 / 标题"],
  ["text-2",        "69737F", "答案 / 说明"],
  ["text-3",        "98A1AC", "计数 / 占位"],
  ["line",          "E6E9EE", "分隔线 / 描边"]
];

const C = {
  primary: "#2563EB", primarySoft: "#EFF4FF",
  success: "#0E9F6E", successSoft: "#E9F7F1",
  danger: "#E5484D", dangerSoft: "#FDEDED",
  bg: "#F5F6F8", surface: "#FFFFFF", surface2: "#F0F2F5",
  t1: "#141A23", t2: "#69737F", t3: "#98A1AC", line: "#E6E9EE", white: "#FFFFFF"
};

const TEXT_STYLES = [
  ["display",     28, 36, "bold",    "登录页产品名"],
  ["title-1",     22, 32, "bold",    "题干"],
  ["title-2",     17, 26, "bold",    "页面标题 / 区块标题"],
  ["body",        15, 26, "regular", "答案正文"],
  ["body-strong", 15, 26, "medium",  "按钮文字 / 列表主文字"],
  ["caption",     13, 20, "regular", "说明 / 次要信息"],
  ["micro",       11, 16, "regular", "计数 / 角标"]
];

const SPACING = [4, 8, 12, 16, 20, 24, 32];
const RADIUS = [["s", 8], ["m", 12], ["l", 16], ["xl", 22]];

let F = {
  regular: { family: "Inter", style: "Regular" },
  medium:  { family: "Inter", style: "Medium" },
  bold:    { family: "Inter", style: "Semi Bold" }
};

/* ---------------- 2. 基础工具 ---------------- */

function rgb(hexStr) {
  const n = parseInt(hexStr.replace("#", ""), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function solid(hexStr) {
  return { type: "SOLID", color: rgb(hexStr), opacity: 1 };
}

function faces(weight) {
  return weight === "bold" ? F.bold : (weight === "medium" ? F.medium : F.regular);
}

function byName(name) {
  for (let i = 0; i < TEXT_STYLES.length; i++) {
    if (TEXT_STYLES[i][0] === name) return TEXT_STYLES[i];
  }
  return TEXT_STYLES[3];
}

/* 自动布局 */
function auto(n, o) {
  o = o || {};
  n.layoutMode = o.dir === "h" ? "HORIZONTAL" : "VERTICAL";
  n.itemSpacing = o.gap == null ? 0 : o.gap;
  const p = o.p == null ? 0 : o.p;
  n.paddingTop = o.pt == null ? p : o.pt;
  n.paddingBottom = o.pb == null ? p : o.pb;
  n.paddingLeft = o.pl == null ? p : o.pl;
  n.paddingRight = o.pr == null ? p : o.pr;
  n.counterAxisAlignItems = o.cross || "MIN";
  n.primaryAxisAlignItems = o.main || "MIN";
  if (o.w != null || o.h != null) {
    n.resize(o.w == null ? n.width : o.w, o.h == null ? n.height : o.h);
  }
  n.primaryAxisSizingMode = o.mainFixed ? "FIXED" : "AUTO";
  n.counterAxisSizingMode = o.crossFixed ? "FIXED" : "AUTO";
  return n;
}

/* 通用容器 */
function box(name, o) {
  o = o || {};
  const f = figma.createFrame();
  f.name = name;
  f.fills = o.fill ? [solid(o.fill)] : [];
  f.clipsContent = o.clip !== false;
  f.cornerRadius = o.r || 0;
  if (o.stroke) {
    f.strokes = [solid(o.stroke)];
    f.strokeWeight = 0.5;
    f.strokeAlign = "INSIDE";
  }
  if (o.dir) auto(f, o);
  else if (o.w != null || o.h != null) f.resize(o.w == null ? 100 : o.w, o.h == null ? 100 : o.h);
  return f;
}

/* 文字 */
function txt(str, styleName, o) {
  o = o || {};
  const s = byName(styleName);
  const t = figma.createText();
  t.name = o.name || String(str).slice(0, 16);
  t.fontName = faces(s[3]);
  t.characters = str;
  t.fontSize = s[1];
  t.lineHeight = { unit: "PIXELS", value: s[2] };
  t.fills = [solid(o.color || C.t1)];
  if (o.align) t.textAlignHorizontal = o.align;
  try {
    if (o.stretch === false) {
      t.textAutoResize = "WIDTH_AND_HEIGHT";
    } else {
      t.textAutoResize = "HEIGHT";
      t.layoutAlign = "STRETCH";
    }
  } catch (e) { /* 父级不是自动布局时忽略 */ }
  return t;
}

/* 让子元素撑满父容器宽度 */
function stretch(n) {
  try { n.layoutAlign = "STRETCH"; } catch (e) {}
  return n;
}

/* ---------------- 3. 页面骨架 ---------------- */

function newPage(name) {
  const p = figma.createPage();
  p.name = name;
  return p;
}

/* 390×844 界面外框 */
function shell(name) {
  const s = box(name, { fill: C.bg, clip: true });
  auto(s, { dir: "v", gap: 0, cross: "CENTER", w: 390, h: 844, mainFixed: true, crossFixed: true });
  return s;
}

/* 内容区（可滚动区） */
function contentArea(h) {
  const c = box("Content", { fill: C.bg });
  auto(c, { dir: "v", gap: 20, p: 20, w: 390, h: h, mainFixed: true, crossFixed: true });
  return c;
}

/* 导航栏 */
function navBar(parent, title, o) {
  o = o || {};
  const bar = box("NavBar", { fill: C.bg });
  auto(bar, { dir: "h", gap: 4, pt: 0, pb: 0, pl: 12, pr: 12, cross: "CENTER", w: 390, h: 56, mainFixed: true, crossFixed: true });
  if (o.back !== false) {
    const b = box("返回", {});
    auto(b, { dir: "v", main: "CENTER", cross: "CENTER", w: 36, h: 36, mainFixed: true, crossFixed: true });
    b.appendChild(txt("‹", "title-1", { color: C.t1, stretch: false }));
    bar.appendChild(b);
  }
  const ti = txt(title, o.small ? "body-strong" : "title-2", { color: C.t1 });
  bar.appendChild(ti);
  try { ti.layoutGrow = 1; ti.textAlignHorizontal = o.right ? "RIGHT" : "LEFT"; } catch (e) {}
  if (o.slot) bar.appendChild(o.slot);
  parent.appendChild(bar);
  return bar;
}

/* 模式切换 chip 组 */
function modeChips() {
  const g = box("Chip/Mode", {});
  auto(g, { dir: "h", gap: 6, cross: "CENTER" });
  const a = box("顺序", { fill: C.primarySoft, stroke: C.primary, r: 999 });
  auto(a, { dir: "v", main: "CENTER", cross: "CENTER", pt: 6, pb: 6, pl: 14, pr: 14 });
  a.appendChild(txt("顺序", "caption", { color: C.primary, stretch: false }));
  const b = box("随机", { fill: C.surface, stroke: C.line, r: 999 });
  auto(b, { dir: "v", main: "CENTER", cross: "CENTER", pt: 6, pb: 6, pl: 14, pr: 14 });
  b.appendChild(txt("随机", "caption", { color: C.t2, stretch: false }));
  g.appendChild(a);
  g.appendChild(b);
  return g;
}

/* 细进度条 */
function thinProgress(parent, pct, w) {
  const wrap = box("ProgressBar/细", { fill: C.surface2 });
  auto(wrap, { dir: "h", w: w == null ? 350 : w, h: 3, mainFixed: true, crossFixed: true });
  const f = box("Fill", { fill: C.primary });
  auto(f, { dir: "h", w: Math.max(4, (w == null ? 350 : w) * pct), h: 3, mainFixed: true, crossFixed: true });
  wrap.appendChild(f);
  parent.appendChild(wrap);
  return wrap;
}

/* 粗进度条 */
function thickProgress(parent, pct, w) {
  const wrap = box("ProgressBar/粗", { fill: C.surface2, r: 3 });
  auto(wrap, { dir: "h", w: w == null ? 310 : w, h: 6, mainFixed: true, crossFixed: true });
  const f = box("Fill", { fill: C.primary, r: 3 });
  auto(f, { dir: "h", w: Math.max(4, (w == null ? 310 : w) * pct), h: 6, mainFixed: true, crossFixed: true });
  wrap.appendChild(f);
  parent.appendChild(wrap);
  return wrap;
}

/* 按钮 */
function button(label, kind, o) {
  o = o || {};
  const primary = kind === "primary";
  const b = box("Button/" + (primary ? "Primary" : "Secondary"), {
    fill: primary ? C.primary : C.surface,
    stroke: primary ? null : C.line,
    r: 12
  });
  auto(b, { dir: "v", main: "CENTER", cross: "CENTER", w: o.w == null ? 350 : o.w, h: o.h == null ? 50 : o.h, mainFixed: true, crossFixed: true });
  const color = o.dangerText ? C.danger : (primary ? C.white : C.t1);
  b.appendChild(txt(label, o.style || "body-strong", { color: color, stretch: false }));
  return b;
}

/* 卡片 */
function card(name, o) {
  o = o || {};
  const c = box(name || "Card", { fill: C.surface, stroke: C.line, r: 16 });
  auto(c, { dir: "v", gap: 12, p: 16, cross: "MIN" });
  return c;
}

/* 行内提示 */
function inlineNote(kind, str) {
  const conf = {
    info: [C.primarySoft, C.primary],
    warn: ["#FDF6E9", "#8A6100"],
    error: [C.dangerSoft, C.danger]
  }[kind] || [C.primarySoft, C.primary];
  const n = box("Feedback/" + kind, { fill: conf[0], r: 12 });
  auto(n, { dir: "v", p: 12, gap: 4, cross: "MIN" });
  n.appendChild(txt(str, "caption", { color: conf[1] }));
  return n;
}

/* 虚线占位框 */
function placeholder(main, sub) {
  const p = box("Empty/Placeholder", { fill: C.surface, stroke: C.line, r: 16 });
  auto(p, { dir: "v", gap: 10, p: 26, main: "CENTER", cross: "CENTER" });
  const icon = box("icon", { fill: C.surface2, r: 12 });
  auto(icon, { dir: "v", w: 44, h: 44, mainFixed: true, crossFixed: true });
  p.appendChild(icon);
  p.appendChild(txt(main, "body-strong", { color: C.t2, stretch: false }));
  p.appendChild(txt(sub, "micro", { color: C.t3, stretch: false }));
  return p;
}

/* ---------------- 4. 颜色 / 文字样式 ---------------- */

function clearOldStyles() {
  figma.getLocalPaintStyles().forEach(function (s) {
    if (s.name.indexOf("颜色/") === 0) s.remove();
  });
  figma.getLocalTextStyles().forEach(function (s) {
    if (s.name.indexOf("文字/") === 0) s.remove();
  });
}

function makeStyles() {
  COLORS.forEach(function (c) {
    const st = figma.createPaintStyle();
    st.name = "颜色/" + c[0];
    st.paints = [solid("#" + c[1])];
    st.description = c[2];
  });
  TEXT_STYLES.forEach(function (s) {
    const st = figma.createTextStyle();
    st.name = "文字/" + s[0];
    st.fontName = faces(s[3]);
    st.fontSize = s[1];
    st.lineHeight = { unit: "PIXELS", value: s[2] };
    st.description = s[4];
  });
}

/* ---------------- 5. 生成「设计令牌」页 ---------------- */

function buildTokensPage(page) {
  const root = box("Design Tokens", { fill: C.bg });
  auto(root, { dir: "v", gap: 40, p: 48 });

  const h = txt("设计令牌 Design Tokens", "display", { color: C.t1, stretch: false });
  root.appendChild(h);
  const sub = txt("面试题背诵 · 手机 H5 · 390 × 844 · 浅色主题", "body", { color: C.t2, stretch: false });
  root.appendChild(sub);

  /* 色卡 */
  const secA = txt("1 · 颜色（13 个，已建为 Paint Style）", "title-2", { color: C.t1, stretch: false });
  root.appendChild(secA);

  const grid = box("色卡", {});
  auto(grid, { dir: "h", gap: 16, cross: "MIN" });
  try {
    grid.layoutWrap = "WRAP";
    grid.primaryAxisSizingMode = "FIXED";
    grid.counterAxisSizingMode = "AUTO";
    grid.resize(1200, grid.height);
  } catch (e) {}

  COLORS.forEach(function (c) {
    const cell = box(c[0], {});
    auto(cell, { dir: "v", gap: 8, w: 180 });
    const sw = box("swatch", { fill: "#" + c[1], stroke: c[0] === "surface" || c[0] === "bg" ? C.line : null, r: 12 });
    auto(sw, { dir: "v", w: 180, h: 72, mainFixed: true, crossFixed: true });
    cell.appendChild(sw);
    cell.appendChild(txt(c[0], "body-strong", { color: C.t1, stretch: false }));
    cell.appendChild(txt("#" + c[1], "micro", { color: C.t2, stretch: false }));
    cell.appendChild(txt(c[2], "micro", { color: C.t3, stretch: false }));
    grid.appendChild(cell);
  });
  root.appendChild(grid);

  /* 文字样式 */
  const secB = txt("2 · 文字（7 档，已建为 Text Style）", "title-2", { color: C.t1, stretch: false });
  root.appendChild(secB);

  const typeBox = box("文字样式", {});
  auto(typeBox, { dir: "v", gap: 20, w: 1000, crossFixed: true });
  TEXT_STYLES.forEach(function (s) {
    const row = box(s[0] + " 行", {});
    auto(row, { dir: "h", gap: 24, cross: "CENTER" });
    const meta = txt(s[0] + " · " + s[1] + "/" + s[2], "micro", { color: C.t3, stretch: false, name: "meta" });
    try { meta.textAutoResize = "NONE"; meta.resize(160, 18); } catch (e) {}
    row.appendChild(meta);
    row.appendChild(txt("题干示例：什么是闭包？", s[0], { color: C.t1 }));
    typeBox.appendChild(row);
  });
  root.appendChild(typeBox);

  /* 间距与圆角 */
  const secC = txt("3 · 间距与圆角", "title-2", { color: C.t1, stretch: false });
  root.appendChild(secC);

  const spBox = box("间距", {});
  auto(spBox, { dir: "h", gap: 16, cross: "END" });
  SPACING.forEach(function (v) {
    const c = box("sp-" + v, {});
    auto(c, { dir: "v", gap: 6, cross: "CENTER" });
    const bar = box("bar", { fill: C.primarySoft, stroke: C.primary, r: 2 });
    auto(bar, { dir: "v", w: v * 2, h: v * 2, mainFixed: true, crossFixed: true });
    c.appendChild(bar);
    c.appendChild(txt(String(v), "micro", { color: C.t2, stretch: false }));
    spBox.appendChild(c);
  });
  root.appendChild(spBox);

  const rBox = box("圆角", {});
  auto(rBox, { dir: "h", gap: 16, cross: "END" });
  RADIUS.forEach(function (v) {
    const c = box("radius-" + v[0], {});
    auto(c, { dir: "v", gap: 6, cross: "CENTER" });
    const sq = box("sq", { fill: C.surface2, stroke: C.line, r: v[1] });
    auto(sq, { dir: "v", w: 64, h: 48, mainFixed: true, crossFixed: true });
    c.appendChild(sq);
    c.appendChild(txt(v[0] + " " + v[1], "micro", { color: C.t2, stretch: false }));
    rBox.appendChild(c);
  });
  root.appendChild(rBox);

  page.appendChild(root);
  return root;
}

/* ---------------- 6. 生成「组件」页 ---------------- */

function buildComponentsPage(page) {
  const root = box("Components", { fill: C.bg });
  auto(root, { dir: "v", gap: 48, p: 48 });

  root.appendChild(txt("组件库 Components", "display", { color: C.t1, stretch: false }));
  root.appendChild(txt("先改组件，页面自动跟着变。所有尺寸均为 390 宽下的真实值。", "body", { color: C.t2, stretch: false }));

  /* Button/Primary */
  const b1 = [];
  [["默认", C.primary, 1, "登录"], ["按下", "#1D4FD8", 1, "登录"], ["禁用", C.primary, 0.4, "登录"], ["加载中", C.primary, 1, "登录中…"]].forEach(function (v) {
    const c = figma.createComponent();
    c.name = "状态=" + v[0];
    auto(c, { dir: "v", main: "CENTER", cross: "CENTER", w: 350, h: 50, mainFixed: true, crossFixed: true });
    c.fills = [solid(v[1])];
    c.cornerRadius = 12;
    c.opacity = v[2];
    c.appendChild(txt(v[3], "body-strong", { color: C.white, stretch: false }));
    b1.push(c);
  });
  const set1 = figma.combineAsVariants(b1, page);
  set1.name = "Button/Primary";
  set1.fills = [];
  auto(set1, { dir: "v", gap: 16, p: 24 });

  /* Button/Secondary */
  const b2 = [];
  [["默认", 1], ["按下", 0.6]].forEach(function (v) {
    const c = figma.createComponent();
    c.name = "状态=" + v[0];
    auto(c, { dir: "v", main: "CENTER", cross: "CENTER", w: 350, h: 50, mainFixed: true, crossFixed: true });
    c.fills = [solid(C.surface)];
    c.strokes = [solid(C.line)];
    c.strokeWeight = 0.5;
    c.cornerRadius = 12;
    c.opacity = v[1];
    c.appendChild(txt("上一题", "body-strong", { color: C.t1, stretch: false }));
    b2.push(c);
  });
  const set2 = figma.combineAsVariants(b2, page);
  set2.name = "Button/Secondary";
  set2.fills = [];
  auto(set2, { dir: "v", gap: 16, p: 24 });

  /* Button/Mic */
  const b3 = [];
  [["待录", C.primary], ["录音中", C.danger]].forEach(function (v) {
    const c = figma.createComponent();
    c.name = "状态=" + v[0];
    auto(c, { dir: "v", main: "CENTER", cross: "CENTER", w: 88, h: 88, mainFixed: true, crossFixed: true });
    c.fills = [solid(v[1])];
    c.cornerRadius = 44;
    const inner = box("麦克风", {});
    auto(inner, { dir: "v", w: 30, h: 30, mainFixed: true, crossFixed: true });
    c.appendChild(inner);
    b3.push(c);
  });
  const set3 = figma.combineAsVariants(b3, page);
  set3.name = "Button/Mic";
  set3.fills = [];
  auto(set3, { dir: "h", gap: 24, p: 24 });

  /* Input/Text */
  const b4 = [];
  [["默认", C.line, C.t3, "请输入账号"], ["聚焦", C.primary, C.t1, "kaozhen"]].forEach(function (v) {
    const c = figma.createComponent();
    c.name = "状态=" + v[0];
    auto(c, { dir: "v", gap: 6, w: 350, crossFixed: true });
    const lbl = txt("账号", "micro", { color: C.t2, stretch: false });
    c.appendChild(lbl);
    const inp = box("Input", { fill: C.surface, stroke: v[1], r: 12 });
    auto(inp, { dir: "h", p: 14, cross: "CENTER", w: 350, h: 50, mainFixed: true, crossFixed: true });
    inp.strokes = [solid(v[1])];
    inp.strokeWeight = v[0] === "聚焦" ? 1 : 0.5;
    inp.appendChild(txt(v[3], "body", { color: v[2] }));
    c.appendChild(inp);
    b4.push(c);
  });
  const set4 = figma.combineAsVariants(b4, page);
  set4.name = "Input/Text";
  set4.fills = [];
  auto(set4, { dir: "v", gap: 20, p: 24 });

  /* Chip/Mode */
  const b5 = [];
  [["选中", C.primarySoft, C.primary, C.primary], ["未选", C.surface, C.line, C.t2]].forEach(function (v) {
    const c = figma.createComponent();
    c.name = "状态=" + v[0];
    auto(c, { dir: "v", main: "CENTER", cross: "CENTER", pt: 6, pb: 6, pl: 14, pr: 14, mainFixed: false, crossFixed: false });
    c.fills = [solid(v[1])];
    c.strokes = [solid(v[2])];
    c.strokeWeight = 0.5;
    c.cornerRadius = 999;
    c.appendChild(txt("顺序", "caption", { color: v[3], stretch: false }));
    b5.push(c);
  });
  const set5 = figma.combineAsVariants(b5, page);
  set5.name = "Chip/Mode";
  set5.fills = [];
  auto(set5, { dir: "h", gap: 12, p: 24 });

  /* Card/Question */
  const cardComp = figma.createComponent();
  cardComp.name = "Card/Question";
  auto(cardComp, { dir: "v", p: 20, gap: 12, w: 350, crossFixed: true });
  cardComp.fills = [solid(C.surface)];
  cardComp.strokes = [solid(C.line)];
  cardComp.strokeWeight = 0.5;
  cardComp.cornerRadius = 16;
  cardComp.appendChild(txt("什么是闭包？请结合你项目里的例子说明。", "title-1", { color: C.t1 }));
  const divA = box("divider", { fill: C.line });
  auto(divA, { dir: "h", w: 310, h: 1, mainFixed: true, crossFixed: true });
  stretch(divA);
  cardComp.appendChild(divA);
  cardComp.appendChild(txt("闭包是函数和它定义时所在作用域的组合。内部函数可以访问外部函数的变量，即使外部函数已经执行完毕，这些变量也不会被回收。", "body", { color: C.t2 }));
  page.appendChild(cardComp);

  /* ProgressBar */
  const b7 = [];
  [["粗", 6, 0.53], ["细", 3, 0.05]].forEach(function (v) {
    const c = figma.createComponent();
    c.name = "状态=" + v[0];
    auto(c, { dir: "h", w: 310, h: v[1], mainFixed: true, crossFixed: true });
    c.fills = [solid(C.surface2)];
    c.cornerRadius = v[0] === "粗" ? 3 : 0;
    const f = box("Fill", { fill: C.primary, r: v[0] === "粗" ? 3 : 0 });
    auto(f, { dir: "h", w: 310 * v[2], h: v[1], mainFixed: true, crossFixed: true });
    c.appendChild(f);
    b7.push(c);
  });
  const set7 = figma.combineAsVariants(b7, page);
  set7.name = "ProgressBar";
  set7.fills = [];
  auto(set7, { dir: "v", gap: 16, p: 24 });

  /* NavBar */
  const navComp = figma.createComponent();
  navComp.name = "NavBar";
  auto(navComp, { dir: "h", gap: 4, pl: 12, pr: 12, cross: "CENTER", w: 390, h: 56, mainFixed: true, crossFixed: true });
  navComp.fills = [solid(C.bg)];
  const backC = box("返回", {});
  auto(backC, { dir: "v", main: "CENTER", cross: "CENTER", w: 36, h: 36, mainFixed: true, crossFixed: true });
  backC.appendChild(txt("‹", "title-1", { color: C.t1, stretch: false }));
  navComp.appendChild(backC);
  const navTitle = txt("导入题库", "title-2", { color: C.t1 });
  navComp.appendChild(navTitle);
  try { navTitle.layoutGrow = 1; } catch (e) {}
  page.appendChild(navComp);

  /* Feedback/Inline */
  const b9 = [];
  [["info", "info", "解析会按 PDF 的排版自动切分题目与答案。"], ["error", "error", "账号或密码不正确"], ["warn", "warn", "有 2 处切分可能不准，建议先修正。"]].forEach(function (v) {
    const c = figma.createComponent();
    c.name = "类型=" + v[0];
    auto(c, { dir: "v", p: 12, gap: 4, w: 350, crossFixed: true });
    const conf = { info: [C.primarySoft, C.primary], warn: ["#FDF6E9", "#8A6100"], error: [C.dangerSoft, C.danger] }[v[1]];
    c.fills = [solid(conf[0])];
    c.cornerRadius = 12;
    c.appendChild(txt(v[2], "caption", { color: conf[1] }));
    b9.push(c);
  });
  const set9 = figma.combineAsVariants(b9, page);
  set9.name = "Feedback/Inline";
  set9.fills = [];
  auto(set9, { dir: "v", gap: 16, p: 24 });

  /* 排版 */
  const sets = [set1, set2, set3, set4, set5, cardComp, set7, navComp, set9];
  let x = 0;
  let y = 160;
  let rowH = 0;
  sets.forEach(function (n) {
    n.x = 48 + x;
    n.y = y;
    if (x > 0) n.y = y;
    rowH = Math.max(rowH, n.height);
    x += n.width + 56;
    if (x > 2200) { x = 0; y += rowH + 80; rowH = 0; }
  });
  return root;
}

/* ---------------- 7. 生成「页面」页 ---------------- */

function sLogin() {
  const s = shell("S0_Login");
  const c = contentArea(744);
  auto(c, { dir: "v", gap: 28, p: 20, main: "CENTER", w: 390, h: 744, mainFixed: true, crossFixed: true });
  const head = box("头部", {});
  auto(head, { dir: "v", gap: 8 });
  head.appendChild(txt("面试题背诵", "display", { color: C.t1 }));
  head.appendChild(txt("把题库变成一张张卡片，顺序背、随机背、开口复习", "caption", { color: C.t2 }));
  c.appendChild(stretch(head));

  const form = box("表单", {});
  auto(form, { dir: "v", gap: 14, w: 350, crossFixed: true });
  [["账号", "kaozhen", C.line], ["密码", "••••••••", C.line]].forEach(function (v) {
    const f = box(v[0], {});
    auto(f, { dir: "v", gap: 6, w: 350, crossFixed: true });
    f.appendChild(txt(v[0], "micro", { color: C.t2, stretch: false }));
    const inp = box("Input", { fill: C.surface, stroke: v[2], r: 12 });
    auto(inp, { dir: "h", p: 14, cross: "CENTER", w: 350, h: 50, mainFixed: true, crossFixed: true });
    inp.appendChild(txt(v[1], "body", { color: v[1] === "kaozhen" ? C.t1 : C.t3 }));
    f.appendChild(inp);
    form.appendChild(f);
  });
  c.appendChild(form);

  const act = box("操作", {});
  auto(act, { dir: "v", gap: 14, w: 350, crossFixed: true });
  const loginBtn = button("登录", "primary", { w: 350 });
  act.appendChild(loginBtn);
  const note = txt("仅本人使用，不开放注册", "micro", { color: C.t3, stretch: false });
  note.textAlignHorizontal = "CENTER";
  try { note.layoutAlign = "STRETCH"; } catch (e) {}
  act.appendChild(note);
  c.appendChild(act);

  s.appendChild(c);
  return { frame: s, links: [[loginBtn, "S1_Home"]] };
}

function sHome(empty) {
  const s = shell(empty ? "S1b_Home_Empty" : "S1_Home");
  const c = contentArea(788);
  const top = box("顶部", {});
  auto(top, { dir: "h", cross: "CENTER" });
  top.appendChild(txt("下午好", "title-2", { color: C.t1 }));
  const me = txt("我的", "micro", { color: C.t2, stretch: false });
  me.textAlignHorizontal = "RIGHT";
  try { me.layoutAlign = "STRETCH"; } catch (e) {}
  top.appendChild(me);
  try { top.children[0].layoutGrow = 1; } catch (e) {}
  c.appendChild(stretch(top));

  let reciteBtn = null;
  let reviewBtn = null;

  if (!empty) {
    const p = card("进度卡");
    stretch(p);
    const row = box("数字行", {});
    auto(row, { dir: "h", cross: "END", w: 310, crossFixed: true });
    const num = txt("128 / 240", "display", { color: C.t1 });
    row.appendChild(num);
    try { num.layoutGrow = 1; } catch (e) {}
    row.appendChild(txt("53%", "micro", { color: C.t3, stretch: false }));
    p.appendChild(row);
    thickProgress(p, 0.53, 310);
    p.appendChild(txt("上次背到第 129 题 · 进度已同步到云端", "micro", { color: C.t3 }));
    c.appendChild(p);

    const acts = box("操作", {});
    auto(acts, { dir: "v", gap: 12, w: 350, crossFixed: true });
    reciteBtn = button("继续背诵", "primary", { w: 350, h: 56, style: "title-2" });
    reviewBtn = button("开始复习", "secondary", { w: 350, h: 56, style: "title-2" });
    acts.appendChild(reciteBtn);
    acts.appendChild(reviewBtn);
    c.appendChild(acts);

    const foot = box("题库信息", {});
    auto(foot, { dir: "h", cross: "CENTER" });
    foot.appendChild(txt("题库：面试题库.pdf · 240 题", "caption", { color: C.t2 }));
    c.appendChild(stretch(foot));
  } else {
    c.appendChild(stretch(placeholder("还没有题库", "点这里导入面试题 PDF")));
    reciteBtn = button("导入题库", "primary", { w: 350, h: 56, style: "title-2" });
    c.appendChild(reciteBtn);
    const note = txt("导入并解析完成后，才能开始背诵和复习", "micro", { color: C.t3, stretch: false });
    note.textAlignHorizontal = "CENTER";
    try { note.layoutAlign = "STRETCH"; } catch (e) {}
    c.appendChild(note);
  }

  s.appendChild(c);
  return { frame: s, links: [[reciteBtn, "S2_Import"], [reviewBtn, "S5_ReviewScope"]] };
}

function sImport() {
  const s = shell("S2_Import");
  navBar(s, "导入题库");
  const c = contentArea(694);
  c.appendChild(stretch(placeholder("点击选择 PDF 文件", "支持 .pdf；扫描版图片需要额外识别")));

  const fileCard = card("已选文件");
  stretch(fileCard);
  const row = box("文件行", {});
  auto(row, { dir: "h", cross: "CENTER" });
  const info = box("文件信息", {});
  auto(info, { dir: "v", gap: 2 });
  info.appendChild(txt("面试题库.pdf", "body-strong", { color: C.t1 }));
  info.appendChild(txt("2.4 MB · 已选择", "micro", { color: C.t3 }));
  row.appendChild(info);
  try { info.layoutGrow = 1; } catch (e) {}
  row.appendChild(txt("更换", "caption", { color: C.primary, stretch: false }));
  fileCard.appendChild(row);
  c.appendChild(fileCard);

  c.appendChild(stretch(inlineNote("info", "解析会按 PDF 的排版自动切分题目与答案，解析完成后可以逐题检查修正。")));
  s.appendChild(c);

  const bar = box("底部操作", { fill: C.bg });
  auto(bar, { dir: "h", gap: 12, pt: 12, pb: 20, pl: 20, pr: 20, w: 390, crossFixed: true });
  const parseBtn = button("开始解析", "primary", { w: 350 });
  bar.appendChild(parseBtn);
  s.appendChild(bar);
  return { frame: s, links: [[parseBtn, "S3_ParseResult"]] };
}

function sParseResult() {
  const s = shell("S3_ParseResult");
  navBar(s, "解析完成");
  const c = contentArea(694);

  const metrics = box("统计", {});
  auto(metrics, { dir: "h", gap: 10, w: 350, crossFixed: true });
  [["240", "题目", C.t1], ["240", "答案", C.t1], ["2", "待确认", C.danger]].forEach(function (v) {
    const m = box("Metric", { fill: C.surface, r: 12 });
    auto(m, { dir: "v", gap: 4, pt: 14, pb: 14, pl: 8, pr: 8, cross: "CENTER", w: 110, mainFixed: true });
    const num = txt(v[0], "display", { color: v[2], stretch: false });
    num.textAlignHorizontal = "CENTER";
    m.appendChild(num);
    m.appendChild(txt(v[1], "micro", { color: C.t3, stretch: false }));
    metrics.appendChild(m);
  });
  c.appendChild(metrics);

  c.appendChild(stretch(inlineNote("warn", "有 2 处切分可能不准，建议先修正确认再开始背，避免背错。")));
  c.appendChild(txt("前 3 题预览", "title-2", { color: C.t1, stretch: false }));

  [["第 1 题", "什么是闭包？", "内部函数能记住并访问它定义时所在作用域里的变量"],
   ["第 2 题", "说说事件循环的理解", "主线程执行同步任务，异步任务进入任务队列排队等待"],
   ["第 3 题", "原型链是什么？", "对象通过 __proto__ 向上查找属性的链路"]].forEach(function (v) {
    const cc = card(v[0]);
    stretch(cc);
    const head = box("头", {});
    auto(head, { dir: "h", cross: "CENTER" });
    head.appendChild(txt(v[0], "micro", { color: C.t3, stretch: false }));
    const fix = txt("修正", "micro", { color: C.primary, stretch: false });
    fix.textAlignHorizontal = "RIGHT";
    try { fix.layoutAlign = "STRETCH"; } catch (e) {}
    head.appendChild(fix);
    cc.appendChild(head);
    cc.appendChild(txt(v[1], "body-strong", { color: C.t1 }));
    cc.appendChild(txt(v[2], "caption", { color: C.t2 }));
    c.appendChild(cc);
  });
  s.appendChild(c);

  const bar = box("底部操作", { fill: C.bg });
  auto(bar, { dir: "h", gap: 12, pt: 12, pb: 20, pl: 20, pr: 20, w: 390, crossFixed: true });
  bar.appendChild(button("重新导入", "secondary", { w: 169 }));
  const startBtn = button("开始背诵", "primary", { w: 169 });
  bar.appendChild(startBtn);
  s.appendChild(bar);
  return { frame: s, links: [[startBtn, "S4_Recite"]] };
}

function sRecite() {
  const s = shell("S4_Recite");
  navBar(s, "第 12 / 240 题", { small: true, slot: modeChips() });
  thinProgress(s, 0.05, 350);
  const c = contentArea(690);
  auto(c, { dir: "v", gap: 20, p: 20, w: 390, h: 690, mainFixed: true, crossFixed: true });

  const qc = card("Card/Question");
  stretch(qc);
  qc.appendChild(txt("什么是闭包？请结合你项目里的例子说明。", "title-1", { color: C.t1 }));
  const d1 = box("divider", { fill: C.line });
  auto(d1, { dir: "h", w: 310, h: 1, mainFixed: true, crossFixed: true });
  stretch(d1);
  qc.appendChild(d1);
  qc.appendChild(txt("闭包是函数和它定义时所在作用域的组合。\n\n内部函数可以访问外部函数的变量，即使外部函数已经执行完毕，这些变量也不会被回收。\n\n典型用途：封装私有变量、函数柯里化、防抖节流里保存定时器 id。", "body", { color: C.t2 }));
  c.appendChild(qc);
  s.appendChild(c);

  const bar = box("底部操作", { fill: C.bg });
  auto(bar, { dir: "h", gap: 12, pt: 12, pb: 20, pl: 20, pr: 20, w: 390, crossFixed: true });
  bar.appendChild(button("上一题", "secondary", { w: 169 }));
  bar.appendChild(button("下一题", "primary", { w: 169 }));
  s.appendChild(bar);
  return { frame: s, links: [] };
}

function sReviewScope() {
  const s = shell("S5_ReviewScope");
  navBar(s, "开始复习");
  const c = contentArea(694);
  c.appendChild(txt("答案会先藏起来，请对着题目开口讲一遍并录音，讲完再点开答案对照。", "caption", { color: C.t2 }));

  [["复习刚背完的这一轮", "第 1 – 12 题", true], ["复习整个题库", "共 240 题", false]].forEach(function (v) {
    const o = box("Option", { fill: v[2] ? C.primarySoft : C.surface, stroke: v[2] ? C.primary : C.line, r: 16 });
    auto(o, { dir: "h", p: 16, cross: "CENTER", w: 350, crossFixed: true });
    const t = box("文本", {});
    auto(t, { dir: "v", gap: 3 });
    t.appendChild(txt(v[0], "body-strong", { color: v[2] ? C.primary : C.t1 }));
    t.appendChild(txt(v[1], "micro", { color: C.t3 }));
    o.appendChild(t);
    try { t.layoutGrow = 1; } catch (e) {}
    const radio = box("radio", { fill: v[2] ? C.primary : C.surface, stroke: v[2] ? C.primary : C.line, r: 10 });
    auto(radio, { dir: "v", w: 20, h: 20, mainFixed: true, crossFixed: true });
    o.appendChild(radio);
    c.appendChild(stretch(o));
  });

  const modeBox = box("复习顺序", {});
  stretch(modeBox);
  auto(modeBox, { dir: "v", gap: 10, w: 350, crossFixed: true });
  modeBox.appendChild(txt("复习顺序", "micro", { color: C.t2, stretch: false }));
  const chipWrap = box("chips", {});
  auto(chipWrap, { dir: "h", gap: 6 });
  [["顺序复习", true], ["随机复习", false]].forEach(function (v) {
    const ch = box(v[0], { fill: v[1] ? C.primarySoft : C.surface, stroke: v[1] ? C.primary : C.line, r: 999 });
    auto(ch, { dir: "v", main: "CENTER", cross: "CENTER", pt: 6, pb: 6, pl: 14, pr: 14, mainFixed: false, crossFixed: false });
    ch.appendChild(txt(v[0], "caption", { color: v[1] ? C.primary : C.t2, stretch: false }));
    chipWrap.appendChild(ch);
  });
  modeBox.appendChild(chipWrap);
  c.appendChild(modeBox);
  s.appendChild(c);

  const bar = box("底部操作", { fill: C.bg });
  auto(bar, { dir: "h", gap: 12, pt: 12, pb: 20, pl: 20, pr: 20, w: 390, crossFixed: true });
  const goBtn = button("开始复习", "primary", { w: 350 });
  bar.appendChild(goBtn);
  s.appendChild(bar);
  return { frame: s, links: [[goBtn, "S6_Review_Ready"]] };
}

function sReviewReady() {
  const s = shell("S6_Review_Ready");
  navBar(s, "复习 · 第 12 / 240 题", { small: true, slot: modeChips() });
  thinProgress(s, 0.05, 350);
  const c = contentArea(690);
  auto(c, { dir: "v", gap: 20, p: 20, w: 390, h: 690, mainFixed: true, crossFixed: true });

  c.appendChild(txt("什么是闭包？请结合你项目里的例子说明。", "title-1", { color: C.t1 }));

  const hid = box("答案已隐藏", { fill: C.surface2, r: 16 });
  auto(hid, { dir: "v", main: "CENTER", cross: "CENTER", w: 350, h: 132, mainFixed: true, crossFixed: true });
  hid.appendChild(txt("答案已隐藏，讲完再看", "caption", { color: C.t3, stretch: false }));
  c.appendChild(hid);

  const micWrap = box("录音区", {});
  auto(micWrap, { dir: "v", gap: 12, pt: 8, cross: "CENTER" });
  const mic = box("Button/Mic", { fill: C.primary, r: 44 });
  auto(mic, { dir: "v", main: "CENTER", cross: "CENTER", w: 88, h: 88, mainFixed: true, crossFixed: true });
  micWrap.appendChild(mic);
  micWrap.appendChild(txt("按住说话，讲完松手", "caption", { color: C.t2, stretch: false }));
  micWrap.appendChild(txt("录音只保存在本机", "micro", { color: C.t3, stretch: false }));
  c.appendChild(stretch(micWrap));
  s.appendChild(c);
  return { frame: s, links: [[mic, "S7_Review_Recording"]] };
}

function sReviewRecording() {
  const s = shell("S7_Review_Recording");
  navBar(s, "复习 · 第 12 / 240 题", { small: true, slot: modeChips() });
  thinProgress(s, 0.05, 350);
  const c = contentArea(690);
  auto(c, { dir: "v", gap: 20, p: 20, w: 390, h: 690, mainFixed: true, crossFixed: true });

  c.appendChild(txt("什么是闭包？请结合你项目里的例子说明。", "title-1", { color: C.t1 }));

  const rec = box("录音条", { fill: C.dangerSoft, r: 12 });
  auto(rec, { dir: "h", gap: 10, p: 10, cross: "CENTER", main: "CENTER", w: 350, crossFixed: true });
  const dot = box("dot", { fill: C.danger, r: 4 });
  auto(dot, { dir: "v", w: 8, h: 8, mainFixed: true, crossFixed: true });
  rec.appendChild(dot);
  rec.appendChild(txt("录音中", "caption", { color: C.danger, stretch: false }));
  rec.appendChild(txt("00:14", "caption", { color: C.danger, stretch: false }));
  c.appendChild(rec);

  const wave = box("波形", {});
  auto(wave, { dir: "h", gap: 3, p: 0, main: "CENTER", cross: "CENTER", w: 350, h: 34, mainFixed: true, crossFixed: true });
  for (let i = 0; i < 24; i++) {
    const hgt = 8 + Math.round(Math.abs(Math.sin(i * 1.7)) * 15);
    const b = box("bar", { fill: C.danger, r: 1 });
    auto(b, { dir: "v", w: 2, h: hgt, mainFixed: true, crossFixed: true });
    wave.appendChild(b);
  }
  c.appendChild(wave);

  const micWrap = box("录音区", {});
  auto(micWrap, { dir: "v", gap: 12, pt: 8, cross: "CENTER" });
  const mic = box("Button/Mic", { fill: C.danger, r: 44 });
  auto(mic, { dir: "v", main: "CENTER", cross: "CENTER", w: 88, h: 88, mainFixed: true, crossFixed: true });
  micWrap.appendChild(mic);
  const done = button("说完了", "secondary", { w: 180 });
  micWrap.appendChild(done);
  c.appendChild(stretch(micWrap));
  s.appendChild(c);
  return { frame: s, links: [[done, "S8_Review_Compare"], [mic, "S8_Review_Compare"]] };
}

function sReviewCompare() {
  const s = shell("S8_Review_Compare");
  navBar(s, "复习 · 第 12 / 240 题", { small: true, slot: modeChips() });
  thinProgress(s, 0.05, 350);
  const c = contentArea(690);
  auto(c, { dir: "v", gap: 20, p: 20, w: 390, h: 690, mainFixed: true, crossFixed: true });

  c.appendChild(txt("什么是闭包？请结合你项目里的例子说明。", "title-2", { color: C.t1 }));

  const player = card("回放条");
  stretch(player);
  const prow = box("播放行", {});
  auto(prow, { dir: "h", gap: 12, cross: "CENTER" });
  const playBtn = box("play", { fill: C.primary, r: 19 });
  auto(playBtn, { dir: "v", w: 38, h: 38, mainFixed: true, crossFixed: true });
  prow.appendChild(playBtn);
  const mid = box("中间", {});
  auto(mid, { dir: "v", gap: 6 });
  mid.appendChild(txt("回放我刚才说的", "caption", { color: C.t2 }));
  const track = box("进度", { fill: C.surface2, r: 2 });
  auto(track, { dir: "h", w: 200, h: 4, mainFixed: true, crossFixed: true });
  const tf = box("已播", { fill: C.primary, r: 2 });
  auto(tf, { dir: "h", w: 68, h: 4, mainFixed: true, crossFixed: true });
  track.appendChild(tf);
  mid.appendChild(track);
  prow.appendChild(mid);
  try { mid.layoutGrow = 1; } catch (e) {}
  prow.appendChild(txt("00:14", "micro", { color: C.t3, stretch: false }));
  player.appendChild(prow);
  c.appendChild(player);

  c.appendChild(txt("参考答案", "title-2", { color: C.t1, stretch: false }));
  c.appendChild(txt("闭包是函数和它定义时所在作用域的组合。\n\n内部函数可以访问外部函数的变量，即使外部函数已经执行完毕，这些变量也不会被回收。\n\n典型用途：封装私有变量、函数柯里化、防抖节流里保存定时器 id。", "body", { color: C.t2 }));
  s.appendChild(c);

  const bar = box("底部操作", { fill: C.bg });
  auto(bar, { dir: "h", gap: 12, pt: 12, pb: 20, pl: 20, pr: 20, w: 390, crossFixed: true });
  bar.appendChild(button("上一题", "secondary", { w: 169 }));
  const nextBtn = button("下一题", "primary", { w: 169 });
  bar.appendChild(nextBtn);
  s.appendChild(bar);
  return { frame: s, links: [[nextBtn, "S6_Review_Ready"]] };
}

function sMe() {
  const s = shell("S9_Me");
  navBar(s, "我的");
  const c = contentArea(788);

  const acct = card("账号");
  stretch(acct);
  const row = box("账号行", {});
  auto(row, { dir: "h", gap: 12, cross: "CENTER" });
  const av = box("avatar", { fill: C.primarySoft, r: 22 });
  auto(av, { dir: "v", main: "CENTER", cross: "CENTER", w: 44, h: 44, mainFixed: true, crossFixed: true });
  av.appendChild(txt("K", "body-strong", { color: C.primary, stretch: false }));
  row.appendChild(av);
  const info = box("账号信息", {});
  auto(info, { dir: "v", gap: 2 });
  info.appendChild(txt("kaozhen", "body-strong", { color: C.t1 }));
  info.appendChild(txt("已登录 · 进度自动同步", "micro", { color: C.t3 }));
  row.appendChild(info);
  try { info.layoutGrow = 1; } catch (e) {}
  acct.appendChild(row);
  c.appendChild(acct);

  const list = card("列表");
  stretch(list);
  let first = true;
  [["题库", "面试题库.pdf · 240 题", "重新导入"], ["背诵进度", "已背 128 / 240", "重置"], ["录音存储", "仅保存在本机，不上传", "待定"]].forEach(function (v) {
    const item = box("item", {});
    auto(item, { dir: "h", gap: 12, pt: 15, pb: 15, cross: "CENTER", w: 310, crossFixed: true });
    if (!first) {
      const sep = box("divider", { fill: C.line });
      auto(sep, { dir: "h", w: 310, h: 1, mainFixed: true, crossFixed: true });
      list.appendChild(sep);
    }
    first = false;
    const t = box("文本", {});
    auto(t, { dir: "v", gap: 2 });
    t.appendChild(txt(v[0], "body", { color: C.t1 }));
    t.appendChild(txt(v[1], "caption", { color: C.t2 }));
    item.appendChild(t);
    try { t.layoutGrow = 1; } catch (e) {}
    item.appendChild(txt(v[2], "caption", { color: v[2] === "待定" ? C.t3 : C.primary, stretch: false }));
    list.appendChild(item);
  });
  c.appendChild(list);

  c.appendChild(stretch(button("退出登录", "secondary", { w: 350, dangerText: true })));
  s.appendChild(c);
  return { frame: s, links: [] };
}

/* ---------------- 8. 生成「原型流程」页 ---------------- */

function buildPrototypePage(page) {
  const root = box("Prototype Flow", { fill: C.bg });
  auto(root, { dir: "v", gap: 32, p: 48 });

  root.appendChild(txt("页面流程 Prototype Flow", "display", { color: C.t1, stretch: false }));
  root.appendChild(txt("Screens 页里的按钮已经直接挂好了点击跳转，切到「演示」模式即可走完整流程。", "body", { color: C.t2, stretch: false }));

  const flow = box("流程", {});
  auto(flow, { dir: "v", gap: 14, w: 900, crossFixed: true });

  const steps = [
    "S0_Login  →  S1_Home",
    "S1_Home 「导入题库」  →  S2_Import  →  S3_ParseResult  →  S4_Recite",
    "S1_Home 「继续背诵」  →  S4_Recite",
    "S1_Home 「开始复习」  →  S5_ReviewScope  →  S6_Review_Ready",
    "S6_Review_Ready（按住说话）  →  S7_Review_Recording  →  S8_Review_Compare",
    "S8_Review_Compare 「下一题」  →  回到 S6_Review_Ready（循环）",
    "S1_Home 右上角「我的」  →  S9_Me"
  ];
  steps.forEach(function (v, i) {
    const r = box("step-" + (i + 1), { fill: C.surface, stroke: C.line, r: 12 });
    auto(r, { dir: "v", p: 16, gap: 6, w: 900, crossFixed: true });
    r.appendChild(txt(String(i + 1), "micro", { color: C.t3, stretch: false }));
    r.appendChild(txt(v, "body-strong", { color: C.t1 }));
    flow.appendChild(r);
  });
  root.appendChild(flow);

  const rule = box("硬约束", { fill: C.dangerSoft, r: 12 });
  auto(rule, { dir: "v", p: 16, gap: 6, w: 900, crossFixed: true });
  rule.appendChild(txt("复习模式的硬约束", "body-strong", { color: C.danger, stretch: false }));
  rule.appendChild(txt("在 S8_Review_Compare 之前，页面上不存在任何能看到答案的入口。这是复习区别于背诵的关键，实现时不能漏。", "caption", { color: C.danger }));
  root.appendChild(rule);

  page.appendChild(root);
  return root;
}

/* ---------------- 9. 入口 ---------------- */

async function loadFonts() {
  const families = ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Inter"];
  const regNames  = ["Regular", "W3", "Book"];
  const medNames  = ["Medium", "W4", "Semi Bold", "Semibold"];
  const boldNames = ["Semibold", "Semi Bold", "Bold", "W6"];

  for (let i = 0; i < families.length; i++) {
    const fam = families[i];
    let reg = null, med = null, bold = null;
    for (let a = 0; a < regNames.length && !reg; a++) {
      try { await figma.loadFontAsync({ family: fam, style: regNames[a] }); reg = { family: fam, style: regNames[a] }; } catch (e) {}
    }
    if (!reg) continue;
    for (let b = 0; b < medNames.length && !med; b++) {
      try { await figma.loadFontAsync({ family: fam, style: medNames[b] }); med = { family: fam, style: medNames[b] }; } catch (e) {}
    }
    for (let c2 = 0; c2 < boldNames.length && !bold; c2++) {
      try { await figma.loadFontAsync({ family: fam, style: boldNames[c2] }); bold = { family: fam, style: boldNames[c2] }; } catch (e) {}
    }
    F = { regular: reg, medium: med || reg, bold: bold || med || reg };
    return;
  }
  /* 兜底：Inter 是 Figma 内置字体，一定可用 */
  try { await figma.loadFontAsync({ family: "Inter", style: "Regular" }); } catch (e) {}
  try { await figma.loadFontAsync({ family: "Inter", style: "Medium" }); } catch (e) {}
  try { await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" }); } catch (e) {}
}

async function main() {
  await loadFonts();
  clearOldStyles();
  makeStyles();

  const tokensPage = newPage("🎨 Design Tokens");
  const compPage = newPage("🧩 Components");
  const screensPage = newPage("📱 Screens");
  const protoPage = newPage("🔗 Prototype");

  buildTokensPage(tokensPage);
  buildComponentsPage(compPage);

  const builders = [sLogin, function () { return sHome(false); }, function () { return sHome(true); },
                    sImport, sParseResult, sRecite, sReviewScope, sReviewReady,
                    sReviewRecording, sReviewCompare, sMe];

  const made = [];
  const linkMap = {};
  builders.forEach(function (fn) {
    const r = fn();
    screensPage.appendChild(r.frame);
    made.push(r.frame);
    linkMap[r.frame.name] = { node: r.frame, links: r.links };
  });

  /* 排版：每行 4 个，间距 80 */
  let x = 0, y = 0, rowH = 0, col = 0;
  made.forEach(function (n) {
    n.x = x;
    n.y = y;
    rowH = Math.max(rowH, n.height);
    col += 1;
    x += n.width + 80;
    if (col % 4 === 0) { x = 0; y += rowH + 120; rowH = 0; }
  });

  /* 挂原型跳转 */
  Object.keys(linkMap).forEach(function (name) {
    linkMap[name].links.forEach(function (pair) {
      const from = pair[0];
      const toName = pair[1];
      const target = linkMap[toName];
      if (!from || !target) return;
      try {
        from.reactions = [{
          trigger: { type: "ON_CLICK" },
          actions: [{ type: "NODE", destinationId: target.node.id, navigation: "NAVIGATE" }]
        }];
      } catch (e) {}
    });
  });

  buildPrototypePage(protoPage);

  figma.currentPage = screensPage;
  figma.viewport.scrollAndZoomIntoView(made);

  figma.notify("设计稿已生成：4 个页面 · 11 个界面 · 9 组组件", { timeout: 6000 });
  figma.closePlugin();
}

main().catch(function (err) {
  figma.notify("生成失败：" + (err && err.message ? err.message : String(err)), { error: true, timeout: 10000 });
  figma.closePlugin();
});
