/* 멀티시트 .xlsx 를 브라우저에서 직접 생성 (외부 라이브러리 없음).
   .xlsx = XML 몇 개를 ZIP(무압축)으로 묶은 것. MiniXlsx.downloadMulti([{name,rows}], filename) */
(function (global) {
  "use strict";
  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) { var c = i; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) { var c = 0xFFFFFFFF; for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  var enc = new TextEncoder();

  function makeZip(files) {
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name), data = f.data, crc = crc32(data);
      var local = new Uint8Array(30 + nameBytes.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0x0021, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true); local.set(nameBytes, 30);
      parts.push(local, data);
      var cd = new Uint8Array(46 + nameBytes.length), cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x0021, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46); central.push(cd);
      offset += local.length + data.length;
    });
    var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]; }).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ""); }
  function colName(n) { var s = ""; while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } return s; }
  function sheetXml(rows) {
    var out = [];
    rows.forEach(function (row, r) {
      var cells = [];
      row.forEach(function (val, c) {
        if (val === null || val === undefined || val === "") return;
        var ref = colName(c) + (r + 1);
        if (typeof val === "number" && isFinite(val)) cells.push('<c r="' + ref + '"><v>' + val + "</v></c>");
        else cells.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(val) + "</t></is></c>");
      });
      out.push('<row r="' + (r + 1) + '">' + cells.join("") + "</row>");
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + out.join("") + '</sheetData></worksheet>';
  }
  function uniqNames(sheets) {
    var used = {}, names = [];
    sheets.forEach(function (sh, i) {
      var n = String(sh.name || ("Sheet" + (i + 1))).replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 28) || ("Sheet" + (i + 1));
      var base = n, k = 2; while (used[n]) { n = (base.slice(0, 26) + " " + k).slice(0, 31); k++; }
      used[n] = 1; names.push(n);
    });
    return names;
  }
  function downloadMulti(sheets, filename) {
    if (!sheets.length) return;
    var names = uniqNames(sheets);
    var files = [];
    files.push({ name: "[Content_Types].xml", data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map(function (_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join("")
      + '</Types>') });
    files.push({ name: "_rels/.rels", data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') });
    files.push({ name: "xl/workbook.xml", data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + names.map(function (nm, i) { return '<sheet name="' + esc(nm) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join("")
      + '</sheets></workbook>') });
    files.push({ name: "xl/_rels/workbook.xml.rels", data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map(function (_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join("")
      + '</Relationships>') });
    sheets.forEach(function (sh, i) { files.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: enc.encode(sheetXml(sh.rows)) }); });
    var blob = makeZip(files), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = (filename.slice(-5) === ".xlsx" ? filename : filename + ".xlsx");
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  global.MiniXlsx = { downloadMulti: downloadMulti };
})(window);
