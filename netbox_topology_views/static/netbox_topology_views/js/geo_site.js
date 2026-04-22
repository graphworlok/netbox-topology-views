/**
 * geo_site.js — Per-site device layout view with optional background image overlay.
 *
 * Renders all devices in a site as nodes. If a CoordinateGroup with a
 * background_image_url is selected the image is drawn behind the nodes,
 * allowing floor-plan / site-map style positioning.
 *
 * Dragging nodes saves their position via the existing save-coords API when
 * coordinates saving is enabled in PLUGINS_CONFIG.
 *
 * Globals expected from the template:
 *   window.GEO_DATA         — {nodes, edges, site, groups, selected_group_id, background_image_url}
 *   window.SAVE_COORDS_URL  — URL of the save-coords PATCH endpoint
 *   window.SAVE_COORDS      — true/false (from PLUGINS_CONFIG allow_coordinates_saving)
 *   window.GROUP_ID         — currently selected coordinate group id (or null)
 */
(function () {
  'use strict';

  const data = window.GEO_DATA;
  if (!data) {
    console.error('geo_site.js: window.GEO_DATA is not defined');
    return;
  }

  const container = document.getElementById('geo-canvas');
  if (!container) return;

  // ── Datasets ──────────────────────────────────────────────────────────────
  const nodes = new vis.DataSet(data.nodes);
  const edges = new vis.DataSet(data.edges);

  // ── Background image ─────────────────────────────────────────────────────
  let bgImage = null;
  let bgImageLoaded = false;
  // We track image natural dimensions to scale correctly
  let bgNatW = 1, bgNatH = 1;

  const bgUrl = data.background_image_url || window.BG_IMAGE_URL || '';
  if (bgUrl) {
    bgImage = new Image();
    bgImage.onload = function () {
      bgNatW = bgImage.naturalWidth  || 1000;
      bgNatH = bgImage.naturalHeight || 1000;
      bgImageLoaded = true;
      network.redraw();
    };
    bgImage.src = bgUrl;
  }

  // ── vis-network options ───────────────────────────────────────────────────
  const hasSavedCoords = data.nodes.some(function (n) { return n.fixed; });

  const options = {
    physics: {
      // Use light physics only when no saved positions exist
      enabled: !hasSavedCoords,
      forceAtlas2Based: { gravitationalConstant: -500 },
      solver: 'forceAtlas2Based',
      stabilization: { iterations: 200 },
    },
    interaction: {
      zoomView: true,
      dragView: true,
      dragNodes: true,
      hover: true,
      tooltipDelay: 200,
    },
    nodes: {
      shape: 'dot',
      size: 10,
      font: { color: '#ffffff', size: 11 },
    },
    edges: {
      color: { color: 'rgba(120,120,120,0.7)' },
      width: 1,
      smooth: { enabled: false },
    },
  };

  const network = new vis.Network(container, { nodes, edges }, options);

  // ── Draw background image ─────────────────────────────────────────────────
  // The image is drawn spanning the area [-W/2, -H/2] to [W/2, H/2] in
  // network coordinates where W and H are derived from the image aspect ratio
  // scaled so the longer axis = 1000 units.
  function getBgBounds() {
    const scale = 1000 / Math.max(bgNatW, bgNatH);
    const w = bgNatW * scale;
    const h = bgNatH * scale;
    return { x: -w / 2, y: -h / 2, w: w, h: h };
  }

  network.on('beforeDrawing', function (ctx) {
    if (!bgImageLoaded) return;
    const b = getBgBounds();
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(bgImage, b.x, b.y, b.w, b.h);
    ctx.restore();
  });

  // ── Save coordinates on drag end ──────────────────────────────────────────
  if (window.SAVE_COORDS && window.SAVE_COORDS_URL) {
    const groupId = window.GROUP_ID || 'default';

    network.on('dragEnd', function (params) {
      if (!params.nodes || params.nodes.length === 0) return;

      params.nodes.forEach(function (nodeId) {
        const pos = network.getPositions([nodeId])[nodeId];
        if (!pos) return;

        fetch(window.SAVE_COORDS_URL, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken'),
          },
          body: JSON.stringify({
            node_id: String(nodeId),
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            group: groupId,
          }),
        }).catch(function (err) {
          console.warn('geo_site: save_coords failed', err);
        });

        // Pin the node after first manual drag
        nodes.update({ id: nodeId, fixed: true, x: pos.x, y: pos.y });
      });
    });
  }

  // ── Click → navigate to device page ─────────────────────────────────────
  network.on('doubleClick', function (params) {
    if (params.nodes.length === 1) {
      const node = nodes.get(params.nodes[0]);
      if (node && node.url) {
        window.open(node.url, '_blank');
      }
    }
  });

  // Cursor hints
  network.on('hoverNode', function () { container.style.cursor = 'pointer'; });
  network.on('blurNode',  function () { container.style.cursor = 'default'; });

  // ── Fit on load ───────────────────────────────────────────────────────────
  network.once('stabilized', function () {
    network.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } });
  });
  setTimeout(function () { network.fit({ animation: false }); }, 300);

  window._geoSiteNetwork = network;

  // ── CSRF helper ───────────────────────────────────────────────────────────
  function getCookie(name) {
    let cookieValue = '';
    if (document.cookie && document.cookie !== '') {
      for (const part of document.cookie.split(';')) {
        const c = part.trim();
        if (c.startsWith(name + '=')) {
          cookieValue = decodeURIComponent(c.slice(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  }
})();
