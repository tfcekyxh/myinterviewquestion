/* =========================================================
   面试题背诵 · 界面 SVG 导出器
   运行：node design/build-svg.js
   产出：design/svg/*.svg（390×844，可直接拖进 Figma 变成可编辑图层）
   ========================================================= */

const fs = require("fs");
const path = require("path");

const W = 390, H = 844;
const BG = "#F5F6F8", SUR = "#FFFFFF", SUR2 = "#F0F2F5", LINE = "#E6E9EE";
const PRI = "#2563EB", PRISOFT = "#EFF4FF";
const DAN = "#E5484D", DANSOFT = "#FDEDED";
const WARNTX = "#8A6100", WARNBG = "#FDF6E9";
const T1 = "#141A23", T2 = "#69737F", T3 = "#98A1AC";
const FONT = "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans SC, sans-serif";

/* ---------- 文本度量与换行 ---------- */

function glyphWidth(ch, size) {
  const code = ch.codePointAt(0);
  if (code >= 0x2e80) return size;
  if (/[iIl1.,:;!|'\s]/.test(ch)) return size * 0.3;
  if (/[A-Z@%&#WwMm]/.test(ch)) return size * 0.72;
  return size * 0.56;
}

function measure(str, size) {
  let w = 0;
  for (const ch of String(str)) w += glyphWidth(ch, size);
  return w;
}

function wrapText(str, size, maxW) {
  const out = [];
  String(str).split("\n").forEach(function (para) {
    if (para === "") { out.push(""); return; }
    let line = "";
    for (const ch of para) {
      if (line !== "" && measure(line + ch, size) > maxW) { out.push(line); line = ch; }
      else line += ch;
    }
    if (line !== "") out.push(line);
  });
  return out;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------- 绘图文档 ---------- */

function Doc() { this.parts = []; }

Doc.prototype.raw = function (s) { this.parts.push(s); return this; };

Doc.prototype.rect = function (x, y, w, h, o) {
  o = o || {};
  let a = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"';
  if (o.rx) a += ' rx="' + o.rx + '"';
  a += ' fill="' + (o.fill || "none") + '"';
  if (o.opacity != null) a += ' fill-opacity="' + o.opacity + '"';
  if (o.stroke) a += ' stroke="' + o.stroke + '" stroke-width="' + (o.sw == null ? 0.5 : o.sw) + '"';
  if (o.dash) a += ' stroke-dasharray="' + o.dash + '"';
  a += "/>";
  return this.raw(a);
};

Doc.prototype.circle = function (cx, cy, r, o) {
  o = o || {};
  return this.raw('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + (o.fill || "none") +
    '"' + (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.sw == null ? 0.5 : o.sw) + '"' : "") + "/>");
};

/* 段落文本：从 yTop 开始排版，返回占用高度 */
Doc.prototype.text = function (x, yTop, str, o) {
  o = o || {};
  const size = o.size || 15;
  const lh = o.lh || Math.round(size * 1.6);
  const weight = o.weight || 400;
  const color = o.color || T1;
  const maxW = o.maxW == null ? (W - x * 2) : o.maxW;
  const lines = wrapText(str, size, maxW);
  const anchor = o.align === "middle" ? "middle" : (o.align === "end" ? "end" : "start");
  const tx = o.align === "middle" ? x + maxW / 2 : (o.align === "end" ? x + maxW : x);

  let s = "";
  lines.forEach(function (ln, i) {
    const base = Math.round(yTop + i * lh + lh * 0.72);
    s += '<text x="' + Math.round(tx) + '" y="' + base + '" font-family="' + FONT + '" font-size="' + size +
      '" font-weight="' + weight + '" fill="' + color + '" text-anchor="' + anchor + '">' + esc(ln) + "</text>";
  });
  this.raw(s);
  return lines.length * lh;
};

/* 在矩形内水平垂直居中 */
Doc.prototype.center = function (x, yTop, w, h, str, o) {
  o = o || {};
  const size = o.size || 15;
  const lh = o.lh || Math.round(size * 1.6);
  const lines = wrapText(str, size, w);
  const blockH = lines.length * lh;
  const startY = yTop + (h - blockH) / 2;
  return this.text(x, startY, str, Object.assign({}, o, { size: size, lh: lh, maxW: w, align: "middle" }));
};

Doc.prototype.svg = function () {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">\n' +
    this.parts.join("\n") + "\n</svg>\n";
};

/* ---------- 通用零件 ---------- */

function chrome(d) {
  d.rect(0, 0, W, H, { fill: BG });
  d.text(30, 12, "9:41", { size: 13, weight: 600, color: T1, maxW: 60 });
  d.rect(331, 17, 15, 9, { fill: T1, rx: 1.5 });
  d.rect(350, 16, 22, 10, { fill: "none", stroke: T1, sw: 1, rx: 3 });
  d.rect(128, 830, 134, 5, { fill: T1, rx: 3, opacity: 0.22 });
}

function backIcon(d, x, y) {
  d.raw('<path d="M' + (x + 9) + " " + (y + 5) + " L" + x + " " + (y + 12) + " L" + (x + 9) + " " + (y + 19) +
    '" fill="none" stroke="' + T1 + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');
}

/* 右侧模式切换 chip（右对齐排列） */
function drawChips(d, y, chips) {
  let cx = W - 20;
  for (let i = chips.length - 1; i >= 0; i--) {
    const label = chips[i][0];
    const on = chips[i][1];
    const bw = Math.round(measure(label, 13)) + 28;
    cx -= bw;
    d.rect(cx, y, bw, 32, { fill: on ? PRISOFT : SUR, rx: 16, stroke: on ? PRI : LINE, sw: 0.5 });
    d.center(cx, y, bw, 32, label, { size: 13, color: on ? PRI : T2, weight: on ? 500 : 400 });
    cx -= 6;
  }
}

/* 预估某段文字排版后的高度 */
function textHeight(str, size, lh, maxW) {
  return wrapText(str, size, maxW).length * lh;
}

function navBar(d, title, o) {
  o = o || {};
  const y = 44;
  if (o.back !== false) backIcon(d, 22, y + 10);
  d.text(o.back === false ? 20 : 58, y + 18, title, { size: o.small ? 15 : 17, weight: o.small ? 500 : 600, color: T1, maxW: 200 });
  if (o.chips) drawChips(d, y + 12, o.chips);
}

function topBar(d, o) {
  o = o || {};
  d.rect(0, 0, W, 44, { fill: BG });
  if (o.back !== false) backIcon(d, 22, 54);
  d.text(o.back === false ? 20 : 58, 62, o.title || "", { size: o.small ? 15 : 17, weight: o.small ? 500 : 600, color: T1, maxW: 190 });
  if (o.chips) drawChips(d, 56, o.chips);
}

function thinProgress(d, y, pct) {
  d.rect(20, y, 350, 3, { fill: SUR2 });
  d.rect(20, y, Math.max(4, 350 * pct), 3, { fill: PRI });
}

function button(d, x, y, w, h, label, kind) {
  const primary = kind === "primary";
  d.rect(x, y, w, h, { fill: primary ? PRI : SUR, rx: 12, stroke: primary ? null : LINE, sw: 0.5 });
  d.center(x, y, w, h, label, { size: 15, weight: 500, color: primary ? "#FFFFFF" : (kind === "danger" ? DAN : T1) });
}

function card(d, x, y, w, h, r) {
  d.rect(x, y, w, h, { fill: SUR, rx: r == null ? 16 : r, stroke: LINE, sw: 0.5 });
}

function noteBlock(d, x, y, w, str, kind) {
  const conf = {
    info: [PRISOFT, PRI],
    warn: [WARNBG, WARNTX],
    error: [DANSOFT, DAN]
  }[kind] || [PRISOFT, PRI];
  const lines = wrapText(str, 13, w - 28);
  const h = lines.length * 20 + 24;
  d.rect(x, y, w, h, { fill: conf[0], rx: 12 });
  d.text(x + 14, y + 12, str, { size: 13, lh: 20, color: conf[1], maxW: w - 28 });
  return h;
}

function meter(d, x, y, num, label, color) {
  d.rect(x, y, 110, 84, { fill: SUR, rx: 12 });
  d.text(x, y + 18, num, { size: 24, weight: 600, color: color || T1, maxW: 110, align: "middle", lh: 30 });
  d.text(x, y + 54, label, { size: 11, color: T3, maxW: 110, align: "middle", lh: 18 });
}

/* ---------- 各界面 ---------- */

function sLogin() {
  const d = new Doc();
  chrome(d);
  d.text(20, 258, "面试题背诵", { size: 28, weight: 600, lh: 36, maxW: 350 });
  d.text(20, 302, "把题库变成一张张卡片，顺序背、随机背、开口复习", { size: 13, lh: 20, color: T2, maxW: 350 });

  d.text(22, 366, "账号", { size: 11, lh: 16, color: T2, maxW: 120 });
  d.rect(20, 388, 350, 50, { fill: SUR, rx: 12, stroke: LINE, sw: 0.5 });
  d.text(36, 401, "kaozhen", { size: 15, lh: 24, color: T1, maxW: 322 });

  d.text(22, 456, "密码", { size: 11, lh: 16, color: T2, maxW: 120 });
  d.rect(20, 478, 350, 50, { fill: SUR, rx: 12, stroke: LINE, sw: 0.5 });
  d.text(36, 491, "••••••••", { size: 15, lh: 24, color: T3, maxW: 322 });

  button(d, 20, 558, 350, 50, "登录", "primary");
  d.text(20, 628, "仅本人使用，不开放注册", { size: 11, lh: 16, color: T3, maxW: 350, align: "middle" });
  return d.svg();
}

function sHome(empty) {
  const d = new Doc();
  chrome(d);
  d.text(20, 62, "下午好", { size: 17, weight: 600, lh: 26, maxW: 200 });
  d.rect(322, 62, 48, 32, { fill: SUR, rx: 16, stroke: LINE, sw: 0.5 });
  d.center(322, 62, 48, 32, "我的", { size: 13, color: T2 });

  if (!empty) {
    card(d, 20, 116, 350, 150);
    d.text(36, 132, "背诵进度", { size: 13, lh: 20, color: T2, maxW: 200 });
    d.text(36, 154, "128", { size: 26, weight: 600, lh: 34, maxW: 120 });
    d.text(36 + Math.round(measure("128", 26)) + 8, 165, "/ 240", { size: 15, lh: 22, color: T3, maxW: 120 });
    d.text(36 + 200, 160, "53%", { size: 11, lh: 16, color: T3, maxW: 114, align: "end" });
    d.rect(36, 208, 310, 6, { fill: SUR2, rx: 3 });
    d.rect(36, 208, 164, 6, { fill: PRI, rx: 3 });
    d.text(36, 230, "上次背到第 129 题 · 进度已同步到云端", { size: 11, lh: 16, color: T3, maxW: 310 });

    button(d, 20, 296, 350, 56, "继续背诵", "primary");
    button(d, 20, 364, 350, 56, "开始复习", "secondary");
    d.text(20, 444, "题库：面试题库.pdf · 240 题", { size: 13, lh: 20, color: T2, maxW: 260 });
    d.text(20, 444, "管理", { size: 13, lh: 20, color: PRI, maxW: 350, align: "end" });
  } else {
    d.rect(20, 116, 350, 200, { fill: SUR, rx: 16, stroke: LINE, sw: 0.5, dash: "6 5" });
    d.rect(173, 150, 44, 44, { fill: SUR2, rx: 12 });
    d.text(20, 210, "还没有题库", { size: 15, weight: 500, lh: 24, color: T2, maxW: 350, align: "middle" });
    d.text(20, 238, "点这里导入面试题 PDF", { size: 11, lh: 16, color: T3, maxW: 350, align: "middle" });
    button(d, 20, 348, 350, 56, "导入题库", "primary");
    d.text(20, 420, "导入并解析完成后，才能开始背诵和复习", { size: 11, lh: 16, color: T3, maxW: 350, align: "middle" });
  }
  return d.svg();
}

function sImport() {
  const d = new Doc();
  chrome(d);
  topBar(d, { title: "导入题库" });

  d.rect(20, 118, 350, 176, { fill: SUR, rx: 16, stroke: LINE, sw: 0.5, dash: "6 5" });
  d.rect(173, 152, 44, 44, { fill: SUR2, rx: 12 });
  d.text(20, 212, "点击选择 PDF 文件", { size: 15, weight: 500, lh: 24, color: T2, maxW: 350, align: "middle" });
  d.text(20, 240, "支持 .pdf；扫描版图片需要额外识别", { size: 11, lh: 16, color: T3, maxW: 350, align: "middle" });

  card(d, 20, 314, 350, 76);
  d.text(36, 330, "面试题库.pdf", { size: 15, weight: 500, lh: 24, maxW: 240 });
  d.text(36, 356, "2.4 MB · 已选择", { size: 11, lh: 16, color: T3, maxW: 240 });
  d.text(20, 342, "更换", { size: 13, lh: 20, color: PRI, maxW: 334, align: "end" });

  noteBlock(d, 20, 410, 350, "解析会按 PDF 的排版自动切分题目与答案，解析完成后可以逐题检查修正。", "info");

  button(d, 20, 754, 350, 50, "开始解析", "primary");
  return d.svg();
}

function sParseResult() {
  const d = new Doc();
  chrome(d);
  topBar(d, { title: "解析完成" });

  meter(d, 20, 118, "240", "题目");
  meter(d, 140, 118, "240", "答案");
  meter(d, 260, 118, "2", "待确认", DAN);

  noteBlock(d, 20, 222, 350, "有 2 处切分可能不准，建议先修正确认再开始背，避免背错。", "warn");
  d.text(20, 320, "前 3 题预览", { size: 17, weight: 600, lh: 26, maxW: 350 });

  const items = [
    ["第 1 题", "什么是闭包？", "内部函数能记住并访问它定义时所在作用域里的变量"],
    ["第 2 题", "说说事件循环的理解", "主线程执行同步任务，异步任务进入任务队列排队等待"],
    ["第 3 题", "原型链是什么？", "对象通过 __proto__ 向上查找属性的链路"]
  ];
  items.forEach(function (it, i) {
    const y = 356 + i * 116;
    card(d, 20, y, 350, 104);
    d.text(36, y + 14, it[0], { size: 11, lh: 16, color: T3, maxW: 200 });
    d.text(20, y + 14, "修正", { size: 11, lh: 16, color: PRI, maxW: 334, align: "end" });
    d.text(36, y + 38, it[1], { size: 15, weight: 500, lh: 24, maxW: 318 });
    d.text(36, y + 66, it[2], { size: 13, lh: 20, color: T2, maxW: 318 });
  });

  button(d, 20, 754, 169, 50, "重新导入", "secondary");
  button(d, 201, 754, 169, 50, "开始背诵", "primary");
  return d.svg();
}

function sRecite() {
  const d = new Doc();
  chrome(d);
  topBar(d, { title: "第 12 / 240 题", small: true, chips: [["随机", false], ["顺序", true]] });
  thinProgress(d, 100, 0.05);

  const Q = "什么是闭包？请结合你项目里的例子说明。";
  const A = "闭包是函数和它定义时所在作用域的组合。\n\n内部函数可以访问外部函数的变量，即使外部函数已经执行完毕，这些变量也不会被回收。\n\n典型用途：封装私有变量、函数柯里化、防抖节流里保存定时器 id。";
  const MICRO = "答案与题目同屏显示，先自己过一遍再看";

  const qh = textHeight(Q, 22, 32, 318);
  const ah = textHeight(A, 15, 26, 318);
  const mh = textHeight(MICRO, 11, 16, 318);
  const cardH = 24 + qh + 14 + 1 + 14 + ah + 14 + 1 + 14 + mh + 24;

  card(d, 20, 120, 350, cardH, 16);
  d.text(36, 144, Q, { size: 22, weight: 600, lh: 32, maxW: 318 });
  const divY = 144 + qh + 14;
  d.rect(36, divY, 318, 1, { fill: LINE });
  const aY = divY + 15;
  d.text(36, aY, A, { size: 15, lh: 26, color: T2, maxW: 318 });
  const div2Y = aY + ah + 14;
  d.rect(36, div2Y, 318, 1, { fill: LINE });
  d.text(36, div2Y + 15, MICRO, { size: 11, lh: 16, color: T3, maxW: 318 });

  button(d, 20, 754, 169, 50, "上一题", "secondary");
  button(d, 201, 754, 169, 50, "下一题", "primary");
  return d.svg();
}

function sReviewScope() {
  const d = new Doc();
  chrome(d);
  topBar(d, { title: "开始复习" });

  const nh = d.text(20, 114, "答案会先藏起来，请对着题目开口讲一遍并录音，讲完再点开答案对照。", { size: 13, lh: 20, color: T2, maxW: 350 });

  const optY = 114 + nh + 20;
  d.rect(20, optY, 350, 76, { fill: PRISOFT, rx: 16, stroke: PRI, sw: 0.5 });
  d.text(36, optY + 16, "复习刚背完的这一轮", { size: 15, weight: 500, lh: 24, color: PRI, maxW: 260 });
  d.text(36, optY + 44, "第 1 – 12 题", { size: 11, lh: 16, color: T3, maxW: 260 });
  d.circle(340, optY + 38, 10, { fill: SUR, stroke: PRI, sw: 1.5 });
  d.circle(340, optY + 38, 4.5, { fill: PRI });

  d.rect(20, optY + 88, 350, 76, { fill: SUR, rx: 16, stroke: LINE, sw: 0.5 });
  d.text(36, optY + 104, "复习整个题库", { size: 15, weight: 500, lh: 24, maxW: 260 });
  d.text(36, optY + 132, "共 240 题", { size: 11, lh: 16, color: T3, maxW: 260 });
  d.circle(340, optY + 126, 10, { fill: SUR, stroke: LINE, sw: 1.5 });

  const mY = optY + 192;
  d.text(22, mY, "复习顺序", { size: 11, lh: 16, color: T2, maxW: 200 });
  let cx = 20;
  [["顺序复习", true], ["随机复习", false]].forEach(function (c) {
    const bw = Math.round(measure(c[0], 13)) + 28;
    d.rect(cx, mY + 22, bw, 32, { fill: c[1] ? PRISOFT : SUR, rx: 16, stroke: c[1] ? PRI : LINE, sw: 0.5 });
    d.center(cx, mY + 22, bw, 32, c[0], { size: 13, color: c[1] ? PRI : T2, weight: c[1] ? 500 : 400 });
    cx += bw + 6;
  });

  button(d, 20, 754, 350, 50, "开始复习", "primary");
  return d.svg();
}

function sReviewReady() {
  const d = new Doc();
  chrome(d);
  topBar(d, { title: "复习 · 第 12 / 240 题", small: true, chips: [["随机", false], ["顺序", true]] });
  thinProgress(d, 100, 0.05);

  const qh = d.text(20, 120, "什么是闭包？请结合你项目里的例子说明。", { size: 22, weight: 600, lh: 32, maxW: 350 });

  const boxY = 120 + qh + 20;
  const boxH = 620 - boxY;
  d.rect(20, boxY, 350, boxH, { fill: SUR2, rx: 16 });
  d.center(20, boxY, 350, boxH, "答案已隐藏，讲完再看", { size: 13, color: T3 });

  const micCY = 706;
  d.circle(195, micCY, 44, { fill: PRI });
  d.rect(190, micCY - 16, 10, 22, { fill: "#FFFFFF", rx: 5 });
  d.raw('<path d="M180 ' + (micCY + 2) + ' a15 15 0 0 0 30 0" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>');
  d.raw('<path d="M195 ' + (micCY + 17) + " L195 " + (micCY + 24) + '" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>');

  d.text(20, micCY + 60, "按住说话，讲完松手", { size: 13, lh: 20, color: T2, maxW: 350, align: "middle" });
  d.text(20, micCY + 86, "录音只保存在本机", { size: 11, lh: 16, color: T3, maxW: 350, align: "middle" });
  return d.svg();
}

function sReviewRecording() {
  const d = new Doc();
  chrome(d);
  topBar(d, { title: "复习 · 第 12 / 240 题", small: true, chips: [["随机", false], ["顺序", true]] });
  thinProgress(d, 100, 0.05);

  const qh = d.text(20, 120, "什么是闭包？请结合你项目里的例子说明。", { size: 22, weight: 600, lh: 32, maxW: 350 });

  const barY = 120 + qh + 20;
  d.rect(20, barY, 350, 40, { fill: DANSOFT, rx: 12 });
  d.circle(140, barY + 20, 4, { fill: DAN });
  d.center(152, barY, 50, 40, "录音中", { size: 13, color: DAN });
  d.center(206, barY, 60, 40, "00:14", { size: 13, color: DAN });

  const wY = barY + 66;
  for (let i = 0; i < 24; i++) {
    const hgt = 8 + Math.round(Math.abs(Math.sin(i * 1.7)) * 15);
    d.rect(134 + i * 5, wY + (34 - hgt) / 2, 2, hgt, { fill: DAN, rx: 1 });
  }

  const micCY = 690;
  d.circle(195, micCY, 44, { fill: DAN });
  d.rect(190, micCY - 16, 10, 22, { fill: "#FFFFFF", rx: 5 });
  d.raw('<path d="M180 ' + (micCY + 2) + ' a15 15 0 0 0 30 0" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>');
  d.raw('<path d="M195 ' + (micCY + 17) + " L195 " + (micCY + 24) + '" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>');

  button(d, 105, micCY + 58, 180, 50, "说完了", "secondary");
  return d.svg();
}

function sReviewCompare() {
  const d = new Doc();
  chrome(d);
  topBar(d, { title: "复习 · 第 12 / 240 题", small: true, chips: [["随机", false], ["顺序", true]] });
  thinProgress(d, 100, 0.05);

  const qh = d.text(20, 120, "什么是闭包？请结合你项目里的例子说明。", { size: 17, weight: 600, lh: 26, maxW: 350 });

  const cY = 120 + qh + 20;
  card(d, 20, cY, 350, 76);
  d.circle(56, cY + 38, 19, { fill: PRI });
  d.raw('<path d="M51 ' + (cY + 31) + " L62 " + (cY + 38) + " L51 " + (cY + 45) + ' Z" fill="#FFFFFF"/>');
  d.text(88, cY + 18, "回放我刚才说的", { size: 13, lh: 20, color: T2, maxW: 180 });
  d.rect(88, cY + 44, 200, 4, { fill: SUR2, rx: 2 });
  d.rect(88, cY + 44, 68, 4, { fill: PRI, rx: 2 });
  d.text(20, cY + 30, "00:14", { size: 11, lh: 16, color: T3, maxW: 334, align: "end" });

  const aY = cY + 100;
  d.text(20, aY, "参考答案", { size: 17, weight: 600, lh: 26, maxW: 350 });
  d.text(20, aY + 36, "闭包是函数和它定义时所在作用域的组合。\n\n内部函数可以访问外部函数的变量，即使外部函数已经执行完毕，这些变量也不会被回收。\n\n典型用途：封装私有变量、函数柯里化、防抖节流里保存定时器 id。", { size: 15, lh: 26, color: T2, maxW: 350 });

  button(d, 20, 754, 169, 50, "上一题", "secondary");
  button(d, 201, 754, 169, 50, "下一题", "primary");
  return d.svg();
}

function sMe() {
  const d = new Doc();
  chrome(d);
  topBar(d, { title: "我的" });

  card(d, 20, 118, 350, 76);
  d.circle(58, 156, 22, { fill: PRISOFT });
  d.text(46, 143, "K", { size: 15, weight: 600, color: PRI, lh: 26, maxW: 24, align: "middle" });
  d.text(92, 134, "kaozhen", { size: 15, weight: 500, lh: 24, maxW: 240 });
  d.text(92, 160, "已登录 · 进度自动同步", { size: 11, lh: 16, color: T3, maxW: 240 });

  card(d, 20, 210, 350, 170);
  const rows = [
    ["题库", "面试题库.pdf · 240 题", "重新导入"],
    ["背诵进度", "已背 128 / 240", "重置"],
    ["录音存储", "仅保存在本机，不上传", "待定"]
  ];
  rows.forEach(function (r, i) {
    const y = 210 + i * 56;
    if (i > 0) d.rect(36, y, 318, 1, { fill: LINE });
    d.text(36, y + 14, r[0], { size: 15, lh: 24, maxW: 240 });
    d.text(36, y + 38, r[1], { size: 13, lh: 20, color: T2, maxW: 240 });
    d.text(20, y + 20, r[2], { size: 13, lh: 20, color: r[2] === "待定" ? T3 : PRI, maxW: 334, align: "end" });
  });

  button(d, 20, 396, 350, 50, "退出登录", "danger");
  return d.svg();
}

/* ---------- 输出 ---------- */

const screens = [
  ["S0_Login", sLogin()],
  ["S1_Home", sHome(false)],
  ["S1b_Home_Empty", sHome(true)],
  ["S2_Import", sImport()],
  ["S3_ParseResult", sParseResult()],
  ["S4_Recite", sRecite()],
  ["S5_ReviewScope", sReviewScope()],
  ["S6_Review_Ready", sReviewReady()],
  ["S7_Review_Recording", sReviewRecording()],
  ["S8_Review_Compare", sReviewCompare()],
  ["S9_Me", sMe()]
];

const outDir = path.join(__dirname, "svg");
fs.mkdirSync(outDir, { recursive: true });

let total = 0;
screens.forEach(function (s) {
  const file = path.join(outDir, s[0] + ".svg");
  fs.writeFileSync(file, s[1], "utf8");
  total += s[1].length;
  console.log("  ✓ " + s[0] + ".svg  (" + (s[1].length / 1024).toFixed(1) + " KB)");
});
console.log("\n共 " + screens.length + " 个界面，输出目录：design/svg/，合计 " + (total / 1024).toFixed(1) + " KB");
