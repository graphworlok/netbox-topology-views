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
  let sizeMode  = 'device_count';  // default: size by device count
  let colorMode = 'status';        // 'status' | 'tenant'

  // Status filter: all statuses visible by default
  const allStatuses = new Set((data.legend.statuses || []).map(s => s.value));
  const activeStatuses = new Set(allStatuses);

  // Site-type tag info
  const siteTypeSlugs = new Set((data.legend.site_type_tags || []).map(t => t.slug));
  const hasSiteTypeTags = siteTypeSlugs.size > 0;

  // ── Size scaling (sqrt so large sites don't overwhelm) ────────────────────
  const SIZE_MIN  =  8;
  const SIZE_MAX  = 40;
  const SIZE_BASE = 12;

  const maxDevices  = Math.max(1, ...data.nodes.map(n => n.device_count  || 0));
  const maxCircuits = Math.max(1, ...data.nodes.map(n => n.circuit_count || 0));

  function scaleSize(value, max) {
    if (max === 0) return SIZE_BASE;
    return SIZE_MIN + Math.round(Math.sqrt(value / max) * (SIZE_MAX - SIZE_MIN));
  }

  function nodeSize(n) {
    if (sizeMode === 'device_count')  return scaleSize(n.device_count  || 0, maxDevices);
    if (sizeMode === 'circuit_count') return scaleSize(n.circuit_count || 0, maxCircuits);
    return SIZE_BASE;
  }

  // ── Fill colour ───────────────────────────────────────────────────────────
  function nodeFill(n) {
    if (colorMode === 'tenant') return n.tenant_color || '#6c757d';
    return n.status_color || '#6c757d';   // 'status' (default)
  }

  // ── Border: first site-type tag colour ───────────────────────────────────
  function nodeBorder(n, fill) {
    return n.border_color || fill;
  }
  function nodeBorderWidth(n) {
    return n.border_color ? 3 : 1;
  }

  // ── Visibility (status filter) ────────────────────────────────────────────
  function isVisible(n) {
    return activeStatuses.has(n.status);
  }

  // ── Build a vis node object from raw metadata ─────────────────────────────
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
      font: n.font,
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
  setTimeout(function () { network.fit({ animation: false }); }, 100);

  // ── Navigation ────────────────────────────────────────────────────────────
  network.on('click', function (params) {
    if (params.nodes.length === 1) {
      const n = data.nodes.find(function (x) { return x.id === params.nodes[0]; });
      if (n && n.site_id) {
        const base = window.GEO_SITE_BASE_URL || '/plugins/netbox_topology_views/geo/site/';
        window.location.href = base + n.site_id + '/';
      }
    }
  });
  network.on('hoverNode', function () { container.style.cursor = 'pointer'; });
  network.on('blurNode',  function () { container.style.cursor = 'default'; });

  // ── Apply all modes ───────────────────────────────────────────────────────
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
    renderLegend();
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  const legendEl = document.getElementById('geo-legend');

  function swatch(color) {
    return `<span class="geo-legend-swatch" style="background:${color}"></span>`;
  }
  function borderSwatch(color) {
    return `<span class="geo-legend-swatch geo-legend-swatch-border" style="border-color:${color}"></span>`;
  }
  function row(swatchHtml, label) {
    return `<div class="geo-legend-row">${swatchHtml}<span>${label}</span></div>`;
  }

  function renderLegend() {
    if (!legendEl) return;
    let rows = [];

    if (colorMode === 'tenant') {
      (data.legend.tenants || []).forEach(function (t) {
        rows.push(row(swatch(t.color), t.name || '(no tenant)'));
      });
      if (!data.legend.tenants || !data.legend.tenants.length) {
        rows.push('<div class="geo-legend-row" style="opacity:.6">No tenants assigned</div>');
      }
    } else {
      // status (default)
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

    if (sizeMode !== 'none') {
      const label = sizeMode === 'device_count' ? 'Devices' : 'Circuits';
      const max   = sizeMode === 'device_count' ? maxDevices : maxCircuits;
      rows.push(`<div class="geo-legend-note">● size ∝ ${label} (max ${max})</div>`);
    }

    legendEl.innerHTML = '<div class="geo-legend-title">Legend</div>' + rows.join('');
  }

  // ── Status filter panel ───────────────────────────────────────────────────
  function buildFilterPanel() {
    const panel = document.getElementById('geo-filter-panel');
    if (!panel) return;

    let html = '<div class="geo-filter-title"><i class="mdi mdi-filter-outline"></i> Site Status</div>';
    (data.legend.statuses || []).forEach(function (s) {
      const checked = activeStatuses.has(s.value) ? 'checked' : '';
      html +=
        `<div class="geo-filter-row">
           <input type="checkbox" id="fs-${s.value}" data-status="${s.value}" ${checked}
                  class="geo-status-checkbox form-check-input">
           <label for="fs-${s.value}" class="geo-filter-label">
             <span class="geo-legend-swatch" style="background:${s.color}"></span>
             ${s.label}
           </label>
         </div>`;
    });
    html +=
      `<div class="geo-filter-actions">
         <a href="#" id="geo-filter-all">All</a> / <a href="#" id="geo-filter-none">None</a>
       </div>`;

    panel.innerHTML = html;

    panel.addEventListener('change', function (e) {
      if (!e.target.classList.contains('geo-status-checkbox')) return;
      const val = e.target.dataset.status;
      if (e.target.checked) activeStatuses.add(val);
      else                   activeStatuses.delete(val);
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
    const sizeSelect  = document.getElementById('geo-size-by');
    const colorSelect = document.getElementById('geo-color-by');
    if (sizeSelect) {
      sizeSelect.value = sizeMode;
      sizeSelect.addEventListener('change', function () { sizeMode  = this.value; applyModes(); });
    }
    if (colorSelect) {
      colorSelect.value = colorMode;
      colorSelect.addEventListener('change', function () { colorMode = this.value; applyModes(); });
    }
  }

  function init() {
    bindToolbar();
    buildFilterPanel();
    renderLegend();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window._geoNetwork = network;
})();
