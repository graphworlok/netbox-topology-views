import { DataSet } from 'vis-data/esnext'
import { Network } from 'vis-network/esnext'

// -----------------------------------------------------------------------
// IP / Routing Topology
//
// Physics design:
//   - "The Internet" node is pinned at the canvas origin.
//   - Public (WAN) prefix nodes spring toward Internet/ASN — pulled inward.
//   - LAN (private) prefix nodes have no centripetal spring, so the solver's
//     repulsion pushes them outward — sites naturally cluster and repel each
//     other while staying tethered through their devices to their subnets.
//   - The result: Internet at centre, WAN clouds orbit it, LAN clusters
//     radiate outward like petals.
// -----------------------------------------------------------------------

const isDark = () => document.documentElement.dataset.bsTheme === 'dark'
    || document.documentElement.dataset.netboxColorMode === 'dark'

// Default vis-network options for this view
const visOptions = {
    interaction: {
        hover: true,
        hoverConnectedEdges: true,
        multiselect: true,
        tooltipDelay: 200,
    },
    nodes: {
        shape: 'image',
        brokenImage: typeof brokenImage !== 'undefined' ? brokenImage : '',
        size: 25,
        font: {
            multi: 'md',
            face: 'helvetica',
            size: 12,
            color: isDark() ? '#fff' : '#000',
        },
    },
    edges: {
        width: 1,
        font: { face: 'helvetica', size: 9, align: 'middle' },
        shadow: { enabled: false },
        smooth: { type: 'dynamic' },
    },
    physics: {
        enabled: true,
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
            gravitationalConstant: -1200,
            centralGravity: 0.01,
            springLength: 130,
            springConstant: 0.06,
            damping: 0.35,
            avoidOverlap: 0.6,
        },
        stabilization: { enabled: true, iterations: 250, updateInterval: 25 },
    },
}

window.ipPhysicsSettings = {
    solver:                'forceAtlas2Based',
    gravitationalConstant: -1200,
    centralGravity:        0.01,
    springLength:          130,
    springConstant:        0.06,
    damping:               0.35,
    avoidOverlap:          0.6,
}

let graph = null
const container = document.querySelector('#ipgraph')
const topoData  = typeof ipTopologyData !== 'undefined' ? ipTopologyData : null

// -----------------------------------------------------------------------
// Initialise graph
// -----------------------------------------------------------------------
;(function init() {
    if (!topoData || !topoData.nodes) return

    function htmlTitle(text) {
        const div = document.createElement('div')
        div.innerHTML = text || ''
        return div
    }

    const nodes = new DataSet(
        topoData.nodes.map(n => ({ ...n, title: htmlTitle(n.title) }))
    )
    const edges = new DataSet(
        topoData.edges.map(e => ({ ...e, title: htmlTitle(e.title) }))
    )

    window.ipNodes = nodes
    window.ipEdges = edges

    graph = new Network(container, { nodes, edges }, visOptions)

    _initBubbleGroups()
    graph.on('afterDrawing', ctx => _drawBubbles(ctx))

    graph.once('stabilizationIterationsDone', () => {
        graph.setOptions({ physics: { stabilization: { enabled: false } } })
        graph.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } })
        updateStabilizeBtn(false)
    })

    graph.on('stabilizationProgress', params => {
        const pct = Math.round((params.iterations / params.total) * 100)
        const btn = document.getElementById('btnIPStabilize')
        if (btn) btn.textContent = `Stabilizing… ${pct}%`
    })

    graph.on('doubleClick', params => {
        if (params.nodes.length > 0) {
            const node = nodes.get(params.nodes[0])
            if (node && node.href) window.open(node.href, '_blank')
        } else if (params.edges.length > 0) {
            const edge = edges.get(params.edges[0])
            if (edge && edge.href) window.open(edge.href, '_blank')
        }
    })

    // ── VRF legend ──
    buildVrfLegend(topoData.vrfs || [])

    // ── Overall risk banner ──
    buildRiskBanner(nodes)

    // ── Vulnerability severity legend ──
    buildVulnLegend(nodes)

    // ── Stats badge ──
    const deviceCount = topoData.nodes.filter(n => n.is_device || n.is_vm).length
    const prefixCount = topoData.nodes.filter(n => n.is_prefix).length
    const badge = document.createElement('div')
    badge.className = 'ip-stats-badge'
    badge.textContent = `${deviceCount} devices/VMs  ·  ${prefixCount} subnets  ·  ${topoData.edges.length} links`
    container.style.position = 'relative'
    container.appendChild(badge)

    // ── Edge type visibility toggles ──
    buildEdgeLegend(edges)
})()

// -----------------------------------------------------------------------
// Group bubbles — draw enclosing circles around logical groups
// -----------------------------------------------------------------------

let _bubblesEnabled = false
const _bubbleGroups = []   // [{ ids[], label, fill, stroke }]

function _initBubbleGroups() {
    if (!topoData || !topoData.nodes) return

    // Internet bubble: internet hub + ASN nodes + public prefixes
    const internetIds = []
    for (const n of topoData.nodes) {
        if (n.is_internet || n.is_asn || (n.is_prefix && n.is_public)) {
            internetIds.push(n.id)
        }
    }
    if (internetIds.length) {
        _bubbleGroups.push({
            ids:    internetIds,
            label:  'The Internet',
            fill:   'rgba(21,101,192,0.07)',
            stroke: '#1565C0',
        })
    }

    // Per-site bubbles: devices, VMs, and private prefixes grouped by site
    const siteMap = new Map()
    for (const n of topoData.nodes) {
        if (!n.site_id) continue
        if (!n.is_device && !n.is_vm && !(n.is_prefix && !n.is_public)) continue
        if (!siteMap.has(n.site_id)) {
            siteMap.set(n.site_id, { ids: [], label: n.site_name || `Site ${n.site_id}` })
        }
        siteMap.get(n.site_id).ids.push(n.id)
    }

    const SITE_PALETTE = [
        ['rgba(46,125,50,0.07)',   '#2E7D32'],
        ['rgba(123,31,162,0.07)',  '#7B1FA2'],
        ['rgba(183,28,28,0.07)',   '#B71C1C'],
        ['rgba(230,81,0,0.07)',    '#E65100'],
        ['rgba(0,131,143,0.07)',   '#00838F'],
        ['rgba(84,110,122,0.07)',  '#546E7A'],
        ['rgba(161,136,127,0.07)', '#A1887F'],
    ]
    let ci = 0
    for (const [, { ids, label }] of siteMap) {
        const [fill, stroke] = SITE_PALETTE[ci % SITE_PALETTE.length]
        ci++
        _bubbleGroups.push({ ids, label, fill, stroke })
    }
}

function _drawBubbles(ctx) {
    if (!_bubblesEnabled || !graph || !_bubbleGroups.length) return
    for (const g of _bubbleGroups) _drawOneBubble(ctx, g)
}

function _drawOneBubble(ctx, { ids, label, fill, stroke }) {
    const pos = graph.getPositions(ids)
    const pts = Object.values(pos)
    if (!pts.length) return

    let cx = 0, cy = 0
    for (const p of pts) { cx += p.x; cy += p.y }
    cx /= pts.length; cy /= pts.length

    let r = 60
    for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy))
    r += 80

    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, 2 * Math.PI)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.setLineDash([8, 5])
    ctx.strokeStyle = stroke
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = 'bold 13px helvetica, sans-serif'
    ctx.fillStyle = stroke
    ctx.globalAlpha = 0.85
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(label, cx, cy - r + 2)
    ctx.restore()
}

window.toggleBubbles = function() {
    _bubblesEnabled = !_bubblesEnabled
    const btn = document.getElementById('btnBubbles')
    if (btn) {
        btn.classList.toggle('btn-primary',   _bubblesEnabled)
        btn.classList.toggle('btn-secondary', !_bubblesEnabled)
    }
    if (graph) graph.redraw()
}

// -----------------------------------------------------------------------
// VRF / routing-domain legend (bottom-left of graph)
// -----------------------------------------------------------------------
function buildVrfLegend(vrfs) {
    if (!vrfs.length) return
    const legend = document.createElement('div')
    legend.className = 'ip-vrf-legend card'
    legend.innerHTML = '<div class="ip-legend-title">Routing Domains</div>'

    // Fixed entries first
    const fixed = [
        { name: 'The Internet', color: '#1565C0' },
        { name: 'Public / WAN prefix', color: '#1565C0' },
        { name: 'Upstream ASN', color: '#FF9800' },
        { name: 'LAN / Private prefix', color: '#888' },
        { name: 'VLAN (L2)', color: '#9C27B0' },
    ]
    for (const { name, color } of fixed) {
        const row = document.createElement('div')
        row.className = 'ip-legend-row'
        row.innerHTML = `<span class="ip-legend-swatch" style="background:${color}"></span><span>${name}</span>`
        legend.appendChild(row)
    }

    if (vrfs.length) {
        const sep = document.createElement('div')
        sep.style.cssText = 'font-size:10px;opacity:0.5;margin:6px 0 4px;text-transform:uppercase;letter-spacing:.05em'
        sep.textContent = 'VRFs'
        legend.appendChild(sep)
        for (const { name, color } of vrfs) {
            const row = document.createElement('div')
            row.className = 'ip-legend-row'
            row.innerHTML = `<span class="ip-legend-swatch" style="background:${color}"></span><span>${name}</span>`
            legend.appendChild(row)
        }
    }

    container.style.position = 'relative'
    container.appendChild(legend)
}

// -----------------------------------------------------------------------
// Edge-type legend with visibility toggles (bottom-right)
// -----------------------------------------------------------------------
function buildEdgeLegend(edges) {
    const types = [
        { key: 'wan',  label: 'WAN / Internet',   color: '#1565C0', dash: null },
        { key: 'lan',  label: 'LAN assignment',   color: '#999',    dash: null },
        { key: 'l2',   label: 'L2 VLAN member',   color: '#9C27B0', dash: '3,3' },
        { key: 'mac',  label: 'MAC adjacency',    color: '#00897B', dash: '4,3' },
        { key: 'pfx',  label: 'Prefix hierarchy', color: '#ccc',    dash: '6,4' },
    ]

    // Determine which types are present
    const present = new Set()
    for (const [, e] of edges._data) {
        if (e.is_wan)      present.add('wan')
        else if (e.is_l2)       present.add('l2')
        else if (e.is_mac_adj)  present.add('mac')
        else if (e.dashes && JSON.stringify(e.dashes) === '[6,4]') present.add('pfx')
        else               present.add('lan')
    }
    if (present.size < 2) return   // no point showing a one-row legend

    const panel = document.createElement('div')
    panel.className = 'ip-edge-legend card'
    panel.innerHTML = '<div class="ip-legend-title">Edge Types</div>'

    for (const { key, label, color, dash } of types) {
        if (!present.has(key)) continue
        const row = document.createElement('label')
        row.className = 'ip-legend-row'
        row.style.cursor = 'pointer'

        const cb = document.createElement('input')
        cb.type = 'checkbox'; cb.checked = true
        cb.addEventListener('change', () => {
            const updates = []
            for (const [id, e] of edges._data) {
                const isType = (
                    (key === 'wan' && e.is_wan) ||
                    (key === 'l2'  && e.is_l2) ||
                    (key === 'mac' && e.is_mac_adj) ||
                    (key === 'pfx' && e.dashes && JSON.stringify(e.dashes) === '[6,4]') ||
                    (key === 'lan' && !e.is_wan && !e.is_l2 && !e.is_mac_adj)
                )
                if (isType) updates.push({ id, hidden: !cb.checked })
            }
            edges.update(updates)
        })

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('width', '36'); svg.setAttribute('height', '10')
        svg.style.flexShrink = '0'
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        line.setAttribute('x1','1'); line.setAttribute('y1','5')
        line.setAttribute('x2','35'); line.setAttribute('y2','5')
        line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2')
        if (dash) line.setAttribute('stroke-dasharray', dash)
        svg.appendChild(line)

        const text = document.createElement('span')
        text.textContent = label

        row.append(cb, svg, text)
        panel.appendChild(row)
    }

    container.appendChild(panel)
}

// -----------------------------------------------------------------------
// Vulnerability severity legend (top-left of graph, only when vulns present)
// -----------------------------------------------------------------------
const _VULN_SEV_COLORS = {
    critical: '#D32F2F',
    high:     '#F57C00',
    medium:   '#F9A825',
    low:      '#1976D2',
    info:     '#9E9E9E',
}
const _VULN_SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info']

// -----------------------------------------------------------------------
// Overall risk banner (top-centre of graph)
// -----------------------------------------------------------------------
function buildRiskBanner(nodes) {
    const counts = {}
    let totalFindings = 0

    for (const [, n] of nodes._data) {
        if (!n.vuln_severity) continue
        counts[n.vuln_severity] = (counts[n.vuln_severity] || 0) + 1
        totalFindings += (n.vuln_count || 1)
    }

    const totalNodes = Object.values(counts).reduce((a, b) => a + b, 0)
    if (!totalNodes) return

    const worstSev = _VULN_SEV_ORDER.find(s => counts[s] > 0)
    const color    = _VULN_SEV_COLORS[worstSev]

    const banner = document.createElement('div')
    banner.className = 'ip-risk-banner card'
    banner.style.borderLeftColor = color

    const ratingEl = document.createElement('span')
    ratingEl.className = 'ip-risk-rating'
    ratingEl.style.color = color
    ratingEl.textContent = '\u26a0 ' + worstSev.toUpperCase() + ' RISK'

    const countsEl = document.createElement('span')
    countsEl.className = 'ip-risk-counts'
    const parts = _VULN_SEV_ORDER
        .filter(s => counts[s] > 0)
        .map(s => '<span style="color:' + _VULN_SEV_COLORS[s] + ';font-weight:600">'
            + counts[s] + ' ' + s + '</span>')
    countsEl.innerHTML = totalNodes + ' node' + (totalNodes !== 1 ? 's' : '') + ' affected \u00b7 '
        + parts.join(' \u00b7 ')

    const findingsEl = document.createElement('span')
    findingsEl.className = 'ip-risk-findings'
    findingsEl.textContent = totalFindings + ' open finding' + (totalFindings !== 1 ? 's' : '')

    banner.append(ratingEl, countsEl, findingsEl)
    container.appendChild(banner)
}

function buildVulnLegend(nodes) {
    const presentSevs = new Set()
    for (const [, n] of nodes._data) {
        if (n.vuln_severity) presentSevs.add(n.vuln_severity)
    }
    if (!presentSevs.size) return

    const legend = document.createElement('div')
    legend.className = 'ip-vrf-legend card'
    legend.style.cssText = 'top:10px;bottom:auto;left:16px;min-width:160px;max-height:none'

    const title = document.createElement('div')
    title.className = 'ip-legend-title'
    title.innerHTML = '<i class="mdi mdi-shield-alert-outline"></i> Vulnerabilities'
    legend.appendChild(title)

    const sub = document.createElement('div')
    sub.style.cssText = 'font-size:10px;opacity:0.6;margin-bottom:6px'
    sub.textContent = 'Node border = worst open severity'
    legend.appendChild(sub)

    for (const sev of _VULN_SEV_ORDER) {
        if (!presentSevs.has(sev)) continue
        const count = [...nodes._data.values()].filter(n => n.vuln_severity === sev).length
        const row = document.createElement('div')
        row.className = 'ip-legend-row'
        const swatch = document.createElement('span')
        swatch.className = 'ip-legend-swatch'
        swatch.style.cssText = `background:${_VULN_SEV_COLORS[sev]};border-radius:50%;width:10px;height:10px;border:2px solid ${_VULN_SEV_COLORS[sev]}`
        const label = document.createElement('span')
        label.textContent = `${sev.charAt(0).toUpperCase() + sev.slice(1)} (${count})`
        row.append(swatch, label)
        legend.appendChild(row)
    }

    // Toggle: click the legend to highlight/dim nodes by severity
    legend.title = 'Click a severity row to highlight those nodes'
    legend.querySelectorAll && legend.querySelectorAll('.ip-legend-row').forEach((row, i) => {
        const sev = _VULN_SEV_ORDER.filter(s => presentSevs.has(s))[i]
        if (!sev) return
        row.style.cursor = 'pointer'
        row.addEventListener('click', () => {
            const updates = []
            for (const [id, n] of nodes._data) {
                if (!n.is_device && !n.is_vm) continue
                const opacity = (!n.vuln_severity || n.vuln_severity !== sev) ? 0.2 : 1
                updates.push({ id, opacity })
            }
            nodes.update(updates)
            // Second click resets
            row._vuln_active = !row._vuln_active
            if (!row._vuln_active) {
                const resets = []
                for (const [id, n] of nodes._data) {
                    if (n.is_device || n.is_vm) resets.push({ id, opacity: 1 })
                }
                nodes.update(resets)
            }
        })
    })

    container.style.position = 'relative'
    container.appendChild(legend)
}

// -----------------------------------------------------------------------
// Geographic seeding — reposition nodes to site lat/lon then let physics run
// -----------------------------------------------------------------------
window.applyGeoSeed = function applyGeoSeed() {
    if (!graph || !window.ipNodes) return

    const geoNodes = []
    for (const [, n] of window.ipNodes._data) {
        if (n.geo_lat != null && n.geo_lon != null) {
            geoNodes.push({ id: n.id, lat: n.geo_lat, lon: n.geo_lon })
        }
    }
    if (!geoNodes.length) {
        alert('No nodes have geographic coordinates. Ensure NetBox sites have latitude/longitude set and "Geographic seeding" is enabled in Options.')
        return
    }

    const lats    = geoNodes.map(n => n.lat)
    const lons    = geoNodes.map(n => n.lon)
    const latMin  = Math.min(...lats),  lonMin  = Math.min(...lons)
    const latSpan = Math.max(Math.max(...lats) - latMin, 5)
    const lonSpan = Math.max(Math.max(...lons) - lonMin, 5)
    const CSPAN   = 2400

    const updates = geoNodes.map(n => ({
        id: n.id,
        x:  (n.lon - lonMin) / lonSpan * CSPAN - CSPAN / 2,
        y: -((n.lat - latMin) / latSpan * CSPAN - CSPAN / 2),
    }))
    window.ipNodes.update(updates)
    graph.startSimulation()
}

// -----------------------------------------------------------------------
// Risk gravity — pull vulnerable nodes toward the Internet hub via hidden
// spring edges scaled by severity (critical closest, low farthest)
// -----------------------------------------------------------------------
const _RISK_GRAVITY_LENGTHS = { critical: 50, high: 120, medium: 230, low: 380 }
let   _riskGravityOn  = false
const _riskGravityIds = []

window.toggleRiskGravity = function toggleRiskGravity() {
    if (!graph || !window.ipNodes || !window.ipEdges) return

    _riskGravityOn = !_riskGravityOn

    if (_riskGravityOn) {
        // Find the Internet hub node (pinned at origin) to anchor to
        let anchorId = null
        for (const [, n] of window.ipNodes._data) {
            if (n.is_internet) { anchorId = n.id; break }
        }
        if (!anchorId) {
            // No Internet node — create a hidden physics-false anchor at origin
            anchorId = '_risk_anchor_'
            window.ipNodes.add({
                id: anchorId, label: '', hidden: true,
                physics: false, fixed: { x: true, y: true }, x: 0, y: 0, size: 1,
            })
            _riskGravityIds.push('__node__' + anchorId)
        }

        let nextId = 9_000_000
        for (const [, n] of window.ipNodes._data) {
            if (!n.vuln_severity || (!n.is_device && !n.is_vm)) continue
            const len = _RISK_GRAVITY_LENGTHS[n.vuln_severity] || 380
            const eid = nextId++
            _riskGravityIds.push(eid)
            window.ipEdges.add({
                id: eid, from: n.id, to: anchorId,
                hidden: true, length: len, physics: true,
                is_risk_gravity: true,
            })
        }
    } else {
        // Remove edges (and hidden anchor node if we created one)
        const nodeIds = _riskGravityIds.filter(x => typeof x === 'string' && x.startsWith('__node__'))
            .map(x => x.slice(8))
        const edgeIds = _riskGravityIds.filter(x => typeof x !== 'string' || !x.startsWith('__node__'))
        if (edgeIds.length) window.ipEdges.remove(edgeIds)
        if (nodeIds.length) window.ipNodes.remove(nodeIds)
        _riskGravityIds.length = 0
    }

    const btn = document.getElementById('btnRiskGravity')
    if (btn) {
        btn.classList.toggle('btn-primary',   _riskGravityOn)
        btn.classList.toggle('btn-secondary', !_riskGravityOn)
    }
}

// -----------------------------------------------------------------------
// Unallocated internet grouping
//
// Public nodes (is_public=true) that have no site_id are internet-facing
// services not tied to a physical location.  This feature clusters them by
// the ASN they connect to in the graph.  Nodes that reach Internet directly
// (no intermediate ASN node) land in one or more "Unallocated Internet"
// clusters.  Double-click a cluster to expand it.
// -----------------------------------------------------------------------

let _clustersOpen = false

// Return a map of  asnNodeId → Set<nodeId>  for all unallocated public nodes,
// by walking one hop up their edges to find the nearest hub (ASN or Internet).
function _mapUnallocatedByHub() {
    if (!graph || !window.ipNodes || !window.ipEdges) return new Map()

    // Collect unallocated public node ids
    const unallocIds = new Set()
    for (const [id, node] of window.ipNodes._data) {
        if (node.is_public && !node.site_id && !node.is_internet && !node.is_asn) {
            unallocIds.add(id)
        }
    }
    if (!unallocIds.size) return new Map()

    // Build adjacency: nodeId → set of neighbour ids
    const adj = new Map()
    for (const [, edge] of window.ipEdges._data) {
        if (!adj.has(edge.from)) adj.set(edge.from, new Set())
        if (!adj.has(edge.to))   adj.set(edge.to,   new Set())
        adj.get(edge.from).add(edge.to)
        adj.get(edge.to).add(edge.from)
    }

    // For each unallocated node, BFS upward to find the nearest ASN or Internet hub
    function findHub(startId) {
        const visited = new Set([startId])
        const queue   = [startId]
        while (queue.length) {
            const cur = queue.shift()
            const node = window.ipNodes.get(cur)
            if (node && (node.is_asn || node.is_internet) && cur !== startId) return cur
            for (const nb of (adj.get(cur) || [])) {
                if (!visited.has(nb)) { visited.add(nb); queue.push(nb) }
            }
        }
        return 'internet'  // fallback
    }

    const hubMap = new Map()  // hubId → Set<nodeId>
    for (const id of unallocIds) {
        const hub = findHub(id)
        if (!hubMap.has(hub)) hubMap.set(hub, new Set())
        hubMap.get(hub).add(id)
    }
    return hubMap
}

// Build a human-readable label for a cluster hub
function _hubLabel(hubId) {
    const node = window.ipNodes.get(hubId)
    if (!node) return 'Internet'
    if (node.is_asn)      return `AS${node.asn_num || ''}`
    if (node.is_internet) return 'Internet'
    return hubId
}

window.groupUnallocated = function groupUnallocated() {
    if (!graph) return
    if (_clustersOpen) {
        // Open all existing unallocated clusters
        const toOpen = []
        for (const [id] of window.ipNodes._data) {
            if (String(id).startsWith('_uc_')) toOpen.push(id)
        }
        toOpen.forEach(id => { try { graph.openCluster(id) } catch (_) {} })
        _clustersOpen = false
        _updateGroupBtn(false)
        return
    }

    const hubMap = _mapUnallocatedByHub()
    if (!hubMap.size) {
        console.info('[IP topology] No unallocated public nodes found.')
        return
    }

    let clusterCount = 0
    for (const [hubId, memberIds] of hubMap) {
        const hubLabel  = _hubLabel(hubId)
        const clusterId = `_uc_${hubId}`

        graph.cluster({
            joinCondition: nodeOpts => memberIds.has(nodeOpts.id),

            clusterNodeProperties: {
                id:     clusterId,
                label:  `${hubLabel}\n(${memberIds.size} unallocated)`,
                shape:  'ellipse',
                size:   Math.max(30, 20 + memberIds.size * 3),
                color: {
                    border:     '#1565C0',
                    background: '#C5CAE9',
                    highlight:  { border: '#0D47A1', background: '#9FA8DA' },
                },
                font:    { size: 12, bold: true, color: '#1565C0' },
                physics: true,
                title:   `<b>${hubLabel} — unallocated internet resources</b><br>`
                       + `${memberIds.size} nodes (double-click to expand)`,
            },

            // Keep a connecting edge to the hub so physics keeps it nearby
            processProperties(clusterOpts) { return clusterOpts },
        })
        clusterCount++
    }

    if (clusterCount > 0) {
        _clustersOpen = true
        _updateGroupBtn(true)
    }
}

function _updateGroupBtn(clustered) {
    const btn = document.getElementById('btnGroupUnallocated')
    if (!btn) return
    btn.classList.toggle('btn-primary',   clustered)
    btn.classList.toggle('btn-secondary', !clustered)
    btn.title = clustered
        ? 'Click to expand clusters and show individual nodes'
        : 'Group unallocated internet-facing nodes by ASN within the Internet bubble'
}

// Double-click a cluster to open it
document.addEventListener('DOMContentLoaded', () => {
    // Wire cluster open on double-click (set after graph init via delegation)
    const waitForGraph = setInterval(() => {
        if (!graph) return
        clearInterval(waitForGraph)
        graph.on('doubleClick', params => {
            if (params.nodes.length === 1) {
                const id = params.nodes[0]
                if (graph.isCluster(id)) {
                    graph.openCluster(id)
                    // If all clusters are now open, reset state
                    let anyOpen = false
                    for (const [nid] of window.ipNodes._data) {
                        if (String(nid).startsWith('_uc_')) { anyOpen = true; break }
                    }
                    if (!anyOpen) { _clustersOpen = false; _updateGroupBtn(false) }
                }
            }
        })
    }, 100)
})

// -----------------------------------------------------------------------
// Physics helpers
// -----------------------------------------------------------------------
function buildPhysicsOpts() {
    const s = window.ipPhysicsSettings
    const shared = {
        gravitationalConstant: s.gravitationalConstant,
        centralGravity:        s.centralGravity,
        springLength:          s.springLength,
        springConstant:        s.springConstant,
        damping:               s.damping,
        avoidOverlap:          s.avoidOverlap,
    }
    return {
        enabled: true,
        solver:  s.solver,
        forceAtlas2Based:   { ...shared },
        barnesHut:          { ...shared },
        repulsion: {
            centralGravity:  s.centralGravity,
            springLength:    s.springLength,
            springConstant:  s.springConstant,
            nodeDistance:    Math.abs(s.gravitationalConstant) / 10,
            damping:         s.damping,
        },
    }
}

window.applyIPPhysics = function() {
    if (graph) graph.setOptions({ physics: buildPhysicsOpts() })
}

window.setIPSolver = function(solver) {
    window.ipPhysicsSettings.solver = solver
    if (graph) {
        graph.setOptions({
            layout: { hierarchical: { enabled: false } },
            physics: buildPhysicsOpts(),
        })
    }
}

function updateStabilizeBtn(running) {
    const btn = document.getElementById('btnIPStabilize')
    if (!btn) return
    btn.textContent = running ? 'Stabilizing…' : 'Stabilize'
    btn.disabled = running
}

window.stabilizeIP = function() {
    if (!graph) return
    updateStabilizeBtn(true)
    graph.setOptions({ physics: { ...buildPhysicsOpts(), stabilization: { enabled: true, iterations: 400 } } })
    graph.stabilize(400)
    graph.once('stabilizationIterationsDone', () => {
        graph.setOptions({ physics: { stabilization: { enabled: false } } })
        graph.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } })
        updateStabilizeBtn(false)
    })
}

window.toggleIPPhysics = function(enabled) {
    if (graph) graph.setOptions({ physics: { enabled } })
}

window.fitIPGraph = function() {
    if (graph) graph.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } })
}

// -----------------------------------------------------------------------
// Physics settings panel (built on DOMContentLoaded)
// -----------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const panel = document.createElement('div')
    panel.id = 'ip-physics-panel'
    panel.className = 'card'
    panel.style.cssText =
        'display:none;position:fixed;top:80px;right:20px;z-index:1050;width:295px;' +
        'box-shadow:0 4px 18px rgba(0,0,0,0.28);'
    panel.innerHTML = `
      <div class="card-header py-2 px-3"
           style="display:flex;align-items:center;justify-content:space-between;cursor:move;user-select:none">
        <span><i class="mdi mdi-tune-variant"></i> IP Physics Settings</span>
        <button class="btn-close" id="ipPhysicsClose" aria-label="Close"></button>
      </div>
      <div class="card-body px-3 py-2">

        <div class="iph-section">Solver</div>
        <select id="iph-solver" class="form-select form-select-sm mb-2">
          <option value="forceAtlas2Based" selected>ForceAtlas2 (recommended)</option>
          <option value="barnesHut">Barnes-Hut</option>
          <option value="repulsion">Repulsion</option>
        </select>

        <div class="iph-section">Gravity (sites repel ↔ cluster)</div>
        <div class="iph-row">
          <label>Gravitational constant <small class="text-muted">(more negative = stronger repulsion)</small></label>
          <input type="range" id="iph-gravity" min="-8000" max="-50" step="50" value="-1200">
          <span id="iph-gravity-val">-1200</span>
        </div>
        <div class="iph-row">
          <label>Central gravity <small class="text-muted">(pulls toward Internet hub)</small></label>
          <input type="range" id="iph-central" min="0" max="100" step="1" value="10">
          <span id="iph-central-val">0.010</span>
        </div>

        <div class="iph-section">Springs (LAN tightness)</div>
        <div class="iph-row">
          <label>Default spring length</label>
          <input type="range" id="iph-springLen" min="30" max="600" step="10" value="130">
          <span id="iph-springLen-val">130</span>
        </div>
        <div class="iph-row">
          <label>Spring constant</label>
          <input type="range" id="iph-springK" min="1" max="200" step="1" value="6">
          <span id="iph-springK-val">0.06</span>
        </div>
        <div class="iph-row">
          <label>Damping</label>
          <input type="range" id="iph-damping" min="1" max="100" step="1" value="35">
          <span id="iph-damping-val">0.35</span>
        </div>
        <div class="iph-row">
          <label>Avoid overlap</label>
          <input type="range" id="iph-overlap" min="0" max="100" step="5" value="60">
          <span id="iph-overlap-val">0.60</span>
        </div>

        <div class="mt-2 d-flex gap-2 flex-wrap">
          <button id="btnIPStabilize" class="btn btn-sm btn-primary flex-fill"
                  onclick="window.stabilizeIP()">
            <i class="mdi mdi-play"></i> Stabilize
          </button>
          <button class="btn btn-sm btn-secondary flex-fill" onclick="window.fitIPGraph()">
            <i class="mdi mdi-fit-to-screen"></i> Fit
          </button>
        </div>
        <div class="mt-1">
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" id="iph-physics-toggle" checked>
            <label class="form-check-label" for="iph-physics-toggle" style="font-size:12px">
              Live physics
            </label>
          </div>
        </div>

      </div>
    `
    document.body.appendChild(panel)

    document.getElementById('btnIPPhysics')?.addEventListener('click', () => {
        panel.style.display = (panel.style.display === 'block') ? 'none' : 'block'
    })
    document.getElementById('ipPhysicsClose')?.addEventListener('click', () => {
        panel.style.display = 'none'
    })

    // Draggable header
    ;(function drag(el, handle) {
        let sx, sy, ol, ot
        handle.addEventListener('mousedown', e => {
            if (e.target.closest('button')) return
            sx = e.clientX; sy = e.clientY
            const r = el.getBoundingClientRect()
            ol = r.left; ot = r.top
            el.style.right = 'auto'
            el.style.left  = ol + 'px'
            el.style.top   = ot + 'px'
            const move = ev => {
                el.style.left = (ol + ev.clientX - sx) + 'px'
                el.style.top  = (ot + ev.clientY - sy) + 'px'
            }
            const up = () => {
                document.removeEventListener('mousemove', move)
                document.removeEventListener('mouseup',   up)
            }
            document.addEventListener('mousemove', move)
            document.addEventListener('mouseup',   up)
        })
    })(panel, panel.querySelector('.card-header'))

    function bindRange(inputId, valId, settingKey, scale) {
        const input = document.getElementById(inputId)
        const valEl = document.getElementById(valId)
        if (!input || !valEl) return
        input.addEventListener('input', () => {
            const raw = parseFloat(input.value)
            const val = scale ? raw / scale : raw
            window.ipPhysicsSettings[settingKey] = val
            valEl.textContent = val.toFixed(scale ? 3 : 0)
            window.applyIPPhysics()
        })
    }

    bindRange('iph-gravity',   'iph-gravity-val',   'gravitationalConstant', null)
    bindRange('iph-central',   'iph-central-val',   'centralGravity',        1000)
    bindRange('iph-springLen', 'iph-springLen-val', 'springLength',          null)
    bindRange('iph-springK',   'iph-springK-val',   'springConstant',        100)
    bindRange('iph-damping',   'iph-damping-val',   'damping',               100)
    bindRange('iph-overlap',   'iph-overlap-val',   'avoidOverlap',          100)

    document.getElementById('iph-solver')?.addEventListener('change', e => {
        window.setIPSolver(e.target.value)
    })

    document.getElementById('iph-physics-toggle')?.addEventListener('change', e => {
        window.toggleIPPhysics(e.target.checked)
    })
})

// -----------------------------------------------------------------------
// Theme switching
// -----------------------------------------------------------------------
new MutationObserver(mutations => {
    mutations.forEach(m => {
        if (!graph || m.type !== 'attributes' || m.attributeName !== 'data-bs-theme') return
        visOptions.nodes.font.color = isDark() ? '#fff' : '#000'
        graph.setOptions(visOptions)
    })
}).observe(document.body, { attributes: true, attributeFilter: ['data-bs-theme'] })
