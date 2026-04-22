/**
 * geo_global.js — Global geographic map view.
 *
 * Renders all NetBox sites that have lat/lon co-ordinates as nodes on an
 * equirectangular world-map background image. Clicking a node navigates to
 * the per-site detail view.
 *
 * Expects the following globals to be set in the template before this file
 * is loaded:
 *   window.GEO_DATA  — {nodes: [...], edges: [...]}
 *   window.GEO_SITE_BASE_URL — base URL prefix for geo site pages
 *   window.WORLD_MAP_URL — static URL to the world map image
 */
(function () {
  'use strict';

  const data = window.GEO_DATA;
  if (!data) {
    console.error('geo_global.js: window.GEO_DATA is not defined');
    return;
  }

  const container = document.getElementById('geo-canvas');
  if (!container) return;

  // ── Build node and edge datasets ─────────────────────────────────────────
  const nodes = new vis.DataSet(data.nodes);
  const edges = new vis.DataSet(data.edges);

  // ── World-map background image ────────────────────────────────────────────
  // The map is equirectangular: width = 2 × height.
  // We draw it so that (0°, 0°) → canvas origin (0, 0).
  // Projection matches _build_geo_global_data():
  //   x = (lon / 180) * 900,  y = -(lat / 90) * 450
  // So the map spans x ∈ [-900, 900], y ∈ [-450, 450].
  const MAP_W = 1800;
  const MAP_H = 900;
  const mapImage = new Image();
  mapImage.src = window.WORLD_MAP_URL || '';

  // ── vis-network options ───────────────────────────────────────────────────
  const options = {
    physics: { enabled: false },
    interaction: {
      zoomView: true,
      dragView: true,
      hover: true,
      tooltipDelay: 200,
    },
    nodes: {
      shape: 'dot',
      size: 12,
    },
    edges: {
      color: { color: 'rgba(150,150,150,0.5)' },
      width: 1,
      smooth: { enabled: false },
      selectionWidth: 0,
    },
  };

  const network = new vis.Network(container, { nodes, edges }, options);

  // ── Draw world-map image behind nodes ─────────────────────────────────────
  network.on('beforeDrawing', function (ctx) {
    if (!mapImage.complete || mapImage.naturalWidth === 0) return;

    // Convert network coordinate (-900,-450) → canvas pixels
    const topLeft  = network.canvasToDOM({ x: -MAP_W / 2, y: -MAP_H / 2 });
    const botRight = network.canvasToDOM({ x:  MAP_W / 2, y:  MAP_H / 2 });

    // Save context, draw into network coordinate space
    ctx.save();
    const scale = network.getScale();
    const tr = network.getViewPosition();

    // We must draw in the canvas's own pixel space because vis calls
    // beforeDrawing after applying the transform.  Use domToCanvas inverse:
    const tl = network.DOMtoCanvas({ x: 0, y: 0 });

    // Actually, vis.js beforeDrawing canvas is already in network coordinates,
    // so we just draw at the network-space position.
    ctx.drawImage(
      mapImage,
      -MAP_W / 2,
      -MAP_H / 2,
      MAP_W,
      MAP_H,
    );
    ctx.restore();
  });

  // ── Click → navigate to site geo page ────────────────────────────────────
  network.on('click', function (params) {
    if (params.nodes.length === 1) {
      const nodeId = params.nodes[0];
      const node = nodes.get(nodeId);
      if (node && node.site_id) {
        const base = window.GEO_SITE_BASE_URL || '/plugins/netbox_topology_views/geo/site/';
        window.location.href = base + node.site_id + '/';
      }
    }
  });

  // Change cursor to pointer on node hover
  network.on('hoverNode', function () {
    container.style.cursor = 'pointer';
  });
  network.on('blurNode', function () {
    container.style.cursor = 'default';
  });

  // ── Fit all nodes into view on load ──────────────────────────────────────
  mapImage.onload = function () {
    network.redraw();
  };

  network.once('stabilized', function () {
    network.fit({ animation: false });
  });

  // Fit immediately (physics is disabled so stabilized fires instantly)
  setTimeout(function () { network.fit({ animation: false }); }, 100);

  // Expose for debugging
  window._geoNetwork = network;
})();
