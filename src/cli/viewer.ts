import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CodeGraph } from '../core/graph.js';

// ---------------------------------------------------------------------------
// Graph → Cytoscape JSON
// ---------------------------------------------------------------------------

interface CyNode {
  data: {
    id: string;
    label: string;
    type: string;
    file: string;
    line: number;
    signature: string;
    content: string;
    fileGroup: string;
  };
}

interface CyEdge {
  data: {
    id: string;
    source: string;
    target: string;
    type: string;
    weight: number;
  };
}

function graphToCytoscape(graph: CodeGraph): { nodes: CyNode[]; edges: CyEdge[] } {
  const nodes: CyNode[] = [];
  const edges: CyEdge[] = [];

  const fileGroupMap = new Map<string, string>();
  for (const edge of graph.allEdges()) {
    if (edge.type === 'contains') {
      fileGroupMap.set(edge.target, edge.source);
    }
  }

  for (const node of graph.allNodes()) {
    nodes.push({
      data: {
        id: node.id,
        label: node.name,
        type: node.type,
        file: node.location?.file ?? '',
        line: node.location?.startLine ?? 0,
        signature: node.signature,
        content: node.content.length > 500 ? node.content.slice(0, 500) + '...' : node.content,
        fileGroup: fileGroupMap.get(node.id) ?? node.id,
      },
    });
  }

  for (const edge of graph.allEdges()) {
    edges.push({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        weight: edge.weight,
      },
    });
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function getCytoscapeScript(): string {
  const cyFile = 'cytoscape/dist/cytoscape.min.js';
  const candidates = [join(process.cwd(), 'node_modules', cyFile)];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  let dir = (typeof __dirname !== 'undefined' ? __dirname : process.cwd()) as string;
  for (let i = 0; i < 5; i++) {
    candidates.push(join(dir, 'node_modules', cyFile));
    dir = join(dir, '..');
  }
  for (const p of candidates) {
    try {
      const src = readFileSync(p, 'utf-8');
      return `<script>${src}<\/script>`;
    } catch { /* continue */ }
  }
  return `<script src="https://cdn.jsdelivr.net/npm/cytoscape@3.31.0/dist/cytoscape.min.js"><\/script>`;
}

function buildHTML(graphJSON: string, stats: { nodes: number; edges: number; files: number }): string {
  const cytoscapeScript = getCytoscapeScript();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>kc-graph</title>
${cytoscapeScript}
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1117;color:#d1d5db;overflow:hidden;display:flex;height:100vh}

/* ---- Sidebar ---- */
#sidebar{width:260px;min-width:260px;background:#161922;border-right:1px solid #2a2e3a;display:flex;flex-direction:column;z-index:10}
#sidebar-header{padding:16px;border-bottom:1px solid #2a2e3a}
#sidebar-header h1{font-size:16px;font-weight:700;color:#fff;margin-bottom:10px;letter-spacing:-0.3px}
#sidebar-header h1 span{color:#6d7eee}
#search{width:100%;background:#1e2230;border:1px solid #2a2e3a;border-radius:6px;color:#d1d5db;padding:8px 10px;font-size:13px;outline:none}
#search:focus{border-color:#6d7eee}
#search::placeholder{color:#555d6e}
#stats{font-size:11px;color:#555d6e;margin-top:8px;display:flex;gap:12px}
#stats span{display:flex;align-items:center;gap:4px}
#filter-bar{padding:8px 16px;border-bottom:1px solid #2a2e3a;display:flex;flex-wrap:wrap;gap:4px}
.chip{padding:3px 8px;border-radius:10px;font-size:10px;cursor:pointer;border:1px solid #2a2e3a;background:#1e2230;color:#888;transition:all .15s;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.chip.on{border-color:var(--c);color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent)}
#file-list{flex:1;overflow-y:auto;padding:8px 0}
.file-item{padding:6px 16px;font-size:12px;color:#888;cursor:pointer;display:flex;align-items:center;gap:8px;border-left:3px solid transparent;transition:all .1s}
.file-item:hover{background:#1e2230;color:#d1d5db}
.file-item.active{border-left-color:#6d7eee;color:#fff;background:#1e223088}
.file-item .dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.file-item .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-item .count{font-size:10px;color:#555d6e}

/* ---- Graph area ---- */
#main{flex:1;display:flex;flex-direction:column;position:relative}
#cy{flex:1}
#toolbar{position:absolute;top:12px;right:12px;display:flex;gap:6px;z-index:5}
.tbtn{background:#1e2230;border:1px solid #2a2e3a;border-radius:6px;color:#888;padding:6px 12px;font-size:12px;cursor:pointer;transition:all .15s}
.tbtn:hover{border-color:#6d7eee;color:#d1d5db}
.tbtn.on{background:#6d7eee22;border-color:#6d7eee;color:#6d7eee}

/* ---- Detail panel ---- */
#detail{position:absolute;top:0;right:0;bottom:0;width:340px;background:#161922;border-left:1px solid #2a2e3a;transform:translateX(100%);transition:transform .2s;z-index:8;overflow-y:auto;padding:16px}
#detail.open{transform:translateX(0)}
#detail h3{font-size:15px;color:#fff;margin-bottom:6px}
.badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;margin-bottom:14px;text-transform:uppercase;letter-spacing:.5px}
.section{margin-bottom:16px}
.section-label{font-size:10px;color:#555d6e;text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px;font-weight:600}
.section-value{font-size:13px;color:#d1d5db;word-break:break-all}
#detail pre{background:#0f1117;border:1px solid #2a2e3a;border-radius:6px;padding:10px;font-size:12px;color:#d1d5db;white-space:pre-wrap;max-height:200px;overflow-y:auto;margin-top:4px}
.conn-list{list-style:none}
.conn-list li{padding:5px 0;font-size:12px;border-bottom:1px solid #1e2230;cursor:pointer;color:#888;display:flex;align-items:center;gap:6px}
.conn-list li:hover{color:#6d7eee}
.conn-tag{background:#1e2230;padding:1px 6px;border-radius:6px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
#close-detail{position:absolute;top:12px;right:12px;background:none;border:none;color:#555d6e;cursor:pointer;font-size:18px}
#close-detail:hover{color:#d1d5db}
</style>
</head>
<body>

<!-- Sidebar -->
<div id="sidebar">
  <div id="sidebar-header">
    <h1><span>kc</span>-graph</h1>
    <input id="search" type="text" placeholder="Search nodes... (press /)" autocomplete="off"/>
    <div id="stats">
      <span>${stats.nodes} nodes</span>
      <span>${stats.edges} edges</span>
      <span>${stats.files} files</span>
    </div>
  </div>
  <div id="filter-bar"></div>
  <div id="file-list"></div>
</div>

<!-- Graph -->
<div id="main">
  <div id="cy"></div>
  <div id="toolbar">
    <button class="tbtn on" data-action="fit" title="Fit to screen">Fit</button>
    <button class="tbtn" data-action="focus" title="Focus mode: show only selected node connections">Focus</button>
  </div>
  <div id="detail">
    <button id="close-detail">&times;</button>
    <div id="detail-content"></div>
  </div>
</div>

<script>
var GRAPH = ${graphJSON};

var COLORS = {
  file:'#6d7eee', function:'#f59e0b', class:'#a78bfa', variable:'#34d399',
  type:'#f472b6', module:'#60a5fa', export:'#fbbf24', doc:'#c084fc', snippet:'#9ca3af'
};
var EDGE_C = {
  contains:'#2a2e3a', calls:'#f59e0b', imports:'#60a5fa', exports:'#fbbf24',
  extends:'#a78bfa', implements:'#a78bfa', references:'#34d399',
  depends_on:'#f472b6', documents:'#c084fc', tagged_with:'#9ca3af'
};

// ---- Build elements ----
var elements = [];
GRAPH.nodes.forEach(function(n){ elements.push({group:'nodes',data:n.data}); });
GRAPH.edges.forEach(function(e){ elements.push({group:'edges',data:e.data}); });

var cy = cytoscape({
  container: document.getElementById('cy'),
  elements: elements,
  style: [
    { selector:'node', style:{
      'shape':'round-rectangle',
      'width': function(e){ var t=e.data('type'); return t==='file'?140:t==='class'?120:90; },
      'height': function(e){ var t=e.data('type'); return t==='file'?36:t==='class'?32:28; },
      'background-color': function(e){ return COLORS[e.data('type')]||'#9ca3af'; },
      'background-opacity': 0.15,
      'border-width': 1.5,
      'border-color': function(e){ return COLORS[e.data('type')]||'#9ca3af'; },
      'border-opacity': 0.6,
      'label':'data(label)',
      'color':'#d1d5db',
      'font-size': function(e){ return e.data('type')==='file'?11:10; },
      'font-weight': function(e){ return e.data('type')==='file'?'bold':'normal'; },
      'text-valign':'center',
      'text-halign':'center',
      'text-max-width': function(e){ var t=e.data('type'); return t==='file'?130:t==='class'?110:80; },
      'text-wrap':'ellipsis',
      'text-outline-color':'#0f1117',
      'text-outline-width':1,
      'overlay-padding':4,
      'corner-radius':6,
    }},
    { selector:'node:active', style:{ 'overlay-opacity':0.08 }},
    { selector:'node.highlight', style:{
      'border-width':2.5, 'border-opacity':1,
      'background-opacity':0.25, 'z-index':999,
    }},
    { selector:'node.semitransparent', style:{ 'opacity':0.12 }},
    { selector:'node.search-hit', style:{
      'border-width':2.5, 'border-color':'#f59e0b', 'border-opacity':1,
      'background-opacity':0.25, 'z-index':999,
    }},
    { selector:'edge', style:{
      'width': function(e){ var t=e.data('type'); return t==='calls'?2:t==='contains'?1:1.5; },
      'line-color': function(e){ return EDGE_C[e.data('type')]||'#2a2e3a'; },
      'target-arrow-color': function(e){ return EDGE_C[e.data('type')]||'#2a2e3a'; },
      'target-arrow-shape':'triangle',
      'arrow-scale':0.6,
      'curve-style':'bezier',
      'opacity': function(e){ var t=e.data('type'); return t==='contains'?0.15:t==='calls'?0.5:0.35; },
    }},
    { selector:'edge.highlight', style:{
      'opacity':0.9, 'width':2.5, 'z-index':999
    }},
    { selector:'edge.semitransparent', style:{ 'opacity':0.04 }},
    { selector:'edge[type="contains"]', style:{ 'line-style':'dotted', 'target-arrow-shape':'none' }},
    { selector:'edge[type="exports"]', style:{ 'line-style':'dashed', 'line-dash-pattern':[6,3] }},
  ],
  layout:{name:'preset'},
  minZoom:0.05, maxZoom:6, wheelSensitivity:0.25,
});

// ---- Layout: cluster by file ----
(function doLayout(){
  // Group nodes by fileGroup
  var groups = {};
  cy.nodes().forEach(function(n){
    var g = n.data('fileGroup');
    if(!groups[g]) groups[g] = [];
    groups[g].push(n);
  });

  var keys = Object.keys(groups).sort(function(a,b){
    return groups[b].length - groups[a].length;
  });

  // Grid of clusters
  var cols = Math.max(1, Math.ceil(Math.sqrt(keys.length)));
  var gapX = 320, gapY = 280;

  keys.forEach(function(key, idx){
    var col = idx % cols;
    var row = Math.floor(idx / cols);
    var cx = col * gapX;
    var cy2 = row * gapY;
    var members = groups[key];

    // File node (or main node) at center
    var fileNode = members.find(function(n){ return n.id() === key; });
    if(fileNode) fileNode.position({x:cx, y:cy2});

    // Children around it
    var children = members.filter(function(n){ return n.id() !== key; });
    var n = children.length;
    if(n === 0) return;
    var rows2 = Math.ceil(n / 3);
    var perRow = Math.min(n, 3);
    children.forEach(function(child, i){
      var r = Math.floor(i / perRow);
      var c = i % perRow;
      var offX = (c - (Math.min(n - r*perRow, perRow) - 1) / 2) * 110;
      var offY = (r + 1) * 55;
      child.position({x: cx + offX, y: cy2 + offY});
    });
  });

  cy.fit(undefined, 40);
})();

// ---- Sidebar: file list ----
var fileListEl = document.getElementById('file-list');
var fileNodes = cy.nodes().filter(function(n){ return n.data('type')==='file'||n.data('type')==='doc'; });
fileNodes.sort(function(a,b){ return a.data('label').localeCompare(b.data('label')); });
fileNodes.forEach(function(n){
  var div = document.createElement('div');
  div.className = 'file-item';
  div.dataset.id = n.id();
  var children = cy.nodes().filter(function(c){ return c.data('fileGroup')===n.id() && c.id()!==n.id(); });
  div.innerHTML = '<div class="dot" style="background:'+COLORS[n.data('type')]+'"></div>'
    + '<div class="name">' + esc(n.data('label')) + '</div>'
    + '<div class="count">' + children.length + '</div>';
  div.addEventListener('click', function(){
    // Focus on this file and its children
    document.querySelectorAll('.file-item').forEach(function(el){ el.classList.remove('active'); });
    div.classList.add('active');
    var group = cy.collection().merge(n).merge(children);
    var connected = group.connectedEdges().connectedNodes();
    cy.animate({ fit:{ eles: group.merge(connected), padding:60 }, duration:300 });
    showNodeInfo(n);
  });
  fileListEl.appendChild(div);
});

// ---- Sidebar: type filters ----
var filterBar = document.getElementById('filter-bar');
var allTypes = [];
cy.nodes().forEach(function(n){ var t=n.data('type'); if(allTypes.indexOf(t)<0) allTypes.push(t); });
allTypes.sort();
var activeTypes = {};
allTypes.forEach(function(t){ activeTypes[t]=true; });

allTypes.forEach(function(type){
  var chip = document.createElement('div');
  chip.className = 'chip on';
  chip.textContent = type;
  chip.style.setProperty('--c', COLORS[type]||'#9ca3af');
  chip.addEventListener('click', function(){
    activeTypes[type] = !activeTypes[type];
    chip.classList.toggle('on');
    cy.batch(function(){
      cy.nodes().forEach(function(n){
        n.style('display', activeTypes[n.data('type')] ? 'element' : 'none');
      });
    });
  });
  filterBar.appendChild(chip);
});

// ---- Search ----
var searchEl = document.getElementById('search');
var searchTimer;
searchEl.addEventListener('input', function(){
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function(){
    var q = searchEl.value.trim().toLowerCase();
    cy.batch(function(){
      cy.nodes().removeClass('search-hit');
      if(!q) return;
      cy.nodes().forEach(function(n){
        if((n.data('label')||'').toLowerCase().indexOf(q)>=0 || (n.data('file')||'').toLowerCase().indexOf(q)>=0){
          n.addClass('search-hit');
        }
      });
    });
    var hits = cy.nodes('.search-hit');
    if(hits.length>0) cy.animate({fit:{eles:hits, padding:60}, duration:300});
  }, 250);
});

// ---- Toolbar ----
document.querySelectorAll('.tbtn').forEach(function(btn){
  btn.addEventListener('click', function(){
    var action = btn.dataset.action;
    if(action==='fit'){
      cy.animate({fit:{eles:cy.elements(':visible'), padding:40}, duration:300});
      cy.elements().removeClass('highlight semitransparent');
      document.getElementById('detail').classList.remove('open');
    }
    if(action==='focus'){
      btn.classList.toggle('on');
    }
  });
});

// ---- Node click ----
cy.on('tap','node', function(evt){
  showNodeInfo(evt.target);
});
cy.on('tap', function(evt){
  if(evt.target === cy){
    cy.elements().removeClass('highlight semitransparent');
    document.getElementById('detail').classList.remove('open');
    document.querySelectorAll('.file-item').forEach(function(el){ el.classList.remove('active'); });
  }
});

function showNodeInfo(node){
  var d = node.data();
  cy.batch(function(){
    cy.elements().removeClass('highlight semitransparent');
    var hood = node.neighborhood().add(node);
    hood.addClass('highlight');
    cy.elements().not(hood).addClass('semitransparent');
  });

  var edges = node.connectedEdges();
  var html = '<h3>'+esc(d.label)+'</h3>'
    +'<div class="badge" style="background:color-mix(in srgb,'+(COLORS[d.type]||'#888')+' 20%,transparent);color:'+(COLORS[d.type]||'#888')+'">'+d.type+'</div>';

  if(d.file) html+='<div class="section"><div class="section-label">Location</div><div class="section-value">'+esc(d.file)+(d.line?':'+d.line:'')+'</div></div>';
  if(d.signature) html+='<div class="section"><div class="section-label">Signature</div><pre>'+esc(d.signature)+'</pre></div>';
  if(d.content) html+='<div class="section"><div class="section-label">Source</div><pre>'+esc(d.content)+'</pre></div>';

  // Group connections by type
  var connByType = {};
  edges.forEach(function(e){
    var t = e.data('type');
    if(!connByType[t]) connByType[t]=[];
    var isOut = e.data('source')===d.id;
    var otherId = isOut?e.data('target'):e.data('source');
    var other = cy.getElementById(otherId);
    connByType[t].push({label:other.data('label')||otherId, id:otherId, dir:isOut?'out':'in'});
  });

  var types = Object.keys(connByType).sort();
  types.forEach(function(t){
    var items = connByType[t];
    html+='<div class="section"><div class="section-label">'+t+' ('+items.length+')</div><ul class="conn-list">';
    items.forEach(function(item){
      var arrow = item.dir==='out'?'\\u2192':'\\u2190';
      html+='<li data-node="'+item.id+'"><span class="conn-tag" style="color:'+(EDGE_C[t]||'#888')+'">'+arrow+'</span> '+esc(item.label)+'</li>';
    });
    html+='</ul></div>';
  });

  document.getElementById('detail-content').innerHTML = html;
  document.getElementById('detail').classList.add('open');

  // Click connections to navigate
  document.querySelectorAll('.conn-list li').forEach(function(li){
    li.addEventListener('click',function(){
      var target = cy.getElementById(li.dataset.node);
      if(target.length){
        cy.animate({center:{eles:target}, zoom:1.5, duration:300});
        setTimeout(function(){ showNodeInfo(target); }, 350);
      }
    });
  });
}

document.getElementById('close-detail').addEventListener('click', function(){
  document.getElementById('detail').classList.remove('open');
  cy.elements().removeClass('highlight semitransparent');
});

// ---- Edge hover ----
cy.on('mouseover','edge',function(evt){
  evt.target.style({'opacity':0.9,'width':3,'z-index':999});
});
cy.on('mouseout','edge',function(evt){
  if(!evt.target.hasClass('highlight')) evt.target.removeStyle('opacity width z-index');
});

// ---- Keyboard ----
document.addEventListener('keydown',function(e){
  if(e.key==='/'&&document.activeElement!==searchEl){e.preventDefault();searchEl.focus();}
  if(e.key==='Escape'){
    searchEl.blur();searchEl.value='';
    cy.nodes().removeClass('search-hit');
    document.getElementById('detail').classList.remove('open');
    cy.elements().removeClass('highlight semitransparent');
  }
  if(e.key==='f'&&(e.metaKey||e.ctrlKey)){e.preventDefault();searchEl.focus();}
});

function esc(s){return s?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface ViewerOptions {
  port?: number;
  open?: boolean;
  host?: string;
}

function safeJSON(graph: CodeGraph): string {
  const cyData = graphToCytoscape(graph);
  return JSON.stringify(cyData).replace(/<\/script>/gi, '<\\/script>');
}

export function exportViewerHTML(graph: CodeGraph): string {
  const graphJSON = safeJSON(graph);
  const stats = { nodes: graph.nodeCount, edges: graph.edgeCount, files: graph.fileCount };
  return buildHTML(graphJSON, stats);
}

export function startViewer(graph: CodeGraph, options: ViewerOptions = {}): void {
  const port = options.port ?? 4242;
  const host = options.host ?? 'localhost';

  const graphJSON = safeJSON(graph);
  const stats = { nodes: graph.nodeCount, edges: graph.edgeCount, files: graph.fileCount };
  const html = buildHTML(graphJSON, stats);

  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    console.log(`kc-graph viewer running at ${url}`);
    console.log(`${stats.nodes} nodes, ${stats.edges} edges, ${stats.files} files`);
    console.log('Press Ctrl+C to stop');
    if (options.open !== false) openBrowser(url);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use. Try: kc-graph view --port ${port + 1}`);
      process.exit(1);
    }
    throw err;
  });
}

function openBrowser(url: string): void {
  const { exec } = require('node:child_process');
  const cmd =
    process.platform === 'darwin' ? `open "${url}"` :
    process.platform === 'win32' ? `start "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, () => {});
}
