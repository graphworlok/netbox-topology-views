/**
 * geo_global.js — Global geographic map view.
 *
 * Globals expected from the template:
 *   window.GEO_DATA        — {nodes, edges, legend:{statuses,tenants,site_type_tags}}
 *   window.GEO_SITE_BASE_URL
 *   window.WORLD_MAP_URL
 */
(function () {
  'use strict';

  const data = window.GEO_DATA;
  if (!data) { console.error('geo_global.js: window.GEO_DATA undefined'); return; }

  const container = document.getElementById('geo-canvas');
  if (!container) return;

  // ── State ─────────────────────────────────────────────────────────────────
  let sizeMode  = 'device_count'; // 'none' | 'device_count' | 'circuit_count'
  let scaleMode = 'sqrt';         // 'log' | 'sqrt' | 'linear'
  let colorMode = 'status';       // 'status' | 'tenant'

  // Status filter: all statuses visible by default
  const allStatuses    = new Set((data.legend.statuses    || []).map(function (s) { return s.value; }));
  const activeStatuses = new Set(allStatuses);

  // Site-type tag info (for border colouring)
  const hasSiteTypeTags = (data.legend.site_type_tags || []).length > 0;

  // ── Size range (adjustable via toolbar sliders) ───────────────────────────
  let SIZE_MIN  =  8;
  let SIZE_MAX  = 36;
  const SIZE_BASE = 12;

  const maxDevices  = Math.max(1, ...data.nodes.map(function (n) { return n.device_count  || 0; }));
  const maxCircuits = Math.max(1, ...data.nodes.map(function (n) { return n.circuit_count || 0; }));

  function scaledRatio(value, max) {
    if (max === 0 || value === 0) return 0;
    const r = value / max;           // 0..1 linear
    if (scaleMode === 'log')    return Math.log(value + 1) / Math.log(max + 1);
    if (scaleMode === 'linear') return r;
    return Math.sqrt(r);             // sqrt (default)
  }

  function nodeSize(n) {
    if (sizeMode === 'none') return SIZE_BASE;
    const value = sizeMode === 'circuit_count' ? (n.circuit_count || 0) : (n.device_count || 0);
    const max   = sizeMode === 'circuit_count' ? maxCircuits : maxDevices;
    return SIZE_MIN + Math.round(scaledRatio(value, max) * (SIZE_MAX - SIZE_MIN));
  }

  // ── Fill / border colour ──────────────────────────────────────────────────
  function nodeFill(n) {
    if (colorMode === 'tenant') return n.tenant_color || '#6c757d';
    return n.status_color || '#6c757d';
  }
  function nodeBorder(n, fill) { return n.border_color || fill; }
  function nodeBorderWidth(n)  { return n.border_color ? 3 : 1; }

  // ── Visibility ────────────────────────────────────────────────────────────
  function isVisible(n) { return activeStatuses.has(n.status); }

  // ── Build a vis node from raw metadata ───────────────────────────────────
  function makeVisNode(n) {
    const fill   = nodeFill(n);
    const border = nodeBorder(n, fill);
    const bw     = nodeBorderWidth(n);
    return {
      id:    n.id,
      label: n.label,
      title: n.title,
      x: n.x, y: n.y,
      fixed: true,
      font:  n.font,
      shape: 'dot',
      size:   nodeSize(n),
      hidden: !isVisible(n),
      color: {
        background: fill,
        border:     border,
        highlight:  { background: fill, border: border },
        hover:      { background: fill, border: border },
      },
      borderWidth:         bw,
      borderWidthSelected: bw,
    };
  }

  const nodes = new vis.DataSet(data.nodes.map(makeVisNode));
  const edges = new vis.DataSet(data.edges);

  // ── Re-order DataSet so smaller nodes are inserted last (drawn on top) ────
  // vis-network renders nodes in DataSet insertion order; later = on top.
  function reorderBySize() {
    const all = nodes.get();                           // current vis nodes
    if (!all.length) return;
    const ids = all.map(function (n) { return n.id; });
    nodes.remove(ids);
    // Sort descending by size: largest first (drawn behind), smallest last (on top)
    all.sort(function (a, b) { return b.size - a.size; });
    nodes.add(all);
  }

  // ── World-map background ──────────────────────────────────────────────────
  const MAP_W = 1800, MAP_H = 900;
  const mapImage = new Image();
  mapImage.src = window.WORLD_MAP_URL || '';

  // ── vis-network ───────────────────────────────────────────────────────────
  const network = new vis.Network(container, { nodes, edges }, {
    physics: { enabled: false },
    interaction: { zoomView: true, dragView: true, hover: true, tooltipDelay: 150 },
    nodes: { shape: 'dot', font: { color: '#ffffff', size: 11 } },
    edges: {
      color: { color: 'rgba(150,150,150,0.4)' },
      width: 1,
      smooth: { enabled: false },
      selectionWidth: 0,
    },
  });

  network.on('beforeDrawing', function (ctx) {
    if (!mapImage.complete || mapImage.naturalWidth === 0) return;
    ctx.save();
    ctx.drawImage(mapImage, -MAP_W / 2, -MAP_H / 2, MAP_W, MAP_H);
    ctx.restore();
  });

  mapImage.onload = function () { network.redraw(); };

  // Initial fit + first z-sort
  setTimeout(function () {
    network.fit({ animation: false });
    reorderBySize();
  }, 100);

  // ── Navigation ────────────────────────────────────────────────────────────
  network.on('click', function (params) {
    if (params.nodes.length === 1) {
      const n = data.nodes.find(function (x) { return x.id === params.nodes[0]; });
      if (n && n.site_id) {
        window.location.href =
          (window.GEO_SITE_BASE_URL || '/plugins/netbox_topology_views/geo/site/') + n.site_id + '/';
      }
    }
  });
  network.on('hoverNode', function () { container.style.cursor = 'pointer'; });
  network.on('blurNode',  function () { container.style.cursor = 'default'; });

  // ── Apply all modes + re-sort ─────────────────────────────────────────────
  function applyModes() {
    nodes.update(data.nodes.map(function (n) {
      const fill   = nodeFill(n);
      const border = nodeBorder(n, fill);
      const bw     = nodeBorderWidth(n);
      return {
        id:     n.id,
        size:   nodeSize(n),
        hidden: !isVisible(n),
        color: {
          background: fill,
          border:     border,
          highlight:  { background: fill, border: border },
          hover:      { background: fill, border: border },
        },
        borderWidth:         bw,
        borderWidthSelected: bw,
      };
    }));
    reorderBySize();
    renderLegend();
    updateScaleHint();
  }

  // ── Scale hint label ──────────────────────────────────────────────────────
  function updateScaleHint() {
    const el = document.getElementById('geo-scale-hint');
    if (!el) return;
    if (sizeMode === 'none') { el.textContent = ''; return; }
    const labels = { log: 'Logarithmic', sqrt: 'Square root', linear: 'Linear' };
    const metric = sizeMode === 'device_count' ? 'devices' : 'circuits';
    const max    = sizeMode === 'device_count' ? maxDevices : maxCircuits;
    el.textContent = `Size: ${labels[scaleMode] || scaleMode} scale · ${metric} · max ${max}`;
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  const legendEl = document.getElementById('geo-legend');

  function swatch(color) {
    return `<span class="geo-legend-swatch" style="background:${color}"></span>`;
  }
  function borderSwatch(color) {
    return `<span class="geo-legend-swatch geo-legend-swatch-border" style="border-color:${color}"></span>`;
  }
  function row(sw, label) {
    return `<div class="geo-legend-row">${sw}<span>${label}</span></div>`;
  }

  function renderLegend() {
    if (!legendEl) return;
    let rows = [];

    if (colorMode === 'tenant') {
      (data.legend.tenants || []).forEach(function (t) {
        rows.push(row(swatch(t.color), t.name || '(no tenant)'));
      });
      if (!(data.legend.tenants || []).length)
        rows.push('<div class="geo-legend-row" style="opacity:.6">No tenants assigned</div>');
    } else {
      (data.legend.statuses || []).forEach(function (s) {
        rows.push(row(swatch(s.color), s.label));
      });
    }

    if (hasSiteTypeTags) {
      rows.push('<div class="geo-legend-divider"></div>');
      rows.push('<div class="geo-legend-subtitle">Site type (border)</div>');
      (data.legend.site_type_tags || []).forEach(function (t) {
        rows.push(row(borderSwatch(t.color), t.name));
      });
    }

    legendEl.innerHTML = '<div class="geo-legend-title">Legend</div>' + rows.join('');
  }

  // ── Status filter panel ───────────────────────────────────────────────────
  function buildFilterPanel() {
    const panel = document.getElementById('geo-filter-panel');
    if (!panel) return;

    let html = '<div class="geo-filter-title"><i class="mdi mdi-filter-outline"></i> Show Sites</div>';
    (data.legend.statuses || []).forEach(function (s) {
      const chk = activeStatuses.has(s.value) ? 'checked' : '';
      html +=
        `<div class="geo-filter-row">
           <input type="checkbox" id="fs-${s.value}" data-status="${s.value}" ${chk}
                  class="geo-status-checkbox form-check-input">
           <label for="fs-${s.value}" class="geo-filter-label">
             <span class="geo-legend-swatch" style="background:${s.color}"></span>
             ${s.label}
           </label>
         </div>`;
    });
    html += `<div class="geo-filter-actions">
               <a href="#" id="geo-filter-all">All</a> / <a href="#" id="geo-filter-none">None</a>
             </div>`;
    panel.innerHTML = html;

    panel.addEventListener('change', function (e) {
      if (!e.target.classList.contains('geo-status-checkbox')) return;
      const v = e.target.dataset.status;
      if (e.target.checked) activeStatuses.add(v); else activeStatuses.delete(v);
      applyModes();
    });
    document.getElementById('geo-filter-all').addEventListener('click', function (e) {
      e.preventDefault();
      allStatuses.forEach(function (v) { activeStatuses.add(v); });
      panel.querySelectorAll('.geo-status-checkbox').forEach(function (cb) { cb.checked = true; });
      applyModes();
    });
    document.getElementById('geo-filter-none').addEventListener('click', function (e) {
      e.preventDefault();
      activeStatuses.clear();
      panel.querySelectorAll('.geo-status-checkbox').forEach(function (cb) { cb.checked = false; });
      applyModes();
    });
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────
  function bindToolbar() {
    const $ = function (id) { return document.getElementById(id); };

    // Dropdowns
    const bindSelect = function (id, getter, setter) {
      const el = $(id);
      if (!el) return;
      el.value = getter();
      el.addEventListener('change', function () { setter(this.value); applyModes(); });
    };
    bindSelect('geo-size-by',  function () { return sizeMode;  }, function (v) { sizeMode  = v; });
    bindSelect('geo-scale-fn', function () { return scaleMode; }, function (v) { scaleMode = v; });
    bindSelect('geo-color-by', function () { return colorMode; }, function (v) { colorMode = v; });

    // Min / Max size sliders
    const minSlider  = $('geo-size-min');
    const maxSlider  = $('geo-size-max');
    const minValEl   = $('geo-size-min-val');
    const maxValEl   = $('geo-size-max-val');

    function syncSliderLabels() {
      if (minValEl) minValEl.textContent = SIZE_MIN;
      if (maxValEl) maxValEl.textContent = SIZE_MAX;
    }

    if (minSlider) {
      minSlider.value = SIZE_MIN;
      minSlider.addEventListener('input', function () {
        SIZE_MIN = Math.min(parseInt(this.value), SIZE_MAX - 4);
        this.value = SIZE_MIN;
        syncSliderLabels();
        applyModes();
      });
    }
    if (maxSlider) {
      maxSlider.value = SIZE_MAX;
      maxSlider.addEventListener('input', function () {
        SIZE_MAX = Math.max(parseInt(this.value), SIZE_MIN + 4);
        this.value = SIZE_MAX;
        syncSliderLabels();
        applyModes();
      });
    }
    syncSliderLabels();
  }

  function init() {
    bindToolbar();
    buildFilterPanel();
    renderLegend();
    updateScaleHint();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window._geoNetwork = network;
})();
