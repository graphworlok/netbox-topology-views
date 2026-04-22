/**
 * geo_global.js — Global geographic map view.
 *
 * Globals expected from the template:
 *   window.GEO_DATA        — {nodes, edges, legend:{regions,statuses,tags,site_type_tags}}
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
  let sizeMode  = 'none';    // 'none' | 'device_count' | 'circuit_count'
  let colorMode = 'region';  // 'region' | 'status' | 'tag'

  // Set of site-type tag slugs currently visible (all on by default)
  const siteTypeSlugs = new Set((data.legend.site_type_tags || []).map(t => t.slug));
  // Active filter: set of slugs that are checked (shown)
  const activeTypeFilters = new Set(siteTypeSlugs);
  const hasSiteTypeTags = siteTypeSlugs.size > 0;

  // ── Size scaling ──────────────────────────────────────────────────────────
  const SIZE_MIN  =  8;
  const SIZE_MAX  = 40;
  const SIZE_BASE = 12;

  const maxDevices  = Math.max(1, ...data.nodes.map(n => n.device_count  || 0));
  const maxCircuits = Math.max(1, ...data.nodes.map(n => n.circuit_count || 0));

  function scaleSize(value, max) {
    return SIZE_MIN + Math.round(Math.sqrt(value / max) * (SIZE_MAX - SIZE_MIN));
  }

  function nodeSize(n) {
    if (sizeMode === 'device_count')  return scaleSize(n.device_count  || 0, maxDevices);
    if (sizeMode === 'circuit_count') return scaleSize(n.circuit_count || 0, maxCircuits);
    return SIZE_BASE;
  }

  // ── Colour helpers ────────────────────────────────────────────────────────
  function nodeFill(n) {
    if (colorMode === 'status') return n.status_color  || '#6c757d';
    if (colorMode === 'tag')    return n.first_tag_color || '#6c757d';
    return n.region_color || '#4e79a7';
  }

  // Border: first site-type tag colour, or a subtly lighter fill if none
  function nodeBorder(n, fill) {
    if (n.border_color) return n.border_color;
    // No site-type tag — use a lighter version of the fill as a subtle ring
    return fill;
  }

  function nodeBorderWidth(n) {
    return n.border_color ? 3 : 1;
  }

  // ── Visibility ────────────────────────────────────────────────────────────
  function isVisible(n) {
    if (!hasSiteTypeTags) return true;
    const nodeSiteTypeSlugs = (n.site_type_tags || []).map(t => t.slug);
    // No site-type tags on this site → always visible
    if (nodeSiteTypeSlugs.length === 0) return true;
    // Visible if ANY of its site-type tags are in the active filter
    return nodeSiteTypeSlugs.some(slug => activeTypeFilters.has(slug));
  }

  // ── Build vis datasets ────────────────────────────────────────────────────
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
      size:  nodeSize(n),
      hidden: !isVisible(n),
      color: {
        background: fill,
        border:     border,
        highlight:  { background: fill, border: border },
        hover:      { background: fill, border: border },
      },
      borderWidth:          bw,
      borderWidthSelected:  bw,
      // carry metadata for re-application
      _meta: n,
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
      const vn = nodes.get(params.nodes[0]);
      const n  = vn && vn._meta;
      if (n && n.site_id) {
        const base = window.GEO_SITE_BASE_URL || '/plugins/netbox_topology_views/geo/site/';
        window.location.href = base + n.site_id + '/';
      }
    }
  });
  network.on('hoverNode', function () { container.style.cursor = 'pointer'; });
  network.on('blurNode',  function () { container.style.cursor = 'default'; });

  // ── Apply all modes to every node ─────────────────────────────────────────
  function applyModes() {
    const updates = data.nodes.map(n => {
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
    });
    nodes.update(updates);
    renderLegend();
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  const legendEl = document.getElementById('geo-legend');

  function legendRow(color, label) {
    return `<div class="geo-legend-row">
      <span class="geo-legend-swatch" style="background:${color}"></span>
      <span>${label}</span>
    </div>`;
  }

  function renderLegend() {
    if (!legendEl) return;
    let rows = [];

    if (colorMode === 'region') {
      rows = (data.legend.regions || []).map(r => legendRow(r.color, r.name || '(no region)'));
    } else if (colorMode === 'status') {
      rows = (data.legend.statuses || []).map(s => legendRow(s.color, s.label));
    } else if (colorMode === 'tag') {
      const shown = (data.legend.tags || []).slice(0, 14);
      rows = shown.length
        ? shown.map(t => legendRow(t.color, t.name))
        : ['<div class="geo-legend-row" style="opacity:.6">No tags</div>'];
    }

    // Border legend (site-type tags)
    if (hasSiteTypeTags) {
      rows.push('<div class="geo-legend-divider"></div>');
      rows.push('<div class="geo-legend-subtitle">Site type (border)</div>');
      (data.legend.site_type_tags || []).forEach(function (t) {
        rows.push(
          `<div class="geo-legend-row">
             <span class="geo-legend-swatch geo-legend-swatch-border" style="border-color:${t.color}"></span>
             <span>${t.name}</span>
           </div>`
        );
      });
    }

    if (sizeMode !== 'none') {
      const label = sizeMode === 'device_count' ? 'Devices' : 'Circuits';
      const max   = sizeMode === 'device_count' ? maxDevices : maxCircuits;
      rows.push(`<div class="geo-legend-note">● size ∝ ${label} (max ${max})</div>`);
    }

    legendEl.innerHTML = '<div class="geo-legend-title">Legend</div>' + rows.join('');
  }

  // ── Site-type filter panel ────────────────────────────────────────────────
  function buildFilterPanel() {
    const panel = document.getElementById('geo-filter-panel');
    if (!panel || !hasSiteTypeTags) {
      if (panel) panel.style.display = 'none';
      return;
    }

    let html = '<div class="geo-filter-title"><i class="mdi mdi-filter-outline"></i> Site Types</div>';
    html += '<div class="geo-filter-note">Show sites with type:</div>';
    (data.legend.site_type_tags || []).forEach(function (t) {
      const checked = activeTypeFilters.has(t.slug) ? 'checked' : '';
      html +=
        `<div class="geo-filter-row">
           <input type="checkbox" id="ft-${t.slug}" data-slug="${t.slug}" ${checked}
                  class="geo-type-checkbox form-check-input">
           <label for="ft-${t.slug}" class="geo-filter-label">
             <span class="geo-legend-swatch geo-legend-swatch-border" style="border-color:${t.color}"></span>
             ${t.name}
           </label>
         </div>`;
    });
    html +=
      `<div class="geo-filter-actions">
         <a href="#" id="geo-filter-all" class="small">All</a>
         &nbsp;/&nbsp;
         <a href="#" id="geo-filter-none" class="small">None</a>
       </div>`;

    panel.innerHTML = html;

    panel.addEventListener('change', function (e) {
      if (!e.target.classList.contains('geo-type-checkbox')) return;
      const slug = e.target.dataset.slug;
      if (e.target.checked) activeTypeFilters.add(slug);
      else                   activeTypeFilters.delete(slug);
      applyModes();
    });

    document.getElementById('geo-filter-all').addEventListener('click', function (e) {
      e.preventDefault();
      siteTypeSlugs.forEach(function (s) { activeTypeFilters.add(s); });
      panel.querySelectorAll('.geo-type-checkbox').forEach(function (cb) { cb.checked = true; });
      applyModes();
    });

    document.getElementById('geo-filter-none').addEventListener('click', function (e) {
      e.preventDefault();
      activeTypeFilters.clear();
      panel.querySelectorAll('.geo-type-checkbox').forEach(function (cb) { cb.checked = false; });
      applyModes();
    });
  }

  // ── Toolbar dropdowns ─────────────────────────────────────────────────────
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
