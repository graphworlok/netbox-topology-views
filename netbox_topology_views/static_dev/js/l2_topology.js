import { DataSet } from 'vis-data/esnext'
import { Network } from 'vis-network/esnext'

const isDark = () => document.documentElement.dataset.bsTheme === 'dark'
    || document.documentElement.dataset.netboxColorMode === 'dark'

const visOptions = {
    interaction: { hover: true, hoverConnectedEdges: true, multiselect: true, tooltipDelay: 200 },
    nodes: {
        shape: 'image',
        brokenImage: typeof brokenImage !== 'undefined' ? brokenImage : '',
        size: 25,
        font: { multi: 'md', face: 'helvetica', size: 12, color: isDark() ? '#fff' : '#000' },
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
            gravitationalConstant: -1800,
            centralGravity: 0.005,
            springLength: 140,
            springConstant: 0.07,
            damping: 0.35,
            avoidOverlap: 0.7,
        },
        stabilization: { enabled: true, iterations: 300, updateInterval: 25 },
    },
}

let graph = null
const container = document.querySelector('#l2graph')
const topoData  = typeof l2TopologyData !== 'undefined' ? l2TopologyData : null

;(function init() {
    if (!topoData || !topoData.nodes) return

    function htmlTitle(text) {
        const div = document.createElement('div')
        div.innerHTML = text || ''
        return div
    }

    const nodes = new DataSet(topoData.nodes.map(n => ({ ...n, title: htmlTitle(n.title) })))
    const edges = new DataSet(topoData.edges.map(e => ({ ...e, title: htmlTitle(e.title) })))

    window.l2Nodes = nodes
    window.l2Edges = edges

    graph = new Network(container, { nodes, edges }, visOptions)

    graph.once('stabilizationIterationsDone', () => {
        graph.setOptions({ physics: { stabilization: { enabled: false } } })
        graph.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } })
    })

    graph.on('doubleClick', params => {
        if (params.nodes.length > 0) {
            const node = nodes.get(params.nodes[0])
            if (node && node.href) window.open(node.href, '_blank')
        }
    })

    // Stats badge
    const vlanCount   = topoData.nodes.filter(n => n.is_vlan).length
    const deviceCount = topoData.nodes.filter(n => n.is_device).length
    const trunkCount  = topoData.nodes.filter(n => n.is_trunk_device).length
    const edgeCount   = topoData.edges.length
    const badge = document.createElement('div')
    badge.className = 'l2-stats-badge'
    badge.textContent = `${vlanCount} VLANs  ·  ${deviceCount} devices (${trunkCount} trunk)  ·  ${edgeCount} links`
    container.style.position = 'relative'
    container.appendChild(badge)

    // Edge type legend
    buildEdgeLegend(edges)

    // Node shape legend (only when both shapes are present)
    if (trunkCount > 0 && deviceCount > trunkCount) {
        buildNodeLegend()
    }
})()

function buildEdgeLegend(edges) {
    const types = [
        { key: 'access',     label: 'Access port',   color: '#4CAF50', dash: null },
        { key: 'tagged',     label: 'Tagged (trunk)', color: '#1565C0', dash: '4,3' },
        { key: 'trunk_link', label: 'Trunk cable',   color: '#FF6F00', dash: null },
        { key: 'membership', label: 'Site membership',color: '#ccc',    dash: '3,3' },
    ]
    const present = new Set()
    for (const [, e] of edges._data) {
        if (e.is_access)     present.add('access')
        if (e.is_tagged)     present.add('tagged')
        if (e.is_trunk_link) present.add('trunk_link')
        if (e.is_membership) present.add('membership')
    }
    if (present.size < 2) return

    const panel = document.createElement('div')
    panel.className = 'l2-edge-legend card'
    panel.innerHTML = '<div class="l2-legend-title">Edge Types</div>'

    for (const { key, label, color, dash } of types) {
        if (!present.has(key)) continue
        const row = document.createElement('label')
        row.className = 'l2-legend-row'
        row.style.cursor = 'pointer'
        const cb = document.createElement('input')
        cb.type = 'checkbox'; cb.checked = true
        cb.addEventListener('change', () => {
            const updates = []
            for (const [id, e] of edges._data) {
                const match = (key === 'access' && e.is_access) ||
                              (key === 'tagged' && e.is_tagged) ||
                              (key === 'trunk_link' && e.is_trunk_link) ||
                              (key === 'membership' && e.is_membership)
                if (match) updates.push({ id, hidden: !cb.checked })
            }
            edges.update(updates)
        })
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('width', '36'); svg.setAttribute('height', '10')
        svg.style.flexShrink = '0'
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        line.setAttribute('x1','1'); line.setAttribute('y1','5')
        line.setAttribute('x2','35'); line.setAttribute('y2','5')
        line.setAttribute('stroke', color); line.setAttribute('stroke-width', key === 'trunk_link' ? '3' : '2')
        if (dash) line.setAttribute('stroke-dasharray', dash)
        svg.appendChild(line)
        const text = document.createElement('span')
        text.textContent = label
        row.append(cb, svg, text)
        panel.appendChild(row)
    }
    container.appendChild(panel)
}

function buildNodeLegend() {
    const panel = document.createElement('div')
    panel.className = 'l2-edge-legend card'
    panel.style.cssText = 'bottom:auto;top:10px;left:16px;right:auto;min-width:160px'
    panel.innerHTML = '<div class="l2-legend-title">Node Types</div>'

    const entries = [
        { label: 'Trunk switch (box)',   shape: 'box' },
        { label: 'Access device (icon)', shape: 'image' },
        { label: 'VLAN domain',          shape: 'ellipse' },
    ]
    for (const { label, shape } of entries) {
        const row = document.createElement('div')
        row.className = 'l2-legend-row'
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('width', '20'); svg.setAttribute('height', '14')
        svg.style.flexShrink = '0'
        let sym
        if (shape === 'box') {
            sym = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
            sym.setAttribute('x', '1'); sym.setAttribute('y', '2')
            sym.setAttribute('width', '18'); sym.setAttribute('height', '10')
            sym.setAttribute('rx', '2')
            sym.setAttribute('fill', 'none'); sym.setAttribute('stroke', '#555'); sym.setAttribute('stroke-width', '1.5')
        } else if (shape === 'ellipse') {
            sym = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
            sym.setAttribute('cx', '10'); sym.setAttribute('cy', '7')
            sym.setAttribute('rx', '9'); sym.setAttribute('ry', '5')
            sym.setAttribute('fill', 'none'); sym.setAttribute('stroke', '#1565C0'); sym.setAttribute('stroke-width', '1.5')
        } else {
            // image placeholder — small circle with cross
            sym = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
            sym.setAttribute('cx', '10'); sym.setAttribute('cy', '7'); sym.setAttribute('r', '5')
            sym.setAttribute('fill', 'none'); sym.setAttribute('stroke', '#888'); sym.setAttribute('stroke-width', '1.5')
        }
        svg.appendChild(sym)
        const text = document.createElement('span')
        text.textContent = label
        row.append(svg, text)
        panel.appendChild(row)
    }
    container.appendChild(panel)
}

window.fitL2Graph = function() {
    if (graph) graph.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } })
}

new MutationObserver(mutations => {
    mutations.forEach(m => {
        if (!graph || m.type !== 'attributes' || m.attributeName !== 'data-bs-theme') return
        visOptions.nodes.font.color = isDark() ? '#fff' : '#000'
        graph.setOptions(visOptions)
    })
}).observe(document.body, { attributes: true, attributeFilter: ['data-bs-theme'] })
