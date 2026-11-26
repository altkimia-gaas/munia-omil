// Comportamiento del lado del navegador. Solo delegación a nivel de documento, para que funcione igual
// en el servidor y en la demo web (donde el contenido se reemplaza sin recargar la página).
(function () {
  if (window.__trazaApp) return;
  window.__trazaApp = true;

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-menu]')) document.body.classList.toggle('menu-open');
  });

  // Buscador de la ayuda: oculta lo que no coincide
  document.addEventListener('input', function (e) {
    var inp = e.target.closest('[data-filtro]');
    if (!inp) return;
    var t = inp.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    var visibles = 0;
    document.querySelectorAll(inp.getAttribute('data-filtro')).forEach(function (el) {
      var txt = el.textContent.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      var ok = !t || txt.indexOf(t) >= 0;
      el.hidden = !ok;
      if (el.tagName === 'DT' && el.nextElementSibling) el.nextElementSibling.hidden = !ok;
      if (ok) visibles++;
      if (ok && t && el.tagName === 'DETAILS') el.open = true;
    });
    var aviso = document.querySelector('.ayuda-sin-resultados');
    if (aviso) aviso.hidden = visibles > 0;
  });

  // Carga de CSV: lee el archivo en el navegador y lo deja en un textarea
  document.addEventListener('change', function (e) {
    var f = e.target.closest('[data-csv-destino]');
    if (!f || !f.files || !f.files[0]) return;
    var archivo = f.files[0];
    var lector = new FileReader();
    lector.onload = function () {
      var id = f.getAttribute('data-csv-destino');
      var ta = document.getElementById(id);
      if (ta) ta.value = String(lector.result);
      var nom = document.querySelector('[data-csv-nombre="' + id + '"]');
      if (nom) nom.value = archivo.name;
    };
    lector.readAsText(archivo, 'utf-8');
  });

  // Atajo: tecla "?" abre la ayuda (fuera de campos de texto)
  document.addEventListener('keydown', function (e) {
    if (e.key !== '?' || e.target.closest('input, textarea, select, [contenteditable]')) return;
    var b = document.querySelector('[data-ayuda]');
    if (b) { e.preventDefault(); b.click(); }
  });
})();
