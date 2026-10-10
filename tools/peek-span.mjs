import fs from "fs";
import zlib from "zlib";
const zip = fs.readFileSync("./samples/missing-body.hwpx");
let offset = 0;
let section = "";
while (offset + 30 < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
  const method = zip.readUInt16LE(offset + 8);
  const size = zip.readUInt32LE(offset + 18);
  const nameLen = zip.readUInt16LE(offset + 26);
  const extraLen = zip.readUInt16LE(offset + 28);
  const name = zip.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
  const start = offset + 30 + nameLen + extraLen;
  const data = zip.subarray(start, start + size);
  offset = start + size;
  if (name.endsWith("section0.xml")) section = zlib.inflateRawSync(data).toString("utf8");
}
const at = section.indexOf(">2024년<");
const cellEnd = section.indexOf("</hp:tc>", at);
console.log(section.slice(cellEnd - 280, cellEnd + 9).replace(/></g, ">\n<"));
