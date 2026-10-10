import init, { HwpDocument } from "../app/src/main/assets/viewer/rhwp.js";
import fs from "fs";
import zlib from "zlib";

await init({ module_or_path: fs.readFileSync("./app/src/main/assets/viewer/rhwp_bg.wasm") });
const doc = new HwpDocument(fs.readFileSync("./samples/missing-body.hwp"));
fs.writeFileSync("./samples/missing-body.hwpx", doc.exportHwpx());
doc.free?.();

const zip = fs.readFileSync("./samples/missing-body.hwpx");
let offset = 0;
const files = {};
while (offset + 30 < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
  const method = zip.readUInt16LE(offset + 8);
  const size = zip.readUInt32LE(offset + 18);
  const nameLen = zip.readUInt16LE(offset + 26);
  const extraLen = zip.readUInt16LE(offset + 28);
  const name = zip.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
  const start = offset + 30 + nameLen + extraLen;
  const data = zip.subarray(start, start + size);
  offset = start + size;
  if (!name.endsWith(".xml")) continue;
  files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
}
const header = Object.entries(files).find(([name]) => name.endsWith("header.xml"))[1];
const section = Object.entries(files).find(([name]) => name.endsWith("section0.xml"))[1];
const at = section.indexOf('id="1210686614"');
const table = section.slice(section.lastIndexOf("<hp:tbl", at), section.indexOf("</hp:tbl>", at) + 9);
const cells = [...table.matchAll(/<hp:tc\b[\s\S]*?<\/hp:tc>/g)];
console.log("cells", cells.length);
for (const cell of cells) {
  const src = cell[0];
  const row = src.match(/rowAddr="(\d+)"/)?.[1];
  const col = src.match(/colAddr="(\d+)"/)?.[1];
  const fill = src.match(/borderFillIDRef="(\d+)"/)?.[1];
  const texts = [...src.matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((match) => match[1]);
  const segs = [...src.matchAll(/vertpos="(\d+)"[^>]*baseline="(\d+)"[^>]*horzpos="(\d+)"[^>]*horzsize="(\d+)"/g)]
    .map((match) => match.slice(1).join("/"));
  if (texts.join("").trim()) console.log("r", row, "c", col, "fill", fill, JSON.stringify(texts), segs.join(" | "));
}
const cap = table.slice(table.indexOf("<hp:caption"), table.indexOf("</hp:caption>"));
console.log("--- caption paras ---");
for (const para of cap.matchAll(/<hp:p\b[\s\S]*?<\/hp:p>/g)) {
  const texts = [...para[0].matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((match) => JSON.stringify(match[1]));
  const seg = para[0].match(/vertpos="\d+"[^>]*vertsize="\d+"[^>]*baseline="\d+"[^>]*horzpos="\d+"/);
  const pr = para[0].match(/paraPrIDRef="\d+"|charPrIDRef="\d+"/g);
  console.log(pr?.join(" "), texts.join(" "), seg?.[0]);
}
for (const id of ["144", "142", "143", "145"]) {
  const para = header.match(new RegExp(`<hh:paraPr id="${id}"[\\s\\S]*?<hh:align[^/]*/>`));
  console.log("align", id, para?.[0]?.match(/horizontal="[^"]+"/)?.[0]);
}
const faces = [...header.matchAll(/<hh:font id="(\d+)" face="([^"]+)"/g)].slice(0, 5);
console.log("font sample", faces.map((match) => match[1] + ":" + match[2]).join(", "));
const fontBlock = header.match(/<hh:fontfaces[\s\S]*?<\/hh:fontfaces>/);
const hangul = fontBlock?.[0]?.match(/lang="HANGUL"[\s\S]*?<\/hh:fontface>/)?.[0] || "";
console.log("hangul", [...hangul.matchAll(/id="(\d+)" face="([^"]+)"/g)].map((m) => m[1] + m[2]).join(" | "));
for (const id of ["185", "186", "187", "188", "190"]) {
  const found = header.match(new RegExp(`<hh:charPr id="${id}"[\\s\\S]*?</hh:charPr>`));
  const brief = found?.[0]?.replace(/\s+/g, " ").slice(0, 280);
  console.log("char", id, brief);
}
for (const id of ["35", "36", "37", "38"]) {
  const found = header.match(new RegExp(`<hh:borderFill id="${id}"[\\s\\S]*?</hh:borderFill>`));
  console.log("fill", id, found?.[0]?.replace(/\s+/g, " ").slice(0, 420));
}
