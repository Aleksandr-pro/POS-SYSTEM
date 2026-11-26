/* ============================================================
   Минимальный генератор XLSX без внешних библиотек
   (ZIP без сжатия + SpreadsheetML). Работает офлайн.
   ============================================================ */
(function (global) {
  'use strict';

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
      else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function dosDateTime(d) {
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    return { date: date & 0xFFFF, time: time & 0xFFFF };
  }

  function zipStore(files) {
    var now = dosDateTime(new Date());
    var localParts = [];
    var centralParts = [];
    var offset = 0;

    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = f.data;
      var crc = crc32(data);
      var local = new Uint8Array(30 + name.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // UTF-8 names
      dv.setUint16(8, 0, true);      // store
      dv.setUint16(10, now.time, true);
      dv.setUint16(12, now.date, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      local.set(name, 30);

      var central = new Uint8Array(46 + name.length);
      var cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, now.time, true);
      cv.setUint16(14, now.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);

      localParts.push(local, data);
      centralParts.push(central);
      offset += local.length + data.length;
    });

    var centralSize = centralParts.reduce(function (s, p) { return s + p.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    var all = localParts.concat(centralParts, [eocd]);
    var total = all.reduce(function (s, p) { return s + p.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  function xmlEscape(value) {
    return String(value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function colLetter(index) {
    var s = '';
    index = index + 1;
    while (index > 0) {
      var m = (index - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      index = Math.floor((index - 1) / 26);
    }
    return s;
  }

  function safeSheetName(name, used) {
    var base = String(name || 'Лист').replace(/[\[\]\*\/\\\?\:]/g, ' ').trim().slice(0, 31) || 'Лист';
    var candidate = base;
    var i = 2;
    while (used[candidate.toLowerCase()]) {
      var suffix = ' (' + i + ')';
      candidate = base.slice(0, 31 - suffix.length) + suffix;
      i++;
    }
    used[candidate.toLowerCase()] = true;
    return candidate;
  }

  function buildSheetXml(rows) {
    var displayRows = (rows && rows.length) ? rows : [['Нет данных']];
    var widths = [];
    displayRows.forEach(function (row, ri) {
      (row || []).forEach(function (cell, ci) {
        var len = cell === null || cell === undefined ? 0 : String(cell).length;
        if (ri === 0) len = Math.max(len, 4);
        widths[ci] = Math.max(widths[ci] || 10, Math.min(48, Math.max(10, len + 2)));
      });
    });

    var cols = '<cols>' + widths.map(function (w, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join('') + '</cols>';

    var body = displayRows.map(function (row, ri) {
      var cells = (row || []).map(function (cell, ci) {
        var ref = colLetter(ci) + (ri + 1);
        if (cell === null || cell === undefined || cell === '') {
          return '<c r="' + ref + '" s="' + (ri === 0 ? 1 : 0) + '"/>';
        }
        var isNumber = typeof cell === 'number' && isFinite(cell);
        var style = ri === 0 ? 1 : 0;
        if (isNumber) return '<c r="' + ref + '" s="' + style + '"><v>' + cell + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr" s="' + style + '"><is><t xml:space="preserve">' +
          xmlEscape(cell) + '</t></is></c>';
      }).join('');
      return '<row r="' + (ri + 1) + '"' + (ri === 0 ? ' ht="24" customHeight="1"' : '') + '>' + cells + '</row>';
    }).join('');

    var lastCol = colLetter(Math.max(0, widths.length - 1));
    var lastRow = displayRows.length;
    var dimension = 'A1:' + lastCol + Math.max(1, lastRow);

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<dimension ref="' + dimension + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      cols +
      '<sheetData>' + body + '</sheetData>' +
      (lastRow > 1 ? '<autoFilter ref="A1:' + lastCol + lastRow + '"/>' : '') +
      '<pageMargins left="0.5" right="0.5" top="0.7" bottom="0.7" header="0.3" footer="0.3"/>' +
      '</worksheet>';
  }

  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
    '<font><sz val="11"/><color rgb="FF1D2939"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF312E81"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFC7D2FE"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function buildXlsx(sheets) {
    var list = (sheets && sheets.length ? sheets : [{ name: 'Лист', rows: [] }]);
    var used = {};
    var names = list.map(function (s) { return safeSheetName(s.name, used); });

    var files = [];
    var overrides = '';
    var sheetTags = '';
    var sheetRels = '';

    list.forEach(function (sheet, i) {
      var name = 'xl/worksheets/sheet' + (i + 1) + '.xml';
      files.push({ name: name, data: utf8(buildSheetXml(sheet.rows)) });
      overrides += '<Override PartName="/' + name + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      sheetTags += '<sheet name="' + xmlEscape(names[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      sheetRels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    });

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      overrides +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="13000"/></bookViews>' +
      '<sheets>' + sheetTags + '</sheets>' +
      '</workbook>';

    var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheetRels +
      '<Relationship Id="rId' + (list.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    files.unshift({ name: '[Content_Types].xml', data: utf8(contentTypes) });
    files.push({ name: '_rels/.rels', data: utf8(rootRels) });
    files.push({ name: 'xl/workbook.xml', data: utf8(workbook) });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels) });
    files.push({ name: 'xl/styles.xml', data: utf8(STYLES_XML) });

    return zipStore(files);
  }

  function triggerDownload(bytes, fileName, mime) {
    var blob = new Blob([bytes], { type: mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1200);
  }

  function bytesToBase64(bytes) {
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /* Сохранение файла: в браузере — скачивание, в APK (Capacitor) — в «Документы» + меню «Поделиться» */
  async function saveFile(fileName, bytes, mime) {
    // 1) APK: нативный мост сохраняет файл в Downloads и открывает «Поделиться»
    try {
      if (window.AndroidPos && typeof window.AndroidPos.exportFile === 'function') {
        var base64Native = bytesToBase64(bytes);
        var saved = window.AndroidPos.exportFile(fileName, base64Native, mime || 'application/octet-stream');
        if (saved) return { native: true, via: 'android-bridge' };
      }
    } catch (err) {
      console.warn('Нативный экспорт недоступен', err);
    }

    // 2) Capacitor-плагины (если приложение собрано через Capacitor)
    try {
      var cap = window.Capacitor;
      var plugins = cap && cap.Plugins;
      if (plugins && plugins.Filesystem && plugins.Filesystem.writeFile) {
        var base64 = bytesToBase64(bytes);
        var uri = null;
        try {
          var res = await plugins.Filesystem.writeFile({ path: fileName, data: base64, directory: 'DOCUMENTS', recursive: true });
          uri = res && res.uri;
        } catch (e1) { /* нет доступа к документам — пробуем кэш */ }
        if (!uri) {
          try {
            var res2 = await plugins.Filesystem.writeFile({ path: fileName, data: base64, directory: 'CACHE', recursive: true });
            uri = res2 && res2.uri;
          } catch (e2) { /* ignore */ }
        }
        if (uri) {
          if (plugins.Share && plugins.Share.share) {
            try { await plugins.Share.share({ title: fileName, url: uri }); } catch (e3) { /* пользователь закрыл меню */ }
          }
          return { native: true, uri: uri };
        }
      }
    } catch (err) {
      console.warn('Нативное сохранение недоступно, используем скачивание', err);
    }
    try { triggerDownload(bytes, fileName, mime); } catch (e) { console.error('Не удалось сохранить файл', e); }
    return { native: false };
  }

  function downloadXlsx(fileName, sheets) {
    var name = /\.xlsx$/i.test(fileName) ? fileName : fileName + '.xlsx';
    return saveFile(name, buildXlsx(sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  function downloadJson(fileName, obj) {
    var name = /\.json$/i.test(fileName) ? fileName : fileName + '.json';
    return saveFile(name, utf8(JSON.stringify(obj, null, 2)), 'application/json');
  }

  global.PosXlsx = {
    buildXlsx: buildXlsx,
    downloadXlsx: downloadXlsx,
    downloadJson: downloadJson,
    saveFile: saveFile,
    bytesToBase64: bytesToBase64,
    triggerDownload: triggerDownload,
    utf8: utf8,
    crc32: crc32,
    _zipStore: zipStore
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.PosXlsx;
