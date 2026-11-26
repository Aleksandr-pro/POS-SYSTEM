/* Сдвиг часов страницы: тесты кассы продавца не должны зависеть от ночного окна 02:00–06:00 */
function daytimeShift() {
  const now = new Date();
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  return noon.getTime() - now.getTime();
}

async function installDayClock(page, offsetMs) {
  await page.evaluateOnNewDocument(function (offset) {
    var NativeDate = Date;
    function PatchedDate() {
      if (!(this instanceof PatchedDate)) return new NativeDate(NativeDate.now() + offset).toString();
      if (arguments.length === 0) return new NativeDate(NativeDate.now() + offset);
      if (arguments.length === 1) return new NativeDate(arguments[0]);
      return new NativeDate(arguments[0], arguments[1], arguments[2] === undefined ? 1 : arguments[2],
        arguments[3] || 0, arguments[4] || 0, arguments[5] || 0, arguments[6] || 0);
    }
    PatchedDate.prototype = NativeDate.prototype;
    PatchedDate.now = function () { return NativeDate.now() + offset; };
    PatchedDate.parse = NativeDate.parse;
    PatchedDate.UTC = NativeDate.UTC;
    window.Date = PatchedDate;
  }, offsetMs === undefined ? daytimeShift() : offsetMs);
}

module.exports = { installDayClock, daytimeShift };
