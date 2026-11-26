/* ============================================================
   POS Контроль — товары и категории
   ============================================================ */
(function () {
  'use strict';
  var PAGES = window.PAGES = window.PAGES || {};
  var state = { search: '', category: 'all' };

  function pointsBadges(product) {
    if (!product.pointIds || !product.pointIds.length) {
      return '<span class="tag-point none">' + icon('alert', 12) + ' Не назначен</span>';
    }
    var tags = product.pointIds.slice(0, 2).map(function (id) {
      return '<span class="tag-point">' + esc(pointName(id, 'Удалена')) + '</span>';
    }).join('');
    if (product.pointIds.length > 2) tags += '<span class="tag-point">+' + (product.pointIds.length - 2) + '</span>';
    return tags;
  }

  function stockSummary(product) {
    var rows = DB.stock.filter(function (r) { return r.productId === product.id; });
    if (!rows.length) return '<span class="badge neutral">без учёта</span>';
    var total = rows.reduce(function (s, r) { return s + r.qty; }, 0);
    var cls = total === 0 ? 'badge-danger' : (total <= 5 ? 'badge-warn' : 'badge-success');
    return '<span class="badge ' + cls + '">' + total + ' шт на складе</span>';
  }

  function openProductModal(ctx, product) {
    var editing = !!product;
    var photoData = product ? product.photo : null;
    var selectedPoints = product && product.pointIds ? product.pointIds.slice() : [];

    var modal = openModal({
      title: editing ? 'Редактировать товар' : 'Новый товар',
      subtitle: editing ? 'Изменения сразу появятся в кассе' : 'Товар появится только на выбранных точках',
      size: 'lg',
      body:
        '<div class="form-grid">' +
          '<div class="field full"><label for="prName">Название товара *</label>' +
            '<input class="input" id="prName" maxlength="80" placeholder="Например, Кофе латте" value="' + esc(product ? product.name : '') + '" autofocus></div>' +
          '<div class="field"><label for="prCat">Категория *</label>' +
            '<div class="flex gap-6">' +
              '<select class="select grow" id="prCat">' +
                DB.categories.map(function (c) {
                  return '<option value="' + c.id + '"' + (product && product.categoryId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
                }).join('') +
              '</select>' +
              '<button type="button" class="btn btn-secondary btn-icon" id="prNewCat" title="Новая категория">' + icon('plus', 17) + '</button>' +
            '</div></div>' +
          '<div class="field"><label for="prPrice">Цена, ' + APP_CONFIG.currency + ' *</label>' +
            '<input class="input" id="prPrice" inputmode="numeric" placeholder="0" value="' + (product ? product.price : '') + '"></div>' +
          '<div class="field full"><label>Фото товара</label>' +
            '<input type="file" id="prPhoto" accept="image/*" hidden>' +
            '<input type="file" id="prPhotoCamera" accept="image/*" capture="environment" hidden>' +
            '<div class="photo-picker" id="prPhotoPicker">' +
              (photoData
                ? '<img src="' + photoData + '" alt="Фото товара"><button type="button" class="remove" id="prPhotoRemove" title="Удалить фото">' + icon('x', 15) + '</button>'
                : icon('camera', 24) + '<span>Нажмите, чтобы загрузить фото</span><span class="tiny">JPEG/PNG, сжимается автоматически</span>') +
            '</div>' +
            '<div class="flex gap-6" style="margin-top:8px">' +
              '<button type="button" class="btn btn-sm btn-secondary grow" id="prPhotoCameraBtn">' + icon('camera', 15) + ' Снять на камеру</button>' +
              '<button type="button" class="btn btn-sm btn-secondary grow" id="prPhotoGalleryBtn">' + icon('image', 15) + ' Из галереи</button>' +
            '</div></div>' +
          '<div class="field full"><label>Точки продаж</label>' +
            '<div class="point-checks" id="prPoints">' +
              (DB.points.length
                ? DB.points.map(function (p) {
                    var checked = selectedPoints.indexOf(p.id) !== -1;
                    return '<label class="point-check' + (checked ? ' checked' : '') + '"><input type="checkbox" value="' + p.id + '"' + (checked ? ' checked' : '') + '><span class="nm">' + esc(p.name) + '</span></label>';
                  }).join('')
                : '<div class="muted small" style="grid-column:1/-1">Точек продаж пока нет — создайте точку, чтобы назначить товар.</div>') +
            '</div>' +
            '<div class="hint">Товар появится в кассе и на складе только выбранных точек. Если ничего не выбрано — товар сохранится в каталоге без точки, и назначить её можно позже.</div>' +
          '</div>' +
        '</div>',
      footer:
        (editing ? '<button type="button" class="btn btn-danger-soft" id="prDelete">' + icon('trash', 16) + ' Удалить</button>' : '') +
        '<button type="button" class="btn btn-secondary" id="prCancel">Отмена</button>' +
        '<button type="button" class="btn btn-primary" id="prSave">' + (editing ? 'Сохранить' : 'Добавить товар') + '</button>',
      onMount: function (el, close) {
        var picker = el.querySelector('#prPhotoPicker');
        var fileInput = el.querySelector('#prPhoto');
        var cameraInput = el.querySelector('#prPhotoCamera');
        var catSelect = el.querySelector('#prCat');

        function renderPicker() {
          if (photoData) {
            picker.innerHTML = '<img src="' + photoData + '" alt="Фото"><button type="button" class="remove" id="prPhotoRemove">' + icon('x', 15) + '</button>';
            picker.querySelector('#prPhotoRemove').addEventListener('click', function (e) {
              e.stopPropagation();
              photoData = null;
              renderPicker();
            });
          } else {
            picker.innerHTML = icon('camera', 24) + '<span>Нажмите, чтобы загрузить фото</span><span class="tiny">JPEG/PNG, сжимается автоматически</span>';
          }
        }
        picker.addEventListener('click', function () { fileInput.click(); });
        var galleryBtn = el.querySelector('#prPhotoGalleryBtn');
        if (galleryBtn) galleryBtn.addEventListener('click', function () { fileInput.click(); });
        var cameraBtn = el.querySelector('#prPhotoCameraBtn');
        if (cameraBtn) cameraBtn.addEventListener('click', function () { cameraInput.click(); });
        function handlePhotoInput(input) {
          input.addEventListener('change', async function () {
            var file = input.files && input.files[0];
            if (!file) return;
            try {
              photoData = await compressImage(file, 720, 0.72);
              renderPicker();
              toast('Фото загружено', 'success');
            } catch (err) { toast(err.message, 'error'); }
            input.value = '';
          });
        }
        handlePhotoInput(fileInput);
        handlePhotoInput(cameraInput);
        renderPicker();

        el.querySelector('#prNewCat').addEventListener('click', async function () {
          var name = await promptDialog({ title: 'Новая категория', label: 'Название категории', placeholder: 'Например, Десерты', confirmText: 'Добавить' });
          if (!name || !name.trim()) return;
          var clean = name.trim();
          if (DB.categories.some(function (c) { return c.name.toLowerCase() === clean.toLowerCase(); })) {
            toast('Такая категория уже существует', 'warn');
            return;
          }
          var cat = { id: uid(), name: clean, createdAt: Date.now(), updatedAt: Date.now() };
          DB.categories.push(cat);
          saveDB();
          catSelect.innerHTML = DB.categories.map(function (c) {
            return '<option value="' + c.id + '"' + (c.id === cat.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
          }).join('');
          toast('Категория «' + clean + '» добавлена');
        });

        el.querySelector('#prPoints').querySelectorAll('input').forEach(function (input) {
          input.addEventListener('change', function () {
            input.closest('.point-check').classList.toggle('checked', input.checked);
          });
        });

        el.querySelector('#prCancel').addEventListener('click', close);

        if (editing) {
          el.querySelector('#prDelete').addEventListener('click', async function () {
            var ok = await confirmDialog({
              title: 'Удалить товар?',
              message: '«' + esc(product.name) + '» будет удалён из каталога и со склада. Уже оформленные продажи сохранятся в истории.',
              confirmText: 'Удалить',
              danger: true
            });
            if (!ok) return;
            deleteProduct(product.id);
            close();
            toast('Товар удалён');
            ctx.rerender();
          });
        }

        el.querySelector('#prSave').addEventListener('click', function () {
          var name = el.querySelector('#prName').value.trim();
          var price = parseAmount(el.querySelector('#prPrice').value);
          var categoryId = catSelect.value;
          var pointIds = Array.prototype.slice.call(el.querySelectorAll('#prPoints input:checked')).map(function (i) { return i.value; });

          if (!name) { toast('Введите название товара', 'error'); el.querySelector('#prName').focus(); return; }
          if (DB.products.some(function (p) { return p.name.toLowerCase() === name.toLowerCase() && (!editing || p.id !== product.id); })) {
            toast('Товар с таким названием уже есть в каталоге', 'warn');
            return;
          }
          if (!(price > 0)) { toast('Укажите цену больше нуля', 'error'); el.querySelector('#prPrice').focus(); return; }

          if (editing) {
            Object.assign(product, { name: name, price: price, categoryId: categoryId, photo: photoData, pointIds: pointIds, updatedAt: Date.now() });
          } else {
            DB.products.push({
              id: uid(),
              name: name,
              price: price,
              categoryId: categoryId,
              photo: photoData,
              pointIds: pointIds,
              createdAt: Date.now(),
              updatedAt: Date.now()
            });
          }
          saveDB();
          close();
          if (!pointIds.length) toast('Товар сохранён без точки — назначьте точки, чтобы он появился в кассе', 'warn', 5200);
          else toast(editing ? 'Товар обновлён' : 'Товар добавлен в каталог', 'success');
          ctx.rerender();
        });
      }
    });
    return modal;
  }

  function openCategoriesModal(ctx) {
    function renderBody() {
      var rows = DB.categories.map(function (c) {
        var used = DB.products.filter(function (p) { return p.categoryId === c.id; }).length;
        return '<div class="flex between gap-12" style="padding:10px 0;border-bottom:1px solid var(--line-soft)">' +
          '<div><div class="semibold" style="font-size:13.5px">' + esc(c.name) + '</div>' +
          '<div class="tiny muted">' + used + ' ' + plural(used, 'товар', 'товара', 'товаров') + '</div></div>' +
          (used === 0
            ? '<button type="button" class="icon-btn danger" data-del-cat="' + c.id + '" title="Удалить">' + icon('trash', 15) + '</button>'
            : '<span class="badge neutral">используется</span>') +
        '</div>';
      }).join('');
      return '<div>' +
        '<div class="flex gap-6" style="margin-bottom:8px">' +
          '<input class="input" id="newCatName" placeholder="Новая категория" maxlength="40">' +
          '<button type="button" class="btn btn-primary" id="addCatBtn">' + icon('plus', 16) + '</button>' +
        '</div>' +
        '<div id="catList">' + rows + '</div>' +
        '<div class="hint" style="margin-top:10px">Категорию с товарами удалить нельзя — сначала перенесите товары.</div>' +
      '</div>';
    }

    openModal({
      title: 'Категории товаров',
      size: 'sm',
      body: renderBody(),
      footer: '<button type="button" class="btn btn-primary" id="closeCats">Готово</button>',
      onMount: function (el, close) {
        function bind() {
          el.querySelector('#addCatBtn').addEventListener('click', function () {
            var input = el.querySelector('#newCatName');
            var name = input.value.trim();
            if (!name) { toast('Введите название категории', 'error'); return; }
            if (DB.categories.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) {
              toast('Такая категория уже есть', 'warn');
              return;
            }
            DB.categories.push({ id: uid(), name: name, createdAt: Date.now(), updatedAt: Date.now() });
            saveDB();
            el.querySelector('.modal-body').innerHTML = renderBody();
            bind();
            toast('Категория добавлена');
            ctx.rerender();
          });
          el.querySelectorAll('[data-del-cat]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
              var ok = await confirmDialog({ title: 'Удалить категорию?', message: 'Категория будет удалена из списка.', confirmText: 'Удалить', danger: true });
              if (!ok) return;
              var catId = btn.getAttribute('data-del-cat');
              DB.categories = DB.categories.filter(function (c) { return c.id !== catId; });
              if (window.POS_API) window.POS_API.markDeleted('categories', catId);
              saveDB();
              el.querySelector('.modal-body').innerHTML = renderBody();
              bind();
              toast('Категория удалена');
              ctx.rerender();
            });
          });
        }
        bind();
        el.querySelector('#closeCats').addEventListener('click', close);
      }
    });
  }

  PAGES.products = {
    render: function (root, ctx) {
      var user = ctx.user;
      var q = state.search.trim().toLowerCase();
      var list = DB.products.filter(function (p) {
        if (state.category !== 'all' && p.categoryId !== state.category) return false;
        if (q && p.name.toLowerCase().indexOf(q) === -1) return false;
        return true;
      }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

      var unassigned = unassignedProducts();
      var usedCats = DB.categories.filter(function (c) {
        return DB.products.some(function (p) { return p.categoryId === c.id; });
      });
      if (state.category !== 'all' && !DB.categories.some(function (c) { return c.id === state.category; })) state.category = 'all';

      root.innerHTML =
        '<div class="page">' +
          '<div class="page-head">' +
            '<div><h1>Товары</h1><div class="sub">' + DB.products.length + ' ' + plural(DB.products.length, 'товар', 'товара', 'товаров') + ' в каталоге · ' + DB.categories.length + ' ' + plural(DB.categories.length, 'категория', 'категории', 'категорий') +
              (unassigned.length ? ' · <span style="color:#b54708">' + unassigned.length + ' без точки</span>' : '') + '</div></div>' +
            '<div class="page-actions">' +
              '<button type="button" class="btn btn-secondary" id="manageCats">' + icon('tag', 16) + ' Категории</button>' +
              '<button type="button" class="btn btn-primary" id="addProduct">' + icon('plus', 17) + ' Добавить товар</button>' +
            '</div>' +
          '</div>' +
          '<div class="card card-pad" style="padding:16px 18px">' +
            '<div class="catalog-head" style="margin-bottom:12px">' +
              '<div class="input-icon search" style="flex:1;min-width:200px">' + icon('search', 17) +
                '<input class="input" id="prodSearch" placeholder="Поиск по названию…" value="' + esc(state.search) + '"></div>' +
              '<span class="muted small" id="shownCount">' + list.length + ' показано</span>' +
            '</div>' +
            '<div class="cat-chips" id="prodChips" style="margin-bottom:0"></div>' +
          '</div>' +
          (unassigned.length
            ? '<div class="card" style="padding:14px 18px;margin-top:14px;border-color:var(--warning);background:var(--warning-soft)">' +
                '<div class="flex between wrap gap-12"><span class="small">' + icon('alert', 15) +
                  ' <b>' + unassigned.length + ' ' + plural(unassigned.length, 'товар', 'товара', 'товаров') + ' без точки</b> — не показываются в кассе и на складе, пока не назначите точку.</span>' +
                  '<button type="button" class="btn btn-sm btn-secondary" id="assignUnassigned">Назначить точки</button></div>' +
              '</div>'
            : '') +
          '<div class="section-gap" id="prodGrid"></div>' +
        '</div>' +
        '<button type="button" class="fab" id="productsExport">' + icon('download', 17) + ' Экспорт<span class="kbd">XLSX</span></button>';

      root.querySelector('#addProduct').addEventListener('click', function () { openProductModal(ctx, null); });
      var assignUn = root.querySelector('#assignUnassigned');
      if (assignUn) assignUn.addEventListener('click', function () {
        var target = unassigned[0];
        if (target) openProductModal(ctx, target);
      });
      root.querySelector('#manageCats').addEventListener('click', function () { openCategoriesModal(ctx); });

      function findProduct(id) { return DB.products.find(function (p) { return p.id === id; }); }

      function cardHtml(p) {
        return '<div class="card prod-card card-hover">' +
          '<div class="photo">' + productPhotoHtml(p) +
            '<div class="photo-actions">' +
              '<button type="button" class="icon-btn" data-edit="' + p.id + '" title="Редактировать">' + icon('edit', 16) + '</button>' +
              '<button type="button" class="icon-btn danger" data-del="' + p.id + '" title="Удалить">' + icon('trash', 16) + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="info">' +
            '<div class="between flex gap-8"><span class="cat">' + esc(categoryName(p.categoryId)) + '</span>' + stockSummary(p) + '</div>' +
            '<div class="nm">' + esc(p.name) + '</div>' +
            '<div class="points" style="margin-top:4px">' + pointsBadges(p) + '</div>' +
            '<div class="price-row"><span class="price">' + fmtMoney(p.price) + '</span>' +
              '<div class="flex gap-4">' +
                '<button type="button" class="icon-btn" data-edit2="' + p.id + '" title="Редактировать">' + icon('edit', 16) + '</button>' +
                '<button type="button" class="icon-btn danger" data-del2="' + p.id + '" title="Удалить">' + icon('trash', 16) + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }

      function bindGrid() {
        root.querySelectorAll('[data-edit],[data-edit2]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var p = findProduct(btn.getAttribute('data-edit') || btn.getAttribute('data-edit2'));
            if (p) openProductModal(ctx, p);
          });
        });
        root.querySelectorAll('[data-del],[data-del2]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var p = findProduct(btn.getAttribute('data-del') || btn.getAttribute('data-del2'));
            if (!p) return;
            var ok = await confirmDialog({
              title: 'Удалить товар?',
              message: '«' + esc(p.name) + '» будет удалён из каталога и со склада. Оформленные продажи сохранятся в истории.',
              confirmText: 'Удалить',
              danger: true
            });
            if (!ok) return;
            deleteProduct(p.id);
            toast('Товар удалён');
            ctx.rerender();
          });
        });
        var emptyAdd = root.querySelector('#emptyAdd');
        if (emptyAdd) emptyAdd.addEventListener('click', function () { openProductModal(ctx, null); });
      }

      function renderGrid() {
        var q = state.search.trim().toLowerCase();
        var filtered = DB.products.filter(function (p) {
          if (state.category !== 'all' && p.categoryId !== state.category) return false;
          if (q && p.name.toLowerCase().indexOf(q) === -1) return false;
          return true;
        }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

        var grid = root.querySelector('#prodGrid');
        var shown = root.querySelector('#shownCount');
        if (shown) shown.textContent = filtered.length + ' показано';
        if (!DB.products.length) {
          grid.innerHTML = '<div class="card">' + emptyState('package', 'Каталог пуст', 'Добавьте первый товар — он сразу появится в кассе.', '<button class="btn btn-primary" id="emptyAdd">' + icon('plus', 16) + ' Добавить товар</button>') + '</div>';
        } else if (!filtered.length) {
          grid.innerHTML = '<div class="card"><div class="tbl-empty">Ничего не найдено по фильтру — измените запрос или категорию</div></div>';
        } else {
          grid.innerHTML = '<div class="prod-grid">' + filtered.map(cardHtml).join('') + '</div>';
        }
        bindGrid();
      }

      function renderChips() {
        var chips = root.querySelector('#prodChips');
        var usedCats = DB.categories.filter(function (c) {
          return DB.products.some(function (p) { return p.categoryId === c.id; });
        });
        if (state.category !== 'all' && !DB.categories.some(function (c) { return c.id === state.category; })) state.category = 'all';
        chips.innerHTML = '<button type="button" class="chip ' + (state.category === 'all' ? 'active' : '') + '" data-cat="all">Все <span class="count">' + DB.products.length + '</span></button>' +
          usedCats.map(function (c) {
            var n = DB.products.filter(function (p) { return p.categoryId === c.id; }).length;
            return '<button type="button" class="chip ' + (state.category === c.id ? 'active' : '') + '" data-cat="' + c.id + '">' + esc(c.name) + ' <span class="count">' + n + '</span></button>';
          }).join('');
        chips.querySelectorAll('[data-cat]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            state.category = btn.getAttribute('data-cat');
            renderChips();
            renderGrid();
          });
        });
      }

      root.querySelector('#prodSearch').addEventListener('input', function (e) {
        state.search = e.target.value;
        renderGrid();
      });

      renderChips();
      renderGrid();

      root.querySelector('#productsExport').addEventListener('click', function () {
        var rows = [['Название', 'Категория', 'Цена, ₸', 'Точки продаж', 'Остаток на складе, шт']];
        DB.products.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); }).forEach(function (p) {
          var stock = DB.stock.filter(function (r) { return r.productId === p.id; }).reduce(function (s, r) { return s + r.qty; }, 0);
          var pointsText = !p.pointIds || !p.pointIds.length ? 'Не назначен' : p.pointIds.map(function (id) { return pointName(id, 'Удалена'); }).join(', ');
          rows.push([p.name, categoryName(p.categoryId), p.price, pointsText, stock]);
        });
        var catRows = [['Категория', 'Товаров']];
        DB.categories.forEach(function (c) {
          catRows.push([c.name, DB.products.filter(function (p) { return p.categoryId === c.id; }).length]);
        });
        PosXlsx.downloadXlsx('tovary_' + dayKey(Date.now()) + '.xlsx', [
          { name: 'Товары', rows: rows },
          { name: 'Категории', rows: catRows }
        ]);
        toast('Каталог выгружен в Excel', 'success');
      });
    }
  };
})();
