#!/usr/bin/env node
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { buildStatusSummary } from "../src/lib/status-summary.mjs";
import { listControlRequests, readControlStore, requestCancellation } from "../src/lib/control-store.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const host = option("--host", "127.0.0.1");
const port = Number(option("--port", process.env.CODEX_MOA_DASHBOARD_PORT || 3737));
if (!["127.0.0.1", "::1", "localhost"].includes(host)) {
  throw new Error("The Codex MOA dashboard may only bind to a loopback address.");
}
const dashboardToken = process.env.CODEX_MOA_DASHBOARD_TOKEN || randomBytes(32).toString("hex");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Codex MOA Control Plane</title>
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif;background:#07110d;color:#e8fff3}
body{margin:0;padding:32px;background:radial-gradient(circle at top left,#123d2d,#07110d 48%)}
main{max-width:1180px;margin:0 auto}.top{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:24px}
h1{margin:0;font-size:32px}.muted{color:#8eb9a6}.badge{padding:8px 12px;border:1px solid #2b6b52;border-radius:999px;background:#0b1d16}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:20px 0}
.card{background:#0c1d17cc;border:1px solid #1d4938;border-radius:16px;padding:18px;box-shadow:0 12px 40px #0005}
.value{font-size:28px;font-weight:700;margin-top:8px}.section{margin-top:28px}.seat{display:grid;grid-template-columns:1.1fr .8fr .8fr .7fr auto;gap:12px;align-items:center;padding:14px;border-bottom:1px solid #17382c}
button{border:0;border-radius:10px;padding:9px 13px;background:#e5484d;color:white;font-weight:650;cursor:pointer}button:hover{filter:brightness(1.12)}
code{color:#9ef0c5}.pill{padding:4px 8px;border-radius:999px;background:#17382c;font-size:12px}
</style>
</head>
<body><main>
<div class="top"><div><h1>Codex MOA</h1><div class="muted">Seat · worktree · memory · Navigator · provider control plane</div></div><div id="status" class="badge">loading</div></div>
<div id="cards" class="grid"></div>
<div class="section"><h2>Active seats</h2><div id="seats" class="card">Loading…</div></div>
<div class="section"><h2>Recent control requests</h2><div id="requests" class="card">Loading…</div></div>
</main>
<script>
const dashboardToken=${JSON.stringify(dashboardToken)};
function node(tag,text,className){const item=document.createElement(tag);if(text!==undefined)item.textContent=String(text);if(className)item.className=className;return item;}
async function api(path,options={}){const headers={...(options.headers||{}),'x-codex-moa-token':dashboardToken};const response=await fetch(path,{...options,headers});if(!response.ok)throw new Error('Dashboard API '+response.status);return response.json();}
async function load(){
  const data=await api('/api/status');
  document.getElementById('status').textContent=data.status.toUpperCase()+' · '+data.updatedAt;
  const cards=[['Active',data.seats.active],['Completed',data.seats.completed],['Jobs',data.jobs.active],['Worktrees',data.worktrees.count],['Memories',data.memory.count],['Providers',Object.entries(data.providerCounts).map(function(entry){return entry[0]+':'+entry[1];}).join(' ')||'none'],['Navigator',data.navigator?.verdict||'idle'],['Tokens',data.cost.totalTokens],['Cost',data.cost.estimatedUsd===null?'unpriced':'$'+data.cost.estimatedUsd.toFixed(4)]];
  const cardsRoot=document.getElementById('cards');cardsRoot.replaceChildren();
  cards.forEach(function(card){const wrapper=node('div',undefined,'card');wrapper.append(node('div',card[0],'muted'),node('div',card[1],'value'));cardsRoot.append(wrapper);});
  const active=data.seats.activeEntries||[];
  const seatsRoot=document.getElementById('seats');seatsRoot.replaceChildren();
  if(!active.length)seatsRoot.append(node('div','No active seats.','muted'));
  active.forEach(function(s){const row=node('div',undefined,'seat');const button=node('button','Cancel');button.addEventListener('click',()=>cancelSeat(s.taskId||'',s.seat));row.append(node('strong',s.seat),node('span',s.model||''),node('span',s.status,'pill'),node('code',s.worktree||'isolated/readonly'),button);seatsRoot.append(row);});
  const requests=data.controlRequests||[];
  const requestsRoot=document.getElementById('requests');requestsRoot.replaceChildren();
  if(!requests.length)requestsRoot.append(node('div','No control requests.','muted'));
  requests.slice(0,12).forEach(function(r){const row=node('div',undefined,'seat');row.append(node('code',r.id),node('span',r.seat||r.taskId||r.key),node('span',r.status),node('span',r.reason||''),node('span',''));requestsRoot.append(row);});
}
async function cancelSeat(taskId,seat){await api('/api/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:taskId||null,seat,reason:'dashboard'})});await load();}
load().catch(console.error);setInterval(()=>load().catch(console.error),5000);
</script></body></html>`;

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function authorized(request) {
  const supplied = String(request.headers["x-codex-moa-token"] ?? "");
  const expected = Buffer.from(dashboardToken);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(html);
      return;
    }
    if (request.method === "GET" && request.url === "/api/status") {
      if (!authorized(request)) return json(response, 403, { error: "forbidden" });
      const summary = await buildStatusSummary();
      const store = await readControlStore();
      json(response, 200, { ...summary, controlRequests: listControlRequests(store).slice(0, 50) });
      return;
    }
    if (request.method === "POST" && request.url === "/api/cancel") {
      if (!authorized(request)) return json(response, 403, { error: "forbidden" });
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 64 * 1024) return json(response, 413, { error: "request too large" });
      }
      const target = body ? JSON.parse(body) : {};
      if (!target.taskId && !target.seat && !target.key) return json(response, 400, { error: "taskId, seat, or key is required" });
      const control = await requestCancellation({ ...target, reason: target.reason || "dashboard" });
      json(response, 202, control);
      return;
    }
    json(response, 404, { error: "not found" });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Codex MOA dashboard: http://${host}:${port}`);
});
