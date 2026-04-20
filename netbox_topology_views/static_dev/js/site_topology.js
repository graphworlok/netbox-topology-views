import { DataSet } from 'vis-data/esnext'
import { Network } from 'vis-network/esnext'

// -----------------------------------------------------------------------
// Site / Region Topology
//
// Physics design:
//   - Region nodes act as gravity wells (diamond shape, hashed colour).
//   - Site nodes spring toward their parent region (dot shape, border
//     coloured by status).
//   - Circuit edges connect sites that share a circuit termination.
//   - The result: sites cluster around their region, circuits pull
//     inter-region sites together.
// -----------------------------------------------------------------------

const isDark = () => document.documentElement.dataset.bsTheme === 'dark'
    || document.documentElement.dataset.netboxColorMode === 'dark'

const visOptions = {
    interaction: {
        hover: true,
        hoverConnectedEdges: true,
        multiselect: true,
        tooltipDelay: 200,
    },
    nodes: {
        font: {
            face: 'helvetica',
            size: 12,
            color: isDark() ? '#fff' : '#000',
        },
        borderWidth: 2,
        borderWidthSelected: 3,
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
            gravitationalConstant: -2000,
            centralGravity: 0.005,
            springLength: 160,
            springConstant: 0.05,
            damping: 0.3,
            avoidOverlap: 0.8,
        },
        stabilization: { enabled: true, iterations: 300, updateInterval: 25 },
    },
}

let graph = null
const container = document.querySelector('#sitegraph')
const topoData  = typeof siteTopologyData !== 'undefined' ? siteTopologyData : null

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

    window.siteNodes = nodes
    window.siteEdges = edges

    graph = new Network(container, { nodes, edges }, visOptions)

    graph.on('doubleClick', params => {
        if (params.nodes.length > 0) {
            const node = nodes.get(params.nodes[0])
            if (node && node.href) window.open(node.href, '_blank')
        } else if (params.edges.length > 0) {
            const edge = edges.get(params.edges[0])
            if (edge && edge.href) window.open(edge.href, '_blank')
        }
    })

    graph.once('stabilizationIterationsDone', () => {
        graph.setOptions({ physics: { stabilization: { enabled: false } } })
        graph.fit({ animation: { duration: 600, easingFunction: 'easeInOutQuad' } })
    })

    // ── Stats badge ──
    const regionCount  = topoData.nodes.filter(n => n.is_region).length
    const siteCount    = topoData.nodes.filter(n => n.is_site).length
    const circuitCount = topoData.circuit_count || 0
    const badge = document.createElement('div')
    badge.className = 'site-stats-badge'
    badge.textContent = `${regionCount} region${regionCount !== 1 ? 's' : ''}  ·  ${siteCount} site${siteCount !== 1 ? 's' : ''}  ·  ${circuitCount} circuit${circuitCount !== 1 ? 's' : ''}`
    container.style.position = 'relative'
    container.appendChild(badge)
})()

// -----------------------------------------------------------------------
// Global helpers
// -----------------------------------------------------------------------
window.fitSiteGraph = function() {
    if (graph) graph.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } })
}

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
