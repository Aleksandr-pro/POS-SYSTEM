const fs = require('fs');
const X = require('../src/xlsx.js');
const bytes = X.buildXlsx([
  { name: 'Сводка', rows: [
    ['Показатель', 'Значение'],
    ['Выручка', 1250000.5],
    ['Расходы', 320000],
    ['Прибыль', 930000.5],
    ['Комментарий', 'Тест "кавычки" & <теги>'],
  ]},
  { name: 'Продажи', rows: [
    ['Дата', 'Товар', 'Кол-во', 'Сумма'],
    ['19.10.2026 14:05', 'Кофе Latte 0.4', 2, 2400],
    ['19.10.2026 14:10', 'Круассан', 1, 850],
  ]},
  { name: 'Сводка', rows: [['Дубликат имени']] },
]);
fs.writeFileSync('/tmp/test.xlsx', Buffer.from(bytes));
console.log('written', bytes.length, 'bytes');
