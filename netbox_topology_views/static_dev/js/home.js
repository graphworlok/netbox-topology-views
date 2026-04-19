import { DataSet } from 'vis-data/esnext'
import { Network } from 'vis-network/esnext'

function generatePortSVG(text) {
    // pre-calculate text width
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');

    const fontFamily = 'helvetica';
    const fontSize = 14;
    textEl.textContent = text;
    textEl.setAttribute('font-family', fontFamily);
    textEl.setAttribute('font-size', fontSize + 'px');
    svg.appendChild(textEl);
    document.body.appendChild(svg);

    const textWidth = textEl.getComputedTextLength();
    textEl.remove();
    svg.remove();

    const rectPadding = 2;
    const rectBorderWidth = 2;
    const rectX = rectBorderWidth / 2;
    const rectY = rectBorderWidth / 2;
    const rectWidth = textWidth + rectBorderWidth + rectPadding * 2;
    const rectHeight = fontSize + rectBorderWidth + rectPadding * 2;
    const svgHeight = rectHeight + rectY + rectBorderWidth / 2;
    const svgWidth = rectWidth + rectX + rectBorderWidth / 2;
    const textX = svgWidth / 2 ;
    const textY = svgHeight / 2;

    // generate SVG
	return 'data:image/svg+xml;charset=utf-8,' + 
    encodeURIComponent( 
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + (svgWidth) + '" height="' + (svgHeight) + '">' +
        '<rect x="' + rectX + '" y="' + rectY + '" rx="4" ry="4" width="' + (rectWidth) + '" height="' + (rectHeight) + '" fill="#ffdf3f" stroke="#ffc93f" stroke-width="' + (rectBorderWidth) + '" style="opacity:0.5"/>' +
        '<text x="' + textX + '" y="' + textY + '" font-family="' + fontFamily + '" font-size="' + (fontSize) + '" fill="black" text-anchor="middle" dominant-baseline="middle">' + text + '</text>' +
        '</svg>'
        )
}

const options = {
    interaction: {
        hover: true,
        hoverConnectedEdges: true,
        multiselect: true
    },
    nodes: {
        shape: 'image',
        brokenImage: brokenImage ?? '',
        size: 35,
        font: {
            multi: 'md',
            face: 'helvetica',
            color:
                document.documentElement.dataset.netboxColorMode === 'dark'
                    ? '#fff'
                    : '#000'
        }
    },
    edges: {
        length: 100,
        width: 2,
        font: {
            face: 'helvetica'
        },
        shadow: {
            enabled: true
        }
    },
    physics: {
        solver: 'forceAtlas2Based'
    }
}

// Render vis graph
let graph = null // vis graph instance

const container = document.querySelector('#visgraph')
const coordSaveCheckbox = document.querySelector('#id_save_coords')
;(function handleLoadData() {
    if (!topologyData) return

    function htmlTitle(text) {
        const container = document.createElement('div')
        container.innerHTML = text
        return container
    }

    const nodes = new DataSet(
        topologyData.nodes.map((node) => ({
            ...node,
            title: htmlTitle(node.title)
        }))
    )

    // make nodes and edges available globally
    window.nodes = nodes;

    const edges = new DataSet(
        topologyData.edges.map((node) => ({
            ...node,
            title: htmlTitle(node.title),
            ...(node.drawTerminationLabel && {
                arrows: {
                    from: {
                        enabled: true,
                        type: "image",
                        src: generatePortSVG(node.cable_a_name)
                    },
                    to: {
                        enabled: true,
                        type: "image",
                        src: generatePortSVG(node.cable_b_name)
                    }
                }
            })
        }))
    )
    window.edges = edges;

    const group_sites = topologyData.options.group_sites
    const group_locations = topologyData.options.group_locations
    const group_racks = topologyData.options.group_racks
    const group_virtualchassis = topologyData.options.group_virtualchassis

    const gridSize = parseInt(topologyData.options.grid_size[0]);
    var dragMode = false;

    graph = new Network(container, { nodes, edges }, options)
    graph.fit()

    // ---- Connection-type legend with per-type visibility toggles ----

    // Metadata for each known connection type: label, edge color, SVG dash pattern, stroke width.
    // Dash patterns mirror the vis-network dashes arrays used in create_edge() on the backend.
    const CONNECTION_TYPE_META = {
        cable:      { label: 'Physical Cable',          color: '#2b7ce9', dash: null,      width: 2 },
        circuit:    { label: 'Circuit',                 color: '#2b7ce9', dash: '6,3',     width: 2 },
        isp:        { label: 'ISP / Provider Network',  color: '#9c27b0', dash: '6,3',     width: 2 },
        wireless:   { label: 'Wireless',                color: '#2b7ce9', dash: '2,8',     width: 2 },
        power:      { label: 'Power',                   color: '#2b7ce9', dash: '5,4,3,4', width: 2 },
        logical:    { label: 'Logical Connection',      color: '#f1c232', dash: '1,8',     width: 3 },
        arp_ghost:  { label: 'L2 Visible (no cable)',   color: '#FF8C00', dash: '4,5,4,5', width: 2 },
        vm_host:    { label: 'VM Hosted On',             color: '#4CAF50', dash: '5,3',     width: 1 },
        l3_prefix:  { label: 'L3 Subnet',               color: '#4CAF50', dash: null,      width: 1 },
    }

    // Discover which types are actually present in this topology
    const presentConnectionTypes = new Set()
    for (let [, edge] of edges._data) {
        if (edge.connection_type) presentConnectionTypes.add(edge.connection_type)
    }

    // Show/hide all edges of a given connection_type
    window.toggleConnectionType = function toggleConnectionType(type, visible) {
        const updates = []
        for (let [id, edge] of edges._data) {
            if (edge.connection_type === type) {
                updates.push({ id, hidden: !visible })
            }
        }
        edges.update(updates)
    }

    // Build the legend DOM only when there is at least one typed edge
    if (presentConnectionTypes.size > 0) {
        const legend = document.createElement('div')
        legend.id = 'connection-legend'
        legend.className = 'connection-legend card'

        const legendTitle = document.createElement('div')
        legendTitle.className = 'connection-legend-title'
        legendTitle.textContent = 'Connection Types'
        legend.appendChild(legendTitle)

        function makeLegendSVG(meta) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            svg.setAttribute('width', '38')
            svg.setAttribute('height', '12')
            svg.style.flexShrink = '0'
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
            line.setAttribute('x1', '1');  line.setAttribute('y1', '6')
            line.setAttribute('x2', '37'); line.setAttribute('y2', '6')
            line.setAttribute('stroke', meta.color)
            line.setAttribute('stroke-width', String(meta.width))
            if (meta.dash) line.setAttribute('stroke-dasharray', meta.dash)
            svg.appendChild(line)
            return svg
        }

        const TYPE_ORDER = ['cable', 'circuit', 'isp', 'wireless', 'power', 'logical', 'arp_ghost', 'vm_host', 'l3_prefix']
        for (const type of TYPE_ORDER) {
            if (!presentConnectionTypes.has(type)) continue
            const meta = CONNECTION_TYPE_META[type]

            const row = document.createElement('label')
            row.className = 'connection-legend-row'

            const cb = document.createElement('input')
            cb.type = 'checkbox'
            cb.checked = true
            cb.addEventListener('change', () => window.toggleConnectionType(type, cb.checked))

            const text = document.createElement('span')
            text.textContent = meta.label

            row.appendChild(cb)
            row.appendChild(makeLegendSVG(meta))
            row.appendChild(text)
            legend.appendChild(row)
        }

        // The legend lives inside the graph container so it scrolls/resizes with it
        container.style.position = 'relative'
        container.appendChild(legend)

        // Refresh SVG stroke colors when the NetBox theme changes
        const legendObserver = new MutationObserver(() => {
            // Currently all types share the same base color so no update needed,
            // but this hook is here for future per-theme color overrides.
        })
        legendObserver.observe(document.documentElement, {
            attributes: true, attributeFilter: ['data-bs-theme']
        })
    }

    // ---- Real-time device status overlay (InfluxDB/Collectd) ----
    if (typeof influxdbConfigured !== 'undefined' && influxdbConfigured && typeof alertStatusUrl !== 'undefined') {
        const STATUS_COLORS = {
            online:  { border: '#4CAF50', background: '#E8F5E9', highlight: { border: '#1B5E20', background: '#C8E6C9' } },
            offline: { border: '#f44336', background: '#FFEBEE', highlight: { border: '#B71C1C', background: '#FFCDD2' } },
        }

        // Map node name → node id for quick lookup
        const nameToNodeId = {}
        for (let [id, node] of nodes._data) {
            if (node.name) nameToNodeId[node.name] = id
        }

        // Store original border colors so we can restore them when a device comes back
        const originalColors = {}

        // Status badge element in top-right of graph
        const statusBadge = document.createElement('div')
        statusBadge.id = 'alert-status-badge'
        statusBadge.style.cssText =
            'position:absolute;top:12px;right:12px;z-index:20;padding:4px 10px;' +
            'border-radius:4px;font-size:12px;font-weight:600;pointer-events:none;' +
            'background:#6c757d;color:#fff;'
        statusBadge.textContent = 'Status: loading…'
        container.style.position = 'relative'
        container.appendChild(statusBadge)

        async function refreshAlertStatus() {
            try {
                const resp = await fetch(alertStatusUrl)
                if (!resp.ok) return
                const data = await resp.json()
                if (!data.configured) {
                    statusBadge.style.display = 'none'
                    return
                }
                if (data.error) {
                    statusBadge.textContent = 'Status: error'
                    statusBadge.style.background = '#dc3545'
                    return
                }

                const activeSet = new Set((data.active_hosts || []).map(h => h.toLowerCase()))
                const staleMin  = data.stale_minutes || 15
                const updates   = []
                let offlineCount = 0

                for (let [id, node] of nodes._data) {
                    if (!node.name || node.ghost) continue
                    const nameLower = node.name.toLowerCase()
                    // Also try matching on just the hostname part (strip domain)
                    const shortName = nameLower.split('.')[0]
                    const isOnline  = activeSet.has(nameLower) || activeSet.has(shortName)

                    if (!isOnline) {
                        if (!originalColors[id]) originalColors[id] = node.color || null
                        updates.push({ id, color: STATUS_COLORS.offline })
                        offlineCount++
                    } else {
                        if (originalColors[id] !== undefined) {
                            updates.push({ id, color: originalColors[id] })
                            delete originalColors[id]
                        }
                    }
                }

                if (updates.length > 0) nodes.update(updates)

                if (offlineCount > 0) {
                    statusBadge.textContent = `${offlineCount} offline (>${staleMin}m silent)`
                    statusBadge.style.background = '#dc3545'
                } else {
                    statusBadge.textContent = 'All devices online'
                    statusBadge.style.background = '#198754'
                }
            } catch (_) {
                statusBadge.textContent = 'Status: unavailable'
                statusBadge.style.background = '#6c757d'
            }
        }

        refreshAlertStatus()
        setInterval(refreshAlertStatus, 60_000)
    }

    // ================================================================
    // View Type Overlay System
    // Applies colour overlays to nodes based on different data sources.
    // Physical (default), Device Status, Platform, Tenant, CPU Metrics,
    // and Vulnerability views are built in.
    // ================================================================
    ;(function initViewTypes() {

        // --- Colour palette for hashed string → colour (platform, tenant) ---
        const PALETTE = [
            '#2196F3', '#4CAF50', '#FF9800', '#9C27B0', '#F44336',
            '#00BCD4', '#8BC34A', '#FF5722', '#3F51B5', '#E91E63',
            '#009688', '#795548', '#607D8B', '#FF4081', '#1565C0',
        ]

        const STATUS_COLORS = {
            active:          '#4CAF50',
            planned:         '#9E9E9E',
            staged:          '#2196F3',
            inventory:       '#00BCD4',
            decommissioning: '#FF9800',
            offline:         '#f44336',
            failed:          '#B71C1C',
        }

        const VULN_COLORS = {
            critical: '#B71C1C',
            high:     '#f44336',
            medium:   '#FF9800',
            low:      '#FFC107',
            none:     '#4CAF50',
            info:     '#2196F3',
        }

        // --- Colour helpers ---

        // Build a vis-network colour object from a single border hex.
        // Background is blended 25% toward white; highlight border is darkened.
        function makeColor(borderHex) {
            if (!borderHex || borderHex === 'undefined') return null
            const r = parseInt(borderHex.slice(1, 3), 16)
            const g = parseInt(borderHex.slice(3, 5), 16)
            const b = parseInt(borderHex.slice(5, 7), 16)
            const blend = (c, f) => Math.round(c * f + 255 * (1 - f)).toString(16).padStart(2, '0')
            const darken = (c)  => Math.round(c * 0.65).toString(16).padStart(2, '0')
            return {
                border:     borderHex,
                background: '#' + [r, g, b].map(c => blend(c, 0.22)).join(''),
                highlight: {
                    border:     '#' + [r, g, b].map(c => darken(c)).join(''),
                    background: '#' + [r, g, b].map(c => blend(c, 0.35)).join(''),
                },
            }
        }

        // Grade a 0-100 percentage into a traffic-light colour
        function gradeColor(pct) {
            if (pct === null || pct === undefined) return '#9E9E9E'
            if (pct < 60) return '#4CAF50'
            if (pct < 80) return '#FFC107'
            if (pct < 90) return '#FF9800'
            return '#f44336'
        }

        // Stable string → palette index
        function hashIdx(str) {
            let h = 0
            for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
            return Math.abs(h) % PALETTE.length
        }

        // CVSS score → severity bucket
        function scoreToSev(score) {
            if (!score && score !== 0) return 'unknown'
            if (score >= 9.0) return 'critical'
            if (score >= 7.0) return 'high'
            if (score >= 4.0) return 'medium'
            if (score >  0)   return 'low'
            return 'none'
        }

        // --- Store original node colours once (before any overlay) ---
        const originalColors = {}
        for (const [id, node] of nodes._data) {
            originalColors[id] = node.color !== undefined ? node.color : null
        }

        // Remote data cache keyed by view type
        const dataCache = {}

        // The current view legend element (right side of graph)
        let viewLegendEl = null

        // --- Build view legend (right side) ---
        function buildViewLegend(items, title) {
            if (viewLegendEl) { viewLegendEl.remove(); viewLegendEl = null }
            if (!items || items.length === 0) return

            viewLegendEl = document.createElement('div')
            viewLegendEl.className = 'view-legend card'

            const titleEl = document.createElement('div')
            titleEl.className = 'view-legend-title'
            titleEl.textContent = title
            viewLegendEl.appendChild(titleEl)

            for (const { label, color } of items) {
                const row = document.createElement('div')
                row.className = 'view-legend-row'
                const swatch = document.createElement('span')
                swatch.className = 'view-legend-swatch'
                swatch.style.background = color
                const text = document.createElement('span')
                text.textContent = label
                row.appendChild(swatch)
                row.appendChild(text)
                viewLegendEl.appendChild(row)
            }

            container.style.position = 'relative'
            container.appendChild(viewLegendEl)
        }

        // --- Apply a colour mapper to all non-ghost nodes ---
        function applyOverlay(mapper) {
            const updates = []
            for (const [id, node] of nodes._data) {
                if (node.ghost) continue
                const color = mapper(node)
                updates.push({ id, color: color !== undefined ? color : originalColors[id] })
            }
            nodes.update(updates)
        }

        // ---- Individual view type implementations ----

        function applyPhysical() {
            applyOverlay(node => originalColors[node.id])
            buildViewLegend(null, '')
        }

        function applyDeviceStatus() {
            applyOverlay(node => {
                const base = STATUS_COLORS[node.device_status] || '#9E9E9E'
                return makeColor(base)
            })
            const legendItems = [
                ...Object.entries(STATUS_COLORS).map(([k, c]) => ({
                    label: k.charAt(0).toUpperCase() + k.slice(1), color: c
                })),
                { label: 'Unknown', color: '#9E9E9E' },
            ]
            buildViewLegend(legendItems, 'Device Status')
        }

        function applyPlatform() {
            const slugColors = {}
            for (const [, node] of nodes._data) {
                if (node.platform_slug && !(node.platform_slug in slugColors))
                    slugColors[node.platform_slug] = PALETTE[hashIdx(node.platform_slug)]
            }
            applyOverlay(node => {
                const base = node.platform_slug ? (slugColors[node.platform_slug] || '#9E9E9E') : '#9E9E9E'
                return makeColor(base)
            })
            const legendItems = Object.entries(slugColors)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([slug, color]) => ({ label: slug || '(none)', color }))
            legendItems.push({ label: '(no platform)', color: '#9E9E9E' })
            buildViewLegend(legendItems, 'Platform / OS')
        }

        function applyTenant() {
            const slugColors = {}
            for (const [, node] of nodes._data) {
                if (node.tenant_slug && !(node.tenant_slug in slugColors))
                    slugColors[node.tenant_slug] = PALETTE[hashIdx(node.tenant_slug)]
            }
            applyOverlay(node => {
                const base = node.tenant_slug ? (slugColors[node.tenant_slug] || '#9E9E9E') : '#9E9E9E'
                return makeColor(base)
            })
            const legendItems = Object.entries(slugColors)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([slug, color]) => ({ label: slug, color }))
            legendItems.push({ label: '(no tenant)', color: '#9E9E9E' })
            buildViewLegend(legendItems, 'Tenant')
        }

        async function applyMetricsCPU() {
            let data = dataCache['metrics_cpu']
            if (!data) {
                try {
                    const resp = await fetch(metricsUrl + '?type=cpu')
                    data = await resp.json()
                    dataCache['metrics_cpu'] = data
                } catch (_) { data = { configured: false } }
            }
            if (!data.configured) {
                buildViewLegend([{ label: 'InfluxDB not configured', color: '#9E9E9E' }], 'CPU Metrics')
                applyOverlay(() => makeColor('#9E9E9E'))
                return
            }
            if (data.error) {
                buildViewLegend([{ label: 'Query error — check console', color: '#9E9E9E' }], 'CPU Metrics')
                return
            }
            const metrics = data.metrics || {}
            applyOverlay(node => {
                if (!node.name) return undefined
                // try full name, then short hostname
                const entry = metrics[node.name] || metrics[node.name.split('.')[0]]
                return makeColor(gradeColor(entry ? entry.cpu_pct : null))
            })
            buildViewLegend([
                { label: '< 60%  — normal',   color: '#4CAF50' },
                { label: '60–80% — elevated', color: '#FFC107' },
                { label: '80–90% — high',     color: '#FF9800' },
                { label: '> 90%  — critical', color: '#f44336' },
                { label: 'No data',           color: '#9E9E9E' },
            ], 'CPU Utilisation')
        }

        async function applyVulnerability() {
            // First check if custom-field data was embedded directly in nodes
            let hasEmbedded = false
            for (const [, node] of nodes._data) {
                if (node.vuln_score !== undefined || node.vuln_severity !== undefined) {
                    hasEmbedded = true; break
                }
            }

            let devData = {}
            if (hasEmbedded) {
                // Use the per-node data already sent from the backend
                for (const [, node] of nodes._data) {
                    if (node.name && (node.vuln_score !== undefined || node.vuln_severity !== undefined)) {
                        devData[node.name] = { score: node.vuln_score, severity: node.vuln_severity }
                    }
                }
            } else {
                let data = dataCache['vulnerability']
                if (!data) {
                    try {
                        const resp = await fetch(vulnUrl)
                        data = await resp.json()
                        dataCache['vulnerability'] = data
                    } catch (_) { data = { configured: false } }
                }
                if (!data.configured) {
                    buildViewLegend([{ label: 'Configure vuln_cf_score / vuln_cf_severity in PLUGINS_CONFIG', color: '#9E9E9E' }], 'Vulnerability')
                    applyOverlay(() => makeColor('#9E9E9E'))
                    return
                }
                if (data.error) {
                    buildViewLegend([{ label: 'Query error', color: '#9E9E9E' }], 'Vulnerability')
                    return
                }
                devData = data.devices || {}
            }

            applyOverlay(node => {
                if (!node.name) return undefined
                const entry = devData[node.name]
                const sev = entry
                    ? (entry.severity || scoreToSev(entry.score))
                    : 'unknown'
                return makeColor(VULN_COLORS[sev] || '#9E9E9E')
            })
            buildViewLegend([
                { label: 'Critical  (CVSS ≥ 9.0)', color: '#B71C1C' },
                { label: 'High      (CVSS 7–9)',    color: '#f44336' },
                { label: 'Medium    (CVSS 4–7)',    color: '#FF9800' },
                { label: 'Low       (CVSS < 4)',    color: '#FFC107' },
                { label: 'None / clean',            color: '#4CAF50' },
                { label: 'No data',                 color: '#9E9E9E' },
            ], 'Vulnerability')
        }

        // --- Dispatch ---
        const VIEW_LABELS = {
            physical:      'Default',
            device_status: 'Device Status',
            platform:      'Platform / OS',
            tenant:        'Tenant',
            metrics_cpu:   'Metrics: CPU',
            vulnerability: 'Vulnerability',
        }

        window.setViewType = async function setViewType(viewType) {
            document.querySelectorAll('.view-type-btn').forEach(el =>
                el.classList.toggle('active', el.dataset.view === viewType)
            )
            const btn = document.getElementById('btnViewType')
            if (btn) btn.innerHTML = `<i class="mdi mdi-layers-outline"></i> View: ${VIEW_LABELS[viewType] || viewType}`

            if      (viewType === 'physical')      applyPhysical()
            else if (viewType === 'device_status') applyDeviceStatus()
            else if (viewType === 'platform')      applyPlatform()
            else if (viewType === 'tenant')        applyTenant()
            else if (viewType === 'metrics_cpu')   await applyMetricsCPU()
            else if (viewType === 'vulnerability') await applyVulnerability()
        }

        // Wire up dropdown
        document.addEventListener('click', e => {
            const btn = e.target.closest('.view-type-btn')
            if (!btn) return
            e.preventDefault()
            window.setViewType(btn.dataset.view)
        })

        // Allow external cache invalidation (force re-fetch metrics/vuln data)
        window.invalidateViewCache = function(viewType) {
            if (viewType) delete dataCache[viewType]
            else Object.keys(dataCache).forEach(k => delete dataCache[k])
        }

    })()

    function getGridPosition(nodeId, gridSize) {
        x = graph.getPosition(nodeId).x;
        y = graph.getPosition(nodeId).y;

        if(x >= 0) {
            if((x % gridSize) > (gridSize / 2)) {
                x += gridSize;
            }
        }
        else {
            if((-x % gridSize) > (gridSize / 2)) {
                x -= gridSize;
            }
        }
        x = x - x % gridSize;

        if(y >= 0) {
            if((y % gridSize) > (gridSize / 2)) {
                y += gridSize;
            }
        }
        else {
            if((-y % gridSize) > (gridSize / 2)) {
                y -= gridSize;
            }
        }
        y = y - y % gridSize;    

        return {
            x: x,
            y: y
        };
    }

    function drawGrid(canvascontext) {
        // Canvas can be zoomed. It then contains more or less virtual pixels than the real number of pixels
        const zoomFactor = graph.getScale() * window.devicePixelRatio;
        const virtualWidth = canvascontext.canvas.width / zoomFactor;
        const virtualHeight = canvascontext.canvas.height / zoomFactor;

        // Canvas can be moved. Get the center of the virtual canvas. Take the grid into account
        const virtualCenter = graph.getViewPosition();
        const rasterizedCenterX = virtualCenter.x - virtualCenter.x % gridSize;
        const rasterizedCenterY = virtualCenter.y - virtualCenter.y % gridSize;

        // Calculate virtual space for the grid
        const hSpace = (virtualWidth / 2) - (virtualWidth / 2) % gridSize + gridSize;
        const vSpace = (virtualHeight / 2) - (virtualHeight / 2) % gridSize + gridSize;

        // Calculate virtual position for the grid
        const left = rasterizedCenterX - gridSize - hSpace;
        const right = rasterizedCenterX + gridSize + hSpace;
        const top = rasterizedCenterY - gridSize - vSpace;
        const bottom = rasterizedCenterY + gridSize + vSpace;

        // Draw grid
        canvascontext.beginPath();

        for (let x = left; x < right; x += gridSize) {
            canvascontext.moveTo(x, top);
            canvascontext.lineTo(x, bottom);
        }

        for (let y = top; y < bottom; y += gridSize) {
            canvascontext.moveTo(left, y);
            canvascontext.lineTo(right, y);
        }

        canvascontext.strokeStyle = '#777777';
        canvascontext.stroke();        
    }

    function drawGridSnapHint(canvascontext) {
        // Draw grid hinting line and circle
        if(gridSize > 0 && dragMode == true && graph.getSelectedNodes().length > 0) {
            for(i = 0; i < graph.getSelectedNodes().length; i++) {
                id = graph.getSelectedNodes()[i];
                if(window.nodes.get(id).x != graph.getPosition(id).x || window.nodes.get(id).y != graph.getPosition(id).y) {
                    pos = getGridPosition(graph.getSelectedNodes()[i], gridSize);

                    canvascontext.beginPath();
                    canvascontext.arc(graph.getPosition(graph.getSelectedNodes()[i]).x, graph.getPosition(graph.getSelectedNodes()[i]).y, 5, 0, 2 * Math.PI);
                    canvascontext.fillStyle = '#FF3D3D';
                    canvascontext.fill();

                    canvascontext.beginPath();
                    canvascontext.moveTo(graph.getPosition(graph.getSelectedNodes()[i]).x, graph.getPosition(graph.getSelectedNodes()[i]).y);
                    canvascontext.lineTo(pos.x, pos.y);
                    canvascontext.strokeStyle = '#FF3D3D';
                    canvascontext.stroke();
        
                    canvascontext.beginPath();
                    canvascontext.arc(pos.x, pos.y, 10, 0, 2 * Math.PI);
                    canvascontext.fillStyle = '#9C0000';
                    canvascontext.fill();
                }
            }
        }
    }

    graph.on('dragStart', (params) => {
        dragMode = true;
    })

    graph.on('dragEnd', (params) => {
        dragMode = false;
        // Place icon on the grid
        if(gridSize > 0 && graph.getSelectedNodes().length > 0) {
            for(i = 0; i < graph.getSelectedNodes().length; i++) {
                id = graph.getSelectedNodes()[i];
                if(window.nodes.get(id).x != graph.getPosition(id).x || window.nodes.get(id).y != graph.getPosition(id).y) {
                    pos = getGridPosition(graph.getSelectedNodes()[i], gridSize);
                    window.nodes.update({id: graph.getSelectedNodes()[i], x: pos.x, y: pos.y});
                }
            }
        }

        if (coordSaveCheckbox.options[coordSaveCheckbox.selectedIndex].text != "Yes") return

        Promise.allSettled(
            Object.entries(graph.getPositions(params.nodes)).map(
                async ([nodeId, nodePosition]) => {
                    if(!isNaN(parseInt(nodeId))) { 
                        nodeKey = parseInt(nodeId);
                    }
                    else {
                        nodeKey = nodeId;
                    }

                    try {
                        window.nodes.update({id: nodeKey, physics: false, x: nodePosition.x, y: nodePosition.y});
                    }
                    catch (e) {
                        console.log([
                            'Error while executing window.nodes.update()', 
                            'nodeId: ' + nodeId, 
                            'nodeKey: ' + nodeKey, 
                            'x: ' + nodePosition.x, 
                            'y: ' + nodePosition.y
                        ]);
                        console.log(e);
                    }
                    const res = await fetch(
                        '/' + basePath + 'api/plugins/netbox_topology_views/save-coords/save_coords/',
                        {
                            method: 'PATCH',
                            headers: {
                                'X-CSRFToken': window.CSRF_TOKEN,
                                Accept: 'application/json',
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                node_id: nodeId,
                                x: nodePosition.x,
                                y: nodePosition.y,
                                group: topologyData.group
                            })
                        }
                    )
                }
            )
        )
    })

    graph.on('doubleClick', (params) => {
        if (params.nodes.length > 0) {
            params.nodes.forEach((node) => {
                window.open(nodes.get(node).href, '_blank')
            })
        }
        else {
            params.edges.forEach((edge) => {
                window.open(edges.get(edge).href, '_blank')
            })
        }
    })

    graph.on('beforeDrawing', (canvascontext) => {
        if (gridSize > 0) {
            drawGrid(canvascontext);
        }
    })

    graph.on('afterDrawing', (canvascontext) => {
        allRectangles = [];
        if(group_sites != null && group_sites == 'on') { drawGroupRectangles(canvascontext, groupedNodeSites, siteRectParams); }
        if(group_locations != null && group_locations == 'on') { drawGroupRectangles(canvascontext, groupedNodeLocations, locationRectParams); }
        if(group_racks != null && group_racks == 'on') { drawGroupRectangles(canvascontext, groupedNodeRacks, rackRectParams); }
        if(group_virtualchassis != null && group_virtualchassis == 'on') { drawGroupRectangles(canvascontext, groupedNodeVirtualchassis, virtualchassisRectParams); }
 
        drawGridSnapHint(canvascontext);
    })

    graph.on('click', (canvascontext) => {
        allRectangles.forEach(key => {
            // Is the mouse pointer inside of the current rectangle?
            if(canvascontext.pointer.canvas.x > (key.x1 - key.border / 2 - 3) && canvascontext.pointer.canvas.x < (key.x2 + key.border / 2 + 3)
                && canvascontext.pointer.canvas.y > (key.y1 - key.border / 2 - 3) && canvascontext.pointer.canvas.y < (key.y2 + key.border / 2 + 3)) {
                // We just want to react when the border has been clicked, not the whole rectangle
                if (canvascontext.pointer.canvas.x < (key.x1 + key.border / 2 + 3) || canvascontext.pointer.canvas.x > (key.x2 - key.border / 2 - 3)
                    || canvascontext.pointer.canvas.y < (key.y1 + key.border / 2 + 3) || canvascontext.pointer.canvas.y > (key.y2 - key.border / 2 - 3)) {
                    // Generate an array of affected nodes in order to pass it to the select.Nodes() function
                    let arr = [];
                    if(key.category == "Site") {
                        groupedNodeSites.forEach(subArray => {
                            subArray.forEach(element => {
                                if (element[1] == key.id) {
                                    arr.push(element[0]);
                                }
                            });
                        });
                    }
                    if(key.category == "Location") {
                        groupedNodeLocations.forEach(subArray => {
                            subArray.forEach(element => {
                                if (element[1] === key.id) {
                                    arr.push(element[0]);
                                }
                            });
                        });
                    }
                    if(key.category == "Rack") {
                        groupedNodeRacks.forEach(subArray => {
                            subArray.forEach(element => {
                                if (element[1] === key.id) {
                                    arr.push(element[0]);
                                }
                            });
                        });
                    }
                    if(key.category == "Virtual Chassis") {
                        groupedNodeVirtualchassis.forEach(subArray => {
                            subArray.forEach(element => {
                                if (element[1] === key.id) {
                                    arr.push(element[0]);
                                }
                            });
                        });
                    }
                    graph.selectNodes(arr);
                }
            }
        });
    })

    // Add information on which node belongs to which group (site/location/rack/virtualchassis).
    // Create an array for each group in order to loop through that arrays later
    function combineNodeInfo(typeId, type) {
        let nodesArray = [];
        // Extract node ids and node type ids from all nodes
        for (let [key, value] of nodes._data) {
            if (value[typeId] != undefined) {
                nodesArray.push([value.id, value[typeId], value[type], value.label_num_lines]);
            }
        }
        // Split single array above into arrays grouped by node id
        let groupedNodeArray = nodesArray.reduce((acc, value) => {
            let key = value[1]; // node id
            acc[key] = acc[key] || [];
            acc[key].push(value);
            return acc;
        }, {});

        return Object.values(groupedNodeArray);
    }

    var allRectangles = [];
    /* Draw a single rectangle with given parameters
        rectangle expects an object that consists of the following keys:
        ctx: canvas context on which the rectangle should be drawn
        x: x-coordinate of top left point of the rectangle
        y: y-coordinate of top left point of the rectangle 
        width: width of rectangle 
        height: height of rectangle 
        lineWidth: border width 
        color: border color 
        text: a string to be placed where you want it to be
        textPaddingX: x-position of the text 
        textPaddingY: y-position of the text
        font: text font */
    function drawGroupRectangle(rectangle) {
        // Draw rectangle
        rectangle.ctx.beginPath();
        rectangle.ctx.lineWidth = rectangle.lineWidth;
        rectangle.ctx.strokeStyle = rectangle.color;
        rectangle.ctx.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
        rectangle.ctx.stroke();
        // Draw text
        rectangle.ctx.font = rectangle.font;
        rectangle.ctx.fillStyle = rectangle.color;
        rectangle.ctx.fillText(rectangle.text, rectangle.x + rectangle.textPaddingX, rectangle.y + rectangle.textPaddingY); 

        allRectangles.push({category: rectangle.category, id: rectangle.id, x1: rectangle.x, y1: rectangle.y, x2: rectangle.x + rectangle.width, y2: rectangle.y + rectangle.height, border: rectangle.lineWidth})
    }

    /* Draw all rectangles of a given group (site/location//virtualchassis)
        rectParams expects an object that consists of the following keys:
        lineWidth: border width (string)
        color: border color (string)
        paddingX: rectangle x-padding, calculated from the center of a node (int)
        paddingY: rectangle y-padding, calculated from the center of a node (int)
        textPaddingX: text x-padding, calculated from the lower left point of the text (int)
        textPaddingY: text y-padding, calculated from the lower left point of the text (int)
        font: css-like font size and font (string) */
    function drawGroupRectangles(canvascontext, groupedNodes, rectParams) {
        for(let value of Object.entries(groupedNodes)) { 
            const rectangles = [];
            const xValues = [];
            const yValues = [];
            const yValuesWithLabel = [];
            const labelLineHeight = 16;

            // Get coordinates for every node in a given group
            for(let val of value[1]) {
                xValues.push(graph.getPosition(val[0]).x);
                yValues.push(graph.getPosition(val[0]).y);
                yValuesWithLabel.push(yValues[yValues.length -1] + val[3] * labelLineHeight);
            }

            const minX = Math.min(...xValues);
            const maxX = Math.max(...xValues);
            const minY = Math.min(...yValues);
            const maxY = Math.max(...yValuesWithLabel);
            const rectX = minX - rectParams.paddingX;
            const rectY = minY - rectParams.paddingY;
            const rectSizeX = maxX - minX + 2*rectParams.paddingX;
            const rectSizeY = maxY - minY + 2*rectParams.paddingY;

            rectangles.push({
                ctx: canvascontext, 
                x: rectX, 
                y: rectY, 
                width: rectSizeX, 
                height: rectSizeY, 
                lineWidth: rectParams.lineWidth, 
                color: rectParams.color, 
                text: value[1][0][2], 
                textPaddingX: rectParams.textPaddingX, 
                textPaddingY: rectParams.textPaddingY, 
                font: rectParams.font,
                id: value[1][0][1],
                category: rectParams.category
            });

            rectangles.forEach(function(rectangle) {
                drawGroupRectangle(rectangle);
            });
        }
    }

    // ---- Physics-engine layouts ----
    //
    // These functions apply a vis-network solver and leave physics running so
    // the user can interact with the live simulation.  Parameters are read from
    // window.physicsSettings, which the Physics Settings panel updates in real
    // time via applyPhysicsSettings().

    // Default parameters – populated once; the settings panel updates them.
    window.physicsSettings = window.physicsSettings || {
        solver:                'forceAtlas2Based',
        springLength:          150,
        springConstant:        0.05,
        damping:               0.09,
        gravitationalConstant: -800,
        centralGravity:        0.01,
        levelSeparation:       150,
        nodeSpacing:           120,
        sortMethod:            'hubsize',
        groupMargin:           60,
    }

    // Re-enable physics on every node so the active solver can move them.
    function releaseAllNodes() {
        nodes.update([...nodes._data.keys()].map(id => ({ id, physics: true })))
    }

    // Build the physics options block for the current settings and solver.
    function buildPhysicsOptions(solver) {
        const s = window.physicsSettings
        const base = {
            enabled: true,
            solver,
            stabilization: { enabled: false },
        }
        if (solver === 'forceAtlas2Based') {
            base.forceAtlas2Based = {
                gravitationalConstant: s.gravitationalConstant,
                centralGravity:        s.centralGravity,
                springLength:          s.springLength,
                springConstant:        s.springConstant,
                damping:               s.damping,
            }
        } else if (solver === 'barnesHut') {
            base.barnesHut = {
                gravitationalConstant: s.gravitationalConstant,
                centralGravity:        s.centralGravity,
                springLength:          s.springLength,
                springConstant:        s.springConstant,
                damping:               s.damping,
            }
        } else if (solver === 'repulsion') {
            base.repulsion = {
                centralGravity:  s.centralGravity,
                nodeDistance:    Math.abs(s.gravitationalConstant) / 10,
                springLength:    s.springLength,
                springConstant:  s.springConstant,
                damping:         s.damping,
            }
        } else if (solver === 'hierarchicalRepulsion') {
            base.hierarchicalRepulsion = {
                nodeDistance:   s.nodeSpacing,
                springLength:   s.springLength,
                springConstant: s.springConstant,
                damping:        s.damping,
            }
        }
        return base
    }

    // Run stabilization then stop physics — useful after complex rearrangements.
    window.stabilizeNow = function stabilizeNow() {
        const btn = document.getElementById('btnStabilizeNow')
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="mdi mdi-loading mdi-spin"></i> Stabilizing…' }
        const s = window.physicsSettings
        graph.setOptions({ physics: { ...buildPhysicsOptions(s.solver), stabilization: { enabled: true, iterations: 500 } } })
        graph.stabilize(500)
        graph.once('stabilizationIterationsDone', () => {
            graph.setOptions({ physics: { stabilization: { enabled: false } } })
            graph.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } })
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="mdi mdi-play"></i> Stabilize' }
        })
    }

    // Apply one of the force-directed solvers and let physics run freely.
    // solver: 'forceAtlas2Based' | 'barnesHut' | 'repulsion'
    window.physicsLayout = function physicsLayout(solver) {
        window.physicsSettings.solver = solver
        releaseAllNodes()
        graph.setOptions({
            layout: { hierarchical: { enabled: false } },
            physics: buildPhysicsOptions(solver),
        })
        graph.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } })
    }

    // Apply vis-network's hierarchical layout with live physics.
    // direction: 'UD' | 'DU' | 'LR' | 'RL'
    window.hierarchicalLayout = function hierarchicalLayout(direction) {
        const s = window.physicsSettings
        window.physicsSettings.solver = 'hierarchicalRepulsion'
        releaseAllNodes()
        graph.setOptions({
            layout: {
                hierarchical: {
                    enabled:             true,
                    direction,
                    sortMethod:          s.sortMethod,
                    levelSeparation:     s.levelSeparation,
                    nodeSpacing:         s.nodeSpacing,
                    treeSpacing:         s.nodeSpacing * 2,
                    blockShifting:       true,
                    edgeMinimization:    true,
                    parentCentralization: true,
                },
            },
            physics: buildPhysicsOptions('hierarchicalRepulsion'),
        })
        graph.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } })
    }

    // Re-apply current solver settings without changing the solver or layout.
    // Called by the Physics Settings panel whenever a parameter changes.
    window.applyPhysicsSettings = function applyPhysicsSettings() {
        const s = window.physicsSettings
        graph.setOptions({ physics: buildPhysicsOptions(s.solver) })
    }

    // ---- Separate overlapping group bounding boxes ----
    // Moves nodes so that sibling groups of the same type (sites vs sites,
    // locations vs locations, etc.) no longer overlap each other.
    window.separateGroups = function separateGroups() {
        graph.setOptions({ physics: { enabled: false } })
        const MARGIN = window.physicsSettings.groupMargin

        const nodeOffsets = {} // nodeId -> {dx, dy}
        function addOffset(id, dx, dy) {
            if (!nodeOffsets[id]) nodeOffsets[id] = { dx: 0, dy: 0 }
            nodeOffsets[id].dx += dx
            nodeOffsets[id].dy += dy
        }

        function separateGroupSet(groupedNodes, rectParams) {
            const groups = []
            for (const [, members] of Object.entries(groupedNodes)) {
                const nodeIds = members.map(m => m[0])
                const positions = graph.getPositions(nodeIds)
                const xs = [], ys = []
                for (const id of nodeIds) {
                    const p = positions[id]
                    if (p) { xs.push(p.x); ys.push(p.y) }
                }
                if (xs.length === 0) continue
                groups.push({
                    nodeIds,
                    x1: Math.min(...xs) - rectParams.paddingX,
                    y1: Math.min(...ys) - rectParams.paddingY,
                    x2: Math.max(...xs) + rectParams.paddingX,
                    y2: Math.max(...ys) + rectParams.paddingY,
                    dx: 0, dy: 0,
                })
            }

            for (let iter = 0; iter < 300; iter++) {
                let changed = false
                for (let i = 0; i < groups.length; i++) {
                    for (let j = i + 1; j < groups.length; j++) {
                        const a = groups[i], b = groups[j]
                        // ox/oy > 0 means overlapping; include MARGIN so groups stay MARGIN apart
                        const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) + MARGIN
                        const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) + MARGIN
                        if (ox <= 0 || oy <= 0) continue
                        changed = true
                        let mdx = 0, mdy = 0
                        if (ox <= oy) {
                            mdx = (ox / 2 + 1) * ((a.x1 + a.x2) < (b.x1 + b.x2) ? -1 : 1)
                        } else {
                            mdy = (oy / 2 + 1) * ((a.y1 + a.y2) < (b.y1 + b.y2) ? -1 : 1)
                        }
                        a.x1 += mdx; a.x2 += mdx; a.dx += mdx
                        a.y1 += mdy; a.y2 += mdy; a.dy += mdy
                        b.x1 -= mdx; b.x2 -= mdx; b.dx -= mdx
                        b.y1 -= mdy; b.y2 -= mdy; b.dy -= mdy
                    }
                }
                if (!changed) break
            }

            for (const g of groups) {
                if (g.dx !== 0 || g.dy !== 0) {
                    for (const id of g.nodeIds) addOffset(id, g.dx, g.dy)
                }
            }
        }

        if (group_sites === 'on')          separateGroupSet(groupedNodeSites,          siteRectParams)
        if (group_locations === 'on')      separateGroupSet(groupedNodeLocations,      locationRectParams)
        if (group_racks === 'on')          separateGroupSet(groupedNodeRacks,          rackRectParams)
        if (group_virtualchassis === 'on') separateGroupSet(groupedNodeVirtualchassis, virtualchassisRectParams)

        const updates = []
        for (const [id, off] of Object.entries(nodeOffsets)) {
            if (off.dx !== 0 || off.dy !== 0) {
                const pos = graph.getPosition(id)
                updates.push({ id, x: pos.x + off.dx, y: pos.y + off.dy, physics: false })
            }
        }
        if (updates.length > 0) {
            nodes.update(updates)
            graph.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } })
        }
    }

    // ---- Arrange by hierarchy (rack → location → site) ----
    // Places nodes bottom-up by specificity, packing each level tightly to
    // minimise empty space, with at least physicsSettings.groupMargin px between
    // sibling groups at every level.
    window.arrangeByHierarchy = function arrangeByHierarchy() {
        graph.setOptions({ physics: { enabled: false } })

        const MARGIN = window.physicsSettings.groupMargin
        const NODE_SPACING = 80  // tight spacing between nodes within a group

        const updates = []
        function placeNode(id, x, y) { updates.push({ id, x, y, physics: false }) }

        // Simulate row-by-row packing with a fixed column count. Returns {pos,w,h}.
        function simulatePack(items, numCols, gap) {
            let x = 0, y = 0, rowH = 0, col = 0
            const pos = []
            for (let i = 0; i < items.length; i++) {
                pos.push({ x, y })
                rowH = Math.max(rowH, items[i].h)
                if (++col >= numCols) { col = 0; x = 0; y += rowH + gap; rowH = 0 }
                else x += items[i].w + gap
            }
            let mxX = 0, mxY = 0
            pos.forEach((p, i) => { mxX = Math.max(mxX, p.x + items[i].w); mxY = Math.max(mxY, p.y + items[i].h) })
            return { pos, w: mxX || 1, h: mxY || 1 }
        }

        // Pack items [{w,h}] choosing the column count closest to 1:1 aspect ratio.
        function pack(items, gap) {
            if (!items.length) return { pos: [], w: 0, h: 0 }
            let best = null, bestRatio = Infinity
            for (let c = 1; c <= items.length; c++) {
                const r = simulatePack(items, c, gap)
                const ratio = Math.max(r.w / r.h, r.h / r.w)
                if (ratio < bestRatio) { bestRatio = ratio; best = { cols: c, ...r } }
            }
            return best
        }

        // Layout a flat list of nodes in the most square grid possible.
        function layoutNodes(nodeList) {
            const n = nodeList.length
            if (!n) return { w: 0, h: 0, placeAt() {} }
            let bestCols = 1, bestRatio = Infinity
            for (let c = 1; c <= n; c++) {
                const rows = Math.ceil(n / c)
                const w = (Math.min(n, c) - 1) * NODE_SPACING || 1
                const h = (rows - 1) * NODE_SPACING || 1
                const ratio = Math.max(w / h, h / w)
                if (ratio < bestRatio) { bestRatio = ratio; bestCols = c }
            }
            const cols = bestCols
            const rows = Math.ceil(n / cols)
            const w = (Math.min(n, cols) - 1) * NODE_SPACING
            const h = (rows - 1) * NODE_SPACING
            return {
                w, h,
                placeAt(ox, oy) {
                    nodeList.forEach((node, i) => placeNode(node.id,
                        ox + (i % cols) * NODE_SPACING,
                        oy + Math.floor(i / cols) * NODE_SPACING))
                }
            }
        }

        // Layout a mix of sub-layouts and loose nodes into one group.
        // Returns { w, h, placeAt(ox,oy) }
        function layoutGroup(subLayouts, looseNodes) {
            const looseLayout = layoutNodes(looseNodes)
            const all = [...subLayouts, ...(looseNodes.length ? [looseLayout] : [])]
            if (!all.length) return { w: 0, h: 0, placeAt() {} }
            const packed = pack(all.map(a => ({ w: a.w, h: a.h })), MARGIN)
            return {
                w: packed.w,
                h: packed.h,
                placeAt(ox, oy) {
                    all.forEach((layout, i) => layout.placeAt(ox + packed.pos[i].x, oy + packed.pos[i].y))
                }
            }
        }

        const allNodes = [...nodes._data.values()]

        // RACK level
        const rackNodeMap = {}
        const noRackNodes = []
        for (const node of allNodes) {
            if (node.rack_id != null)
                (rackNodeMap[node.rack_id] = rackNodeMap[node.rack_id] || []).push(node)
            else noRackNodes.push(node)
        }
        const rackLayouts = {}
        for (const [rackId, nl] of Object.entries(rackNodeMap))
            rackLayouts[rackId] = layoutNodes(nl)

        // LOCATION level
        const locRackMap = {}, locLooseMap = {}, noLocRacks = [], noLocLoose = []
        for (const [rackId, nl] of Object.entries(rackNodeMap)) {
            const locId = nl[0]?.location_id ?? null
            if (locId != null) (locRackMap[locId] = locRackMap[locId] || []).push(rackId)
            else noLocRacks.push(rackId)
        }
        for (const node of noRackNodes) {
            const locId = node.location_id ?? null
            if (locId != null) (locLooseMap[locId] = locLooseMap[locId] || []).push(node)
            else noLocLoose.push(node)
        }
        const allLocIds = new Set([...Object.keys(locRackMap), ...Object.keys(locLooseMap)])
        const locLayouts = {}
        for (const locId of allLocIds) {
            locLayouts[locId] = layoutGroup(
                (locRackMap[locId] || []).map(rackId => rackLayouts[rackId]),
                locLooseMap[locId] || []
            )
        }

        // SITE level
        const siteLocMap = {}, siteLooseRacks = {}, siteLooseNodes = {}
        const noSiteLocs = [], noSiteRacks = [], noSiteNodes = []
        for (const locId of allLocIds) {
            const racks = locRackMap[locId], looseNodes = locLooseMap[locId]
            const siteId = (racks?.[0] && rackNodeMap[racks[0]]?.[0]?.site_id) ??
                           (looseNodes?.[0]?.site_id) ?? null
            if (siteId != null) (siteLocMap[siteId] = siteLocMap[siteId] || []).push(locId)
            else noSiteLocs.push(locId)
        }
        for (const rackId of noLocRacks) {
            const siteId = rackNodeMap[rackId]?.[0]?.site_id ?? null
            if (siteId != null) (siteLooseRacks[siteId] = siteLooseRacks[siteId] || []).push(rackId)
            else noSiteRacks.push(rackId)
        }
        for (const node of noLocLoose) {
            const siteId = node.site_id ?? null
            if (siteId != null) (siteLooseNodes[siteId] = siteLooseNodes[siteId] || []).push(node)
            else noSiteNodes.push(node)
        }
        const allSiteIds = new Set([...Object.keys(siteLocMap), ...Object.keys(siteLooseRacks), ...Object.keys(siteLooseNodes)])
        const siteLayouts = {}
        for (const siteId of allSiteIds) {
            siteLayouts[siteId] = layoutGroup(
                [
                    ...(siteLocMap[siteId] || []).map(locId => locLayouts[locId]),
                    ...(siteLooseRacks[siteId] || []).map(rackId => rackLayouts[rackId]),
                ],
                siteLooseNodes[siteId] || []
            )
        }

        // TOP LEVEL: pack all sites + unsited items
        const topLayout = layoutGroup(
            [
                ...Object.values(siteLayouts),
                ...noSiteLocs.map(locId => locLayouts[locId]),
                ...noSiteRacks.map(rackId => rackLayouts[rackId]),
            ],
            noSiteNodes
        )
        topLayout.placeAt(0, 0)

        nodes.update(updates)
        setTimeout(() => graph.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } }), 50)
    }

    // ---- Auto Arrange ----
    // Arrange nodes in non-overlapping groups based on a node attribute.
    //
    // groupTypeId : the node property used as the group key
    //               e.g. 'site_id', 'region_id', 'country_code', 'tenant_id',
    //                    'location_id', 'rack_id', 'virtual_chassis_id', or null
    // groupTypeName: the node property used for the human-readable group label
    //
    // When groupTypeId is null every node is placed in a plain grid.
    //
    // Virtual chassis groups may overlap site/location/rack rectangles because a
    // virtual chassis can span multiple physical groupings – this is expected.
    window.autoArrange = function autoArrange(groupTypeId, groupTypeName) {
        const NODE_SPACING = 120;  // centre-to-centre distance within a group
        const GROUP_PADDING = 80;  // space between group edge and nearest node
        const GROUP_MARGIN  = 60;  // gap between adjacent groups

        const updates = [];

        if (!groupTypeId) {
            // Plain grid – no grouping
            const allIds = [...nodes._data.keys()];
            const cols = Math.max(1, Math.ceil(Math.sqrt(allIds.length)));
            allIds.forEach((nodeId, i) => {
                updates.push({
                    id: nodeId,
                    x: (i % cols) * NODE_SPACING,
                    y: Math.floor(i / cols) * NODE_SPACING,
                    physics: false
                });
            });
        } else {
            // Grouped layout
            const groupMap = {};  // groupKey -> nodeId[]
            const ungrouped = [];

            for (let [, node] of nodes._data) {
                const gid = node[groupTypeId];
                if (gid !== undefined) {
                    if (!groupMap[gid]) groupMap[gid] = [];
                    groupMap[gid].push(node.id);
                } else {
                    ungrouped.push(node.id);
                }
            }

            const groupList = Object.values(groupMap);
            const groupsPerRow = Math.max(1, Math.ceil(Math.sqrt(
                groupList.length + (ungrouped.length > 0 ? 1 : 0)
            )));

            let curX = 0, curY = 0, rowMaxH = 0, colInRow = 0;

            for (const nodeIds of groupList) {
                const N = nodeIds.length;
                const innerCols = Math.max(1, Math.ceil(Math.sqrt(N)));
                const innerRows = Math.ceil(N / innerCols);

                nodeIds.forEach((nodeId, i) => {
                    updates.push({
                        id: nodeId,
                        x: curX + GROUP_PADDING + (i % innerCols) * NODE_SPACING,
                        y: curY + GROUP_PADDING + Math.floor(i / innerCols) * NODE_SPACING,
                        physics: false
                    });
                });

                const groupW = GROUP_PADDING * 2 + Math.max(0, innerCols - 1) * NODE_SPACING;
                const groupH = GROUP_PADDING * 2 + Math.max(0, innerRows - 1) * NODE_SPACING;

                rowMaxH = Math.max(rowMaxH, groupH);
                colInRow++;
                curX += groupW + GROUP_MARGIN;

                if (colInRow >= groupsPerRow) {
                    colInRow = 0;
                    curX = 0;
                    curY += rowMaxH + GROUP_MARGIN;
                    rowMaxH = 0;
                }
            }

            // Ungrouped nodes go below the grouped area
            if (ungrouped.length > 0) {
                curY += rowMaxH + GROUP_MARGIN;
                const ugCols = Math.max(1, Math.ceil(Math.sqrt(ungrouped.length)));
                ungrouped.forEach((nodeId, i) => {
                    updates.push({
                        id: nodeId,
                        x: (i % ugCols) * NODE_SPACING,
                        y: curY + Math.floor(i / ugCols) * NODE_SPACING,
                        physics: false
                    });
                });
            }
        }

        nodes.update(updates);

        // Fit the view once positions have settled
        setTimeout(() => graph.fit({
            animation: { duration: 500, easingFunction: 'easeInOutQuad' }
        }), 50);

        // Persist positions if coordinate saving is enabled
        if (coordSaveCheckbox.options[coordSaveCheckbox.selectedIndex].text === 'Yes') {
            Promise.allSettled(updates.map(({ id, x, y }) =>
                fetch(
                    '/' + basePath + 'api/plugins/netbox_topology_views/save-coords/save_coords/',
                    {
                        method: 'PATCH',
                        headers: {
                            'X-CSRFToken': window.CSRF_TOKEN,
                            Accept: 'application/json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            node_id: id,
                            x: x,
                            y: y,
                            group: topologyData.group
                        })
                    }
                )
            ));
        }
    }

    let groupedNodeSites = combineNodeInfo('site_id', 'site');
    let siteRectParams = {
        lineWidth: "5", 
        color: "red",
        paddingX: 84, 
        paddingY: 84, 
        textPaddingX: 8, 
        textPaddingY: -8, 
        font: "14px helvetica",
        category: "Site"
    }
    
    let groupedNodeLocations = combineNodeInfo('location_id', 'location');
    let locationRectParams = {
        lineWidth: "5", 
        color: "#337ab7",
        paddingX: 77, 
        paddingY: 77, 
        textPaddingX: 22, 
        textPaddingY: 29, 
        font: "14px helvetica",
        category: "Location"
    }

    let groupedNodeRacks = combineNodeInfo('rack_id', 'rack');
    let rackRectParams = {
        lineWidth: "5", 
        color: "green",
        paddingX: 70, 
        paddingY: 70, 
        textPaddingX: 15, 
        textPaddingY: 36, 
        font: "14px helvetica",
        category: "Rack"
    }

    let groupedNodeVirtualchassis = combineNodeInfo('virtual_chassis_id', 'virtual_chassis');
    let virtualchassisRectParams = {
        lineWidth: "5", 
        color: "orange",
        paddingX: 63, 
        paddingY: 63, 
        textPaddingX: 8, 
        textPaddingY: 43, 
        font: "14px helvetica",
        category: "Virtual Chassis"
    }
})()

// Download Graph
const MIME_TYPE = 'image/png'

const downloadButton = document.querySelector('#btnDownloadImage')
downloadButton.addEventListener('click', (e) => {
    performGraphDownload()
})

function performGraphDownload() {
    const canvas = container.querySelector('canvas')
    const tempDownloadLink = document.createElement('a')
    const generatedImageUrl = canvas.toDataURL(MIME_TYPE)

    tempDownloadLink.href = generatedImageUrl
    tempDownloadLink.download = 'topology'
    document.body.appendChild(tempDownloadLink)
    tempDownloadLink.click()
    document.body.removeChild(tempDownloadLink)
}

// Download XML
const downloadXmlButton = document.querySelector('#btnDownloadXml')
downloadXmlButton.addEventListener('click', (e) => {
    performXmlDownload()
})

function performXmlDownload() {

    const tempDownloadLink = document.createElement('a');

    let xml_search_options = '';

    if (typeof is_htmx !== 'undefined') {
        var curr_url = window.location.href;
        const sites_prefix = '/sites/'
        const location_prefix = '/locations/'
        if (curr_url.includes(sites_prefix)) {
            var site_id =  curr_url.split(sites_prefix)[1];
            site_id = site_id.split('/')[0]
            xml_search_options = 'site_id=' + site_id + '&show_cables=True&show_unconnected=True'
        }
        else if (curr_url.includes(location_prefix)) {
            var location_id =  curr_url.split(location_prefix)[1];
            location_id = location_id.split('/')[0]
            xml_search_options = 'location_id=' + location_id + '&show_cables=True&show_unconnected=True'
        }
    }
    else {
        xml_search_options = new URLSearchParams(window.location.search);
    }

    

    fetch('/' + basePath + 'api/plugins/netbox_topology_views/xml-export/?' + xml_search_options).then(response => response.text())
    .then(data => {
        var blob = new Blob([data ], { type: "text/plain" });

        tempDownloadLink.setAttribute("href", window.URL.createObjectURL(blob));
        tempDownloadLink.setAttribute("download", 'topology.xml');

        tempDownloadLink.dataset.downloadurl = ["text/plain", tempDownloadLink.download, tempDownloadLink.href].join(":");

        tempDownloadLink.click();

    });
}

// Theme switching
const observer = new MutationObserver((mutations) =>
    mutations.forEach((mutation) => {
        if (
            !graph ||
            mutation.type !== 'attributes' ||
            mutation.attributeName !== 'data-bs-theme' ||
            !(mutation.target instanceof HTMLElement)
        )
            return
        const netboxColorMode = mutation.target.dataset.bsTheme
        options.nodes.font.color = netboxColorMode === 'dark' ? '#fff' : '#000'
        graph.setOptions(options)
    })
)

observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-bs-theme']
})
