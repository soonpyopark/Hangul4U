import fs from "fs";
import zlib from "zlib";

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
  if (name.endsWith(".xml")) files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
}
const header = Object.entries(files).find(([name]) => name.endsWith("header.xml"))[1];
const section = Object.entries(files).find(([name]) => name.endsWith("section0.xml"))[1];
const at = section.indexOf('id="1210686614"');
const table = section.slice(section.lastIndexOf("<hp:tbl", at), section.indexOf("</hp:tbl>", at) + 9);
const ids = new Set([...table.matchAll(/borderFillIDRef="(\d+)"/g)].map((match) => match[1]));
for (const id of ids) {
  const found = header.match(new RegExp(`<hh:borderFill id="${id}"[\\s\\S]*?</hh:borderFill>`))?.[0] || "";
  const sides = [...found.matchAll(/<hh:(left|right|top|bottom)Border type="([^"]+)" width="([^"]+)"/g)]
    .map((match) => `${match[1][0]}:${match[2]} ${match[3]}`);
  const brush = found.match(/faceColor="([^"]+)"|type="NONE"/);
  console.log(id, sides.join(" "), "fill", found.includes("winBrush") ? found.match(/faceColor="[^"]+"|hatchColor="[^"]+"|type="[^"]+"/)?.[0] : "none");
}
console.log("--- sizes ---");
for (const cell of table.matchAll(/<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"[\s\S]*?<hp:cellSz width="(\d+)" height="(\d+)"/g)) {
  console.log("r", cell[2], "c", cell[1], "h", cell[4], "w", cell[3]);
}
const sub = table.match(/<hp:subList[^>]*vertAlign="([^"]+)"/);
console.log("first vert", sub?.[1]);
