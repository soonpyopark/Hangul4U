import fs from "fs";
import zlib from "zlib";

const zip = fs.readFileSync(process.argv[2]);
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
console.log(Object.keys(files).join("\n"));
const section = files["Contents/section0.xml"];
const sec = section.match(/<hp:secPr\b[\s\S]*?<\/hp:secPr>/)?.[0] ?? "";
console.log("\nSEC\n", sec.slice(0, 2500));
