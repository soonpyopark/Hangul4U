import init, { HwpDocument } from "./rhwp.js";

const openButton = document.querySelector("#open");
const fileInput = document.querySelector("#file");
const prevButton = document.querySelector("#prev");
const nextButton = document.querySelector("#next");
const gotoButton = document.querySelector("#goto");
const statusEl = document.querySelector("#status");
const scroller = document.querySelector("#scroller");
const emptyEl = document.querySelector("#empty");
const sheet = document.querySelector("#sheet");
const zoomOutButton = document.querySelector("#zoom-out");
const zoomFitButton = document.querySelector("#zoom-fit");
const zoomInButton = document.querySelector("#zoom-in");
const gotoLayer = document.querySelector("#goto-layer");
const gotoForm = document.querySelector("#goto-form");
const gotoInput = document.querySelector("#goto-input");
const gotoHint = document.querySelector("#goto-hint");
const gotoCancel = document.querySelector("#goto-cancel");
const loadingLayer = document.querySelector("#loading-layer");
const loadingNameEl = document.querySelector("#loading-name");
const loadingBar = document.querySelector("#loading-bar");
const loadingPercent = document.querySelector("#loading-percent");
const loadingCancel = document.querySelector("#loading-cancel");
const aboutButton = document.querySelector("#about");
const aboutLayer = document.querySelector("#about-layer");
const aboutClose = document.querySelector("#about-close");
const aboutLicense = document.querySelector("#about-license");
const aboutAppName = document.querySelector("#about-app-name");
const aboutVersion = document.querySelector("#about-version");
const aboutPackaged = document.querySelector("#about-packaged");
const docTitle = document.querySelector("#doc-title");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const searchPrev = document.querySelector("#search-prev");
const searchNext = document.querySelector("#search-next");

let doc = null;
let page = 0;
let pageTotal = 0;
let pageWidth = 794;
let pageHeight = 1122;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
let zoom = 1;
let zoomMode = "width";
let openGeneration = 0;
let loadingGeneration = 0;
let activeToken = "";
let ignoreDelivered = false;
let viewGeneration = 0;
let sections = [];
let heightRatio = [];
let prefix = [];
let scrollOrigin = 0;
let pageGapValue = 10;
let lastScrollTop = 0;
let lastScrollTime = 0;
let paintFrame = 0;
let settleTimer = 0;
const pointers = new Map();
let pinch = null;
let captionTables = [];
let openedName = "";
let searchHits = [];
let searchIndex = -1;
let searchQuery = "";
let searchTimer = 0;
let searchSerial = 0;

const engineReady = init().then(() => {
  setStatus("");
}).catch((error) => {
  setStatus(`엔진을 불러오지 못했습니다. ${errorMessage(error)}`);
  throw error;
});

function setStatus(message) {
  statusEl.textContent = message;
  statusEl.hidden = !message;
}

function errorMessage(error) {
  return error?.message || String(error);
}

function showError(message) {
  hideLoading();
  showDocumentTitle(openedName);
  setStatus(message);
}

function showDocumentTitle(name) {
  const label = name || "";
  docTitle.textContent = label || "문서를 열면 제목이 표시됩니다";
  docTitle.title = label;
  docTitle.classList.toggle("is-empty", !label);
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function beginOpen(name, token = "") {
  const generation = ++openGeneration;
  loadingGeneration = generation;
  activeToken = token || "";
  ignoreDelivered = false;
  loadingNameEl.textContent = name || "문서";
  showDocumentTitle(name);
  loadingLayer.hidden = false;
  setLoadingProgress(8);
  return generation;
}

function setLoadingProgress(percent) {
  if (loadingLayer.hidden) return;
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  loadingBar.style.width = `${value}%`;
  loadingPercent.textContent = `${value}%`;
}

function hideLoading(generation) {
  if (generation !== undefined && generation !== loadingGeneration) return;
  loadingLayer.hidden = true;
}

function cancelOpen() {
  ignoreDelivered = true;
  activeToken = "";
  openGeneration += 1;
  hideLoading();
  showDocumentTitle(openedName);
  if (!doc) return;
  viewGeneration = openGeneration;
  paintWindow();
}

function parseSvg(svgText, prefix) {
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = parsed.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== "svg") {
    throw new Error("페이지를 그리지 못했습니다.");
  }
  svg.querySelectorAll("script").forEach((node) => node.remove());
  const node = document.importNode(svg, true);
  if (prefix) namespaceSvg(node, prefix);
  node.setAttribute("preserveAspectRatio", "xMidYMin meet");
  node.setAttribute("overflow", "hidden");
  const width = Number(svg.getAttribute("width")) || pageWidth;
  const height = Number(svg.getAttribute("height")) || 1;
  enforceHairlines(node, width);
  node.style.width = "100%";
  node.style.height = "auto";
  return { node, width, height };
}

function readPageSize(svgText) {
  const tag = svgText.slice(0, svgText.indexOf(">"));
  const width = Number(tag.match(/\bwidth="([0-9.]+)"/)?.[1]);
  const height = Number(tag.match(/\bheight="([0-9.]+)"/)?.[1]);
  return {
    width: Number.isFinite(width) && width > 0 ? width : pageWidth,
    height: Number.isFinite(height) && height > 0 ? height : 1122
  };
}

function displayScale(width = pageWidth) {
  const cssWidth = Math.max(scroller.clientWidth, 1) * zoom;
  const dpr = window.devicePixelRatio || 1;
  return (cssWidth / width) * dpr;
}

function paintKey() {
  return displayScale().toFixed(2);
}

function enforceHairlines(node, width) {
  const min = 1 / Math.max(displayScale(width), 0.25);
  for (const el of node.querySelectorAll("[stroke-width]")) {
    let stroke = null;
    let current = el;
    while (current && current.nodeType === 1 && current !== node.parentElement) {
      const value = current.getAttribute("stroke");
      if (value) {
        stroke = value;
        break;
      }
      current = current.parentElement;
    }
    if (!stroke || stroke === "none" || stroke === "transparent") continue;
    const width = Number(el.getAttribute("stroke-width"));
    if (!Number.isFinite(width) || width <= 0 || width >= min) continue;
    el.setAttribute("stroke-width", min.toFixed(3));
  }
}

function namespaceSvg(node, prefix) {
  const ids = new Map();
  for (const el of node.querySelectorAll("[id]")) {
    const next = `${prefix}-${el.id}`;
    ids.set(el.id, next);
    el.setAttribute("id", next);
  }
  const mapRef = (value) => value.replace(/url\(\s*#([^)]+?)\s*\)/g, (all, id) => {
    const mapped = ids.get(id.trim());
    return mapped ? `url(#${mapped})` : all;
  });
  const refAttrs = ["clip-path", "fill", "stroke", "filter", "mask", "style"];
  for (const el of node.querySelectorAll("*")) {
    for (const name of refAttrs) {
      const value = el.getAttribute(name);
      if (value?.includes("#")) el.setAttribute(name, mapRef(value));
    }
    const href = el.getAttribute("href");
    if (!href) continue;
    if (href.startsWith("#")) {
      const mapped = ids.get(href.slice(1));
      if (mapped) el.setAttribute("href", `#${mapped}`);
    } else if (!el.getAttribute("xlink:href")) {
      el.setAttribute("xlink:href", href);
    }
  }
}

function contentWidth() {
  const measured = sections[0]?.clientWidth || 0;
  if (measured > 0) return measured;
  return Math.max((scroller.clientWidth || 1) - 4, 1);
}

function slotHeight(index) {
  return contentWidth() * (pageHeight / pageWidth) * (heightRatio[index] ?? 1);
}

function rebuildPrefix() {
  prefix = new Array(pageTotal + 1);
  prefix[0] = 0;
  for (let index = 0; index < pageTotal; index += 1) {
    prefix[index + 1] = prefix[index] + slotHeight(index) + pageGapValue;
  }
}

function measureScrollOrigin() {
  if (!sections[0]) return;
  const scrollerBox = scroller.getBoundingClientRect();
  scrollOrigin = sections[0].getBoundingClientRect().top - scrollerBox.top + scroller.scrollTop;
}

function layoutSlots() {
  if (!sections.length) return;
  pageGapValue = Number.parseFloat(getComputedStyle(sections[0]).marginBottom) || 0;
  for (let index = 0; index < sections.length; index += 1) {
    sections[index].style.height = `${slotHeight(index)}px`;
  }
  rebuildPrefix();
  measureScrollOrigin();
}

const SVG_NS = "http://www.w3.org/2000/svg";
const HWP_PX = 96 / 7200;

function huToPx(value) {
  const size = Number(value);
  return Number.isFinite(size) ? size * HWP_PX : 0;
}

function childElements(node, localName) {
  return [...(node?.children || [])].filter((element) => element.localName === localName);
}

function borderWidthPx(value) {
  const size = Number.parseFloat(value);
  if (!Number.isFinite(size) || size <= 0) return 0.5;
  return String(value).includes("mm") ? size / 25.4 * 96 : size;
}

function readBorderSide(fill, localName) {
  const side = childElements(fill, localName)[0];
  if (!side) return null;
  const type = side.getAttribute("type") || "NONE";
  if (type === "NONE") return null;
  return {
    type,
    width: borderWidthPx(side.getAttribute("width")),
    color: side.getAttribute("color") || "#000000"
  };
}

function dashArray(border) {
  const width = border.width;
  if (border.type === "DASH" || border.type === "LONG_DASH") return `${(width * 4).toFixed(2)} ${(width * 2).toFixed(2)}`;
  if (border.type === "DOT") return `${width.toFixed(2)} ${(width * 1.6).toFixed(2)}`;
  if (border.type === "DASH_DOT") return `${(width * 4).toFixed(2)} ${(width * 1.5).toFixed(2)} ${width.toFixed(2)} ${(width * 1.5).toFixed(2)}`;
  if (border.type === "DASH_DOT_DOT") return `${(width * 4).toFixed(2)} ${width.toFixed(2)} ${width.toFixed(2)} ${width.toFixed(2)}`;
  return "";
}

function readBorderFill(fill) {
  return {
    left: readBorderSide(fill, "leftBorder"),
    right: readBorderSide(fill, "rightBorder"),
    top: readBorderSide(fill, "topBorder"),
    bottom: readBorderSide(fill, "bottomBorder")
  };
}

async function unzipTexts(bytes, included) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const texts = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    const data = bytes.subarray(dataStart, dataStart + size);
    offset = dataStart + size;
    if (!included(name) || size < 1) continue;
    let raw = data;
    if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    texts.push(new TextDecoder().decode(raw));
  }
  return texts;
}

function hangulFonts(header) {
  const fonts = new Map();
  for (const face of header.getElementsByTagNameNS("*", "fontface")) {
    if (face.getAttribute("lang") !== "HANGUL") continue;
    for (const font of childElements(face, "font")) {
      fonts.set(font.getAttribute("id"), font.getAttribute("face") || "맑은 고딕");
    }
  }
  return fonts;
}

function readCharShape(node, fonts) {
  const fontId = childElements(node, "fontRef")[0]?.getAttribute("hangul");
  const face = fonts.get(fontId) || "맑은 고딕";
  const color = node.getAttribute("textColor");
  return {
    fontSize: huToPx(node.getAttribute("height")) || 13,
    fontFamily: `'${face}', 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif`,
    bold: childElements(node, "bold").length > 0,
    color: color && color !== "none" ? color : "#000000"
  };
}

function paragraphLines(para, aligns, chars) {
  let text = "";
  let style = null;
  for (const run of childElements(para, "run")) {
    if (childElements(run, "tbl").length) return [];
    const piece = childElements(run, "t").map((node) => node.textContent || "").join("");
    if (!piece) continue;
    text += piece;
    if (piece.trim() || !style) style = chars.get(run.getAttribute("charPrIDRef"));
  }
  if (!text.trim()) return [];
  const segment = childElements(childElements(para, "linesegarray")[0] || para, "lineseg")[0];
  return [{
    text,
    align: aligns.get(para.getAttribute("paraPrIDRef")) || "LEFT",
    fontSize: style?.fontSize || 13,
    fontFamily: style?.fontFamily || "'맑은 고딕', sans-serif",
    bold: style?.bold || false,
    color: style?.color || "#000000",
    top: huToPx(segment?.getAttribute("vertpos")),
    baseline: huToPx(segment?.getAttribute("baseline")) || style?.fontSize || 13,
    lineHeight: huToPx(segment?.getAttribute("vertsize")) || style?.fontSize || 13,
    left: huToPx(segment?.getAttribute("horzpos"))
  }];
}

function parseCaptionTable(table, captionParaIndex, align, borders, aligns, chars) {
  const size = table.getElementsByTagNameNS("*", "sz")[0];
  const margin = table.getElementsByTagNameNS("*", "outMargin")[0];
  const rowCount = Number(table.getAttribute("rowCnt")) || 0;
  const colCount = Number(table.getAttribute("colCnt")) || 0;
  const cells = [];
  for (const cell of table.getElementsByTagNameNS("*", "tc")) {
    if (cell.parentElement?.parentElement !== table) continue;
    const address = cell.getElementsByTagNameNS("*", "cellAddr")[0];
    const span = cell.getElementsByTagNameNS("*", "cellSpan")[0];
    const cellSize = cell.getElementsByTagNameNS("*", "cellSz")[0];
    if (!address || !cellSize) continue;
    const subList = childElements(cell, "subList")[0];
    const cellMargin = cell.getElementsByTagNameNS("*", "cellMargin")[0];
    const lines = [];
    for (const para of childElements(subList, "p")) lines.push(...paragraphLines(para, aligns, chars));
    cells.push({
      row: Number(address.getAttribute("rowAddr")) || 0,
      col: Number(address.getAttribute("colAddr")) || 0,
      rowSpan: Math.max(1, Number(span?.getAttribute("rowSpan")) || 1),
      colSpan: Math.max(1, Number(span?.getAttribute("colSpan")) || 1),
      width: huToPx(cellSize.getAttribute("width")),
      height: huToPx(cellSize.getAttribute("height")),
      borders: borders.get(cell.getAttribute("borderFillIDRef")) || {},
      vertAlign: subList?.getAttribute("vertAlign") || "TOP",
      pad: {
        left: huToPx(cellMargin?.getAttribute("left")),
        right: huToPx(cellMargin?.getAttribute("right")),
        top: huToPx(cellMargin?.getAttribute("top")),
        bottom: huToPx(cellMargin?.getAttribute("bottom"))
      },
      lines
    });
  }
  if (!cells.length || rowCount < 1 || colCount < 1) return null;
  const rowHeights = Array(rowCount).fill(0);
  const colWidths = Array(colCount).fill(0);
  for (const cell of cells) {
    if (cell.rowSpan === 1) rowHeights[cell.row] = cell.height;
    if (cell.colSpan === 1) colWidths[cell.col] = cell.width;
  }
  const marginLeft = huToPx(margin?.getAttribute("left"));
  const marginRight = huToPx(margin?.getAttribute("right"));
  const marginTop = huToPx(margin?.getAttribute("top"));
  const marginBottom = huToPx(margin?.getAttribute("bottom"));
  const width = huToPx(size?.getAttribute("width")) || colWidths.reduce((sum, value) => sum + value, 0);
  const declared = huToPx(size?.getAttribute("height"));
  const rowSum = rowHeights.reduce((sum, value) => sum + value, 0);
  if (declared > 0 && rowSum > 0 && Math.abs(declared - rowSum) > 1) {
    const scale = declared / rowSum;
    for (let index = 0; index < rowHeights.length; index += 1) rowHeights[index] *= scale;
  }
  const height = declared || rowSum;
  const caption = childElements(table, "caption")[0];
  const captionLines = [];
  for (const para of childElements(childElements(caption, "subList")[0], "p")) {
    captionLines.push(...paragraphLines(para, aligns, chars));
  }
  const captionHeight = captionLines.reduce((max, line) => Math.max(max, line.top + line.lineHeight), 0);
  return {
    captionParaIndex,
    align,
    width,
    height,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
    outerHeight: height + marginTop + marginBottom,
    captionSide: caption?.getAttribute("side") || "",
    captionGap: huToPx(caption?.getAttribute("gap")),
    captionHeight,
    captionLines,
    rowHeights,
    colWidths,
    frame: borders.get(table.getAttribute("borderFillIDRef")) || {},
    cells
  };
}

async function collectCaptionTables(document) {
  const bytes = document.exportHwpx();
  const [headerText] = await unzipTexts(bytes, (name) => name.endsWith("header.xml"));
  const sections = await unzipTexts(bytes, (name) => /section\d+\.xml$/.test(name));
  if (!headerText || !sections.length) return [];
  const header = new DOMParser().parseFromString(headerText, "application/xml");
  const borders = new Map();
  for (const fill of header.getElementsByTagNameNS("*", "borderFill")) {
    borders.set(fill.getAttribute("id"), readBorderFill(fill));
  }
  const fonts = hangulFonts(header);
  const chars = new Map();
  for (const shape of header.getElementsByTagNameNS("*", "charPr")) {
    chars.set(shape.getAttribute("id"), readCharShape(shape, fonts));
  }
  const aligns = new Map();
  for (const para of header.getElementsByTagNameNS("*", "paraPr")) {
    const align = childElements(para, "align")[0];
    aligns.set(para.getAttribute("id"), align?.getAttribute("horizontal") || "LEFT");
  }
  const tables = [];
  for (const xml of sections) {
    const section = new DOMParser().parseFromString(xml, "application/xml");
    for (const caption of section.getElementsByTagNameNS("*", "caption")) {
      const subList = childElements(caption, "subList")[0];
      if (!subList) continue;
      childElements(subList, "p").forEach((para, captionParaIndex) => {
        const align = aligns.get(para.getAttribute("paraPrIDRef")) || "LEFT";
        for (const run of childElements(para, "run")) {
          for (const table of childElements(run, "tbl")) {
            const parsed = parseCaptionTable(table, captionParaIndex, align, borders, aligns, chars);
            if (parsed) tables.push(parsed);
          }
        }
      });
    }
  }
  return tables;
}

function addBorderLine(group, x1, y1, x2, y2, border) {
  if (!border) return;
  const horizontal = Math.abs(y1 - y2) < 0.01;
  const gap = border.type.startsWith("DOUBLE") ? Math.max(border.width, 0.8) : 0;
  const offsets = gap ? [-gap / 2, gap / 2] : [0];
  for (const offset of offsets) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", (x1 + (horizontal ? 0 : offset)).toFixed(2));
    line.setAttribute("y1", (y1 + (horizontal ? offset : 0)).toFixed(2));
    line.setAttribute("x2", (x2 + (horizontal ? 0 : offset)).toFixed(2));
    line.setAttribute("y2", (y2 + (horizontal ? offset : 0)).toFixed(2));
    line.setAttribute("stroke", border.color);
    line.setAttribute("stroke-width", border.width.toFixed(3));
    const dashes = dashArray(border);
    if (dashes) line.setAttribute("stroke-dasharray", dashes);
    line.setAttribute("stroke-linecap", dashes ? "butt" : "square");
    line.setAttribute("fill", "none");
    group.append(line);
  }
}

function addSvgText(group, line, x, y, anchor) {
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", x.toFixed(2));
  text.setAttribute("y", y.toFixed(2));
  text.setAttribute("fill", line.color);
  text.setAttribute("font-size", line.fontSize.toFixed(2));
  text.setAttribute("font-family", line.fontFamily);
  if (line.bold) text.setAttribute("font-weight", "bold");
  if (anchor !== "start") text.setAttribute("text-anchor", anchor);
  text.textContent = line.text;
  group.append(text);
}

function drawCellText(group, cell, x, y, width, height) {
  if (!cell.lines?.length) return;
  const innerWidth = Math.max(1, width - cell.pad.left - cell.pad.right);
  const innerHeight = Math.max(1, height - cell.pad.top - cell.pad.bottom);
  const block = cell.lines.reduce((sum, line) => sum + line.fontSize, 0);
  const fit = block > innerHeight ? innerHeight / block : 1;
  let cursor = y + cell.pad.top;
  if (cell.vertAlign === "CENTER") cursor += Math.max(0, innerHeight - block * fit) / 2;
  if (cell.vertAlign === "BOTTOM") cursor += Math.max(0, innerHeight - block * fit);
  for (const line of cell.lines) {
    const fontSize = line.fontSize * fit;
    let textX = x + cell.pad.left + line.left;
    let anchor = "start";
    if (line.align === "CENTER") {
      textX = x + cell.pad.left + innerWidth / 2;
      anchor = "middle";
    } else if (line.align === "RIGHT") {
      textX = x + width - cell.pad.right;
      anchor = "end";
    }
    addSvgText(group, { ...line, fontSize }, textX, cursor + fontSize * 0.82, anchor);
    cursor += fontSize;
  }
}

function drawCaptionLines(group, table, originX, originY) {
  for (const line of table.captionLines) {
    let x = originX + line.left;
    let anchor = "start";
    if (line.align === "CENTER") {
      x = originX + table.width / 2;
      anchor = "middle";
    } else if (line.align === "RIGHT") {
      x = originX + table.width;
      anchor = "end";
    }
    addSvgText(group, line, x, originY + line.top + line.baseline, anchor);
  }
}

function drawCaptionTable(svg, table, run) {
  const pageWidthValue = Number(svg.getAttribute("width")) || pageWidth;
  const lineLeft = run.x + run.w > pageWidthValue + 1 ? run.x - run.w / 2 : run.x;
  const slot = table.width + table.marginLeft + table.marginRight;
  let left = lineLeft + table.marginLeft;
  if (table.align === "CENTER") left = lineLeft + (run.w - slot) / 2 + table.marginLeft;
  if (table.align === "RIGHT") left = lineLeft + run.w - slot + table.marginLeft;
  const extra = Math.max(0, run.h - table.outerHeight);
  const top = run.y + (table.captionSide === "TOP" ? extra : 0) + table.marginTop;
  const rowAt = [0];
  for (const height of table.rowHeights) rowAt.push(rowAt[rowAt.length - 1] + height);
  const colAt = [0];
  for (const width of table.colWidths) colAt.push(colAt[colAt.length - 1] + width);
  const group = document.createElementNS(SVG_NS, "g");
  const right = left + table.width;
  const bottom = top + table.height;
  addBorderLine(group, left, top, right, top, table.frame.top);
  addBorderLine(group, left, bottom, right, bottom, table.frame.bottom);
  addBorderLine(group, left, top, left, bottom, table.frame.left);
  addBorderLine(group, right, top, right, bottom, table.frame.right);
  for (const cell of table.cells) {
    const x = left + (colAt[cell.col] || 0);
    const y = top + (rowAt[cell.row] || 0);
    const nextCol = Math.min(table.colWidths.length, cell.col + cell.colSpan);
    const nextRow = Math.min(table.rowHeights.length, cell.row + cell.rowSpan);
    const cellRight = left + (colAt[nextCol] || table.width);
    const cellBottom = top + (rowAt[nextRow] || table.height);
    addBorderLine(group, x, y, cellRight, y, cell.borders.top);
    addBorderLine(group, x, cellBottom, cellRight, cellBottom, cell.borders.bottom);
    addBorderLine(group, x, y, x, cellBottom, cell.borders.left);
    addBorderLine(group, cellRight, y, cellRight, cellBottom, cell.borders.right);
    drawCellText(group, cell, x, y, cellRight - x, cellBottom - y);
  }
  if (table.captionSide === "TOP") drawCaptionLines(group, table, left, run.y);
  if (table.captionSide === "BOTTOM") {
    drawCaptionLines(group, table, left, bottom + table.marginBottom + table.captionGap);
  }
  svg.append(group);
}

function overlayCaptionTables(svg, pageIndex) {
  if (!doc || !captionTables.length) return;
  let layout;
  try {
    layout = JSON.parse(doc.getPageTextLayout(pageIndex));
  } catch {
    return;
  }
  const runs = layout.runs || [];
  const used = new Set();
  for (const table of captionTables) {
    let match = -1;
    let best = Infinity;
    runs.forEach((run, index) => {
      if (used.has(index) || run.cellIdx !== 65534 || run.cellParaIdx !== table.captionParaIndex) return;
      if ((run.text || "").trim()) return;
      if (run.h + 2 < table.outerHeight) return;
      if (run.h < best) {
        best = run.h;
        match = index;
      }
    });
    if (match < 0) continue;
    used.add(match);
    drawCaptionTable(svg, table, runs[match]);
  }
}

function mountInto(section, svgText) {
  const index = Number(section.dataset.index);
  const { node, width, height } = parseSvg(svgText, `p${index}`);
  overlayCaptionTables(node, index);
  enforceHairlines(node, width);
  const base = pageHeight / pageWidth;
  const ratio = width > 0 ? height / width : base;
  heightRatio[index] = base > 0 ? ratio / base : 1;
  section.style.height = `${slotHeight(index)}px`;
  node.style.width = "100%";
  node.style.height = "100%";
  markSearchHits(node, index);
  section.replaceChildren(node);
  section.dataset.ready = "1";
  section.dataset.paint = paintKey();
}

function releaseOutside(first, last) {
  let released = false;
  for (let index = 0; index < sections.length; index += 1) {
    if (index >= first && index <= last) continue;
    const section = sections[index];
    if (!section.firstChild) continue;
    section.replaceChildren();
    section.dataset.paint = "";
    section.dataset.ready = "0";
    section.style.height = `${slotHeight(index)}px`;
    released = true;
  }
  return released;
}

function paintWindow() {
  if (!doc || !sections.length || viewGeneration !== openGeneration) return;
  const key = paintKey();
  const from = Math.max(0, page - 1);
  const to = Math.min(pageTotal - 1, page + 2);
  let changed = false;
  for (let index = from; index <= to; index += 1) {
    if (!doc || viewGeneration !== openGeneration) return;
    const section = sections[index];
    if (section.dataset.paint === key && section.querySelector("svg")) continue;
    try {
      mountInto(section, doc.renderPageSvg(index));
    } catch (error) {
      section.dataset.ready = "1";
      section.dataset.paint = key;
      section.style.height = `${slotHeight(index)}px`;
      section.textContent = "이 쪽을 그리지 못했습니다.";
    }
    changed = true;
  }
  if (releaseOutside(from - 1, to + 1) || changed) {
    rebuildPrefix();
    measureScrollOrigin();
  }
}

function schedulePaint(fast) {
  clearTimeout(settleTimer);
  cancelAnimationFrame(paintFrame);
  if (fast) {
    settleTimer = setTimeout(paintWindow, 140);
    return;
  }
  paintFrame = requestAnimationFrame(paintWindow);
}

function clearPages() {
  sections = [];
  heightRatio = [];
  prefix = [];
  sheet.replaceChildren();
}

function updateCurrentPage() {
  if (!pageTotal || prefix.length !== pageTotal + 1) return;
  const viewTop = scroller.scrollTop;
  const viewBottom = viewTop + scroller.clientHeight;
  let low = 0;
  let high = pageTotal - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const bottom = scrollOrigin + prefix[mid + 1] - pageGapValue;
    if (bottom < viewTop) low = mid + 1;
    else high = mid;
  }
  let current = low;
  let best = -1;
  for (let index = low; index < pageTotal; index += 1) {
    const top = scrollOrigin + prefix[index];
    if (top >= viewBottom) break;
    const bottom = scrollOrigin + prefix[index + 1] - pageGapValue;
    const overlap = Math.min(bottom, viewBottom) - Math.max(top, viewTop);
    if (overlap > best) {
      best = overlap;
      current = index;
    }
  }
  if (current === page) return;
  page = current;
  updateChrome();
}

function clearSearch() {
  searchSerial += 1;
  searchHits = [];
  searchIndex = -1;
  searchQuery = "";
  searchInput.value = "";
  updateSearchCount();
  refreshSearchMarks();
}

function updateSearchCount() {
  const total = searchHits.length;
  const hasDoc = doc !== null;
  searchPrev.disabled = !hasDoc || total < 1;
  searchNext.disabled = !hasDoc || total < 1;
}

function runSearch(query) {
  const serial = ++searchSerial;
  const trimmed = query.trim();
  searchQuery = trimmed;
  if (!doc || !trimmed) {
    searchHits = [];
    searchIndex = -1;
    updateSearchCount();
    refreshSearchMarks();
    return;
  }
  let hits = [];
  try {
    const parsed = JSON.parse(doc.searchAllText(trimmed, false, true));
    if (Array.isArray(parsed)) hits = parsed;
  } catch {
    hits = [];
  }
  if (serial !== searchSerial) return;
  searchHits = hits;
  searchIndex = hits.length ? 0 : -1;
  updateSearchCount();
  if (searchIndex >= 0) revealHit(searchIndex);
  else refreshSearchMarks();
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(searchInput.value), 220);
}

function stepSearch(direction) {
  if (!searchHits.length) {
    runSearch(searchInput.value);
    return;
  }
  const total = searchHits.length;
  searchIndex = (searchIndex + direction + total) % total;
  updateSearchCount();
  revealHit(searchIndex);
}

function revealHit(index) {
  const hit = searchHits[index];
  if (!doc || !hit) return;
  let target = page;
  try {
    const info = JSON.parse(doc.getPageOfPosition(hit.sec || 0, hit.para || 0));
    if (info?.ok && Number.isInteger(info.page)) target = info.page;
  } catch {
    target = page;
  }
  showPage(target);
  refreshSearchMarks();
  requestAnimationFrame(() => scrollHitIntoView(target));
}

function scrollHitIntoView(pageIndex) {
  const hit = sections[pageIndex]?.querySelector(".search-hit");
  if (!hit) return;
  const hitBox = hit.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  if (hitBox.top >= box.top + 16 && hitBox.bottom <= box.bottom - 16) return;
  scroller.scrollTop += hitBox.top - box.top - scroller.clientHeight * 0.32;
}

function hitInRun(run, hit) {
  if (!run || run.secIdx !== (hit.sec || 0)) return false;
  const cell = hit.cellContext;
  if (cell) {
    if (run.parentParaIdx !== cell.parentPara || run.controlIdx !== cell.ctrlIdx) return false;
    if (run.cellIdx !== cell.cellIdx || run.cellParaIdx !== cell.cellPara) return false;
  } else if (run.paraIdx !== hit.para || (Number.isInteger(run.cellIdx) && run.cellIdx >= 0 && run.cellIdx < 65534)) {
    return false;
  }
  const start = run.charStart || 0;
  const length = [...(run.text || "")].length;
  const matchEnd = (hit.charOffset || 0) + (hit.length || 0);
  return start < matchEnd && start + length > (hit.charOffset || 0);
}

function markSearchHits(svg, pageIndex) {
  const hit = searchHits[searchIndex];
  if (!doc || !hit || !searchQuery) return;
  let layout;
  try {
    layout = JSON.parse(doc.getPageTextLayout(pageIndex));
  } catch {
    return;
  }
  for (const run of layout.runs || []) {
    if (!hitInRun(run, hit)) continue;
    const chars = [...(run.text || "")];
    const localStart = Math.max(0, (hit.charOffset || 0) - (run.charStart || 0));
    const localEnd = Math.min(chars.length, (hit.charOffset || 0) + (hit.length || 0) - (run.charStart || 0));
    if (localEnd <= localStart) continue;
    const edges = run.charX || [];
    const x0 = run.x + (edges[localStart] ?? 0);
    const x1 = run.x + (edges[localEnd] ?? run.w ?? 0);
    const mark = document.createElementNS(SVG_NS, "rect");
    mark.setAttribute("class", "search-hit");
    mark.setAttribute("x", x0.toFixed(2));
    mark.setAttribute("y", Number(run.y).toFixed(2));
    mark.setAttribute("width", Math.max(1, x1 - x0).toFixed(2));
    mark.setAttribute("height", Math.max(1, run.h || run.fontSize || 12).toFixed(2));
    mark.setAttribute("fill", "#f6c445");
    mark.setAttribute("fill-opacity", "0.55");
    svg.append(mark);
  }
}

function refreshSearchMarks() {
  for (const section of sections) {
    const svg = section.querySelector("svg");
    if (!svg) continue;
    svg.querySelectorAll(".search-hit").forEach((node) => node.remove());
    markSearchHits(svg, Number(section.dataset.index));
  }
}

function updateChrome() {
  const hasDoc = doc !== null;
  prevButton.disabled = !hasDoc || page <= 0;
  nextButton.disabled = !hasDoc || page >= pageTotal - 1;
  gotoButton.disabled = !hasDoc;
  zoomOutButton.disabled = !hasDoc || roundedZoomPercent() <= ZOOM_MIN * 100;
  zoomFitButton.disabled = !hasDoc;
  zoomInButton.disabled = !hasDoc || roundedZoomPercent() >= ZOOM_MAX * 100;
  updateZoomLabel();
  gotoButton.textContent = hasDoc ? `${page + 1}/${pageTotal}` : "쪽";
  searchInput.disabled = !hasDoc;
  searchPrev.disabled = !hasDoc || searchHits.length < 1;
  searchNext.disabled = !hasDoc || searchHits.length < 1;
  emptyEl.hidden = hasDoc;
  sheet.hidden = !hasDoc;
}

function clampZoom(value) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function roundedZoomPercent(value = zoom) {
  return Math.round(value * 100);
}

function pageFitZoom() {
  const viewWidth = Math.max(scroller.clientWidth, 1);
  const available = Math.max(scroller.clientHeight - 6, 1);
  const aspect = pageHeight / Math.max(pageWidth, 1);
  const fitted = (available / aspect + 4) / viewWidth;
  return clampZoom(Math.min(1, fitted));
}

function updateZoomLabel() {
  if (!doc) {
    zoomFitButton.textContent = "맞춤";
    zoomFitButton.setAttribute("aria-label", "맞춤");
    return;
  }
  const percent = roundedZoomPercent();
  if (zoomMode === "width") {
    zoomFitButton.textContent = `폭 ${percent}%`;
    zoomFitButton.setAttribute("aria-label", "폭맞춤");
  } else if (zoomMode === "page") {
    zoomFitButton.textContent = `쪽 ${percent}%`;
    zoomFitButton.setAttribute("aria-label", "쪽맞춤");
  } else {
    zoomFitButton.textContent = `${percent}%`;
    zoomFitButton.setAttribute("aria-label", "폭맞춤으로 돌아가기");
  }
}

function applyZoom() {
  sheet.style.width = `${zoom * 100}%`;
  updateZoomLabel();
}

function setZoom(next, mode) {
  zoom = clampZoom(next);
  zoomMode = mode;
  applyZoom();
  updateChrome();
  refreshLayout();
}

function renderDocument() {
  viewGeneration = openGeneration;
  clearPages();
  const first = doc.renderPageSvg(0);
  const size = readPageSize(first);
  pageWidth = size.width;
  pageHeight = size.height;
  heightRatio = new Array(pageTotal);
  sheet.hidden = false;
  for (let index = 0; index < pageTotal; index += 1) {
    const section = document.createElement("section");
    section.className = "page";
    section.dataset.index = String(index);
    section.dataset.ready = "0";
    sections.push(section);
    sheet.append(section);
  }
  layoutSlots();
  mountInto(sections[0], first);
  page = 0;
  updateChrome();
  setStatus("");
  scroller.scrollTop = 0;
  lastScrollTop = 0;
  lastScrollTime = performance.now();
  requestAnimationFrame(() => {
    layoutSlots();
    paintWindow();
  });
}

function showPage(index) {
  if (!doc || prefix.length !== pageTotal + 1) return;
  const next = Math.max(0, Math.min(pageTotal - 1, index));
  page = next;
  updateChrome();
  scroller.scrollTo({ top: Math.max(0, scrollOrigin + prefix[next]), behavior: "auto" });
  lastScrollTop = scroller.scrollTop;
  lastScrollTime = performance.now();
  paintWindow();
}

function refreshLayout() {
  if (!sections.length) return;
  layoutSlots();
  const key = paintKey();
  for (const section of sections) {
    if (section.dataset.paint === key) continue;
    if (!section.firstChild) continue;
    section.replaceChildren();
    section.dataset.paint = "";
    section.dataset.ready = "0";
  }
  paintWindow();
}

async function openBytes(bytes, name, generation = beginOpen(name)) {
  captionTables = [];
  await engineReady;
  if (generation !== openGeneration) return;
  setLoadingProgress(48);
  await nextFrame();
  if (generation !== openGeneration) return;
  let opened = null;
  try {
    try {
      opened = new HwpDocument(bytes);
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("비밀번호") || /password/i.test(message)) {
        const password = window.prompt("이 문서의 비밀번호를 입력하세요.");
        if (generation !== openGeneration) return;
        if (!password) throw new Error("비밀번호가 입력되지 않았습니다.");
        opened = HwpDocument.openWithPassword(bytes, password);
      } else {
        throw error;
      }
    }
    const total = opened.pageCount();
    if (generation !== openGeneration) {
      opened.free();
      return;
    }
    if (total < 1) throw new Error("표시할 쪽이 없습니다.");
    if (doc) doc.free();
    doc = opened;
    opened = null;
    pageTotal = total;
    page = 0;
    zoom = 1;
    zoomMode = "width";
    applyZoom();
    setLoadingProgress(76);
    await nextFrame();
    if (generation !== openGeneration) return;
    try {
      const found = await collectCaptionTables(doc);
      if (generation !== openGeneration) return;
      captionTables = found;
    } catch {
      captionTables = [];
    }
    if (generation !== openGeneration) return;
    setLoadingProgress(94);
    await nextFrame();
    if (generation !== openGeneration) return;
    renderDocument();
    openedName = name || "";
    showDocumentTitle(openedName);
    clearSearch();
    setLoadingProgress(100);
    await nextFrame();
    hideLoading(generation);
  } catch (error) {
    if (opened) opened.free();
    if (generation === openGeneration) showError(`열 수 없습니다. ${errorMessage(error)}`);
  }
}

async function loadDocument(name, token) {
  if (ignoreDelivered) {
    ignoreDelivered = false;
    return;
  }
  if (token && activeToken && token !== activeToken) return;
  const generation = loadingLayer.hidden ? beginOpen(name, token) : openGeneration;
  activeToken = token || activeToken;
  try {
    setLoadingProgress(22);
    const response = await fetch(new URL(`/doc/${encodeURIComponent(token)}`, location.href), {
      cache: "no-store"
    });
    if (generation !== openGeneration) return;
    if (!response.ok) throw new Error("파일을 읽지 못했습니다.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (generation !== openGeneration) return;
    setLoadingProgress(40);
    await openBytes(bytes, name, generation);
  } catch (error) {
    if (generation === openGeneration) showError(`열 수 없습니다. ${errorMessage(error)}`);
  }
}

function gotoIsOpen() {
  return !gotoLayer.hidden;
}

function openGoto() {
  if (!doc) {
    setStatus("먼저 문서를 여세요.");
    return;
  }
  gotoHint.textContent = "";
  gotoInput.max = String(pageTotal);
  gotoInput.value = String(page + 1);
  gotoLayer.hidden = false;
  gotoInput.focus();
  gotoInput.select();
}

function closeGoto() {
  gotoLayer.hidden = true;
  gotoHint.textContent = "";
}

function submitGoto(event) {
  event?.preventDefault();
  const value = Number.parseInt(gotoInput.value.trim(), 10);
  if (!Number.isInteger(value) || value < 1 || value > pageTotal) {
    gotoHint.textContent = `1부터 ${pageTotal} 사이로 입력하세요.`;
    gotoInput.focus();
    gotoInput.select();
    return;
  }
  closeGoto();
  showPage(value - 1);
}

function aboutIsOpen() {
  return !aboutLayer.hidden;
}

async function fillAboutMeta() {
  if (aboutLayer.dataset.metaLoaded === "1") return;
  let info = { name: "Hangul4U", version: "개발 미리보기", packagedAt: "—" };
  try {
    const response = await fetch(new URL("build-info.json", import.meta.url));
    if (response.ok) info = { ...info, ...(await response.json()) };
  } catch {
    // 미리보기 서버처럼 build-info.json 이 없으면 위 기본값을 쓴다.
  }
  if (aboutAppName) aboutAppName.textContent = info.name || "Hangul4U";
  if (aboutVersion) aboutVersion.textContent = info.version || "—";
  if (aboutPackaged) aboutPackaged.textContent = info.packagedAt || "—";
  aboutLayer.dataset.metaLoaded = "1";
}

async function openAbout() {
  aboutLayer.hidden = false;
  await fillAboutMeta();
  if (aboutLicense.dataset.loaded === "1") return;
  try {
    const response = await fetch(new URL("LICENSE-rhwp.txt", import.meta.url));
    if (!response.ok) throw new Error("license");
    aboutLicense.textContent = await response.text();
    aboutLicense.dataset.loaded = "1";
  } catch {
    aboutLicense.textContent = "Copyright (c) 2025-2026 Edward Kim\nMIT License";
  }
}

function closeAbout() {
  aboutLayer.hidden = true;
}

function consumeBack() {
  if (!loadingLayer.hidden) {
    cancelOpen();
    return true;
  }
  if (aboutIsOpen()) {
    closeAbout();
    return true;
  }
  if (!gotoIsOpen()) return false;
  closeGoto();
  return true;
}

function pickFile() {
  if (window.Hangul4U?.pickFile) {
    window.Hangul4U.pickFile();
    return;
  }
  fileInput.click();
}

function onKeyDown(event) {
  const typing = event.target === gotoInput || event.target === searchInput;
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.code === "KeyF") {
    event.preventDefault();
    if (!searchInput.disabled) {
      searchInput.focus();
      searchInput.select();
    }
    return;
  }
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.code === "KeyG") {
    event.preventDefault();
    openGoto();
    return;
  }
  if (typing) {
    if (event.key === "Escape") {
      if (event.target === searchInput) {
        searchInput.value = "";
        runSearch("");
        searchInput.blur();
      } else {
        closeGoto();
      }
    }
    return;
  }
  if (event.key === "Escape" && aboutIsOpen()) {
    closeAbout();
    return;
  }
  if (!doc || gotoIsOpen() || aboutIsOpen()) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    showPage(page - 1);
  } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    showPage(page + 1);
  } else if (event.key === "PageDown") {
    event.preventDefault();
    scroller.scrollBy({ top: scroller.clientHeight * 0.92, behavior: "smooth" });
  } else if (event.key === "PageUp") {
    event.preventDefault();
    scroller.scrollBy({ top: -scroller.clientHeight * 0.92, behavior: "smooth" });
  }
}

function pageStep(step) {
  if (!doc || gotoIsOpen() || aboutIsOpen()) return;
  if (document.activeElement === gotoInput || document.activeElement === searchInput) return;
  showPage(page + step);
}

function setNativeTyping(active) {
  if (window.Hangul4U && typeof window.Hangul4U.setTyping === "function") {
    window.Hangul4U.setTyping(active);
  }
}

function onPointerDown(event) {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size !== 2) return;
  const [a, b] = [...pointers.values()];
  pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
}

function onPointerMove(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size !== 2 || !pinch || pinch.distance <= 0) return;
  const [a, b] = [...pointers.values()];
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  zoom = clampZoom(pinch.zoom * (distance / pinch.distance));
  zoomMode = "manual";
  applyZoom();
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => layoutSlots());
}

function onPointerUp(event) {
  const pinching = pinch !== null;
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pinching && pointers.size < 2 && doc) {
    updateChrome();
    refreshLayout();
  }
}

let layoutFrame = 0;
window.addEventListener("resize", () => {
  if (!doc) return;
  if (zoomMode === "page") zoom = pageFitZoom();
  applyZoom();
  updateChrome();
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => refreshLayout());
});

openButton.addEventListener("click", pickFile);
aboutButton.addEventListener("click", openAbout);
aboutClose.addEventListener("click", closeAbout);
aboutLayer.addEventListener("click", (event) => {
  if (event.target === aboutLayer) closeAbout();
});
prevButton.addEventListener("click", () => showPage(page - 1));
nextButton.addEventListener("click", () => showPage(page + 1));
gotoButton.addEventListener("click", openGoto);
zoomOutButton.addEventListener("click", () => {
  setZoom((roundedZoomPercent() - 5) / 100, "manual");
});
zoomInButton.addEventListener("click", () => {
  setZoom((roundedZoomPercent() + 5) / 100, "manual");
});
zoomFitButton.addEventListener("click", () => {
  if (zoomMode === "width") setZoom(pageFitZoom(), "page");
  else setZoom(1, "width");
});
gotoCancel.addEventListener("click", closeGoto);
gotoForm.addEventListener("submit", submitGoto);
gotoLayer.addEventListener("click", (event) => {
  if (event.target === gotoLayer) closeGoto();
});
loadingCancel.addEventListener("click", cancelOpen);
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(searchTimer);
  if (searchInput.disabled) return;
  if (searchQuery === searchInput.value.trim() && searchHits.length) stepSearch(1);
  else runSearch(searchInput.value);
});
searchInput.addEventListener("input", scheduleSearch);
searchInput.addEventListener("focus", () => setNativeTyping(true));
searchInput.addEventListener("blur", () => setNativeTyping(false));
gotoInput.addEventListener("focus", () => setNativeTyping(true));
gotoInput.addEventListener("blur", () => setNativeTyping(false));
searchPrev.addEventListener("click", () => stepSearch(-1));
searchNext.addEventListener("click", () => stepSearch(1));
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  const generation = beginOpen(file.name);
  try {
    setLoadingProgress(24);
    await nextFrame();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (generation !== openGeneration) return;
    setLoadingProgress(40);
    await openBytes(bytes, file.name, generation);
  } catch (error) {
    if (generation === openGeneration) showError(`열 수 없습니다. ${errorMessage(error)}`);
  }
});
window.addEventListener("keydown", onKeyDown);
scroller.addEventListener("scroll", () => {
  updateCurrentPage();
  const now = performance.now();
  const dy = Math.abs(scroller.scrollTop - lastScrollTop);
  const dt = Math.max(now - lastScrollTime, 1);
  const fast = dy / dt > 1.5;
  lastScrollTop = scroller.scrollTop;
  lastScrollTime = now;
  schedulePaint(fast);
}, { passive: true });
scroller.addEventListener("pointerdown", onPointerDown);
scroller.addEventListener("pointermove", onPointerMove);
scroller.addEventListener("pointerup", onPointerUp);
scroller.addEventListener("pointercancel", onPointerUp);

window.hangul4u = {
  beginOpen,
  loadDocument,
  openGoto,
  showError,
  consumeBack,
  pageStep
};

updateChrome();
